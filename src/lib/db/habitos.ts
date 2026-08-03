"use server";

import { pool, mensajeError } from "./pool";
import type {
  HabitoDefinicionRow,
  HabitoFijoRow,
  HabitoFormData,
  HabitoRegistroRow,
} from "./types";

// ─── Definiciones ─────────────────────────────────────────────────────────────

export async function getHabitosDefinicion(uid: string): Promise<HabitoDefinicionRow[]> {
  try {
    const { rows } = await pool.query<HabitoDefinicionRow>(
      `select * from habitos_definicion
        where uid = $1 and activo = true
        order by created_at asc`,
      [uid]
    );
    return rows;
  } catch (err) {
    console.error("[db/habitos] getHabitosDefinicion:", mensajeError(err));
    return [];
  }
}

export async function crearHabitoDefinicion(
  uid:  string,
  data: HabitoFormData
): Promise<{ error: string | null }> {
  try {
    await pool.query(
      `insert into habitos_definicion
         (uid, nombre, emoji, frecuencia, hora, lugar, dias_semana, dia_mes)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        uid,
        data.nombre,
        data.emoji,
        data.frecuencia,
        data.hora || null,
        data.lugar || null,
        data.dias_semana,
        data.dia_mes,
      ]
    );
    return { error: null };
  } catch (err) {
    return { error: mensajeError(err) };
  }
}

export async function editarHabitoDefinicion(
  id:   string,
  data: HabitoFormData
): Promise<{ error: string | null }> {
  try {
    await pool.query(
      `update habitos_definicion
          set nombre = $2, emoji = $3, frecuencia = $4, hora = $5,
              lugar = $6, dias_semana = $7, dia_mes = $8
        where id = $1`,
      [
        id,
        data.nombre,
        data.emoji,
        data.frecuencia,
        data.hora || null,
        data.lugar || null,
        data.dias_semana,
        data.dia_mes,
      ]
    );
    return { error: null };
  } catch (err) {
    return { error: mensajeError(err) };
  }
}

/** Baja lógica: el hábito se marca inactivo para no perder su historial. */
export async function eliminarHabitoDefinicion(id: string): Promise<{ error: string | null }> {
  try {
    await pool.query(`update habitos_definicion set activo = false where id = $1`, [id]);
    return { error: null };
  } catch (err) {
    return { error: mensajeError(err) };
  }
}

// ─── Hábitos fijos (predefinidos) ────────────────────────────────────────────

export async function toggleHabitoFijo(
  uid:        string,
  fecha:      string,
  tipo:       string,
  completado: boolean
): Promise<{ error: string | null }> {
  try {
    await pool.query(
      `insert into habitos (uid, fecha, tipo, completado)
       values ($1, $2, $3, $4)
       on conflict (uid, fecha, tipo)
         do update set completado = excluded.completado`,
      [uid, fecha, tipo, completado]
    );
    return { error: null };
  } catch (err) {
    return { error: mensajeError(err) };
  }
}

// ─── Registro custom + ejercicios ────────────────────────────────────────────

export async function toggleHabitoRegistro(
  uid:        string,
  fecha:      string,
  tipo:       string,
  refId:      string,
  completado: boolean
): Promise<{ error: string | null }> {
  try {
    if (completado) {
      // Todas las columnas son parte de la clave, así que no hay nada que
      // actualizar en un choque: basta con no fallar.
      await pool.query(
        `insert into habitos_registro (uid, fecha, tipo, ref_id)
         values ($1, $2, $3, $4)
         on conflict (uid, fecha, tipo, ref_id) do nothing`,
        [uid, fecha, tipo, refId]
      );
    } else {
      await pool.query(
        `delete from habitos_registro
          where uid = $1 and fecha = $2 and tipo = $3 and ref_id = $4`,
        [uid, fecha, tipo, refId]
      );
    }
    return { error: null };
  } catch (err) {
    return { error: mensajeError(err) };
  }
}

// ─── Lectura por fecha / semana ───────────────────────────────────────────────

export async function getHabitosFecha(
  uid:   string,
  fecha: string
): Promise<{ fijos: HabitoFijoRow[]; registro: HabitoRegistroRow[] }> {
  try {
    const [fijos, registro] = await Promise.all([
      pool.query<HabitoFijoRow>(
        `select id, uid, fecha, tipo, completado from habitos
          where uid = $1 and fecha = $2`,
        [uid, fecha]
      ),
      pool.query<HabitoRegistroRow>(
        `select id, uid, fecha, tipo, ref_id from habitos_registro
          where uid = $1 and fecha = $2`,
        [uid, fecha]
      ),
    ]);
    return { fijos: fijos.rows, registro: registro.rows };
  } catch (err) {
    console.error("[db/habitos] getHabitosFecha:", mensajeError(err));
    return { fijos: [], registro: [] };
  }
}

export async function getHabitosSemana(
  uid:   string,
  desde: string,
  hasta: string
): Promise<{ fijos: HabitoFijoRow[]; registro: HabitoRegistroRow[] }> {
  try {
    const [fijos, registro] = await Promise.all([
      pool.query<HabitoFijoRow>(
        `select id, uid, fecha, tipo, completado from habitos
          where uid = $1 and fecha >= $2 and fecha <= $3`,
        [uid, desde, hasta]
      ),
      pool.query<HabitoRegistroRow>(
        `select id, uid, fecha, tipo, ref_id from habitos_registro
          where uid = $1 and fecha >= $2 and fecha <= $3`,
        [uid, desde, hasta]
      ),
    ]);
    return { fijos: fijos.rows, registro: registro.rows };
  } catch (err) {
    console.error("[db/habitos] getHabitosSemana:", mensajeError(err));
    return { fijos: [], registro: [] };
  }
}
