import "server-only";

// Único punto donde el motor de predicción (`lib/ml`, puro) toca la base.
// Carga historial, perfil y adherencia, los mapea a `EntradaInforme` y delega.
//
// No es "use server": recibe el uid, así que solo lo llaman la server action
// `getInforme` y los route handlers, que ya resolvieron la sesión.

import { generarInforme } from "@/lib/ml";
import type { Informe, MetricaType, Observacion, Perfil } from "@/lib/ml/tipos";
import { hoyLocal, sumarDias } from "@/lib/ml/series";
import { adherenciaDiaria, historialMetricas, perfilDe } from "./consultas";
import type { Db } from "./pool";

/** Hábitos fijos que muestra la UI (`HABITOS_FIJOS` en habitos-client.tsx). */
const HABITOS_FIJOS_TOTAL = 4;
const DIAS_HISTORIAL = 90;

export async function calcularInforme(db: Db, uid: string): Promise<Informe> {
  const hoy = hoyLocal();
  const desde = sumarDias(hoy, -DIAS_HISTORIAL);

  // Secuencial: comparten la conexión de la transacción del usuario.
  const filas = await historialMetricas(db, uid, DIAS_HISTORIAL);
  const perfilRow = await perfilDe(db, uid);
  const adherenciaRows = await adherenciaDiaria(db, uid, desde, hoy);

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
