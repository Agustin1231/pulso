// Carta EWMA (Roberts 1959; Montgomery cap. 9). Media móvil ponderada
// exponencialmente contra límites que se ensanchan hasta estabilizarse:
//
//   Z_t = λ·y_t + (1−λ)·Z_{t−1},   Z_0 = μ₀
//   límites: μ₀ ± L·σ₀·√( λ/(2−λ) · (1 − (1−λ)^{2t}) ),   λ = 0.2, L = 3
//
// Complementa al CUSUM: reacciona algo más rápido a desvíos moderados y da una
// lectura suavizada del nivel actual.

import type { Alerta, MetricaType, SerieDiaria } from "../tipos";
import { media } from "../estadistica";
import { armarAlerta, consolidar, lineaBase, observaciones, winsorizar } from "./base";

export interface OpcionesEwma {
  lambda?: number;
  L?: number;
  nBase?: number;
}

export function ewma(serie: SerieDiaria, metrica: MetricaType, opciones: OpcionesEwma = {}): Alerta[] {
  const lambda = opciones.lambda ?? 0.2;
  const L = opciones.L ?? 3;
  const nBase = opciones.nBase ?? 14;

  const obs = observaciones(serie);
  if (obs.length < nBase + 1) return [];
  const base = lineaBase(obs, metrica, nBase);

  const alertas: Alerta[] = [];
  let z = base.mu;
  let ladoDesde = nBase;      // primer índice del tramo actual del mismo lado de μ₀
  let ladoActual = 0;         // -1, 0, +1
  let enAlarma = false;
  let aprendiendo = true;

  for (let i = nBase; i < obs.length; i++) {
    const { mu, sigma } = base;
    const y = mu + winsorizar((obs[i].valor - mu) / sigma) * sigma;
    z = lambda * y + (1 - lambda) * z;
    const t = i - nBase + 1;
    const ancho = L * sigma * Math.sqrt((lambda / (2 - lambda)) * (1 - (1 - lambda) ** (2 * t)));

    const lado = z > mu ? 1 : z < mu ? -1 : 0;
    if (lado !== ladoActual) {
      ladoActual = lado;
      ladoDesde = i;
      enAlarma = false;
    }

    const fuera = z > mu + ancho || z < mu - ancho;
    if (fuera && !enAlarma) {
      enAlarma = true;
      aprendiendo = false;
      const tramo = obs.slice(ladoDesde, i + 1).map((o) => o.valor);
      const magnitud = media(tramo) - mu;
      alertas.push(
        armarAlerta(metrica, "ewma", z > mu ? "sube" : "baja", magnitud / sigma, magnitud, obs[ladoDesde].fecha, obs[i].fecha)
      );
    } else if (!fuera) {
      enAlarma = false;
    }

    if (aprendiendo) base.absorber(y);
  }
  return consolidar(alertas);
}
