import { streamText } from "ai";
import { modeloClaude } from "@/lib/ai/provider";
import { getInforme } from "@/lib/db/informe";
import { resumirInforme } from "@/lib/ml/resumen";

export const runtime = "nodejs";

// El informe lo calcula el motor (`lib/ml`) en el servidor a partir del uid;
// el cliente no manda números. El modelo de lenguaje redacta sobre ellos.

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

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const uid = typeof body?.uid === "string" ? body.uid : "";
  if (!uid) return new Response("Falta uid", { status: 400 });

  const informe = await getInforme(uid);

  const result = streamText({
    model: modeloClaude(),
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `${resumirInforme(informe)}\n\nGenera mis 3 tips personalizados.`,
      },
    ],
    // El SDK convierte los errores del modelo en una parte `3:` del stream sin
    // loguearlos; sin esto un fallo de API/proxy es invisible en el servidor.
    onError: ({ error }) => console.error("[ai] tips:", error instanceof Error ? error.message : error),
    maxTokens: 450,
  });

  return result.toDataStreamResponse();
}
