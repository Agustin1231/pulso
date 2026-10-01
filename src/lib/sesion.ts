import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { pool } from "@/lib/db/pool";

/**
 * Sesión anónima emitida por el servidor (plantilla, filas 1 y 7).
 *
 * Antes la identidad era un UUID generado en el browser, guardado en
 * localStorage y mandado en cada llamada: quien lo conociera era el dueño de
 * la cuenta, y cualquier script de la página lo podía leer.
 *
 * Ahora:
 *   - El token son 256 bits aleatorios, en una cookie httpOnly (JavaScript no
 *     la ve), Secure y SameSite=Strict (no viaja en peticiones de otro sitio).
 *   - La base guarda solo el SHA-256 del token, y el uid lo genera la base.
 *   - Ninguna acción recibe un uid: lo sacan de la cookie con `requerirUid`.
 *   - Sigue siendo anónimo: no hay registro ni datos personales.
 */

const PRODUCCION = process.env.NODE_ENV === "production";

// `__Host-` obliga a Secure, Path=/ y sin Domain: un subdominio no la puede
// pisar. En dev (http://localhost) el prefijo no aplica.
export const COOKIE_SESION = PRODUCCION ? "__Host-pulso_sesion" : "pulso_sesion";

/** Vencimiento por inactividad: cada visita lo vuelve a correr. */
const DIAS_SESION = 180;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes en base64url
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type OrigenSesion = "existente" | "rotada" | "nueva" | "legado";

/** Estado del bloqueo con passkey (fila 9) para el cliente. */
export interface EstadoBloqueo {
  /** El usuario registró una passkey. */
  activo:    boolean;
  /** Activo y sin desbloquear: el servidor no entrega datos. */
  bloqueada: boolean;
}

export class SinSesion extends Error {
  constructor() {
    super("Sesión no válida");
    this.name = "SinSesion";
  }
}

/** Hay sesión, pero el bloqueo está activo y no se desbloqueó. */
export class SesionBloqueada extends Error {
  constructor() {
    super("Sesión bloqueada");
    this.name = "SesionBloqueada";
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function tokenDeCookie(): Promise<string | null> {
  const valor = (await cookies()).get(COOKIE_SESION)?.value;
  return valor && TOKEN_RE.test(valor) ? valor : null;
}

const opcionesCookie = {
  httpOnly: true,
  secure:   PRODUCCION,
  sameSite: "strict" as const,
  path:     "/",
};

async function fijarCookie(token: string): Promise<void> {
  (await cookies()).set(COOKIE_SESION, token, { ...opcionesCookie, maxAge: DIAS_SESION * 86_400 });
}

async function borrarCookie(): Promise<void> {
  // Con los mismos atributos: un `__Host-` sin Secure el browser lo ignora.
  (await cookies()).set(COOKIE_SESION, "", { ...opcionesCookie, maxAge: 0 });
}

/** uid de la sesión vigente, o null. Solo lee: sirve en cualquier contexto de servidor. */
export async function uidDeSesion(): Promise<string | null> {
  const token = await tokenDeCookie();
  if (!token) return null;
  const { rows } = await pool.query<{ uid: string | null }>(
    "select pulso_resolver_sesion($1) as uid",
    [hashToken(token)]
  );
  return rows[0]?.uid ?? null;
}

/** Estado de la sesión de la cookie, sin modificarla. */
export async function estadoSesion(): Promise<{ estado: "sin_sesion" | "bloqueada" | "activa"; bloqueo: EstadoBloqueo }> {
  const token = await tokenDeCookie();
  if (!token) return { estado: "sin_sesion", bloqueo: { activo: false, bloqueada: false } };
  const { rows } = await pool.query<{ estado: "sin_sesion" | "bloqueada" | "activa"; bloqueo: boolean }>(
    "select * from pulso_estado_sesion($1)",
    [hashToken(token)]
  );
  const estado = rows[0]?.estado ?? "sin_sesion";
  return { estado, bloqueo: { activo: rows[0]?.bloqueo ?? false, bloqueada: estado === "bloqueada" } };
}

/**
 * uid de la sesión vigente. Si no hay sesión tira `SinSesion`; si la hay pero
 * está bloqueada, `SesionBloqueada` (la consulta extra solo corre al fallar).
 */
export async function requerirUid(): Promise<string> {
  const uid = await uidDeSesion();
  if (uid) return uid;
  if ((await estadoSesion()).estado === "bloqueada") throw new SesionBloqueada();
  throw new SinSesion();
}

// ─── Flujo de desbloqueo (fila 9) ─────────────────────────────────────────────
// Estas funciones trabajan con la sesión de la cookie aunque esté BLOQUEADA:
// son las únicas que lo hacen, porque son las que permiten desbloquearla.

/** uid de la sesión de la cookie, ignorando el bloqueo, o null. */
export async function uidIgnorandoBloqueo(): Promise<string | null> {
  const token = await tokenDeCookie();
  if (!token) return null;
  const { rows } = await pool.query<{ uid: string | null }>(
    "select pulso_uid_de_token($1) as uid",
    [hashToken(token)]
  );
  return rows[0]?.uid ?? null;
}

export async function fijarDesafio(tipo: "registro" | "desbloqueo", desafio: string): Promise<void> {
  const token = await tokenDeCookie();
  if (!token) throw new SinSesion();
  await pool.query("select pulso_fijar_desafio($1, $2, $3)", [hashToken(token), tipo, desafio]);
}

/** Devuelve el desafío pendiente y lo borra: no se puede usar dos veces. */
export async function consumirDesafio(tipo: "registro" | "desbloqueo"): Promise<string | null> {
  const token = await tokenDeCookie();
  if (!token) return null;
  const { rows } = await pool.query<{ d: string | null }>(
    "select pulso_consumir_desafio($1, $2) as d",
    [hashToken(token), tipo]
  );
  return rows[0]?.d ?? null;
}

/** Abre la ventana de uso. Solo después de verificar la passkey. */
export async function desbloquearSesion(): Promise<boolean> {
  const token = await tokenDeCookie();
  if (!token) return false;
  const { rows } = await pool.query<{ ok: boolean | null }>(
    "select pulso_desbloquear($1) as ok",
    [hashToken(token)]
  );
  return rows[0]?.ok === true;
}

/** "Bloquear ahora". */
export async function bloquearSesion(): Promise<void> {
  const token = await tokenDeCookie();
  if (token) await pool.query("select pulso_bloquear($1)", [hashToken(token)]);
}

/**
 * Cierra la sesión de este equipo (revoca el token y borra la cookie). Sirve
 * aunque esté bloqueada: es la salida si el usuario no puede desbloquear. Los
 * datos NO se borran; quedan accesibles solo con una sesión desbloqueada.
 */
export async function cerrarSesionEnEsteEquipo(): Promise<void> {
  const token = await tokenDeCookie();
  if (token) await pool.query("select pulso_revocar_sesion($1)", [hashToken(token)]);
  await borrarCookie();
}

/**
 * Renueva la sesión vigente o crea una. Si no hay sesión y el browser trae un
 * UUID viejo del localStorage, intenta reclamarlo (una sola vez por uid, ver
 * `pulso_reclamar_legado`) para no perder el historial de quien ya usaba la app.
 *
 * Rotación (fila 7): si el token tiene más de un día, se reemplaza por uno
 * nuevo con la misma identidad y el viejo deja de servir en 2 minutos. Un token
 * robado sirve, como mucho, hasta la próxima vez que el dueño abre la app.
 *
 * Escribe la cookie: solo se puede llamar desde un route handler o una server action.
 */
export async function asegurarSesion(
  legado?: string | null
): Promise<{ uid: string; origen: OrigenSesion }> {
  const actual = await tokenDeCookie();
  if (actual) {
    const candidato = randomBytes(32).toString("base64url");
    const { rows } = await pool.query<{ uid: string; rotada: boolean }>(
      "select * from pulso_renovar_o_rotar($1, $2, $3)",
      [hashToken(actual), hashToken(candidato), DIAS_SESION]
    );
    if (rows[0]) {
      await fijarCookie(rows[0].rotada ? candidato : actual);
      return { uid: rows[0].uid, origen: rows[0].rotada ? "rotada" : "existente" };
    }

    // Token ya rotado pero dentro de los 2 minutos de gracia: es una petición
    // que salió antes de que llegara la cookie nueva. Es la misma persona: no
    // se crea otra identidad ni se toca la cookie (el browser ya tiene la nueva).
    const uid = await uidIgnorandoBloqueo();
    if (uid) return { uid, origen: "existente" };
  }

  const token = randomBytes(32).toString("base64url");
  const hash = hashToken(token);

  if (legado && UUID_RE.test(legado)) {
    const { rows } = await pool.query<{ uid: string | null }>(
      "select pulso_reclamar_legado($1, $2, $3) as uid",
      [hash, legado, DIAS_SESION]
    );
    const uid = rows[0]?.uid;
    if (uid) {
      await fijarCookie(token);
      return { uid, origen: "legado" };
    }
  }

  const { rows } = await pool.query<{ uid: string }>(
    "select pulso_crear_sesion($1, $2) as uid",
    [hash, DIAS_SESION]
  );
  await fijarCookie(token);
  return { uid: rows[0].uid, origen: "nueva" };
}

/**
 * Supresión (Ley 1581): borra en la base todos los datos del dueño de la
 * sesión, la sesión misma y la cookie. Devuelve el uid borrado, o null si no
 * había sesión.
 */
export async function eliminarDatosDeLaSesion(): Promise<string | null> {
  const token = await tokenDeCookie();
  if (!token) return null;
  const { rows } = await pool.query<{ uid: string | null }>(
    "select pulso_eliminar_datos($1) as uid",
    [hashToken(token)]
  );
  await borrarCookie();
  return rows[0]?.uid ?? null;
}
