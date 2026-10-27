import { z } from "zod";
import { limpiarNombre } from "./nombres";

/**
 * Esquemas zod del módulo de exámenes (integrador, punto 15). Viven acá y no
 * en lib/seguridad/validacion.ts para que el módulo quede entero en su carpeta.
 */

/** Id de un examen en la URL: `/api/examenes/{id}`. */
export const idExamenSchema = z.string().uuid();

/**
 * Nombre del archivo que manda el navegador en `X-Nombre-Archivo`, ya
 * decodificado (va con `encodeURIComponent`: un header no admite UTF-8). Se
 * limpia antes de medirlo: queda una sola componente, sin control ni formato.
 */
export const nombreArchivoSchema = z
  .string()
  .max(1024)
  .transform(limpiarNombre)
  .pipe(z.string().min(1).max(200));

/** `?descargar=1` baja el archivo; sin él, el navegador lo muestra. */
export const descargarSchema = z.enum(["1"]).optional();
