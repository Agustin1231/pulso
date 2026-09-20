import { streamText } from "ai";
import { modeloClaude } from "@/lib/ai/provider";
import { getInforme } from "@/lib/db/informe";
import { resumirInforme } from "@/lib/ml/resumen";

export const runtime = "nodejs";

// El informe lo calcula el motor (`lib/ml`) en el servidor a partir del uid;
// el cliente no manda números. El modelo de lenguaje redacta sobre ellos.

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

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const uid = typeof body?.uid === "string" ? body.uid : "";
  if (!uid) return new Response("Falta uid", { status: 400 });

  const informe = await getInforme(uid);
  if (Object.keys(informe.metricas).length === 0) {
    return new Response("Sin métricas para analizar", { status: 400 });
  }

  const result = streamText({
    model: modeloClaude(),
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `${resumirInforme(informe)}\n\nAnaliza mis métricas y dame recomendaciones concretas.`,
      },
    ],
    // El SDK convierte los errores del modelo en una parte `3:` del stream sin
    // loguearlos; sin esto un fallo de API/proxy es invisible en el servidor.
    onError: ({ error }) => console.error("[ai] analisis-metricas:", error instanceof Error ? error.message : error),
    maxTokens: 600,
  });

  return result.toDataStreamResponse();
}
