"use client";

import { useEffect, useState, useCallback } from "react";
import { useAnonymousId } from "@/hooks/use-anonymous-id";
import { getUltimasMetricas, getHistorialMetrica } from "@/lib/db/metricas";
import { getInforme } from "@/lib/db/informe";
import type { MetricaRow } from "@/lib/db/types";
import type { Informe } from "@/lib/ml/tipos";
import { METRICA_MAP } from "@/lib/metricas-config";
import { RegistrarMetrica } from "./registrar-metrica";
import { TarjetasResumen }  from "./tarjetas-resumen";
import { GraficaMetrica }   from "./grafica-metrica";
import { PronosticoInfo }   from "./pronostico-info";
import { AnalisisIA }       from "./analisis-ia";
import type { MetricaType } from "@/lib/db/types";
import { Loader2, WifiOff, RefreshCw } from "lucide-react";

export function DashboardClient() {
  const uid = useAnonymousId();

  const [ultimas,    setUltimas]    = useState<MetricaRow[]>([]);
  const [informe,    setInforme]    = useState<Informe | null>(null);
  const [historial,  setHistorial]  = useState<MetricaRow[]>([]);
  const [seleccion,  setSeleccion]  = useState<MetricaType | null>(null);
  const [cargando,   setCargando]   = useState(true);
  const [sinConexion, setSinConexion] = useState(false);

  const cargarDatos = useCallback(async () => {
    if (!uid) return;
    setCargando(true);
    setSinConexion(false);
    // El informe (pronósticos, alertas, modelo elegido) lo calcula el motor en
    // el servidor sobre los últimos 90 días; se pide junto con los últimos valores.
    try {
      const [data, inf] = await Promise.all([
        getUltimasMetricas(uid),
        getInforme(uid).catch(() => null),
      ]);
      setUltimas(data);
      setInforme(inf);
      // Seleccionar la primera métrica con datos por defecto
      if (data.length > 0 && !seleccion) {
        setSeleccion(data[0].tipo);
      }
    } catch {
      // Sin conexión (la app abrió desde el caché del service worker) o servidor caído.
      setSinConexion(true);
    } finally {
      setCargando(false);
    }
  }, [uid, seleccion]);

  useEffect(() => { cargarDatos(); }, [uid]);

  useEffect(() => {
    if (!uid || !seleccion) return;
    getHistorialMetrica(uid, seleccion, 30).then(setHistorial).catch(() => setHistorial([]));
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

  if (sinConexion) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-center text-muted-foreground">
        <WifiOff className="h-6 w-6" />
        <p className="text-sm max-w-xs">
          No se pudieron cargar tus métricas. Revisa la conexión: los datos y el motor de predicción corren en el servidor.
        </p>
        <button
          onClick={cargarDatos}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-surface-2"
        >
          <RefreshCw className="h-4 w-4" /> Reintentar
        </button>
      </div>
    );
  }

  const metricaSeleccionada = seleccion ? METRICA_MAP[seleccion] : null;
  const infoSeleccionada = seleccion ? informe?.metricas[seleccion] : undefined;
  const conAlerta = new Set<MetricaType>(
    Object.entries(informe?.metricas ?? {})
      .filter(([, m]) => m.alertas.some((a) => a.severidad !== "info"))
      .map(([tipo]) => tipo as MetricaType)
  );

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
          alertas={conAlerta}
        />
      </div>

      {/* Gráfica + pronóstico */}
      {seleccion && (
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="text-lg">{metricaSeleccionada?.emoji}</span>
            <div>
              <p className="text-sm font-bold">{metricaSeleccionada?.label}</p>
              <p className="text-xs text-muted-foreground">
                {infoSeleccionada?.pronostico.length
                  ? `Últimos 30 días y pronóstico a ${infoSeleccionada.pronostico[infoSeleccionada.pronostico.length - 1].h} días`
                  : "Últimos 30 días"}
              </p>
            </div>
          </div>
          <GraficaMetrica tipo={seleccion} historial={historial} pronostico={infoSeleccionada?.pronostico} />
          <PronosticoInfo tipo={seleccion} info={infoSeleccionada} />
        </div>
      )}

      {/* Análisis IA */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Análisis personalizado
        </h3>
        <AnalisisIA uid={uid} hayDatos={ultimas.length > 0} />
      </div>

    </div>
  );
}
