"use server";

import { escritura, lectura, SIN_ENTRADA, ERROR_NO_ENCONTRADO } from "@/lib/seguridad/accion";
import { idSchema, rutinaSchema } from "@/lib/seguridad/validacion";
import { rutinasActivas } from "./consultas";
import type { RutinaContenido, RutinaRow } from "./types";

export async function guardarRutina(
  nombre:    string,
  contenido: RutinaContenido
): Promise<{ error: string | null }> {
  return escritura("rutina.guardar", rutinaSchema, { nombre, contenido }, async ({ db, uid, auditar }, d) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into rutinas (uid, nombre, contenido) values ($1, $2, $3::jsonb) returning id`,
      [uid, d.nombre, JSON.stringify(d.contenido)]
    );
    await auditar({ accion: "rutina.guardar", recurso: "rutinas", recursoId: rows[0]?.id });
    return null;
  });
}

export async function getRutinasGuardadas(): Promise<RutinaRow[]> {
  return lectura("rutina.listar", null, SIN_ENTRADA, [], ({ db, uid }) => rutinasActivas(db, uid));
}

/** Baja lógica: la rutina se marca inactiva, no se borra. */
export async function eliminarRutina(id: string): Promise<{ error: string | null }> {
  return escritura("rutina.eliminar", idSchema, id, async ({ db, uid, auditar }, id) => {
    const r = await db.query(`update rutinas set activa = false where id = $1 and uid = $2`, [id, uid]);
    if (r.rowCount === 0) {
      await auditar({ accion: "rutina.eliminar", recurso: "rutinas", recursoId: id, resultado: "denegado" });
      return ERROR_NO_ENCONTRADO;
    }
    await auditar({ accion: "rutina.eliminar", recurso: "rutinas", recursoId: id });
    return null;
  });
}
