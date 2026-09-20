// Candidatos del motor, en orden de complejidad creciente. El orden importa:
// ante empate en el backtesting gana el que aparece antes (el más simple).

import type { Modelo } from "../tipos";
import { naive, mediaMovil, drift, naiveEstacional } from "./naive";
import { ols } from "./lineal";
import { theilSen } from "./robusta";
import { holt } from "./holt";
import { holtWinters } from "./holt-winters";

export const MODELOS: readonly Modelo[] = [
  naive,
  mediaMovil,
  drift,
  naiveEstacional,
  ols,
  theilSen,
  holt,
  holtWinters,
];

/** Claves de los benchmarks (los modelos que no "aprenden" nada). */
export const BENCHMARKS: ReadonlySet<string> = new Set([
  naive.clave,
  mediaMovil.clave,
  drift.clave,
  naiveEstacional.clave,
]);

export function modeloPorClave(clave: string): Modelo {
  const m = MODELOS.find((x) => x.clave === clave);
  if (!m) throw new Error(`Modelo desconocido: ${clave}`);
  return m;
}
