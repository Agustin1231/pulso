// Holt-Winters aditivo con período semanal (m = 7). *FPP3* §8.3:
//
//   ŷ_{t+h|t} = ℓ_t + h·b_t + s_{t+h−m(k+1)},  k = ⌊(h−1)/m⌋
//   ℓ_t = α·(y_t − s_{t−m}) + (1−α)·(ℓ_{t−1} + b_{t−1})
//   b_t = β*·(ℓ_t − ℓ_{t−1}) + (1−β*)·b_{t−1}
//   s_t = γ·(y_t − ℓ_{t−1} − b_{t−1}) + (1−γ)·s_{t−m}
//
// Captura patrones como "duermo más los fines de semana". Necesita al menos
// tres semanas completas. Varianza (FPP3 §8.7, ETS(A,A,A)):
//   σ_h² = σ²·[1 + Σ_{j=1}^{h−1} (α + α·β*·j + γ·𝟙[j mod m = 0])²].

import type { Ajuste, Modelo, Puntos } from "../tipos";
import { media } from "../estadistica";
import { construirPredicciones, esRegular, sigmaResiduos } from "./base";

const M = 7;

interface Corrida {
  nivel: number;
  pendiente: number;
  estacional: number[];
  residuos: number[];
  sse: number;
}

function correr(y: readonly number[], alpha: number, beta: number, gamma: number): Corrida {
  const n = y.length;
  const l0 = media(y.slice(0, M));
  const b0 = (media(y.slice(M, 2 * M)) - l0) / M;
  const S: number[] = new Array(n).fill(0);
  const inicial = y.slice(0, M).map((v) => v - l0);
  const centro = media(inicial);
  for (let i = 0; i < M; i++) S[i] = inicial[i] - centro;

  let l = l0;
  let b = b0;
  const residuos: number[] = [];
  let sse = 0;
  for (let t = M; t < n; t++) {
    const pred = l + b + S[t - M];
    const e = y[t] - pred;
    residuos.push(e);
    sse += e * e;
    const lNuevo = alpha * (y[t] - S[t - M]) + (1 - alpha) * (l + b);
    const bNuevo = beta * (lNuevo - l) + (1 - beta) * b;
    S[t] = gamma * (y[t] - l - b) + (1 - gamma) * S[t - M];
    l = lNuevo;
    b = bNuevo;
  }
  return { nivel: l, pendiente: b, estacional: S, residuos, sse };
}

const GRILLA = Array.from({ length: 9 }, (_, i) => 0.1 + i * 0.1);

export function ajustarHoltWinters(p: Puntos): Ajuste {
  if (!esRegular(p.t)) throw new Error("Holt-Winters requiere una grilla regular");
  if (p.y.length < 3 * M) throw new Error("Holt-Winters necesita al menos 3 semanas");

  let mejor: { alpha: number; beta: number; gamma: number; corrida: Corrida } | null = null;
  for (const alpha of GRILLA) {
    for (const beta of GRILLA) {
      for (const gamma of GRILLA) {
        if (gamma > 1 - alpha + 1e-9) continue; // región admisible (FPP3 §8.3)
        const corrida = correr(p.y, alpha, beta, gamma);
        if (!mejor || corrida.sse < mejor.corrida.sse) mejor = { alpha, beta, gamma, corrida };
      }
    }
  }
  const { alpha, beta, gamma, corrida } = mejor as NonNullable<typeof mejor>;
  const n = p.y.length;
  const sigma = sigmaResiduos(corrida.residuos, 3);
  const T = n - 1;
  const ultimaTemporada = corrida.estacional.slice(n - M);

  const sigmaEn = (k: number) => {
    let acum = 0;
    for (let j = 1; j <= k - 1; j++) {
      acum += (alpha + alpha * beta * j + (j % M === 0 ? gamma : 0)) ** 2;
    }
    return sigma * Math.sqrt(1 + acum);
  };

  return {
    residuos: corrida.residuos,
    sigma,
    parametros: {
      alpha,
      beta,
      gamma,
      nivel: corrida.nivel,
      pendiente: corrida.pendiente,
      pendienteSemanal: 7 * corrida.pendiente,
      amplitudEstacional: Math.max(...ultimaTemporada) - Math.min(...ultimaTemporada),
    },
    predecir: (h) =>
      construirPredicciones(
        p.t[n - 1],
        h,
        (k) => {
          const kk = Math.floor((k - 1) / M);
          return corrida.nivel + k * corrida.pendiente + corrida.estacional[T + k - M * (kk + 1)];
        },
        sigmaEn
      ),
  };
}

export const holtWinters: Modelo = {
  clave: "holt_winters",
  nombre: "Holt-Winters (7 d)",
  nMin: 3 * M,
  requiereGrillaRegular: true,
  ajustar: ajustarHoltWinters,
};
