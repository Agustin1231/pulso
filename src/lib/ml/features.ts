// Features derivadas de las series. Solo lo que el informe consume.

import type { MetricaType, Observacion, SerieDiaria, TendenciaMetrica } from "./tipos";
import { media, sd } from "./estadistica";
import { construirSerie } from "./series";

export { imc } from "./riesgo/indice";

/**
 * z-score del último registro respecto de la ventana anterior (default 28
 * días). Null si la ventana tiene menos de 7 registros.
 */
export function zScorePersonal(serie: SerieDiaria, ventana = 28): number | null {
  let ultimo = -1;
  for (let i = serie.y.length - 1; i >= 0; i--) {
    if (serie.y[i] !== null) {
      ultimo = i;
      break;
    }
  }
  if (ultimo < 0) return null;
  const previos: number[] = [];
  for (let i = Math.max(0, ultimo - ventana); i < ultimo; i++) {
    const v = serie.y[i];
    if (v !== null) previos.push(v);
  }
  if (previos.length < 7) return null;
  const s = sd(previos);
  if (!(s > 0)) return null;
  return ((serie.y[ultimo] as number) - media(previos)) / s;
}

/** Media de los últimos 7 días menos la de los 7 anteriores (≥ 2 registros en cada tramo). */
export function deltaSemanal(serie: SerieDiaria): number | null {
  const fin = serie.y.length;
  const recoger = (desde: number, hasta: number) => {
    const v: number[] = [];
    for (let i = Math.max(0, desde); i < hasta; i++) if (serie.y[i] !== null) v.push(serie.y[i] as number);
    return v;
  };
  const actual = recoger(fin - 7, fin);
  const previa = recoger(fin - 14, fin - 7);
  if (actual.length < 2 || previa.length < 2) return null;
  return media(actual) - media(previa);
}

/** Adherencia media (0–1) de los últimos `dias` días hasta `hoy`. */
export function adherenciaMedia(obs: readonly Observacion[], dias: number, hoy: string): number | null {
  if (!obs.length) return null;
  const serie = construirSerie(obs, hoy);
  const fin = serie.y.length;
  const vals: number[] = [];
  for (let i = Math.max(0, fin - dias); i < fin; i++) {
    const v = serie.y[i];
    if (v !== null) vals.push(Math.max(0, Math.min(1, v)));
  }
  return vals.length ? media(vals) : null;
}

/**
 * Cambio semanal mínimo que vale la pena llamar tendencia. Por debajo, aunque
 * la pendiente sea estadísticamente distinta de cero, se reporta "estable".
 */
const CAMBIO_RELEVANTE_SEMANAL: Partial<Record<MetricaType, number>> = {
  frecuencia_cardiaca: 1,
  horas_sueno: 0.15,
  nivel_estres: 0.3,
  peso: 0.2,
};

export function clasificarTendencia(
  metrica: MetricaType,
  pendientePorSemana: number,
  significativa: boolean
): TendenciaMetrica {
  const umbral = CAMBIO_RELEVANTE_SEMANAL[metrica] ?? 0;
  const relevante = significativa && Math.abs(pendientePorSemana) >= umbral;
  return {
    pendientePorSemana,
    significativa,
    direccion: relevante ? (pendientePorSemana > 0 ? "sube" : "baja") : "estable",
  };
}
