import "server-only";
import { cifrar, descifrar } from "@/lib/seguridad/cifrado";
import type { Db } from "./pool";
import { crearCifradoSalud } from "./salud-cifrada";
import type { MetricaCifradaRow, MetricaRow, PerfilCifradoRow, PerfilRow, RutinaRow } from "./types";

// Lecturas que comparten varias server actions y los route handlers.
//
// A propósito NO es un módulo "use server": todo lo que exporta un archivo
// "use server" es un endpoint público, y estas funciones reciben el uid. Acá
// solo se llega desde código de servidor que ya resolvió la sesión y abrió la
// transacción del usuario (con RLS activo). El `where uid = $1` es redundante
// con RLS a propósito: defensa en profundidad, y además usa los índices.

/**
 * Cifrado de los datos de salud (integrador, punto 19): las métricas y el
 * perfil se guardan cifrados y se descifran acá, al leer, así el motor, el
 * informe, el dashboard, la IA y la API móvil reciben los mismos números de
 * siempre. Ver lib/db/salud-cifrada.ts.
 */
export const salud = crearCifradoSalud({ cifrar, descifrar });

/** Columnas de `metricas` que se leen; el valor y las notas vienen cifrados. */
export const COLUMNAS_METRICA = "id, uid, tipo, valor_cifrado, unidad, notas_cifrado, created_at";

/** Descifra las filas; las que no se pueden leer se descartan (y quedan en el log). */
export function metricasLegibles(filas: MetricaCifradaRow[]): MetricaRow[] {
  return filas.map(salud.descifrarMetrica).filter((m): m is MetricaRow => m !== null);
}

export interface AdherenciaDiaRow {
  fecha:       string;
  completados: number;
}

/** Último registro de cada tipo para un usuario. */
export async function ultimasMetricas(db: Db, uid: string): Promise<MetricaRow[]> {
  const { rows } = await db.query<MetricaCifradaRow>(
    `select * from (
       select distinct on (tipo) ${COLUMNAS_METRICA}
         from metricas
        where uid = $1
        order by tipo, created_at desc
     ) ultimas
     order by created_at desc`,
    [uid]
  );
  return metricasLegibles(rows);
}

/** Historial de TODAS las métricas (últimos N días), para el motor de predicción. */
export async function historialMetricas(db: Db, uid: string, dias: number): Promise<MetricaRow[]> {
  const desde = new Date();
  desde.setDate(desde.getDate() - dias);
  const { rows } = await db.query<MetricaCifradaRow>(
    `select ${COLUMNAS_METRICA} from metricas
      where uid = $1 and created_at >= $2
      order by tipo, created_at asc`,
    [uid, desde.toISOString()]
  );
  return metricasLegibles(rows);
}

export async function perfilDe(db: Db, uid: string): Promise<PerfilRow | null> {
  const { rows } = await db.query<PerfilCifradoRow>(
    `select uid, edad_cifrado, sexo_cifrado, altura_cm_cifrado, fumador_cifrado, actualizado_at
       from perfil
      where uid = $1`,
    [uid]
  );
  return rows[0] ? salud.descifrarPerfil(rows[0]) : null;
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
  // El límite va como parámetro, no concatenado al SQL (SAST-BE-12): `limit
  // null` en Postgres es "sin límite", así que sirve para los dos casos.
  const tope = limite && Number.isFinite(limite) ? Math.max(1, Math.floor(limite)) : null;
  const { rows } = await db.query<RutinaRow>(
    `select * from rutinas
      where uid = $1 and activa = true
      order by created_at desc
      limit $2`,
    [uid, tope]
  );
  return rows;
}
