"use server";

import { pool, mensajeError } from "./pool";
import type { ListaMercadoRow } from "./types";

export async function guardarListaMercado(
  uid:       string,
  nombre:    string,
  periodo:   string,
  contenido: string
): Promise<{ error: string | null }> {
  try {
    await pool.query(
      `insert into listas_mercado (uid, nombre, periodo, contenido)
       values ($1, $2, $3, $4)`,
      [uid, nombre, periodo, contenido]
    );
    return { error: null };
  } catch (err) {
    return { error: mensajeError(err) };
  }
}

export async function getListasMercado(uid: string): Promise<ListaMercadoRow[]> {
  try {
    const { rows } = await pool.query<ListaMercadoRow>(
      `select * from listas_mercado where uid = $1 order by created_at desc`,
      [uid]
    );
    return rows;
  } catch (err) {
    console.error("[db/mercado] getListasMercado:", mensajeError(err));
    return [];
  }
}

export async function eliminarListaMercado(id: string): Promise<{ error: string | null }> {
  try {
    await pool.query(`delete from listas_mercado where id = $1`, [id]);
    return { error: null };
  } catch (err) {
    return { error: mensajeError(err) };
  }
}
