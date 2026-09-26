// Gradient boosting para clasificación binaria, implementado desde cero.
//
//   F_0(x)   = log(p̄ / (1 − p̄))                       (log-odds de la prevalencia)
//   r_i      = y_i − σ(F_{m−1}(x_i))                   (gradiente negativo de la log-loss)
//   h_m      = árbol de regresión de profundidad d ajustado a r por mínimos cuadrados
//   γ_hoja   = Σ r_i / Σ p_i(1 − p_i)                  (un paso de Newton por hoja)
//   F_m(x)   = F_{m−1}(x) + ν · γ_hoja(x)
//
// Es el algoritmo de Friedman (2001) con los mismos valores por defecto que
// scikit-learn (100 árboles, ν = 0,1, profundidad 3). Los cortes candidatos son
// los puntos medios entre valores distintos consecutivos de cada variable.

import type { Matriz } from "./algebra";

export interface OpcionesBoosting {
  arboles?: number;
  tasa?: number;
  profundidad?: number;
  minHoja?: number;
}

type Nodo =
  | { hoja: true; valor: number }
  | { hoja: false; variable: number; corte: number; izq: Nodo; der: Nodo };

export interface ModeloBoosting {
  inicial: number;
  tasa: number;
  arboles: Nodo[];
}

const sigmoide = (z: number) => 1 / (1 + Math.exp(-z));

/** Ordena una vez los índices por cada variable; cada nodo filtra este orden. */
function ordenarPorVariable(X: Matriz): Int32Array[] {
  const p = X[0].length;
  const out: Int32Array[] = [];
  for (let j = 0; j < p; j++) {
    const idx = Int32Array.from({ length: X.length }, (_, i) => i);
    idx.sort((a, b) => X[a][j] - X[b][j]);
    out.push(idx);
  }
  return out;
}

function construirArbol(
  X: Matriz, r: Float64Array, w: Float64Array, enNodo: Uint16Array, miembros: number[],
  orden: Int32Array[], profundidad: number, minHoja: number, marca: number,
): Nodo {
  let sr = 0, sw = 0;
  for (const i of miembros) { sr += r[i]; sw += w[i]; }
  const valor = sw > 1e-12 ? sr / sw : 0;
  if (profundidad === 0 || miembros.length < 2 * minHoja) return { hoja: true, valor };

  // Mejor corte por reducción de la suma de cuadrados de r: maximizar SL²/nL + SR²/nR.
  for (const i of miembros) enNodo[i] = marca;
  const n = miembros.length;
  let mejor = { ganancia: (sr * sr) / n, variable: -1, corte: 0 };
  for (let j = 0; j < orden.length; j++) {
    let sl = 0, nl = 0;
    let previo = NaN;
    for (const i of orden[j]) {
      if (enNodo[i] !== marca) continue;
      const x = X[i][j];
      if (nl >= minHoja && n - nl >= minHoja && x !== previo) {
        const ganancia = (sl * sl) / nl + ((sr - sl) * (sr - sl)) / (n - nl);
        if (ganancia > mejor.ganancia + 1e-12) mejor = { ganancia, variable: j, corte: (previo + x) / 2 };
      }
      sl += r[i];
      nl++;
      previo = x;
    }
  }
  if (mejor.variable < 0) return { hoja: true, valor };

  const izq: number[] = [];
  const der: number[] = [];
  for (const i of miembros) (X[i][mejor.variable] <= mejor.corte ? izq : der).push(i);
  return {
    hoja: false,
    variable: mejor.variable,
    corte: mejor.corte,
    izq: construirArbol(X, r, w, enNodo, izq, orden, profundidad - 1, minHoja, marca * 2),
    der: construirArbol(X, r, w, enNodo, der, orden, profundidad - 1, minHoja, marca * 2 + 1),
  };
}

function evaluarArbol(nodo: Nodo, x: readonly number[]): number {
  let n = nodo;
  while (!n.hoja) n = x[n.variable] <= n.corte ? n.izq : n.der;
  return n.valor;
}

export function entrenarBoosting(X: Matriz, y: readonly number[], opciones: OpcionesBoosting = {}): ModeloBoosting {
  const nArboles = opciones.arboles ?? 100;
  const tasa = opciones.tasa ?? 0.1;
  const profundidad = opciones.profundidad ?? 3;
  const minHoja = opciones.minHoja ?? 1;
  const n = X.length;
  const prevalencia = Math.min(1 - 1e-9, Math.max(1e-9, y.reduce((a, b) => a + b, 0) / n));
  const inicial = Math.log(prevalencia / (1 - prevalencia));

  const F = new Float64Array(n).fill(inicial);
  const r = new Float64Array(n);
  const w = new Float64Array(n);
  const orden = ordenarPorVariable(X);
  // Marca de pertenencia por nodo con numeración de heap (raíz 1, hijos 2k y 2k+1):
  // es única dentro de cada árbol y cabe en 16 bits hasta profundidad 15.
  const enNodo = new Uint16Array(n);
  const arboles: Nodo[] = [];
  const todos = Array.from({ length: n }, (_, i) => i);

  for (let m = 0; m < nArboles; m++) {
    for (let i = 0; i < n; i++) {
      const p = sigmoide(F[i]);
      r[i] = y[i] - p;
      w[i] = p * (1 - p);
    }
    enNodo.fill(0);
    const arbol = construirArbol(X, r, w, enNodo, todos, orden, profundidad, minHoja, 1);
    arboles.push(arbol);
    for (let i = 0; i < n; i++) F[i] += tasa * evaluarArbol(arbol, X[i]);
  }
  return { inicial, tasa, arboles };
}

export function predecirBoosting(modelo: ModeloBoosting, X: Matriz): number[] {
  return X.map((x) => {
    let F = modelo.inicial;
    for (const a of modelo.arboles) F += modelo.tasa * evaluarArbol(a, x);
    return sigmoide(F);
  });
}
