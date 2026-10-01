import { createHash } from "node:crypto";
import { streamText } from "ai";
import { modeloClaude } from "@/lib/ai/provider";
import { calcularInforme } from "@/lib/db/calculo-informe";
import { conUsuario } from "@/lib/db/pool";
import { resumirInforme } from "@/lib/ml/resumen";
import { auditar } from "@/lib/seguridad/auditoria";
import { rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";

export const runtime = "nodejs";

// El informe lo calcula el motor (`lib/ml`) en el servidor con el uid de la
// sesión; el cliente no manda nada. El modelo de lenguaje redacta sobre esos
// números. Manda datos de salud a Anthropic: exige consentimiento.

const SYSTEM = `Eres el asistente de salud cardiovascular de Pulso. Recibes un INFORME calculado por el motor estadístico de la app y generas exactamente 3 tips personalizados y accionables.

Formato exacto (usa markdown):
### [emoji] [Título conciso]
[2-3 oraciones directas y motivadoras con un consejo práctico para HOY]

Reglas:
- Exactamente 3 tips con el formato ### arriba
- 2-3 oraciones por tip, sin más
- Prioriza: primero las ALERTAS del informe, después los factores en estado "atencion" o "riesgo", después las tendencias adversas
- Si citas un número, tiene que ser el del informe, tal cual; no inventes cifras ni pronósticos
- Si el informe no tiene registros, da 3 tips generales para empezar a registrar métricas y hábitos
- Tono cálido, cercano, motivador — sin alarmismo
- Solo hábitos cotidianos: movimiento, alimentación, sueño, hidratación, estrés
- Nunca diagnósticos ni medicamentos`;

export const POST = rutaProtegida(
  {
    nombre:         "ia.tips",
    cuerpo:         null,
    consentimiento: true,
    limites:        (uid, ip) => [limite("ia", uid), limite("iaIp", ip)],
  },
  async ({ uid, ip }) => {
    const informe = await conUsuario(uid, (db) => calcularInforme(db, uid));
    const resumen = resumirInforme(informe);

    // Trazabilidad (fila 5): el hash del informe que vio la IA permite
    // reconstruir después qué datos generaron qué recomendación, sin guardar
    // los datos de salud en la auditoría.
    await auditar({
      uid, accion: "ia.tips", resultado: "ok", ip,
      detalle: {
        proveedor:    "anthropic",
        informe_hash: createHash("sha256").update(resumen).digest("hex").slice(0, 16),
        metricas:     Object.keys(informe.metricas),
      },
    });

    const result = streamText({
      model: modeloClaude(),
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `${resumen}\n\nGenera mis 3 tips personalizados.`,
        },
      ],
      // El SDK convierte los errores del modelo en una parte `3:` del stream sin
      // loguearlos; sin esto un fallo de API/proxy es invisible en el servidor.
      onError: ({ error }) => console.error("[ai] tips:", error instanceof Error ? error.message : error),
      maxTokens: 450,
    });

    return result.toDataStreamResponse();
  }
);
