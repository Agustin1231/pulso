"use server";

import { pool, mensajeError } from "./pool";
import type { MetricaRow, MetricaType } from "./types";

/**
 * Guarda o actualiza la métrica de hoy (upsert por día).
 *
 * Un solo statement: actualiza el registro de hoy si existe y, si no existe,
 * inserta. Antes eran dos viajes (select + update/insert) contra Supabase.
 *
 * Nota: el límite del "día" se calcula con la zona horaria del **servidor**,
 * no la del browser como antes. Fijá `TZ` en el contenedor (ej.
 * `TZ=America/Argentina/Buenos_Aires`) para que coincida con tus usuarios.
 */
export async function guardarMetrica(
  uid:    string,
  tipo:   MetricaType,
  valor:  number,
  unidad: string,
  notas?: string
): Promise<{ error: string | null }> {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const manana = new Date(hoy);
  manana.setDate(manana.getDate() + 1);

  try {
    await pool.query(
      `with actualizado as (
         update metricas
            set valor = $3, unidad = $4, notas = $5
          where uid = $1 and tipo = $2
            and created_at >= $6 and created_at < $7
          returning id
       )
       insert into metricas (uid, tipo, valor, unidad, notas)
       select $1, $2, $3, $4, $5
        where not exists (select 1 from actualizado)`,
      [uid, tipo, valor, unidad, notas ?? null, hoy.toISOString(), manana.toISOString()]
    );
    return { error: null };
  } catch (err) {
    return { error: mensajeError(err) };
  }
}

/**
 * Último registro de cada tipo para un usuario.
 *
 * El `distinct on` reemplaza el filtrado en JS que hacía la versión anterior;
 * el `order by created_at desc` de afuera preserva el orden que devolvía antes.
 */
export async function getUltimasMetricas(uid: string): Promise<MetricaRow[]> {
  try {
    const { rows } = await pool.query<MetricaRow>(
      `select * from (
         select distinct on (tipo) *
           from metricas
          where uid = $1
          order by tipo, created_at desc
       ) ultimas
       order by created_at desc`,
      [uid]
    );
    return rows;
  } catch (err) {
    console.error("[db/metricas] getUltimasMetricas:", mensajeError(err));
    return [];
  }
}

/** Historial de una métrica para graficar (últimos N días) */
export async function getHistorialMetrica(
  uid:  string,
  tipo: MetricaType,
  dias: number = 30
): Promise<MetricaRow[]> {
  const desde = new Date();
  desde.setDate(desde.getDate() - dias);

  try {
    const { rows } = await pool.query<MetricaRow>(
      `select * from metricas
        where uid = $1 and tipo = $2 and created_at >= $3
        order by created_at asc`,
      [uid, tipo, desde.toISOString()]
    );
    return rows;
  } catch (err) {
    console.error("[db/metricas] getHistorialMetrica:", mensajeError(err));
    return [];
  }
}
