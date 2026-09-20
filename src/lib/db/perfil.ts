"use server";

import { pool, mensajeError } from "./pool";
import type { PerfilRow, PerfilFormData } from "./types";

/** Perfil anónimo del usuario, o null si nunca lo completó. */
export async function getPerfil(uid: string): Promise<PerfilRow | null> {
  try {
    const { rows } = await pool.query<PerfilRow>(
      `select uid, edad, sexo, altura_cm, fumador, actualizado_at
         from perfil
        where uid = $1`,
      [uid]
    );
    return rows[0] ?? null;
  } catch (err) {
    console.error("[db/perfil] getPerfil:", mensajeError(err));
    return null;
  }
}

/** Crea o actualiza el perfil (una fila por uid). */
export async function guardarPerfil(
  uid:  string,
  data: PerfilFormData
): Promise<{ error: string | null }> {
  try {
    await pool.query(
      `insert into perfil (uid, edad, sexo, altura_cm, fumador, actualizado_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (uid) do update
         set edad = excluded.edad,
             sexo = excluded.sexo,
             altura_cm = excluded.altura_cm,
             fumador = excluded.fumador,
             actualizado_at = now()`,
      [uid, data.edad, data.sexo, data.altura_cm, data.fumador]
    );
    return { error: null };
  } catch (err) {
    return { error: mensajeError(err) };
  }
}
