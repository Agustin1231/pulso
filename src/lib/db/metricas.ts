"use server";

import { z } from "zod";
import { escritura, lectura, SIN_ENTRADA } from "@/lib/seguridad/accion";
import { diasSchema, metricaSchema, RANGO_METRICA, tipoMetricaSchema } from "@/lib/seguridad/validacion";
import { COLUMNAS_METRICA, metricasLegibles, salud, ultimasMetricas } from "./consultas";
import type { MetricaCifradaRow, MetricaRow, MetricaType } from "./types";

// Ninguna acción recibe el uid: sale de la sesión (ver lib/seguridad/accion).

/**
 * Guarda o actualiza la métrica de hoy (upsert por día).
 *
 * La unidad la pone el servidor según el tipo; el valor se valida contra el
 * rango de la métrica. El valor y las notas se guardan cifrados (integrador,
 * punto 19): la base ya no ve el número, así que el rango lo controla solo
 * `metricaSchema`.
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

    const { valor_cifrado, notas_cifrado } = salud.cifrarMetrica(d.valor, d.notas);
    await db.query(
      `with actualizado as (
         update metricas
            set valor_cifrado = $3, unidad = $4, notas_cifrado = $5
          where uid = $1 and tipo = $2
            and created_at >= $6 and created_at < $7
          returning id
       )
       insert into metricas (uid, tipo, valor_cifrado, unidad, notas_cifrado)
       select $1, $2, $3, $4, $5
        where not exists (select 1 from actualizado)`,
      [uid, d.tipo, valor_cifrado, RANGO_METRICA[d.tipo].unidad, notas_cifrado, hoy.toISOString(), manana.toISOString()]
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
      const { rows } = await db.query<MetricaCifradaRow>(
        `select ${COLUMNAS_METRICA} from metricas
          where uid = $1 and tipo = $2 and created_at >= $3
          order by created_at asc`,
        [uid, d.tipo, desde.toISOString()]
      );
      return metricasLegibles(rows);
    }
  );
}
