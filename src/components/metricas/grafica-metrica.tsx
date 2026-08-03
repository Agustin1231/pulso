"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { METRICA_MAP } from "@/lib/metricas-config";
import type { MetricaRow, MetricaType } from "@/lib/db/types";

const COLOR_MAP: Record<string, string> = {
  coral:  "#ff6b6b",
  teal:   "#00d4aa",
  amber:  "#f0a500",
  purple: "#a371f7",
  blue:   "#58a6ff",
  green:  "#3fb950",
};

interface Props {
  tipo:     MetricaType;
  historial: MetricaRow[];
}

interface TooltipProps {
  active?:  boolean;
  payload?: Array<{ value: number }>;
  label?:   string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      <p className="font-bold text-foreground">{payload[0].value}</p>
    </div>
  );
}

export function GraficaMetrica({ tipo, historial }: Props) {
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

  const data = historial.map((r) => ({
    fecha: format(parseISO(r.created_at), "d MMM", { locale: es }),
    valor: Number(cfg.paso < 1 ? r.valor.toFixed(1) : Math.round(r.valor)),
  }));

  const [rMin, rMax] = cfg.rango.normal;

  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="fecha"
            tick={{ fontSize: 10, fill: "#8b949e" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#8b949e" }}
            tickLine={false}
            axisLine={false}
            domain={["auto", "auto"]}
          />
          <Tooltip content={<CustomTooltip />} />
          {/* Banda de rango normal */}
          {tipo !== "peso" && (
            <>
              <ReferenceLine
                y={rMax}
                stroke={color}
                strokeDasharray="3 3"
                strokeOpacity={0.4}
              />
              <ReferenceLine
                y={rMin}
                stroke="#3fb950"
                strokeDasharray="3 3"
                strokeOpacity={0.4}
              />
            </>
          )}
          <Line
            type="monotone"
            dataKey="valor"
            stroke={color}
            strokeWidth={2}
            dot={{ fill: color, strokeWidth: 0, r: 3 }}
            activeDot={{ r: 5, fill: color }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
