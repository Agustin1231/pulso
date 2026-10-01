"use server";

import { escritura, lectura, SIN_ENTRADA, ERROR_NO_ENCONTRADO } from "@/lib/seguridad/accion";
import { idSchema, listaMercadoSchema } from "@/lib/seguridad/validacion";
import type { ListaMercadoRow } from "./types";

export async function guardarListaMercado(
  nombre:    string,
  periodo:   string,
  contenido: string
): Promise<{ error: string | null }> {
  return escritura(
    "mercado.guardar",
    listaMercadoSchema,
    { nombre, periodo, contenido },
    async ({ db, uid, auditar }, d) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into listas_mercado (uid, nombre, periodo, contenido)
         values ($1, $2, $3, $4)
         returning id`,
        [uid, d.nombre, d.periodo, d.contenido]
      );
      await auditar({ accion: "mercado.guardar", recurso: "listas_mercado", recursoId: rows[0]?.id });
      return null;
    }
  );
}

export async function getListasMercado(): Promise<ListaMercadoRow[]> {
  return lectura("mercado.listar", null, SIN_ENTRADA, [], async ({ db, uid }) => {
    const { rows } = await db.query<ListaMercadoRow>(
      `select * from listas_mercado where uid = $1 order by created_at desc`,
      [uid]
    );
    return rows;
  });
}

export async function eliminarListaMercado(id: string): Promise<{ error: string | null }> {
  return escritura("mercado.eliminar", idSchema, id, async ({ db, uid, auditar }, id) => {
    const r = await db.query(`delete from listas_mercado where id = $1 and uid = $2`, [id, uid]);
    if (r.rowCount === 0) {
      await auditar({ accion: "mercado.eliminar", recurso: "listas_mercado", recursoId: id, resultado: "denegado" });
      return ERROR_NO_ENCONTRADO;
    }
    await auditar({ accion: "mercado.eliminar", recurso: "listas_mercado", recursoId: id });
    return null;
  });
}
