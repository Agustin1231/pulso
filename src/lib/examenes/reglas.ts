/**
 * Reglas del módulo de exámenes (integrador, punto 15), compartidas por el
 * servidor y el navegador. El navegador las usa solo para avisar antes de
 * subir (tamaño y extensión) con el mismo texto: quien decide es el servidor,
 * que además revisa el contenido real del archivo (src/lib/examenes/firma.ts).
 *
 * Sin imports de node: este archivo también va al bundle del cliente.
 */

export type TipoExamen = "pdf" | "jpg" | "png";

/** Un examen como lo ve el cliente (GET /api/examenes). El nombre ya descifrado. */
export interface Examen {
  id:         string;
  nombre:     string;
  tipo:       TipoExamen;
  bytes:      number;
  created_at: string;
}

/** Uso de la cuota del usuario. */
export interface CuotaExamenes {
  examenes:    number;
  maxExamenes: number;
  bytes:       number;
  maxBytes:    number;
}

/** Máximo por archivo: 10 MB. El mismo `check` tiene la columna `examenes.bytes`. */
export const MAX_BYTES_EXAMEN = 10 * 1024 * 1024;

/** Cuota por usuario: los mismos números que el trigger de db/examenes.sql. */
export const MAX_EXAMENES = 50;
export const MAX_BYTES_USUARIO = 100 * 1024 * 1024;

/** Extensiones aceptadas y el tipo que tiene que tener su contenido. */
const TIPO_POR_EXTENSION = new Map<string, TipoExamen>([
  ["pdf", "pdf"],
  ["jpg", "jpg"],
  ["jpeg", "jpg"],
  ["png", "png"],
]);

/** Valor de `accept` del selector de archivos: filtra el diálogo, no protege nada. */
export const ACCEPT_EXAMEN = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

/** Extensión en minúsculas, sin el punto, o "" si no tiene. */
export function extensionDe(nombre: string): string {
  const i = nombre.lastIndexOf(".");
  return i > 0 ? nombre.slice(i + 1).toLowerCase() : "";
}

/** Tipo que corresponde a la extensión del nombre, o null si no se acepta. */
export function tipoPorExtension(nombre: string): TipoExamen | null {
  return TIPO_POR_EXTENSION.get(extensionDe(nombre)) ?? null;
}

/** Content-Type con el que se sirve cada tipo (el detectado, nunca el declarado). */
export function mimeDe(tipo: TipoExamen): string {
  switch (tipo) {
    case "pdf": return "application/pdf";
    case "jpg": return "image/jpeg";
    case "png": return "image/png";
  }
}

/** Nombre para mostrar: "PDF", "JPG", "PNG". */
export function nombreTipo(tipo: TipoExamen): string {
  return tipo.toUpperCase();
}

/** "2,4 MB", "350 KB". */
export function formatearBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024).toLocaleString("es-CO")} KB`;
  return `${bytes} B`;
}

/**
 * Motivos de rechazo de una subida. Son el `error` de la respuesta y el
 * `motivo` en la auditoría (`examen.subir`, resultado 'denegado').
 */
export type MotivoRechazo =
  | "nombre_invalido"
  | "extension_no_permitida"
  | "archivo_demasiado_grande"
  | "archivo_vacio"
  | "archivo_ejecutable"
  | "firma_no_coincide"
  | "pdf_con_contenido_activo"
  | "pdf_no_verificable"
  | "cuota_excedida"
  | "subida_incompleta";

/** Mensaje para el usuario de cada motivo (el servidor lo manda en `mensaje`). */
export function mensajeRechazo(motivo: MotivoRechazo): string {
  switch (motivo) {
    case "nombre_invalido":
      return "El nombre del archivo no es válido.";
    case "extension_no_permitida":
      return "Solo se aceptan archivos PDF, JPG o PNG (.pdf, .jpg, .jpeg o .png).";
    case "archivo_demasiado_grande":
      return `El archivo pesa más de ${formatearBytes(MAX_BYTES_EXAMEN)}, el máximo permitido.`;
    case "archivo_vacio":
      return "El archivo está vacío.";
    case "archivo_ejecutable":
      return "El archivo es un programa ejecutable con la extensión cambiada. Solo se aceptan PDF, JPG o PNG reales.";
    case "firma_no_coincide":
      return "El contenido del archivo no corresponde a su extensión. Solo se aceptan PDF, JPG o PNG reales.";
    case "pdf_con_contenido_activo":
      return "El PDF tiene contenido activo (JavaScript, acciones que abren programas o archivos incrustados) y " +
        "por seguridad no se acepta. Guárdalo de nuevo con «Imprimir como PDF» y vuelve a subirlo.";
    case "pdf_no_verificable":
      return "No se pudo revisar el contenido del PDF (está protegido o usa un formato que no podemos " +
        "inspeccionar). Guárdalo de nuevo con «Imprimir como PDF» y vuelve a subirlo.";
    case "cuota_excedida":
      return `Llegaste al máximo de ${MAX_EXAMENES} exámenes guardados. Borra alguno para subir otro.`;
    case "subida_incompleta":
      return "La subida se cortó antes de terminar. Intenta de nuevo.";
  }
}

/** Mensaje cuando el contenido es de otro tipo aceptado (ej. un JPG con extensión .pdf). */
export function mensajeFirmaDistinta(detectado: TipoExamen, extension: string): string {
  return (
    `El archivo es en realidad un ${nombreTipo(detectado)}, pero su extensión es .${extension}. ` +
    "Solo se aceptan archivos cuya extensión coincide con su contenido."
  );
}

export const MENSAJE_CUOTA_BYTES =
  `Tus exámenes ya ocupan casi ${formatearBytes(MAX_BYTES_USUARIO)}, el máximo por usuario. Borra alguno para subir este.`;
