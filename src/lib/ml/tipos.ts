// Tipos del motor de predicción.
//
// Todo `lib/ml` es puro: sin DB, sin React, sin `next`, sin alias `@/`. Solo
// imports relativos y `import type` de `../db/types`, para que compile con
// `tsc -p tsconfig.ml.json` y corra en Node sin Next (tests y `npm run evaluar`).

import type { MetricaType, Sexo } from "../db/types";

export type { MetricaType, Sexo };

/** Una medición cruda. `fecha` puede ser YYYY-MM-DD o un ISO con hora. */
export interface Observacion {
  fecha: string;
  valor: number;
}

/** Serie en grilla diaria continua. `null` = día sin registro. */
export interface SerieDiaria {
  dias: string[];
  y: (number | null)[];
  /** Cantidad de días con registro. */
  n: number;
  /** n / dias.length */
  cobertura: number;
}

/** Puntos observados. `t` son días desde el origen de la serie; puede tener huecos. */
export interface Puntos {
  t: number[];
  y: number[];
}

export interface PrediccionBase {
  /** Pasos adelante desde la última observación (1..H). */
  h: number;
  /** Índice de día en la grilla de la serie. */
  t: number;
  media: number;
  ic80: [number, number];
  ic95: [number, number];
}

export interface Prediccion extends PrediccionBase {
  fecha: string;
}

export interface Ajuste {
  predecir(h: number): PrediccionBase[];
  /** Residuos in-sample (errores a un paso en los modelos recursivos). */
  residuos: number[];
  /** Desvío estándar de los residuos. */
  sigma: number;
  parametros: Record<string, number>;
}

export interface Modelo {
  clave: string;
  nombre: string;
  /** Mínimo de observaciones para ajustar. */
  nMin: number;
  /** Necesita `t` consecutivos (Holt, Holt-Winters). */
  requiereGrillaRegular: boolean;
  ajustar(p: Puntos): Ajuste;
}

// ─── Evaluación ──────────────────────────────────────────────────────────────

export interface FilaEvaluacion {
  clave: string;
  nombre: string;
  mae: number;
  rmse: number;
  mape: number | null;
  mase: number;
  cobertura80: number;
  cobertura95: number;
  nPronosticos: number;
  nOrigenes: number;
  seleccionado: boolean;
}

export type Confianza = "alta" | "media" | "baja";

export interface Seleccion {
  clave: string;
  nombre: string;
  mase: number | null;
  confianza: Confianza;
  razon: string;
  tabla: FilaEvaluacion[];
}

// ─── Riesgo ──────────────────────────────────────────────────────────────────

export interface Perfil {
  edad?: number | null;
  sexo?: Sexo | null;
  alturaCm?: number | null;
  fumador?: boolean | null;
}

export type FactorClave =
  | "frecuencia_cardiaca"
  | "horas_sueno"
  | "nivel_estres"
  | "imc"
  | "tabaquismo";

export type EstadoFactor = "normal" | "atencion" | "riesgo" | "sin-datos";
export type Evidencia = "alta" | "media" | "baja";

export interface FactorResultado {
  clave: FactorClave;
  label: string;
  unidad: string;
  valor: number | null;
  estado: EstadoFactor;
  /** log del riesgo relativo respecto al rango de referencia (0 = referencia). */
  logRR: number;
  /** log RR en el peor valor plausible del factor; define su peso en L_max. */
  logRRMax: number;
  puntosPerdidos: number;
  maxPuntos: number;
  evidencia: Evidencia;
  fuente: string;
}

export interface ResultadoRiesgo {
  score: number | null;
  etiqueta: string;
  /** e^L: riesgo relativo combinado vs. referencia (solo factores modificables). */
  riesgoRelativo: number | null;
  L: number;
  LMax: number;
  factores: FactorResultado[];
  contexto: { multiplicador: number | null; detalle: string[] };
  cobertura: { disponibles: number; total: number };
  insuficiente: boolean;
}

export interface ProyeccionRiesgo {
  horizonteDias: number;
  score: number | null;
  ic80: [number, number] | null;
  delta: number | null;
}

// ─── Anomalías ───────────────────────────────────────────────────────────────

export interface Alerta {
  metrica: MetricaType;
  metodo: "cusum" | "ewma";
  direccion: "sube" | "baja";
  /** Desvío sostenido estimado, en desvíos estándar del baseline personal. */
  magnitudSigma: number;
  /** Desvío sostenido estimado, en unidades de la métrica. */
  magnitud: number;
  /** Día estimado en que empezó el desvío. */
  desde: string;
  /** Primera detección. */
  detectadaEn: string;
  /** Última confirmación: mientras el desvío persiste, avanza con cada re-alarma. */
  hasta: string;
  severidad: "info" | "atencion" | "alta";
  mensaje: string;
}

// ─── Informe ─────────────────────────────────────────────────────────────────

export interface EntradaInforme {
  metricas: Partial<Record<MetricaType, Observacion[]>>;
  perfil: Perfil | null;
  /** Fracción diaria (0–1) de hábitos fijos completados. */
  adherencia?: Observacion[];
  /** YYYY-MM-DD. Inyectable para tests; default: hoy (hora local). */
  hoy?: string;
  /** Días a pronosticar desde hoy. Default 30. */
  horizonte?: number;
}

export interface TendenciaMetrica {
  pendientePorSemana: number;
  significativa: boolean;
  direccion: "sube" | "baja" | "estable";
}

export interface InformeMetrica {
  n: number;
  cobertura: number;
  /** Mediana de los últimos 7 días (o último valor si hay menos de 3). */
  nivelActual: number | null;
  tendencia: TendenciaMetrica | null;
  modelo: {
    clave: string;
    nombre: string;
    mase: number | null;
    confianza: Confianza;
    razon: string;
    tabla: FilaEvaluacion[];
  };
  pronostico: Prediccion[];
  alertas: Alerta[];
}

export interface Informe {
  generadoEn: string;
  horizonte: number;
  cobertura: { dias: number; porMetrica: Partial<Record<MetricaType, number>> };
  metricas: Partial<Record<MetricaType, InformeMetrica>>;
  adherencia: { media7d: number | null; media14d: number | null } | null;
  riesgo: ResultadoRiesgo;
  proyeccion: ProyeccionRiesgo;
  /** Frases listas para el disclaimer de la UI y para el prompt del LLM. */
  limitaciones: string[];
}
