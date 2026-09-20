import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolver, invertir } from "../../src/lib/ml/supervisado/algebra";
import { entrenarLogistica, predecirProbabilidades, estandarizador, coeficientesOriginales } from "../../src/lib/ml/supervisado/logistica";
import { predecirKNN } from "../../src/lib/ml/supervisado/knn";
import { auc, metricas, curvaROC, calibracion } from "../../src/lib/ml/supervisado/metricas";
import { kFoldEstratificado, complemento } from "../../src/lib/ml/supervisado/validacion";
import { parsearCleveland, construirMatriz, CONJUNTOS } from "../../src/lib/ml/supervisado/uci";
import { crearPRNG } from "../../src/lib/ml/estadistica";

const cerca = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < tol, msg ?? `${a} no está a ${tol} de ${b}`);

test("álgebra: resolver e invertir contra un caso a mano", () => {
  const A = [[4, 1], [2, 3]];
  assert.deepEqual(resolver(A, [9, 13]).map((v) => Math.round(v * 1e9) / 1e9), [1.4, 3.4]);
  const inv = invertir(A);
  cerca(inv[0][0], 0.3, 1e-12); cerca(inv[0][1], -0.1, 1e-12);
  cerca(inv[1][0], -0.2, 1e-12); cerca(inv[1][1], 0.4, 1e-12);
  assert.throws(() => resolver([[1, 2], [2, 4]], [1, 2]));
});

test("la logística recupera los coeficientes verdaderos de datos simulados", () => {
  const rng = crearPRNG(3);
  const X: number[][] = [];
  const y: number[] = [];
  const betaReal = [-0.5, 1.2, -0.8];
  for (let i = 0; i < 4000; i++) {
    const x = [rng.normal(), rng.normal()];
    const p = 1 / (1 + Math.exp(-(betaReal[0] + betaReal[1] * x[0] + betaReal[2] * x[1])));
    X.push(x);
    y.push(rng.uniforme() < p ? 1 : 0);
  }
  const m = entrenarLogistica(X, y, { lambda: 1e-6 });
  assert.ok(m.convergio && m.iteraciones < 15, `iteraciones ${m.iteraciones}`);
  m.beta.forEach((b, j) => cerca(b, betaReal[j], 3 * m.errorEstandar[j] + 0.02, `β${j}`));
  const p = predecirProbabilidades(m, X);
  assert.ok(auc(y, p) > 0.75);
});

test("estandarizar y volver a la escala original deja las mismas predicciones", () => {
  const rng = crearPRNG(5);
  const X = Array.from({ length: 300 }, () => [50 + rng.normal(0, 10), 120 + rng.normal(0, 15)]);
  const y = X.map((x) => (x[0] / 10 + x[1] / 30 + rng.normal(0, 1) > 9.5 ? 1 : 0));
  const est = estandarizador(X);
  const m = entrenarLogistica(est.aplicar(X), y, { lambda: 1e-6 });
  const orig = coeficientesOriginales(m, est);
  const pStd = predecirProbabilidades(m, est.aplicar(X));
  const pOrig = X.map((x) => 1 / (1 + Math.exp(-(orig.beta[0] + orig.beta[1] * x[0] + orig.beta[2] * x[1]))));
  pStd.forEach((p, i) => cerca(p, pOrig[i], 1e-9));
});

test("métricas: AUC de ranking perfecto = 1, invertido = 0, empates = 0.5", () => {
  assert.equal(auc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9]), 1);
  assert.equal(auc([0, 0, 1, 1], [0.9, 0.8, 0.2, 0.1]), 0);
  assert.equal(auc([0, 1, 0, 1], [0.5, 0.5, 0.5, 0.5]), 0.5);
  const m = metricas([1, 0, 1, 0], [0.9, 0.4, 0.3, 0.2]);
  assert.equal(m.accuracy, 0.75);
  assert.equal(m.precision, 1);
  assert.equal(m.recall, 0.5);
  const roc = curvaROC([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9]);
  assert.deepEqual(roc[0], [0, 0]);
  assert.deepEqual(roc[roc.length - 1], [1, 1]);
  const cal = calibracion([1, 0, 1, 1], [0.95, 0.05, 0.9, 0.85]);
  assert.ok(cal.every((b) => b.n >= 1 && b.observada >= 0 && b.observada <= 1));
});

test("k-fold estratificado: particiones disjuntas, completas y con la proporción de positivos", () => {
  const y = Array.from({ length: 100 }, (_, i) => (i % 3 === 0 ? 1 : 0));
  const folds = kFoldEstratificado(y, 5, 1);
  const todos = folds.flat().sort((a, b) => a - b);
  assert.deepEqual(todos, Array.from({ length: 100 }, (_, i) => i));
  for (const fold of folds) {
    const pos = fold.filter((i) => y[i] === 1).length;
    assert.ok(pos >= 6 && pos <= 7, `positivos por fold ${pos}`);
    assert.equal(complemento(100, fold).length, 100 - fold.length);
  }
  assert.deepEqual(kFoldEstratificado(y, 5, 1), folds, "reproducible con la semilla");
});

test("k-NN: mayoría de los vecinos", () => {
  const Xtr = [[0], [0.1], [0.2], [10], [10.1], [10.2]];
  const ytr = [1, 1, 1, 0, 0, 0];
  assert.deepEqual(predecirKNN(Xtr, ytr, [[0.05], [9.9]], 3), [1, 0]);
});

test("UCI Cleveland: 297 filas usables, 6 descartadas, one-hot correcto", () => {
  const texto = readFileSync(path.join(process.cwd(), "data", "uci-heart-disease", "processed.cleveland.data"), "utf8");
  const { filas, descartadas } = parsearCleveland(texto);
  assert.equal(filas.length, 297);
  assert.equal(descartadas, 6);
  const completo = construirMatriz(filas, CONJUNTOS.find((c) => c.clave === "completo")!);
  assert.equal(completo.nombres.length, 9 + 3 + 2 + 2 + 2);
  assert.equal(completo.X[0].length, completo.nombres.length);
  assert.ok(completo.y.every((v) => v === 0 || v === 1));
  const pulso = construirMatriz(filas, CONJUNTOS.find((c) => c.clave === "pulso")!);
  assert.deepEqual(pulso.nombres, ["age", "sex", "thalach"]);
  // sanidad: con todas las variables la logística supera claramente al azar dentro de muestra
  const est = estandarizador(completo.X);
  const m = entrenarLogistica(est.aplicar(completo.X), completo.y);
  assert.ok(m.convergio);
  assert.ok(auc(completo.y, predecirProbabilidades(m, est.aplicar(completo.X))) > 0.85);
});
