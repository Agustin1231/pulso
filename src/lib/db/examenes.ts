import "server-only";
import type { Db } from "./pool";
import type { TipoExamen } from "@/lib/examenes/reglas";

/**
 * Consultas de la tabla `examenes` (db/examenes.sql; integrador, punto 15).
 *
 * A propósito NO es un módulo "use server": cada función exportada de uno así
 * es un endpoint público. Estas las llaman solo las rutas de /api/examenes y
 * /api/mis-datos, dentro de `conUsuario` (RLS con `app.uid`). Igual filtran
 * por el uid de la sesión: si una política se rompiera, el filtro sigue.
 */

export interface FilaExamen {
  id:             string;
  archivo:        string;
  nombre_cifrado: string;
  tipo:           TipoExamen;
  bytes:          number;
  created_at:     string;
}

export async function listarExamenes(db: Db, uid: string): Promise<FilaExamen[]> {
  const { rows } = await db.query<FilaExamen>(
    `select id, archivo, nombre_cifrado, tipo, bytes, created_at
       from examenes where uid = $1 order by created_at desc`,
    [uid]
  );
  return rows;
}

export async function buscarExamen(db: Db, uid: string, id: string): Promise<FilaExamen | null> {
  const { rows } = await db.query<FilaExamen>(
    `select id, archivo, nombre_cifrado, tipo, bytes, created_at
       from examenes where id = $1 and uid = $2`,
    [id, uid]
  );
  return rows[0] ?? null;
}

/** Inserta la fila. La cuota la controla el trigger `cuota_por_usuario` (error 'pulso_cuota_excedida'). */
export async function insertarExamen(
  db: Db,
  uid: string,
  e: { archivo: string; nombreCifrado: string; tipo: TipoExamen; bytes: number }
): Promise<{ id: string; created_at: string }> {
  const { rows } = await db.query<{ id: string; created_at: string }>(
    `insert into examenes (uid, archivo, nombre_cifrado, tipo, bytes)
     values ($1, $2, $3, $4, $5)
     returning id, created_at`,
    [uid, e.archivo, e.nombreCifrado, e.tipo, e.bytes]
  );
  return rows[0];
}

/** Borra la fila y devuelve el nombre de su archivo en disco, o null si no era del usuario. */
export async function borrarExamen(db: Db, uid: string, id: string): Promise<string | null> {
  const { rows } = await db.query<{ archivo: string }>(
    `delete from examenes where id = $1 and uid = $2 returning archivo`,
    [id, uid]
  );
  return rows[0]?.archivo ?? null;
}

/** Archivos en disco de todos los exámenes del usuario: para borrarlos en la supresión. */
export async function archivosDeExamenes(db: Db, uid: string): Promise<string[]> {
  const { rows } = await db.query<{ archivo: string }>(`select archivo from examenes where uid = $1`, [uid]);
  return rows.map((r) => r.archivo);
}

/** Qué cuota se excedió, si el error es del trigger de db/examenes.sql. */
export function cuotaExcedida(err: unknown): "examenes" | "examenes_bytes" | null {
  const e = err as { code?: unknown; message?: unknown; detail?: unknown } | null;
  if (e?.code !== "P0001" || e?.message !== "pulso_cuota_excedida") return null;
  return e.detail === "examenes_bytes" ? "examenes_bytes" : "examenes";
}
