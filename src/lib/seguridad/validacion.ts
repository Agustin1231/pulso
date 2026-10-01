import { z } from "zod";
import { METRICAS } from "@/lib/metricas-config";
import { valoresDe } from "@/lib/rutinas-opciones";
import type { MetricaType } from "@/lib/db/types";

/**
 * Validación de todo lo que entra desde el cliente (plantilla, fila 2).
 *
 * Las server actions y los route handlers son endpoints públicos: los tipos de
 * TypeScript no existen en runtime, así que cualquiera puede mandar cualquier
 * cosa. Cada esquema acota tipo, rango y largo; lo que no pasa se rechaza
 * antes de tocar la base o el modelo.
 */

const texto = (max: number) => z.string().trim().min(1).max(max);
const textoOpcional = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

export const idSchema = z.string().uuid();

export const fechaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((f) => !Number.isNaN(Date.parse(`${f}T00:00:00Z`)), "fecha inválida");

export const diasSchema = z.number().int().min(1).max(365);

// ─── Métricas ─────────────────────────────────────────────────────────────────

/**
 * Rango y unidad por métrica. Para las que muestra la UI salen de
 * metricas-config (la misma fuente que el formulario); el resto las usa el
 * motor y el seed de demo. La unidad la pone el servidor: el cliente ya no la manda.
 */
const OTRAS: Record<string, { unidad: string; min: number; max: number }> = {
  presion_sistolica:  { unidad: "mmHg",  min: 60,  max: 260 },
  presion_diastolica: { unidad: "mmHg",  min: 30,  max: 160 },
  glucosa:            { unidad: "mg/dL", min: 20,  max: 600 },
  colesterol_total:   { unidad: "mg/dL", min: 50,  max: 600 },
};

export const RANGO_METRICA: Record<MetricaType, { unidad: string; min: number; max: number }> = {
  ...(OTRAS as Record<MetricaType, { unidad: string; min: number; max: number }>),
  ...Object.fromEntries(METRICAS.map((m) => [m.tipo, { unidad: m.unidad, min: m.min, max: m.max }])),
};

export const tipoMetricaSchema = z.enum([
  "presion_sistolica", "presion_diastolica", "frecuencia_cardiaca", "peso",
  "glucosa", "colesterol_total", "horas_sueno", "nivel_estres",
]);

export const metricaSchema = z
  .object({
    tipo:  tipoMetricaSchema,
    valor: z.number().finite(),
    notas: textoOpcional(500),
  })
  .refine(({ tipo, valor }) => valor >= RANGO_METRICA[tipo].min && valor <= RANGO_METRICA[tipo].max, {
    message: "valor fuera de rango",
  });

// ─── Hábitos ──────────────────────────────────────────────────────────────────

const DIAS_SEMANA = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"] as const;

export const habitoFormSchema = z.object({
  nombre:      texto(60),
  emoji:       z.string().min(1).max(16),
  frecuencia:  z.enum(["diario", "semanal", "mensual"]),
  hora:        z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish().transform((v) => v || null),
  lugar:       textoOpcional(60),
  dias_semana: z.array(z.enum(DIAS_SEMANA)).max(7).transform((d) => [...new Set(d)]),
  dia_mes:     z.number().int().min(1).max(31).nullable(),
});

export const habitoFijoTipoSchema = z.enum(["ejercicio", "alimentacion", "sueno", "medicamento", "hidratacion"]);
export const habitoRegistroTipoSchema = z.enum(["ejercicio", "habito_custom"]);

// ─── Recetas, mercado, rutinas ────────────────────────────────────────────────

/** Solo imágenes servidas por la propia app: nada de URLs externas ni data: */
export const imagenRecetaSchema = z
  .string()
  .regex(/^\/api\/img\/recetas\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}\.(png|jpe?g|webp)$/)
  .nullable();

export const recetaSchema = z.object({
  titulo:       texto(200),
  contenido:    texto(20_000),
  imagen_url:   imagenRecetaSchema,
  ingredientes: z.array(z.string().trim().min(1).max(120)).max(60),
});

export const calificacionSchema = z.number().int().min(0).max(5);

export const periodoSchema = z.enum(["semanal", "mensual"]);

export const listaMercadoSchema = z.object({
  nombre:    texto(120),
  periodo:   periodoSchema,
  contenido: texto(20_000),
});

const ejercicioSchema = z.object({
  bloque:      z.string().max(60),
  nombre:      z.string().max(120),
  detalle:     z.string().max(200),
  descanso:    z.number().int().min(0).max(3600),
  descripcion: z.string().max(500).optional(),
});

export const rutinaSchema = z.object({
  nombre: texto(200),
  contenido: z.object({
    texto:      texto(20_000),
    nivel:      z.string().max(100),
    tiempo:     z.string().max(100),
    lugar:      z.string().max(100),
    limitacion: z.string().max(100),
    metricas:   z.object({ sueno: z.number().optional(), estres: z.number().optional() }).optional(),
    ejercicios: z.array(ejercicioSchema).max(60).optional(),
  }),
});

// ─── Perfil ───────────────────────────────────────────────────────────────────

export const perfilSchema = z.object({
  edad:      z.number().int().min(18).max(120).nullable(),
  sexo:      z.enum(["m", "f", "otro"]).nullable(),
  altura_cm: z.number().int().min(100).max(250).nullable(),
  fumador:   z.boolean().nullable(),
});

// ─── Cuerpos de las rutas de IA ───────────────────────────────────────────────

/**
 * Historial de chat que manda el cliente. Solo `user` y `assistant`: sin esto
 * se podía colar un turno `system` y reescribir las reglas del asistente.
 */
const historialSchema = z
  .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8_000) }))
  .max(12)
  .default([]);

export const cuerpoRecetaSchema = z.object({ ingredientes: texto(500) });

export const cuerpoChatRecetaSchema = z.object({
  receta:    texto(8_000),
  pregunta:  texto(1_000),
  historial: historialSchema,
});

export const cuerpoImagenSchema = z.object({
  titulo:      texto(150).transform((t) => t.replace(/\s+/g, " ")),
  descripcion: z.string().trim().max(300).optional().transform((d) => d?.replace(/\s+/g, " ")),
});

export const cuerpoMercadoSchema = z.object({
  periodo:              periodoSchema,
  ingredientes_recetas: z.array(z.string().trim().max(120)).max(100).default([]),
  listas_anteriores:    z.array(z.object({ nombre: z.string().max(120), contenido: z.string().max(20_000) })).max(3).default([]),
  historial:            historialSchema,
  pregunta:             z.string().trim().max(1_000).optional(),
});

/** Las cuatro respuestas del cuestionario: valores cerrados, no texto libre. */
export const cuerpoRutinaSchema = z.object({
  nivel:      z.enum(valoresDe("nivel")),
  tiempo:     z.enum(valoresDe("tiempo")),
  lugar:      z.enum(valoresDe("lugar")),
  limitacion: z.enum(valoresDe("limitacion")),
});

// ─── Push ─────────────────────────────────────────────────────────────────────

const base64url = (max: number) => z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).max(max);

export const cuerpoSuscripcionSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(1_000).refine((u) => u.startsWith("https://"), "endpoint no https"),
    keys:     z.object({ p256dh: base64url(200), auth: base64url(100) }),
  }),
});

/**
 * La URL de la notificación tiene que ser una ruta interna. Antes se aceptaba
 * cualquiera, y un push con un enlace externo es phishing (plantilla, fila 4).
 */
export const rutaInternaSchema = z
  .string()
  .max(200)
  .regex(/^\/(?![/\\])[A-Za-z0-9/_\-?=&#.%]*$/);

export const cuerpoPushSchema = z.object({
  title: z.string().trim().max(60).optional(),
  body:  z.string().trim().max(180).optional(),
  url:   rutaInternaSchema.optional(),
});

export const cuerpoSesionSchema = z.object({
  legado: z.string().max(64).optional(),
});
