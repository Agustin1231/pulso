"use server";

import { pool, mensajeError } from "./pool";
import type { RutinaContenido, RutinaRow } from "./types";

export async function guardarRutina(
  uid:       string,
  nombre:    string,
  contenido: RutinaContenido
): Promise<{ error: string | null }> {
  try {
    await pool.query(
      `insert into rutinas (uid, nombre, contenido) values ($1, $2, $3::jsonb)`,
      [uid, nombre, JSON.stringify(contenido)]
    );
    return { error: null };
  } catch (err) {
    return { error: mensajeError(err) };
  }
}

export async function getRutinasGuardadas(uid: string): Promise<RutinaRow[]> {
  try {
    const { rows } = await pool.query<RutinaRow>(
      `select * from rutinas
        where uid = $1 and activa = true
        order by created_at desc`,
      [uid]
    );
    return rows;
  } catch (err) {
    console.error("[db/rutinas] getRutinasGuardadas:", mensajeError(err));
    return [];
  }
}

/** Baja lógica: la rutina se marca inactiva, no se borra. */
export async function eliminarRutina(id: string): Promise<{ error: string | null }> {
  try {
    await pool.query(`update rutinas set activa = false where id = $1`, [id]);
    return { error: null };
  } catch (err) {
    return { error: mensajeError(err) };
  }
}
