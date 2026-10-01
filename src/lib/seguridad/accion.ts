import "server-only";
import type { z } from "zod";
import { conUsuario, mensajeError, type Db } from "@/lib/db/pool";
import { requerirUid, uidDeSesion, SinSesion } from "@/lib/sesion";
import { auditar, auditarEn, type Evento } from "./auditoria";
import { ipCliente } from "./red";

/**
 * Envoltorio de todas las server actions de `lib/db`.
 *
 * Una server action es un endpoint público: cualquiera la puede invocar con
 * los argumentos que quiera. Por eso ninguna recibe el uid. Este envoltorio:
 *   1. valida la entrada con zod;
 *   2. saca el uid de la cookie de sesión;
 *   3. corre la operación en una transacción con `app.uid` fijado (RLS);
 *   4. le da a la operación un `auditar` que ya conoce uid e IP;
 *   5. nunca devuelve un error interno: el detalle va al log, al cliente un
 *      mensaje genérico (antes llegaban los mensajes de Postgres).
 */

export const ERROR_GENERICO = "No se pudo completar la operación. Intentá de nuevo.";
export const ERROR_SESION   = "Tu sesión no es válida. Recargá la página.";
export const ERROR_DATOS    = "Los datos enviados no son válidos.";
export const ERROR_NO_ENCONTRADO = "No se encontró el elemento.";

export interface Ctx {
  db:  Db;
  uid: string;
  /** Registra en la auditoría dentro de la misma transacción. */
  auditar: (e: Omit<Evento, "uid" | "ip" | "resultado"> & { resultado?: Evento["resultado"] }) => Promise<void>;
}

/** Para las acciones sin entrada. */
export const SIN_ENTRADA = undefined;

async function ejecutar<T, R>(
  nombre: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown> | null,
  entrada: unknown,
  fn: (ctx: Ctx, datos: T) => Promise<R>
): Promise<R> {
  const ip = await ipCliente();

  let datos = entrada as T;
  if (schema) {
    const r = schema.safeParse(entrada);
    if (!r.success) {
      await auditar({
        uid: await uidDeSesion().catch(() => null),
        accion: nombre,
        resultado: "denegado",
        ip,
        detalle: { motivo: "datos_invalidos", campos: r.error.issues.map((i) => i.path.join(".")) },
      });
      throw new DatosInvalidos();
    }
    datos = r.data;
  }

  const uid = await requerirUid();
  return conUsuario(uid, (db) =>
    fn(
      {
        db,
        uid,
        auditar: (e) => auditarEn(db, { resultado: "ok", ...e, uid, ip }),
      },
      datos
    )
  );
}

export class DatosInvalidos extends Error {
  constructor() {
    super("Datos inválidos");
    this.name = "DatosInvalidos";
  }
}

/**
 * Escritura: `fn` devuelve null si salió bien o un mensaje para el usuario.
 * Siempre resuelve a `{ error }`, la forma que ya esperan los componentes.
 */
export async function escritura<T>(
  nombre: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown> | null,
  entrada: unknown,
  fn: (ctx: Ctx, datos: T) => Promise<string | null>
): Promise<{ error: string | null }> {
  try {
    return { error: await ejecutar(nombre, schema, entrada, fn) };
  } catch (err) {
    if (err instanceof DatosInvalidos) return { error: ERROR_DATOS };
    if (err instanceof SinSesion) {
      await auditar({ accion: nombre, resultado: "denegado", ip: await ipCliente(), detalle: { motivo: "sin_sesion" } });
      return { error: ERROR_SESION };
    }
    console.error(`[accion] ${nombre}:`, mensajeError(err));
    await auditar({ accion: nombre, resultado: "error", ip: await ipCliente() });
    return { error: ERROR_GENERICO };
  }
}

/** Lectura: ante cualquier problema devuelve `vacio`, como hacían las funciones originales. */
export async function lectura<T, R>(
  nombre: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown> | null,
  entrada: unknown,
  vacio: R,
  fn: (ctx: Ctx, datos: T) => Promise<R>
): Promise<R> {
  try {
    return await ejecutar(nombre, schema, entrada, fn);
  } catch (err) {
    if (!(err instanceof DatosInvalidos) && !(err instanceof SinSesion)) {
      console.error(`[accion] ${nombre}:`, mensajeError(err));
    }
    return vacio;
  }
}
