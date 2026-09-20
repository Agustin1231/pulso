import { test } from "node:test";
import assert from "node:assert/strict";
import {
  construirSerie, aPuntos, interpolar, segmentoRegular, nivelRobusto,
  diasEntre, sumarDias, aDia, diaSemana, truncar,
} from "../../src/lib/ml/series";

test("grilla diaria con huecos; el duplicado del mismo día se queda con el último", () => {
  const s = construirSerie([
    { fecha: "2026-01-01", valor: 1 },
    { fecha: "2026-01-03", valor: 3 },
    { fecha: "2026-01-03", valor: 4 },
    { fecha: "2026-01-06", valor: 6 },
  ]);
  assert.deepEqual(s.dias, ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06"]);
  assert.deepEqual(s.y, [1, null, 4, null, null, 6]);
  assert.equal(s.n, 3);
  assert.equal(s.cobertura, 0.5);
});

test("`hasta` extiende la grilla con nulls al final", () => {
  const s = construirSerie([{ fecha: "2026-01-01", valor: 1 }], "2026-01-04");
  assert.deepEqual(s.y, [1, null, null, null]);
  assert.equal(construirSerie([], "2026-01-04").n, 0);
});

test("aPuntos devuelve solo observados con t = índice de grilla", () => {
  const s = construirSerie([
    { fecha: "2026-01-01", valor: 1 },
    { fecha: "2026-01-03", valor: 4 },
    { fecha: "2026-01-06", valor: 6 },
  ]);
  assert.deepEqual(aPuntos(s), { t: [0, 2, 5], y: [1, 4, 6] });
});

test("interpolar rellena huecos cortos y respeta maxHueco", () => {
  const s = { dias: [] as string[], y: [1, null, 3, null, null, null, null, 8], n: 3, cobertura: 3 / 8 };
  const { serie, fraccionImputada } = interpolar(s, 3);
  assert.equal(serie.y[1], 2);
  assert.deepEqual(serie.y.slice(3, 7), [null, null, null, null]);
  assert.equal(serie.n, 4);
  assert.equal(fraccionImputada, 0.25);
});

test("segmentoRegular toma el último tramo contiguo", () => {
  const s = { dias: [] as string[], y: [1, null, 3, 4, 5, null], n: 4, cobertura: 4 / 6 };
  assert.deepEqual(segmentoRegular(s), { t: [2, 3, 4], y: [3, 4, 5] });
  assert.deepEqual(segmentoRegular({ dias: [], y: [null], n: 0, cobertura: 0 }), { t: [], y: [] });
});

test("nivelRobusto: mediana de 7 días, o último valor con menos de 3", () => {
  const vals = [70, 72, 71, 100, 70, 73, 71];
  const s = { dias: [] as string[], y: [60, ...vals], n: 8, cobertura: 1 };
  assert.equal(nivelRobusto(s), 71);
  const pocos = { dias: [] as string[], y: [60, null, null, null, null, null, 65, null], n: 2, cobertura: 0.25 };
  assert.equal(nivelRobusto(pocos), 65);
  assert.equal(nivelRobusto({ dias: [], y: [], n: 0, cobertura: 0 }), null);
});

test("truncar conserva los primeros días", () => {
  const s = construirSerie([{ fecha: "2026-01-01", valor: 1 }, { fecha: "2026-01-05", valor: 5 }]);
  const t = truncar(s, 3);
  assert.equal(t.dias.length, 3);
  assert.equal(t.n, 1);
});

test("utilidades de fechas", () => {
  assert.equal(diasEntre("2026-01-01", "2026-03-01"), 59);
  assert.equal(sumarDias("2026-12-31", 1), "2027-01-01");
  assert.equal(sumarDias("2026-03-01", -1), "2026-02-28");
  assert.equal(diaSemana("2026-06-07"), 0); // domingo
  assert.equal(diaSemana("2026-06-06"), 6); // sábado
  assert.equal(aDia("2026-05-05"), "2026-05-05");
  assert.match(aDia("2026-05-05T14:30:00.000Z"), /^\d{4}-\d{2}-\d{2}$/);
  assert.throws(() => aDia("no es fecha"));
});
