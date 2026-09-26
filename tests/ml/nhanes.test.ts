import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ibmADouble, leerXPT } from "../../src/lib/ml/supervisado/xpt";
import { totalPHQ9, eventoCardiovascular, estresDesdePHQ9, desdeCSV, aCSV } from "../../src/lib/ml/supervisado/nhanes";
import { entrenarBoosting, predecirBoosting } from "../../src/lib/ml/supervisado/boosting";
import { entrenarLogistica, predecirProbabilidades } from "../../src/lib/ml/supervisado/logistica";
import { predecirKNN } from "../../src/lib/ml/supervisado/knn";
import { auc } from "../../src/lib/ml/supervisado/metricas";
import { crearPRNG } from "../../src/lib/ml/estadistica";

const cerca = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < tol, msg ?? `${a} no está a ${tol} de ${b}`);
const bytes = (...xs: number[]) => Uint8Array.from(xs);

test("coma flotante IBM: valores conocidos y faltantes de SAS", () => {
  assert.equal(ibmADouble(bytes(0x41, 0x10, 0, 0, 0, 0, 0, 0), 0, 8), 1);
  assert.equal(ibmADouble(bytes(0x42, 0x64, 0, 0, 0, 0, 0, 0), 0, 8), 100);
  assert.equal(ibmADouble(bytes(0xc2, 0x76, 0xa0, 0, 0, 0, 0, 0), 0, 8), -118.625);
  cerca(ibmADouble(bytes(0x40, 0x19, 0x99, 0x99, 0x99, 0x99, 0x99, 0x9a), 0, 8)!, 0.1, 1e-15);
  assert.equal(ibmADouble(bytes(0, 0, 0, 0, 0, 0, 0, 0), 0, 8), 0);
  assert.equal(ibmADouble(bytes(0x2e, 0, 0, 0, 0, 0, 0, 0), 0, 8), null); // "."
  assert.equal(ibmADouble(bytes(0x41, 0, 0, 0, 0, 0, 0, 0), 0, 8), null); // ".A"
});

/** Arma un XPORT v5 mínimo con dos variables numéricas y una de caracteres. */
function xptSintetico(filas: [number | null, number, string][]): Uint8Array {
  const reg = (s: string) => s.padEnd(80, " ");
  const partes: number[] = [];
  const texto = (s: string) => { for (const c of s) partes.push(c.charCodeAt(0)); };
  texto(reg("HEADER RECORD*******LIBRARY HEADER RECORD!!!!!!!000000000000000000000000000000"));
  texto(reg("SAS     SAS     SASLIB  9.4"));
  texto(reg("01JAN26:00:00:00"));
  texto(reg("HEADER RECORD*******MEMBER  HEADER RECORD!!!!!!!000000000000000001600000000140"));
  texto(reg("HEADER RECORD*******DSCRPTR HEADER RECORD!!!!!!!000000000000000000000000000000"));
  texto(reg("SAS     PRUEBA  SASDATA 9.4"));
  texto(reg("01JAN26:00:00:00"));
  texto(reg("HEADER RECORD*******NAMESTR HEADER RECORD!!!!!!!000000000300000000000000000000"));
  const vars = [
    { tipo: 1, largo: 8, nombre: "SEQN", etiqueta: "Id", pos: 0 },
    { tipo: 1, largo: 8, nombre: "VALOR", etiqueta: "Valor", pos: 8 },
    { tipo: 2, largo: 3, nombre: "COD", etiqueta: "Codigo", pos: 16 },
  ];
  const ns: number[] = [];
  for (const v of vars) {
    const d = new Uint8Array(140);
    const dv = new DataView(d.buffer);
    dv.setInt16(0, v.tipo); dv.setInt16(4, v.largo);
    [...v.nombre.padEnd(8)].forEach((c, i) => { d[8 + i] = c.charCodeAt(0); });
    [...v.etiqueta.padEnd(40)].forEach((c, i) => { d[16 + i] = c.charCodeAt(0); });
    dv.setInt32(84, v.pos);
    ns.push(...d);
  }
  while (ns.length % 80) ns.push(0x20);
  partes.push(...ns);
  texto(reg("HEADER RECORD*******OBS     HEADER RECORD!!!!!!!000000000000000000000000000000"));
  const obs: number[] = [];
  const ibm = (x: number | null): number[] => {
    if (x === null) return [0x2e, 0, 0, 0, 0, 0, 0, 0];
    if (x === 1) return [0x41, 0x10, 0, 0, 0, 0, 0, 0];
    if (x === 100) return [0x42, 0x64, 0, 0, 0, 0, 0, 0];
    if (x === -118.625) return [0xc2, 0x76, 0xa0, 0, 0, 0, 0, 0];
    throw new Error("valor sin codificar en el test");
  };
  for (const [a, b, c] of filas) {
    obs.push(...ibm(a), ...ibm(b));
    for (const ch of c.padEnd(3)) obs.push(ch.charCodeAt(0));
  }
  while (obs.length % 80) obs.push(0x20);
  partes.push(...obs);
  return Uint8Array.from(partes);
}

test("leerXPT: cabeceras, descriptores y observaciones de un archivo sintético", () => {
  const t = leerXPT(xptSintetico([[1, 100, "AB"], [100, -118.625, "X"], [null, 1, ""]]));
  assert.equal(t.dataset, "PRUEBA");
  assert.deepEqual(t.variables.map((v) => [v.nombre, v.tipo, v.longitud]), [["SEQN", "numerica", 8], ["VALOR", "numerica", 8], ["COD", "caracter", 3]]);
  assert.equal(t.filas.length, 3, "el relleno final de espacios no es una observación");
  assert.deepEqual(t.filas[0], { SEQN: 1, VALOR: 100, COD: "AB" });
  assert.deepEqual(t.filas[1], { SEQN: 100, VALOR: -118.625, COD: "X" });
  assert.deepEqual(t.filas[2], { SEQN: null, VALOR: 1, COD: "" });
});

test("PHQ-9, desenlace y equivalencia de estrés siguen las reglas documentadas", () => {
  const phq = (vs: (number | null)[]) => Object.fromEntries(vs.map((v, i) => [`DPQ0${i + 1}0`, v]));
  assert.equal(totalPHQ9(phq([0, 0, 0, 0, 0, 0, 0, 0, 0])), 0);
  assert.equal(totalPHQ9(phq([3, 3, 3, 3, 3, 3, 3, 3, 3])), 27);
  assert.equal(totalPHQ9(phq([1, 2, 0, 0, 1, 0, 0, 0, 0])), 4);
  assert.equal(totalPHQ9(phq([1, 7, 0, 0, 0, 0, 0, 0, 0])), null, "7 = rehusó");
  assert.equal(totalPHQ9(phq([1, null, 0, 0, 0, 0, 0, 0, 0])), null);

  const mcq = (vs: (number | null)[]) => Object.fromEntries(["B", "C", "D", "E", "F"].map((l, i) => [`MCQ160${l}`, vs[i]]));
  assert.equal(eventoCardiovascular(mcq([2, 2, 2, 2, 2])), 0);
  assert.equal(eventoCardiovascular(mcq([2, 2, 1, 2, 2])), 1);
  assert.equal(eventoCardiovascular(mcq([9, 1, null, null, null])), 1);
  assert.equal(eventoCardiovascular(mcq([9, 2, null, null, null])), 0);
  assert.equal(eventoCardiovascular(mcq([9, 9, 7, null, null])), null);
  assert.equal(eventoCardiovascular(undefined), null);

  assert.equal(estresDesdePHQ9(0), 1);
  assert.equal(estresDesdePHQ9(27), 10);
  assert.equal(estresDesdePHQ9(4), 2);
});

test("la muestra analítica versionada es la documentada (n = 5043, 597 eventos)", () => {
  const csv = readFileSync(path.join(process.cwd(), "data", "nhanes-2021-2023", "muestra-analitica.csv"), "utf8");
  const filas = desdeCSV(csv);
  assert.equal(filas.length, 5043);
  assert.equal(filas.filter((f) => f.evento === 1).length, 597);
  assert.ok(filas.every((f) => f.edad >= 18 && f.phq9 >= 0 && f.phq9 <= 27 && (f.evento === 0 || f.evento === 1)));
  cerca(filas.reduce((s, f) => s + f.edad, 0) / filas.length, 53.6, 0.05);
  assert.equal(aCSV(filas), csv, "ida y vuelta CSV sin pérdida");
});

test("gradient boosting aprende una interacción que la logística no puede representar", () => {
  const rng = crearPRNG(11);
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < 1200; i++) {
    const a = rng.uniforme() * 2 - 1, b = rng.uniforme() * 2 - 1;
    X.push([a, b, rng.normal()]);
    const p = (a > 0) !== (b > 0) ? 0.9 : 0.1; // XOR con ruido
    y.push(rng.uniforme() < p ? 1 : 0);
  }
  const tr = { X: X.slice(0, 800), y: y.slice(0, 800) };
  const te = { X: X.slice(800), y: y.slice(800) };
  const gb = entrenarBoosting(tr.X, tr.y);
  const pg = predecirBoosting(gb, te.X);
  const lg = entrenarLogistica(tr.X, tr.y);
  const pl = predecirProbabilidades(lg, te.X);
  assert.ok(auc(te.y, pg) > 0.8, `AUC boosting ${auc(te.y, pg)}`);
  assert.ok(auc(te.y, pl) < 0.6, `AUC logística ${auc(te.y, pl)}`);
  assert.ok(pg.every((p) => p > 0 && p < 1));

  const sinArboles = predecirBoosting(entrenarBoosting(tr.X, tr.y, { arboles: 0 }), te.X);
  const prev = tr.y.reduce((a, b) => a + b, 0) / tr.y.length;
  sinArboles.forEach((p) => cerca(p, prev, 1e-9));
});

test("k-NN con selección parcial coincide con el ordenamiento completo, incluso con empates", () => {
  const rng = crearPRNG(5);
  const Xtr = Array.from({ length: 300 }, () => [rng.entero(0, 3), rng.entero(0, 3)]);
  const ytr = Xtr.map(() => (rng.uniforme() < 0.4 ? 1 : 0));
  const Xte = Array.from({ length: 50 }, () => [rng.entero(0, 3), rng.entero(0, 3)]);
  const referencia = Xte.map((x) => {
    const d = Xtr.map((t, i) => ({ d: (x[0] - t[0]) ** 2 + (x[1] - t[1]) ** 2, y: ytr[i] }));
    d.sort((a, b) => a.d - b.d);
    return d.slice(0, 15).reduce((s, v) => s + v.y, 0) / 15;
  });
  assert.deepEqual(predecirKNN(Xtr, ytr, Xte, 15), referencia);
});
