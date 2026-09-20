"use server";

// Único punto donde el motor de predicción (`lib/ml`, puro) toca la base.
// Carga historial, perfil y adherencia, los mapea a `EntradaInforme` y delega.

import { getHistorialMetricas } from "./metricas";
import { getPerfil } from "./perfil";
import { getAdherenciaDiaria } from "./habitos";
import { generarInforme } from "@/lib/ml";
import type { Informe, MetricaType, Observacion, Perfil } from "@/lib/ml/tipos";
import { hoyLocal, sumarDias } from "@/lib/ml/series";

/** Hábitos fijos que muestra la UI (`HABITOS_FIJOS` en habitos-client.tsx). */
const HABITOS_FIJOS_TOTAL = 4;
const DIAS_HISTORIAL = 90;

export async function getInforme(uid: string): Promise<Informe> {
  const hoy = hoyLocal();
  const desde = sumarDias(hoy, -DIAS_HISTORIAL);

  const [filas, perfilRow, adherenciaRows] = await Promise.all([
    getHistorialMetricas(uid, DIAS_HISTORIAL),
    getPerfil(uid),
    getAdherenciaDiaria(uid, desde, hoy),
  ]);

  const metricas: Partial<Record<MetricaType, Observacion[]>> = {};
  for (const f of filas) {
    (metricas[f.tipo] ??= []).push({ fecha: f.created_at, valor: f.valor });
  }

  const perfil: Perfil | null = perfilRow
    ? {
        edad: perfilRow.edad,
        sexo: perfilRow.sexo,
        alturaCm: perfilRow.altura_cm,
        fumador: perfilRow.fumador,
      }
    : null;

  const adherencia = adherenciaRows.map((r) => ({
    fecha: r.fecha,
    valor: Math.min(1, r.completados / HABITOS_FIJOS_TOTAL),
  }));

  return generarInforme({ metricas, perfil, adherencia, hoy });
}
