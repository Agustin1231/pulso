import { test } from "node:test";
import assert from "node:assert/strict";
import { naive, mediaMovil, drift, naiveEstacional } from "../../src/lib/ml/modelos/naive";
import { Z95, Z80 } from "../../src/lib/ml/modelos/base";

const cerca = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);

test("naïve: repite el último valor con σ·√h", () => {
  const p = { t: [0, 1, 2, 3, 4], y: [10, 12, 11, 13, 12] };
  const a = naive.ajustar(p);
  const sigma = Math.sqrt((4 + 1 + 4 + 1) / 4);
  cerca(a.sigma, sigma);
  const preds = a.predecir(4);
  assert.equal(preds.length, 4);
  assert.equal(preds[0].t, 5);
  for (const pr of preds) assert.equal(pr.media, 12);
  cerca(preds[3].ic95[1], 12 + Z95 * sigma * 2);
  cerca(preds[0].ic80[0], 12 - Z80 * sigma);
});

test("naïve con observaciones irregulares normaliza por √Δt", () => {
  const regular = naive.ajustar({ t: [0, 1, 2], y: [0, 2, 4] });
  const salteada = naive.ajustar({ t: [0, 2, 4], y: [0, 2, 4] });
  cerca(regular.sigma, 2);
  cerca(salteada.sigma, 2 / Math.sqrt(2));
});

test("media móvil: promedio de las últimas 7", () => {
  const y = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const a = mediaMovil.ajustar({ t: y.map((_, i) => i), y });
  const preds = a.predecir(3);
  for (const pr of preds) assert.equal(pr.media, 7);
  cerca(preds[0].ic95[1] - preds[0].media, Z95 * a.sigma * Math.sqrt(1 + 1 / 7));
});

test("drift: extiende la pendiente promedio", () => {
  const a = drift.ajustar({ t: [0, 1, 2, 3, 4], y: [0, 2, 4, 6, 8] });
  const preds = a.predecir(3);
  assert.deepEqual(preds.map((p) => p.media), [10, 12, 14]);
  assert.equal(a.sigma, 0);
  assert.equal(a.parametros.pendienteSemanal, 14);
});

test("naïve estacional: mismo día de la semana anterior", () => {
  const y = [1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7];
  const a = naiveEstacional.ajustar({ t: y.map((_, i) => i), y });
  const preds = a.predecir(9);
  assert.deepEqual(preds.slice(0, 7).map((p) => p.media), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(preds[7].media, 1);
  assert.equal(preds[8].media, 2);
  assert.equal(a.sigma, 0);
});
