"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { METRICA_MAP } from "@/lib/metricas-config";
import type { MetricaRow, MetricaType } from "@/lib/db/types";
import type { Prediccion } from "@/lib/ml/tipos";

const COLOR_MAP: Record<string, string> = {
  coral:  "#ff6b6b",
  teal:   "#00d4aa",
  amber:  "#f0a500",
  purple: "#a371f7",
  blue:   "#58a6ff",
  green:  "#3fb950",
};

interface Props {
  tipo:       MetricaType;
  historial:  MetricaRow[];
  /** Pronóstico del motor; se dibuja punteado con las bandas del 80 % y 95 %. */
  pronostico?: Prediccion[];
}

interface Punto {
  fecha:  string;
  valor?: number;
  pron?:  number;
  b80?:   [number, number];
  b95?:   [number, number];
}

interface TooltipProps {
  active?:  boolean;
  payload?: Array<{ payload: Punto }>;
  label?:   string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      {p.valor !== undefined && <p className="font-bold text-foreground">{p.valor}</p>}
      {p.valor === undefined && p.pron !== undefined && (
        <>
          <p className="font-bold text-foreground">≈ {p.pron}</p>
          {p.b80 && (
            <p className="text-muted-foreground">80 %: {p.b80[0]} – {p.b80[1]}</p>
          )}
        </>
      )}
    </div>
  );
}

export function GraficaMetrica({ tipo, historial, pronostico }: Props) {
  const cfg = METRICA_MAP[tipo];
  if (!cfg) return null;

  const color = COLOR_MAP[cfg.color] ?? "#ff6b6b";

  if (historial.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
        Aún no hay datos para graficar. Registra tu primera métrica.
      </div>
    );
  }

  const redondear = (v: number) => Number(cfg.paso < 1 ? v.toFixed(1) : Math.round(v));
  const etiqueta = (iso: string) => format(parseISO(iso), "d MMM", { locale: es });

  const data: Punto[] = historial.map((r) => ({
    fecha: etiqueta(r.created_at),
    valor: redondear(r.valor),
  }));
  const hoyLabel = data[data.length - 1].fecha;

  const hayPronostico = !!pronostico?.length;
  if (hayPronostico) {
    // La línea punteada arranca en el último valor real.
    data[data.length - 1].pron = data[data.length - 1].valor;
    for (const p of pronostico as Prediccion[]) {
      data.push({
        fecha: etiqueta(p.fecha),
        pron:  redondear(p.media),
        b80:   [redondear(p.ic80[0]), redondear(p.ic80[1])],
        b95:   [redondear(p.ic95[0]), redondear(p.ic95[1])],
      });
    }
  }

  const [rMin, rMax] = cfg.rango.normal;

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="fecha"
            tick={{ fontSize: 10, fill: "#8b949e" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#8b949e" }}
            tickLine={false}
            axisLine={false}
            domain={["auto", "auto"]}
          />
          <Tooltip content={<CustomTooltip />} />
          {/*
            Sin fragmentos como hijos del chart: Recharts los aplana con
            `isFragment` de react-is, que con React 19 no reconoce los elementos
            (cambió el $$typeof) y descarta todo lo que hay adentro.
          */}
          {/* Banda de rango normal */}
          {tipo !== "peso" && (
            <ReferenceLine y={rMax} stroke={color} strokeDasharray="3 3" strokeOpacity={0.4} />
          )}
          {tipo !== "peso" && (
            <ReferenceLine y={rMin} stroke="#3fb950" strokeDasharray="3 3" strokeOpacity={0.4} />
          )}
          {/* Pronóstico: bandas 95 % y 80 %, línea punteada, marca de hoy */}
          {hayPronostico && (
            <ReferenceLine
              x={hoyLabel}
              stroke="#8b949e"
              strokeDasharray="2 2"
              label={{ value: "hoy", fontSize: 9, fill: "#8b949e", position: "insideTopLeft" }}
            />
          )}
          {hayPronostico && (
            <Area type="monotone" dataKey="b95" stroke="none" fill={color} fillOpacity={0.07} isAnimationActive={false} />
          )}
          {hayPronostico && (
            <Area type="monotone" dataKey="b80" stroke="none" fill={color} fillOpacity={0.16} isAnimationActive={false} />
          )}
          {hayPronostico && (
            <Line
              type="monotone"
              dataKey="pron"
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeOpacity={0.85}
              dot={false}
              isAnimationActive={false}
            />
          )}
          <Line
            type="monotone"
            dataKey="valor"
            stroke={color}
            strokeWidth={2}
            dot={{ fill: color, strokeWidth: 0, r: 3 }}
            activeDot={{ r: 5, fill: color }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
