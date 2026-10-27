import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { cifrarBytes, descifrarBytes } from "@/lib/seguridad/cifrado";

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

  // La ruta la arma el servidor (hash del uid + nombre aleatorio) y pasa por
  // rutaDentroDeMedia: nada del cliente llega acá.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta generada por el servidor y validada
  await mkdir(path.dirname(destino), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ídem
  await writeFile(destino, bytes, { mode: 0o600 });
  return `/api/img/${RECETAS_SUBDIR}/${carpeta}/${nombre}`;
}

/** Supresión: borra las carpetas de imágenes del usuario (la vieja y la nueva). */
export async function borrarImagenesDe(uid: string): Promise<void> {
  for (const carpeta of carpetasPermitidas(uid)) {
    if (!CARPETA_RE.test(carpeta)) continue;
    const dir = rutaDentroDeMedia([RECETAS_SUBDIR, carpeta]);
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Al iniciar sesión, los datos anónimos del equipo se suman a la cuenta
 * (`pulso_fusionar_identidad`). La base ya reescribió las URLs de las recetas
 * a la carpeta de la cuenta; acá se mueven los archivos.
 */
export async function moverImagenes(de: string, a: string): Promise<void> {
  const destino = rutaDentroDeMedia([RECETAS_SUBDIR, carpetaDeUsuario(a)]);
  if (!destino) return;
  for (const carpeta of carpetasPermitidas(de)) {
    if (!CARPETA_RE.test(carpeta)) continue;
    const origen = rutaDentroDeMedia([RECETAS_SUBDIR, carpeta]);
    if (!origen) continue;
    let archivos: string[];
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta generada por el servidor y validada
      archivos = await readdir(origen);
    } catch {
      continue; // esa identidad no tenía imágenes en esta carpeta
    }
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ídem
    await mkdir(destino, { recursive: true });
    for (const archivo of archivos) {
      if (!ARCHIVO_IMAGEN_RE.test(archivo)) continue;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ídem, y el nombre pasó ARCHIVO_IMAGEN_RE
      await rename(path.join(origen, archivo), path.join(destino, archivo));
    }
    await rm(origen, { recursive: true, force: true });
  }
}

/**
 * Nombres válidos de carpeta y de archivo de imagen: los mismos que acepta
 * `imagenRecetaSchema` al guardar una receta. Una sola componente de ruta, sin
 * separadores ni puntos sueltos.
 */
export const CARPETA_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const ARCHIVO_IMAGEN_RE = /^[A-Za-z0-9_-]{1,64}\.(png|jpe?g|webp)$/;

/**
 * Resuelve segmentos de ruta dentro de MEDIA_DIR y devuelve null si el
 * resultado escapa del directorio base (`..`, rutas absolutas, etc.).
 *
 * Cada segmento tiene que ser UNA componente: Next decodifica `%2F` dentro de
 * un segmento del catch-all, así que `..%2Fotra-carpeta%2Ffoto.png` llegaba
 * como un solo segmento con barras, `path.resolve` lo interpretaba como ruta y
 * salía de la carpeta del dueño sin salir de MEDIA_DIR (SAST-BE-09). Se
 * rechaza cualquier separador (también `\`) y el byte nulo.
 */
export function rutaDentroDeMedia(segmentos: string[]): string | null {
  if (segmentos.some((s) => !s || s === "." || s === ".." || /[/\\\0]/.test(s))) return null;
  const destino = path.resolve(MEDIA_DIR, ...segmentos);
  if (destino !== MEDIA_DIR && !destino.startsWith(MEDIA_DIR + path.sep)) return null;
  return destino;
}

// ─── Exámenes médicos (integrador, punto 15) ──────────────────────────────────
// Cada examen es un archivo `examenes/<archivo>` con un nombre de 128 bits
// aleatorios: la ruta no depende del uid (a diferencia de las recetas), así
// que la fusión de identidad no mueve nada y nadie puede deducir de quién es
// un archivo mirando el disco. El contenido va cifrado con AES-256-GCM
// (lib/seguridad/cifrado.ts): un respaldo del volumen no alcanza para leer un
// examen, y un archivo alterado o cambiado por otro no se descifra.

export const EXAMENES_SUBDIR = "examenes";
/** Nombre en disco de un examen: el mismo `check` tiene `examenes.archivo`. */
export const ARCHIVO_EXAMEN_RE = /^[0-9a-f]{32}$/;
const CONTEXTO_EXAMEN = "examenes.archivo";

/** Nombre aleatorio para el archivo de un examen nuevo. */
export function nuevoArchivoExamen(): string {
  return randomBytes(16).toString("hex");
}

function rutaExamen(archivo: string): string | null {
  return ARCHIVO_EXAMEN_RE.test(archivo) ? rutaDentroDeMedia([EXAMENES_SUBDIR, archivo]) : null;
}

/** Cifra y guarda un examen. Nunca pisa un archivo existente (`wx`). */
export async function guardarArchivoExamen(archivo: string, bytes: Buffer): Promise<void> {
  const destino = rutaExamen(archivo);
  if (!destino) throw new Error("Nombre de archivo de examen inválido");
  // La ruta la arma el servidor (nombre aleatorio validado por la regex) y
  // pasa por rutaDentroDeMedia: nada del cliente llega acá.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta generada por el servidor y validada
  await mkdir(path.dirname(destino), { recursive: true, mode: 0o700 });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ídem
  await writeFile(destino, cifrarBytes(bytes, CONTEXTO_EXAMEN), { mode: 0o600, flag: "wx" });
}

/**
 * Lee y descifra un examen. null si el archivo no está; tira si está
 * alterado (la etiqueta de GCM no coincide).
 */
export async function leerArchivoExamen(archivo: string): Promise<Buffer | null> {
  const origen = rutaExamen(archivo);
  if (!origen) return null;
  let cifrado: Buffer;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta generada por el servidor y validada
    cifrado = await readFile(origen);
  } catch (err) {
    if ((err as { code?: unknown }).code === "ENOENT") return null;
    throw err;
  }
  return descifrarBytes(cifrado, CONTEXTO_EXAMEN);
}

/** Borra los archivos de estos exámenes (los que no existan se ignoran). */
export async function borrarArchivosExamen(archivos: readonly string[]): Promise<void> {
  for (const archivo of archivos) {
    const ruta = rutaExamen(archivo);
    if (ruta) await rm(ruta, { force: true });
  }
}
