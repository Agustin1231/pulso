import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
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
 *   - Para usar los datos hace falta una cuenta activada (correo y contraseña,
 *     ver lib/cuenta.ts). La sesión anónima solo sirve para crearla o para
 *     iniciar sesión: la cuenta se pone sobre esa misma identidad.
 *
 * La app nativa (Android) no tiene cookies de browser: manda el mismo token en
 * `Authorization: Bearer`, y lo guarda cifrado con el Keystore del teléfono.
 * Es la misma sesión, con el mismo hash, rotación y vencimiento. Un sitio
 * ajeno no puede poner ese header (haría falta CORS, y no hay), así que no
 * abre una puerta de CSRF.
 *
 * Vencimientos (integrador, puntos 10 y 11). Los dos tiempos están en la tabla
 * `configuracion` y la base los lee en cada petición (`pulso_sesion_vigente`
 * en db/plataforma.sql), así que un cambio del administrador rige enseguida:
 *   - el TOKEN deja de servir tras `token_inactividad_minutos` sin ninguna
 *     petición autenticada (cada una corre el vencimiento);
 *   - la SESIÓN con cuenta se cierra tras `sesion_inactividad_minutos` sin
 *     que el usuario toque la app. La actividad la informa el latido del
 *     cliente (`latidoDeSesion`), no las peticiones de fondo. Vale para la web
 *     y para la app nativa, que manda el mismo latido; sus sesiones quedan
 *     marcadas `cliente = 'movil'` solo para la auditoría y la administración.
 * Cuando una sesión deja de servir, la base guarda por qué (`revocada_motivo`)
 * y `motivoDeFin` se lo cuenta al navegador que la tenía.
 */

const PRODUCCION = process.env.NODE_ENV === "production";

// `__Host-` obliga a Secure, Path=/ y sin Domain: un subdominio no la puede
// pisar. En dev (http://localhost) el prefijo no aplica.
export const COOKIE_SESION = PRODUCCION ? "__Host-pulso_sesion" : "pulso_sesion";

/**
 * Cuánto guarda el navegador la cookie: el máximo que admite la configuración
 * (525 600 minutos). Quien decide si el token sirve es la base; que la cookie
 * dure más permite, cuando ya no sirve, contarle al usuario por qué.
 */
const MAX_EDAD_COOKIE = 365 * 86_400;

/**
 * Aviso para el cliente web de que una server action no encontró la sesión
 * (punto 18). Una server action no puede responder 401: el vigía de sesión del
 * cliente mira esta cookie después de cada respuesta y, si está, lleva la
 * pestaña a /acceso. No lleva ningún dato: solo "revisa la sesión".
 */
export const COOKIE_AVISO = "pulso_aviso_sesion";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes en base64url
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type OrigenSesion = "existente" | "rotada" | "nueva" | "legado";

/** Por qué dejó de servir una sesión con cuenta (`revocada_motivo`, o 'vencida' si venció el token). */
export type MotivoFin = "cierre" | "otro_inicio" | "inactividad" | "contrasena" | "admin" | "vencida";

const MOTIVOS: readonly MotivoFin[] = ["cierre", "otro_inicio", "inactividad", "contrasena", "admin", "vencida"];

function motivoValido(m: unknown): MotivoFin | null {
  return MOTIVOS.includes(m as MotivoFin) ? (m as MotivoFin) : null;
}

/** Los dos tiempos de inactividad vigentes y cuánto hace que el usuario no interactúa. */
export interface InactividadSesion {
  vigente:        boolean;
  /** Segundos desde la última interacción registrada; null si la regla no aplica (sesión sin cuenta). */
  inactivaSeg:    number | null;
  tokenMinutos:   number;
  sesionMinutos:  number;
}

/** Evento de auditoría de una sesión que cambió (todas menos la que solo se renovó). */
export function eventoSesion(origen: Exclude<OrigenSesion, "existente">): string {
  switch (origen) {
    case "legado": return "sesion.reclamar";
    case "nueva":  return "sesion.crear";
    case "rotada": return "sesion.rotar";
  }
}

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

/** SHA-256 de un token que mandó el cliente (sesión o enlace del correo): es lo único que ve la base. */
export function hashDeToken(token: string): string {
  return hashToken(token);
}

/**
 * Token para un enlace de un solo uso (activación, recuperación): el valor va
 * en el correo y a la base solo llega su hash, como con las sesiones.
 */
export function nuevoTokenDeEnlace(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

/** Token del header `Authorization: Bearer` (app nativa), o null. */
async function tokenDeBearer(): Promise<string | null> {
  const valor = (await headers()).get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  return valor ?? null;
}

/** Token de la petición: el Bearer de la app nativa o, si no viene, la cookie del browser. */
async function tokenDeSolicitud(): Promise<string | null> {
  const bearer = await tokenDeBearer();
  if (bearer) return bearer;
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
  (await cookies()).set(COOKIE_SESION, token, { ...opcionesCookie, maxAge: MAX_EDAD_COOKIE });
}

async function borrarCookie(): Promise<void> {
  // Con los mismos atributos: un `__Host-` sin Secure el browser lo ignora.
  (await cookies()).set(COOKIE_SESION, "", { ...opcionesCookie, maxAge: 0 });
}

/** Hash del token de sesión de la petición, o null si no trae uno. */
export async function hashDeSesion(): Promise<string | null> {
  const token = await tokenDeSolicitud();
  return token ? hashToken(token) : null;
}

/**
 * uid de la sesión vigente CON una cuenta activada, o null. Es el que usan
 * todas las rutas y acciones de datos: sin cuenta no se lee ni se guarda nada.
 * Solo lee: sirve en cualquier contexto de servidor.
 */
export async function uidDeSesion(): Promise<string | null> {
  const token = await tokenDeSolicitud();
  if (!token) return null;
  const { rows } = await pool.query<{ uid: string | null }>(
    "select pulso_uid_con_cuenta($1) as uid",
    [hashToken(token)]
  );
  return rows[0]?.uid ?? null;
}

/**
 * uid de la sesión vigente aunque no tenga cuenta (sí respeta el bloqueo).
 * Solo para lo que se hace antes de tener cuenta: crearla, reenviar la
 * activación, ver su estado, y el borrado de datos (Ley 1581).
 */
export async function uidDeSesionSinCuenta(): Promise<string | null> {
  const token = await tokenDeSolicitud();
  if (!token) return null;
  const { rows } = await pool.query<{ uid: string | null }>(
    "select pulso_resolver_sesion($1) as uid",
    [hashToken(token)]
  );
  return rows[0]?.uid ?? null;
}

export type EstadoCuenta = "ninguna" | "sin_activar" | "activa";

/** Si la sesión de la petición tiene cuenta y si está activada. */
export async function estadoCuenta(): Promise<EstadoCuenta> {
  const token = await tokenDeSolicitud();
  if (!token) return "ninguna";
  const { rows } = await pool.query<{ e: EstadoCuenta | null }>(
    "select pulso_estado_cuenta($1) as e",
    [hashToken(token)]
  );
  return rows[0]?.e ?? "ninguna";
}

type Estado = { estado: "sin_sesion" | "bloqueada" | "activa"; bloqueo: EstadoBloqueo };

/** Estado de la sesión de la petición, sin modificarla. */
export async function estadoSesion(): Promise<Estado> {
  return estadoSesionDeToken(await tokenDeSolicitud());
}

/** Estado de un token dado: el que la app nativa va a usar después de crear o rotar la sesión. */
export async function estadoSesionDeToken(token: string | null): Promise<Estado> {
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
  const token = await tokenDeSolicitud();
  if (!token) return null;
  const { rows } = await pool.query<{ uid: string | null }>(
    "select pulso_uid_de_token($1) as uid",
    [hashToken(token)]
  );
  return rows[0]?.uid ?? null;
}

export async function fijarDesafio(tipo: "registro" | "desbloqueo", desafio: string): Promise<void> {
  const token = await tokenDeSolicitud();
  if (!token) throw new SinSesion();
  await pool.query("select pulso_fijar_desafio($1, $2, $3)", [hashToken(token), tipo, desafio]);
}

/** Devuelve el desafío pendiente y lo borra: no se puede usar dos veces. */
export async function consumirDesafio(tipo: "registro" | "desbloqueo"): Promise<string | null> {
  const token = await tokenDeSolicitud();
  if (!token) return null;
  const { rows } = await pool.query<{ d: string | null }>(
    "select pulso_consumir_desafio($1, $2) as d",
    [hashToken(token), tipo]
  );
  return rows[0]?.d ?? null;
}

/** Abre la ventana de uso. Solo después de verificar la passkey. */
export async function desbloquearSesion(): Promise<boolean> {
  const token = await tokenDeSolicitud();
  if (!token) return false;
  const { rows } = await pool.query<{ ok: boolean | null }>(
    "select pulso_desbloquear($1) as ok",
    [hashToken(token)]
  );
  return rows[0]?.ok === true;
}

/** "Bloquear ahora". */
export async function bloquearSesion(): Promise<void> {
  const token = await tokenDeSolicitud();
  if (token) await pool.query("select pulso_bloquear($1)", [hashToken(token)]);
}

/**
 * Cierra la sesión de este equipo (revoca el token y borra la cookie). Sirve
 * aunque esté bloqueada: es la salida si el usuario no puede desbloquear. Los
 * datos NO se borran; quedan accesibles solo con una sesión desbloqueada.
 * `motivo`: 'cierre' si la cerró el usuario, 'inactividad' si la cerró el
 * vigía de inactividad del cliente (punto 11).
 */
export async function cerrarSesionEnEsteEquipo(motivo: "cierre" | "inactividad" = "cierre"): Promise<void> {
  const token = await tokenDeSolicitud();
  if (token) await pool.query("select pulso_revocar_sesion($1, $2)", [hashToken(token), motivo]);
  await borrarCookie();
}

// ─── Fin de la sesión e inactividad (integrador, puntos 10, 11, 16 y 18) ──────

/** Por qué dejó de servir la sesión de un token, o null si sirve o no hay nada que explicar. */
async function motivoDeToken(token: string): Promise<MotivoFin | null> {
  const { rows } = await pool.query<{ m: string | null }>("select pulso_motivo_sesion($1) as m", [hashToken(token)]);
  return motivoValido(rows[0]?.m);
}

/**
 * Por qué dejó de servir la sesión que trae esta petición: 'otro_inicio',
 * 'inactividad', 'cierre', 'contrasena', 'admin' o 'vencida'. null si sigue
 * sirviendo, si no trae token o si era una sesión sin cuenta.
 */
export async function motivoDeFin(): Promise<MotivoFin | null> {
  const token = await tokenDeSolicitud();
  return token ? motivoDeToken(token) : null;
}

interface FilaInactividad {
  vigente:        boolean;
  inactiva_seg:   number | null;
  token_minutos:  number;
  sesion_minutos: number;
}

function inactividadDeFila(r: FilaInactividad | undefined): InactividadSesion {
  return {
    vigente:       r?.vigente === true,
    inactivaSeg:   r?.inactiva_seg ?? null,
    tokenMinutos:  r?.token_minutos ?? 259_200,
    sesionMinutos: r?.sesion_minutos ?? 30,
  };
}

/** Los tiempos de inactividad vigentes para la sesión de la petición, sin renovar nada. */
export async function inactividadDeSesion(): Promise<InactividadSesion> {
  const token = await tokenDeSolicitud();
  const { rows } = await pool.query<FilaInactividad>(
    "select * from pulso_inactividad_de_sesion($1)",
    [token ? hashToken(token) : null]
  );
  return inactividadDeFila(rows[0]);
}

/**
 * Latido del cliente (web o app nativa): el usuario interactuó hace `haceSeg` segundos. Corre
 * la actividad de la sesión (punto 11) y el vencimiento del token (punto 10).
 * Ninguna otra petición mueve la actividad.
 */
export async function latidoDeSesion(haceSeg: number): Promise<InactividadSesion> {
  const token = await tokenDeSolicitud();
  if (!token) return inactividadDeSesion();
  const { rows } = await pool.query<FilaInactividad>("select * from pulso_latido($1, $2)", [hashToken(token), haceSeg]);
  return inactividadDeFila(rows[0]);
}

/**
 * Una server action del navegador no encontró la sesión: deja la cookie de
 * aviso para que el vigía del cliente lleve la pestaña a /acceso (ver
 * COOKIE_AVISO). Solo en server actions (traen el header `Next-Action`): la API
 * de la app nativa usa las mismas acciones y ahí no se pone ninguna cookie.
 * Nunca tira.
 */
export async function avisarFinDeSesion(): Promise<void> {
  try {
    if (!(await headers()).has("next-action")) return;
    (await cookies()).set(COOKIE_AVISO, "1", { httpOnly: false, secure: PRODUCCION, sameSite: "strict", path: "/", maxAge: 60 });
  } catch {
    // Fuera de una server action (render de un Server Component) no se pueden
    // escribir cookies; ahí el vigía se entera por su sondeo.
  }
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
 * Si el navegador trae el token de una sesión que ya no sirve, `motivo` dice
 * por qué (se cerró en otro navegador, por inactividad, venció…) ANTES de
 * reemplazarla por una anónima nueva: es lo que /acceso le explica al usuario.
 *
 * Escribe la cookie: solo se puede llamar desde un route handler o una server action.
 */
export async function asegurarSesion(
  legado?: string | null
): Promise<{ uid: string; origen: OrigenSesion; motivo: MotivoFin | null }> {
  const { uid, origen, token, motivo } = await renovarOCrear(await tokenDeSolicitud(), legado, "web");
  if (token) await fijarCookie(token);
  return { uid, origen, motivo };
}

/**
 * Lo mismo para la app nativa: toma el token del Bearer (nunca de una cookie)
 * y devuelve en el cuerpo el que hay que guardar. `token` es null cuando el
 * cliente tiene que seguir con el que ya tiene. Sus sesiones nuevas quedan
 * marcadas como 'movil'. `motivo` es, como en la web, por qué dejó de servir el
 * token que mandó la app (si mandó uno que ya no sirve).
 */
export async function asegurarSesionMovil(): Promise<{ uid: string; origen: OrigenSesion; token: string | null; motivo: MotivoFin | null }> {
  return renovarOCrear(await tokenDeBearer(), null, "movil");
}

/** uid del Bearer ignorando el bloqueo, o null. Para decidir si `asegurarSesionMovil` va a crear una sesión. */
export async function uidDeBearerIgnorandoBloqueo(): Promise<string | null> {
  const token = await tokenDeBearer();
  if (!token) return null;
  const { rows } = await pool.query<{ uid: string | null }>(
    "select pulso_uid_de_token($1) as uid",
    [hashToken(token)]
  );
  return rows[0]?.uid ?? null;
}

async function renovarOCrear(
  actual: string | null,
  legado: string | null | undefined,
  cliente: "web" | "movil"
): Promise<{ uid: string; origen: OrigenSesion; token: string | null; motivo: MotivoFin | null }> {
  let motivo: MotivoFin | null = null;
  if (actual) {
    const candidato = randomBytes(32).toString("base64url");
    const { rows } = await pool.query<{ uid: string; rotada: boolean }>(
      "select * from pulso_renovar_o_rotar($1, $2)",
      [hashToken(actual), hashToken(candidato)]
    );
    if (rows[0]) {
      const rotada = rows[0].rotada;
      return { uid: rows[0].uid, origen: rotada ? "rotada" : "existente", token: rotada ? candidato : actual, motivo };
    }

    // Token ya rotado pero dentro de los 2 minutos de gracia: es una petición
    // que salió antes de que llegara la cookie nueva. Es la misma persona: no
    // se crea otra identidad ni se toca la cookie (el browser ya tiene la nueva).
    const { rows: gracia } = await pool.query<{ uid: string | null }>(
      "select pulso_uid_de_token($1) as uid",
      [hashToken(actual)]
    );
    const uid = gracia[0]?.uid;
    if (uid) return { uid, origen: "existente", token: null, motivo };

    // Ya no sirve: antes de reemplazarla, por qué (punto 16 y los demás).
    motivo = await motivoDeToken(actual);
  }

  const token = randomBytes(32).toString("base64url");
  const hash = hashToken(token);

  if (legado && UUID_RE.test(legado)) {
    const { rows } = await pool.query<{ uid: string | null }>(
      "select pulso_reclamar_legado($1, $2) as uid",
      [hash, legado]
    );
    const uid = rows[0]?.uid;
    if (uid) return { uid, origen: "legado", token, motivo };
  }

  const { rows } = await pool.query<{ uid: string }>(
    "select pulso_crear_sesion($1, $2) as uid",
    [hash, cliente]
  );
  return { uid: rows[0].uid, origen: "nueva", token, motivo };
}

/**
 * `uid` en los rechazos es la cuenta del correo si existe, solo para la
 * auditoría: al cliente no se le dice (no tiene que saber si el correo está
 * registrado). `token` es el de la sesión nueva: solo la app nativa lo recibe
 * en el cuerpo; la web lo tiene en la cookie y nunca lo ve.
 */
export type ResultadoLogin =
  | { resultado: "ok"; uid: string; fusionado: string | null; sesionesCerradas: number; token: string }
  | { resultado: "credenciales"; uid: string | null; intentosRestantes: number }
  | { resultado: "bloqueada"; uid: string | null; minutos: number; bloqueoNuevo: boolean }
  | { resultado: "sin_verificar"; uid: string | null };

/**
 * Inicio de sesión con correo (su índice ciego, ver `hmacCorreo` en
 * lib/cuenta.ts) y contraseña. La base compara la contraseña y, si está bien,
 * abre una sesión nueva para la cuenta (ya desbloqueada), revoca la de este
 * equipo y cierra las demás sesiones de la cuenta (integrador, punto 16). Si
 * la sesión de este equipo era anónima, sus datos se suman a la cuenta:
 * `fusionado` es la identidad que se sumó, para mover sus imágenes.
 *
 * Cinco fallos seguidos bloquean el correo 15 minutos (punto 4): mientras
 * tanto ni la contraseña correcta entra.
 *
 * `cliente`:
 *   - 'web': la sesión de este equipo es la de la petición (cookie, o Bearer si
 *     viene) y el token nuevo va a la cookie. Solo se puede llamar desde un
 *     route handler o una server action.
 *   - 'movil': la de este equipo es SOLO la del Bearer (una cookie no cuenta:
 *     la app nativa no tiene) y no se toca ninguna cookie: el token nuevo se
 *     devuelve en `token` para que la ruta se lo dé a la app.
 */
export async function iniciarSesionConCuenta(
  emailHmac: string,
  password: string,
  cliente: "web" | "movil" = "web"
): Promise<ResultadoLogin> {
  const actual = cliente === "movil" ? await tokenDeBearer() : await tokenDeSolicitud();
  const token = randomBytes(32).toString("base64url");
  const { rows } = await pool.query<{
    resultado: string; uid_cuenta: string | null; uid_fusionado: string | null; minutos: number | null;
    intentos_restantes: number | null; bloqueo_nuevo: boolean | null; sesiones_cerradas: number | null;
  }>(
    "select * from pulso_iniciar_sesion_cuenta($1, $2, $3, $4, $5)",
    [emailHmac, password, hashToken(token), actual ? hashToken(actual) : null, cliente]
  );
  const r = rows[0];
  const uid = r?.uid_cuenta ?? null;
  switch (r?.resultado) {
    case "ok":
      if (!uid) break;
      if (cliente === "web") await fijarCookie(token);
      return { resultado: "ok", uid, fusionado: r.uid_fusionado, sesionesCerradas: r.sesiones_cerradas ?? 0, token };
    case "bloqueada":
      return { resultado: "bloqueada", uid, minutos: r.minutos ?? 15, bloqueoNuevo: r.bloqueo_nuevo === true };
    case "sin_verificar":
      return { resultado: "sin_verificar", uid };
  }
  return { resultado: "credenciales", uid, intentosRestantes: r?.intentos_restantes ?? 0 };
}

/**
 * Supresión (Ley 1581): borra en la base todos los datos del dueño de la
 * sesión, la sesión misma y la cookie. Devuelve el uid borrado, o null si no
 * había sesión.
 */
export async function eliminarDatosDeLaSesion(): Promise<string | null> {
  const token = await tokenDeSolicitud();
  if (!token) return null;
  const { rows } = await pool.query<{ uid: string | null }>(
    "select pulso_eliminar_datos($1) as uid",
    [hashToken(token)]
  );
  await borrarCookie();
  return rows[0]?.uid ?? null;
}
