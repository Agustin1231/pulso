#!/usr/bin/env node
/**
 * Experimento supervisado sobre NHANES 2021-2023 con las variables que captura
 * Pulso. Todo el modelado es propio (src/lib/ml/supervisado), sin librerías.
 *
 *   npm run entrenar:nhanes [-- --json docs/entrenamiento-nhanes.json --semilla 42 --repeticiones 10]
 *
 * Qué se compara, sobre las mismas particiones:
 *   · benchmarks sin información (prevalencia) y demográfico (solo edad y sexo);
 *   · puntajes SIN entrenamiento: la heurística v1 de la app y el índice actual
 *     del motor (coeficientes de literatura), solos y con el contexto edad/sexo;
 *   · modelos ENTRENADOS: regresión logística (IRLS), gradient boosting y k-NN.
 *
 * Protocolo: validación cruzada estratificada 5 × 10 (50 ajustes por modelo);
 * la estandarización se calcula en cada partición de entrenamiento. Sobre las
 * predicciones fuera de muestra de la primera repetición se calculan la curva
 * ROC, la calibración, el umbral de Youden y el bootstrap de las diferencias de
 * AUC. Al final se replica la especificación de la versión 4 del documento
 * (partición 70/30) para trazar sus cifras.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { desdeCSV, matrizNHANES, CONJUNTOS_NHANES, estresDesdePHQ9 } from "../src/lib/ml/supervisado/nhanes";
import type { FilaNHANES } from "../src/lib/ml/supervisado/nhanes";
import { entrenarLogistica, predecirProbabilidades, estandarizador, coeficientesOriginales } from "../src/lib/ml/supervisado/logistica";
import { entrenarBoosting, predecirBoosting } from "../src/lib/ml/supervisado/boosting";
import { predecirKNN } from "../src/lib/ml/supervisado/knn";
import { auc, curvaROC } from "../src/lib/ml/supervisado/metricas";
import { kFoldEstratificado, complemento, mediaSd } from "../src/lib/ml/supervisado/validacion";
import type { Matriz } from "../src/lib/ml/supervisado/algebra";
import { calcularIndice } from "../src/lib/ml/riesgo/indice";
import { FACTORES, logRREdad, logRRSexo } from "../src/lib/ml/riesgo/factores";
import { getEstado } from "../src/lib/metricas-config";
import { cdfNormal, crearPRNG, cuantil } from "../src/lib/ml/estadistica";

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const SEMILLA = Number(arg("semilla") ?? 42);
const REPETICIONES = Number(arg("repeticiones") ?? 10);
const K = 5;
const LAMBDA = 0.01;
const GB = { arboles: 100, tasa: 0.1, profundidad: 3 };
const BOOTSTRAP = 2000;
const SALIDA = arg("json");

const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const pct = (x: number, d = 1) => `${(100 * x).toFixed(d)} %`;
const pad = (s: string, n: number) => s.padEnd(n);

// ─── datos ───────────────────────────────────────────────────────────────────

const ruta = path.join(process.cwd(), "data", "nhanes-2021-2023", "muestra-analitica.csv");
const filas = desdeCSV(readFileSync(ruta, "utf8"));
const y = filas.map((r) => r.evento);
const n = filas.length;
const positivos = y.reduce((a, b) => a + b, 0);
const KNN_K = 2 * Math.round(Math.sqrt(n * (1 - 1 / K)) / 2) + 1; // ≈ √n_entrenamiento, impar

console.log(`NHANES 2021-2023: ${n} adultos, ${positivos} con antecedente cardiovascular (${pct(positivos / n)})`);
console.log(`Protocolo: ${K}-fold estratificado × ${REPETICIONES} repeticiones, semilla ${SEMILLA}, ridge λ=${LAMBDA}, boosting ${GB.arboles} árboles × prof. ${GB.profundidad} × ν ${GB.tasa}, k-NN k=${KNN_K}\n`);

// ─── descriptiva por grupo ───────────────────────────────────────────────────

const VARIABLES_DESC: { clave: keyof FilaNHANES; nombre: string; binaria?: boolean }[] = [
  { clave: "edad", nombre: "Edad (años)" },
  { clave: "hombre", nombre: "Hombres", binaria: true },
  { clave: "fc", nombre: "FC en reposo (lpm)" },
  { clave: "imc", nombre: "IMC (kg/m²)" },
  { clave: "peso", nombre: "Peso (kg)" },
  { clave: "sueno", nombre: "Sueño (h)" },
  { clave: "phq9", nombre: "PHQ-9 (0–27)" },
  { clave: "fumador", nombre: "Fumador actual", binaria: true },
];
const grupos = { total: filas, conEvento: filas.filter((r) => r.evento === 1), sinEvento: filas.filter((r) => r.evento === 0) };
const descriptiva = VARIABLES_DESC.map((v) => {
  const resumen = (g: FilaNHANES[]) => mediaSd(g.map((r) => Number(r[v.clave])));
  return { variable: v.nombre, binaria: !!v.binaria, total: resumen(grupos.total), conEvento: resumen(grupos.conEvento), sinEvento: resumen(grupos.sinEvento) };
});
console.log("━━ Caracterización de la muestra (media ± sd; proporción en binarias)");
console.log(pad("Variable", 22) + pad(`Total (n=${n})`, 20) + pad(`Con evento (n=${grupos.conEvento.length})`, 24) + `Sin evento (n=${grupos.sinEvento.length})`);
for (const d of descriptiva) {
  const fmt = (r: { media: number; sd: number }) => (d.binaria ? pct(r.media) : `${f(r.media, 1)} ± ${f(r.sd, 1)}`);
  console.log(pad(d.variable, 22) + pad(fmt(d.total), 20) + pad(fmt(d.conEvento), 24) + fmt(d.sinEvento));
}
const fumadorDesconocido = filas.filter((r) => !r.fumadorConocido).length;
console.log(`(tabaquismo desconocido en ${fumadorDesconocido} participantes: se codifican como no fumadores en los modelos y se excluyen del factor en el índice)\n`);

// ─── puntajes sin entrenamiento ──────────────────────────────────────────────

/** Heurística v1 de la app (score-client.tsx hasta el commit 3560159): puntos por umbral. */
function heuristicaV1(r: FilaNHANES): number {
  const MULT = { normal: 1, atencion: 0.55, riesgo: 0.15, "sin-datos": 0 } as const;
  const factores = [
    { puntos: 35, estado: getEstado("frecuencia_cardiaca", r.fc) },
    { puntos: 35, estado: getEstado("horas_sueno", r.sueno) },
    { puntos: 30, estado: getEstado("nivel_estres", estresDesdePHQ9(r.phq9)) },
  ];
  const ganado = factores.reduce((s, x) => s + Math.round(x.puntos * MULT[x.estado]), 0);
  return Math.round(ganado); // sobre 100 posibles
}

function indice(r: FilaNHANES) {
  return calcularIndice({
    frecuencia_cardiaca: r.fc,
    horas_sueno: r.sueno,
    nivel_estres: estresDesdePHQ9(r.phq9),
    imc: r.imc,
    tabaquismo: r.fumadorConocido ? r.fumador : null,
  }, null);
}
const indices = filas.map(indice);
const contexto = filas.map((r) => logRREdad(r.edad) + logRRSexo(r.hombre ? "m" : "f"));

// Para el AUC basta un orden: mayor valor = más riesgo.
const riesgoHeuristica = filas.map((r) => 100 - heuristicaV1(r));
const riesgoIndice = indices.map((ix) => 100 - (ix.score ?? 100));
const riesgoIndiceContexto = indices.map((ix, i) => ix.L + contexto[i]);

// Las cinco componentes del índice (log RR de cada factor) + contexto, como features.
const matrizFactores: Matriz = indices.map((ix, i) => [
  ...FACTORES.map((def) => ix.factores.find((fr) => fr.clave === def.clave)!.logRR),
  logRREdad(filas[i].edad),
  logRRSexo(filas[i].hombre ? "m" : "f"),
]);
const nombresFactores = [...FACTORES.map((d) => `logRR ${d.clave}`), "logRR edad", "logRR sexo"];

// ─── modelos ─────────────────────────────────────────────────────────────────

type Predictor = (train: number[], test: number[]) => number[];
const X = (clave: string) => matrizNHANES(filas, CONJUNTOS_NHANES.find((c) => c.clave === clave)!.columnas).X;
const MATRICES: Record<string, Matriz> = Object.fromEntries(CONJUNTOS_NHANES.map((c) => [c.clave, X(c.clave)]));
MATRICES.factores_indice = matrizFactores;

const logistica = (M: Matriz): Predictor => (train, test) => {
  const Xtr = train.map((i) => M[i]);
  const est = estandarizador(Xtr);
  const modelo = entrenarLogistica(est.aplicar(Xtr), train.map((i) => y[i]), { lambda: LAMBDA });
  return predecirProbabilidades(modelo, est.aplicar(test.map((i) => M[i])));
};
const boosting = (M: Matriz): Predictor => (train, test) => {
  const modelo = entrenarBoosting(train.map((i) => M[i]), train.map((i) => y[i]), GB);
  return predecirBoosting(modelo, test.map((i) => M[i]));
};
const knn = (M: Matriz): Predictor => (train, test) => {
  const Xtr = train.map((i) => M[i]);
  const est = estandarizador(Xtr);
  return predecirKNN(est.aplicar(Xtr), train.map((i) => y[i]), est.aplicar(test.map((i) => M[i])), KNN_K);
};
const puntaje = (s: readonly number[]): Predictor => (_train, test) => test.map((i) => s[i]);
const prevalencia: Predictor = (train, test) => {
  const p = train.reduce((a, i) => a + y[i], 0) / train.length;
  return test.map(() => p);
};

interface Experimento {
  clave: string; grupo: "benchmark" | "sin_entrenamiento" | "entrenado";
  modelo: string; variables: string; probabilistico: boolean; predictor: Predictor;
}
const EXPERIMENTOS: Experimento[] = [
  { clave: "prevalencia", grupo: "benchmark", modelo: "Prevalencia (sin información)", variables: "—", probabilistico: true, predictor: prevalencia },
  { clave: "heuristica_v1", grupo: "sin_entrenamiento", modelo: "Heurística v1 de la app", variables: "FC, sueño, estrés", probabilistico: false, predictor: puntaje(riesgoHeuristica) },
  { clave: "indice", grupo: "sin_entrenamiento", modelo: "Índice del motor (literatura)", variables: "FC, sueño, estrés, IMC, tabaco", probabilistico: false, predictor: puntaje(riesgoIndice) },
  { clave: "indice_contexto", grupo: "sin_entrenamiento", modelo: "Índice + contexto edad/sexo", variables: "Índice + edad, sexo", probabilistico: false, predictor: puntaje(riesgoIndiceContexto) },
  { clave: "log_demografico", grupo: "benchmark", modelo: "Regresión logística", variables: "Solo edad y sexo", probabilistico: true, predictor: logistica(MATRICES.demografico) },
  { clave: "log_estilo_vida", grupo: "entrenado", modelo: "Regresión logística", variables: "Estilo de vida (5)", probabilistico: true, predictor: logistica(MATRICES.estilo_vida) },
  { clave: "gb_estilo_vida", grupo: "entrenado", modelo: "Gradient boosting", variables: "Estilo de vida (5)", probabilistico: true, predictor: boosting(MATRICES.estilo_vida) },
  { clave: "log_completo", grupo: "entrenado", modelo: "Regresión logística", variables: "Estilo de vida + edad, sexo (7)", probabilistico: true, predictor: logistica(MATRICES.estilo_vida_demografico) },
  { clave: "log_factores", grupo: "entrenado", modelo: "Logística sobre factores del índice", variables: "7 log RR del motor", probabilistico: true, predictor: logistica(MATRICES.factores_indice) },
  { clave: "gb_completo", grupo: "entrenado", modelo: "Gradient boosting", variables: "Estilo de vida + edad, sexo (7)", probabilistico: true, predictor: boosting(MATRICES.estilo_vida_demografico) },
  { clave: "knn_completo", grupo: "entrenado", modelo: `k-NN (k=${KNN_K})`, variables: "Estilo de vida + edad, sexo (7)", probabilistico: true, predictor: knn(MATRICES.estilo_vida_demografico) },
];

// ─── validación cruzada repetida ─────────────────────────────────────────────

interface Resumen { media: number; sd: number }
interface ResultadoCV {
  clave: string; grupo: string; modelo: string; variables: string; probabilistico: boolean;
  auc: Resumen; brier: Resumen | null; logLoss: Resumen | null; nAjustes: number; segundos: number;
}
const particiones = Array.from({ length: REPETICIONES }, (_, r) => kFoldEstratificado(y, K, SEMILLA + r));
const resultados: ResultadoCV[] = [];
const oof: Record<string, number[]> = {};

for (const exp of EXPERIMENTOS) {
  const t0 = Date.now();
  const aucs: number[] = [], briers: number[] = [], lls: number[] = [];
  const fuera = new Array<number>(n).fill(NaN);
  particiones.forEach((folds, r) => {
    for (const test of folds) {
      const train = complemento(n, test);
      const p = exp.predictor(train, test);
      const yt = test.map((i) => y[i]);
      aucs.push(auc(yt, p));
      if (exp.probabilistico) {
        let b = 0, ll = 0;
        p.forEach((pi, k) => {
          const q = Math.min(1 - 1e-12, Math.max(1e-12, pi));
          b += (q - yt[k]) ** 2;
          ll -= yt[k] * Math.log(q) + (1 - yt[k]) * Math.log(1 - q);
        });
        briers.push(b / p.length);
        lls.push(ll / p.length);
      }
      if (r === 0) test.forEach((i, k) => { fuera[i] = p[k]; });
    }
  });
  oof[exp.clave] = fuera;
  resultados.push({
    clave: exp.clave, grupo: exp.grupo, modelo: exp.modelo, variables: exp.variables, probabilistico: exp.probabilistico,
    auc: mediaSd(aucs), brier: exp.probabilistico ? mediaSd(briers) : null, logLoss: exp.probabilistico ? mediaSd(lls) : null,
    nAjustes: aucs.length, segundos: (Date.now() - t0) / 1000,
  });
}

console.log(`━━ Validación cruzada (media ± sd sobre ${resultados[0].nAjustes} particiones de prueba)`);
console.log(pad("Modelo", 38) + pad("Variables", 34) + pad("AUC", 18) + pad("Brier", 18) + "log-loss");
for (const r of resultados) {
  const ms = (x: Resumen | null) => (x ? `${f(x.media)} ± ${f(x.sd)}` : "— (no es probabilidad)");
  console.log(pad(r.modelo, 38) + pad(r.variables, 34) + pad(ms(r.auc), 18) + pad(r.brier ? ms(r.brier) : "—", 18) + (r.logLoss ? ms(r.logLoss) : "—"));
}

// ─── bootstrap de diferencias de AUC (predicciones fuera de muestra, rep. 1) ─

const rngBoot = crearPRNG(SEMILLA + 1000);
const muestrasBoot = Array.from({ length: BOOTSTRAP }, () => Array.from({ length: n }, () => Math.floor(rngBoot.uniforme() * n)));
function deltaAUC(a: string, b: string) {
  const pa = oof[a], pb = oof[b];
  const punto = auc(y, pa) - auc(y, pb);
  const deltas = muestrasBoot.map((idx) => {
    const yb = idx.map((i) => y[i]);
    return auc(yb, idx.map((i) => pa[i])) - auc(yb, idx.map((i) => pb[i]));
  });
  const ic: [number, number] = [cuantil(deltas, 0.025), cuantil(deltas, 0.975)];
  return { a, b, delta: punto, ic95: ic, pUnilateral: deltas.filter((d) => d <= 0).length / BOOTSTRAP };
}
const COMPARACIONES: [string, string, string][] = [
  ["indice", "heuristica_v1", "¿El índice actual ordena mejor que la heurística v1?"],
  ["log_estilo_vida", "indice", "¿Entrenar con las mismas variables mejora al índice de literatura?"],
  ["log_completo", "log_demografico", "¿Las variables de la app aportan más allá de edad y sexo?"],
  ["log_completo", "indice_contexto", "¿La logística entrenada supera al índice + contexto?"],
  ["gb_completo", "log_completo", "¿El boosting captura algo que la logística no?"],
];
const deltas = COMPARACIONES.map(([a, b, pregunta]) => ({ pregunta, ...deltaAUC(a, b) }));
console.log(`\n━━ Diferencias de AUC con IC 95 % bootstrap (${BOOTSTRAP} remuestreos pareados, predicciones fuera de muestra)`);
for (const d of deltas) {
  console.log(`${pad(d.pregunta, 70)} ΔAUC ${d.delta >= 0 ? "+" : ""}${f(d.delta)}  [${f(d.ic95[0])}, ${f(d.ic95[1])}]`);
}

// ─── modelo de referencia: logística completa ────────────────────────────────

const pRef = oof.log_completo;
// Umbral de Youden sobre la curva ROC fuera de muestra.
const orden = Array.from({ length: n }, (_, i) => i).sort((a, b) => pRef[b] - pRef[a]);
let mejorJ = -1, umbralYouden = 0.5, sens = 0, espec = 0;
{
  let tp = 0, fp = 0;
  const nNeg = n - positivos;
  for (let k = 0; k < n; k++) {
    if (y[orden[k]] === 1) tp++; else fp++;
    if (k + 1 < n && pRef[orden[k + 1]] === pRef[orden[k]]) continue;
    const j = tp / positivos - fp / nNeg;
    if (j > mejorJ) { mejorJ = j; umbralYouden = pRef[orden[k]]; sens = tp / positivos; espec = 1 - fp / nNeg; }
  }
}
let vp = 0, fpos = 0, vn = 0, fneg = 0;
for (let i = 0; i < n; i++) {
  const pred = pRef[i] >= umbralYouden;
  if (pred && y[i]) vp++; else if (pred) fpos++; else if (y[i]) fneg++; else vn++;
}

// Calibración por deciles de riesgo predicho + pendiente e intercepto de calibración.
const porRiesgo = Array.from({ length: n }, (_, i) => i).sort((a, b) => pRef[a] - pRef[b]);
const deciles = Array.from({ length: 10 }, (_, d) => {
  const idx = porRiesgo.slice(Math.floor((d * n) / 10), Math.floor(((d + 1) * n) / 10));
  return {
    decil: d + 1, n: idx.length,
    predicha: idx.reduce((s, i) => s + pRef[i], 0) / idx.length,
    observada: idx.reduce((s, i) => s + y[i], 0) / idx.length,
  };
});
const logit = (p: number) => Math.log(p / (1 - p));
const recal = entrenarLogistica(pRef.map((p) => [logit(Math.min(1 - 1e-9, Math.max(1e-9, p)))]), y, { lambda: 0 });
const brierRef = resultados.find((r) => r.clave === "log_completo")!.brier!.media;
const brierPrev = resultados.find((r) => r.clave === "prevalencia")!.brier!.media;

console.log(`\n━━ Regresión logística "estilo de vida + edad y sexo": desempeño fuera de muestra (repetición 1)`);
console.log(`AUC ${f(auc(y, pRef))} · Brier ${f(brierRef, 4)} vs. ${f(brierPrev, 4)} de la prevalencia (Brier skill ${pct(1 - brierRef / brierPrev)})`);
console.log(`Umbral de Youden ${f(umbralYouden)} → sensibilidad ${f(sens)} · especificidad ${f(espec)} · VPP ${f(vp / (vp + fpos))} · VPN ${f(vn / (vn + fneg))}`);
console.log(`Calibración: pendiente ${f(recal.beta[1])} (ideal 1) · intercepto ${f(recal.beta[0])} (ideal 0) · riesgo medio predicho ${pct(pRef.reduce((a, b) => a + b, 0) / n)} vs. observado ${pct(positivos / n)}`);
console.log("Decil   n     predicho   observado");
for (const d of deciles) console.log(`${String(d.decil).padStart(5)} ${String(d.n).padStart(4)}   ${pct(d.predicha).padStart(8)}   ${pct(d.observada).padStart(8)}`);

// ─── coeficientes sobre la muestra completa ──────────────────────────────────

const Z = 1.959964;
function coeficientes(M: Matriz, nombres: string[], unidades: { por: string; factor: number }[]) {
  const est = estandarizador(M);
  const modelo = entrenarLogistica(est.aplicar(M), y, { lambda: LAMBDA });
  const orig = coeficientesOriginales(modelo, est);
  const filasCoef = nombres.map((nombre, j) => {
    const bz = modelo.beta[j + 1], sez = modelo.errorEstandar[j + 1];
    const b = orig.beta[j + 1], se = orig.errorEstandar[j + 1];
    const u = unidades[j];
    return {
      variable: nombre,
      orPorSd: Math.exp(bz), icPorSd: [Math.exp(bz - Z * sez), Math.exp(bz + Z * sez)] as [number, number],
      sd: est.sd[j],
      orPor: u.por, or: Math.exp(b * u.factor), ic95: [Math.exp((b - Z * se) * u.factor), Math.exp((b + Z * se) * u.factor)] as [number, number],
      p: 2 * (1 - cdfNormal(Math.abs(bz / sez))),
    };
  });
  return { modelo, est, orig, filas: filasCoef };
}
const colsCompleto = CONJUNTOS_NHANES.find((c) => c.clave === "estilo_vida_demografico")!.columnas as string[];
const UNIDADES: Record<string, { nombre: string; por: string; factor: number }> = {
  fc: { nombre: "FC en reposo", por: "+10 lpm", factor: 10 },
  imc: { nombre: "IMC", por: "+5 kg/m²", factor: 5 },
  sueno: { nombre: "Sueño", por: "+1 h", factor: 1 },
  phq9: { nombre: "PHQ-9", por: "+5 puntos", factor: 5 },
  fumador: { nombre: "Fumador actual", por: "sí vs. no", factor: 1 },
  edad: { nombre: "Edad", por: "+10 años", factor: 10 },
  hombre: { nombre: "Sexo masculino", por: "hombre vs. mujer", factor: 1 },
};
const coefCompleto = coeficientes(MATRICES.estilo_vida_demografico, colsCompleto.map((c) => UNIDADES[c].nombre), colsCompleto.map((c) => UNIDADES[c]));
console.log(`\n━━ Coeficientes de la logística "estilo de vida + edad y sexo" ajustada a los ${n} adultos (IRLS, ${coefCompleto.modelo.iteraciones} iteraciones, ${coefCompleto.modelo.convergio ? "convergió" : "NO convergió"})`);
console.log(pad("Variable", 18) + pad("OR por 1 sd", 12) + pad("IC 95 %", 16) + pad("OR", 8) + pad("IC 95 %", 16) + pad("por", 18) + "p");
for (const c of coefCompleto.filas) {
  console.log(pad(c.variable, 18) + pad(f(c.orPorSd, 2), 12) + pad(`${f(c.icPorSd[0], 2)} – ${f(c.icPorSd[1], 2)}`, 16) + pad(f(c.or, 2), 8) + pad(`${f(c.ic95[0], 2)} – ${f(c.ic95[1], 2)}`, 16) + pad(c.orPor, 18) + (c.p < 1e-4 ? "< 0.0001" : f(c.p, 4)));
}

// Pesos aprendidos para las componentes del índice: 1 = la literatura acierta la magnitud.
const coefFactores = coeficientes(matrizFactores, nombresFactores, nombresFactores.map(() => ({ por: "+1 log RR", factor: 1 })));
console.log(`\n━━ Recalibración del índice: peso aprendido para cada log RR del motor (1 = coincide con la literatura)`);
for (const c of coefFactores.filas) {
  const b = Math.log(c.or);
  const icb = [Math.log(c.ic95[0]), Math.log(c.ic95[1])];
  console.log(`${pad(c.variable, 24)} peso ${f(b, 2).padStart(6)}  IC 95 % [${f(icb[0], 2)}, ${f(icb[1], 2)}]  p ${c.p < 1e-4 ? "< 0.0001" : f(c.p, 4)}`);
}

// ─── réplica de la especificación de la versión 4 del documento ──────────────

const folds10 = kFoldEstratificado(y, 10, SEMILLA);
const test30 = [...folds10[0], ...folds10[1], ...folds10[2]];
const train70 = complemento(n, test30);
const cv5 = particiones[0];
const aucHoldout = (p: Predictor) => auc(test30.map((i) => y[i]), p(train70, test30));
const aucCV = (p: Predictor) => mediaSd(cv5.map((test) => auc(test.map((i) => y[i]), p(complemento(n, test), test)))).media;
const replica = [
  { modelo: "Heurística v1", variables: "FC, sueño, estrés", predictor: puntaje(riesgoHeuristica), cv: false },
  { modelo: "Regresión logística", variables: "Especificación v4 (FC, peso, IMC, sueño, PHQ-9)", predictor: logistica(MATRICES.v4_app), cv: true },
  { modelo: "Gradient boosting", variables: "Especificación v4 (FC, peso, IMC, sueño, PHQ-9)", predictor: boosting(MATRICES.v4_app), cv: true },
  { modelo: "Regresión logística", variables: "Especificación v4 + edad y sexo", predictor: logistica(MATRICES.v4_app_demografico), cv: true },
  { modelo: "Gradient boosting", variables: "Especificación v4 + edad y sexo", predictor: boosting(MATRICES.v4_app_demografico), cv: true },
].map((r) => ({ modelo: r.modelo, variables: r.variables, aucPrueba: aucHoldout(r.predictor), aucCV: r.cv ? aucCV(r.predictor) : null }));
console.log(`\n━━ Réplica de la especificación de la versión 4 (partición estratificada 70/30: prueba n=${test30.length}; VC de 5 particiones)`);
for (const r of replica) console.log(`${pad(r.modelo, 22)} ${pad(r.variables, 50)} AUC prueba ${f(r.aucPrueba)} · AUC VC ${r.aucCV === null ? "—" : f(r.aucCV)}`);

// ─── salida ──────────────────────────────────────────────────────────────────

if (SALIDA) {
  const flujo = JSON.parse(readFileSync(path.join(process.cwd(), "data", "nhanes-2021-2023", "flujo.json"), "utf8"));
  const salida = {
    dataset: {
      nombre: "NHANES agosto 2021 – agosto 2023 (CDC/NCHS)", n, positivos, prevalencia: positivos / n,
      fuente: "https://wwwn.cdc.gov/nchs/nhanes/continuousnhanes/default.aspx?Cycle=2021-2023", licencia: "Dominio público (gobierno de EE. UU.)",
      flujo: flujo.flujo, archivos: flujo.archivos, fumadorDesconocido,
    },
    protocolo: { kFolds: K, repeticiones: REPETICIONES, semilla: SEMILLA, lambda: LAMBDA, boosting: GB, knnK: KNN_K, bootstrap: BOOTSTRAP },
    descriptiva, resultados, deltas,
    referencia: {
      modelo: "log_completo", auc: auc(y, pRef), brier: brierRef, brierPrevalencia: brierPrev,
      youden: { umbral: umbralYouden, sensibilidad: sens, especificidad: espec, vpp: vp / (vp + fpos), vpn: vn / (vn + fneg) },
      calibracion: { pendiente: recal.beta[1], intercepto: recal.beta[0], deciles },
    },
    roc: Object.fromEntries(["heuristica_v1", "indice", "indice_contexto", "log_demografico", "log_estilo_vida", "log_completo", "gb_completo"].map((k) => [k, submuestrear(curvaROC(y, oof[k]))])),
    coeficientes: {
      completo: { filas: coefCompleto.filas, intercepto: coefCompleto.orig.beta[0], iteraciones: coefCompleto.modelo.iteraciones, convergio: coefCompleto.modelo.convergio, logVerosimilitud: coefCompleto.modelo.logVerosimilitud,
        estandarizados: { nombres: colsCompleto, beta: coefCompleto.modelo.beta, errorEstandar: coefCompleto.modelo.errorEstandar, media: coefCompleto.est.media, sd: coefCompleto.est.sd } },
      factoresIndice: { filas: coefFactores.filas.map((c) => ({ variable: c.variable, peso: Math.log(c.or), ic95: [Math.log(c.ic95[0]), Math.log(c.ic95[1])], p: c.p })) },
    },
    replicaV4: { nPrueba: test30.length, filas: replica },
  };
  writeFileSync(SALIDA, JSON.stringify(salida, null, 2) + "\n");
  console.log(`\nResultados escritos en ${SALIDA}`);
}

/** La curva ROC completa tiene miles de puntos; para graficar alcanzan ~200. */
function submuestrear(puntos: [number, number][]): [number, number][] {
  if (puntos.length <= 200) return puntos;
  const paso = (puntos.length - 1) / 199;
  return Array.from({ length: 200 }, (_, i) => puntos[Math.round(i * paso)]);
}
