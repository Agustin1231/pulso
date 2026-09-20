// Proyección del índice: el mismo modelo evaluado sobre el pronóstico de cada
// métrica. Como las funciones de riesgo no son monótonas (U), el intervalo del
// score se obtiene evaluando todas las combinaciones de extremos del IC 80 %
// (2^k con k ≤ 4 métricas: 16 evaluaciones, nada que optimizar).

import type { MetricaType, Perfil, Prediccion, ProyeccionRiesgo } from "../tipos";
import { armarValores, calcularIndice } from "./indice";
import type { EntradaValores } from "./indice";

const METRICAS_INDICE: (keyof EntradaValores)[] = [
  "frecuencia_cardiaca",
  "horas_sueno",
  "nivel_estres",
  "peso",
];

export function proyectarIndice(
  actual: EntradaValores,
  pronosticos: Partial<Record<MetricaType, Prediccion>>,
  perfil: Perfil | null,
  horizonteDias: number,
  scoreActual: number | null
): ProyeccionRiesgo {
  const conPronostico = METRICAS_INDICE.filter((m) => pronosticos[m] && actual[m] != null);
  if (conPronostico.length === 0 || scoreActual === null) {
    return { horizonteDias, score: null, ic80: null, delta: null };
  }

  const central: EntradaValores = { ...actual };
  for (const m of conPronostico) central[m] = (pronosticos[m] as Prediccion).media;
  const score = calcularIndice(armarValores(central, perfil), perfil).score;

  const combos = 1 << conPronostico.length;
  let min = Infinity;
  let max = -Infinity;
  for (let mascara = 0; mascara < combos; mascara++) {
    const v: EntradaValores = { ...actual };
    conPronostico.forEach((m, i) => {
      const p = pronosticos[m] as Prediccion;
      v[m] = mascara & (1 << i) ? p.ic80[1] : p.ic80[0];
    });
    const s = calcularIndice(armarValores(v, perfil), perfil).score;
    if (s !== null) {
      min = Math.min(min, s);
      max = Math.max(max, s);
    }
  }

  return {
    horizonteDias,
    score,
    ic80: Number.isFinite(min) ? [min, max] : null,
    delta: score === null ? null : score - scoreActual,
  };
}
