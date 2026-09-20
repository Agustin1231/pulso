// k vecinos más cercanos (distancia euclídea sobre features estandarizadas).
// Comparador no paramétrico: si la logística no le gana, el problema no es lineal.

import type { Matriz } from "./algebra";

export function predecirKNN(Xtrain: Matriz, ytrain: readonly number[], Xtest: Matriz, k = 7): number[] {
  return Xtest.map((x) => {
    const dist = Xtrain.map((t, i) => {
      let d = 0;
      for (let j = 0; j < x.length; j++) d += (x[j] - t[j]) ** 2;
      return { d, y: ytrain[i] };
    });
    dist.sort((a, b) => a.d - b.d);
    let positivos = 0;
    for (let i = 0; i < Math.min(k, dist.length); i++) positivos += dist[i].y;
    return positivos / Math.min(k, dist.length);
  });
}
