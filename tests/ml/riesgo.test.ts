import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularIndice, armarValores, etiquetaScore, imc } from "../../src/lib/ml/riesgo/indice";
import { FRECUENCIA_CARDIACA, HORAS_SUENO, NIVEL_ESTRES, IMC, TABAQUISMO, FACTORES } from "../../src/lib/ml/riesgo/factores";
import { proyectarIndice } from "../../src/lib/ml/riesgo/proyeccion";
import type { Prediccion } from "../../src/lib/ml/tipos";

const cerca = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < tol, msg ?? `${a} no está a ${tol} de ${b}`);

const REFERENCIA = { frecuencia_cardiaca: 62, horas_sueno: 7.5, nivel_estres: 2, imc: 22, tabaquismo: 0 };

test("todo en referencia ⇒ score 100, riesgo relativo 1", () => {
  const r = calcularIndice(REFERENCIA, { edad: 30 });
  assert.equal(r.score, 100);
  assert.equal(r.riesgoRelativo, 1);
  assert.equal(r.etiqueta, "Excelente");
  assert.equal(r.cobertura.disponibles, 5);
  assert.equal(r.insuficiente, false);
});

test("formas de las funciones de riesgo", () => {
  const ln = Math.log;
  assert.equal(HORAS_SUENO.logRR(7.5), 0);
  cerca(HORAS_SUENO.logRR(5), ln(1.48), 1e-12);
  cerca(HORAS_SUENO.logRR(10), ln(1.38), 1e-12);
  assert.ok(HORAS_SUENO.logRR(4) > HORAS_SUENO.logRR(5));
  assert.ok(HORAS_SUENO.logRR(11) > HORAS_SUENO.logRR(10));
  assert.equal(FRECUENCIA_CARDIACA.logRR(60), 0);
  cerca(FRECUENCIA_CARDIACA.logRR(80), ln(1.09), 1e-12);
  cerca(FRECUENCIA_CARDIACA.logRR(100), 3 * ln(1.09), 1e-12);
  assert.ok(FRECUENCIA_CARDIACA.logRR(40) > 0 && FRECUENCIA_CARDIACA.logRR(40) < FRECUENCIA_CARDIACA.logRR(100));
  assert.equal(NIVEL_ESTRES.logRR(3), 0);
  cerca(NIVEL_ESTRES.logRR(10), ln(1.27), 1e-12);
  assert.equal(IMC.logRR(22), 0);
  cerca(IMC.logRR(30), ln(1.39), 1e-12);
  assert.equal(IMC.logRR(40), IMC.logRR(45), "IMC se satura en 40");
  cerca(TABAQUISMO.logRR(1), ln(2.5), 1e-12);
  assert.equal(TABAQUISMO.logRR(0), 0);
  for (const f of FACTORES) assert.equal(f.logRR((f.referencia[0] + f.referencia[1]) / 2), 0, f.clave);
});

test("la atribución por factor es exacta y aditiva", () => {
  const r = calcularIndice(
    { frecuencia_cardiaca: 85, horas_sueno: 5.5, nivel_estres: 7, imc: 29, tabaquismo: 1 },
    null
  );
  assert.ok(r.score !== null && r.score < 60, `score ${r.score}`);
  const perdidos = r.factores.reduce((s, f) => s + f.puntosPerdidos, 0);
  cerca(perdidos, 100 - (r.score as number), 0.51, "Σ puntos perdidos ≠ 100 − score");
  const maximos = r.factores.reduce((s, f) => s + f.maxPuntos, 0);
  cerca(maximos, 100, 1e-9);
  for (const f of r.factores) assert.ok(f.puntosPerdidos <= f.maxPuntos + 1e-9, f.clave);
});

test("un factor sin datos se excluye de L y de L_max", () => {
  const a = calcularIndice({ frecuencia_cardiaca: 85, horas_sueno: 5.5 }, null);
  const b = calcularIndice({ frecuencia_cardiaca: 85, horas_sueno: 5.5, imc: 22 }, null);
  assert.ok(a.LMax < b.LMax);
  assert.equal(a.L, b.L);
  assert.equal(a.cobertura.disponibles, 2);
  assert.equal(a.factores.find((f) => f.clave === "imc")!.estado, "sin-datos");
});

test("fumar cuesta ln(2.5)/L_max del score, con todo lo demás igual", () => {
  const no = calcularIndice({ ...REFERENCIA, frecuencia_cardiaca: 80 }, null);
  const si = calcularIndice({ ...REFERENCIA, frecuencia_cardiaca: 80, tabaquismo: 1 }, null);
  assert.equal(no.LMax, si.LMax);
  const esperado = (100 * Math.log(2.5)) / si.LMax;
  cerca((no.score as number) - (si.score as number), esperado, 1.01);
});

test("la edad y el sexo no cambian el score pero sí el contexto", () => {
  const v = { ...REFERENCIA, horas_sueno: 6 };
  const joven = calcularIndice(v, { edad: 30, sexo: "f" });
  const mayor = calcularIndice(v, { edad: 70, sexo: "m" });
  assert.equal(joven.score, mayor.score);
  cerca(joven.contexto.multiplicador as number, 1, 1e-9);
  cerca(mayor.contexto.multiplicador as number, 8 * 1.5, 0.05);
  assert.equal(calcularIndice(v, null).contexto.multiplicador, null);
});

test("con un solo factor el índice es insuficiente", () => {
  const r = calcularIndice({ frecuencia_cardiaca: 70 }, null);
  assert.equal(r.insuficiente, true);
  assert.equal(r.score, null);
  assert.equal(r.etiqueta, "Sin datos");
  assert.equal(etiquetaScore(84), "Muy bueno");
  assert.equal(etiquetaScore(39), "En riesgo");
});

test("armarValores calcula IMC y tabaquismo desde el perfil", () => {
  const v = armarValores({ peso: 80 }, { alturaCm: 180, fumador: true });
  cerca(v.imc as number, 24.69, 0.01);
  assert.equal(v.tabaquismo, 1);
  assert.equal(armarValores({ peso: 80 }, null).imc, null);
  assert.equal(armarValores({}, { fumador: null }).tabaquismo, null);
  assert.equal(imc(0, 180), null);
});

test("proyección: un pronóstico que mejora da delta > 0 y un IC que contiene el central", () => {
  const actual = { frecuencia_cardiaca: 90, horas_sueno: 6, nivel_estres: 5, peso: 90 };
  const perfil = { alturaCm: 175, fumador: false };
  const pred = (media: number, lo: number, hi: number): Prediccion => ({
    h: 30, t: 100, fecha: "2026-10-19", media, ic80: [lo, hi], ic95: [lo - 1, hi + 1],
  });
  const scoreActual = calcularIndice(armarValores(actual, perfil), perfil).score;
  const p = proyectarIndice(
    actual,
    { frecuencia_cardiaca: pred(75, 70, 80), horas_sueno: pred(7.2, 6.8, 7.6) },
    perfil,
    30,
    scoreActual
  );
  assert.ok(p.score !== null && p.delta !== null && p.delta > 0, JSON.stringify(p));
  assert.ok(p.ic80 && p.ic80[0] <= p.score && p.score <= p.ic80[1]);
  assert.equal(proyectarIndice(actual, {}, perfil, 30, scoreActual).score, null);
});
