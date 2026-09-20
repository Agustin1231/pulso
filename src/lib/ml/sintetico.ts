// Generador de cohortes sintéticas con verdad conocida.
//
// No hay historial real con el que evaluar el motor, y aunque lo hubiera no
// tendría "verdad" contra la cual medir: acá cada serie se genera con una
// tendencia, una estacionalidad semanal, un ruido, una fracción de días sin
// registro y (opcionalmente) un cambio de régimen CONOCIDOS. El backtesting
// verifica que los modelos recuperen esos parámetros. Semilla fija ⇒ resultados
// reproducibles para el informe.

import type { EntradaInforme, MetricaType, Observacion, SerieDiaria } from "./tipos";
import { crearPRNG } from "./estadistica";
import { diaSemana, sumarDias } from "./series";

export interface ParametrosSerie {
  dias: number;
  nivel: number;
  pendientePorDia?: number;
  /** Desvío por día de la semana, índice 0 = domingo. */
  estacionalidad7?: number[];
  sigma: number;
  pFaltante?: number;
  outliers?: { p: number; magnitud: number };
  cambioRegimen?: { dia: number; delta: number };
  rango?: [number, number];
  decimales?: number;
  /** YYYY-MM-DD del día 0. Default 2026-06-01. */
  inicio?: string;
  semilla: number;
}

export interface SerieSintetica {
  serie: SerieDiaria;
  verdad: ParametrosSerie;
  /** La señal sin ruido ni faltantes, para comparar. */
  sinRuido: number[];
}

export function generarSerie(p: ParametrosSerie): SerieSintetica {
  const rng = crearPRNG(p.semilla);
  const inicio = p.inicio ?? "2026-06-01";
  const dias: string[] = [];
  const y: (number | null)[] = [];
  const sinRuido: number[] = [];
  const f = 10 ** (p.decimales ?? 1);

  for (let d = 0; d < p.dias; d++) {
    const fecha = sumarDias(inicio, d);
    dias.push(fecha);
    let base = p.nivel + (p.pendientePorDia ?? 0) * d;
    if (p.estacionalidad7) base += p.estacionalidad7[diaSemana(fecha)] ?? 0;
    if (p.cambioRegimen && d >= p.cambioRegimen.dia) base += p.cambioRegimen.delta;
    sinRuido.push(base);

    let v = base + rng.normal(0, p.sigma);
    if (p.outliers && rng.uniforme() < p.outliers.p) {
      v += (rng.uniforme() < 0.5 ? -1 : 1) * p.outliers.magnitud;
    }
    if (p.rango) v = Math.max(p.rango[0], Math.min(p.rango[1], v));
    v = Math.round(v * f) / f;

    const falta = d > 0 && (p.pFaltante ?? 0) > 0 && rng.uniforme() < (p.pFaltante ?? 0);
    y.push(falta ? null : v);
  }
  const n = y.filter((v) => v !== null).length;
  return { serie: { dias, y, n, cobertura: n / y.length }, verdad: p, sinRuido };
}

export function aObservaciones(serie: SerieDiaria): Observacion[] {
  const out: Observacion[] = [];
  serie.y.forEach((v, i) => {
    if (v !== null) out.push({ fecha: serie.dias[i], valor: v });
  });
  return out;
}

// ─── Cohorte de evaluación ───────────────────────────────────────────────────

type Base = Omit<ParametrosSerie, "semilla" | "dias">;

interface Fisiologia {
  nivel: number;
  sigma: number;
  rango: [number, number];
  decimales: number;
  suave: number;
  fuerte: number;
  estacional: number[];
  salto: number;
  outlier: number;
}

const FISIOLOGIA: Record<"frecuencia_cardiaca" | "horas_sueno" | "nivel_estres" | "peso", Fisiologia> = {
  frecuencia_cardiaca: {
    nivel: 72, sigma: 3, rango: [40, 130], decimales: 0,
    suave: 0.05, fuerte: 0.15,
    estacional: [-2, 1, 1, 1, 1, 1, -3],
    salto: 8, outlier: 15,
  },
  horas_sueno: {
    nivel: 7.2, sigma: 0.6, rango: [3, 12], decimales: 2,
    suave: -0.01, fuerte: -0.03,
    estacional: [1.2, -0.4, -0.4, -0.3, -0.3, -0.2, 0.9],
    salto: -1.2, outlier: 3,
  },
  nivel_estres: {
    nivel: 4, sigma: 1, rango: [1, 10], decimales: 0,
    suave: 0.02, fuerte: 0.05,
    estacional: [-1.5, 0.8, 0.8, 0.6, 0.5, 0, -1.2],
    salto: 3, outlier: 4,
  },
  peso: {
    nivel: 84, sigma: 0.5, rango: [45, 140], decimales: 1,
    suave: -0.03, fuerte: -0.08,
    estacional: [0.3, 0.1, 0, -0.1, -0.1, 0, 0.2],
    salto: 2.5, outlier: 4,
  },
};

export interface PerfilCohorte {
  nombre: string;
  metrica: MetricaType;
  params: Base;
}

function perfiles(metrica: keyof typeof FISIOLOGIA): PerfilCohorte[] {
  const f = FISIOLOGIA[metrica];
  const comun = { nivel: f.nivel, sigma: f.sigma, rango: f.rango, decimales: f.decimales, pFaltante: 0.15 };
  return [
    { nombre: "estable", metrica, params: { ...comun } },
    { nombre: "tendencia_suave", metrica, params: { ...comun, pendientePorDia: f.suave } },
    { nombre: "tendencia_fuerte", metrica, params: { ...comun, pendientePorDia: f.fuerte } },
    { nombre: "estacional", metrica, params: { ...comun, estacionalidad7: f.estacional } },
    { nombre: "cambio_regimen", metrica, params: { ...comun, cambioRegimen: { dia: 45, delta: f.salto } } },
    { nombre: "ruidoso", metrica, params: { ...comun, sigma: f.sigma * 2, outliers: { p: 0.05, magnitud: f.outlier } } },
    { nombre: "disperso", metrica, params: { ...comun, pFaltante: 0.4, pendientePorDia: f.suave } },
  ];
}

export const COHORTE: readonly PerfilCohorte[] = [
  ...perfiles("frecuencia_cardiaca"),
  ...perfiles("horas_sueno"),
  ...perfiles("nivel_estres"),
  ...perfiles("peso"),
];

export interface SerieCohorte extends SerieSintetica {
  nombre: string;
  metrica: MetricaType;
}

export function generarCohorte(semilla = 42, dias = 90): SerieCohorte[] {
  return COHORTE.map((c, i) => ({
    nombre: c.nombre,
    metrica: c.metrica,
    ...generarSerie({ ...c.params, dias, semilla: semilla * 1000 + i }),
  }));
}

/** Un usuario completo (4 métricas + perfil + adherencia) para probar el informe de punta a punta. */
export function generarUsuario(semilla = 7, dias = 90): EntradaInforme {
  const inicio = "2026-06-01";
  const fc = FISIOLOGIA.frecuencia_cardiaca;
  const su = FISIOLOGIA.horas_sueno;
  const es = FISIOLOGIA.nivel_estres;
  const pe = FISIOLOGIA.peso;
  const rng = crearPRNG(semilla);

  const adherencia: Observacion[] = [];
  for (let d = 0; d < dias; d++) {
    if (rng.uniforme() < 0.2) continue;
    adherencia.push({ fecha: sumarDias(inicio, d), valor: rng.entero(1, 4) / 4 });
  }

  return {
    metricas: {
      frecuencia_cardiaca: aObservaciones(
        generarSerie({ dias, inicio, semilla: semilla + 1, nivel: fc.nivel, sigma: fc.sigma, rango: fc.rango, decimales: 0, pendientePorDia: 0.04, pFaltante: 0.15 }).serie
      ),
      horas_sueno: aObservaciones(
        generarSerie({ dias, inicio, semilla: semilla + 2, nivel: su.nivel, sigma: su.sigma, rango: su.rango, decimales: 2, estacionalidad7: su.estacional, pFaltante: 0.15 }).serie
      ),
      nivel_estres: aObservaciones(
        generarSerie({ dias, inicio, semilla: semilla + 3, nivel: es.nivel, sigma: es.sigma, rango: es.rango, decimales: 0, cambioRegimen: { dia: 60, delta: 2 }, pFaltante: 0.15 }).serie
      ),
      peso: aObservaciones(
        generarSerie({ dias, inicio, semilla: semilla + 4, nivel: pe.nivel, sigma: pe.sigma, rango: pe.rango, decimales: 1, pendientePorDia: -0.03, pFaltante: 0.2 }).serie
      ),
    },
    perfil: { edad: 45, sexo: "m", alturaCm: 175, fumador: false },
    adherencia,
    hoy: sumarDias(inicio, dias - 1),
    horizonte: 30,
  };
}
