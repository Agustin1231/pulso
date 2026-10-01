import { streamText } from "ai";
import { modeloClaude } from "@/lib/ai/provider";
import { conUsuario } from "@/lib/db/pool";
import { rutinasActivas, ultimasMetricas } from "@/lib/db/consultas";
import { auditar } from "@/lib/seguridad/auditoria";
import { rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { cuerpoRutinaSchema } from "@/lib/seguridad/validacion";

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

/**
 * El cliente solo manda las cuatro respuestas del cuestionario (valores
 * cerrados). Sueño, estrés, cantidad de rutinas y ejercicios previos los lee
 * el servidor de la base: antes llegaban del cliente y entraban al prompt tal
 * cual. Manda datos de salud a Anthropic, así que exige consentimiento.
 */
export const POST = rutaProtegida(
  {
    nombre:         "ia.rutina",
    cuerpo:         cuerpoRutinaSchema,
    consentimiento: true,
    limites:        (uid, ip) => [limite("ia", uid), limite("iaIp", ip)],
  },
  async ({ uid, ip, cuerpo }) => {
    const { nivel, tiempo, lugar, limitacion } = cuerpo;

    const { metricas, rutinas } = await conUsuario(uid, async (db) => ({
      metricas: await ultimasMetricas(db, uid),
      rutinas:  await rutinasActivas(db, uid),
    }));

    const suenoRow = metricas.find((m) => m.tipo === "horas_sueno");
    const estresRow = metricas.find((m) => m.tipo === "nivel_estres");
    const sueno = suenoRow ? Math.round(Number(suenoRow.valor) * 10) / 10 : undefined;
    const estres = estresRow ? Math.round(Number(estresRow.valor)) : undefined;
    const historialCount = rutinas.length;
    const ejerciciosPrevios = rutinas
      .slice(0, 5)
      .flatMap((r) => r.contenido.ejercicios?.map((e) => e.nombre) ?? [])
      .filter((n, i, arr) => arr.indexOf(n) === i)
      .slice(0, 60);

    // Minimización: a la IA solo va lo que usa la rutina (sueño y estrés), sin
    // el uid ni el resto de las métricas.
    await auditar({
      uid, accion: "ia.rutina", resultado: "ok", ip,
      detalle: {
        proveedor:   "anthropic",
        datos_salud: [
          sueno !== undefined && "horas_sueno",
          estres !== undefined && "nivel_estres",
          limitacion !== "Ninguna limitación" && "limitacion",
        ].filter(Boolean),
      },
    });

    const semana = Math.floor(historialCount / 3) + 1;

    const contextoParts: string[] = [];
    if (sueno !== undefined) contextoParts.push(`- Sueño de anoche: ${sueno}h${sueno < 7 ? " (por debajo de lo recomendado)" : ""}`);
    if (estres !== undefined) contextoParts.push(`- Nivel de estrés hoy: ${estres}/10${estres > 5 ? " (elevado)" : ""}`);
    contextoParts.push(`- Rutinas completadas hasta hoy: ${historialCount} (semana ${semana} del plan)`);
    if (ejerciciosPrevios.length > 0) {
      contextoParts.push(`- Ejercicios usados en rutinas anteriores (evitar repetir o variar significativamente): ${ejerciciosPrevios.join(", ")}`);
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
      onError: ({ error }) => console.error("[ai] rutina:", error instanceof Error ? error.message : error),
      maxTokens: 950,
    });

    return result.toDataStreamResponse();
  }
);
