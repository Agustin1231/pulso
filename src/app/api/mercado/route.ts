import { streamText } from "ai";
import { modeloClaude } from "@/lib/ai/provider";
import { auditar } from "@/lib/seguridad/auditoria";
import { datosDelUsuario, REGLA_DATOS_DEL_USUARIO, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { cuerpoMercadoSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

const SYSTEM = `Eres el asistente de nutrición cardiovascular de Pulso.
Tu tarea es generar listas de compra para el supermercado, enfocadas en alimentación cardioprotectora.
Tienes memoria de las compras anteriores del usuario para hacer recomendaciones progresivas y variadas.

FORMATO DE RESPUESTA (siempre este formato exacto):
## Lista del mercado [período]

### 🥬 Verduras y Frutas
- Ingrediente (cantidad estimada) — para qué sirve en la dieta cardiovascular

### 🥩 Proteínas
- Ingrediente (cantidad) — beneficio

### 🌾 Granos y Cereales
- Ingrediente (cantidad) — beneficio

### 🫒 Aceites, Frutos Secos y Semillas
- Ingrediente (cantidad) — beneficio

### 🧀 Lácteos y Alternativas
- Ingrediente (cantidad) — beneficio

### 🫙 Despensa y Condimentos
- Ingrediente (cantidad) — beneficio

---
**Progresión:** [Una frase sobre cómo esta lista mejora o complementa lo que el usuario ha comprado antes, si hay historial]

**Consejo:** [Un tip sobre alimentación cardiovascular y compras saludables]

REGLAS:
- Si hay listas anteriores: mantén los alimentos básicos que funcionan, rota proteínas y verduras para dar variedad, introduce 2-3 alimentos nuevos cardioprotectores cada período para progresar.
- Si el usuario tiene recetas guardadas, prioriza sus ingredientes y complementa para una dieta completa.
- Si pide período semanal: cantidades para 1 persona, 7 días.
- Si pide período mensual: cantidades para 1 persona, 30 días (compra base + reposición).
- Si el usuario dice que no le gusta un ingrediente o quiere cambiarlo, sustitúyelo y regenera la lista completa.
- Prioriza siempre: omega-3, fibra, potasio, antioxidantes, bajo sodio y grasas saludables.
- Responde siempre en español.
- NUNCA menciones diagnósticos ni recetes para condiciones médicas.

${REGLA_DATOS_DEL_USUARIO}`;

export const POST = rutaProtegida(
  {
    nombre:  "ia.mercado",
    cuerpo:  cuerpoMercadoSchema,
    limites: (uid, ip) => [limite("ia", uid), limite("iaIp", ip)],
  },
  async ({ uid, ip, cuerpo }) => {
    const { periodo, ingredientes_recetas, listas_anteriores, historial, pregunta } = cuerpo;
    await auditar({ uid, accion: "ia.mercado", resultado: "ok", ip, detalle: { proveedor: "anthropic", periodo } });

    // Contexto de recetas guardadas
    const contextoRecetas = ingredientes_recetas.length
      ? `\nIngredientes de las recetas guardadas del usuario: ${datosDelUsuario(ingredientes_recetas.join(", "))}`
      : "";

    // Contexto de listas anteriores (últimas 2)
    const contextoHistorial = listas_anteriores.length
      ? `\nListas de compra anteriores del usuario (para dar continuidad y variedad):\n${
          listas_anteriores.slice(0, 2).map((l) =>
            datosDelUsuario(`[${l.nombre}]:\n${l.contenido.slice(0, 600)}...`)
          ).join("\n\n")
        }`
      : "";

    const mensajeInicial = pregunta
      ? datosDelUsuario(pregunta)
      : `Genera una lista de compras ${periodo} para una alimentación cardioprotectora.${contextoRecetas}${contextoHistorial}`;

    const messages = [
      ...historial,
      { role: "user" as const, content: mensajeInicial },
    ];

    const result = streamText({
      model: modeloClaude(),
      system: SYSTEM,
      messages,
      onError: ({ error }) => console.error("[ai] mercado:", error instanceof Error ? error.message : error),
      maxTokens: 1100,
    });

    return result.toDataStreamResponse();
  }
);
