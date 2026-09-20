// Regresión lineal por mínimos cuadrados ordinarios sobre el tiempo.
//
// y = a + b·t. Intervalo de predicción clásico:
//   ŷ ± t_{q, n−2} · s · √(1 + 1/n + (t* − t̄)² / Sxx)
// con s² = SSE/(n−2). La pendiente se declara significativa si |b / SE(b)|
// supera el cuantil 0.975 de la t con n−2 grados de libertad.

import type { Ajuste, Modelo, Puntos, PrediccionBase } from "../tipos";
import { media, cuantilT } from "../estadistica";
import { construirPredicciones } from "./base";

export interface AjusteLineal extends Ajuste {
  pendiente: number;
  intercepto: number;
}

/** Predicciones de una recta con el error estándar de predicción de OLS. */
export function prediccionesRecta(
  p: Puntos,
  a: number,
  b: number,
  s: number,
  gl: number
): (h: number) => PrediccionBase[] {
  const n = p.y.length;
  const tm = media(p.t);
  let sxx = 0;
  for (const t of p.t) sxx += (t - tm) * (t - tm);
  const tN = p.t[n - 1];
  const q80 = cuantilT(0.9, gl);
  const q95 = cuantilT(0.975, gl);
  return (h) =>
    construirPredicciones(
      tN,
      h,
      (k) => a + b * (tN + k),
      (k) => s * Math.sqrt(1 + 1 / n + (sxx > 0 ? (tN + k - tm) ** 2 / sxx : 0)),
      { q80, q95 }
    );
}

export function ajustarOLS(p: Puntos): AjusteLineal {
  const n = p.y.length;
  const tm = media(p.t);
  const ym = media(p.y);
  let sxx = 0;
  let sxy = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    sxx += (p.t[i] - tm) ** 2;
    sxy += (p.t[i] - tm) * (p.y[i] - ym);
    sst += (p.y[i] - ym) ** 2;
  }
  const b = sxx > 0 ? sxy / sxx : 0;
  const a = ym - b * tm;

  const residuos = p.y.map((y, i) => y - (a + b * p.t[i]));
  let sse = 0;
  for (const e of residuos) sse += e * e;
  const gl = Math.max(1, n - 2);
  const s = n > 2 ? Math.sqrt(sse / gl) : 0;
  const seB = sxx > 0 ? s / Math.sqrt(sxx) : Infinity;
  // Ajuste perfecto (s = 0) con pendiente no nula: t → ∞. Se acota para que
  // sobreviva a JSON.
  const tstat = Number.isFinite(seB) && seB > 0 ? b / seB : b !== 0 ? 1e6 : 0;
  const significativa = Math.abs(tstat) > cuantilT(0.975, gl);
  const r2 = sst > 0 ? 1 - sse / sst : 0;

  return {
    pendiente: b,
    intercepto: a,
    residuos,
    sigma: s,
    parametros: {
      pendiente: b,
      intercepto: a,
      pendienteSemanal: 7 * b,
      r2,
      tstat,
      significativa: significativa ? 1 : 0,
      gl,
    },
    predecir: prediccionesRecta(p, a, b, s, gl),
  };
}

export const ols: Modelo = {
  clave: "ols",
  nombre: "Regresión lineal (OLS)",
  nMin: 5,
  requiereGrillaRegular: false,
  ajustar: ajustarOLS,
};
