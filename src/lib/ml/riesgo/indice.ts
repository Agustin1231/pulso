// Índice de riesgo cardiovascular modificable.
//
//   L      = Σ_i logRR_i(x_i)            (solo factores con datos)
//   L_max  = Σ_i logRR_i(peor_i)         (los mismos factores)
//   score  = 100 · (1 − L / L_max)
//
// Es un modelo log-lineal de riesgo relativo con coeficientes de literatura,
// NO una regresión entrenada (no hay eventos clínicos con qué entrenarla) y NO
// una escala clínica validada. Como el score es lineal en L, los puntos que
// pierde cada factor se atribuyen de forma exacta y aditiva.
//
// La edad y el sexo no entran al score: una persona de 70 con hábitos
// perfectos no debe salir "en riesgo" por algo que no puede cambiar. Se
// reportan aparte como multiplicador de contexto.

import type {
  FactorClave,
  FactorResultado,
  Perfil,
  ResultadoRiesgo,
} from "../tipos";
import { FACTORES, logRRMax, logRREdad, logRRSexo } from "./factores";

export type ValoresFactores = Partial<Record<FactorClave, number | null>>;

/** Lo que el informe conoce de cada métrica; `peso` se convierte en IMC con la altura. */
export interface EntradaValores {
  frecuencia_cardiaca?: number | null;
  horas_sueno?: number | null;
  nivel_estres?: number | null;
  peso?: number | null;
}

export function imc(pesoKg: number | null | undefined, alturaCm: number | null | undefined): number | null {
  if (pesoKg == null || alturaCm == null || !(pesoKg > 0) || !(alturaCm > 0)) return null;
  const m = alturaCm / 100;
  return pesoKg / (m * m);
}

export function armarValores(entrada: EntradaValores, perfil: Perfil | null): ValoresFactores {
  return {
    frecuencia_cardiaca: entrada.frecuencia_cardiaca ?? null,
    horas_sueno: entrada.horas_sueno ?? null,
    nivel_estres: entrada.nivel_estres ?? null,
    imc: imc(entrada.peso, perfil?.alturaCm),
    tabaquismo: perfil?.fumador == null ? null : perfil.fumador ? 1 : 0,
  };
}

const UMBRALES: [number, string][] = [
  [85, "Excelente"],
  [70, "Muy bueno"],
  [55, "Bueno"],
  [40, "Mejorable"],
  [0, "En riesgo"],
];

export function etiquetaScore(score: number | null): string {
  if (score === null) return "Sin datos";
  for (const [min, etiqueta] of UMBRALES) if (score >= min) return etiqueta;
  return "En riesgo";
}

export function calcularIndice(valores: ValoresFactores, perfil: Perfil | null): ResultadoRiesgo {
  const factores: FactorResultado[] = FACTORES.map((def) => {
    const v = valores[def.clave];
    const disponible = v !== undefined && v !== null && Number.isFinite(v);
    return {
      clave: def.clave,
      label: def.label,
      unidad: def.unidad,
      valor: disponible ? v : null,
      estado: disponible ? def.estado(v) : "sin-datos",
      logRR: disponible ? def.logRR(v) : 0,
      logRRMax: logRRMax(def),
      puntosPerdidos: 0,
      maxPuntos: 0,
      evidencia: def.evidencia,
      fuente: def.fuente,
    };
  });

  const disponibles = factores.filter((f) => f.valor !== null);
  let L = 0;
  let LMax = 0;
  for (const f of disponibles) {
    L += f.logRR;
    LMax += f.logRRMax;
  }
  const insuficiente = disponibles.length < 2 || !(LMax > 0);

  let score: number | null = null;
  if (!insuficiente) {
    for (const f of disponibles) {
      f.maxPuntos = (100 * f.logRRMax) / LMax;
      f.puntosPerdidos = (100 * f.logRR) / LMax;
    }
    score = Math.max(0, Math.min(100, Math.round(100 * (1 - L / LMax))));
  }

  const detalle: string[] = [];
  let multiplicador: number | null = null;
  if (perfil?.edad != null) {
    const le = logRREdad(perfil.edad);
    const ls = logRRSexo(perfil.sexo);
    multiplicador = Math.exp(le + ls);
    detalle.push(
      le > 0
        ? `Edad ${perfil.edad}: ×${Math.exp(le).toFixed(1)} respecto de una persona de 40 años`
        : `Edad ${perfil.edad}: sin recargo por edad (menor de 40)`
    );
    if (ls > 0) detalle.push(`Sexo masculino: ×${Math.exp(ls).toFixed(1)}`);
  } else {
    detalle.push("Sin edad en el perfil: el contexto no se evalúa");
  }

  return {
    score,
    etiqueta: etiquetaScore(score),
    riesgoRelativo: insuficiente ? null : Math.exp(L),
    L,
    LMax,
    factores,
    contexto: { multiplicador, detalle },
    cobertura: { disponibles: disponibles.length, total: factores.length },
    insuficiente,
  };
}
