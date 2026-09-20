// Métricas de error de pronóstico.
//
// MASE (Hyndman & Koehler 2006) es la que manda en la selección: divide el
// error absoluto por el error absoluto medio del naïve a un paso dentro de la
// muestra de entrenamiento. MASE < 1 significa "mejor que repetir el último
// valor"; es comparable entre métricas con unidades distintas.

import { media } from "../estadistica";

export function mae(errores: readonly number[]): number {
  return errores.length ? media(errores.map(Math.abs)) : NaN;
}

export function rmse(errores: readonly number[]): number {
  return errores.length ? Math.sqrt(media(errores.map((e) => e * e))) : NaN;
}

/** Porcentual medio, ignorando los reales iguales a 0. Null si no queda ninguno. */
export function mape(reales: readonly number[], predichos: readonly number[]): number | null {
  const ratios: number[] = [];
  for (let i = 0; i < reales.length; i++) {
    if (reales[i] !== 0) ratios.push(Math.abs((reales[i] - predichos[i]) / reales[i]));
  }
  return ratios.length ? 100 * media(ratios) : null;
}

/** Escala del MASE: |y_i − y_{i−1}| promedio sobre la secuencia de entrenamiento. */
export function escalaMase(yEntrenamiento: readonly number[]): number {
  if (yEntrenamiento.length < 2) return NaN;
  const difs: number[] = [];
  for (let i = 1; i < yEntrenamiento.length; i++) {
    difs.push(Math.abs(yEntrenamiento[i] - yEntrenamiento[i - 1]));
  }
  return media(difs);
}

export function mase(errores: readonly number[], escala: number): number {
  return escala > 0 ? mae(errores) / escala : NaN;
}

/** Fracción de reales dentro de [lo, hi]: calibración empírica del intervalo. */
export function cobertura(
  reales: readonly number[],
  lo: readonly number[],
  hi: readonly number[]
): number {
  if (!reales.length) return NaN;
  let dentro = 0;
  for (let i = 0; i < reales.length; i++) {
    if (reales[i] >= lo[i] && reales[i] <= hi[i]) dentro++;
  }
  return dentro / reales.length;
}
