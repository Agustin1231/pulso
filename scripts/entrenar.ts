#!/usr/bin/env node
/**
 * Experimento supervisado: entrenar y validar clasificadores de enfermedad
 * coronaria sobre el dataset público UCI Heart Disease (Cleveland), desde cero.
 *
 *   npm run entrenar [-- --json docs/entrenamiento-uci.json --semilla 42 --repeticiones 10]
 *
 * Protocolo: validación cruzada estratificada de 5 particiones, repetida R veces
 * con semillas distintas (5·R ajustes por modelo). La estandarización se calcula
 * con los datos de entrenamiento de cada partición. Se reportan media ± sd de
 * AUC, accuracy, F1, log-loss y Brier; la curva ROC y la calibración salen de las
 * predicciones fuera de muestra de la primera repetición.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parsearCleveland, construirMatriz, CONJUNTOS } from "../src/lib/ml/supervisado/uci";
import type { FilaUCI } from "../src/lib/ml/supervisado/uci";
import { entrenarLogistica, predecirProbabilidades, estandarizador, coeficientesOriginales } from "../src/lib/ml/supervisado/logistica";
import { predecirKNN } from "../src/lib/ml/supervisado/knn";
import { metricas, curvaROC, calibracion } from "../src/lib/ml/supervisado/metricas";
import type { MetricasClasificacion } from "../src/lib/ml/supervisado/metricas";
import { kFoldEstratificado, complemento, mediaSd } from "../src/lib/ml/supervisado/validacion";
import type { Matriz } from "../src/lib/ml/supervisado/algebra";

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const SEMILLA = Number(arg("semilla") ?? 42);
const REPETICIONES = Number(arg("repeticiones") ?? 10);
const K = 5;
const LAMBDA = 0.01;
const KNN_K = 7;
const SALIDA = arg("json");

const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "—");

// ─── datos ───────────────────────────────────────────────────────────────────

const ruta = path.join(process.cwd(), "data", "uci-heart-disease", "processed.cleveland.data");
const { filas, descartadas } = parsearCleveland(readFileSync(ruta, "utf8"));
const positivos = filas.filter((r) => r.num > 0).length;
console.log(`UCI Heart Disease (Cleveland): ${filas.length} pacientes usables (${descartadas} descartados por faltantes), ${positivos} con enfermedad (${(100 * positivos / filas.length).toFixed(1)} %)`);
console.log(`Protocolo: ${K}-fold estratificado × ${REPETICIONES} repeticiones, semilla ${SEMILLA}, ridge λ=${LAMBDA}, k-NN k=${KNN_K}\n`);

// ─── modelos ─────────────────────────────────────────────────────────────────

type Predictor = (Xtr: Matriz, ytr: number[], Xte: Matriz) => number[];

const logistica: Predictor = (Xtr, ytr, Xte) => {
  const est = estandarizador(Xtr);
  const modelo = entrenarLogistica(est.aplicar(Xtr), ytr, { lambda: LAMBDA });
  return predecirProbabilidades(modelo, est.aplicar(Xte));
};
const knn: Predictor = (Xtr, ytr, Xte) => {
  const est = estandarizador(Xtr);
  return predecirKNN(est.aplicar(Xtr), ytr, est.aplicar(Xte), KNN_K);
};
const mayoritario: Predictor = (_Xtr, ytr, Xte) => {
  const prev = ytr.reduce((a, b) => a + b, 0) / ytr.length;
  return Xte.map(() => prev);
};

interface Experimento { clave: string; modelo: string; conjunto: string; predictor: Predictor }
const EXPERIMENTOS: Experimento[] = [
  { clave: "mayoritario", modelo: "Baseline (prevalencia)", conjunto: "completo", predictor: mayoritario },
  { clave: "logistica_pulso", modelo: "Regresión logística", conjunto: "pulso", predictor: logistica },
  { clave: "logistica_clinico_basico", modelo: "Regresión logística", conjunto: "clinico_basico", predictor: logistica },
  { clave: "logistica_completo", modelo: "Regresión logística", conjunto: "completo", predictor: logistica },
  { clave: "knn_completo", modelo: `k-NN (k=${KNN_K})`, conjunto: "completo", predictor: knn },
];

// ─── validación cruzada repetida ─────────────────────────────────────────────

interface Resumen { media: number; sd: number }
interface ResultadoExperimento {
  clave: string; modelo: string; conjunto: string; nombreConjunto: string; variables: string[];
  auc: Resumen; accuracy: Resumen; f1: Resumen; logLoss: Resumen; brier: Resumen; nAjustes: number;
}

const resultados: ResultadoExperimento[] = [];
const roc: Record<string, [number, number][]> = {};
const calib: Record<string, ReturnType<typeof calibracion>> = {};

for (const exp of EXPERIMENTOS) {
  const conjunto = CONJUNTOS.find((c) => c.clave === exp.conjunto)!;
  const { X, y, nombres } = construirMatriz(filas, conjunto);
  const porFold: MetricasClasificacion[] = [];
  const oof = new Array<number>(y.length).fill(NaN);

  for (let r = 0; r < REPETICIONES; r++) {
    const folds = kFoldEstratificado(y, K, SEMILLA + r);
    for (const test of folds) {
      const train = complemento(y.length, test);
      const p = exp.predictor(train.map((i) => X[i]), train.map((i) => y[i]), test.map((i) => X[i]));
      porFold.push(metricas(test.map((i) => y[i]), p));
      if (r === 0) test.forEach((i, k) => { oof[i] = p[k]; });
    }
  }
  const resumen = (k: keyof MetricasClasificacion) => mediaSd(porFold.map((m) => m[k] as number));
  resultados.push({
    clave: exp.clave, modelo: exp.modelo, conjunto: exp.conjunto, nombreConjunto: conjunto.nombre, variables: nombres,
    auc: resumen("auc"), accuracy: resumen("accuracy"), f1: resumen("f1"), logLoss: resumen("logLoss"), brier: resumen("brier"),
    nAjustes: porFold.length,
  });
  roc[exp.clave] = curvaROC(y, oof);
  calib[exp.clave] = calibracion(y, oof);
}

const pad = (s: string, n: number) => s.padEnd(n);
console.log("━━ Validación cruzada (media ± sd sobre " + resultados[0].nAjustes + " ajustes)");
console.log(pad("Modelo", 24) + pad("Variables", 42) + pad("AUC", 16) + pad("Accuracy", 16) + pad("F1", 16) + pad("log-loss", 16) + "Brier");
for (const r of resultados) {
  const ms = (x: Resumen) => `${f(x.media)} ± ${f(x.sd)}`;
  console.log(pad(r.modelo, 24) + pad(r.nombreConjunto, 42) + pad(ms(r.auc), 16) + pad(ms(r.accuracy), 16) + pad(ms(r.f1), 16) + pad(ms(r.logLoss), 16) + ms(r.brier));
}

// ─── coeficientes interpretables (clínico básico, todos los datos) ───────────

const basico = CONJUNTOS.find((c) => c.clave === "clinico_basico")!;
const { X: Xb, y: yb, nombres: nb } = construirMatriz(filas, basico);
const estB = estandarizador(Xb);
const modeloB = entrenarLogistica(estB.aplicar(Xb), yb, { lambda: LAMBDA });
const orig = coeficientesOriginales(modeloB, estB);
const ESCALA: Record<string, { por: string; factor: number }> = {
  age: { por: "+10 años", factor: 10 },
  sex: { por: "hombre vs. mujer", factor: 1 },
  trestbps: { por: "+10 mm Hg", factor: 10 },
  chol: { por: "+10 mg/dl", factor: 10 },
  fbs: { por: "glucemia > 120 vs. no", factor: 1 },
  thalach: { por: "+10 bpm (FC máx.)", factor: 10 },
};
const coeficientes = nb.map((nombre, j) => {
  const b = orig.beta[j + 1];
  const se = orig.errorEstandar[j + 1];
  const esc = ESCALA[nombre];
  const z = 1.959964;
  return {
    variable: nombre, beta: b, errorEstandar: se, p: 2 * (1 - normalCdf(Math.abs(b / se))),
    orPor: esc.por, or: Math.exp(b * esc.factor),
    ic95: [Math.exp((b - z * se) * esc.factor), Math.exp((b + z * se) * esc.factor)] as [number, number],
  };
});
console.log(`\n━━ Coeficientes de la logística "clínico básico" ajustada a los ${filas.length} pacientes (IRLS, ${modeloB.iteraciones} iteraciones, ${modeloB.convergio ? "convergió" : "NO convergió"})`);
console.log(pad("Variable", 12) + pad("β (escala original)", 22) + pad("OR", 10) + pad("IC 95 %", 20) + pad("por", 24) + "p");
for (const c of coeficientes) {
  console.log(pad(c.variable, 12) + pad(`${f(c.beta, 4)} ± ${f(c.errorEstandar, 4)}`, 22) + pad(f(c.or, 2), 10) + pad(`${f(c.ic95[0], 2)} – ${f(c.ic95[1], 2)}`, 20) + pad(c.orPor, 24) + f(c.p, 4));
}
console.log(`intercepto ${f(orig.beta[0], 3)} · log-verosimilitud ${f(modeloB.logVerosimilitud, 2)}`);
console.log("Referencias del índice de Pulso: edad ×2 por década (ln2/10 por año), sexo masculino ×1.5. Cohorte de derivación cardiológica: los OR describen ese grupo, no riesgo poblacional.");

function normalCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return x >= 0 ? 0.5 + y / 2 : 0.5 - y / 2;
}

// ─── salida ──────────────────────────────────────────────────────────────────

if (SALIDA) {
  const salida = {
    dataset: {
      nombre: "UCI Heart Disease (Cleveland)", n: filas.length, positivos, descartadas,
      fuente: "https://archive.ics.uci.edu/dataset/45/heart+disease", licencia: "CC BY 4.0",
      cita: "Janosi, Steinbrunn, Pfisterer & Detrano (1988); Detrano et al. (1989) Am J Cardiol 64(5)",
    },
    protocolo: { kFolds: K, repeticiones: REPETICIONES, semilla: SEMILLA, lambda: LAMBDA, knnK: KNN_K, umbral: 0.5 },
    resultados, roc, calibracion: calib,
    coeficientes: {
      conjunto: "clinico_basico", n: filas.length, iteraciones: modeloB.iteraciones, convergio: modeloB.convergio,
      logVerosimilitud: modeloB.logVerosimilitud, intercepto: orig.beta[0], filas: coeficientes,
      // para la verificación cruzada con numpy (scripts/verificar-logistica.py)
      estandarizados: { nombres: nb, beta: modeloB.beta, errorEstandar: modeloB.errorEstandar, media: estB.media, sd: estB.sd },
    },
  };
  writeFileSync(SALIDA, JSON.stringify(salida, null, 2));
  console.log(`\nResultados escritos en ${SALIDA}`);
}

void (0 as unknown as FilaUCI);
