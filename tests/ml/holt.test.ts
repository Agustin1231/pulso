import { test } from "node:test";
import assert from "node:assert/strict";
import { ajustarHolt } from "../../src/lib/ml/modelos/holt";
import { ajustarHoltWinters } from "../../src/lib/ml/modelos/holt-winters";
import { crearPRNG } from "../../src/lib/ml/estadistica";

const cerca = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < tol, msg ?? `${a} no está a ${tol} de ${b}`);

test("Holt sin amortiguar sigue una recta con error mínimo", () => {
  const t = Array.from({ length: 30 }, (_, i) => i);
  const y = t.map((x) => 10 + 0.5 * x);
  const a = ajustarHolt({ t, y }, { amortiguado: false });
  cerca(a.predecir(5)[4].media, 10 + 0.5 * 34, 0.5);
  assert.ok(a.sigma < 0.1, `sigma ${a.sigma}`);
});

test("Holt amortiguado acota el pronóstico a 30 días", () => {
  const t = Array.from({ length: 30 }, (_, i) => i);
  const y = t.map((x) => 10 + 0.5 * x);
  const amortiguado = ajustarHolt({ t, y });
  const libre = ajustarHolt({ t, y }, { amortiguado: false });
  const a30 = amortiguado.predecir(30)[29].media;
  const l30 = libre.predecir(30)[29].media;
  assert.ok(amortiguado.parametros.phi < 1);
  assert.ok(a30 < l30, "amortiguado debe quedar por debajo");
  assert.ok(a30 > y[29], "pero sigue subiendo");
});

test("Holt exige grilla regular", () => {
  assert.throws(() => ajustarHolt({ t: [0, 1, 3], y: [1, 2, 3] }));
});

test("Holt-Winters recupera la amplitud y la forma del patrón semanal", () => {
  const patron = [1.2, -0.4, -0.4, -0.3, -0.3, -0.2, 0.4];
  const rng = crearPRNG(3);
  const t = Array.from({ length: 42 }, (_, i) => i);
  const y = t.map((x) => 7 + patron[x % 7] + rng.normal(0, 0.05));
  const a = ajustarHoltWinters({ t, y });
  const amplitudVerdadera = Math.max(...patron) - Math.min(...patron);
  cerca(a.parametros.amplitudEstacional, amplitudVerdadera, 0.3, "amplitud");
  const preds = a.predecir(7);
  preds.forEach((p, k) => cerca(p.media, 7 + patron[(42 + k) % 7], 0.3, `día ${k}`));
});

test("Holt-Winters necesita 3 semanas", () => {
  const t = Array.from({ length: 20 }, (_, i) => i);
  assert.throws(() => ajustarHoltWinters({ t, y: t.map(() => 1) }));
});
