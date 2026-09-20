// Piezas compartidas por CUSUM y EWMA: línea base personal, severidad y texto.

import type { Alerta, MetricaType, SerieDiaria } from "../tipos";
import { media } from "../estadistica";
import { METRICA_MAP } from "../../metricas-config";

export interface ObservacionIndexada {
  i: number;
  fecha: string;
  valor: number;
}

/**
 * Línea base personal auto-iniciada (Hawkins 1987). Arranca con las primeras
 * `nBase` observaciones y sigue absorbiendo TODAS las siguientes hasta la
 * primera alarma, así el error de estimar μ₀ y σ₀ con pocos datos —que dispara
 * falsas alarmas— se achica con el tiempo sin sesgar σ̂ (absorber solo las
 * observaciones "tranquilas" lo encogería). Tras la alarma la base se congela:
 * el desvío se sigue confirmando contra el régimen anterior. Media y varianza
 * corrientes por el método de Welford.
 */
export interface LineaBase {
  readonly mu: number;
  readonly sigma: number;
  readonly n: number;
  absorber(y: number): void;
}

/**
 * Ruido mínimo asumido por métrica. Sin esto, 14 días idénticos darían σ = 0 y
 * cualquier variación dispararía una alerta.
 */
export const SIGMA_MIN: Partial<Record<MetricaType, number>> = {
  frecuencia_cardiaca: 1.5,
  horas_sueno: 0.25,
  nivel_estres: 0.5,
  peso: 0.3,
};

/** En qué dirección el cambio es clínicamente adverso. */
const ADVERSA: Partial<Record<MetricaType, "sube" | "baja">> = {
  frecuencia_cardiaca: "sube",
  horas_sueno: "baja",
  nivel_estres: "sube",
  peso: "sube",
  presion_sistolica: "sube",
  presion_diastolica: "sube",
  glucosa: "sube",
  colesterol_total: "sube",
};

/** Límite de winsorización en σ: un outlier aislado no debe cargar la carta de un saque. */
export const WINSOR = 3;

export function winsorizar(z: number, limite = WINSOR): number {
  return Math.max(-limite, Math.min(limite, z));
}

export function observaciones(serie: SerieDiaria): ObservacionIndexada[] {
  const out: ObservacionIndexada[] = [];
  serie.y.forEach((v, i) => {
    if (v !== null) out.push({ i, fecha: serie.dias[i], valor: v });
  });
  return out;
}

export function lineaBase(
  obs: readonly ObservacionIndexada[],
  metrica: MetricaType,
  nBase: number
): LineaBase {
  const base = obs.slice(0, nBase).map((o) => o.valor);
  const piso = SIGMA_MIN[metrica] ?? 1e-6;
  let n = base.length;
  let mu = media(base);
  let m2 = 0;
  for (const x of base) m2 += (x - mu) * (x - mu);
  return {
    get mu() {
      return mu;
    },
    get sigma() {
      return Math.max(n > 1 ? Math.sqrt(m2 / (n - 1)) : 0, piso);
    },
    get n() {
      return n;
    },
    absorber(y) {
      n++;
      const d = y - mu;
      mu += d / n;
      m2 += d * (y - mu);
    },
  };
}

export function severidad(metrica: MetricaType, direccion: "sube" | "baja", magnitudSigma: number): Alerta["severidad"] {
  const adversa = ADVERSA[metrica];
  if (adversa !== direccion) return "info";
  const m = Math.abs(magnitudSigma);
  if (m >= 3) return "alta";
  if (m >= 1.5) return "atencion";
  return "info";
}

function fechaCorta(dia: string): string {
  const [, m, d] = dia.split("-");
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${Number(d)} ${meses[Number(m) - 1]}`;
}

export function armarAlerta(
  metrica: MetricaType,
  metodo: Alerta["metodo"],
  direccion: "sube" | "baja",
  magnitudSigma: number,
  magnitud: number,
  desde: string,
  detectadaEn: string,
  hasta: string = detectadaEn
): Alerta {
  const cfg = METRICA_MAP[metrica];
  const label = cfg?.label ?? metrica;
  const unidad = cfg?.unidad ?? "";
  const decimales = cfg && cfg.paso < 1 ? 1 : 0;
  const verbo = direccion === "sube" ? "subió" : "bajó";
  const persiste = hasta > detectadaEn ? `, se mantiene al ${fechaCorta(hasta)}` : "";
  const mensaje =
    `${label} ${verbo} ~${Math.abs(magnitud).toFixed(decimales)} ${unidad} de forma sostenida ` +
    `desde el ${fechaCorta(desde)} (detectado el ${fechaCorta(detectadaEn)}${persiste}; ` +
    `${metodo.toUpperCase()}, ${Math.abs(magnitudSigma).toFixed(1)}σ sobre tu línea base)`;
  return {
    metrica,
    metodo,
    direccion,
    magnitudSigma,
    magnitud,
    desde,
    detectadaEn,
    hasta,
    severidad: severidad(metrica, direccion, magnitudSigma),
    mensaje,
  };
}

/**
 * Un desvío que persiste vuelve a disparar la carta cada pocos días. Las alertas
 * consecutivas del mismo método y dirección se funden en una sola: `desde` y
 * `detectadaEn` de la primera, `hasta` de la última.
 */
export function consolidar(alertas: readonly Alerta[], maxSeparacionDias = 3): Alerta[] {
  const out: Alerta[] = [];
  for (const a of alertas) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.metodo === a.metodo &&
      prev.direccion === a.direccion &&
      diasEntreSimple(prev.hasta, a.desde) <= maxSeparacionDias
    ) {
      const fusion = armarAlerta(
        a.metrica,
        a.metodo,
        a.direccion,
        (prev.magnitudSigma + a.magnitudSigma) / 2,
        (prev.magnitud + a.magnitud) / 2,
        prev.desde,
        prev.detectadaEn,
        a.hasta
      );
      out[out.length - 1] = fusion;
    } else {
      out.push(a);
    }
  }
  return out;
}

function diasEntreSimple(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}
