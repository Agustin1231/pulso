// De observaciones crudas a una serie en grilla diaria, y utilidades de fechas
// sin dependencias (no usamos date-fns acá para que el motor siga siendo puro).

import type { Observacion, SerieDiaria, Puntos } from "./tipos";
import { mediana } from "./estadistica";

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
const MS_DIA = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

function formatearLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function utcDe(dia: string): number {
  const [y, m, d] = dia.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Normaliza una fecha al día YYYY-MM-DD.
 *
 * Un YYYY-MM-DD se respeta tal cual. Un ISO con hora (como `created_at`, que
 * viaja en UTC) se convierte al día en la zona horaria del proceso: es el mismo
 * criterio con el que `guardarMetrica` decide "el día de hoy" para el upsert.
 */
export function aDia(fecha: string): string {
  if (RE_DIA.test(fecha)) return fecha;
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) throw new Error(`Fecha inválida: ${fecha}`);
  return formatearLocal(d);
}

export function hoyLocal(): string {
  return formatearLocal(new Date());
}

/** Días enteros de `a` a `b` (b − a). En UTC para que el horario de verano no cuente. */
export function diasEntre(a: string, b: string): number {
  return Math.round((utcDe(b) - utcDe(a)) / MS_DIA);
}

export function sumarDias(dia: string, n: number): string {
  const d = new Date(utcDe(dia) + n * MS_DIA);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 0 = domingo … 6 = sábado. */
export function diaSemana(dia: string): number {
  return new Date(utcDe(dia)).getUTCDay();
}

/**
 * Arma la grilla diaria continua desde la primera observación hasta la última
 * (o hasta `hasta`, si es posterior: así la serie llega a "hoy" con nulls al
 * final y los pronósticos arrancan en la fecha correcta).
 *
 * Si hay más de un valor el mismo día se queda el último: el upsert diario de
 * `guardarMetrica` ya lo garantiza, esto es solo defensa.
 */
export function construirSerie(obs: readonly Observacion[], hasta?: string): SerieDiaria {
  const ordenadas = obs
    .filter((o) => Number.isFinite(o.valor))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

  const porDia = new Map<string, number>();
  for (const o of ordenadas) porDia.set(aDia(o.fecha), o.valor);
  if (porDia.size === 0) return { dias: [], y: [], n: 0, cobertura: 0 };

  const diasObs = [...porDia.keys()].sort();
  const primero = diasObs[0];
  let ultimo = diasObs[diasObs.length - 1];
  if (hasta && hasta > ultimo) ultimo = hasta;

  const largo = diasEntre(primero, ultimo) + 1;
  const dias: string[] = [];
  const y: (number | null)[] = [];
  for (let i = 0; i < largo; i++) {
    const d = sumarDias(primero, i);
    dias.push(d);
    y.push(porDia.has(d) ? (porDia.get(d) as number) : null);
  }
  return { dias, y, n: porDia.size, cobertura: porDia.size / largo };
}

/** Solo los días observados, con `t` = índice en la grilla. */
export function aPuntos(serie: SerieDiaria): Puntos {
  const t: number[] = [];
  const y: number[] = [];
  serie.y.forEach((v, i) => {
    if (v !== null) {
      t.push(i);
      y.push(v);
    }
  });
  return { t, y };
}

export function ultimoIndiceObservado(serie: SerieDiaria): number {
  for (let i = serie.y.length - 1; i >= 0; i--) if (serie.y[i] !== null) return i;
  return -1;
}

/** Los primeros `largo` días de la serie (para el backtesting). */
export function truncar(serie: SerieDiaria, largo: number): SerieDiaria {
  const dias = serie.dias.slice(0, largo);
  const y = serie.y.slice(0, largo);
  const n = y.filter((v) => v !== null).length;
  return { dias, y, n, cobertura: y.length ? n / y.length : 0 };
}

/**
 * Rellena huecos interiores de hasta `maxHueco` días por interpolación lineal.
 * Los huecos más largos y los extremos quedan como null. Solo lo usan los
 * modelos que exigen grilla regular (Holt, Holt-Winters).
 */
export function interpolar(
  serie: SerieDiaria,
  maxHueco = 3
): { serie: SerieDiaria; fraccionImputada: number } {
  const y = [...serie.y];
  let imputados = 0;
  let prev = -1;
  for (let i = 0; i < y.length; i++) {
    if (y[i] === null) continue;
    const hueco = i - prev - 1;
    if (prev >= 0 && hueco > 0 && hueco <= maxHueco) {
      const y0 = y[prev] as number;
      const y1 = y[i] as number;
      for (let j = prev + 1; j < i; j++) {
        y[j] = y0 + ((y1 - y0) * (j - prev)) / (i - prev);
        imputados++;
      }
    }
    prev = i;
  }
  const n = y.filter((v) => v !== null).length;
  return {
    serie: { dias: serie.dias, y, n, cobertura: y.length ? n / y.length : 0 },
    fraccionImputada: n > 0 ? imputados / n : 0,
  };
}

/** Último tramo contiguo sin nulls, con `t` consecutivos. */
export function segmentoRegular(serie: SerieDiaria): Puntos {
  const fin = ultimoIndiceObservado(serie);
  if (fin < 0) return { t: [], y: [] };
  let ini = fin;
  while (ini - 1 >= 0 && serie.y[ini - 1] !== null) ini--;
  const t: number[] = [];
  const y: number[] = [];
  for (let i = ini; i <= fin; i++) {
    t.push(i);
    y.push(serie.y[i] as number);
  }
  return { t, y };
}

/**
 * Nivel actual robusto: mediana de los registros de los últimos `ventana` días
 * de la grilla. Con menos de 3 registros en la ventana cae al último valor.
 */
export function nivelRobusto(serie: SerieDiaria, ventana = 7): number | null {
  const fin = serie.y.length;
  const vals: number[] = [];
  for (let i = Math.max(0, fin - ventana); i < fin; i++) {
    const v = serie.y[i];
    if (v !== null) vals.push(v);
  }
  if (vals.length >= 3) return mediana(vals);
  const idx = ultimoIndiceObservado(serie);
  return idx >= 0 ? (serie.y[idx] as number) : null;
}
