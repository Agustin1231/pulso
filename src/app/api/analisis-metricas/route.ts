import { createHash } from "node:crypto";
import { streamText } from "ai";
import { modeloClaude } from "@/lib/ai/provider";
import { calcularInforme } from "@/lib/db/calculo-informe";
import { conUsuario } from "@/lib/db/pool";
import { resumirInforme } from "@/lib/ml/resumen";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";

export const runtime = "nodejs";

// El informe lo calcula el motor (`lib/ml`) en el servidor con el uid de la
// sesión; el cliente no manda nada. El modelo de lenguaje redacta sobre esos
// números. Manda datos de salud a Anthropic: exige consentimiento.

const SYSTEM = `Eres el asistente de salud cardiovascular de Pulso, una app de bienestar personal.
Recibes un INFORME calculado por el motor estadístico de la app (nivel actual, tendencia, pronóstico con intervalos, modelo elegido y alertas por métrica) y lo explicas en español, de forma clara y empática.

REGLAS SOBRE LOS NÚMEROS:
- Todo número que menciones tiene que salir del informe, tal cual. No inventes cifras, plazos ni pronósticos.
- Si citas un pronóstico, di también su intervalo y que supone que el patrón reciente se mantiene.
- Si el informe marca confianza baja o pocos registros, dilo; no lo rellenes.

REGLAS ESTRICTAS:
- Nunca diagnostiques enfermedades ni recetes medicamentos
- Siempre recomienda consultar a un médico ante valores preocupantes
- Usa lenguaje simple, no médico
- Sé específico y accionable (no genérico)
- Responde en máximo 4 párrafos cortos
- Si hay ALERTAS o valores en riesgo, menciónalos primero, con su magnitud
- Termina siempre con 2-3 recomendaciones concretas

DISCLAIMER: Recuerda al usuario que esto es orientación educativa, no diagnóstico médico.`;

export const POST = rutaProtegida(
  {
    nombre:         "ia.analisis",
    cuerpo:         null,
    consentimiento: true,
    limites:        (uid, ip) => [limite("ia", uid), limite("iaIp", ip)],
  },
  async ({ uid, ip }) => {
    const informe = await conUsuario(uid, (db) => calcularInforme(db, uid));
    if (Object.keys(informe.metricas).length === 0) {
      return json({ error: "sin_metricas" }, 400);
    }

    const resumen = resumirInforme(informe);

    // Trazabilidad (fila 5): el hash del informe que vio la IA permite
    // reconstruir después qué datos generaron qué recomendación, sin guardar
    // los datos de salud en la auditoría.
    await auditar({
      uid, accion: "ia.analisis", resultado: "ok", ip,
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
          content: `${resumen}\n\nAnaliza mis métricas y dame recomendaciones concretas.`,
        },
      ],
      // El SDK convierte los errores del modelo en una parte `3:` del stream sin
      // loguearlos; sin esto un fallo de API/proxy es invisible en el servidor.
      onError: ({ error }) => console.error("[ai] analisis-metricas:", error instanceof Error ? error.message : error),
      maxTokens: 600,
    });

    return result.toDataStreamResponse();
  }
);
