/**
 * Cifrado en reposo de los datos de salud (integrador, punto 19).
 *
 * En `metricas` se cifran el valor y las notas; en `perfil`, la edad, el sexo,
 * la altura y si fuma. Cada dato va en su columna `<columna>_cifrado`, cifrado
 * con `cifrar` (AES-256-GCM, src/lib/seguridad/cifrado.ts) y con su propio
 * contexto ("metricas.valor", "perfil.edad", …): un valor copiado a otra
 * columna no se descifra. `tipo`, `unidad` y las fechas quedan en claro porque
 * la base filtra y ordena por ellos; no dicen nada de la salud de nadie.
 *
 * Qué se cifra: el valor en JSON (así vuelve con su tipo: número, texto o
 * booleano), rellenado con espacios hasta un largo fijo. Sin el relleno, el
 * largo del texto cifrado delataba el dato: "true" y "false" (fuma o no), "m"
 * y "otro", 95 y 120 de presión. Los valores cortos van todos a 32 bytes y las
 * notas al múltiplo de 128 bytes siguiente. `JSON.parse` ignora los espacios
 * del final, así que descifrar no necesita saber cuánto se rellenó.
 *
 * Al descifrar se valida el tipo. Un dato que no se puede descifrar (alterado,
 * de otra columna, otra clave) no tumba la página: se descarta y queda en el
 * log, con el id de la fila y nunca con el dato.
 *
 * Este módulo no importa nada (salvo tipos, que se borran al compilar) a
 * propósito: lo comparten la app (lib/db/consultas.ts), el seed de demo y los
 * scripts de migración y de carga, que corren con el Node de producción
 * (`node --experimental-strip-types`), y ese modo no resuelve imports sin
 * extensión. Por eso recibe `cifrar` y `descifrar` en vez de importarlos.
 */
import type {
  MetricaCifradaRow,
  MetricaRow,
  PerfilCifradoRow,
  PerfilFormData,
  PerfilRow,
  Sexo,
} from "./types";

/** Lo único que este módulo usa de src/lib/seguridad/cifrado.ts. */
export interface Cifrador {
  cifrar(texto: string, contexto: string): string;
  descifrar(valor: string, contexto: string): string;
}

type Clase = "numero" | "entero" | "texto" | "sexo" | "booleano";

export interface Campo {
  /** Columna vieja, en claro: existe solo hasta que corre la migración. */
  claro:    string;
  /** Columna con el texto cifrado. */
  columna:  string;
  /** Dato asociado del cifrado: ata el valor a su columna. */
  contexto: string;
  clase:    Clase;
}

export const CAMPOS_METRICA: Record<"valor" | "notas", Campo> = {
  valor: { claro: "valor", columna: "valor_cifrado", contexto: "metricas.valor", clase: "numero" },
  notas: { claro: "notas", columna: "notas_cifrado", contexto: "metricas.notas", clase: "texto" },
};

export const CAMPOS_PERFIL: Record<"edad" | "sexo" | "altura_cm" | "fumador", Campo> = {
  edad:      { claro: "edad",      columna: "edad_cifrado",      contexto: "perfil.edad",      clase: "entero" },
  sexo:      { claro: "sexo",      columna: "sexo_cifrado",      contexto: "perfil.sexo",      clase: "sexo" },
  altura_cm: { claro: "altura_cm", columna: "altura_cm_cifrado", contexto: "perfil.altura_cm", clase: "entero" },
  fumador:   { claro: "fumador",   columna: "fumador_cifrado",   contexto: "perfil.fumador",   clase: "booleano" },
};

/** Todo valor corto (número, sexo, booleano) mide esto antes de cifrar. */
const LARGO_CORTO = 32;
/** Las notas se rellenan hasta el múltiplo siguiente. */
const BLOQUE_TEXTO = 128;

function rellenar(json: string, clase: Clase): string {
  const n = Buffer.byteLength(json, "utf8");
  const largo = clase === "texto" ? Math.ceil(n / BLOQUE_TEXTO) * BLOQUE_TEXTO : LARGO_CORTO;
  return json + " ".repeat(Math.max(0, largo - n));
}

function esValido(clase: Clase, v: unknown): boolean {
  switch (clase) {
    case "numero":   return typeof v === "number" && Number.isFinite(v);
    case "entero":   return Number.isInteger(v);
    case "texto":    return typeof v === "string";
    case "sexo":     return v === "m" || v === "f" || v === "otro";
    case "booleano": return typeof v === "boolean";
  }
}

/** Un dato cifrado que no se pudo leer. El mensaje nunca incluye el dato. */
export class DatoIlegible extends Error {
  constructor(campo: Campo, motivo: string) {
    super(`${campo.contexto}: ${motivo}`);
    this.name = "DatoIlegible";
  }
}

/** Qué hacer con un dato ilegible. `fila` identifica la fila (id o uid), nunca el dato. */
export type AlFallar = (error: DatoIlegible, fila: string) => void;

const avisarEnElLog: AlFallar = (error, fila) => {
  console.error(`[cifrado] ${fila}: ${error.message}; se descarta el dato`);
};

export function crearCifradoSalud(c: Cifrador, alFallar: AlFallar = avisarEnElLog) {
  /** Cifra un valor para su columna. null queda null: el campo no se respondió. */
  function sellar(campo: Campo, valor: unknown): string | null {
    if (valor === null || valor === undefined) return null;
    if (!esValido(campo.clase, valor)) throw new TypeError(`${campo.contexto}: valor inválido`);
    return c.cifrar(rellenar(JSON.stringify(valor), campo.clase), campo.contexto);
  }

  /** Descifra y valida el tipo. Tira DatoIlegible si se alteró, si es de otra columna o si no es del tipo esperado. */
  function abrir(campo: Campo, cifrado: string | null): unknown {
    if (cifrado === null) return null;
    let texto: string;
    try {
      texto = c.descifrar(cifrado, campo.contexto);
    } catch (err) {
      throw new DatoIlegible(campo, `no se pudo descifrar (${err instanceof Error ? err.message : "error"})`);
    }
    let valor: unknown;
    try {
      valor = JSON.parse(texto);
    } catch {
      throw new DatoIlegible(campo, "el contenido no tiene el formato esperado");
    }
    if (!esValido(campo.clase, valor)) throw new DatoIlegible(campo, "el contenido no es del tipo esperado");
    return valor;
  }

  /** `abrir` que, si falla, avisa y devuelve null. */
  function abrirOAvisar(campo: Campo, cifrado: string | null, fila: string): unknown {
    try {
      return abrir(campo, cifrado);
    } catch (err) {
      alFallar(err as DatoIlegible, fila);
      return null;
    }
  }

  return {
    sellar,
    abrir,

    cifrarMetrica(valor: number, notas: string | null) {
      return {
        valor_cifrado: sellar(CAMPOS_METRICA.valor, valor) as string,
        notas_cifrado: sellar(CAMPOS_METRICA.notas, notas),
      };
    },

    /** La métrica descifrada, o null si su valor no se puede leer (la fila entera no sirve). */
    descifrarMetrica(f: MetricaCifradaRow): MetricaRow | null {
      const fila = `metricas ${f.id}`;
      if (f.valor_cifrado === null) {
        alFallar(new DatoIlegible(CAMPOS_METRICA.valor, "sin cifrar (falta correr scripts/migrar-cifrado-salud.mjs)"), fila);
        return null;
      }
      const valor = abrirOAvisar(CAMPOS_METRICA.valor, f.valor_cifrado, fila);
      if (valor === null) return null;
      return {
        id:         f.id,
        uid:        f.uid,
        tipo:       f.tipo,
        valor:      valor as number,
        unidad:     f.unidad,
        notas:      abrirOAvisar(CAMPOS_METRICA.notas, f.notas_cifrado, fila) as string | null,
        created_at: f.created_at,
      };
    },

    cifrarPerfil(p: PerfilFormData) {
      return {
        edad_cifrado:      sellar(CAMPOS_PERFIL.edad, p.edad),
        sexo_cifrado:      sellar(CAMPOS_PERFIL.sexo, p.sexo),
        altura_cm_cifrado: sellar(CAMPOS_PERFIL.altura_cm, p.altura_cm),
        fumador_cifrado:   sellar(CAMPOS_PERFIL.fumador, p.fumador),
      };
    },

    /** El perfil descifrado. Un campo ilegible queda en null, como si no se hubiera respondido. */
    descifrarPerfil(f: PerfilCifradoRow): PerfilRow {
      const fila = `perfil ${f.uid}`;
      return {
        uid:            f.uid,
        edad:           abrirOAvisar(CAMPOS_PERFIL.edad, f.edad_cifrado, fila) as number | null,
        sexo:           abrirOAvisar(CAMPOS_PERFIL.sexo, f.sexo_cifrado, fila) as Sexo | null,
        altura_cm:      abrirOAvisar(CAMPOS_PERFIL.altura_cm, f.altura_cm_cifrado, fila) as number | null,
        fumador:        abrirOAvisar(CAMPOS_PERFIL.fumador, f.fumador_cifrado, fila) as boolean | null,
        actualizado_at: f.actualizado_at,
      };
    },
  };
}

export type CifradoSalud = ReturnType<typeof crearCifradoSalud>;
