import { streamText } from "ai";
import { modeloClaude } from "@/lib/ai/provider";
import { getInforme } from "@/lib/db/informe";
import { resumirInforme } from "@/lib/ml/resumen";

export const runtime = "nodejs";

// El informe lo calcula el motor (`lib/ml`) en el servidor a partir del uid;
// el cliente no manda números. El modelo de lenguaje redacta sobre ellos.

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

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const uid = typeof body?.uid === "string" ? body.uid : "";
  if (!uid) return new Response("Falta uid", { status: 400 });

  const informe = await getInforme(uid);
  if (Object.keys(informe.metricas).length === 0) {
    return new Response("Sin datos", { status: 400 });
  }

  const result = streamText({
    model: modeloClaude(),
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `${resumirInforme(informe)}\n\nGenera el análisis personalizado siguiendo el formato exacto.`,
      },
    ],
    // El SDK convierte los errores del modelo en una parte `3:` del stream sin
    // loguearlos; sin esto un fallo de API/proxy es invisible en el servidor.
    onError: ({ error }) => console.error("[ai] score-analisis:", error instanceof Error ? error.message : error),
    maxTokens: 650,
  });

  return result.toDataStreamResponse();
}
