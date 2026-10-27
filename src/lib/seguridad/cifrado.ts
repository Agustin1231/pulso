import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

/**
 * Cifrado de datos sensibles en reposo (plantilla, fila 19): el correo de la
 * cuenta, los datos de salud y los archivos de exámenes.
 *
 * AES-256-GCM con la clave maestra `PULSO_CLAVE_DATOS` (32 bytes en base64),
 * que vive solo en el entorno de la app: un volcado de la base o del volumen
 * de medios no alcanza para leer nada. De la maestra salen, con HKDF, una
 * clave para cifrar y otra para los índices ciegos, así una no revela la otra.
 *
 * Cada valor se cifra con un IV aleatorio y lleva como dato asociado su
 * `contexto` (ej. "cuentas.email"): un valor copiado a otra columna no se
 * descifra.
 *
 * Formato del texto cifrado: `v1.` + base64url(iv de 12 bytes | tag de 16 | datos).
 *
 * No importa "server-only" porque también la usan los scripts de node
 * (migraciones, seed). En el browser no hay `node:crypto` ni la clave.
 */

const VERSION = "v1";
const IV = 12;
const TAG = 16;

let claves: { cifrado: Buffer; indice: Buffer } | null = null;

function obtenerClaves(): { cifrado: Buffer; indice: Buffer } {
  if (claves) return claves;
  const base64 = process.env.PULSO_CLAVE_DATOS;
  if (!base64) throw new Error("Falta PULSO_CLAVE_DATOS (32 bytes en base64)");
  const maestra = Buffer.from(base64, "base64");
  if (maestra.length !== 32) throw new Error("PULSO_CLAVE_DATOS tiene que ser de 32 bytes en base64");
  const derivar = (uso: string) => Buffer.from(hkdfSync("sha256", maestra, Buffer.alloc(0), `pulso:${uso}`, 32));
  claves = { cifrado: derivar("cifrado"), indice: derivar("indice") };
  return claves;
}

/** Cifra bytes. `contexto` identifica dónde se guardan (columna o tipo de archivo). */
export function cifrarBytes(datos: Buffer, contexto: string): Buffer {
  const iv = randomBytes(IV);
  const cipher = createCipheriv("aes-256-gcm", obtenerClaves().cifrado, iv);
  cipher.setAAD(Buffer.from(contexto, "utf8"));
  const cifrado = Buffer.concat([cipher.update(datos), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), cifrado]);
}

/** Descifra lo que produjo `cifrarBytes` con el mismo contexto. Tira si se alteró o no coincide. */
export function descifrarBytes(datos: Buffer, contexto: string): Buffer {
  if (datos.length < IV + TAG) throw new Error("Dato cifrado incompleto");
  const decipher = createDecipheriv("aes-256-gcm", obtenerClaves().cifrado, datos.subarray(0, IV));
  decipher.setAAD(Buffer.from(contexto, "utf8"));
  decipher.setAuthTag(datos.subarray(IV, IV + TAG));
  return Buffer.concat([decipher.update(datos.subarray(IV + TAG)), decipher.final()]);
}

/** Cifra un texto para guardarlo en una columna `text`. */
export function cifrar(texto: string, contexto: string): string {
  return `${VERSION}.${cifrarBytes(Buffer.from(texto, "utf8"), contexto).toString("base64url")}`;
}

/** Descifra un valor de `cifrar` con el mismo contexto. */
export function descifrar(valor: string, contexto: string): string {
  const [version, datos] = valor.split(".", 2);
  if (version !== VERSION || !datos) throw new Error("Formato de dato cifrado desconocido");
  return descifrarBytes(Buffer.from(datos, "base64url"), contexto).toString("utf8");
}

/**
 * Índice ciego: HMAC-SHA256 del valor, en hex. Sirve para buscar o exigir
 * unicidad sobre un dato cifrado (el correo) sin guardarlo en claro. Normalizá
 * el valor antes (ej. el correo en minúsculas y sin espacios).
 */
export function indiceCiego(valor: string, contexto: string): string {
  return createHmac("sha256", obtenerClaves().indice).update(`${contexto}:${valor}`).digest("hex");
}
