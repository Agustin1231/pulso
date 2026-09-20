import { test } from "node:test";
import assert from "node:assert/strict";
import { generarInforme } from "../../src/lib/ml";
import { resumirInforme, formatearValor } from "../../src/lib/ml/resumen";
import { generarUsuario } from "../../src/lib/ml/sintetico";

test("el resumen para el prompt contiene los números del informe, con su procedencia", () => {
  const informe = generarInforme(generarUsuario(7));
  const texto = resumirInforme(informe);
  assert.match(texto, new RegExp(`Score ${informe.riesgo.score}/100`));
  assert.match(texto, /Riesgo relativo combinado/);
  assert.match(texto, /PROYECCIÓN A 30 DÍAS/);
  assert.match(texto, new RegExp(`score ${informe.proyeccion.score} \\(intervalo 80 %`));
  for (const m of Object.values(informe.metricas)) {
    assert.match(texto, new RegExp(`modelo ${m.modelo.nombre.replace(/[()]/g, "\\$&")}`));
  }
  assert.match(texto, /ALERTA \((alta|atencion|info)\)/);
  assert.match(texto, /HÁBITOS: adherencia media \d+ %/);
  assert.match(texto, /LIMITACIONES\n- /);
  assert.match(texto, /NO es una escala clínica/);
});

test("sin datos el resumen lo dice en vez de inventar", () => {
  const texto = resumirInforme(generarInforme({ metricas: {}, perfil: null, hoy: "2026-09-19" }));
  assert.match(texto, /Sin índice: 0 de 5 factores/);
  assert.match(texto, /PROYECCIÓN: no disponible/);
  assert.match(texto, /- Sin registros\./);
  assert.doesNotMatch(texto, /HÁBITOS/);
});

test("formatearValor respeta unidad y decimales de cada métrica", () => {
  assert.equal(formatearValor("frecuencia_cardiaca", 72.4), "72 bpm");
  assert.equal(formatearValor("horas_sueno", 6.75), "6.8 h");
  assert.equal(formatearValor("nivel_estres", 5), "5/10");
  assert.equal(formatearValor("peso", 84.26), "84.3 kg");
});
