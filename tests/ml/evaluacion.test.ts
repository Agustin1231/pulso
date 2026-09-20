import { test } from "node:test";
import assert from "node:assert/strict";
import { mae, rmse, mase, escalaMase, mape, cobertura } from "../../src/lib/ml/evaluacion/metricas";
import { backtest } from "../../src/lib/ml/evaluacion/backtest";
import { seleccionar, ajustarSobreSerie } from "../../src/lib/ml/evaluacion/seleccion";
import { naive } from "../../src/lib/ml/modelos/naive";
import { ols } from "../../src/lib/ml/modelos/lineal";
import { BENCHMARKS } from "../../src/lib/ml/modelos/registro";
import { generarSerie } from "../../src/lib/ml/sintetico";
import { crearPRNG } from "../../src/lib/ml/estadistica";

const cerca = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < tol, msg ?? `${a} no está a ${tol} de ${b}`);

test("métricas de error contra valores a mano", () => {
  cerca(mae([1, -1, 2]), 4 / 3, 1e-12);
  cerca(rmse([3, 4]), Math.sqrt(12.5), 1e-12);
  assert.equal(escalaMase([1, 3, 2, 5]), 2);
  assert.equal(mase([2, -2], 2), 1);
  cerca(mape([10, 20], [9, 22]) as number, 10, 1e-12);
  assert.equal(mape([0], [1]), null);
  cerca(cobertura([1, 5, 9], [0, 6, 8], [2, 7, 10]), 2 / 3, 1e-12);
});

test("el MASE in-sample del naïve es 1 por construcción", () => {
  const rng = crearPRNG(2);
  const y = Array.from({ length: 30 }, () => 50 + rng.normal(0, 4));
  const residuos = naive.ajustar({ t: y.map((_, i) => i), y }).residuos;
  cerca(mae(residuos) / escalaMase(y), 1, 1e-12);
});

test("tendencia fuerte: gana un modelo con tendencia y MASE < 1", () => {
  const { serie } = generarSerie({
    dias: 90, nivel: 60, pendientePorDia: 0.3, sigma: 3, pFaltante: 0.1,
    rango: [40, 130], decimales: 0, semilla: 1,
  });
  const sel = seleccionar(serie);
  assert.ok(sel.mase !== null && sel.mase < 1, `MASE ${sel.mase}`);
  assert.ok(["ols", "theil_sen", "holt"].includes(sel.clave), `ganó ${sel.clave}`);
  assert.ok(sel.tabla.some((f) => f.seleccionado));
  assert.ok(sel.tabla.find((f) => f.clave === "naive")!.mase > sel.mase);
});

test("ruido blanco: no inventa tendencia y el pronóstico a 30 días se queda cerca del nivel", () => {
  const { serie } = generarSerie({
    dias: 90, nivel: 72, sigma: 3, pFaltante: 0.1, rango: [40, 130], decimales: 0, semilla: 4,
  });
  const sel = seleccionar(serie);
  assert.ok(sel.mase !== null && sel.mase < 1.15, `MASE ${sel.mase}`);
  const { ajuste } = ajustarSobreSerie(serie, sel.clave);
  const p30 = ajuste.predecir(30)[29];
  cerca(p30.media, 72, 6, "el pronóstico se fue del nivel");
});

test("pocos datos: respaldo con confianza baja y sin tabla", () => {
  const { serie } = generarSerie({ dias: 10, nivel: 72, sigma: 3, semilla: 8, decimales: 0 });
  const sel = seleccionar(serie);
  assert.equal(sel.confianza, "baja");
  assert.equal(sel.tabla.length, 0);
  assert.equal(sel.clave, "media_movil");
  assert.equal(sel.mase, null);
});

test("backtest puntúa solo días observados y distingue horizontes", () => {
  const { serie } = generarSerie({ dias: 40, nivel: 70, sigma: 2, pFaltante: 0.3, semilla: 5, decimales: 0 });
  const r = backtest(serie, naive, { h: 7, minTrain: 14 });
  assert.ok(r.nOrigenes > 0);
  assert.equal(r.nPronosticos, r.errores.length);
  for (const e of r.errores) {
    assert.notEqual(serie.y[e.t], null);
    assert.ok(e.h >= 1 && e.h <= 7);
  }
  assert.ok(r.porHorizonte.length >= 1 && r.porHorizonte.length <= 7);
});

test("la cobertura empírica del IC 80 % de OLS ronda el 80 % sobre 100 series", () => {
  let dentro = 0;
  let total = 0;
  for (let s = 0; s < 100; s++) {
    const { serie } = generarSerie({ dias: 60, nivel: 72, pendientePorDia: 0.05, sigma: 3, semilla: 100 + s, decimales: 2 });
    const r = backtest(serie, ols, { h: 7, minTrain: 14, paso: 3 });
    dentro += r.cobertura80 * r.nPronosticos;
    total += r.nPronosticos;
  }
  const c = dentro / total;
  assert.ok(c > 0.7 && c < 0.9, `cobertura ${c.toFixed(3)}`);
  assert.ok(BENCHMARKS.has("naive") && !BENCHMARKS.has("ols"));
});
