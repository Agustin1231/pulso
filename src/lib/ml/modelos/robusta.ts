// Estimador de Theil-Sen (Theil 1950; Sen 1968): pendiente = mediana de las
// pendientes de todos los pares de puntos. Un outlier mueve una fracción
// pequeña de los pares, así que apenas afecta la mediana; OLS, en cambio,
// se tuerce con un solo día raro (una noche de 12 h, un pesaje mal cargado).
//
// El intervalo de predicción reutiliza la fórmula de OLS con los residuos de
// Theil-Sen. Es una aproximación (el estimador no es de mínimos cuadrados) y
// se documenta como tal; la cobertura empírica se mide en el backtesting.

import type { Modelo, Puntos } from "../tipos";
import { mediana } from "../estadistica";
import { prediccionesRecta } from "./lineal";
import type { AjusteLineal } from "./lineal";

export function ajustarTheilSen(p: Puntos): AjusteLineal {
  const n = p.y.length;
  const pendientes: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dt = p.t[j] - p.t[i];
      if (dt !== 0) pendientes.push((p.y[j] - p.y[i]) / dt);
    }
  }
  const b = pendientes.length ? mediana(pendientes) : 0;
  const a = mediana(p.y.map((y, i) => y - b * p.t[i]));

  const residuos = p.y.map((y, i) => y - (a + b * p.t[i]));
  let sse = 0;
  for (const e of residuos) sse += e * e;
  const gl = Math.max(1, n - 2);
  const s = n > 2 ? Math.sqrt(sse / gl) : 0;

  return {
    pendiente: b,
    intercepto: a,
    residuos,
    sigma: s,
    parametros: { pendiente: b, intercepto: a, pendienteSemanal: 7 * b, gl },
    predecir: prediccionesRecta(p, a, b, s, gl),
  };
}

export const theilSen: Modelo = {
  clave: "theil_sen",
  nombre: "Theil-Sen",
  nMin: 5,
  requiereGrillaRegular: false,
  ajustar: ajustarTheilSen,
};
