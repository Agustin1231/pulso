import "server-only";
import { pool, mensajeError, type Db } from "@/lib/db/pool";
import { anonimizarIp } from "./red";

/**
 * Trazabilidad (plantilla, fila 5). La tabla `auditoria` es append-only: la
 * app inserta, no lee ni modifica, y un trigger impide cambiarla incluso al
 * dueño. Sirve para investigar un incidente y para rebatir un reclamo ("qué
 * datos generaron esta recomendación").
 *
 * No se audita cada lectura (sería ruido): sí cada escritura, cada llamada a
 * la IA, la sesión y todo acceso denegado.
 */

export type Resultado = "ok" | "denegado" | "error";

export interface Evento {
  uid?:       string | null;
  accion:     string;
  recurso?:   string;
  recursoId?: string | null;
  resultado:  Resultado;
  ip?:        string | null;
  detalle?:   Record<string, unknown>;
}

const SQL = `insert into auditoria (uid, accion, recurso, recurso_id, resultado, ip, detalle)
             values ($1, $2, $3, $4, $5, $6, $7)`;

function params(e: Evento): unknown[] {
  return [
    e.uid ?? null,
    e.accion,
    e.recurso ?? null,
    e.recursoId ?? null,
    e.resultado,
    anonimizarIp(e.ip ?? null),
    e.detalle ? JSON.stringify(e.detalle) : null,
  ];
}

/**
 * Dentro de la transacción del usuario: si la operación hace rollback, el
 * registro también (no queda constancia de algo que no pasó).
 */
export async function auditarEn(db: Db, e: Evento): Promise<void> {
  await db.query(SQL, params(e));
}

/**
 * Fuera de transacción, para eventos de seguridad (accesos denegados, límites,
 * errores). Nunca tira: un fallo de auditoría no debe tumbar la petición.
 */
export async function auditar(e: Evento): Promise<void> {
  try {
    await pool.query(SQL, params(e));
  } catch (err) {
    console.error("[auditoria] no se pudo registrar:", e.accion, mensajeError(err));
  }
}
