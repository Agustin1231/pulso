// Piezas comunes a todos los modelos.

import type { PrediccionBase } from "../tipos";
import { cuantilNormal } from "../estadistica";

/** Cuantiles normales para los intervalos del 80 % y 95 %. */
export const Z80 = cuantilNormal(0.9);
export const Z95 = cuantilNormal(0.975);

export interface Cuantiles {
  q80: number;
  q95: number;
}

/** √(SSE / (n − parámetros)). 0 si no hay grados de libertad. */
export function sigmaResiduos(residuos: readonly number[], parametros = 0): number {
  const gl = residuos.length - parametros;
  if (gl <= 0) return 0;
  let s = 0;
  for (const e of residuos) s += e * e;
  return Math.sqrt(s / gl);
}

/**
 * Arma las `h` predicciones a partir de la media y el desvío de cada paso.
 * `tUltimo` es el índice de grilla de la última observación.
 */
export function construirPredicciones(
  tUltimo: number,
  h: number,
  mediaEn: (paso: number) => number,
  sigmaEn: (paso: number) => number,
  cuantiles: Cuantiles = { q80: Z80, q95: Z95 }
): PrediccionBase[] {
  const out: PrediccionBase[] = [];
  for (let k = 1; k <= h; k++) {
    const m = mediaEn(k);
    const s = Math.max(0, sigmaEn(k));
    out.push({
      h: k,
      t: tUltimo + k,
      media: m,
      ic80: [m - cuantiles.q80 * s, m + cuantiles.q80 * s],
      ic95: [m - cuantiles.q95 * s, m + cuantiles.q95 * s],
    });
  }
  return out;
}

export function esRegular(t: readonly number[]): boolean {
  for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] !== 1) return false;
  return true;
}
