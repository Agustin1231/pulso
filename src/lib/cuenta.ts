import "server-only";
import { createHash } from "node:crypto";
import { pool } from "@/lib/db/pool";
import { hashDeSesion, hashDeToken, nuevoTokenDeEnlace } from "@/lib/sesion";

/**
 * Cuenta con correo y contraseña (opcional). Se pone sobre la identidad de la
 * sesión actual, así que lo que ya estaba guardado queda en la cuenta. Toda la
 * lógica vive en las funciones `pulso_*` de db/seguridad.sql: la contraseña se
 * compara en la base y la app no puede leer los hashes.
 *
 * El inicio de sesión está en lib/sesion.ts (`iniciarSesionConCuenta`),
 * porque crea una sesión y escribe la cookie.
 */

export interface Cuenta {
  email:      string;
  verificada: boolean;
}

export type ResultadoRegistro = "ok" | "sin_sesion" | "ya_tiene_cuenta" | "email_en_uso" | "contrasena_invalida";

/** Sujeto de los límites por correo: un hash, para no guardar correos en `limites_tasa`. */
export function sujetoCorreo(email: string): string {
  return createHash("sha256").update(`pulso-correo:${email}`).digest("hex").slice(0, 32);
}

/** Crea la cuenta sobre la sesión actual. Con "ok", `token` es el del enlace de activación. */
export async function registrarCuenta(
  email: string,
  password: string
): Promise<{ resultado: ResultadoRegistro; token: string | null }> {
  const sesion = await hashDeSesion();
  if (!sesion) return { resultado: "sin_sesion", token: null };
  const { token, hash } = nuevoTokenDeEnlace();
  const { rows } = await pool.query<{ r: ResultadoRegistro }>(
    "select pulso_registrar_cuenta($1, $2, $3, $4) as r",
    [sesion, email, password, hash]
  );
  const resultado = rows[0]?.r ?? "sin_sesion";
  return { resultado, token: resultado === "ok" ? token : null };
}

export async function activarCuenta(token: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>("select pulso_activar_cuenta($1) as ok", [hashDeToken(token)]);
  return rows[0]?.ok === true;
}

/** Enlace de activación nuevo para la cuenta sin activar de la sesión, o null si no hay. */
export async function reenviarActivacion(): Promise<{ email: string; token: string } | null> {
  const sesion = await hashDeSesion();
  if (!sesion) return null;
  const { token, hash } = nuevoTokenDeEnlace();
  const { rows } = await pool.query<{ email: string | null }>(
    "select pulso_reenviar_activacion($1, $2) as email",
    [sesion, hash]
  );
  const email = rows[0]?.email;
  return email ? { email, token } : null;
}

export async function cuentaDeSesion(): Promise<Cuenta | null> {
  const sesion = await hashDeSesion();
  if (!sesion) return null;
  const { rows } = await pool.query<Cuenta>("select * from pulso_cuenta_de_sesion($1)", [sesion]);
  return rows[0] ?? null;
}

/** Token del enlace de recuperación, o null si el correo no es de ninguna cuenta. */
export async function solicitarRecuperacion(email: string): Promise<string | null> {
  const { token, hash } = nuevoTokenDeEnlace();
  const { rows } = await pool.query<{ ok: boolean }>(
    "select pulso_solicitar_recuperacion($1, $2) as ok",
    [email, hash]
  );
  return rows[0]?.ok ? token : null;
}

/** Cambia la contraseña con el token del correo y cierra todas las sesiones de la cuenta. */
export async function restablecerContrasena(token: string, password: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    "select pulso_restablecer_contrasena($1, $2) as ok",
    [hashDeToken(token), password]
  );
  return rows[0]?.ok === true;
}
