// Lector del formato SAS Transport (XPORT) versión 5, en el que el CDC publica
// los archivos de NHANES (.xpt). Implementado desde cero sobre la especificación
// pública del formato (SAS Institute, TS-140): registros de 80 bytes, descriptores
// de variable ("namestr") de 140 bytes y números en coma flotante IBM de base 16.

export interface VariableXPT {
  nombre: string;
  etiqueta: string;
  tipo: "numerica" | "caracter";
  longitud: number;
  posicion: number;
}

export interface TablaXPT {
  dataset: string;
  variables: VariableXPT[];
  /** Una fila por observación; los faltantes de SAS (`.`, `.A`…`.Z`, `._`) son `null`. */
  filas: Record<string, number | string | null>[];
}

const REGISTRO = 80;
const texto = (b: Uint8Array, desde: number, largo: number) =>
  String.fromCharCode(...b.subarray(desde, desde + largo)).replace(/\s+$/, "");

/**
 * Convierte un número IBM de hasta 8 bytes (big-endian) a double.
 * Signo en el bit 63, exponente en base 16 con exceso 64 en los bits 62–56 y
 * mantisa fraccionaria en los 56 bits restantes: v = ±0.m · 16^(e−64).
 */
export function ibmADouble(b: Uint8Array, desde: number, largo: number): number | null {
  const primero = b[desde];
  let resto = 0;
  for (let i = 1; i < largo; i++) resto |= b[desde + i];
  // Faltantes: primer byte '.', 'A'…'Z' o '_' y el resto en cero.
  if (resto === 0 && (primero === 0x2e || primero === 0x5f || (primero >= 0x41 && primero <= 0x5a))) return null;
  if (primero === 0 && resto === 0) return 0;

  const signo = primero & 0x80 ? -1 : 1;
  const exponente = (primero & 0x7f) - 64;
  // Mantisa: 7 bytes → se arman dos mitades para no perder precisión en 53 bits.
  let alta = 0;
  let baja = 0;
  for (let i = 1; i < 8; i++) {
    const byte = i < largo ? b[desde + i] : 0;
    if (i <= 3) alta = alta * 256 + byte;
    else baja = baja * 256 + byte;
  }
  const mantisa = alta / 2 ** 24 + baja / 2 ** 56;
  return signo * mantisa * 16 ** exponente;
}

/** Parsea el primer (y en NHANES único) miembro de un archivo XPORT v5. */
export function leerXPT(bytes: Uint8Array): TablaXPT {
  const cabecera = (offset: number, esperado: string) => {
    const t = texto(bytes, offset, REGISTRO);
    if (!t.startsWith(`HEADER RECORD*******${esperado}`)) {
      throw new Error(`XPT inválido: se esperaba ${esperado} en el byte ${offset}`);
    }
    return t;
  };

  let o = 0;
  cabecera(o, "LIBRARY HEADER RECORD");
  o += 3 * REGISTRO; // cabecera + 2 registros de metadatos de la librería

  const miembro = cabecera(o, "MEMBER  HEADER RECORD");
  const largoNamestr = Number(miembro.slice(74, 78)); // 140 (136 en VAX/VMS)
  o += REGISTRO;
  cabecera(o, "DSCRPTR HEADER RECORD");
  o += REGISTRO;
  const dataset = texto(bytes, o + 8, 8);
  o += 2 * REGISTRO;

  const namestr = cabecera(o, "NAMESTR HEADER RECORD");
  const nVariables = Number(namestr.slice(54, 58));
  o += REGISTRO;

  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const variables: VariableXPT[] = [];
  for (let i = 0; i < nVariables; i++) {
    const d = o + i * largoNamestr;
    variables.push({
      tipo: vista.getInt16(d) === 1 ? "numerica" : "caracter",
      longitud: vista.getInt16(d + 4),
      nombre: texto(bytes, d + 8, 8),
      etiqueta: texto(bytes, d + 16, 40),
      posicion: vista.getInt32(d + 84),
    });
  }
  o += Math.ceil((nVariables * largoNamestr) / REGISTRO) * REGISTRO;

  cabecera(o, "OBS     HEADER RECORD");
  o += REGISTRO;

  const largoFila = variables.reduce((s, v) => s + v.longitud, 0);
  const filas: TablaXPT["filas"] = [];
  for (; o + largoFila <= bytes.length; o += largoFila) {
    // El último registro se rellena con espacios hasta completar 80 bytes.
    let soloEspacios = true;
    for (let i = 0; i < largoFila; i++) if (bytes[o + i] !== 0x20) { soloEspacios = false; break; }
    if (soloEspacios) break;

    const fila: Record<string, number | string | null> = {};
    for (const v of variables) {
      fila[v.nombre] = v.tipo === "numerica"
        ? ibmADouble(bytes, o + v.posicion, v.longitud)
        : texto(bytes, o + v.posicion, v.longitud);
    }
    filas.push(fila);
  }
  return { dataset, variables, filas };
}
