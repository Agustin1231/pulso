// Regresión logística entrenada desde cero por IRLS (Newton-Raphson).
//
//   p_i = σ(x_iᵀβ)
//   gradiente  g = Xᵀ(y − p) − λ·β̃          (β̃: β con el intercepto en 0)
//   hessiana   H = Xᵀ W X + λ·Ĩ,  W = diag(p_i(1 − p_i))
//   β ← β + H⁻¹ g   hasta que el cambio sea menor que `tol`
//
// La penalización ridge λ (chica) garantiza que H sea invertible aunque las
// clases sean separables y estabiliza las one-hot; el intercepto no se penaliza.
// Los errores estándar salen de la diagonal de H⁻¹ en el óptimo (matriz de
// información observada), como en cualquier paquete estadístico.

import { ceros, invertir, resolver } from "./algebra";
import type { Matriz } from "./algebra";

export interface ModeloLogistico {
  /** β[0] es el intercepto; el resto sigue el orden de las columnas de X. */
  beta: number[];
  errorEstandar: number[];
  iteraciones: number;
  convergio: boolean;
  logVerosimilitud: number;
}

export interface OpcionesLogistica {
  lambda?: number;
  maxIteraciones?: number;
  tol?: number;
}

const sigmoide = (z: number) => 1 / (1 + Math.exp(-z));

function logVerosimilitud(X: Matriz, y: readonly number[], beta: readonly number[]): number {
  let ll = 0;
  for (let i = 0; i < X.length; i++) {
    const eta = beta[0] + X[i].reduce((s, v, j) => s + v * beta[j + 1], 0);
    // forma numéricamente estable de y·log p + (1−y)·log(1−p)
    ll += y[i] * eta - Math.log1p(Math.exp(eta));
  }
  return ll;
}

export function entrenarLogistica(X: Matriz, y: readonly number[], opciones: OpcionesLogistica = {}): ModeloLogistico {
  const lambda = opciones.lambda ?? 0.01;
  const maxIter = opciones.maxIteraciones ?? 50;
  const tol = opciones.tol ?? 1e-8;
  const n = X.length;
  const p = X[0].length + 1;
  let beta = new Array<number>(p).fill(0);
  let convergio = false;
  let iteraciones = 0;
  let H: Matriz = ceros(p, p);

  for (let it = 1; it <= maxIter; it++) {
    iteraciones = it;
    const g = new Array<number>(p).fill(0);
    H = ceros(p, p);
    for (let i = 0; i < n; i++) {
      const fila = [1, ...X[i]];
      let eta = 0;
      for (let j = 0; j < p; j++) eta += fila[j] * beta[j];
      const pi = sigmoide(eta);
      const w = pi * (1 - pi);
      const r = y[i] - pi;
      for (let j = 0; j < p; j++) {
        g[j] += fila[j] * r;
        for (let k = 0; k < p; k++) H[j][k] += w * fila[j] * fila[k];
      }
    }
    for (let j = 1; j < p; j++) {
      g[j] -= lambda * beta[j];
      H[j][j] += lambda;
    }
    const delta = resolver(H, g);
    beta = beta.map((b, j) => b + delta[j]);
    if (Math.max(...delta.map(Math.abs)) < tol) {
      convergio = true;
      break;
    }
  }

  const inv = invertir(H);
  return {
    beta,
    errorEstandar: inv.map((fila, j) => Math.sqrt(Math.max(0, fila[j]))),
    iteraciones,
    convergio,
    logVerosimilitud: logVerosimilitud(X, y, beta),
  };
}

export function predecirProbabilidades(modelo: ModeloLogistico, X: Matriz): number[] {
  return X.map((fila) => sigmoide(modelo.beta[0] + fila.reduce((s, v, j) => s + v * modelo.beta[j + 1], 0)));
}

// ─── Estandarización (con estadísticos del entrenamiento, para no filtrar el test) ──

export interface Estandarizador {
  media: number[];
  sd: number[];
  aplicar(X: Matriz): Matriz;
}

export function estandarizador(X: Matriz): Estandarizador {
  const p = X[0].length;
  const media = new Array<number>(p).fill(0);
  const sd = new Array<number>(p).fill(0);
  for (const fila of X) for (let j = 0; j < p; j++) media[j] += fila[j] / X.length;
  for (const fila of X) for (let j = 0; j < p; j++) sd[j] += (fila[j] - media[j]) ** 2 / (X.length - 1);
  for (let j = 0; j < p; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  return { media, sd, aplicar: (M) => M.map((fila) => fila.map((v, j) => (v - media[j]) / sd[j])) };
}

/** Lleva los coeficientes ajustados sobre datos estandarizados a la escala original. */
export function coeficientesOriginales(modelo: ModeloLogistico, est: Estandarizador): { beta: number[]; errorEstandar: number[] } {
  const beta = [...modelo.beta];
  const se = [...modelo.errorEstandar];
  let intercepto = modelo.beta[0];
  for (let j = 1; j < beta.length; j++) {
    beta[j] = modelo.beta[j] / est.sd[j - 1];
    se[j] = modelo.errorEstandar[j] / est.sd[j - 1];
    intercepto -= (modelo.beta[j] * est.media[j - 1]) / est.sd[j - 1];
  }
  beta[0] = intercepto;
  return { beta, errorEstandar: se };
}

// ─── Explicación SHAP exacta ─────────────────────────────────────────────────
//
// En un modelo lineal en la escala logit, el valor SHAP de la variable j es
//   φ_j = β_j (x_j − x̄_j) = β^z_j · z_j
// (β^z: coeficiente sobre la variable estandarizada; x̄: media del entrenamiento)
// y el valor base es el log-odds medio de la muestra, β^z_0. Se cumple la
// propiedad de eficiencia, base + Σ φ_j = logit de la predicción, sin muestreo
// (Lundberg y Lee 2017). El supuesto es el habitual del explicador lineal:
// variables independientes en la distribución de referencia.

export interface ExplicacionSHAP {
  /** Log-odds medio de la muestra de entrenamiento. */
  base: number;
  /** Contribución de cada variable al log-odds, en el orden de las columnas. */
  phi: number[];
  logit: number;
  probabilidad: number;
}

export function explicarSHAP(
  modelo: Pick<ModeloLogistico, "beta">,
  est: Pick<Estandarizador, "media" | "sd">,
  x: readonly number[],
): ExplicacionSHAP {
  const base = modelo.beta[0];
  const phi = x.map((v, j) => (modelo.beta[j + 1] * (v - est.media[j])) / est.sd[j]);
  const logit = base + phi.reduce((s, v) => s + v, 0);
  return { base, phi, logit, probabilidad: sigmoide(logit) };
}
