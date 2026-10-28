import "server-only";
import { pool } from "@/lib/db/pool";
import { correoBloqueo, enviarDespues, urlDeLaApp } from "@/lib/correo";
import { auditar } from "@/lib/seguridad/auditoria";
import { cifrar, descifrar, indiceCiego } from "@/lib/seguridad/cifrado";
import { hashDeSesion, hashDeToken, nuevoTokenDeEnlace } from "@/lib/sesion";

/**
 * Cuenta con correo y contraseña. Se pone sobre la identidad de la sesión
 * actual, así que lo que ya estaba guardado queda en la cuenta. Toda la
 * lógica vive en las funciones `pulso_*` de db/seguridad.sql: la contraseña se
 * compara en la base y la app no puede leer los hashes.
 *
 * El correo no se guarda en claro (integrador, punto 19): la base tiene su
 * índice ciego (`hmacCorreo`, para buscar y para que no haya dos cuentas con
 * el mismo) y su versión cifrada (`cifrarCorreo`, para mostrarlo y mandar
 * correos). Las dos claves salen de PULSO_CLAVE_DATOS, que la base no tiene.
 * Siempre se normaliza antes (sin espacios y en minúsculas): "Ana@X.com " y
 * "ana@x.com" son la misma cuenta.
 *
 * El inicio de sesión está en lib/sesion.ts (`iniciarSesionConCuenta`),
 * porque crea una sesión y escribe la cookie.
 */

export interface Cuenta {
  email:      string;
  verificada: boolean;
}

export type ResultadoRegistro = "ok" | "sin_sesion" | "ya_tiene_cuenta" | "email_en_uso" | "contrasena_invalida";

/** Lo que devuelve la base al verificar la contraseña en un cambio (punto 4: la equivocada cuenta para el bloqueo). */
export interface Intento {
  /** Minutos que faltan si quedó bloqueada. */
  minutos:           number | null;
  /** Intentos que quedan antes del bloqueo, tras un fallo. */
  intentosRestantes: number | null;
  /** Este fallo fue el que bloqueó: hay que avisarle al dueño. */
  bloqueoNuevo:      boolean;
}

// ─── Correo cifrado (punto 19, contrato C3) ──────────────────────────────────

const CONTEXTO_CORREO = "cuentas.email";

/** La forma en que se guarda y se compara un correo. */
export function normalizarCorreo(email: string): string {
  return email.trim().toLowerCase();
}

/** Índice ciego del correo: con él se busca la cuenta y se exige que sea único. */
export function hmacCorreo(email: string): string {
  return indiceCiego(normalizarCorreo(email), CONTEXTO_CORREO);
}

export function cifrarCorreo(email: string): string {
  return cifrar(normalizarCorreo(email), CONTEXTO_CORREO);
}

export function descifrarCorreo(cifrado: string): string {
  return descifrar(cifrado, CONTEXTO_CORREO);
}

/**
 * Sujeto de los límites por correo. Es un HMAC con otro contexto, no el
 * SHA-256 del correo que se usaba antes: un hash sin clave de algo tan
 * adivinable como un correo se revierte probando una lista de correos.
 */
export function sujetoCorreo(email: string): string {
  return indiceCiego(normalizarCorreo(email), "limites.correo").slice(0, 32);
}

/** "ana.perez@gmail.com" → "an•••@gmail.com", para los avisos (no hace falta el correo entero). */
export function enmascararCorreo(email: string): string {
  const [local, dominio] = normalizarCorreo(email).split("@");
  return `${Array.from(local ?? "").slice(0, 2).join("")}•••@${dominio ?? ""}`;
}

// ─── Registro y activación ───────────────────────────────────────────────────

/** Crea la cuenta sobre la sesión actual. Con "ok", `token` es el del enlace de activación. */
export async function registrarCuenta(
  email: string,
  password: string
): Promise<{ resultado: ResultadoRegistro; token: string | null }> {
  const sesion = await hashDeSesion();
  if (!sesion) return { resultado: "sin_sesion", token: null };
  const { token, hash } = nuevoTokenDeEnlace();
  const { rows } = await pool.query<{ r: ResultadoRegistro }>(
    "select pulso_registrar_cuenta($1, $2, $3, $4, $5, $6) as r",
    [sesion, hmacCorreo(email), cifrarCorreo(email), normalizarCorreo(email), password, hash]
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
  const cifrado = rows[0]?.email;
  return cifrado ? { email: descifrarCorreo(cifrado), token } : null;
}

export async function cuentaDeSesion(): Promise<Cuenta | null> {
  const sesion = await hashDeSesion();
  return sesion ? cuentaDeHash(sesion) : null;
}

/**
 * La cuenta de un token dado: el que la app nativa va a usar después de que
 * `/api/movil/v1/sesion` rotó su sesión (la petición todavía trae el viejo).
 */
export async function cuentaDeToken(token: string): Promise<Cuenta | null> {
  return cuentaDeHash(hashDeToken(token));
}

/** Con el bloqueo con passkey activo y sin desbloquear, null: no se entrega ni el correo. */
async function cuentaDeHash(sesion: string): Promise<Cuenta | null> {
  const { rows } = await pool.query<{ email_cifrado: string; verificada: boolean }>(
    "select * from pulso_cuenta_de_sesion($1)",
    [sesion]
  );
  const fila = rows[0];
  return fila ? { email: descifrarCorreo(fila.email_cifrado), verificada: fila.verificada } : null;
}

// ─── Recuperación ────────────────────────────────────────────────────────────

/** Token del enlace de recuperación, o null si el correo no es de ninguna cuenta. */
export async function solicitarRecuperacion(email: string): Promise<string | null> {
  const { token, hash } = nuevoTokenDeEnlace();
  const { rows } = await pool.query<{ ok: boolean }>(
    "select pulso_solicitar_recuperacion($1, $2) as ok",
    [hmacCorreo(email), hash]
  );
  return rows[0]?.ok ? token : null;
}

/** Correo de la cuenta de un enlace de recuperación vigente (para la regla de contraseñas), o null. */
export async function correoDeRecuperacion(token: string): Promise<string | null> {
  const { rows } = await pool.query<{ c: string | null }>(
    "select pulso_correo_de_recuperacion($1) as c",
    [hashDeToken(token)]
  );
  const cifrado = rows[0]?.c;
  return cifrado ? descifrarCorreo(cifrado) : null;
}

/**
 * Cambia la contraseña con el token del correo, cierra todas las sesiones de
 * la cuenta y levanta el bloqueo por intentos fallidos.
 */
export async function restablecerContrasena(
  token: string,
  password: string,
  email: string
): Promise<{ resultado: "ok" | "enlace_invalido" | "contrasena_invalida"; sesionesCerradas: number }> {
  const { rows } = await pool.query<{ resultado: "ok" | "enlace_invalido" | "contrasena_invalida"; sesiones_cerradas: number }>(
    "select * from pulso_restablecer_contrasena($1, $2, $3)",
    [hashDeToken(token), password, normalizarCorreo(email)]
  );
  return { resultado: rows[0]?.resultado ?? "enlace_invalido", sesionesCerradas: rows[0]?.sesiones_cerradas ?? 0 };
}

// ─── Perfil: cambio de contraseña y de correo (punto 20) ─────────────────────

interface FilaIntento {
  minutos:            number | null;
  intentos_restantes: number | null;
  bloqueo_nuevo:      boolean;
}

function intento(f: FilaIntento | undefined): Intento {
  return { minutos: f?.minutos ?? null, intentosRestantes: f?.intentos_restantes ?? null, bloqueoNuevo: f?.bloqueo_nuevo === true };
}

export type ResultadoCambioContrasena = "ok" | "sin_cuenta" | "credenciales" | "bloqueada" | "contrasena_invalida" | "misma";

/**
 * Cambia la contraseña de la cuenta de la sesión. Cierra las demás sesiones
 * (la de este equipo sigue). `email` es el de la cuenta, para la regla.
 */
export async function cambiarContrasena(
  actual: string,
  nueva: string,
  email: string
): Promise<Intento & { resultado: ResultadoCambioContrasena; sesionesCerradas: number }> {
  const sesion = await hashDeSesion();
  if (!sesion) return { resultado: "sin_cuenta", sesionesCerradas: 0, ...intento(undefined) };
  const { rows } = await pool.query<FilaIntento & { resultado: ResultadoCambioContrasena; sesiones_cerradas: number }>(
    "select * from pulso_cambiar_contrasena($1, $2, $3, $4)",
    [sesion, actual, nueva, normalizarCorreo(email)]
  );
  return { resultado: rows[0]?.resultado ?? "sin_cuenta", sesionesCerradas: rows[0]?.sesiones_cerradas ?? 0, ...intento(rows[0]) };
}

export type ResultadoCambioCorreo = "ok" | "en_uso" | "mismo" | "sin_cuenta" | "credenciales" | "bloqueada";

/**
 * Pide cambiar el correo de la cuenta de la sesión. No cambia nada todavía:
 * con "ok", `token` es el del enlace que hay que mandar al correo NUEVO.
 */
export async function solicitarCambioCorreo(
  password: string,
  nuevo: string
): Promise<Intento & { resultado: ResultadoCambioCorreo; token: string | null }> {
  const sesion = await hashDeSesion();
  if (!sesion) return { resultado: "sin_cuenta", token: null, ...intento(undefined) };
  const { token, hash } = nuevoTokenDeEnlace();
  const { rows } = await pool.query<FilaIntento & { resultado: ResultadoCambioCorreo }>(
    "select * from pulso_solicitar_cambio_correo($1, $2, $3, $4, $5)",
    [sesion, password, hmacCorreo(nuevo), cifrarCorreo(nuevo), hash]
  );
  const resultado = rows[0]?.resultado ?? "sin_cuenta";
  return { resultado, token: resultado === "ok" ? token : null, ...intento(rows[0]) };
}

/** Aplica el cambio de correo con el enlace que llegó al correo nuevo. */
export async function confirmarCambioCorreo(
  token: string
): Promise<{ resultado: "ok" | "enlace_invalido" | "en_uso"; uid: string | null }> {
  const { rows } = await pool.query<{ resultado: "ok" | "enlace_invalido" | "en_uso"; uid: string | null }>(
    "select * from pulso_confirmar_cambio_correo($1)",
    [hashDeToken(token)]
  );
  return { resultado: rows[0]?.resultado ?? "enlace_invalido", uid: rows[0]?.uid ?? null };
}

// ─── Bloqueo por intentos fallidos (punto 4) ─────────────────────────────────

/**
 * Un fallo acaba de bloquear la cuenta: queda en la auditoría y, si el correo
 * es de una cuenta, se le avisa al dueño (alguien puede estar probando su
 * contraseña). Si no hay cuenta, no se manda nada: el bloqueo es el mismo.
 */
export async function avisarBloqueo(e: {
  uid:     string | null;
  email:   string | null;
  ip:      string | null;
  minutos: number;
  origen:  "login" | "cambio_contrasena" | "cambio_correo";
}): Promise<void> {
  await auditar({
    uid: e.uid, accion: "cuenta.bloquear", resultado: "ok", ip: e.ip,
    detalle: { minutos: e.minutos, origen: e.origen, cuenta_existe: e.uid !== null },
  });
  if (e.uid && e.email) {
    enviarDespues(normalizarCorreo(e.email), correoBloqueo(urlDeLaApp("/acceso"), e.minutos), "bloqueo");
  }
}
