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

export type OrigenSesion = "existente" | "nueva" | "legado";

export class SinSesion extends Error {
  constructor() {
    super("Sesión no válida");
    this.name = "SinSesion";
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

/** uid de la sesión vigente; si no hay, tira `SinSesion`. */
export async function requerirUid(): Promise<string> {
  const uid = await uidDeSesion();
  if (!uid) throw new SinSesion();
  return uid;
}

/**
 * Renueva la sesión vigente o crea una. Si no hay sesión y el browser trae un
 * UUID viejo del localStorage, intenta reclamarlo (una sola vez por uid, ver
 * `pulso_reclamar_legado`) para no perder el historial de quien ya usaba la app.
 *
 * Escribe la cookie: solo se puede llamar desde un route handler o una server action.
 */
export async function asegurarSesion(
  legado?: string | null
): Promise<{ uid: string; origen: OrigenSesion }> {
  const actual = await tokenDeCookie();
  if (actual) {
    const { rows } = await pool.query<{ uid: string | null }>(
      "select pulso_renovar_sesion($1, $2) as uid",
      [hashToken(actual), DIAS_SESION]
    );
    const uid = rows[0]?.uid;
    if (uid) {
      await fijarCookie(actual);
      return { uid, origen: "existente" };
    }
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
