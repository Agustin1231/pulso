import { streamText } from "ai";
import { modeloClaude } from "@/lib/ai/provider";
import { auditar } from "@/lib/seguridad/auditoria";
import { datosDelUsuario, REGLA_DATOS_DEL_USUARIO, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { cuerpoChatRecetaSchema } from "@/lib/seguridad/validacion";

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
- Sé breve en las respuestas conversacionales (máximo 3 oraciones).

${REGLA_DATOS_DEL_USUARIO}`;

export const POST = rutaProtegida(
  {
    nombre:  "ia.receta_chat",
    cuerpo:  cuerpoChatRecetaSchema,
    limites: (uid, ip) => [limite("ia", uid), limite("iaIp", ip)],
  },
  async ({ uid, ip, cuerpo }) => {
    await auditar({ uid, accion: "ia.receta_chat", resultado: "ok", ip, detalle: { proveedor: "anthropic", turnos: cuerpo.historial.length } });

    // El historial ya viene filtrado a roles user/assistant (ver validacion.ts).
    const messages = [
      { role: "user" as const, content: `Esta es la receta actual:\n\n${datosDelUsuario(cuerpo.receta)}` },
      { role: "assistant" as const, content: "Entendido, tengo la receta. ¿En qué te puedo ayudar?" },
      ...cuerpo.historial,
      { role: "user" as const, content: datosDelUsuario(cuerpo.pregunta) },
    ];

    const result = streamText({
      model: modeloClaude(),
      system: SYSTEM,
      messages,
      onError: ({ error }) => console.error("[ai] receta_chat:", error instanceof Error ? error.message : error),
      maxTokens: 900,
    });

    return result.toDataStreamResponse();
  }
);
