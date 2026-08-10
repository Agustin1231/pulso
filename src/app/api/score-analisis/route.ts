import { streamText } from "ai";
import { modeloClaude } from "@/lib/ai/provider";

export const runtime = "nodejs";

const SYSTEM = `Eres el analista de salud cardiovascular de Pulso. Interpretas el score de riesgo del usuario y das recomendaciones prácticas y motivadoras.

NUNCA diagnostiques ni recetes. Siempre sugiere consultar al médico ante síntomas.

FORMATO EXACTO — sigue esta estructura sin variaciones:

### Lo que está bien
> [1-2 oraciones reconociendo lo positivo. Si todo está en riesgo, valora que el usuario esté monitoreando su salud.]

### Lo que puede mejorar
- **[Factor]:** [Qué está pasando y cómo impacta al corazón.] — [Acción concreta y específica]
- **[Factor]:** [Explicación breve.] — [Acción concreta]

### Tu plan esta semana
1. [Acción específica y medible, empezar hoy]
2. [Cambio de hábito para los próximos días]
3. [Objetivo de la semana]

### Si mantienes el ritmo
> [Proyección motivadora: si mejoras X factor, tu score podría subir Y puntos en Z semanas. Sé específico con los números.]

REGLAS:
- Tono empático y motivador, nunca alarmista
- Acciones muy concretas (ej: "dormir 30 min más" no "mejorar el sueño")
- Si hay métricas con estado Normal, menciónalo positivamente
- Responde en español`;

export async function POST(req: Request) {
  const { score, factores } = await req.json();

  if (!factores?.length) {
    return new Response("Sin datos", { status: 400 });
  }

  const resumenFactores = factores
    .map((f: { label: string; valor: number; unidad: string; estado: string; puntos: number; maxPuntos: number }) =>
      f.estado === "sin-datos"
        ? `- ${f.label}: sin datos`
        : `- ${f.label}: ${f.estado === "normal" ? "Normal" : f.estado === "atencion" ? "Atención" : "Riesgo"} (${f.valor} ${f.unidad})`
    )
    .join("\n");

  const prompt = `Score cardiovascular del usuario: ${score}/100

Métricas:
${resumenFactores}

Genera un análisis personalizado siguiendo el formato exacto.`;

  const result = streamText({
    model: modeloClaude(),
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 550,
  });

  return result.toDataStreamResponse();
}
