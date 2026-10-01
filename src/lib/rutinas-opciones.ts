// Opciones del cuestionario de rutinas. Las usa el cliente para mostrarlas y
// el servidor (/api/rutinas) para validar: lo que llega tiene que ser
// exactamente uno de estos valores, no texto libre que termine en el prompt.

export const PASOS = [
  {
    id: "nivel" as const,
    pregunta: "¿Cuál es tu nivel de actividad actual?",
    opciones: [
      { valor: "Sedentario (poco o nada de ejercicio)", etiqueta: "Sedentario", desc: "Poco o nada de ejercicio" },
      { valor: "Algo activo (camino regularmente)", etiqueta: "Algo activo", desc: "Camino regularmente" },
      { valor: "Activo (ejercicio 2-3 veces por semana)", etiqueta: "Activo", desc: "2-3 veces por semana" },
    ],
  },
  {
    id: "tiempo" as const,
    pregunta: "¿Cuánto tiempo tienes disponible?",
    opciones: [
      { valor: "15", etiqueta: "15 min", desc: "Sesión rápida" },
      { valor: "30", etiqueta: "30 min", desc: "Sesión estándar" },
      { valor: "45", etiqueta: "45 min", desc: "Sesión completa" },
      { valor: "60", etiqueta: "60 min", desc: "Sesión larga" },
    ],
  },
  {
    id: "lugar" as const,
    pregunta: "¿Dónde vas a entrenar?",
    opciones: [
      { valor: "En casa sin equipamiento", etiqueta: "En casa", desc: "Sin equipamiento" },
      { valor: "Gimnasio con máquinas", etiqueta: "Gimnasio", desc: "Con máquinas" },
      { valor: "Al aire libre", etiqueta: "Al aire libre", desc: "Parque o calle" },
    ],
  },
  {
    id: "limitacion" as const,
    pregunta: "¿Tienes alguna limitación física?",
    opciones: [
      { valor: "Ninguna limitación", etiqueta: "Ninguna", desc: "Sin restricciones" },
      { valor: "Problemas en rodillas o piernas", etiqueta: "Rodillas/piernas", desc: "Evitar impacto" },
      { valor: "Problemas en espalda o lumbar", etiqueta: "Espalda", desc: "Cuidar lumbar" },
      { valor: "Problemas en hombros o brazos", etiqueta: "Hombros/brazos", desc: "Cuidar tren superior" },
    ],
  },
] as const;

export type PasoId = (typeof PASOS)[number]["id"];

/** Valores aceptados por paso, para la validación del servidor. */
export function valoresDe(id: PasoId): [string, ...string[]] {
  const paso = PASOS.find((p) => p.id === id)!;
  const valores = paso.opciones.map((o) => o.valor);
  return [valores[0], ...valores.slice(1)];
}
