import { test } from "node:test";
import assert from "node:assert/strict";
import { generarInforme } from "../../src/lib/ml";
import { generarUsuario } from "../../src/lib/ml/sintetico";
import { sumarDias } from "../../src/lib/ml/series";
import type { MetricaType } from "../../src/lib/ml/tipos";

test("informe completo de un usuario sintético: coherente y serializable", () => {
  const entrada = generarUsuario(7);
  const informe = generarInforme(entrada);

  assert.deepEqual(JSON.parse(JSON.stringify(informe)), informe, "no sobrevive a JSON");
  assert.equal(informe.generadoEn, entrada.hoy);

  const tipos: MetricaType[] = ["frecuencia_cardiaca", "horas_sueno", "nivel_estres", "peso"];
  for (const tipo of tipos) {
    const m = informe.metricas[tipo];
    assert.ok(m, `falta ${tipo}`);
    assert.ok(m.n >= 60, `${tipo}: n=${m.n}`);
    assert.ok(m.nivelActual !== null);
    assert.ok(m.tendencia !== null);
    assert.equal(m.pronostico.length, 30, `${tipo}: ${m.pronostico.length} pronósticos`);
    assert.equal(m.pronostico[0].fecha, sumarDias(entrada.hoy as string, 1));
    assert.equal(m.pronostico[29].fecha, sumarDias(entrada.hoy as string, 30));
    for (const p of m.pronostico) {
      assert.ok(p.ic95[0] <= p.ic80[0] && p.ic80[0] <= p.media && p.media <= p.ic80[1] && p.ic80[1] <= p.ic95[1], `${tipo} IC`);
    }
    assert.ok(m.modelo.tabla.length >= 4, `${tipo}: tabla vacía`);
    assert.ok(typeof m.modelo.mase === "number");
    assert.ok(m.modelo.tabla.filter((f) => f.seleccionado).length === 1);
  }

  assert.ok(informe.riesgo.score !== null && informe.riesgo.score >= 0 && informe.riesgo.score <= 100);
  assert.equal(informe.riesgo.cobertura.disponibles, 5);
  assert.ok(informe.riesgo.contexto.multiplicador !== null);
  assert.ok(informe.proyeccion.score !== null && informe.proyeccion.ic80 !== null);
  assert.ok(informe.adherencia && informe.adherencia.media14d !== null && informe.adherencia.media14d >= 0 && informe.adherencia.media14d <= 1);

  // El estrés salta +2 el día 60 y se mantiene: tiene que haber una alerta reciente hacia arriba.
  const estres = informe.metricas.nivel_estres!;
  assert.ok(estres.alertas.some((a) => a.direccion === "sube"), JSON.stringify(estres.alertas));
  assert.ok(informe.limitaciones.some((l) => /escala clínica/.test(l)));
});

test("sin datos: informe vacío pero válido", () => {
  const informe = generarInforme({ metricas: {}, perfil: null, hoy: "2026-09-19" });
  assert.deepEqual(informe.metricas, {});
  assert.equal(informe.riesgo.insuficiente, true);
  assert.equal(informe.riesgo.score, null);
  assert.equal(informe.proyeccion.score, null);
  assert.equal(informe.adherencia, null);
  assert.ok(informe.limitaciones.some((l) => /Sin perfil/.test(l)));
});

test("pocos datos: hay pronóstico igual, con confianza baja y sin alertas", () => {
  const obs = Array.from({ length: 8 }, (_, i) => ({ fecha: sumarDias("2026-09-01", i), valor: 70 + (i % 3) }));
  const informe = generarInforme({
    metricas: { frecuencia_cardiaca: obs },
    perfil: { edad: 50, sexo: "f", alturaCm: 165, fumador: false },
    hoy: "2026-09-10",
  });
  const fc = informe.metricas.frecuencia_cardiaca!;
  assert.equal(fc.modelo.confianza, "baja");
  assert.equal(fc.pronostico.length, 30);
  assert.equal(fc.pronostico[0].fecha, "2026-09-11");
  assert.deepEqual(fc.alertas, []);
  assert.equal(informe.riesgo.cobertura.disponibles, 2); // FC + tabaquismo
  assert.ok(informe.limitaciones.some((l) => /confianza baja/.test(l)));
});
