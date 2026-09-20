// Álgebra lineal mínima para IRLS: sistemas chicos (≤ 20 incógnitas).

export type Matriz = number[][];

export function ceros(filas: number, columnas: number): Matriz {
  return Array.from({ length: filas }, () => new Array<number>(columnas).fill(0));
}

/** Resuelve A·x = b por eliminación gaussiana con pivoteo parcial. Modifica copias. */
export function resolver(A: Matriz, b: readonly number[]): number[] {
  const n = b.length;
  const M = A.map((fila, i) => [...fila, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let f = col + 1; f < n; f++) if (Math.abs(M[f][col]) > Math.abs(M[piv][col])) piv = f;
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error("Sistema singular: hay columnas colineales");
    if (piv !== col) [M[piv], M[col]] = [M[col], M[piv]];
    for (let f = col + 1; f < n; f++) {
      const factor = M[f][col] / M[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) M[f][c] -= factor * M[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let f = n - 1; f >= 0; f--) {
    let s = M[f][n];
    for (let c = f + 1; c < n; c++) s -= M[f][c] * x[c];
    x[f] = s / M[f][f];
  }
  return x;
}

/** Inversa por Gauss-Jordan (para los errores estándar). */
export function invertir(A: Matriz): Matriz {
  const n = A.length;
  const M = A.map((fila, i) => [...fila, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let f = col + 1; f < n; f++) if (Math.abs(M[f][col]) > Math.abs(M[piv][col])) piv = f;
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error("Matriz singular");
    if (piv !== col) [M[piv], M[col]] = [M[col], M[piv]];
    const p = M[col][col];
    for (let c = 0; c < 2 * n; c++) M[col][c] /= p;
    for (let f = 0; f < n; f++) {
      if (f === col) continue;
      const factor = M[f][col];
      if (factor === 0) continue;
      for (let c = 0; c < 2 * n; c++) M[f][c] -= factor * M[col][c];
    }
  }
  return M.map((fila) => fila.slice(n));
}
