// Benchmarks de pronóstico (Hyndman & Athanasopoulos, *FPP3* §5.2 y §5.5).
//
// Son el piso contra el que se mide todo lo demás: si un modelo no le gana al
// naïve en backtesting (MASE < 1), no aporta. Trabajan sobre la secuencia de
// observaciones; el naïve estacional además usa `t` para buscar el mismo día
// de la semana anterior.

import type { Modelo, Puntos } from "../tipos";
import { media } from "../estadistica";
import { construirPredicciones, sigmaResiduos } from "./base";

/**
 * σ de una caminata aleatoria con observaciones irregulares: Var(y_i − y_{i−1})
 * crece con los días transcurridos, así que cada diferencia se normaliza por
 * √Δt. Con Δt = 1 coincide con el desvío de los residuos del naïve.
 */
function sigmaCaminata(p: Puntos, pendiente = 0): { residuos: number[]; sigma: number } {
  const residuos: number[] = [];
  const normalizados: number[] = [];
  for (let i = 1; i < p.y.length; i++) {
    const dt = Math.max(1, p.t[i] - p.t[i - 1]);
    const e = p.y[i] - (p.y[i - 1] + pendiente * dt);
    residuos.push(e);
    normalizados.push(e / Math.sqrt(dt));
  }
  return { residuos, sigma: sigmaResiduos(normalizados) };
}

/** Pronostica el último valor. IC: σ·√h. */
export const naive: Modelo = {
  clave: "naive",
  nombre: "Naïve",
  nMin: 2,
  requiereGrillaRegular: false,
  ajustar(p) {
    const n = p.y.length;
    const yN = p.y[n - 1];
    const { residuos, sigma } = sigmaCaminata(p);
    return {
      residuos,
      sigma,
      parametros: { nivel: yN },
      predecir: (h) =>
        construirPredicciones(p.t[n - 1], h, () => yN, (k) => sigma * Math.sqrt(k)),
    };
  },
};

/** Pronostica la media de las últimas `k` observaciones. IC: σ·√(1 + 1/k). */
export const mediaMovil: Modelo = {
  clave: "media_movil",
  nombre: "Media móvil (7)",
  nMin: 3,
  requiereGrillaRegular: false,
  ajustar(p) {
    const k = 7;
    const n = p.y.length;
    const ventana = Math.min(k, n);
    const m = media(p.y.slice(-ventana));
    const residuos: number[] = [];
    for (let i = 1; i < n; i++) {
      residuos.push(p.y[i] - media(p.y.slice(Math.max(0, i - k), i)));
    }
    const sigma = sigmaResiduos(residuos);
    return {
      residuos,
      sigma,
      parametros: { nivel: m, ventana },
      predecir: (h) =>
        construirPredicciones(p.t[n - 1], h, () => m, () => sigma * Math.sqrt(1 + 1 / ventana)),
    };
  },
};

/**
 * Último valor más la pendiente promedio histórica (primero → último).
 * IC: σ·√(h·(1 + h/(n−1))).
 */
export const drift: Modelo = {
  clave: "drift",
  nombre: "Drift",
  nMin: 3,
  requiereGrillaRegular: false,
  ajustar(p) {
    const n = p.y.length;
    const yN = p.y[n - 1];
    const dt = p.t[n - 1] - p.t[0];
    const pendiente = dt > 0 ? (yN - p.y[0]) / dt : 0;
    const { residuos, sigma } = sigmaCaminata(p, pendiente);
    return {
      residuos,
      sigma,
      parametros: { pendiente, pendienteSemanal: 7 * pendiente },
      predecir: (h) =>
        construirPredicciones(
          p.t[n - 1],
          h,
          (k) => yN + pendiente * k,
          (k) => sigma * Math.sqrt(k * (1 + k / Math.max(1, n - 1)))
        ),
    };
  },
};

/**
 * Pronostica el valor del mismo día de la semana anterior (m = 7). Si ese día
 * no tiene registro busca 7 días más atrás, y si no hay ninguno cae al naïve.
 * IC: σ·√(⌊(h−1)/m⌋ + 1).
 */
export const naiveEstacional: Modelo = {
  clave: "naive_estacional",
  nombre: "Naïve estacional (7 d)",
  nMin: 8,
  requiereGrillaRegular: false,
  ajustar(p) {
    const m = 7;
    const n = p.y.length;
    const tN = p.t[n - 1];
    const yN = p.y[n - 1];
    const mapa = new Map<number, number>();
    p.t.forEach((t, i) => mapa.set(t, p.y[i]));

    const valorEstacional = (t: number): number | null => {
      for (let k = t - m; k >= p.t[0]; k -= m) {
        const v = mapa.get(k);
        if (v !== undefined) return v;
      }
      return null;
    };

    const residuos: number[] = [];
    for (let i = 0; i < n; i++) {
      const ref = valorEstacional(p.t[i]);
      if (ref !== null) residuos.push(p.y[i] - ref);
    }
    const sigma = residuos.length >= 2 ? sigmaResiduos(residuos) : sigmaCaminata(p).sigma;

    return {
      residuos,
      sigma,
      parametros: { periodo: m },
      predecir: (h) =>
        construirPredicciones(
          tN,
          h,
          (k) => valorEstacional(tN + k) ?? yN,
          (k) => sigma * Math.sqrt(Math.floor((k - 1) / m) + 1)
        ),
    };
  },
};
