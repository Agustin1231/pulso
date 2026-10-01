import "server-only";
import type { Db } from "./pool";
import type { MetricaRow, PerfilRow, RutinaRow } from "./types";

// Lecturas que comparten varias server actions y los route handlers.
//
// A propósito NO es un módulo "use server": todo lo que exporta un archivo
// "use server" es un endpoint público, y estas funciones reciben el uid. Acá
// solo se llega desde código de servidor que ya resolvió la sesión y abrió la
// transacción del usuario (con RLS activo). El `where uid = $1` es redundante
// con RLS a propósito: defensa en profundidad, y además usa los índices.

export interface AdherenciaDiaRow {
  fecha:       string;
  completados: number;
}

/** Último registro de cada tipo para un usuario. */
export async function ultimasMetricas(db: Db, uid: string): Promise<MetricaRow[]> {
  const { rows } = await db.query<MetricaRow>(
    `select * from (
       select distinct on (tipo) *
         from metricas
        where uid = $1
        order by tipo, created_at desc
     ) ultimas
     order by created_at desc`,
    [uid]
  );
  return rows;
}

/** Historial de TODAS las métricas (últimos N días), para el motor de predicción. */
export async function historialMetricas(db: Db, uid: string, dias: number): Promise<MetricaRow[]> {
  const desde = new Date();
  desde.setDate(desde.getDate() - dias);
  const { rows } = await db.query<MetricaRow>(
    `select * from metricas
      where uid = $1 and created_at >= $2
      order by tipo, created_at asc`,
    [uid, desde.toISOString()]
  );
  return rows;
}

export async function perfilDe(db: Db, uid: string): Promise<PerfilRow | null> {
  const { rows } = await db.query<PerfilRow>(
    `select uid, edad, sexo, altura_cm, fumador, actualizado_at
       from perfil
      where uid = $1`,
    [uid]
  );
  return rows[0] ?? null;
}

/** Cuántos hábitos fijos se completaron cada día del rango. */
export async function adherenciaDiaria(
  db: Db,
  uid: string,
  desde: string,
  hasta: string
): Promise<AdherenciaDiaRow[]> {
  const { rows } = await db.query<AdherenciaDiaRow>(
    `select fecha, count(*) filter (where completado)::int as completados
       from habitos
      where uid = $1 and fecha >= $2 and fecha <= $3
      group by fecha
      order by fecha asc`,
    [uid, desde, hasta]
  );
  return rows;
}

export async function rutinasActivas(db: Db, uid: string, limite?: number): Promise<RutinaRow[]> {
  const { rows } = await db.query<RutinaRow>(
    `select * from rutinas
      where uid = $1 and activa = true
      order by created_at desc
      ${limite ? "limit " + Math.max(1, Math.floor(limite)) : ""}`,
    [uid]
  );
  return rows;
}
