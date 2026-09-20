// Suavizado exponencial de Holt con tendencia amortiguada (Holt 1957; Gardner &
// McKenzie 1985). Formulación de *FPP3* §8.2:
//
//   ŷ_{t+h|t} = ℓ_t + (φ + φ² + … + φʰ)·b_t
//   ℓ_t = α·y_t + (1−α)·(ℓ_{t−1} + φ·b_{t−1})
//   b_t = β*·(ℓ_t − ℓ_{t−1}) + (1−β*)·φ·b_{t−1}
//
// Con φ < 1 la tendencia se va apagando y el pronóstico a 30 días queda
// acotado, que es lo razonable para métricas fisiológicas (nadie sigue bajando
// 0.3 kg por día durante un mes).
//
// Los parámetros se eligen por búsqueda en grilla minimizando la suma de
// errores al cuadrado a un paso. Varianza del pronóstico (FPP3 §8.7, clase 1,
// ETS(A,Ad,N)): σ_h² = σ²·[1 + Σ_{j=1}^{h−1} (α + α·β*·φ_j)²], φ_j = φ + … + φʲ.

import type { Ajuste, Modelo, Puntos } from "../tipos";
import { construirPredicciones, esRegular, sigmaResiduos } from "./base";

interface Corrida {
  nivel: number;
  pendiente: number;
  residuos: number[];
  sse: number;
}

/**
 * Estado inicial por mínimos cuadrados sobre los primeros `k` puntos. Con
 * ruido, el clásico b₀ = y₁ − y₀ arranca con una pendiente espuria del orden
 * de √2·σ que las primeras iteraciones tienen que desaprender.
 */
function estadoInicial(y: readonly number[]): { nivel: number; pendiente: number } {
  const k = Math.min(14, y.length);
  if (k < 2) return { nivel: y[0], pendiente: 0 };
  const tm = (k - 1) / 2;
  let ym = 0;
  for (let i = 0; i < k; i++) ym += y[i];
  ym /= k;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < k; i++) {
    sxx += (i - tm) ** 2;
    sxy += (i - tm) * (y[i] - ym);
  }
  const pendiente = sxx > 0 ? sxy / sxx : 0;
  return { nivel: ym - pendiente * tm, pendiente };
}

function correr(
  y: readonly number[],
  alpha: number,
  beta: number,
  phi: number,
  inicial: { nivel: number; pendiente: number }
): Corrida {
  let l = inicial.nivel;
  let b = inicial.pendiente;
  const residuos: number[] = [];
  let sse = 0;
  for (let i = 0; i < y.length; i++) {
    const pred = l + phi * b;
    const e = y[i] - pred;
    residuos.push(e);
    sse += e * e;
    const lNuevo = alpha * y[i] + (1 - alpha) * (l + phi * b);
    b = beta * (lNuevo - l) + (1 - beta) * phi * b;
    l = lNuevo;
  }
  return { nivel: l, pendiente: b, residuos, sse };
}

const GRILLA = Array.from({ length: 19 }, (_, i) => 0.05 + i * 0.05);
const PHI_AMORTIGUADO = [0.8, 0.85, 0.9, 0.95, 0.98];

export interface OpcionesHolt {
  /** true: φ ∈ [0.80, 0.98]; false: φ = 1 (Holt clásico). */
  amortiguado?: boolean;
}

export function ajustarHolt(p: Puntos, opciones: OpcionesHolt = {}): Ajuste {
  if (!esRegular(p.t)) throw new Error("Holt requiere una grilla regular (t consecutivos)");
  const amortiguado = opciones.amortiguado ?? true;
  const phis = amortiguado ? PHI_AMORTIGUADO : [1];

  const inicial = estadoInicial(p.y);
  let mejor: { alpha: number; beta: number; phi: number; corrida: Corrida } | null = null;
  for (const phi of phis) {
    for (const alpha of GRILLA) {
      for (const beta of GRILLA) {
        const corrida = correr(p.y, alpha, beta, phi, inicial);
        if (!mejor || corrida.sse < mejor.corrida.sse) mejor = { alpha, beta, phi, corrida };
      }
    }
  }
  const { alpha, beta, phi, corrida } = mejor as NonNullable<typeof mejor>;
  const sigma = sigmaResiduos(corrida.residuos, 3);
  const n = p.y.length;

  const phiSuma = (k: number) => {
    let s = 0;
    let pk = 1;
    for (let j = 1; j <= k; j++) {
      pk *= phi;
      s += pk;
    }
    return s;
  };
  const sigmaEn = (k: number) => {
    let acum = 0;
    for (let j = 1; j <= k - 1; j++) acum += (alpha + alpha * beta * phiSuma(j)) ** 2;
    return sigma * Math.sqrt(1 + acum);
  };

  return {
    residuos: corrida.residuos,
    sigma,
    parametros: {
      alpha,
      beta,
      phi,
      nivel: corrida.nivel,
      pendiente: corrida.pendiente,
      // pendiente media de la próxima semana, ya amortiguada
      pendienteSemanal: phiSuma(7) * corrida.pendiente,
    },
    predecir: (h) =>
      construirPredicciones(
        p.t[n - 1],
        h,
        (k) => corrida.nivel + phiSuma(k) * corrida.pendiente,
        sigmaEn
      ),
  };
}

export const holt: Modelo = {
  clave: "holt",
  nombre: "Holt amortiguado",
  nMin: 10,
  requiereGrillaRegular: true,
  ajustar: (p) => ajustarHolt(p),
};
