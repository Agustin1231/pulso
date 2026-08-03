import "server-only";
import path from "node:path";

/**
 * Directorio donde viven los archivos subidos (antes: Supabase Storage).
 *
 * En producción apuntá `MEDIA_DIR` a un volumen persistente de Coolify
 * (ej. `/data`), o los archivos se pierden en cada deploy. En dev cae a
 * `./.data`, que está gitignoreado.
 */
export const MEDIA_DIR = path.resolve(
  process.env.MEDIA_DIR ?? path.join(process.cwd(), ".data")
);

export const RECETAS_SUBDIR = "recetas";

/** Extensiones que aceptamos servir, con su Content-Type. */
export const MIME_POR_EXT: Record<string, string> = {
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** Devuelve la extensión que le corresponde a un mime type, o null. */
export function extPorMime(mime: string): string | null {
  const entrada = Object.entries(MIME_POR_EXT).find(([, m]) => m === mime);
  return entrada?.[0] ?? null;
}

/**
 * El uid es un UUID anónimo generado en el cliente y se usa como componente de
 * ruta en disco, así que hay que validarlo antes de tocar el filesystem.
 */
export function uidSeguro(uid: string): string | null {
  return /^[A-Za-z0-9_-]{1,64}$/.test(uid) ? uid : null;
}

/**
 * Resuelve segmentos de ruta dentro de MEDIA_DIR y devuelve null si el
 * resultado escapa del directorio base (`..`, rutas absolutas, etc.).
 */
export function rutaDentroDeMedia(segmentos: string[]): string | null {
  if (segmentos.some((s) => !s || s === "." || s === "..")) return null;
  const destino = path.resolve(MEDIA_DIR, ...segmentos);
  if (destino !== MEDIA_DIR && !destino.startsWith(MEDIA_DIR + path.sep)) return null;
  return destino;
}
