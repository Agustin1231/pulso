// Validación cruzada estratificada. Las particiones mantienen la proporción de
// positivos y son reproducibles con la semilla.

import { crearPRNG } from "../estadistica";

/** Devuelve k listas de índices de test, disjuntas, estratificadas por `y`. */
export function kFoldEstratificado(y: readonly number[], k: number, semilla: number): number[][] {
  const rng = crearPRNG(semilla);
  const barajar = (idx: number[]) => {
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rng.uniforme() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx;
  };
  const positivos = barajar(y.map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0));
  const negativos = barajar(y.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0));
  const folds: number[][] = Array.from({ length: k }, () => []);
  positivos.forEach((i, n) => folds[n % k].push(i));
  negativos.forEach((i, n) => folds[n % k].push(i));
  return folds;
}

export function complemento(n: number, test: readonly number[]): number[] {
  const enTest = new Set(test);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (!enTest.has(i)) out.push(i);
  return out;
}

export function mediaSd(xs: readonly number[]): { media: number; sd: number } {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.length > 1 ? xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) : 0;
  return { media: m, sd: Math.sqrt(v) };
}
