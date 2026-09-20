// Métricas de clasificación y curvas para el experimento supervisado.

export interface MetricasClasificacion {
  auc: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  logLoss: number;
  brier: number;
  n: number;
}

/** AUC-ROC por rangos (estadístico de Mann-Whitney), con empates promediados. */
export function auc(y: readonly number[], p: readonly number[]): number {
  const n = y.length;
  const orden = Array.from({ length: n }, (_, i) => i).sort((a, b) => p[a] - p[b]);
  const rangos = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && p[orden[j + 1]] === p[orden[i]]) j++;
    const rangoMedio = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) rangos[orden[k]] = rangoMedio;
    i = j + 1;
  }
  let nPos = 0;
  let sumaPos = 0;
  for (let k = 0; k < n; k++) if (y[k] === 1) { nPos++; sumaPos += rangos[k]; }
  const nNeg = n - nPos;
  if (nPos === 0 || nNeg === 0) return NaN;
  return (sumaPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

export function metricas(y: readonly number[], p: readonly number[], umbral = 0.5): MetricasClasificacion {
  let tp = 0, fp = 0, fn = 0, tn = 0, ll = 0, brier = 0;
  for (let i = 0; i < y.length; i++) {
    const pi = Math.min(1 - 1e-12, Math.max(1e-12, p[i]));
    const pred = pi >= umbral ? 1 : 0;
    if (pred === 1 && y[i] === 1) tp++;
    else if (pred === 1) fp++;
    else if (y[i] === 1) fn++;
    else tn++;
    ll -= y[i] * Math.log(pi) + (1 - y[i]) * Math.log(1 - pi);
    brier += (pi - y[i]) ** 2;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return {
    auc: auc(y, p),
    accuracy: (tp + tn) / y.length,
    precision,
    recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    logLoss: ll / y.length,
    brier: brier / y.length,
    n: y.length,
  };
}

/** Puntos (FPR, TPR) de la curva ROC barriendo el umbral de mayor a menor. */
export function curvaROC(y: readonly number[], p: readonly number[]): [number, number][] {
  const orden = Array.from({ length: y.length }, (_, i) => i).sort((a, b) => p[b] - p[a]);
  const nPos = y.filter((v) => v === 1).length;
  const nNeg = y.length - nPos;
  const puntos: [number, number][] = [[0, 0]];
  let tp = 0, fp = 0;
  for (let k = 0; k < orden.length; k++) {
    if (y[orden[k]] === 1) tp++; else fp++;
    if (k + 1 < orden.length && p[orden[k + 1]] === p[orden[k]]) continue;
    puntos.push([fp / nNeg, tp / nPos]);
  }
  return puntos;
}

export interface BinCalibracion {
  desde: number;
  hasta: number;
  pMedia: number;
  observada: number;
  n: number;
}

/** Diagrama de confiabilidad: probabilidad predicha media vs. frecuencia observada por bin. */
export function calibracion(y: readonly number[], p: readonly number[], bins = 10): BinCalibracion[] {
  const out: BinCalibracion[] = [];
  for (let b = 0; b < bins; b++) {
    const desde = b / bins;
    const hasta = (b + 1) / bins;
    const idx = p.map((v, i) => i).filter((i) => p[i] >= desde && (b === bins - 1 ? p[i] <= hasta : p[i] < hasta));
    if (idx.length === 0) continue;
    out.push({
      desde,
      hasta,
      pMedia: idx.reduce((s, i) => s + p[i], 0) / idx.length,
      observada: idx.reduce((s, i) => s + y[i], 0) / idx.length,
      n: idx.length,
    });
  }
  return out;
}
