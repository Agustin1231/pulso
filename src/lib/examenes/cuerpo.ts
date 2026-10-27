import "server-only";
import { CuerpoDemasiadoGrande } from "@/lib/seguridad/ruta";

/**
 * Lectura del archivo subido (integrador, punto 15).
 *
 * El navegador manda el archivo tal cual como cuerpo de la petición (no
 * multipart) y el nombre en el header `X-Nombre-Archivo`. Así no hace falta
 * ninguna librería, y el tamaño se controla igual que en `leerJson`
 * (lib/seguridad/ruta.ts): se rechaza por `Content-Length` sin leer un byte y,
 * si no viene o miente (subida en chunks), se corta en el primer byte de más.
 * Nunca hay en memoria más de `max` bytes de un mismo archivo.
 */

/** El cliente cortó la subida a la mitad. */
export class SubidaIncompleta extends Error {
  constructor() {
    super("Subida incompleta");
    this.name = "SubidaIncompleta";
  }
}

/** Tamaño que declara la petición, o null si no lo declara. */
export function tamanoDeclarado(req: Request): number | null {
  const n = Number(req.headers.get("content-length") ?? NaN);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function leerCuerpoBinario(req: Request, max: number): Promise<Buffer> {
  const declarado = tamanoDeclarado(req);
  if (declarado !== null && declarado > max) {
    await req.body?.cancel().catch(() => {});
    throw new CuerpoDemasiadoGrande();
  }
  if (!req.body) return Buffer.alloc(0);

  const lector = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await lector.cancel().catch(() => {});
        throw new CuerpoDemasiadoGrande();
      }
      partes.push(value);
    }
  } catch (err) {
    if (err instanceof CuerpoDemasiadoGrande) throw err;
    throw new SubidaIncompleta();
  }
  return Buffer.concat(partes, total);
}
