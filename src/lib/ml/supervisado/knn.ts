// k vecinos más cercanos (distancia euclídea sobre features estandarizadas).
// Comparador no paramétrico: si la logística no le gana, el problema no es lineal.

import type { Matriz } from "./algebra";

export function predecirKNN(Xtrain: Matriz, ytrain: readonly number[], Xtest: Matriz, k = 7): number[] {
  const kk = Math.min(k, Xtrain.length);
  return Xtest.map((x) => {
    // Selección parcial de los k más cercanos (inserción ordenada). Ante empates
    // conserva el vecino de menor índice, igual que un ordenamiento estable.
    const d = new Float64Array(kk).fill(Infinity);
    const yv = new Float64Array(kk);
    for (let i = 0; i < Xtrain.length; i++) {
      const t = Xtrain[i];
      let di = 0;
      for (let j = 0; j < x.length; j++) di += (x[j] - t[j]) ** 2;
      if (!(di < d[kk - 1])) continue;
      let pos = kk - 1;
      while (pos > 0 && d[pos - 1] > di) {
        d[pos] = d[pos - 1];
        yv[pos] = yv[pos - 1];
        pos--;
      }
      d[pos] = di;
      yv[pos] = ytrain[i];
    }
    let positivos = 0;
    for (let i = 0; i < kk; i++) positivos += yv[i];
    return positivos / kk;
  });
}
