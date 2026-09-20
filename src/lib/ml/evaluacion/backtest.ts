// Backtesting rolling-origin con ventana expansiva (*FPP3* §5.10, "time
// series cross-validation"). Nunca k-fold aleatorio: mezclaría el futuro con
// el pasado.
//
// Para cada origen `o` (un día de la grilla) se ajusta el modelo con todo lo
// observado ANTES de `o`, se pronostican los `h` días siguientes y se puntúan
// solo los días que tienen registro real. Así las series con huecos se evalúan
// sin inventar datos de test.

import type { Modelo, SerieDiaria, PrediccionBase } from "../tipos";
import { truncar, aPuntos, interpolar, segmentoRegular } from "../series";
import { escalaMase, mae, rmse, mape } from "./metricas";

export interface OpcionesBacktest {
  /** Días a pronosticar desde cada origen. Default 7. */
  h?: number;
  /** Observaciones mínimas de entrenamiento antes del primer origen. Default 14. */
  minTrain?: number;
  /** Separación entre orígenes, en días. Default 1. */
  paso?: number;
  /** Hueco máximo a interpolar para los modelos de grilla regular. Default 3. */
  maxHueco?: number;
}

export interface ErrorPronostico {
  origen: number;
  /** Días de anticipación respecto del origen (1..h). */
  h: number;
  t: number;
  real: number;
  prediccion: number;
  error: number;
  /** Error escalado por el naïve del entrenamiento (para MASE). */
  q: number;
  en80: boolean;
  en95: boolean;
}

export interface ResultadoBacktest {
  clave: string;
  nombre: string;
  errores: ErrorPronostico[];
  nOrigenes: number;
  nOmitidos: number;
  nPronosticos: number;
  mae: number;
  rmse: number;
  mape: number | null;
  mase: number;
  cobertura80: number;
  cobertura95: number;
  porHorizonte: { h: number; mae: number; n: number }[];
}

function resumir(clave: string, nombre: string, errores: ErrorPronostico[], nOrigenes: number, nOmitidos: number): ResultadoBacktest {
  const e = errores.map((x) => x.error);
  const reales = errores.map((x) => x.real);
  const preds = errores.map((x) => x.prediccion);
  const porH = new Map<number, number[]>();
  for (const x of errores) {
    if (!porH.has(x.h)) porH.set(x.h, []);
    (porH.get(x.h) as number[]).push(x.error);
  }
  return {
    clave,
    nombre,
    errores,
    nOrigenes,
    nOmitidos,
    nPronosticos: errores.length,
    mae: mae(e),
    rmse: rmse(e),
    mape: mape(reales, preds),
    mase: errores.length ? mae(errores.map((x) => x.q)) : NaN,
    cobertura80: errores.length ? errores.filter((x) => x.en80).length / errores.length : NaN,
    cobertura95: errores.length ? errores.filter((x) => x.en95).length / errores.length : NaN,
    porHorizonte: [...porH.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([h, es]) => ({ h, mae: mae(es), n: es.length })),
  };
}

export function backtest(
  serie: SerieDiaria,
  modelo: Modelo,
  opciones: OpcionesBacktest = {}
): ResultadoBacktest {
  const h = opciones.h ?? 7;
  const minTrain = opciones.minTrain ?? 14;
  const paso = opciones.paso ?? 1;
  const maxHueco = opciones.maxHueco ?? 3;

  const observados: number[] = [];
  serie.y.forEach((v, i) => {
    if (v !== null) observados.push(i);
  });

  const errores: ErrorPronostico[] = [];
  let nOrigenes = 0;
  let nOmitidos = 0;
  if (observados.length < minTrain + 1) return resumir(modelo.clave, modelo.nombre, errores, 0, 0);

  const largo = serie.y.length;
  const primerOrigen = observados[minTrain - 1] + 1;

  for (let o = primerOrigen; o < largo; o += paso) {
    const test = observados.filter((i) => i >= o && i < o + h);
    if (test.length === 0) continue;

    const entrenamiento = truncar(serie, o);
    const crudos = aPuntos(entrenamiento);
    let puntos = crudos;
    if (modelo.requiereGrillaRegular) {
      puntos = segmentoRegular(interpolar(entrenamiento, maxHueco).serie);
    }
    if (puntos.y.length < modelo.nMin) {
      nOmitidos++;
      continue;
    }
    const escala = escalaMase(crudos.y);
    if (!(escala > 0)) {
      nOmitidos++;
      continue;
    }

    const tUltimo = puntos.t[puntos.t.length - 1];
    let preds: PrediccionBase[];
    try {
      preds = modelo.ajustar(puntos).predecir(o + h - 1 - tUltimo);
    } catch {
      nOmitidos++;
      continue;
    }
    nOrigenes++;

    for (const i of test) {
      const p = preds[i - tUltimo - 1];
      const real = serie.y[i] as number;
      const error = real - p.media;
      errores.push({
        origen: o,
        h: i - o + 1,
        t: i,
        real,
        prediccion: p.media,
        error,
        q: error / escala,
        en80: real >= p.ic80[0] && real <= p.ic80[1],
        en95: real >= p.ic95[0] && real <= p.ic95[1],
      });
    }
  }

  return resumir(modelo.clave, modelo.nombre, errores, nOrigenes, nOmitidos);
}
