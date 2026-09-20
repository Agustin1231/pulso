#!/usr/bin/env node
/**
 * Evaluación del motor de predicción sobre la cohorte sintética.
 *
 *   npm run evaluar
 *   npm run evaluar -- --json docs/evaluacion.json --horizonte 7 --semilla 42 --metrica horas_sueno
 *
 * Para cada serie (métrica × perfil) imprime la tabla comparativa de todos los
 * modelos contra los benchmarks (MAE, RMSE, MASE, cobertura del IC 80 %), qué
 * tan bien recuperan la pendiente / la estacionalidad verdaderas, y el retraso
 * con que CUSUM y EWMA detectan el cambio de régimen. Semilla fija ⇒ el mismo
 * resultado en cada corrida.
 */
import { writeFileSync } from "node:fs";
import { generarCohorte } from "../src/lib/ml/sintetico";
import type { SerieCohorte } from "../src/lib/ml/sintetico";
import { seleccionar } from "../src/lib/ml/evaluacion/seleccion";
import { ajustarOLS } from "../src/lib/ml/modelos/lineal";
import { ajustarTheilSen } from "../src/lib/ml/modelos/robusta";
import { ajustarHolt } from "../src/lib/ml/modelos/holt";
import { ajustarHoltWinters } from "../src/lib/ml/modelos/holt-winters";
import { BENCHMARKS, MODELOS } from "../src/lib/ml/modelos/registro";
import { cusum } from "../src/lib/ml/anomalias/cusum";
import { ewma } from "../src/lib/ml/anomalias/ewma";
import { aPuntos, interpolar, segmentoRegular, diasEntre, sumarDias } from "../src/lib/ml/series";
import type { FilaEvaluacion } from "../src/lib/ml/tipos";

// ─── argumentos ──────────────────────────────────────────────────────────────

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const SEMILLA = Number(arg("semilla") ?? 42);
const HORIZONTE = Number(arg("horizonte") ?? 7);
const METRICA = arg("metrica");
const SALIDA_JSON = arg("json");

// ─── formato ─────────────────────────────────────────────────────────────────

const f = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toFixed(d);
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)} %` : "—");

function tabla(cabecera: string[], filas: string[][], alineacion: ("l" | "r")[]): string {
  const anchos = cabecera.map((c, i) => Math.max(c.length, ...filas.map((r) => r[i].length)));
  const linea = (l: string, m: string, r: string) => l + anchos.map((a) => "─".repeat(a + 2)).join(m) + r;
  const fila = (cs: string[]) =>
    "│" + cs.map((c, i) => " " + (alineacion[i] === "r" ? c.padStart(anchos[i]) : c.padEnd(anchos[i])) + " ").join("│") + "│";
  return [linea("┌", "┬", "┐"), fila(cabecera), linea("├", "┼", "┤"), ...filas.map(fila), linea("└", "┴", "┘")].join("\n");
}

// ─── evaluación por serie ────────────────────────────────────────────────────

interface Recuperacion {
  pendienteVerdadera?: number;
  pendienteOLS?: number;
  pendienteTheilSen?: number;
  pendienteHolt?: number;
  amplitudVerdadera?: number;
  amplitudHW?: number;
}

interface Deteccion {
  diaCambio?: string;
  retrasoCusum?: number | null;
  retrasoEwma?: number | null;
  alertasCusum: number;
  alertasEwma: number;
}

interface ResultadoSerie {
  metrica: string;
  perfil: string;
  n: number;
  cobertura: number;
  seleccion: { clave: string; nombre: string; mase: number | null; confianza: string };
  tabla: FilaEvaluacion[];
  recuperacion: Recuperacion;
  deteccion: Deteccion;
}

function evaluarSerie(s: SerieCohorte): ResultadoSerie {
  const sel = seleccionar(s.serie, { h: HORIZONTE });

  const recuperacion: Recuperacion = {};
  const puntos = aPuntos(s.serie);
  if (s.verdad.pendientePorDia !== undefined) {
    recuperacion.pendienteVerdadera = s.verdad.pendientePorDia;
    recuperacion.pendienteOLS = ajustarOLS(puntos).pendiente;
    recuperacion.pendienteTheilSen = ajustarTheilSen(puntos).pendiente;
    const { serie: interp, fraccionImputada } = interpolar(s.serie);
    const reg = segmentoRegular(interp);
    if (reg.y.length >= 10 && fraccionImputada <= 0.4) {
      recuperacion.pendienteHolt = ajustarHolt(reg).parametros.pendiente;
    }
  }
  if (s.verdad.estacionalidad7) {
    recuperacion.amplitudVerdadera = Math.max(...s.verdad.estacionalidad7) - Math.min(...s.verdad.estacionalidad7);
    const reg = segmentoRegular(interpolar(s.serie).serie);
    if (reg.y.length >= 21) recuperacion.amplitudHW = ajustarHoltWinters(reg).parametros.amplitudEstacional;
  }

  const aC = cusum(s.serie, s.metrica);
  const aE = ewma(s.serie, s.metrica);
  const deteccion: Deteccion = { alertasCusum: aC.length, alertasEwma: aE.length };
  if (s.verdad.cambioRegimen) {
    const dia = sumarDias(s.verdad.inicio ?? "2026-06-01", s.verdad.cambioRegimen.dia);
    const dir = s.verdad.cambioRegimen.delta > 0 ? "sube" : "baja";
    const retraso = (al: typeof aC) => {
      const a = al.find((x) => x.direccion === dir && diasEntre(dia, x.detectadaEn) >= 0);
      return a ? diasEntre(dia, a.detectadaEn) : null;
    };
    deteccion.diaCambio = dia;
    deteccion.retrasoCusum = retraso(aC);
    deteccion.retrasoEwma = retraso(aE);
  }

  return {
    metrica: s.metrica,
    perfil: s.nombre,
    n: s.serie.n,
    cobertura: s.serie.cobertura,
    seleccion: { clave: sel.clave, nombre: sel.nombre, mase: sel.mase, confianza: sel.confianza },
    tabla: sel.tabla,
    recuperacion,
    deteccion,
  };
}

// ─── corrida ─────────────────────────────────────────────────────────────────

const cohorte = generarCohorte(SEMILLA).filter((s) => !METRICA || s.metrica === METRICA);
if (cohorte.length === 0) {
  console.error(`No hay series para la métrica "${METRICA}".`);
  process.exit(1);
}

console.log(`Motor de predicción — evaluación sobre cohorte sintética`);
console.log(`semilla ${SEMILLA} · horizonte ${HORIZONTE} días · ${cohorte.length} series · backtesting rolling-origin\n`);

const resultados: ResultadoSerie[] = [];
for (const s of cohorte) {
  const r = evaluarSerie(s);
  resultados.push(r);

  console.log(`━━ ${r.metrica} · ${r.perfil}   n=${r.n}  cobertura=${pct(r.cobertura)}`);
  if (r.tabla.length) {
    console.log(
      tabla(
        ["Modelo", "MAE", "RMSE", "MASE", "IC80", ""],
        r.tabla.map((fila) => [
          fila.nombre, f(fila.mae), f(fila.rmse), f(fila.mase), pct(fila.cobertura80), fila.seleccionado ? "★" : "",
        ]),
        ["l", "r", "r", "r", "r", "l"]
      )
    );
  } else {
    console.log(`  (sin backtesting: ${r.seleccion.nombre}, confianza ${r.seleccion.confianza})`);
  }

  const rec = r.recuperacion;
  if (rec.pendienteVerdadera !== undefined) {
    console.log(
      `  pendiente/día verdadera ${f(rec.pendienteVerdadera, 3)} → OLS ${f(rec.pendienteOLS, 3)} · ` +
        `Theil-Sen ${f(rec.pendienteTheilSen, 3)} · Holt ${f(rec.pendienteHolt, 3)}`
    );
  }
  if (rec.amplitudVerdadera !== undefined) {
    console.log(`  amplitud semanal verdadera ${f(rec.amplitudVerdadera)} → Holt-Winters ${f(rec.amplitudHW)}`);
  }
  const det = r.deteccion;
  if (det.diaCambio) {
    console.log(
      `  cambio de régimen el ${det.diaCambio} → CUSUM ${det.retrasoCusum === null ? "no detectó" : `+${det.retrasoCusum} d`} · ` +
        `EWMA ${det.retrasoEwma === null ? "no detectó" : `+${det.retrasoEwma} d`}`
    );
  } else {
    console.log(`  alertas: CUSUM ${det.alertasCusum} · EWMA ${det.alertasEwma}`);
  }
  console.log();
}

// ─── resumen ─────────────────────────────────────────────────────────────────

const conTabla = resultados.filter((r) => r.tabla.length);
const filasResumen = MODELOS.map((m) => {
  const filas = conTabla.map((r) => r.tabla.find((t) => t.clave === m.clave)).filter((x): x is FilaEvaluacion => !!x);
  const mases = filas.map((x) => x.mase).filter(Number.isFinite);
  const cob = filas.map((x) => x.cobertura80).filter(Number.isFinite);
  const ganadas = filas.filter((x) => x.seleccionado).length;
  return [
    m.nombre + (BENCHMARKS.has(m.clave) ? " (benchmark)" : ""),
    String(filas.length),
    f(mases.length ? mases.reduce((a, b) => a + b, 0) / mases.length : NaN),
    f(mases.length ? [...mases].sort((a, b) => a - b)[Math.floor(mases.length / 2)] : NaN),
    pct(cob.length ? cob.reduce((a, b) => a + b, 0) / cob.length : NaN),
    String(ganadas),
  ];
});
console.log("━━ Resumen por modelo (sobre las series con backtesting)");
console.log(tabla(["Modelo", "series", "MASE medio", "MASE mediana", "IC80 medio", "ganó"], filasResumen, ["l", "r", "r", "r", "r", "r"]));

const seleccionados = conTabla.map((r) => r.seleccion);
const ganaNaive = seleccionados.filter((s) => s.mase !== null && s.mase < 1).length;
const noBenchmark = seleccionados.filter((s) => !BENCHMARKS.has(s.clave)).length;
console.log(`\nModelo seleccionado con MASE < 1 (le gana al naïve): ${ganaNaive}/${seleccionados.length}`);
console.log(`Modelo seleccionado que no es un benchmark: ${noBenchmark}/${seleccionados.length}`);

const conCambio = resultados.filter((r) => r.deteccion.diaCambio);
const retrasos = (k: "retrasoCusum" | "retrasoEwma") => conCambio.map((r) => r.deteccion[k]).filter((x): x is number => typeof x === "number");
const rc = retrasos("retrasoCusum");
const re = retrasos("retrasoEwma");
console.log(
  `Cambios de régimen detectados: CUSUM ${rc.length}/${conCambio.length} (retraso medio ${f(rc.length ? rc.reduce((a, b) => a + b, 0) / rc.length : NaN, 1)} d) · ` +
    `EWMA ${re.length}/${conCambio.length} (retraso medio ${f(re.length ? re.reduce((a, b) => a + b, 0) / re.length : NaN, 1)} d)`
);
const cuenta = (perfiles: string[]) => {
  const sel = resultados.filter((r) => perfiles.includes(r.perfil));
  return { series: sel.length, alertas: sel.reduce((s, r) => s + r.deteccion.alertasCusum + r.deteccion.alertasEwma, 0) };
};
const estables = cuenta(["estable", "ruidoso"]);
const estacionales = cuenta(["estacional"]);
console.log(`Falsas alarmas en perfiles estables (estable/ruidoso): ${estables.alertas} en ${estables.series} series`);
console.log(
  `Alertas en perfiles estacionales: ${estacionales.alertas} en ${estacionales.series} series ` +
    `(las cartas no modelan el patrón semanal: un fin de semana de +2σ puede dispararlas)`
);

if (SALIDA_JSON) {
  writeFileSync(SALIDA_JSON, JSON.stringify({ semilla: SEMILLA, horizonte: HORIZONTE, series: resultados }, null, 2));
  console.log(`\nResultados escritos en ${SALIDA_JSON}`);
}
