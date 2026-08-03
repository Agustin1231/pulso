import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export const runtime = "nodejs";

const SYSTEM = `Eres el asistente de salud cardiovascular de Pulso, una app de bienestar personal.
Tu rol es analizar métricas de salud y dar orientación educativa en español, de forma clara y empática.

REGLAS ESTRICTAS:
- Nunca diagnostiques enfermedades ni recetes medicamentos
- Siempre recomienda consultar a un médico ante valores preocupantes
- Usa lenguaje simple, no médico
- Sé específico y accionable (no genérico)
- Responde en máximo 4 párrafos cortos
- Si hay valores en riesgo, menciónalos primero
- Termina siempre con 2-3 recomendaciones concretas

DISCLAIMER: Recuerda al usuario que esto es orientación educativa, no diagnóstico médico.`;

export async function POST(req: Request) {
  const { metricas } = await req.json();

  if (!metricas || metricas.length === 0) {
    return new Response("Sin métricas para analizar", { status: 400 });
  }

  const resumen = metricas
    .map((m: { label: string; valor: number; unidad: string; estado: string }) =>
      `• ${m.label}: ${m.valor} ${m.unidad} (estado: ${m.estado})`
    )
    .join("\n");

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Analiza estas métricas cardiovasculares registradas hoy:\n\n${resumen}\n\nDame un análisis personalizado y recomendaciones concretas.`,
      },
    ],
    maxTokens: 600,
  });

  return result.toDataStreamResponse();
}
