"use server";

import { z } from "zod";
import { escritura, lectura, SIN_ENTRADA, ERROR_NO_ENCONTRADO } from "@/lib/seguridad/accion";
import { calificacionSchema, idSchema, recetaSchema } from "@/lib/seguridad/validacion";
import type { RecetaRow } from "./types";

// La imagen la guarda el servidor al generarla (/api/recetas/imagen). Antes
// existía `uploadRecetaImagen`, una server action que escribía en disco
// cualquier data URL que mandara el cliente: se quitó.

export async function guardarReceta(
  titulo:       string,
  contenido:    string,
  imagen_url:   string | null,
  ingredientes: string[]
): Promise<{ error: string | null }> {
  return escritura(
    "receta.guardar",
    recetaSchema,
    { titulo, contenido, imagen_url, ingredientes },
    async ({ db, uid, auditar }, d) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into recetas_guardadas (uid, titulo, contenido, imagen_url, ingredientes)
         values ($1, $2, $3, $4, $5)
         returning id`,
        [uid, d.titulo, d.contenido, d.imagen_url, d.ingredientes]
      );
      await auditar({ accion: "receta.guardar", recurso: "recetas_guardadas", recursoId: rows[0]?.id });
      return null;
    }
  );
}

export async function getRecetasGuardadas(): Promise<RecetaRow[]> {
  return lectura("receta.listar", null, SIN_ENTRADA, [], async ({ db, uid }) => {
    const { rows } = await db.query<RecetaRow>(
      `select * from recetas_guardadas where uid = $1 order by created_at desc`,
      [uid]
    );
    return rows;
  });
}

export async function eliminarReceta(id: string): Promise<{ error: string | null }> {
  return escritura("receta.eliminar", idSchema, id, async ({ db, uid, auditar }, id) => {
    const r = await db.query(`delete from recetas_guardadas where id = $1 and uid = $2`, [id, uid]);
    if (r.rowCount === 0) {
      await auditar({ accion: "receta.eliminar", recurso: "recetas_guardadas", recursoId: id, resultado: "denegado" });
      return ERROR_NO_ENCONTRADO;
    }
    await auditar({ accion: "receta.eliminar", recurso: "recetas_guardadas", recursoId: id });
    return null;
  });
}

export async function calificarReceta(
  id:           string,
  calificacion: number
): Promise<{ error: string | null }> {
  return escritura(
    "receta.calificar",
    z.object({ id: idSchema, calificacion: calificacionSchema }),
    { id, calificacion },
    async ({ db, uid, auditar }, d) => {
      const r = await db.query(
        `update recetas_guardadas set calificacion = $3 where id = $1 and uid = $2`,
        [d.id, uid, d.calificacion]
      );
      if (r.rowCount === 0) {
        await auditar({ accion: "receta.calificar", recurso: "recetas_guardadas", recursoId: d.id, resultado: "denegado" });
        return ERROR_NO_ENCONTRADO;
      }
      await auditar({ accion: "receta.calificar", recurso: "recetas_guardadas", recursoId: d.id });
      return null;
    }
  );
}
