"use server";

import { z } from "zod";
import { escritura, lectura, SIN_ENTRADA } from "@/lib/seguridad/accion";
import { diasSchema, metricaSchema, RANGO_METRICA, tipoMetricaSchema } from "@/lib/seguridad/validacion";
import { ultimasMetricas } from "./consultas";
import type { MetricaRow, MetricaType } from "./types";

// Ninguna acción recibe el uid: sale de la sesión (ver lib/seguridad/accion).

/**
 * Guarda o actualiza la métrica de hoy (upsert por día).
 *
 * La unidad la pone el servidor según el tipo; el valor se valida contra el
 * rango de la métrica.
 *
 * Nota: el límite del "día" se calcula con la zona horaria del **servidor**.
 * Fijá `TZ` en el contenedor para que coincida con tus usuarios.
 */
export async function guardarMetrica(
  tipo:   MetricaType,
  valor:  number,
  notas?: string
): Promise<{ error: string | null }> {
  return escritura("metrica.guardar", metricaSchema, { tipo, valor, notas }, async ({ db, uid, auditar }, d) => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);

    await db.query(
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
      [uid, d.tipo, d.valor, RANGO_METRICA[d.tipo].unidad, d.notas, hoy.toISOString(), manana.toISOString()]
    );
    await auditar({ accion: "metrica.guardar", recurso: "metricas", detalle: { tipo: d.tipo } });
    return null;
  });
}

/** Último registro de cada tipo. */
export async function getUltimasMetricas(): Promise<MetricaRow[]> {
  return lectura("metrica.ultimas", null, SIN_ENTRADA, [], ({ db, uid }) => ultimasMetricas(db, uid));
}

/** Historial de una métrica para graficar (últimos N días). */
export async function getHistorialMetrica(
  tipo: MetricaType,
  dias: number = 30
): Promise<MetricaRow[]> {
  return lectura(
    "metrica.historial",
    z.object({ tipo: tipoMetricaSchema, dias: diasSchema }),
    { tipo, dias },
    [],
    async ({ db, uid }, d) => {
      const desde = new Date();
      desde.setDate(desde.getDate() - d.dias);
      const { rows } = await db.query<MetricaRow>(
        `select * from metricas
          where uid = $1 and tipo = $2 and created_at >= $3
          order by created_at asc`,
        [uid, d.tipo, desde.toISOString()]
      );
      return rows;
    }
  );
}
