"use client";

import { useEffect, useState, useCallback } from "react";
import { useAnonymousId } from "@/hooks/use-anonymous-id";
import { getUltimasMetricas, getHistorialMetrica } from "@/lib/db/metricas";
import type { MetricaRow } from "@/lib/db/types";
import { METRICA_MAP } from "@/lib/metricas-config";
import { RegistrarMetrica } from "./registrar-metrica";
import { TarjetasResumen }  from "./tarjetas-resumen";
import { GraficaMetrica }   from "./grafica-metrica";
import { AnalisisIA }       from "./analisis-ia";
import type { MetricaType } from "@/lib/db/types";
import { Loader2 } from "lucide-react";

export function DashboardClient() {
  const uid = useAnonymousId();

  const [ultimas,    setUltimas]    = useState<MetricaRow[]>([]);
  const [historial,  setHistorial]  = useState<MetricaRow[]>([]);
  const [seleccion,  setSeleccion]  = useState<MetricaType | null>(null);
  const [cargando,   setCargando]   = useState(true);

  const cargarDatos = useCallback(async () => {
    if (!uid) return;
    setCargando(true);
    const data = await getUltimasMetricas(uid);
    setUltimas(data);
    // Seleccionar la primera métrica con datos por defecto
    if (data.length > 0 && !seleccion) {
      setSeleccion(data[0].tipo);
    }
    setCargando(false);
  }, [uid, seleccion]);

  useEffect(() => { cargarDatos(); }, [uid]);

  useEffect(() => {
    if (!uid || !seleccion) return;
    getHistorialMetrica(uid, seleccion, 30).then(setHistorial);
  }, [uid, seleccion]);

  function handleSeleccion(tipo: MetricaType) {
    setSeleccion(tipo);
  }

  if (!uid || cargando) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Cargando métricas...</span>
      </div>
    );
  }

  const metricaSeleccionada = seleccion ? METRICA_MAP[seleccion] : null;

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Registrar */}
      <RegistrarMetrica uid={uid} onGuardar={cargarDatos} />

      {/* Tarjetas de resumen */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Últimos registros
        </h3>
        <TarjetasResumen
          metricas={ultimas}
          uid={uid}
          onSelect={handleSeleccion}
          seleccion={seleccion}
          onActualizar={cargarDatos}
        />
      </div>

      {/* Gráfica */}
      {seleccion && (
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="text-lg">{metricaSeleccionada?.emoji}</span>
            <div>
              <p className="text-sm font-bold">{metricaSeleccionada?.label}</p>
              <p className="text-xs text-muted-foreground">Últimos 30 días</p>
            </div>
          </div>
          <GraficaMetrica tipo={seleccion} historial={historial} />
        </div>
      )}

      {/* Análisis IA */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Análisis personalizado
        </h3>
        <AnalisisIA metricas={ultimas} />
      </div>

    </div>
  );
}
