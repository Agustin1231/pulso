import type { MetricaType } from "./db/types";

export type Estado = "normal" | "atencion" | "riesgo" | "sin-datos";

export interface MetricaConfig {
  tipo:    MetricaType;
  label:   string;
  unidad:  string;
  emoji:   string;
  color:   "coral" | "teal" | "amber" | "purple" | "blue" | "green";
  min:     number;
  max:     number;
  paso:    number;
  rango: {
    normal:   [number, number];
    atencion: [number, number];
  };
  descripcion: string;
}

export const METRICAS: MetricaConfig[] = [
  {
    tipo:    "frecuencia_cardiaca",
    label:   "Frecuencia Cardíaca",
    unidad:  "bpm",
    emoji:   "❤️",
    color:   "coral",
    min: 30, max: 220, paso: 1,
    rango: { normal: [60, 100], atencion: [100, 120] },
    descripcion: "Latidos por minuto en reposo",
  },
  {
    tipo:    "peso",
    label:   "Peso",
    unidad:  "kg",
    emoji:   "⚖️",
    color:   "purple",
    min: 20, max: 300, paso: 0.1,
    rango: { normal: [0, 9999], atencion: [0, 9999] },
    descripcion: "Tu peso corporal actual",
  },
  {
    tipo:    "horas_sueno",
    label:   "Horas de Sueño",
    unidad:  "h",
    emoji:   "😴",
    color:   "teal",
    min: 0, max: 24, paso: 0.5,
    rango: { normal: [7, 9], atencion: [6, 7] },
    descripcion: "Horas dormidas la noche anterior",
  },
  {
    tipo:    "nivel_estres",
    label:   "Nivel de Estrés",
    unidad:  "/10",
    emoji:   "🧠",
    color:   "amber",
    min: 1, max: 10, paso: 1,
    rango: { normal: [1, 3], atencion: [4, 6] },
    descripcion: "Tu nivel de estrés hoy (1 = bajo, 10 = muy alto)",
  },
];

export const METRICA_MAP = Object.fromEntries(
  METRICAS.map((m) => [m.tipo, m])
) as Record<MetricaType, MetricaConfig>;

export function getEstado(tipo: MetricaType, valor: number): Estado {
  const cfg = METRICA_MAP[tipo];
  if (!cfg) return "sin-datos";
  // Peso no tiene rangos de riesgo definidos
  if (tipo === "peso") return "normal";
  const [nMin, nMax] = cfg.rango.normal;
  const [aMin, aMax] = cfg.rango.atencion;
  if (valor >= nMin && valor <= nMax) return "normal";
  if (valor >= aMin && valor <= aMax) return "atencion";
  if (valor > aMax || valor < nMin) return "riesgo";
  return "normal";
}

export const ESTADO_COLORS: Record<Estado, string> = {
  normal:      "text-green",
  atencion:    "text-amber",
  riesgo:      "text-coral",
  "sin-datos": "text-muted-foreground",
};

export const ESTADO_BG: Record<Estado, string> = {
  normal:      "bg-green/10 border-green/25",
  atencion:    "bg-amber/10 border-amber/25",
  riesgo:      "bg-coral/10 border-coral/25",
  "sin-datos": "bg-surface-2 border-border",
};

export const ESTADO_LABEL: Record<Estado, string> = {
  normal:      "Normal",
  atencion:    "Atención",
  riesgo:      "Riesgo",
  "sin-datos": "Sin datos",
};
