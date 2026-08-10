import { streamText } from "ai";
import { modeloClaude } from "@/lib/ai/provider";

export const runtime = "nodejs";

const SYSTEM = `Eres el chef asistente cardioprotector de Pulso, una app de bienestar cardiovascular.
El usuario tiene una receta generada y quiere hacerte preguntas o pedirte modificaciones.

REGLAS:
- Si el usuario pregunta por una sustitución de ingrediente (ej: "no tengo aceite de oliva"), explica la mejor alternativa y REGENERA la receta completa con el cambio aplicado en el mismo formato.
- Si el usuario no le gusta un ingrediente, cámbialo y regenera la receta completa.
- Si es una pregunta general sobre técnica, nutrición o pasos, responde de forma clara y concisa SIN regenerar la receta.
- Si regeneras la receta, usa EXACTAMENTE el mismo formato markdown:
  ## [Nombre]
  **Porciones:** X | **Tiempo:** X minutos
  ### Ingredientes / ### Preparación / ### Beneficios cardiovasculares
- Responde siempre en español.
- NUNCA menciones diagnósticos ni recetes para condiciones médicas.
- Sé breve en las respuestas conversacionales (máximo 3 oraciones).`;

export async function POST(req: Request) {
  const { receta, pregunta, historial } = await req.json();

  if (!pregunta || !receta) {
    return new Response("Datos incompletos", { status: 400 });
  }

  const messages = [
    { role: "user" as const, content: `Esta es la receta actual:\n\n${receta}` },
    { role: "assistant" as const, content: "Entendido, tengo la receta. ¿En qué te puedo ayudar?" },
    ...(historial ?? []),
    { role: "user" as const, content: pregunta },
  ];

  const result = streamText({
    model: modeloClaude(),
    system: SYSTEM,
    messages,
    maxTokens: 900,
  });

  return result.toDataStreamResponse();
}
