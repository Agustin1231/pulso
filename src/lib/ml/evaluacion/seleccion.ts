// Selección de modelo por métrica y por usuario: se corre el backtesting a
// todos los candidatos elegibles y gana el de menor MASE. Ante empate, el más
// simple (orden del registro). Con pocos datos no se compara nada: se devuelve
// un benchmark con confianza baja y se dice por qué.

import type { Ajuste, Confianza, FilaEvaluacion, Modelo, Seleccion, SerieDiaria } from "../tipos";
import { MODELOS, modeloPorClave } from "../modelos/registro";
import { aPuntos, interpolar, segmentoRegular } from "../series";
import { backtest } from "./backtest";
import type { OpcionesBacktest, ResultadoBacktest } from "./backtest";

export interface OpcionesSeleccion extends OpcionesBacktest {
  /** Por encima de esta fracción de días imputados, Holt/Holt-Winters no compiten. Default 0.4. */
  maxFraccionImputada?: number;
  /** Pronósticos mínimos en el backtesting para que un modelo cuente. Default 5. */
  minPronosticos?: number;
  candidatos?: readonly Modelo[];
}

export interface SeleccionDetallada extends Seleccion {
  resultados: ResultadoBacktest[];
}

function respaldo(n: number, razon: string): SeleccionDetallada {
  const modelo = modeloPorClave(n >= 3 ? "media_movil" : "naive");
  return {
    clave: modelo.clave,
    nombre: modelo.nombre,
    mase: null,
    confianza: "baja",
    razon,
    tabla: [],
    resultados: [],
  };
}

export function seleccionar(serie: SerieDiaria, opciones: OpcionesSeleccion = {}): SeleccionDetallada {
  const h = opciones.h ?? 7;
  const minTrain = opciones.minTrain ?? 14;
  const maxHueco = opciones.maxHueco ?? 3;
  const maxFrac = opciones.maxFraccionImputada ?? 0.4;
  const minPron = opciones.minPronosticos ?? 5;
  const candidatos = opciones.candidatos ?? MODELOS;
  const n = serie.n;

  if (n < minTrain + h) {
    return respaldo(
      n,
      `Solo ${n} registros: hacen falta al menos ${minTrain + h} para comparar modelos por backtesting.`
    );
  }

  const { fraccionImputada } = interpolar(serie, maxHueco);
  const elegibles = candidatos.filter(
    (m) => n >= m.nMin && !(m.requiereGrillaRegular && fraccionImputada > maxFrac)
  );
  const resultados = elegibles.map((m) =>
    backtest(serie, m, { h, minTrain, paso: opciones.paso, maxHueco })
  );
  const validos = resultados.filter((r) => r.nPronosticos >= minPron && Number.isFinite(r.mase));
  if (validos.length === 0) {
    return respaldo(n, "El backtesting no produjo pronósticos suficientes para comparar modelos.");
  }

  let mejor = validos[0];
  for (const r of validos) if (r.mase < mejor.mase - 1e-9) mejor = r;

  const tabla: FilaEvaluacion[] = resultados.map((r) => ({
    clave: r.clave,
    nombre: r.nombre,
    mae: r.mae,
    rmse: r.rmse,
    mape: r.mape,
    mase: r.mase,
    cobertura80: r.cobertura80,
    cobertura95: r.cobertura95,
    nPronosticos: r.nPronosticos,
    nOrigenes: r.nOrigenes,
    seleccionado: r.clave === mejor.clave,
  }));

  let confianza: Confianza = "baja";
  if (n >= 45 && mejor.mase < 0.9) confianza = "alta";
  else if (n >= 21) confianza = "media";

  const razon =
    `${mejor.nombre} tuvo el menor MASE (${mejor.mase.toFixed(2)}) en ${mejor.nOrigenes} orígenes ` +
    `de backtesting con horizonte de ${h} días` +
    (mejor.mase < 1 ? "; supera al naïve." : "; no supera claramente al naïve.");

  return { clave: mejor.clave, nombre: mejor.nombre, mase: mejor.mase, confianza, razon, tabla, resultados };
}

/** Ajusta un modelo sobre la serie completa, preparando los puntos como el modelo los necesita. */
export function ajustarSobreSerie(
  serie: SerieDiaria,
  clave: string,
  maxHueco = 3
): { ajuste: Ajuste; tUltimo: number; modelo: Modelo } {
  const modelo = modeloPorClave(clave);
  const puntos = modelo.requiereGrillaRegular
    ? segmentoRegular(interpolar(serie, maxHueco).serie)
    : aPuntos(serie);
  if (puntos.y.length < modelo.nMin) {
    throw new Error(`${modelo.nombre} necesita ${modelo.nMin} observaciones y hay ${puntos.y.length}`);
  }
  return { ajuste: modelo.ajustar(puntos), tUltimo: puntos.t[puntos.t.length - 1], modelo };
}
