import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
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

/**
 * Los archivos viejos viven en `recetas/{uid}/…`, así que la URL de una imagen
 * entregaba el uid, que era la credencial de la cuenta (plantilla, fila 7).
 * Los nuevos van en una carpeta derivada: un hash del uid, que no permite
 * volver al uid.
 */
export function carpetaDeUsuario(uid: string): string {
  return createHash("sha256").update(`pulso-media:${uid}`).digest("hex").slice(0, 32);
}

/** Carpetas de recetas que puede leer el dueño de `uid`: la vieja y la nueva. */
export function carpetasPermitidas(uid: string): string[] {
  return [uid, carpetaDeUsuario(uid)];
}

/** Máximo que se acepta guardar por imagen. */
const MAX_IMAGEN = 8 * 1024 * 1024;

/**
 * Detecta el formato por los primeros bytes, sin creerle al mime que viene
 * declarado: un "image/png" puede traer cualquier cosa adentro.
 */
function extPorFirma(b: Buffer): string | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ".jpg";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return ".webp";
  return null;
}

/**
 * Guarda una imagen de receta y devuelve su URL pública (servida por /api/img,
 * que exige la sesión del dueño), o null si los bytes no son una imagen válida.
 * El nombre es aleatorio: no se puede adivinar ni enumerar.
 */
export async function guardarImagenReceta(uid: string, bytes: Buffer): Promise<string | null> {
  if (bytes.length === 0 || bytes.length > MAX_IMAGEN) return null;
  const ext = extPorFirma(bytes);
  if (!ext) return null;

  const carpeta = carpetaDeUsuario(uid);
  const nombre = randomBytes(16).toString("hex") + ext;
  const destino = rutaDentroDeMedia([RECETAS_SUBDIR, carpeta, nombre]);
  if (!destino) return null;

  await mkdir(path.dirname(destino), { recursive: true });
  await writeFile(destino, bytes, { mode: 0o600 });
  return `/api/img/${RECETAS_SUBDIR}/${carpeta}/${nombre}`;
}

/** Supresión: borra las carpetas de imágenes del usuario (la vieja y la nueva). */
export async function borrarImagenesDe(uid: string): Promise<void> {
  for (const carpeta of carpetasPermitidas(uid)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(carpeta)) continue;
    const dir = rutaDentroDeMedia([RECETAS_SUBDIR, carpeta]);
    if (dir) await rm(dir, { recursive: true, force: true });
  }
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
