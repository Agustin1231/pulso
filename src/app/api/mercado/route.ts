import { streamText } from "ai";
import { modeloClaude } from "@/lib/ai/provider";

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
- NUNCA menciones diagnósticos ni recetes para condiciones médicas.`;

export async function POST(req: Request) {
  const { periodo, ingredientes_recetas, listas_anteriores, historial, pregunta } = await req.json();

  if (!periodo) {
    return new Response("Período requerido", { status: 400 });
  }

  // Contexto de recetas guardadas
  const contextoRecetas = ingredientes_recetas?.length
    ? `\nIngredientes de las recetas guardadas del usuario: ${ingredientes_recetas.join(", ")}`
    : "";

  // Contexto de listas anteriores (últimas 2)
  const contextoHistorial = listas_anteriores?.length
    ? `\nListas de compra anteriores del usuario (para dar continuidad y variedad):\n${
        listas_anteriores.map((l: { nombre: string; contenido: string }, i: number) =>
          `[${l.nombre}]:\n${l.contenido.slice(0, 600)}...`
        ).join("\n\n")
      }`
    : "";

  const mensajeInicial = pregunta
    ? pregunta
    : `Genera una lista de compras ${periodo} para una alimentación cardioprotectora.${contextoRecetas}${contextoHistorial}`;

  const messages = [
    ...(historial ?? []),
    { role: "user" as const, content: mensajeInicial },
  ];

  const result = streamText({
    model: modeloClaude(),
    system: SYSTEM,
    messages,
    maxTokens: 1100,
  });

  return result.toDataStreamResponse();
}
