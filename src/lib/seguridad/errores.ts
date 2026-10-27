import "server-only";
import { pool, mensajeError } from "@/lib/db/pool";
import { COOKIE_SESION, hashDeToken } from "@/lib/sesion";
import { anonimizarIp, ipCliente } from "./red";

/**
 * Registro de errores del servidor (integrador, punto 17; contrato C5).
 *
 * Antes un error interno solo quedaba en el log del contenedor: había que
 * entrar al servidor para enterarse, y el log se pierde con cada redeploy.
 * Ahora cada error que llega a un catch genérico (`rutaProtegida`,
 * `rutaPublica`, `escritura`, `lectura`) o que Next no pudo manejar
 * (`onRequestError` en src/instrumentation.ts) queda en la tabla `errores`
 * (db/admin.sql), que el administrador ve en /admin con el permiso `errores.ver`.
 *
 * Qué se guarda: el origen (ruta o acción), el mensaje y el stack recortados,
 * el código de Postgres si lo hay, el uid si había sesión y la IP anonimizada.
 * Qué NO: el cuerpo de la petición, el query string (los enlaces del correo
 * llevan el token ahí), ni `err.detail` de pg (trae los valores de la fila).
 * Por si un mensaje los incluye, los correos y los tokens se reemplazan.
 *
 * Nunca tira: si la base no responde, el error queda solo en el log.
 */

const MAX_MENSAJE = 1000;
const MAX_STACK = 4000;

export interface ContextoError {
  uid?:     string | null;
  ip?:      string | null;
  detalle?: Record<string, unknown>;
}

/**
 * Quita lo que no tiene que quedar en el registro: correos, y tokens o claves
 * (cualquier tira de 32 o más caracteres base64url: tokens de sesión y de los
 * enlaces, hashes, claves de API). Se aplica sobre el texto ya recortado y con
 * expresiones sin retroceso: un mensaje armado a propósito no la frena.
 */
export function sanear(texto: string): string {
  return texto
    .replace(/[^\s@<>()"'`,;]+@[^\s@<>()"'`,;]+/g, "[correo]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[token]");
}

function describir(err: unknown): { mensaje: string; stack: string | null; codigo: string | null; digest: string | null } {
  const e = err as { message?: unknown; stack?: unknown; code?: unknown; digest?: unknown } | null;
  const mensaje = err instanceof Error ? err.message : mensajeError(err);
  // El stack empieza con "Error: <mensaje>": se saca esa línea para no guardarlo dos veces.
  const stack = typeof e?.stack === "string" ? e.stack.split("\n").slice(1).join("\n").trim() : null;
  return {
    mensaje: sanear(mensaje.slice(0, MAX_MENSAJE)),
    stack:   stack ? sanear(stack.slice(0, MAX_STACK)) : null,
    // Código SQLSTATE de pg (ej. "23505") o de Node (ej. "ECONNREFUSED"): sirve para agrupar.
    codigo:  typeof e?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(e.code) ? e.code : null,
    // Next le pone un digest a los errores de render: es lo que ve el usuario en la pantalla de error.
    digest:  typeof e?.digest === "string" ? e.digest.slice(0, 64) : null,
  };
}

/** Guarda el error en la tabla `errores`. Nunca tira. */
export async function registrarError(origen: string, err: unknown, ctx: ContextoError = {}): Promise<void> {
  try {
    const { mensaje, stack, codigo, digest } = describir(err);
    const detalle = {
      ...(codigo ? { codigo } : {}),
      ...(digest ? { digest } : {}),
      ...ctx.detalle,
    };
    await pool.query("select pulso_registrar_error($1, $2, $3, $4, $5, $6)", [
      origen.slice(0, 120),
      mensaje,
      stack,
      ctx.uid ?? null,
      anonimizarIp(ctx.ip ?? null),
      Object.keys(detalle).length ? JSON.stringify(detalle) : null,
    ]);
  } catch (e) {
    console.error("[errores] no se pudo registrar:", origen, mensajeError(e));
  }
}

// ─── Errores no manejados (src/instrumentation.ts) ───────────────────────────

/** Lo que Next le pasa a `onRequestError` (Next 15). */
export interface PeticionConError {
  path:    string;
  method:  string;
  headers: Record<string, string | string[] | undefined>;
}

export interface ContextoNext {
  routerKind:    string;
  routePath:     string;
  routeType:     string;
  renderSource?: string;
}

function header(h: PeticionConError["headers"], nombre: string): string | null {
  const v = Object.entries(h).find(([k]) => k.toLowerCase() === nombre)?.[1];
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/** Token de sesión de la petición (Bearer o cookie), leído de los headers que pasa Next. */
function tokenDe(h: PeticionConError["headers"]): string | null {
  const bearer = header(h, "authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (bearer) return bearer;
  for (const parte of (header(h, "cookie") ?? "").split(";")) {
    const [nombre, ...valor] = parte.trim().split("=");
    if (nombre === COOKIE_SESION && /^[A-Za-z0-9_-]{43}$/.test(valor.join("="))) return valor.join("=");
  }
  return null;
}

/**
 * Registra un error que Next no pudo manejar (route handler, server
 * component, server action). El uid sale de la sesión con una consulta de
 * solo lectura; si la base es justo lo que falló, queda sin uid.
 */
export async function registrarErrorDePeticion(err: unknown, peticion: PeticionConError, contexto: ContextoNext): Promise<void> {
  let uid: string | null = null;
  try {
    const token = tokenDe(peticion.headers);
    if (token) {
      const { rows } = await pool.query<{ uid: string | null }>("select pulso_uid_de_token($1) as uid", [hashDeToken(token)]);
      uid = rows[0]?.uid ?? null;
    }
  } catch {
    // sin uid: no es motivo para no registrar el error
  }
  // La IP con la misma regla que el resto (Cloudflare y Traefik, ver red.ts).
  // Next corre onRequestError dentro del contexto de la petición; si no, null.
  const ip = await ipCliente().catch(() => null);

  await registrarError(`${contexto.routeType}:${contexto.routePath}`.slice(0, 120), err, {
    uid,
    ip,
    detalle: {
      no_manejado: true,
      metodo:      peticion.method,
      // Sin el query string: los enlaces de activación y recuperación llevan el token ahí.
      ruta:        peticion.path.split("?")[0].slice(0, 200),
      ...(contexto.renderSource ? { render: contexto.renderSource } : {}),
    },
  });
}
