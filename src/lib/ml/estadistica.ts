// Utilidades estadísticas del motor. Sin dependencias.

export function suma(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function media(xs: readonly number[]): number {
  return xs.length === 0 ? NaN : suma(xs) / xs.length;
}

/** Varianza muestral (divisor n−1). 0 si hay menos de dos valores. */
export function varianza(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = media(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (n - 1);
}

export function sd(xs: readonly number[]): number {
  return Math.sqrt(varianza(xs));
}

export function mediana(xs: readonly number[]): number {
  return cuantil(xs, 0.5);
}

/** Cuantil con interpolación lineal (tipo 7 de R, el default de numpy). */
export function cuantil(xs: readonly number[], p: number): number {
  const n = xs.length;
  if (n === 0) return NaN;
  const orden = [...xs].sort((a, b) => a - b);
  const pos = (n - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return orden[lo];
  return orden[lo] + (orden[hi] - orden[lo]) * (pos - lo);
}

/** Desviación absoluta mediana (robusta a outliers). */
export function mad(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const m = mediana(xs);
  return mediana(xs.map((x) => Math.abs(x - m)));
}

export function redondear(x: number, decimales = 2): number {
  const f = 10 ** decimales;
  return Math.round(x * f) / f;
}

/**
 * Inversa de la normal estándar. Algoritmo de Acklam (2003), error relativo
 * máximo 1.15e-9 en todo (0, 1). Suficiente para intervalos de predicción.
 */
export function cuantilNormal(p: number): number {
  if (!(p > 0 && p < 1)) {
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    return NaN;
  }
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/**
 * Cuantil de la t de Student por la expansión de Cornish-Fisher
 * (Abramowitz & Stegun, fórmula 26.7.5). Error < 1 % para gl ≥ 3, que es lo
 * que exige el motor (OLS con n ≥ 5). Con gl ≥ 200 devuelve la normal.
 */
export function cuantilT(p: number, gl: number): number {
  const z = cuantilNormal(p);
  if (!Number.isFinite(z) || gl >= 200) return z;
  const v = Math.max(1, gl);
  const z2 = z * z;
  const z3 = z2 * z;
  const z5 = z3 * z2;
  const z7 = z5 * z2;
  const z9 = z7 * z2;
  const g1 = (z3 + z) / 4;
  const g2 = (5 * z5 + 16 * z3 + 3 * z) / 96;
  const g3 = (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / 384;
  const g4 = (79 * z9 + 776 * z7 + 1482 * z5 - 1920 * z3 - 945 * z) / 92160;
  return z + g1 / v + g2 / v ** 2 + g3 / v ** 3 + g4 / v ** 4;
}

// ─── Generador pseudoaleatorio determinista ──────────────────────────────────

export interface PRNG {
  /** Uniforme en [0, 1). */
  uniforme(): number;
  /** Normal(mu, sigma) por Box-Muller. */
  normal(mu?: number, sigma?: number): number;
  /** Entero uniforme en [min, max]. */
  entero(min: number, max: number): number;
}

/** mulberry32: 32 bits, rápido, reproducible con la misma semilla. */
export function crearPRNG(semilla: number): PRNG {
  let a = semilla >>> 0;
  const uniforme = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = (mu = 0, sigma = 1) => {
    let u = 0;
    let v = 0;
    while (u === 0) u = uniforme();
    while (v === 0) v = uniforme();
    return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const entero = (min: number, max: number) =>
    min + Math.floor(uniforme() * (max - min + 1));
  return { uniforme, normal, entero };
}
