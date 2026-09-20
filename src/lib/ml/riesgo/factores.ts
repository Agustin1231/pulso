// Funciones de riesgo por factor.
//
// Cada `logRR(x)` devuelve el logaritmo del riesgo relativo respecto del rango
// de referencia (vale 0 adentro de él) y es continua: dormir 5 h no "salta" a
// otra categoría, pesa proporcionalmente más que dormir 6 h. Las magnitudes
// salen de meta-análisis publicados y se citan en `fuente`; cuando la
// evidencia es débil (extremos bajos, escala autoreportada) se marca.
//
// El estado categórico (normal / atención / riesgo) reutiliza los umbrales de
// `metricas-config.ts` para que la UI diga lo mismo en todos lados.

import type { EstadoFactor, Evidencia, FactorClave, Sexo } from "../tipos";
import { getEstado } from "../../metricas-config";

export interface DefinicionFactor {
  clave: FactorClave;
  label: string;
  unidad: string;
  evidencia: Evidencia;
  fuente: string;
  /** Intervalo donde logRR = 0. */
  referencia: [number, number];
  /** Peor valor plausible; define el peso máximo del factor en L_max. */
  peor: number;
  logRR(x: number): number;
  estado(x: number): EstadoFactor;
}

const ln = Math.log;

export const FRECUENCIA_CARDIACA: DefinicionFactor = {
  clave: "frecuencia_cardiaca",
  label: "Frecuencia cardíaca en reposo",
  unidad: "bpm",
  evidencia: "alta",
  fuente:
    "Zhang et al. 2016 (CMAJ), meta-análisis de 46 cohortes: +9 % de mortalidad por cada +10 bpm en reposo; Aune et al. 2017 (NMCD)",
  referencia: [50, 70],
  peor: 120,
  logRR(x) {
    if (x > 70) return (ln(1.09) * (Math.min(x, 120) - 70)) / 10;
    // Bradicardia en no deportistas: evidencia débil, penalización leve.
    if (x < 50) return (ln(1.1) * (50 - Math.max(x, 35))) / 10;
    return 0;
  },
  estado: (x) => getEstado("frecuencia_cardiaca", x),
};

export const HORAS_SUENO: DefinicionFactor = {
  clave: "horas_sueno",
  label: "Horas de sueño",
  unidad: "h",
  evidencia: "alta",
  fuente:
    "Cappuccio et al. 2011 (Eur Heart J): sueño corto RR 1.48 y largo RR 1.38 para enfermedad coronaria; forma dosis-respuesta de Yin et al. 2017 (JAHA)",
  referencia: [7, 8],
  peor: 3,
  logRR(x) {
    // Calibrada para que 5 h ⇒ ln(1.48) y 10 h ⇒ ln(1.38); lineal en el déficit/exceso.
    if (x < 7) return (ln(1.48) / 2) * (7 - Math.max(x, 3));
    if (x > 8) return (ln(1.38) / 2) * (Math.min(x, 12) - 8);
    return 0;
  },
  estado: (x) => getEstado("horas_sueno", x),
};

export const NIVEL_ESTRES: DefinicionFactor = {
  clave: "nivel_estres",
  label: "Nivel de estrés",
  unidad: "/10",
  evidencia: "baja",
  fuente:
    "Richardson et al. 2012 (Am J Cardiol), meta-análisis: estrés percibido alto RR 1.27 para enfermedad coronaria. La escala 1–10 es autoreportada y no está validada contra ese estudio: es el factor de evidencia más débil",
  referencia: [1, 3],
  peor: 10,
  logRR(x) {
    if (x <= 3) return 0;
    return (ln(1.27) * (Math.min(x, 10) - 3)) / 7;
  },
  estado: (x) => getEstado("nivel_estres", x),
};

export const IMC: DefinicionFactor = {
  clave: "imc",
  label: "Índice de masa corporal",
  unidad: "kg/m²",
  evidencia: "alta",
  fuente:
    "Global BMI Mortality Collaboration 2016 (Lancet), 10.6 millones de personas: HR 1.39 por cada 5 kg/m² por encima de 25. Bajo peso (< 18.5): evidencia confundida por enfermedad previa, penalización leve",
  referencia: [18.5, 25],
  peor: 40,
  logRR(x) {
    if (x > 25) return (ln(1.39) * (Math.min(x, 40) - 25)) / 5;
    if (x < 18.5) return (ln(1.3) * (18.5 - Math.max(x, 15))) / 3.5;
    return 0;
  },
  estado(x) {
    if (x >= 18.5 && x < 25) return "normal";
    if (x >= 25 && x < 30) return "atencion";
    if (x < 18.5 && x >= 17) return "atencion";
    return "riesgo";
  },
};

export const TABAQUISMO: DefinicionFactor = {
  clave: "tabaquismo",
  label: "Tabaquismo",
  unidad: "",
  evidencia: "alta",
  fuente:
    "INTERHEART (Yusuf et al. 2004, Lancet), 52 países: OR 2.87 de infarto en fumadores actuales; meta-análisis ≈ 2–3. Se usa RR 2.5",
  referencia: [0, 0],
  peor: 1,
  logRR: (x) => (x >= 0.5 ? ln(2.5) : 0),
  estado: (x) => (x >= 0.5 ? "riesgo" : "normal"),
};

/** Factores modificables, en el orden en que se muestran. */
export const FACTORES: readonly DefinicionFactor[] = [
  FRECUENCIA_CARDIACA,
  HORAS_SUENO,
  NIVEL_ESTRES,
  IMC,
  TABAQUISMO,
];

/** log RR en el peor valor plausible de cada factor (su peso en L_max). */
export function logRRMax(def: DefinicionFactor): number {
  // Los factores en U tienen un extremo bajo además del `peor` alto.
  const extremos = [def.peor];
  if (def.clave === "horas_sueno") extremos.push(12);
  if (def.clave === "frecuencia_cardiaca") extremos.push(35);
  if (def.clave === "imc") extremos.push(15);
  return Math.max(...extremos.map((x) => def.logRR(x)));
}

// ─── Contexto no modificable (no entra al score) ─────────────────────────────

/**
 * El riesgo cardiovascular absoluto se duplica aproximadamente por década a
 * partir de los 40 (tablas de Framingham y SCORE). ln(2)/10 por año.
 */
export function logRREdad(edad: number): number {
  if (!(edad > 40)) return 0;
  return (ln(2) / 10) * (Math.min(edad, 90) - 40);
}

/**
 * A igual edad, los hombres tienen ~1.5–2× el riesgo de las mujeres antes de
 * los 70 (Framingham; tablas SCORE2 por sexo). Se usa 1.5 como constante
 * conservadora; "otro" o desconocido ⇒ 0.
 */
export function logRRSexo(sexo: Sexo | null | undefined): number {
  return sexo === "m" ? ln(1.5) : 0;
}
