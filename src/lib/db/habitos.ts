"use server";

import { z } from "zod";
import { escritura, lectura, SIN_ENTRADA, ERROR_NO_ENCONTRADO } from "@/lib/seguridad/accion";
import {
  fechaSchema,
  habitoFijoTipoSchema,
  habitoFormSchema,
  habitoRegistroTipoSchema,
  idSchema,
} from "@/lib/seguridad/validacion";
import type {
  HabitoDefinicionRow,
  HabitoFijoRow,
  HabitoFormData,
  HabitoRegistroRow,
} from "./types";

// Ninguna acción recibe el uid: sale de la sesión. Editar y borrar exigen el
// id Y que la fila sea del usuario; antes bastaba con el id.

// ─── Definiciones ─────────────────────────────────────────────────────────────

export async function getHabitosDefinicion(): Promise<HabitoDefinicionRow[]> {
  return lectura("habito.listar", null, SIN_ENTRADA, [], async ({ db, uid }) => {
    const { rows } = await db.query<HabitoDefinicionRow>(
      `select * from habitos_definicion
        where uid = $1 and activo = true
        order by created_at asc`,
      [uid]
    );
    return rows;
  });
}

export async function crearHabitoDefinicion(data: HabitoFormData): Promise<{ error: string | null }> {
  return escritura("habito.crear", habitoFormSchema, data, async ({ db, uid, auditar }, d) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into habitos_definicion
         (uid, nombre, emoji, frecuencia, hora, lugar, dias_semana, dia_mes)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [uid, d.nombre, d.emoji, d.frecuencia, d.hora, d.lugar, d.dias_semana, d.dia_mes]
    );
    await auditar({ accion: "habito.crear", recurso: "habitos_definicion", recursoId: rows[0]?.id });
    return null;
  });
}

export async function editarHabitoDefinicion(
  id:   string,
  data: HabitoFormData
): Promise<{ error: string | null }> {
  return escritura(
    "habito.editar",
    z.object({ id: idSchema, data: habitoFormSchema }),
    { id, data },
    async ({ db, uid, auditar }, { id, data: d }) => {
      const r = await db.query(
        `update habitos_definicion
            set nombre = $3, emoji = $4, frecuencia = $5, hora = $6,
                lugar = $7, dias_semana = $8, dia_mes = $9
          where id = $1 and uid = $2`,
        [id, uid, d.nombre, d.emoji, d.frecuencia, d.hora, d.lugar, d.dias_semana, d.dia_mes]
      );
      if (r.rowCount === 0) {
        await auditar({ accion: "habito.editar", recurso: "habitos_definicion", recursoId: id, resultado: "denegado" });
        return ERROR_NO_ENCONTRADO;
      }
      await auditar({ accion: "habito.editar", recurso: "habitos_definicion", recursoId: id });
      return null;
    }
  );
}

/** Baja lógica: el hábito se marca inactivo para no perder su historial. */
export async function eliminarHabitoDefinicion(id: string): Promise<{ error: string | null }> {
  return escritura("habito.eliminar", idSchema, id, async ({ db, uid, auditar }, id) => {
    const r = await db.query(
      `update habitos_definicion set activo = false where id = $1 and uid = $2`,
      [id, uid]
    );
    if (r.rowCount === 0) {
      await auditar({ accion: "habito.eliminar", recurso: "habitos_definicion", recursoId: id, resultado: "denegado" });
      return ERROR_NO_ENCONTRADO;
    }
    await auditar({ accion: "habito.eliminar", recurso: "habitos_definicion", recursoId: id });
    return null;
  });
}

// ─── Hábitos fijos (predefinidos) ────────────────────────────────────────────

export async function toggleHabitoFijo(
  fecha:      string,
  tipo:       string,
  completado: boolean
): Promise<{ error: string | null }> {
  return escritura(
    "habito_fijo.marcar",
    z.object({ fecha: fechaSchema, tipo: habitoFijoTipoSchema, completado: z.boolean() }),
    { fecha, tipo, completado },
    async ({ db, uid, auditar }, d) => {
      await db.query(
        `insert into habitos (uid, fecha, tipo, completado)
         values ($1, $2, $3, $4)
         on conflict (uid, fecha, tipo)
           do update set completado = excluded.completado`,
        [uid, d.fecha, d.tipo, d.completado]
      );
      await auditar({ accion: "habito_fijo.marcar", recurso: "habitos", detalle: { tipo: d.tipo, completado: d.completado } });
      return null;
    }
  );
}

// ─── Registro custom + ejercicios ────────────────────────────────────────────

export async function toggleHabitoRegistro(
  fecha:      string,
  tipo:       string,
  refId:      string,
  completado: boolean
): Promise<{ error: string | null }> {
  return escritura(
    "habito_registro.marcar",
    z.object({
      fecha:      fechaSchema,
      tipo:       habitoRegistroTipoSchema,
      refId:      z.string().min(1).max(200),
      completado: z.boolean(),
    }),
    { fecha, tipo, refId, completado },
    async ({ db, uid, auditar }, d) => {
      if (d.completado) {
        // Todas las columnas son parte de la clave: en un choque no hay nada que actualizar.
        await db.query(
          `insert into habitos_registro (uid, fecha, tipo, ref_id)
           values ($1, $2, $3, $4)
           on conflict (uid, fecha, tipo, ref_id) do nothing`,
          [uid, d.fecha, d.tipo, d.refId]
        );
      } else {
        await db.query(
          `delete from habitos_registro
            where uid = $1 and fecha = $2 and tipo = $3 and ref_id = $4`,
          [uid, d.fecha, d.tipo, d.refId]
        );
      }
      await auditar({ accion: "habito_registro.marcar", recurso: "habitos_registro", detalle: { tipo: d.tipo, completado: d.completado } });
      return null;
    }
  );
}

// ─── Lectura por fecha / semana ───────────────────────────────────────────────

type HabitosDelRango = { fijos: HabitoFijoRow[]; registro: HabitoRegistroRow[] };
const RANGO_VACIO: HabitosDelRango = { fijos: [], registro: [] };

export async function getHabitosFecha(fecha: string): Promise<HabitosDelRango> {
  return lectura("habito.fecha", fechaSchema, fecha, RANGO_VACIO, async ({ db, uid }, fecha) => {
    const fijos = await db.query<HabitoFijoRow>(
      `select id, uid, fecha, tipo, completado from habitos
        where uid = $1 and fecha = $2`,
      [uid, fecha]
    );
    const registro = await db.query<HabitoRegistroRow>(
      `select id, uid, fecha, tipo, ref_id from habitos_registro
        where uid = $1 and fecha = $2`,
      [uid, fecha]
    );
    return { fijos: fijos.rows, registro: registro.rows };
  });
}

export async function getHabitosSemana(desde: string, hasta: string): Promise<HabitosDelRango> {
  return lectura(
    "habito.semana",
    z.object({ desde: fechaSchema, hasta: fechaSchema }),
    { desde, hasta },
    RANGO_VACIO,
    async ({ db, uid }, d) => {
      const fijos = await db.query<HabitoFijoRow>(
        `select id, uid, fecha, tipo, completado from habitos
          where uid = $1 and fecha >= $2 and fecha <= $3`,
        [uid, d.desde, d.hasta]
      );
      const registro = await db.query<HabitoRegistroRow>(
        `select id, uid, fecha, tipo, ref_id from habitos_registro
          where uid = $1 and fecha >= $2 and fecha <= $3`,
        [uid, d.desde, d.hasta]
      );
      return { fijos: fijos.rows, registro: registro.rows };
    }
  );
}
