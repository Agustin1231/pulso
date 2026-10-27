import { constants, inflateSync } from "node:zlib";
import {
  mensajeFirmaDistinta,
  mensajeRechazo,
  type MotivoRechazo,
  type TipoExamen,
} from "./reglas";

/**
 * Revisión del contenido de un examen subido (integrador, punto 15).
 *
 * No se le cree a la extensión ni al MIME que declara el navegador: los dos
 * los elige quien sube. Lo que manda es la FIRMA de los primeros bytes, que es
 * lo que mira el sistema operativo o el visor para decidir qué es el archivo:
 *   PDF  `%PDF-`
 *   JPG  `FF D8 FF` + un marcador
 *   PNG  `89 50 4E 47 0D 0A 1A 0A` + el bloque IHDR
 * y tiene que coincidir con la extensión. Los ejecutables se detectan aparte
 * (`MZ`, `\x7fELF`, Mach-O, `#!`) para decirle al usuario qué pasó: un .exe
 * renombrado a .pdf no "parece un PDF dañado", es un programa.
 *
 * Además, un PDF puede ejecutar código o traer otros archivos adentro: se
 * rechazan los que tienen JavaScript, acciones Launch (abrir un programa),
 * archivos incrustados, RichMedia o Rendition (multimedia con scripts) o
 * formularios XFA (llevan scripts). Ver `revisarPdf`.
 *
 * Sin "server-only" (como lib/seguridad/cifrado.ts) para poder probarlo con
 * node; usa `node:zlib`, así que no puede terminar en el bundle del cliente.
 */

export type Revision =
  | { ok: true; tipo: TipoExamen }
  | { ok: false; motivo: MotivoRechazo; mensaje: string; detalle: Record<string, unknown> };

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Tipo aceptado según los primeros bytes, o null. */
export function tipoPorFirma(b: Buffer): TipoExamen | null {
  if (b.length >= 8 && b.toString("latin1", 0, 5) === "%PDF-") return "pdf";
  // Después de FF D8 (inicio de imagen) viene siempre otro marcador: FF y un byte de C0 a FE.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[3] >= 0xc0 && b[3] <= 0xfe) return "jpg";
  // El primer bloque de un PNG es siempre IHDR, de 13 bytes.
  if (b.length >= 16 && b.subarray(0, 8).equals(FIRMA_PNG) && b.readUInt32BE(8) === 13 && b.toString("latin1", 12, 16) === "IHDR") {
    return "png";
  }
  return null;
}

/** Magias de Mach-O (32/64 bits, las dos endianness) y del binario universal. */
const MACH_O = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe]);

/** Clase de ejecutable según los primeros bytes, o null. */
export function ejecutablePorFirma(b: Buffer): string | null {
  if (b.length >= 2 && b[0] === 0x4d && b[1] === 0x5a) return "windows_pe"; // MZ: .exe, .dll, .scr
  if (b.length >= 4 && b.readUInt32BE(0) === 0x7f454c46) return "linux_elf"; // \x7fELF: Linux y Android
  if (b.length >= 4 && MACH_O.has(b.readUInt32BE(0))) return "macos_mach_o";
  if (b.length >= 2 && b[0] === 0x23 && b[1] === 0x21) return "script"; // #!/bin/sh, #!/usr/bin/env python…
  return null;
}

/** Para la auditoría: qué parece ser un archivo que no es PDF, JPG, PNG ni ejecutable. */
function formatoAjeno(b: Buffer): string {
  const inicio = b.toString("latin1", 0, Math.min(b.length, 16));
  if (inicio.startsWith("PK\x03\x04")) return "zip";
  if (inicio.startsWith("GIF87a") || inicio.startsWith("GIF89a")) return "gif";
  if (inicio.startsWith("RIFF") && inicio.slice(8, 12) === "WEBP") return "webp";
  if (b.length >= 8 && b.readUInt32BE(0) === 0xd0cf11e0) return "ole"; // .doc/.xls/.msi viejos
  if (/^\s*</.test(inicio)) return "html_xml";
  return "desconocido";
}

// ─── PDF ──────────────────────────────────────────────────────────────────────
//
// Un PDF es una lista de objetos (`12 0 obj … endobj`) que el visor encuentra
// por su posición en la tabla xref. Las acciones se declaran con NOMBRES:
// `/S /JavaScript /JS (código)`, `/S /Launch`, `/Type /EmbeddedFile`… Así que
// buscar esos nombres alcanza, con tres cuidados:
//
//   1. Un nombre se puede escribir con escapes: `/J#61vaScript` es
//      `/JavaScript`. Se decodifican antes de comparar.
//   2. Desde PDF 1.5 los objetos pueden ir COMPRIMIDOS dentro de un stream de
//      objetos (`/Type /ObjStm`). Esos se inflan (con tope, contra las bombas
//      de compresión) y se revisan enteros. Uno que no se puede inflar (otro
//      filtro, un predictor, cifrado, datos rotos) se rechaza: lo que no se
//      puede revisar no se acepta.
//   3. No se puede confiar en "lo que parece" el contenido de un stream: un
//      atacante puede esconder un objeto dentro de los datos de otro stream y
//      apuntarle desde la xref. Por eso:
//        - los nombres largos (`/JavaScript`, `/Launch`…) se buscan en TODO
//          el archivo: que aparezcan por azar en datos binarios es
//          despreciable (6 o más bytes exactos y un delimitador);
//        - cada aparición de la palabra `obj` en el archivo, esté donde esté,
//          se lee como un objeto con un analizador léxico de verdad (cadenas,
//          comentarios, diccionarios anidados): `/JS`, que es corto y sí
//          aparece por azar en una imagen comprimida, cuenta solo dentro de
//          un objeto así leído. Y si ese objeto es un stream de objetos, se
//          infla y se revisa.

/** Nombres que ejecutan código, abren programas o traen archivos adentro. */
const ACTIVOS = new Set(["JavaScript", "JS", "Launch", "EmbeddedFile", "EmbeddedFiles", "RichMedia", "Rendition", "XFA"]);
/** Los que se buscan en todo el archivo (ver 3): todos menos `/JS`. */
const ACTIVOS_LARGOS = new Set([...ACTIVOS].filter((n) => n.length >= 3));

/** Un nombre PDF: `/` y caracteres regulares (todo menos espacio y delimitadores). */
const RE_NOMBRE = /\/([^\x00\t\n\f\r ()<>[\]{}/%]*)/g;
/** La palabra `obj` (no `endobj`): empieza un objeto. */
const RE_OBJ = /(?<![A-Za-z])obj(?![A-Za-z0-9])/g;

/** Los visores aceptan `#xx` dentro de un nombre: `/J#61vaScript` es `/JavaScript`. */
function decodificarNombre(crudo: string): string {
  return crudo.includes("#")
    ? crudo.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    : crudo;
}

function nombresDe(texto: string): string[] {
  return Array.from(texto.matchAll(RE_NOMBRE), (m) => decodificarNombre(m[1]));
}

const MAX_INFLADO_STREAM = 16 * 1024 * 1024;
const MAX_INFLADO_TOTAL = 48 * 1024 * 1024;
/**
 * Topes de trabajo: tokens leídos, bytes recorridos (sumando todos los
 * objetos: un archivo con un millón de `obj (` sin cerrar haría que cada uno
 * recorra hasta el final) y anidamiento. Un PDF real queda muy por debajo; uno
 * armado para colgar al servidor se rechaza en milisegundos.
 */
const MAX_PASOS = 5_000_000;
const MAX_RECORRIDO = 64 * 1024 * 1024;
const MAX_PROFUNDIDAD = 64;

class NoVerificable extends Error {
  readonly causa: string;
  constructor(causa: string) {
    super(causa);
    this.causa = causa;
  }
}

type Valor =
  | { t: "nombre"; v: string }
  | { t: "numero"; v: number }
  | { t: "ref" }
  | { t: "arreglo"; v: Valor[] }
  | { t: "dicc"; v: Map<string, Valor> }
  | { t: "otro" };

const OTRO: Valor = { t: "otro" };
const ESPACIO = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITADOR = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const NUMERO_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** Analizador léxico mínimo de la sintaxis de objetos de PDF (ISO 32000, 7.2 y 7.3). */
class Lector {
  i = 0;
  pasos = 0;
  /** Todos los nombres leídos, a cualquier profundidad. */
  nombres: string[] = [];
  readonly b: Buffer;

  constructor(b: Buffer) {
    this.b = b;
  }

  private regular(c: number | undefined): boolean {
    return c !== undefined && !ESPACIO.has(c) && !DELIMITADOR.has(c);
  }

  /** Salta espacios y comentarios (`%` hasta el fin de línea). */
  espacios(): void {
    const b = this.b;
    while (this.i < b.length) {
      const c = b[this.i];
      if (ESPACIO.has(c)) this.i++;
      else if (c === 0x25) {
        while (this.i < b.length && b[this.i] !== 0x0a && b[this.i] !== 0x0d) this.i++;
      } else break;
    }
  }

  private palabra(): string {
    const inicio = this.i;
    while (this.i < this.b.length && this.regular(this.b[this.i])) this.i++;
    return this.b.toString("latin1", inicio, this.i);
  }

  /** Cadena literal: paréntesis balanceados y `\` que escapa el carácter siguiente. */
  private cadena(): void {
    const b = this.b;
    let prof = 0;
    for (; this.i < b.length; this.i++) {
      const c = b[this.i];
      if (c === 0x5c) this.i++;
      else if (c === 0x28) prof++;
      else if (c === 0x29 && --prof === 0) {
        this.i++;
        return;
      }
    }
  }

  /** Un valor completo, o null ante un cierre (`]` o `>>`, sin consumirlo) o el fin del archivo. */
  valor(prof: number): Valor | null {
    if (++this.pasos > MAX_PASOS) throw new NoVerificable("demasiados_objetos");
    if (prof > MAX_PROFUNDIDAD) throw new NoVerificable("anidamiento");
    this.espacios();
    const b = this.b;
    if (this.i >= b.length) return null;
    const c = b[this.i];

    if (c === 0x3c && b[this.i + 1] === 0x3c) {
      this.i += 2;
      return this.diccionario(prof);
    }
    if (c === 0x3e && b[this.i + 1] === 0x3e) return null;
    if (c === 0x5d) return null;
    if (c === 0x3c) {
      // Cadena hexadecimal: `<…>`.
      const fin = b.indexOf(0x3e, this.i + 1);
      this.i = fin < 0 ? b.length : fin + 1;
      return OTRO;
    }
    if (c === 0x28) {
      this.cadena();
      return OTRO;
    }
    if (c === 0x5b) {
      this.i++;
      const v: Valor[] = [];
      for (;;) {
        this.espacios();
        if (this.i >= b.length) break;
        if (b[this.i] === 0x5d) {
          this.i++;
          break;
        }
        const x = this.valor(prof + 1);
        if (!x) break; // un `>>` suelto cierra el diccionario de afuera
        v.push(x);
      }
      return { t: "arreglo", v };
    }
    if (c === 0x2f) {
      this.i++;
      const n = decodificarNombre(this.palabra());
      this.nombres.push(n);
      return { t: "nombre", v: n };
    }
    if (!this.regular(c)) {
      this.i++; // `)`, `{`, `}` o un `>` suelto
      return OTRO;
    }

    const p = this.palabra();
    if (!NUMERO_RE.test(p)) return OTRO; // true, false, null, R, endobj…
    // `12 0 R` es una referencia a otro objeto.
    if (/^\d+$/.test(p)) {
      const guardado = this.i;
      this.espacios();
      const generacion = this.palabra();
      if (/^\d+$/.test(generacion)) {
        this.espacios();
        if (b[this.i] === 0x52 && !this.regular(b[this.i + 1])) {
          this.i++;
          return { t: "ref" };
        }
      }
      this.i = guardado;
    }
    return { t: "numero", v: Number(p) };
  }

  private diccionario(prof: number): Valor {
    const b = this.b;
    const m = new Map<string, Valor>();
    for (;;) {
      this.espacios();
      if (this.i >= b.length) break;
      if (b[this.i] === 0x3e && b[this.i + 1] === 0x3e) {
        this.i += 2;
        break;
      }
      const clave = this.valor(prof + 1);
      if (!clave) {
        this.i++; // `]` suelto
        continue;
      }
      if (clave.t !== "nombre") continue;
      const v = this.valor(prof + 1);
      if (v) m.set(clave.v, v);
    }
    return { t: "dicc", v: m };
  }

  /**
   * Si viene la palabra `stream`, avanza hasta el comienzo de los datos y
   * devuelve true. Como los visores, salta hasta el fin de línea aunque haya
   * espacios de más después de la palabra.
   */
  stream(): boolean {
    this.espacios();
    const b = this.b;
    if (b.toString("latin1", this.i, this.i + 6) !== "stream" || this.regular(b[this.i + 6])) return false;
    let j = this.i + 6;
    while (j < b.length && b.at(j) !== 0x0a && b.at(j) !== 0x0d) j++;
    if (b.at(j) === 0x0d) j++;
    if (b.at(j) === 0x0a) j++;
    this.i = j;
    return true;
  }
}

function nombreDe(v: Valor | undefined): string | null {
  return v?.t === "nombre" ? v.v : null;
}

/** Filtros de un stream de objetos, si son todos FlateDecode; si no, no se puede revisar. */
function filtrosDe(d: Map<string, Valor>): number {
  if (d.has("F")) throw new NoVerificable("datos_externos"); // los datos están en otro archivo
  const filtro = d.get("Filter");
  const lista = !filtro ? [] : filtro.t === "arreglo" ? filtro.v : [filtro];
  for (const f of lista) {
    const n = nombreDe(f);
    if (n !== "FlateDecode" && n !== "Fl") throw new NoVerificable("filtro_no_soportado");
  }
  // Un predictor reordena los bytes después de inflar: los nombres quedarían irreconocibles.
  const parametros = d.get("DecodeParms") ?? d.get("DP");
  const listaP = !parametros ? [] : parametros.t === "arreglo" ? parametros.v : [parametros];
  for (const p of listaP) {
    if (p.t === "ref") throw new NoVerificable("filtro_no_soportado");
    const predictor = p.t === "dicc" ? p.v.get("Predictor") : undefined;
    if (predictor && !(predictor.t === "numero" && predictor.v <= 1)) throw new NoVerificable("filtro_no_soportado");
  }
  return lista.length;
}

export type RevisionPdf =
  | { estado: "ok" }
  | { estado: "activo"; nombres: string[] }
  | { estado: "no_verificable"; causa: string };

/** Busca contenido activo en un PDF (ver el comentario de la sección). */
export function revisarPdf(b: Buffer): RevisionPdf {
  const texto = b.toString("latin1");
  const encontrados = new Set<string>();
  const anotar = (nombres: Iterable<string>, validos: Set<string>) => {
    for (const n of nombres) if (validos.has(n)) encontrados.add(n);
  };

  const todos = nombresDe(texto);
  anotar(todos, ACTIVOS_LARGOS);
  const cifrado = todos.includes("Encrypt");

  const lector = new Lector(b);
  let presupuesto = MAX_INFLADO_TOTAL;
  let recorrido = 0;
  let objStm = false;
  try {
    for (const m of texto.matchAll(RE_OBJ)) {
      lector.i = m.index + 3;
      lector.nombres = [];
      const v = lector.valor(0);
      anotar(lector.nombres, ACTIVOS);
      recorrido += lector.i - m.index;
      if (recorrido > MAX_RECORRIDO) throw new NoVerificable("demasiados_objetos");
      if (v?.t !== "dicc" || !lector.stream()) continue;

      const d = v.v;
      const esObjStm = nombreDe(d.get("Type")) === "ObjStm" || (d.has("N") && d.has("First"));
      if (!esObjStm) continue;
      objStm = true;

      let datos: Buffer = b.subarray(lector.i);
      const filtros = filtrosDe(d);
      if (filtros === 0) {
        // Sin comprimir: hasta `endstream`, para no revisar como objetos los
        // datos binarios que vienen después (los nombres largos ya se buscaron en todo).
        const fin = b.indexOf("endstream", lector.i, "latin1");
        if (fin >= 0) datos = b.subarray(lector.i, fin);
      }
      for (let n = filtros; n > 0; n--) {
        try {
          // Inflar se detiene solo al final de los datos comprimidos: no hace
          // falta creerle al /Length. Z_SYNC_FLUSH tolera un final cortado.
          datos = inflateSync(datos, {
            finishFlush: constants.Z_SYNC_FLUSH,
            maxOutputLength: Math.max(1, Math.min(MAX_INFLADO_STREAM, presupuesto)),
          });
        } catch (err) {
          const codigo = (err as { code?: unknown }).code;
          throw new NoVerificable(codigo === "ERR_BUFFER_TOO_LARGE" ? "demasiado_grande" : "stream_ilegible");
        }
        presupuesto -= datos.length;
        if (presupuesto <= 0) throw new NoVerificable("demasiado_grande");
      }
      anotar(nombresDe(datos.toString("latin1")), ACTIVOS);
    }
  } catch (err) {
    if (!(err instanceof NoVerificable)) throw err;
    // Si ya se encontró algo activo, ese es el motivo más claro para el usuario.
    if (!encontrados.size) return { estado: "no_verificable", causa: err.causa };
  }

  if (encontrados.size) return { estado: "activo", nombres: [...encontrados].sort() };
  // Cifrado + streams de objetos: lo que se infló eran bytes cifrados, no se revisó nada.
  if (cifrado && objStm) return { estado: "no_verificable", causa: "cifrado" };
  return { estado: "ok" };
}

// ─── Revisión completa ────────────────────────────────────────────────────────

function rechazo(motivo: MotivoRechazo, detalle: Record<string, unknown>, mensaje = mensajeRechazo(motivo)): Revision {
  return { ok: false, motivo, mensaje, detalle };
}

/**
 * Revisa el contenido de un archivo cuya extensión ya se validó. `esperado`
 * es el tipo que corresponde a esa extensión.
 */
export function revisarContenido(b: Buffer, extension: string, esperado: TipoExamen): Revision {
  if (b.length === 0) return rechazo("archivo_vacio", {});

  const ejecutable = ejecutablePorFirma(b);
  if (ejecutable) return rechazo("archivo_ejecutable", { detectado: ejecutable });

  const tipo = tipoPorFirma(b);
  if (tipo !== esperado) {
    return tipo
      ? rechazo("firma_no_coincide", { detectado: tipo }, mensajeFirmaDistinta(tipo, extension))
      : rechazo("firma_no_coincide", { detectado: formatoAjeno(b) });
  }

  if (tipo === "pdf") {
    const r = revisarPdf(b);
    if (r.estado === "activo") return rechazo("pdf_con_contenido_activo", { nombres_pdf: r.nombres });
    if (r.estado === "no_verificable") return rechazo("pdf_no_verificable", { causa: r.causa });
  }
  return { ok: true, tipo };
}
