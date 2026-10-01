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

const SYSTEM = `Eres el analista de salud cardiovascular de Pulso. Recibes un INFORME calculado por el motor estadístico de la app (índice de riesgo por factor, pronósticos con intervalos, alertas de cambio de régimen, limitaciones) y lo interpretas para el usuario con recomendaciones prácticas y motivadoras.

REGLAS SOBRE LOS NÚMEROS — son las más importantes:
- Todo número que menciones tiene que salir del informe, tal cual está. No inventes cifras, porcentajes, plazos ni proyecciones.
- La proyección del score YA está calculada. Si la mencionas, usa exactamente el valor y el intervalo del informe y aclara que supone que el patrón reciente se mantiene.
- Si el informe dice "sin datos", "confianza baja", "insuficiente" o "no disponible", dilo con esas palabras; no lo rellenes.
- El índice NO es una escala clínica ni una probabilidad de infarto: no lo presentes como tal.

NUNCA diagnostiques ni recetes. Siempre sugiere consultar al médico ante síntomas.

FORMATO EXACTO — sigue esta estructura sin variaciones:

### Lo que está bien
> [1-2 oraciones reconociendo lo positivo, citando los factores en estado normal. Si no hay ninguno, valora que el usuario esté monitoreando su salud.]

### Lo que puede mejorar
- **[Factor]:** [Qué dice el informe: valor, estado y cuántos puntos resta.] — [Acción concreta y específica]
- **[Factor]:** [Explicación breve.] — [Acción concreta]

### Tu plan esta semana
1. [Acción específica y medible, empezar hoy]
2. [Cambio de hábito para los próximos días]
3. [Objetivo de la semana]

### Si mantienes el ritmo
> [Interpreta la PROYECCIÓN del informe con su intervalo. Si dice "no disponible", explica qué falta registrar para tenerla.]

REGLAS:
- Tono empático y motivador, nunca alarmista
- Acciones muy concretas (ej: "dormir 30 min más" no "mejorar el sueño")
- Si el informe trae ALERTAS, menciónalas en "Lo que puede mejorar" con su magnitud
- Si el informe trae una tendencia significativa, úsala
- Responde en español`;

export const POST = rutaProtegida(
  {
    nombre:         "ia.score",
    cuerpo:         null,
    consentimiento: true,
    limites:        (uid, ip) => [limite("ia", uid), limite("iaIp", ip)],
  },
  async ({ uid, ip }) => {
    const informe = await conUsuario(uid, (db) => calcularInforme(db, uid));
    if (Object.keys(informe.metricas).length === 0) {
      return json({ error: "sin_datos" }, 400);
    }

    const resumen = resumirInforme(informe);

    // Trazabilidad (fila 5): el hash del informe que vio la IA permite
    // reconstruir después qué datos generaron qué recomendación, sin guardar
    // los datos de salud en la auditoría.
    await auditar({
      uid, accion: "ia.score", resultado: "ok", ip,
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
          content: `${resumen}\n\nGenera el análisis personalizado siguiendo el formato exacto.`,
        },
      ],
      // El SDK convierte los errores del modelo en una parte `3:` del stream sin
      // loguearlos; sin esto un fallo de API/proxy es invisible en el servidor.
      onError: ({ error }) => console.error("[ai] score-analisis:", error instanceof Error ? error.message : error),
      maxTokens: 650,
    });

    return result.toDataStreamResponse();
  }
);
