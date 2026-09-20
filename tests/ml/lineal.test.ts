import { test } from "node:test";
import assert from "node:assert/strict";
import { ajustarOLS } from "../../src/lib/ml/modelos/lineal";
import { ajustarTheilSen } from "../../src/lib/ml/modelos/robusta";
import { crearPRNG } from "../../src/lib/ml/estadistica";

const cerca = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < tol, msg ?? `${a} no está a ${tol} de ${b}`);

test("OLS sobre una recta perfecta recupera pendiente e intercepto exactos", () => {
  const t = Array.from({ length: 10 }, (_, i) => i);
  const y = t.map((x) => 3 + 0.5 * x);
  const a = ajustarOLS({ t, y });
  cerca(a.pendiente, 0.5, 1e-12);
  cerca(a.intercepto, 3, 1e-12);
  cerca(a.sigma, 0, 1e-12);
  cerca(a.parametros.r2, 1, 1e-12);
  cerca(a.predecir(2)[1].media, 3 + 0.5 * 11, 1e-12);
  assert.equal(a.parametros.significativa, 1);
});

test("OLS con ruido: la pendiente verdadera cae dentro del IC 95 % del estimador", () => {
  const rng = crearPRNG(11);
  const t = Array.from({ length: 60 }, (_, i) => i);
  const y = t.map((x) => 70 + 0.1 * x + rng.normal(0, 2));
  const a = ajustarOLS({ t, y });
  let sxx = 0;
  const tm = 29.5;
  for (const x of t) sxx += (x - tm) ** 2;
  const seB = a.sigma / Math.sqrt(sxx);
  cerca(a.pendiente, 0.1, 2.5 * seB, "pendiente fuera del IC");
  assert.equal(a.parametros.significativa, 1);
  const p = a.predecir(7);
  assert.ok(p[6].ic95[1] - p[6].ic95[0] > p[0].ic95[1] - p[0].ic95[0], "el IC se ensancha con el horizonte");
});

test("OLS sobre ruido plano no declara tendencia significativa", () => {
  const rng = crearPRNG(5);
  const t = Array.from({ length: 40 }, (_, i) => i);
  const y = t.map(() => 70 + rng.normal(0, 2));
  const a = ajustarOLS({ t, y });
  assert.equal(a.parametros.significativa, 0);
});

test("Theil-Sen ignora un outlier que sí tuerce a OLS", () => {
  const t = Array.from({ length: 20 }, (_, i) => i);
  const y = t.map((x) => 5 + x);
  y[19] += 50;
  const ts = ajustarTheilSen({ t, y });
  const ols = ajustarOLS({ t, y });
  cerca(ts.pendiente, 1, 1e-9, "Theil-Sen se movió");
  assert.ok(Math.abs(ols.pendiente - 1) > 0.5, `OLS debería torcerse: ${ols.pendiente}`);
});
