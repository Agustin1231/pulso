"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, ChevronDown, ChevronUp, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { METRICA_MAP } from "@/lib/metricas-config";
import type { MetricaType } from "@/lib/db/types";
import type { InformeMetrica, Alerta } from "@/lib/ml/tipos";

interface Props {
  tipo: MetricaType;
  info: InformeMetrica | undefined;
}

/** Dirección en la que un cambio es adverso (misma tabla que usa el motor para la severidad). */
const ADVERSA: Partial<Record<MetricaType, "sube" | "baja">> = {
  frecuencia_cardiaca: "sube",
  horas_sueno: "baja",
  nivel_estres: "sube",
  peso: "sube",
};

export const SEVERIDAD_CLS: Record<Alerta["severidad"], string> = {
  alta:     "bg-coral/10 text-coral border-coral/25",
  atencion: "bg-amber/10 text-amber border-amber/25",
  info:     "bg-blue/10 text-blue border-blue/25",
};

export function formatear(tipo: MetricaType, v: number): string {
  const cfg = METRICA_MAP[tipo];
  if (!cfg) return String(v);
  if (tipo === "horas_sueno") return `${Math.floor(v)}h ${Math.round((v % 1) * 60)}m`;
  const s = cfg.paso < 1 ? v.toFixed(1) : String(Math.round(v));
  return cfg.unidad.startsWith("/") ? `${s}${cfg.unidad}` : `${s} ${cfg.unidad}`;
}

export function PronosticoInfo({ tipo, info }: Props) {
  const [verTabla, setVerTabla] = useState(false);
  const cfg = METRICA_MAP[tipo];

  if (!info) {
    return (
      <p className="text-xs text-muted-foreground">
        Sin datos suficientes para pronosticar esta métrica.
      </p>
    );
  }

  const t = info.tendencia;
  const adversa = ADVERSA[tipo];
  const tendenciaColor =
    !t || t.direccion === "estable" ? "text-muted-foreground"
    : t.direccion === adversa ? "text-coral" : "text-green";
  const TendIcon = !t || t.direccion === "estable" ? Minus : t.direccion === "sube" ? TrendingUp : TrendingDown;
  const decimales = cfg && cfg.paso < 1 ? 2 : 1;

  const p7 = info.pronostico[6];
  const p30 = info.pronostico[info.pronostico.length - 1];
  const conf = info.modelo.confianza;

  return (
    <div className="space-y-3">
      {/* Tendencia + pronóstico */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-surface-2 border border-border px-3 py-2 flex items-center gap-2">
          <TendIcon className={cn("h-4 w-4 shrink-0", tendenciaColor)} />
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Tendencia</p>
            <p className={cn("font-medium", tendenciaColor)}>
              {!t
                ? "Faltan registros (mín. 5)"
                : t.direccion === "estable"
                  ? "Estable"
                  : `${t.direccion === "sube" ? "Sube" : "Baja"} ${Math.abs(t.pendientePorSemana).toFixed(decimales)} ${cfg?.unidad ?? ""} por semana`}
              {t?.significativa && t.direccion !== "estable" && (
                <span className="text-muted-foreground font-normal"> · significativa</span>
              )}
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-surface-2 border border-border px-3 py-2">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Pronóstico (80 %)</p>
          {p7 && p30 ? (
            <p className="font-medium text-foreground">
              7 d: {formatear(tipo, p7.media)}
              <span className="text-muted-foreground font-normal"> ({formatear(tipo, p7.ic80[0])} – {formatear(tipo, p7.ic80[1])})</span>
              <br />
              {p30.h} d: {formatear(tipo, p30.media)}
              <span className="text-muted-foreground font-normal"> ({formatear(tipo, p30.ic80[0])} – {formatear(tipo, p30.ic80[1])})</span>
            </p>
          ) : (
            <p className="text-muted-foreground">No disponible</p>
          )}
        </div>
      </div>

      {/* Modelo */}
      <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
        <button onClick={() => setVerTabla((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left">
          <span className="flex items-center gap-1.5 min-w-0">
            <Info className="h-3.5 w-3.5 text-purple shrink-0" />
            <span className="truncate">
              <span className="font-medium text-foreground">{info.modelo.nombre}</span>
              {info.modelo.mase !== null && (
                <span className="text-muted-foreground"> · MASE {info.modelo.mase.toFixed(2)}</span>
              )}
              <span className={cn(
                "ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border",
                conf === "alta" ? "bg-green/10 text-green border-green/25"
                : conf === "media" ? "bg-amber/10 text-amber border-amber/25"
                : "bg-surface text-muted-foreground border-border"
              )}>
                confianza {conf}
              </span>
            </span>
          </span>
          {verTabla ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        </button>

        {verTabla && (
          <div className="mt-2 pt-2 border-t border-border/60 space-y-2">
            <p className="text-muted-foreground leading-relaxed">{info.modelo.razon}</p>
            {info.modelo.tabla.length > 0 && (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left font-medium py-1">Modelo</th>
                    <th className="text-right font-medium py-1">MAE</th>
                    <th className="text-right font-medium py-1">MASE</th>
                    <th className="text-right font-medium py-1">IC 80 %</th>
                  </tr>
                </thead>
                <tbody>
                  {info.modelo.tabla.map((f) => (
                    <tr key={f.clave} className={cn(f.seleccionado ? "text-foreground font-semibold" : "text-muted-foreground")}>
                      <td className="py-0.5">{f.seleccionado ? "★ " : ""}{f.nombre}</td>
                      <td className="text-right tabular-nums">{Number.isFinite(f.mae) ? f.mae.toFixed(2) : "—"}</td>
                      <td className="text-right tabular-nums">{Number.isFinite(f.mase) ? f.mase.toFixed(2) : "—"}</td>
                      <td className="text-right tabular-nums">{Number.isFinite(f.cobertura80) ? `${Math.round(f.cobertura80 * 100)} %` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-[10px] text-muted-foreground">
              MASE &lt; 1 = mejor que repetir el último valor. Elegido por backtesting sobre tu propio historial.
            </p>
          </div>
        )}
      </div>

      {/* Alertas */}
      {info.alertas.length > 0 && (
        <div className="space-y-1.5">
          {info.alertas.map((a, i) => (
            <div key={i} className={cn("rounded-lg border px-3 py-2 text-xs flex gap-2", SEVERIDAD_CLS[a.severidad])}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="text-foreground/90">{a.mensaje}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
