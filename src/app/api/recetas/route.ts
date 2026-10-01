import { streamText } from "ai";
import { modeloClaude } from "@/lib/ai/provider";
import { auditar } from "@/lib/seguridad/auditoria";
import { datosDelUsuario, REGLA_DATOS_DEL_USUARIO, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { cuerpoRecetaSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

const SYSTEM = `Eres el chef asistente cardioprotector de Pulso, una app de bienestar cardiovascular.
Tu tarea es crear recetas saludables para el corazón a partir de los ingredientes que el usuario proporciona.

FORMATO DE RESPUESTA (siempre este formato exacto):
## [Nombre de la receta]

**Porciones:** X | **Tiempo:** X minutos

### Ingredientes
- Ingrediente 1 (cantidad)
- Ingrediente 2 (cantidad)

### Preparación
1. Paso 1
2. Paso 2

### Beneficios cardiovasculares
[2-3 oraciones sobre por qué es cardioprotectora]

REGLAS ESTRICTAS:
- Adapta la receta para ser cardioprotectora (baja en sodio, grasas saturadas y azúcares añadidos)
- Sugiere sustituciones saludables si un ingrediente no es ideal para el corazón
- Menciona qué nutrientes clave aporta (omega-3, fibra, potasio, antioxidantes, etc.)
- Responde siempre en español
- Si el usuario menciona pocos ingredientes, complementa con ingredientes básicos saludables
- NUNCA menciones diagnósticos, enfermedades ni recetes para condiciones médicas específicas
- NUNCA uses frases como "consulta a tu médico" dentro de la receta (solo al final si hay algo relevante)

${REGLA_DATOS_DEL_USUARIO}`;

export const POST = rutaProtegida(
  {
    nombre:  "ia.receta",
    cuerpo:  cuerpoRecetaSchema,
    limites: (uid, ip) => [limite("ia", uid), limite("iaIp", ip)],
  },
  async ({ uid, ip, cuerpo }) => {
    await auditar({ uid, accion: "ia.receta", resultado: "ok", ip, detalle: { proveedor: "anthropic" } });

    const result = streamText({
      model: modeloClaude(),
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Tengo estos ingredientes disponibles: ${datosDelUsuario(cuerpo.ingredientes)}\n\nCrea una receta cardioprotectora con ellos.`,
        },
      ],
      onError: ({ error }) => console.error("[ai] receta:", error instanceof Error ? error.message : error),
      maxTokens: 800,
    });

    return result.toDataStreamResponse();
  }
);
