import "server-only";
import { pool } from "@/lib/db/pool";

/**
 * Límites de tasa (plantilla, fila 6). Sin esto, cualquiera podía llamar a los
 * endpoints de IA sin límite y agotar la cuota o disparar el costo del proyecto
 * (denegación de servicio económica).
 *
 * Se cuentan en Postgres (`pulso_consumir_tasa`) y no en memoria: sobreviven a
 * un redeploy y valdrían igual con varias réplicas.
 *
 * Cada límite va por sesión Y por IP: el de IP frena a quien crea sesiones
 * nuevas en loop para esquivar el de sesión.
 */

export interface Limite {
  clave:  string;
  max:    number;
  /** Duración de la ventana, en segundos. */
  ventana: number;
}

const HORA = 3600;

export const LIMITES = {
  /** Texto con Claude: recetas, chat, mercado, rutinas, análisis, tips. */
  ia:         { max: 40,  ventana: HORA },
  iaIp:       { max: 120, ventana: HORA },
  /** Imágenes con Gemini: lo más caro. */
  imagen:     { max: 8,   ventana: HORA },
  imagenIp:   { max: 24,  ventana: HORA },
  push:       { max: 20,  ventana: HORA },
  /** Sesiones nuevas por IP: frena la granja de sesiones. */
  sesionIp:   { max: 30,  ventana: HORA },
  /** Borrado total de datos: raro por definición. */
  supresion:  { max: 3,   ventana: HORA },
} as const;

export type NombreLimite = keyof typeof LIMITES;

export function limite(nombre: NombreLimite, sujeto: string): Limite {
  return { clave: `${nombre}:${sujeto}`, ...LIMITES[nombre] };
}

/** true si hay cupo. Consume una unidad de cada límite, en orden; corta en el primero agotado. */
export async function consumir(limites: Limite[]): Promise<{ ok: true } | { ok: false; clave: string }> {
  for (const l of limites) {
    const { rows } = await pool.query<{ ok: boolean }>(
      "select pulso_consumir_tasa($1, $2, $3) as ok",
      [l.clave, l.max, l.ventana]
    );
    if (!rows[0]?.ok) return { ok: false, clave: l.clave };
  }
  return { ok: true };
}
