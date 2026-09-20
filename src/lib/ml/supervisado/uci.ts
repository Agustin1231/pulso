// Carga y codificación del dataset UCI Heart Disease (Cleveland).
// Ver data/uci-heart-disease/README.md para la fuente, la licencia y las columnas.

import type { Matriz } from "./algebra";

export const COLUMNAS = [
  "age", "sex", "cp", "trestbps", "chol", "fbs", "restecg",
  "thalach", "exang", "oldpeak", "slope", "ca", "thal", "num",
] as const;
export type Columna = (typeof COLUMNAS)[number];

export type FilaUCI = Record<Columna, number>;

export interface DatosUCI {
  filas: FilaUCI[];
  descartadas: number;
}

/** Parsea el archivo `processed.cleveland.data`; descarta filas con `?`. */
export function parsearCleveland(texto: string): DatosUCI {
  const filas: FilaUCI[] = [];
  let descartadas = 0;
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim()) continue;
    const celdas = linea.split(",").map((c) => c.trim());
    if (celdas.length !== COLUMNAS.length || celdas.some((c) => c === "?")) {
      descartadas++;
      continue;
    }
    const fila = {} as FilaUCI;
    COLUMNAS.forEach((col, i) => { fila[col] = Number(celdas[i]); });
    filas.push(fila);
  }
  return { filas, descartadas };
}

export const etiqueta = (fila: FilaUCI): number => (fila.num > 0 ? 1 : 0);

// ─── Conjuntos de variables ──────────────────────────────────────────────────

export interface ConjuntoVariables {
  clave: string;
  nombre: string;
  descripcion: string;
  /** Numéricas y binarias que entran tal cual. */
  numericas: Columna[];
  /** Categóricas que se codifican one-hot dejando afuera la primera categoría. */
  categoricas: { columna: Columna; niveles: number[] }[];
}

export const CONJUNTOS: ConjuntoVariables[] = [
  {
    clave: "completo",
    nombre: "Completo (13 variables)",
    descripcion: "Todas las variables clínicas del dataset, incluidas las de ECG y prueba de esfuerzo.",
    numericas: ["age", "sex", "trestbps", "chol", "fbs", "thalach", "exang", "oldpeak", "ca"],
    categoricas: [
      { columna: "cp", niveles: [1, 2, 3, 4] },
      { columna: "restecg", niveles: [0, 1, 2] },
      { columna: "slope", niveles: [1, 2, 3] },
      { columna: "thal", niveles: [3, 6, 7] },
    ],
  },
  {
    clave: "clinico_basico",
    nombre: "Clínico básico (6 variables)",
    descripcion: "Lo que se mide en un consultorio sin ECG ni ergometría: edad, sexo, presión sistólica, colesterol, glucemia y frecuencia cardíaca máxima.",
    numericas: ["age", "sex", "trestbps", "chol", "fbs", "thalach"],
    categoricas: [],
  },
  {
    clave: "pulso",
    nombre: "Solo lo que Pulso captura (3 variables)",
    descripcion: "Edad y sexo (perfil) y frecuencia cardíaca (thalach es la máxima en esfuerzo, no la de reposo: es la aproximación más cercana que ofrece el dataset).",
    numericas: ["age", "sex", "thalach"],
    categoricas: [],
  },
];

export interface MatrizDiseno {
  X: Matriz;
  y: number[];
  nombres: string[];
}

export function construirMatriz(filas: readonly FilaUCI[], conjunto: ConjuntoVariables): MatrizDiseno {
  const nombres: string[] = [...conjunto.numericas];
  for (const c of conjunto.categoricas) for (const nivel of c.niveles.slice(1)) nombres.push(`${c.columna}=${nivel}`);
  const X = filas.map((f) => {
    const fila: number[] = conjunto.numericas.map((col) => f[col]);
    for (const c of conjunto.categoricas) for (const nivel of c.niveles.slice(1)) fila.push(f[c.columna] === nivel ? 1 : 0);
    return fila;
  });
  return { X, y: filas.map(etiqueta), nombres };
}
