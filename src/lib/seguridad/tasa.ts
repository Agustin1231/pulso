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
  /** Registrar o quitar passkeys del bloqueo. */
  passkey:    { max: 20,  ventana: HORA },
  passkeyIp:  { max: 60,  ventana: HORA },
  /** Intentos de desbloqueo: una passkey no se adivina, pero igual se acota. */
  desbloqueo:   { max: 30, ventana: HORA },
  desbloqueoIp: { max: 90, ventana: HORA },
  /**
   * Escrituras de datos (server actions y API móvil, AM-21): un uso normal son
   * unas decenas por día. Sin esto, una sesión podía escribir sin freno y, con
   * las cuotas de filas, el límite acota también cuánto crece la auditoría.
   */
  escritura:   { max: 300,  ventana: HORA },
  escrituraIp: { max: 1200, ventana: HORA },
  /**
   * Cuentas con correo y contraseña. `login` y `recuperacion` van por correo
   * (un hash, no el correo): frenan adivinar la contraseña de una cuenta y que
   * la recuperación sirva para llenarle la bandeja a alguien.
   */
  registro:       { max: 5,  ventana: HORA },
  registroIp:     { max: 20, ventana: HORA },
  login:          { max: 10, ventana: HORA },
  loginIp:        { max: 30, ventana: HORA },
  recuperacion:   { max: 3,  ventana: HORA },
  recuperacionIp: { max: 10, ventana: HORA },
  reenvio:        { max: 3,  ventana: HORA },
  /** Activar la cuenta o restablecer la contraseña con el token del correo. */
  enlaceIp:       { max: 30, ventana: HORA },
  /**
   * Exámenes médicos (integrador, punto 15): subir y borrar. Cada subida
   * puede traer 10 MB que el servidor lee, revisa y cifra; también cuentan las
   * rechazadas, así que probar archivos en loop tiene un techo.
   */
  examen:         { max: 30, ventana: HORA },
  examenIp:       { max: 90, ventana: HORA },
} as const;

export type NombreLimite = keyof typeof LIMITES;

export function limite(nombre: NombreLimite, sujeto: string): Limite {
  // `nombre` es una clave literal de LIMITES en cada llamada (tipo NombreLimite): no viene del cliente.
  // eslint-disable-next-line security/detect-object-injection -- clave constante tipada
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
