// Tipos de fila y enums compartidos.
//
// Este módulo NO lleva "use server": es el único de `lib/db` que los componentes
// de cliente pueden importar, porque un archivo "use server" solo puede exportar
// funciones async. Todos los tipos viven acá; los módulos de datos los reimportan.

export type MetricaType =
  | "presion_sistolica"
  | "presion_diastolica"
  | "frecuencia_cardiaca"
  | "peso"
  | "glucosa"
  | "colesterol_total"
  | "horas_sueno"
  | "nivel_estres";

export type HabitoTipo =
  | "ejercicio"
  | "alimentacion"
  | "sueno"
  | "medicamento"
  | "hidratacion";

export type Frecuencia = "diario" | "semanal" | "mensual";

// ─── Métricas ─────────────────────────────────────────────────────────────────

export interface MetricaRow {
  id:         string;
  uid:        string;
  tipo:       MetricaType;
  valor:      number;
  unidad:     string;
  notas:      string | null;
  created_at: string;
}

// ─── Recetas ──────────────────────────────────────────────────────────────────

export interface RecetaRow {
  id:           string;
  uid:          string;
  titulo:       string;
  contenido:    string;
  imagen_url:   string | null;
  ingredientes: string[];
  calificacion: number | null;
  created_at:   string;
}

// ─── Mercado ──────────────────────────────────────────────────────────────────

export interface ListaMercadoRow {
  id:         string;
  uid:        string;
  nombre:     string;
  periodo:    string;
  contenido:  string;
  created_at: string;
}

// ─── Rutinas ──────────────────────────────────────────────────────────────────

export interface Ejercicio {
  bloque:       string;
  nombre:       string;
  detalle:      string;   // ej: "3 series × 12 repeticiones"
  descanso:     number;   // segundos
  descripcion?: string;
}

export interface RutinaContenido {
  texto:      string;
  nivel:      string;
  tiempo:     string;
  lugar:      string;
  limitacion: string;
  metricas?:  { sueno?: number; estres?: number };
  ejercicios?: Ejercicio[];
}

export interface RutinaRow {
  id:         string;
  uid:        string;
  nombre:     string;
  contenido:  RutinaContenido;
  activa:     boolean;
  created_at: string;
}

// ─── Hábitos ──────────────────────────────────────────────────────────────────

export interface HabitoDefinicionRow {
  id:          string;
  uid:         string;
  nombre:      string;
  emoji:       string;
  frecuencia:  Frecuencia;
  hora:        string | null;
  lugar:       string | null;
  dias_semana: string[];
  dia_mes:     number | null;
  activo:      boolean;
  created_at:  string;
}

export interface HabitoFormData {
  nombre:      string;
  emoji:       string;
  frecuencia:  Frecuencia;
  hora:        string | null;
  lugar:       string | null;
  dias_semana: string[];
  dia_mes:     number | null;
}

export interface HabitoFijoRow {
  id:         string;
  uid:        string;
  fecha:      string;
  tipo:       string;
  completado: boolean;
}

export interface HabitoRegistroRow {
  id:     string;
  uid:    string;
  fecha:  string;
  tipo:   string;
  ref_id: string;
}
