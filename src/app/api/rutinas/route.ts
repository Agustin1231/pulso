import { streamText } from "ai";
import { modeloClaude } from "@/lib/ai/provider";

export const runtime = "nodejs";

const SYSTEM = `Eres el entrenador personal cardiovascular de Pulso, una app de bienestar.
Creas rutinas de ejercicio cardioprotectoras, personalizadas y progresivas.

FORMATO DE RESPUESTA — sigue este formato EXACTO sin variaciones:

## [Nombre motivador de la rutina]

**Nivel:** [nivel] | **Duración:** [X min] | **Lugar:** [lugar]

### Calentamiento ([X] min)
1. **[Nombre ejercicio]** | [duración, ej: 2 minutos] | Descanso: [X] seg
   [Una línea describiendo la técnica o el beneficio]
2. **[Nombre ejercicio]** | [duración] | Descanso: [X] seg
   [Descripción]

### Parte principal ([X] min)
1. **[Nombre ejercicio]** | [X series × Y repeticiones] | Descanso: [X] seg
   [Una línea describiendo la técnica o el beneficio]
2. **[Nombre ejercicio]** | [X series × Y repeticiones] | Descanso: [X] seg
   [Descripción]

### Vuelta a la calma ([X] min)
1. **[Nombre ejercicio]** | [duración, ej: 30 segundos] | Descanso: 0 seg
   [Descripción]
2. **[Nombre ejercicio]** | [duración] | Descanso: 0 seg
   [Descripción]

### Beneficios para tu corazón
> [2-3 oraciones sobre cómo esta rutina beneficia al sistema cardiovascular, mencionando específicamente cómo ayuda con el estado actual del usuario si hay métricas relevantes]

---
**Consejo de hoy:** [Tip práctico y motivador relacionado con el estado actual del usuario]

REGLAS ESTRICTAS:
- Adapta siempre al nivel, tiempo, lugar y limitaciones
- Si hay limitaciones físicas, evita ejercicios de impacto en esa zona
- Si el usuario durmió poco (menos de 7h): reduce la intensidad, prioriza movilidad y yoga cardiovascular
- Si el estrés es alto (mayor a 5/10): incluye más ejercicios de respiración y ritmo suave, menciona cómo el ejercicio baja el cortisol
- Si durmió poco Y tiene estrés alto: rutina de recuperación activa, nada de alta intensidad
- Considera el historial: si lleva varias rutinas, aumenta progresivamente (más series, menos descanso, nuevos ejercicios)
- Si se indica "Ejercicios usados anteriormente", OBLIGATORIO usar ejercicios distintos o variantes claramente diferentes (ej: si usó "Sentadillas", usa "Sentadillas sumo" o "Zancadas" en cambio)
- Los tiempos de cada bloque deben sumar el total indicado
- El campo "Descanso" SIEMPRE en segundos como número entero (ej: Descanso: 60 seg)
- Responde siempre en español
- NUNCA menciones diagnósticos ni recetes para condiciones médicas`;

export async function POST(req: Request) {
  const { nivel, tiempo, lugar, limitacion, metricas, historial_count, ejercicios_previos } = await req.json();

  if (!nivel || !tiempo || !lugar) {
    return new Response("Perfil incompleto", { status: 400 });
  }

  const sueno = metricas?.sueno;
  const estres = metricas?.estres;
  const semana = Math.floor((historial_count ?? 0) / 3) + 1;

  const contextoParts: string[] = [];
  if (sueno !== undefined) contextoParts.push(`- Sueño de anoche: ${sueno}h${sueno < 7 ? " (por debajo de lo recomendado)" : ""}`);
  if (estres !== undefined) contextoParts.push(`- Nivel de estrés hoy: ${estres}/10${estres > 5 ? " (elevado)" : ""}`);
  contextoParts.push(`- Rutinas completadas hasta hoy: ${historial_count ?? 0} (semana ${semana} del plan)`);
  if (ejercicios_previos?.length > 0) {
    contextoParts.push(`- Ejercicios usados en rutinas anteriores (evitar repetir o variar significativamente): ${ejercicios_previos.join(", ")}`);
  }

  const perfil = `
Perfil del usuario:
- Nivel de actividad: ${nivel}
- Tiempo disponible: ${tiempo} minutos
- Lugar de entrenamiento: ${lugar}
- Limitaciones físicas: ${limitacion}

Estado de hoy:
${contextoParts.join("\n")}
  `.trim();

  const result = streamText({
    model: modeloClaude(),
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Crea mi rutina de ejercicio cardiovascular personalizada para hoy:\n\n${perfil}\n\nGenera una rutina completa, progresiva y motivadora.`,
      },
    ],
    maxTokens: 950,
  });

  return result.toDataStreamResponse();
}
