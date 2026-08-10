import { streamText } from "ai";
import { modeloClaude } from "@/lib/ai/provider";

export const runtime = "nodejs";

const SYSTEM = `Eres el asistente de salud cardiovascular de Pulso. Genera exactamente 3 tips personalizados y accionables.

Formato exacto (usa markdown):
### [emoji] [Título conciso]
[2-3 oraciones directas y motivadoras con un consejo práctico para HOY]

Reglas:
- Exactamente 3 tips con el formato ### arriba
- 2-3 oraciones por tip, sin más
- Si hay métricas en "atencion" o "riesgo", incluye al menos un tip específico para mejorarlas
- Tono cálido, cercano, motivador — sin alarmismo
- Solo hábitos cotidianos: movimiento, alimentación, sueño, hidratación, estrés
- Nunca diagnósticos ni medicamentos`;

export async function POST(req: Request) {
  const { metricas } = (await req.json()) as {
    metricas: Array<{ label: string; valor: number | null; unidad: string; estado: string }>;
  };

  const ctx = metricas
    .map((m) =>
      `- ${m.label}: ${m.valor !== null ? `${m.valor}${m.unidad}` : "sin datos"} (${m.estado})`
    )
    .join("\n");

  const result = streamText({
    model: modeloClaude(),
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Mis métricas de hoy:\n${ctx}\n\nGenera mis 3 tips personalizados.`,
      },
    ],
    maxTokens: 450,
  });

  return result.toDataStreamResponse();
}
