import { extensionDe, type TipoExamen } from "./reglas";

/**
 * Nombres de archivo de los exámenes (integrador, punto 15).
 *
 * El nombre lo elige el cliente, así que se trata como texto hostil dos
 * veces: al guardarlo (se limpia y se cifra) y al servirlo en
 * `Content-Disposition` (se sanea de nuevo, con la extensión del tipo
 * DETECTADO: un PNG se baja como .png aunque se haya subido como otra cosa).
 */

/**
 * Deja una sola componente (sin carpetas), en NFC, sin caracteres de control
 * ni de formato y con los espacios colapsados. Los de formato (`\p{Cf}`)
 * incluyen U+202E, que invierte el texto: "examen" + U+202E + "fdp.exe" se ve como
 * "examenexe.pdf".
 */
export function limpiarNombre(crudo: string): string {
  const base = crudo.split(/[\\/]/).pop() ?? "";
  return base
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extensión que corresponde al tipo detectado. */
function extensionDelTipo(tipo: TipoExamen): string {
  return tipo === "pdf" ? "pdf" : tipo === "png" ? "png" : "jpg";
}

/**
 * Nombre para bajar el archivo: letras, números, espacio, `.`, `_`, `-` y
 * paréntesis; hasta 100 caracteres; y siempre con la extensión del tipo
 * detectado (.jpeg queda como .jpeg si el contenido es JPG).
 */
export function nombreParaDescarga(nombre: string, tipo: TipoExamen): string {
  const ext = extensionDe(nombre);
  const extOk = tipo === "jpg" ? ext === "jpg" || ext === "jpeg" : ext === extensionDelTipo(tipo);
  const base = (extOk ? nombre.slice(0, -(ext.length + 1)) : nombre)
    .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
    .replace(/^[.\s]+/, "")
    .slice(0, 100)
    .trim();
  return `${base || "examen"}.${extOk ? ext : extensionDelTipo(tipo)}`;
}

/**
 * Header `Content-Disposition` con el nombre en ASCII (para navegadores
 * viejos) y en UTF-8 (RFC 6266 / 5987). Ninguno de los dos puede traer
 * comillas, `\`, `;` ni saltos de línea: no se puede inyectar otro header ni
 * cortar el valor.
 */
export function contentDisposition(nombre: string, adjunto: boolean): string {
  const ascii = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ._()-]/g, "_");
  const utf8 = encodeURIComponent(nombre).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${adjunto ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
