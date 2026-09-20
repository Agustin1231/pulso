import { test } from "node:test";
import assert from "node:assert/strict";
import { cusum } from "../../src/lib/ml/anomalias/cusum";
import { ewma } from "../../src/lib/ml/anomalias/ewma";
import { generarSerie } from "../../src/lib/ml/sintetico";
import { diasEntre, sumarDias } from "../../src/lib/ml/series";

const INICIO = "2026-06-01";

test("CUSUM detecta un salto de +3σ en pocas observaciones y estima el día del cambio", () => {
  const { serie } = generarSerie({
    dias: 40, nivel: 70, sigma: 3, cambioRegimen: { dia: 20, delta: 9 }, semilla: 21, decimales: 0, inicio: INICIO,
  });
  const alertas = cusum(serie, "frecuencia_cardiaca");
  assert.ok(alertas.length >= 1, "sin alertas");
  const a = alertas[0];
  assert.equal(a.direccion, "sube");
  const diaCambio = sumarDias(INICIO, 20);
  assert.ok(diasEntre(diaCambio, a.detectadaEn) <= 5, `retraso ${diasEntre(diaCambio, a.detectadaEn)} días`);
  assert.ok(Math.abs(diasEntre(diaCambio, a.desde)) <= 3, `desde ${a.desde}`);
  assert.ok(a.severidad === "alta" || a.severidad === "atencion");
  assert.ok(a.magnitud > 5, `magnitud ${a.magnitud}`);
  assert.match(a.mensaje, /subió/);
});

test("EWMA detecta el mismo salto en ≤ 8 observaciones", () => {
  const { serie } = generarSerie({
    dias: 40, nivel: 70, sigma: 3, cambioRegimen: { dia: 20, delta: 9 }, semilla: 21, decimales: 0, inicio: INICIO,
  });
  const alertas = ewma(serie, "frecuencia_cardiaca");
  assert.ok(alertas.length >= 1, "sin alertas");
  assert.equal(alertas[0].direccion, "sube");
  assert.ok(diasEntre(sumarDias(INICIO, 20), alertas[0].detectadaEn) <= 8);
});

test("una caída sostenida de sueño es adversa; una baja de FC es solo informativa", () => {
  const sueno = generarSerie({
    dias: 40, nivel: 7.5, sigma: 0.5, cambioRegimen: { dia: 20, delta: -1.5 }, semilla: 3, decimales: 2, inicio: INICIO,
  }).serie;
  const fc = generarSerie({
    dias: 40, nivel: 75, sigma: 3, cambioRegimen: { dia: 20, delta: -9 }, semilla: 3, decimales: 0, inicio: INICIO,
  }).serie;
  const aS = cusum(sueno, "horas_sueno");
  const aF = cusum(fc, "frecuencia_cardiaca");
  assert.ok(aS.length >= 1 && aS[0].direccion === "baja" && aS[0].severidad !== "info");
  assert.ok(aF.length >= 1 && aF[0].direccion === "baja" && aF[0].severidad === "info");
});

test("tasa de falsas alarmas: a lo sumo una cada 200 días estables, en promedio sobre 40 series", () => {
  let c = 0;
  let e = 0;
  const N = 40;
  for (let s = 0; s < N; s++) {
    const { serie } = generarSerie({ dias: 200, nivel: 70, sigma: 3, semilla: 700 + s, decimales: 0, inicio: INICIO });
    c += cusum(serie, "frecuencia_cardiaca").length;
    e += ewma(serie, "frecuencia_cardiaca").length;
  }
  assert.ok(c / N <= 1, `CUSUM: ${(c / N).toFixed(2)} falsas alarmas por serie`);
  assert.ok(e / N <= 1, `EWMA: ${(e / N).toFixed(2)} falsas alarmas por serie`);
});

test("un outlier aislado no dispara las cartas", () => {
  const y = Array.from({ length: 40 }, (_, i) => 70 + [1, -2, 0, 2, -1, 0, 1, -1, 2, 0][i % 10]);
  y[25] = 95;
  const serie = { dias: y.map((_, i) => sumarDias(INICIO, i)), y, n: 40, cobertura: 1 };
  assert.deepEqual(cusum(serie, "frecuencia_cardiaca"), []);
  assert.deepEqual(ewma(serie, "frecuencia_cardiaca"), []);
});

test("con menos de 15 registros no hay alertas", () => {
  const { serie } = generarSerie({ dias: 14, nivel: 70, sigma: 3, semilla: 1, decimales: 0 });
  assert.deepEqual(cusum(serie, "frecuencia_cardiaca"), []);
  assert.deepEqual(ewma(serie, "frecuencia_cardiaca"), []);
});

test("un desvío persistente se consolida en una sola alerta que llega hasta el final", () => {
  const { serie } = generarSerie({
    dias: 60, nivel: 70, sigma: 3, cambioRegimen: { dia: 20, delta: 9 }, semilla: 9, decimales: 0, inicio: INICIO,
  });
  const alertas = cusum(serie, "frecuencia_cardiaca");
  assert.equal(alertas.length, 1, JSON.stringify(alertas.map((a) => [a.desde, a.detectadaEn])));
  assert.ok(diasEntre(sumarDias(INICIO, 20), alertas[0].detectadaEn) <= 5, "detección tardía");
  assert.ok(diasEntre(alertas[0].hasta, sumarDias(INICIO, 59)) <= 5, "no llegó hasta el final");
});

test("σ mínima evita alarmas por variaciones triviales en series casi constantes", () => {
  const y = Array.from({ length: 30 }, (_, i) => (i < 14 ? 70 : 71));
  const serie = { dias: y.map((_, i) => sumarDias(INICIO, i)), y, n: 30, cobertura: 1 };
  assert.deepEqual(cusum(serie, "frecuencia_cardiaca"), []);
});
