// Muestra analítica de NHANES 2021-2023 (CDC/NCHS) para el experimento
// supervisado con las mismas variables que captura Pulso.
// Ver data/nhanes-2021-2023/README.md para la fuente, los archivos y los criterios.

import type { Matriz } from "./algebra";
import type { TablaXPT } from "./xpt";

export const BASE_URL = "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2021/DataFiles";

/** Los siete archivos del ciclo que se cruzan por `SEQN`. */
export const ARCHIVOS = [
  { codigo: "DEMO_L", contenido: "Demografía: edad (RIDAGEYR) y sexo (RIAGENDR)" },
  { codigo: "BPXO_L", contenido: "Presión oscilométrica: pulso en reposo (BPXOPLS1)" },
  { codigo: "BMX_L", contenido: "Medidas corporales: peso (BMXWT), talla (BMXHT), IMC (BMXBMI)" },
  { codigo: "SLQ_L", contenido: "Sueño: horas en días laborables (SLD012)" },
  { codigo: "DPQ_L", contenido: "Cuestionario PHQ-9 (DPQ010–DPQ090)" },
  { codigo: "MCQ_L", contenido: "Condiciones médicas: antecedente cardiovascular (MCQ160B–F)" },
  { codigo: "SMQ_L", contenido: "Tabaquismo: SMQ020 y SMQ040" },
] as const;
export type CodigoArchivo = (typeof ARCHIVOS)[number]["codigo"];

export interface FilaNHANES {
  seqn: number;
  edad: number;
  /** 1 = hombre, 0 = mujer (RIAGENDR 1/2). */
  hombre: number;
  fc: number;
  peso: number;
  imc: number;
  sueno: number;
  phq9: number;
  /** Fumador actual (SMQ020 = 1 y SMQ040 ∈ {1, 2}); desconocido → 0, ver `fumadorConocido`. */
  fumador: number;
  fumadorConocido: boolean;
  /** Antecedente autorreportado de falla cardíaca, enfermedad coronaria, angina, infarto o ACV. */
  evento: number;
}

export interface PasoFlujo {
  criterio: string;
  n: number;
}

export interface MuestraNHANES {
  filas: FilaNHANES[];
  flujo: PasoFlujo[];
}

const EVENTOS = ["MCQ160B", "MCQ160C", "MCQ160D", "MCQ160E", "MCQ160F"] as const;
const PHQ9 = ["DPQ010", "DPQ020", "DPQ030", "DPQ040", "DPQ050", "DPQ060", "DPQ070", "DPQ080", "DPQ090"] as const;

type Registro = Record<string, number | string | null>;
const num = (r: Registro | undefined, k: string): number | null => {
  const v = r?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/** PHQ-9 total (0–27). Exige los nueve ítems con respuesta válida (0–3); 7 y 9 son "rehusó" y "no sabe". */
export function totalPHQ9(r: Registro | undefined): number | null {
  let total = 0;
  for (const k of PHQ9) {
    const v = num(r, k);
    if (v === null || v > 3) return null;
    total += v;
  }
  return total;
}

/**
 * Desenlace: 1 si respondió "sí" (1) a alguna de las cinco preguntas; 0 si
 * ninguna fue "sí" y al menos una fue "no" (2); desconocido en otro caso.
 */
export function eventoCardiovascular(r: Registro | undefined): number | null {
  const vs = EVENTOS.map((k) => num(r, k));
  if (vs.some((v) => v === 1)) return 1;
  if (vs.some((v) => v === 2)) return 0;
  return null;
}

export function construirMuestra(tablas: Record<CodigoArchivo, TablaXPT>): MuestraNHANES {
  const indice = (codigo: CodigoArchivo) => new Map(tablas[codigo].filas.map((f) => [f.SEQN as number, f]));
  const [bpxo, bmx, slq, dpq, mcq, smq] = (["BPXO_L", "BMX_L", "SLQ_L", "DPQ_L", "MCQ_L", "SMQ_L"] as const).map(indice);

  const flujo: PasoFlujo[] = [{ criterio: "Participantes del ciclo (DEMO_L)", n: tablas.DEMO_L.filas.length }];
  const pasos = [
    "Adultos de 18 años o más",
    "Con pulso en reposo (BPXOPLS1)",
    "Con peso e IMC medidos",
    "Con horas de sueño (SLD012)",
    "Con los nueve ítems del PHQ-9",
    "Con desenlace cardiovascular conocido",
  ];
  const cuenta = new Array<number>(pasos.length).fill(0);
  const filas: FilaNHANES[] = [];

  for (const d of tablas.DEMO_L.filas) {
    const seqn = d.SEQN as number;
    const edad = num(d, "RIDAGEYR");
    if (edad === null || edad < 18) continue;
    cuenta[0]++;
    const fc = num(bpxo.get(seqn), "BPXOPLS1");
    if (fc === null) continue;
    cuenta[1]++;
    const peso = num(bmx.get(seqn), "BMXWT");
    const imc = num(bmx.get(seqn), "BMXBMI");
    if (peso === null || imc === null) continue;
    cuenta[2]++;
    const sueno = num(slq.get(seqn), "SLD012");
    if (sueno === null) continue;
    cuenta[3]++;
    const phq9 = totalPHQ9(dpq.get(seqn));
    if (phq9 === null) continue;
    cuenta[4]++;
    const evento = eventoCardiovascular(mcq.get(seqn));
    if (evento === null) continue;
    cuenta[5]++;

    const s = smq.get(seqn);
    const smq020 = num(s, "SMQ020");
    const smq040 = num(s, "SMQ040");
    const fumadorConocido = smq020 === 1 || smq020 === 2;
    const fumador = smq020 === 1 && (smq040 === 1 || smq040 === 2) ? 1 : 0;

    filas.push({ seqn, edad, hombre: num(d, "RIAGENDR") === 1 ? 1 : 0, fc, peso, imc, sueno, phq9, fumador, fumadorConocido, evento });
  }
  pasos.forEach((criterio, i) => flujo.push({ criterio, n: cuenta[i] }));
  return { filas, flujo };
}

// ─── Serialización de la muestra (CSV versionado en el repo) ─────────────────

export const COLUMNAS_CSV = ["seqn", "edad", "hombre", "fc", "peso", "imc", "sueno", "phq9", "fumador", "fumadorConocido", "evento"] as const;

export function aCSV(filas: readonly FilaNHANES[]): string {
  const lineas = [COLUMNAS_CSV.join(",")];
  for (const f of filas) lineas.push(COLUMNAS_CSV.map((c) => (typeof f[c] === "boolean" ? (f[c] ? 1 : 0) : f[c])).join(","));
  return lineas.join("\n") + "\n";
}

export function desdeCSV(texto: string): FilaNHANES[] {
  const [cabecera, ...lineas] = texto.trim().split(/\r?\n/);
  const cols = cabecera.split(",");
  return lineas.map((l) => {
    const v = l.split(",").map(Number);
    const fila = Object.fromEntries(cols.map((c, i) => [c, v[i]])) as unknown as FilaNHANES;
    fila.fumadorConocido = Boolean(fila.fumadorConocido);
    return fila;
  });
}

// ─── Equivalencias con la escala de la app ───────────────────────────────────

/**
 * La app registra estrés percibido en 1–10; NHANES no trae una escala de
 * estrés, así que se usa el PHQ-9 (síntomas depresivos, 0–27) como aproximación
 * con un mapeo lineal redondeado: 0 → 1, 27 → 10.
 */
export const estresDesdePHQ9 = (phq9: number) => Math.round(1 + (9 * phq9) / 27);

// ─── Conjuntos de variables ──────────────────────────────────────────────────

export interface ConjuntoNHANES {
  clave: string;
  nombre: string;
  columnas: (keyof FilaNHANES)[];
}

export const CONJUNTOS_NHANES: ConjuntoNHANES[] = [
  { clave: "demografico", nombre: "Solo edad y sexo", columnas: ["edad", "hombre"] },
  { clave: "estilo_vida", nombre: "Estilo de vida (FC, IMC, sueño, PHQ-9, tabaco)", columnas: ["fc", "imc", "sueno", "phq9", "fumador"] },
  { clave: "estilo_vida_demografico", nombre: "Estilo de vida + edad y sexo", columnas: ["fc", "imc", "sueno", "phq9", "fumador", "edad", "hombre"] },
  // Especificación de la versión 4 del documento (peso e IMC juntos, sin tabaco).
  { clave: "v4_app", nombre: "Especificación v4: FC, peso, IMC, sueño, PHQ-9", columnas: ["fc", "peso", "imc", "sueno", "phq9"] },
  { clave: "v4_app_demografico", nombre: "Especificación v4 + edad y sexo", columnas: ["fc", "peso", "imc", "sueno", "phq9", "edad", "hombre"] },
];

export function matrizNHANES(filas: readonly FilaNHANES[], columnas: readonly (keyof FilaNHANES)[]): { X: Matriz; y: number[] } {
  return {
    X: filas.map((f) => columnas.map((c) => Number(f[c]))),
    y: filas.map((f) => f.evento),
  };
}
