// Ayudas compartidas por las pruebas funcionales de la API (node --test).
//
//   BASE_URL=http://127.0.0.1:3107 MOCK_IA_URL=http://127.0.0.1:3190 \
//   DATABASE_ADMIN_URL=postgres://postgres:…@127.0.0.1:55432/pulso \
//   node --test --test-concurrency=1 tests/funcionales/
//
// Desde el 21-oct-2026 los datos exigen una cuenta activada: `nuevoToken` le
// pone una a cada identidad de prueba (con DATABASE_ADMIN_URL, o con
// MAILPIT_URL si no está la base).
//
// Corren SIEMPRE contra el servidor funcional local (base descartable `pulso`),
// nunca contra producción: crean y borran identidades, inyectan fallas en el
// doble de IA y vacían contadores de límites de tasa.

import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import pg from "pg";

export const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3107").replace(/\/+$/, "");
export const MOCK = (process.env.MOCK_IA_URL ?? "http://127.0.0.1:3190").replace(/\/+$/, "");
export const ADMIN = process.env.DATABASE_ADMIN_URL;
export const MAILPIT = (process.env.MAILPIT_URL ?? "").replace(/\/+$/, "");

if (/agustinynatalia\.site/.test(BASE)) {
  throw new Error("Las pruebas funcionales crean y borran datos: no se corren contra producción.");
}

// ─── IP de prueba ─────────────────────────────────────────────────────────────
// El servidor local escucha en 127.0.0.1 sin Traefik ni Cloudflare delante, así
// que `ipCliente()` toma la IP del último valor de `X-Forwarded-For` (en
// producción Traefik descarta ese header y pone el par real). Cada corrida usa
// una IP de documentación (RFC 5737, TEST-NET-2/3) para no gastar el cupo de 30
// sesiones nuevas por hora de 127.0.0.1, que es la IP con la que llega el
// emulador por `adb reverse`. Las pruebas que AGOTAN un límite piden una IP
// propia del rango de documentación IPv6 (RFC 3849): 2^96 valores, así dos
// corridas en la misma hora no se pisan el contador.

export const IP_CORRIDA = `${randomInt(2) ? "198.51.100" : "203.0.113"}.${randomInt(1, 255)}`;

/** IP de prueba nueva, para un caso que agota un límite (sesiones, supresión, IA). */
export function nuevaIp() {
  const h = () => randomBytes(2).toString("hex");
  return `2001:db8:${h()}:${h()}::${h()}`;
}

// ─── Disponibilidad ───────────────────────────────────────────────────────────

async function responde(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Motivo para saltear la suite, o false. */
export const SALTEAR = (await responde(`${BASE}/api/movil/v1/sesion`))
  ? false
  : `el servidor funcional no responde en ${BASE}`;
export const SIN_ADMIN = SALTEAR || (!ADMIN ? "falta DATABASE_ADMIN_URL (base descartable)" : false);
export const SIN_MOCK = SALTEAR || ((await responde(`${MOCK}/__salud`)) ? false : `el doble de IA no responde en ${MOCK}`);

// ─── HTTP ─────────────────────────────────────────────────────────────────────

export const hashToken = (token) => createHash("sha256").update(token).digest("hex");

/** POST /api/movil/v1/sesion como la app: sin Bearer crea una identidad; con él, renueva. */
export async function sesionMovil({ token, ip = IP_CORRIDA } = {}) {
  const res = await fetch(`${BASE}/api/movil/v1/sesion`, {
    method: "POST",
    headers: { "X-Forwarded-For": ip, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const cuerpo = await res.json().catch(() => null);
  return { status: res.status, cuerpo, res };
}

/**
 * Token de una identidad nueva SIN cuenta (falla la prueba si no se pudo
 * crear). Solo sirve para crear la cuenta o iniciar sesión: los datos
 * responden 401 `cuenta_requerida`. Cada identidad se crea desde su propia IP
 * de documentación, como si fuera otro teléfono: una corrida completa crea más
 * de 30 y, desde una sola IP, el límite `sesionIp` cortaría a mitad de camino.
 */
export async function nuevoTokenAnonimo(ip = nuevaIp()) {
  const { status, cuerpo } = await sesionMovil({ ip });
  assert.equal(status, 200, `no se pudo crear la sesión: ${JSON.stringify(cuerpo)}`);
  creados.push(cuerpo.token);
  return cuerpo.token;
}

/** Cumple la regla de contraseñas y no contiene la parte local de los correos de prueba. */
const CLAVE_CUENTA = "Prueba-Funcional#7Qz";

/**
 * Token de una identidad nueva CON una cuenta activada: lo que tiene la app
 * después de iniciar sesión. Como la app, registra la cuenta sobre su sesión
 * anónima; la activa el dueño de la base (rápido) o, sin DATABASE_ADMIN_URL,
 * el enlace del correo que llega a Mailpit.
 */
export async function nuevoToken(ip = nuevaIp()) {
  const token = await nuevoTokenAnonimo(ip);
  const email = `funcional-${randomBytes(5).toString("hex")}@pulso.test`;
  const reg = await fetch(`${BASE}/api/cuenta/registro`, {
    method: "POST",
    headers: { "X-Forwarded-For": ip, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: CLAVE_CUENTA }),
  });
  assert.equal(reg.status, 200, `no se pudo registrar la cuenta: ${await reg.text()}`);

  if (ADMIN) {
    await admin().query(
      "update cuentas set verificada_at = now() where uid = (select uid from sesiones where token_hash = $1)",
      [hashToken(token)]
    );
    return token;
  }
  assert.ok(MAILPIT, "para activar la cuenta de prueba hace falta DATABASE_ADMIN_URL o MAILPIT_URL");
  for (let i = 0; i < 40; i++) {
    const lista = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
    const id = lista.messages?.[0]?.ID;
    const texto = id ? (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()).Text ?? "" : "";
    const enlace = texto.match(/token=([A-Za-z0-9_-]{43})/)?.[1];
    if (enlace) {
      const act = await fetch(`${BASE}/api/cuenta/activar`, {
        method: "POST",
        headers: { "X-Forwarded-For": ip, "Content-Type": "application/json" },
        body: JSON.stringify({ token: enlace }),
      });
      assert.equal(act.status, 200, `no se pudo activar la cuenta: ${await act.text()}`);
      return token;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.fail(`no llegó el correo de activación a ${email}`);
}

/**
 * Petición a `/api/movil/v1/<ruta>`. Igual que `PulsoApi.llamar` de la app:
 * POST/PUT/PATCH sin cuerpo mandan `{}` (el servidor exige un objeto JSON).
 * `cuerpo` puede ser un string crudo para probar JSON inválido.
 */
export async function movil(metodo, ruta, token, cuerpo, { ip = IP_CORRIDA, headers = {} } = {}) {
  const conCuerpo = cuerpo !== undefined || ["POST", "PUT", "PATCH"].includes(metodo);
  const body = cuerpo === undefined ? (conCuerpo ? "{}" : undefined) : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
  const res = await fetch(`${BASE}/api/movil/v1/${ruta}`, {
    method: metodo,
    headers: {
      "X-Forwarded-For": ip,
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body,
  });
  const texto = await res.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* no es JSON */ }
  return { status: res.status, json, texto, res };
}

/** GET que tiene que salir bien: devuelve el JSON. */
export async function leer(ruta, token) {
  const r = await movil("GET", ruta, token);
  assert.equal(r.status, 200, `GET ${ruta}: ${r.status} ${r.texto.slice(0, 200)}`);
  return r.json;
}

/** Escritura que tiene que salir bien (`{ ok: true }`). */
export async function escribir(metodo, ruta, token, cuerpo) {
  const r = await movil(metodo, ruta, token, cuerpo);
  assert.equal(r.status, 200, `${metodo} ${ruta}: ${r.status} ${r.texto.slice(0, 200)}`);
  assert.deepEqual(r.json, { ok: true });
  return r;
}

/** Afirma un rechazo con su status y su código de error. */
export async function rechazo(promesa, status, codigo, contexto = "") {
  const r = await promesa;
  assert.equal(r.status, status, `${contexto} respondió ${r.status} ${r.texto?.slice(0, 200) ?? ""}`);
  if (codigo) assert.equal(r.json?.error, codigo, `${contexto} código ${r.json?.error}`);
  return r;
}

/**
 * POST a una ruta de IA de la web (`/api/tips`, …) y lectura del stream del
 * Vercel AI SDK v4, una parte por línea: `0:"texto"`, `3:"error"`, y los
 * metadatos `f:`, `e:`, `d:`. Es lo mismo que hace `PulsoApi.streamIA`.
 */
export async function ia(ruta, token, cuerpo = {}, { ip = IP_CORRIDA } = {}) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: "POST",
    headers: {
      "X-Forwarded-For": ip,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
  const crudo = await res.text();
  const tipo = res.headers.get("content-type") ?? "";
  if (tipo.includes("application/json")) {
    let json = null;
    try { json = JSON.parse(crudo); } catch { /* vacío */ }
    return { status: res.status, json, texto: "", error: null, partes: [], res, crudo };
  }
  const partes = [];
  let texto = "";
  let error = null;
  for (const linea of crudo.split("\n")) {
    const sep = linea.indexOf(":");
    if (sep <= 0) continue;
    const clave = linea.slice(0, sep);
    const valor = JSON.parse(linea.slice(sep + 1));
    partes.push({ clave, valor });
    if (clave === "0") texto += valor;
    if (clave === "3") error = valor;
  }
  return { status: res.status, json: null, texto, error, partes, res, crudo };
}

// ─── Doble de IA ──────────────────────────────────────────────────────────────

/** Inyecta una falla en la próxima petición de ese tipo (ver mock-anthropic.mjs). */
export async function fallaMock(tipo, modo) {
  const r = await fetch(`${MOCK}/__fallas`, { method: "POST", body: JSON.stringify({ tipo, modo, veces: 1 }) });
  assert.equal(r.status, 200);
}

export async function limpiarFallasMock() {
  await fetch(`${MOCK}/__fallas`, { method: "DELETE" }).catch(() => {});
}

/** Últimas `n` peticiones que recibió el doble (prompt de sistema y mensajes). */
export async function peticionesMock(n = 5) {
  return (await fetch(`${MOCK}/__peticiones?n=${n}`)).json();
}

/** La última petición de un tipo ("receta", "rutina", "tips", "imagen", …). */
export async function ultimaPeticionMock(tipo) {
  const lista = await peticionesMock(50);
  return [...lista].reverse().find((p) => p.tipo === tipo);
}

// ─── Base descartable (admin) ─────────────────────────────────────────────────

let pool = null;
export function admin() {
  if (!ADMIN) return null;
  pool ??= new pg.Pool({ connectionString: ADMIN, max: 2 });
  return pool;
}

/** uid detrás de un token, leyendo la base con el dueño. */
export async function uidDe(token) {
  const { rows } = await admin().query("select uid from sesiones where token_hash = $1", [hashToken(token)]);
  return rows[0]?.uid;
}

/** Vacía los contadores de una IP de prueba (para que un caso de límite empiece de cero). */
export async function limpiarLimitesDe(sujeto) {
  await admin()?.query("delete from limites_tasa where clave like $1", [`%:${sujeto}`]);
}

/** Tokens creados en esta corrida: se borran al final sin gastar el límite de supresiones. */
const creados = [];

/** Anota un token creado fuera de `nuevoToken` para borrarlo al final. */
export function registrar(token) {
  if (token) creados.push(token);
  return token;
}

export async function limpiarIdentidades() {
  const db = admin();
  if (db) {
    for (const t of creados.splice(0)) {
      await db.query("select pulso_eliminar_datos($1)", [hashToken(t)]).catch(() => {});
    }
  }
  await pool?.end();
  pool = null;
}

// ─── Datos ────────────────────────────────────────────────────────────────────

/** Valor de una métrica válido para cada tipo de la app. */
export const METRICA_OK = { frecuencia_cardiaca: 72, peso: 80.5, horas_sueno: 7.5, nivel_estres: 4 };

/** Rangos de `validacion.ts` (los mismos que el formulario de la app). */
export const RANGOS = {
  frecuencia_cardiaca: { min: 30, max: 220, unidad: "bpm" },
  peso: { min: 20, max: 300, unidad: "kg" },
  horas_sueno: { min: 0, max: 24, unidad: "h" },
  nivel_estres: { min: 1, max: 10, unidad: "/10" },
};

export const RESPUESTAS_RUTINA = {
  nivel: "Activo (ejercicio 2-3 veces por semana)",
  tiempo: "30",
  lugar: "Al aire libre",
  limitacion: "Ninguna limitación",
};

/** `YYYY-MM-DD` de hoy en la zona del proceso (la misma que el servidor local). */
export function hoy(desplazamientoDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + desplazamientoDias);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** El regex de ejercicios de la app (`RutinasParser.kt`) y de la web (`parsearEjercicios`). */
export const RE_EJERCICIO = /^\d+\.\s+\*\*(.+?)\*\*\s*\|\s*(.+?)\s*\|\s*Descanso:\s*(\d+)/i;
