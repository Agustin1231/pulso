// Pruebas del área de sesión del Proyecto Integrador: puntos 1 (persistencia
// de la autenticación), 10 (vencimiento del token), 11 (inactividad de la
// sesión), 16 (aviso del motivo) y 18 (cierre visto desde otra pestaña).
// Ver docs/integrador/sesion.md.
//
//   BASE_URL=http://127.0.0.1:3203 \
//   DATABASE_ADMIN_URL=postgres://postgres:…@127.0.0.1:55443/pulso \
//   MAILPIT_URL=http://127.0.0.1:18023 \
//     node --test --test-concurrency=1 tests/integrador/sesion.test.mjs
//
// Corren SIEMPRE contra un servidor y una base descartables: crean cuentas
// reales (registro → enlace en Mailpit → activación), cambian los dos tiempos
// de `configuracion` (y los dejan como estaban) y mueven fechas de `sesiones`
// con el dueño de la base para simular el paso del tiempo. Un solo caso espera
// el minuto de verdad. Sin las variables o sin servidor, se saltean.

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3203").replace(/\/+$/, "");
const ADMIN = process.env.DATABASE_ADMIN_URL;
const MAILPIT = (process.env.MAILPIT_URL ?? "").replace(/\/+$/, "");

if (/agustinynatalia\.site/.test(BASE) || /agustinynatalia\.site|:5433\//.test(ADMIN ?? "")) {
  throw new Error("Estas pruebas cambian la configuración y crean cuentas: no se corren contra producción.");
}

async function responde(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(5000) })).ok;
  } catch {
    return false;
  }
}

const SALTEAR = !(await responde(`${BASE}/api/sesion`))
  ? `el servidor no responde en ${BASE}`
  : !ADMIN ? "falta DATABASE_ADMIN_URL (base descartable)"
  : !MAILPIT ? "falta MAILPIT_URL"
  : !(await responde(`${MAILPIT}/api/v1/messages?limit=1`)) ? `Mailpit no responde en ${MAILPIT}`
  : false;

// ─── Ayudas ───────────────────────────────────────────────────────────────────

let db = null;
const creados = new Set();
let configOriginal = null;

const hashDe = (token) => createHash("sha256").update(token).digest("hex");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** IP de documentación (RFC 3849) nueva: cada caso con su cupo de los límites por IP. */
function nuevaIp() {
  const h = () => randomBytes(2).toString("hex");
  return `2001:db8:${h()}:${h()}::${h()}`;
}

/** Petición con la sesión de un navegador (`cookie`) o de la app nativa (`bearer`). */
async function pedir(metodo, ruta, { cookie, bearer, cuerpo, ip = nuevaIp(), redirigir = false } = {}) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    redirect: redirigir ? "follow" : "manual",
    headers: {
      "X-Forwarded-For": ip,
      ...(cookie ? { Cookie: `pulso_sesion=${cookie}` } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* no es JSON */ }
  const setCookie = res.headers.getSetCookie().find((c) => /^(__Host-)?pulso_sesion=/.test(c)) ?? null;
  const nueva = setCookie?.match(/pulso_sesion=([A-Za-z0-9_-]{43})/)?.[1] ?? null;
  return { status: res.status, json, texto, res, setCookie, nueva };
}

/** Sesión web nueva (anónima): el token de la cookie. */
async function sesionWeb() {
  const r = await pedir("POST", "/api/sesion", { cuerpo: {} });
  assert.equal(r.status, 200, r.texto);
  assert.ok(r.nueva, "la sesión nueva tiene que poner la cookie");
  return r.nueva;
}

/** Sesión nueva de la app nativa (anónima): el token del cuerpo. */
async function sesionMovil() {
  const r = await pedir("POST", "/api/movil/v1/sesion");
  assert.equal(r.status, 200, r.texto);
  return r.json.token;
}

async function uidDe(token) {
  const { rows } = await db.query("select uid from sesiones where token_hash = $1", [hashDe(token)]);
  if (rows[0]) creados.add(rows[0].uid);
  return rows[0]?.uid;
}

async function fila(token) {
  const { rows } = await db.query("select * from sesiones where token_hash = $1", [hashDe(token)]);
  return rows[0];
}

const PASSWORD = "Clave-Segura#9x7Q";

/** Enlace de activación que llegó a Mailpit para `email` (el correo sale después de responder). */
async function tokenDelCorreo(email) {
  for (let i = 0; i < 40; i++) {
    const lista = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    const id = lista.messages?.[0]?.ID;
    if (id) {
      const m = await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
      const token = `${m.Text ?? ""} ${m.HTML ?? ""}`.match(/token=([A-Za-z0-9_-]{43})/)?.[1];
      if (token) return token;
    }
    await esperar(250);
  }
  throw new Error(`no llegó el correo de activación a ${email}`);
}

/**
 * Pone una cuenta activada sobre la identidad de la sesión, por el camino de
 * verdad: registro con esa sesión, enlace de Mailpit y activación.
 */
async function activarCuenta(sesion) {
  const email = `a3-${randomBytes(6).toString("hex")}@pulso.test`;
  const r = await pedir("POST", "/api/cuenta/registro", { ...sesion, cuerpo: { email, password: PASSWORD } });
  assert.equal(r.status, 200, `registro: ${r.texto}`);
  const token = await tokenDelCorreo(email);
  const a = await pedir("POST", "/api/cuenta/activar", { cuerpo: { token } });
  assert.equal(a.status, 200, `activar: ${a.texto}`);
  return email;
}

/** Navegador con una cuenta activada: el token de su cookie. */
async function cuentaWeb() {
  const cookie = await sesionWeb();
  const email = await activarCuenta({ cookie });
  await uidDe(cookie);
  return { cookie, email };
}

/** App nativa con una cuenta activada (registrada desde el teléfono): su Bearer. */
async function cuentaMovil() {
  const bearer = await sesionMovil();
  await activarCuenta({ bearer });
  await uidDe(bearer);
  return { bearer };
}

/** Una lectura de datos cualquiera: una petición "de fondo" (no es interacción del usuario). */
const datos = (sesion) => pedir("GET", "/api/movil/v1/metricas/ultimas", sesion);

async function fijarConfig({ token, sesion }) {
  if (token !== undefined) await db.query("update configuracion set valor = $1 where clave = 'token_inactividad_minutos'", [token]);
  if (sesion !== undefined) await db.query("update configuracion set valor = $1 where clave = 'sesion_inactividad_minutos'", [sesion]);
}

async function restaurarConfig() {
  for (const { clave, valor } of configOriginal ?? []) {
    await db.query("update configuracion set valor = $1 where clave = $2", [valor, clave]);
  }
}

/**
 * Mueve hacia atrás fechas de la sesión: simula que pasó el tiempo sin
 * peticiones (`uso`) o sin interacción del usuario (`actividad`). Activar la
 * cuenta cuenta como actividad, así que también se atrasa esa fecha (solo si
 * ya estaba activada).
 */
async function atrasar(token, { uso, actividad }) {
  if (uso !== undefined) {
    await db.query("update sesiones set ultimo_uso = now() - make_interval(secs => $2) where token_hash = $1", [hashDe(token), uso]);
  }
  if (actividad !== undefined) {
    await db.query("update sesiones set actividad_at = now() - make_interval(secs => $2) where token_hash = $1", [hashDe(token), actividad]);
    await db.query(
      `update cuentas set verificada_at = least(verificada_at, now() - make_interval(secs => $2))
        where uid = (select uid from sesiones where token_hash = $1) and verificada_at is not null`,
      [hashDe(token), actividad]
    );
  }
}

async function auditado(uid, accion, desde) {
  const { rows } = await db.query(
    "select detalle from auditoria where uid = $1 and accion = $2 and ocurrido_at >= $3 order by id desc limit 1",
    [uid, accion, desde]
  );
  return rows[0] ?? null;
}

const segundosDesde = (fecha) => (Date.now() - new Date(fecha).getTime()) / 1000;

before(async () => {
  if (SALTEAR) return;
  db = new pg.Pool({ connectionString: ADMIN, max: 2 });
  const { rows } = await db.query(
    "select clave, valor from configuracion where clave in ('token_inactividad_minutos', 'sesion_inactividad_minutos')"
  );
  configOriginal = rows;
});

after(async () => {
  if (!db) return;
  await restaurarConfig();
  if (creados.size) await db.query("delete from identidades where uid = any($1)", [[...creados]]);
  await db.end();
});

// ─── Punto 1 · Persistencia de la autenticación ───────────────────────────────

describe("punto 1: la sesión vive en una cookie httpOnly, nunca en la URL", { skip: SALTEAR }, () => {
  test("la cookie es HttpOnly, SameSite=Strict y Path=/; el token no va en el cuerpo ni en la URL", async () => {
    const r = await pedir("POST", "/api/sesion", { cuerpo: {} });
    assert.equal(r.status, 200);
    await uidDe(r.nueva);
    assert.match(r.setCookie, /HttpOnly/i);
    assert.match(r.setCookie, /SameSite=Strict/i);
    assert.match(r.setCookie, /Path=\//);
    assert.equal(r.res.headers.get("location"), null);
    assert.equal(r.json.token, undefined, "la web no recibe el token en el cuerpo");
    assert.equal(r.json.uid, undefined);
    assert.ok(!r.texto.includes(r.nueva), "el token no aparece en la respuesta");
  });

  test("la URL de una pantalla pegada en otro navegador (sin la cookie) lleva a /acceso", async () => {
    const { cookie } = await cuentaWeb();
    const conCuenta = await pedir("GET", "/dashboard", { cookie });
    assert.equal(conCuenta.status, 200, "con la sesión, la pantalla se sirve");

    for (const ruta of ["/dashboard", "/recetas", "/cuenta", "/privacidad"]) {
      const otro = await pedir("GET", ruta);
      assert.equal(otro.status, 307, `${ruta} sin cookie`);
      assert.match(otro.res.headers.get("location") ?? "", /\/acceso$/);
    }
    const inventada = await pedir("GET", "/dashboard", { cookie: "A".repeat(43) });
    assert.equal(inventada.status, 307, "una cookie inventada tampoco entra");

    const acceso = await pedir("GET", "/acceso");
    assert.equal(acceso.status, 200);
  });
});

// ─── Punto 10 · Vencimiento del token ─────────────────────────────────────────

describe("punto 10: el token vence por inactividad según la configuración", { skip: SALTEAR }, () => {
  after(restaurarConfig);

  test("los dos tiempos salen de `configuracion` en cada petición (sin caché)", async () => {
    await fijarConfig({ token: 7, sesion: 3 });
    const a = await pedir("GET", "/api/sesion");
    assert.deepEqual([a.json.config.tokenMinutos, a.json.config.sesionMinutos], [7, 3]);
    await fijarConfig({ token: 525600, sesion: 1440 });
    const b = await pedir("GET", "/api/sesion");
    assert.deepEqual([b.json.config.tokenMinutos, b.json.config.sesionMinutos], [525600, 1440], "rige en la petición siguiente");
  });

  test("con el token en 1 minuto, una sesión que pasa 1 minuto sin peticiones deja de servir", async () => {
    await fijarConfig({ token: 1, sesion: 30 });
    const { cookie } = await cuentaWeb();
    const uid = await uidDe(cookie);
    assert.equal((await datos({ cookie })).status, 200, "recién creada sirve");

    const desde = new Date();
    await atrasar(cookie, { uso: 61 });
    const r = await datos({ cookie });
    assert.equal(r.status, 401);
    assert.equal(r.json.error, "sesion_requerida");

    const s = await fila(cookie);
    assert.ok(new Date(s.expira_at) <= new Date(), "el vencimiento quedó escrito");
    assert.equal(s.revocada_at, null, "vencer no es revocar");
    const est = await pedir("GET", "/api/sesion", { cookie });
    assert.equal(est.json.estado, "sin_sesion");
    assert.equal(est.json.motivo, "vencida");
    const a = await auditado(uid, "sesion.vencer", desde);
    assert.ok(a, "queda en la auditoría");
    assert.equal(a.detalle.minutos, 1);
  });

  test("cada petición autenticada corre el vencimiento, con escrituras espaciadas; el sondeo no", async () => {
    await fijarConfig({ token: 1, sesion: 30 });
    const { cookie } = await cuentaWeb();
    await atrasar(cookie, { uso: 30 });

    await pedir("GET", "/api/sesion", { cookie });
    assert.ok(segundosDesde((await fila(cookie)).ultimo_uso) >= 29, "consultar el estado no es uso");

    assert.equal((await datos({ cookie })).status, 200);
    const s1 = await fila(cookie);
    assert.ok(segundosDesde(s1.ultimo_uso) < 3, "la lectura corrió el último uso");
    const restante = (new Date(s1.expira_at) - Date.now()) / 1000;
    assert.ok(restante > 55 && restante <= 60, `vence en 1 minuto desde ahora (${restante} s)`);

    await datos({ cookie });
    const s2 = await fila(cookie);
    assert.equal(s2.ultimo_uso.getTime(), s1.ultimo_uso.getTime(), "dos peticiones seguidas: una sola escritura");

    // Pasados 3 s (1/20 del minuto) sin escribir, la siguiente sí escribe.
    await atrasar(cookie, { uso: 4 });
    await datos({ cookie });
    assert.ok(segundosDesde((await fila(cookie)).ultimo_uso) < 2);
  });

  test("la creación, la rotación y el inicio de sesión usan el valor configurado", async () => {
    await fijarConfig({ token: 5 });
    const vence = (s) => (new Date(s.expira_at) - Date.now()) / 60_000;

    const anonima = await sesionWeb();
    await uidDe(anonima);
    assert.ok(Math.abs(vence(await fila(anonima)) - 5) < 0.2, "sesión nueva: 5 minutos");

    const { cookie, email } = await cuentaWeb();
    await db.query("update sesiones set created_at = now() - interval '2 days' where token_hash = $1", [hashDe(cookie)]);
    const rot = await pedir("POST", "/api/sesion", { cookie, cuerpo: {} });
    assert.equal(rot.json.origen, "rotada");
    const rotada = await fila(rot.nueva);
    assert.ok(Math.abs(vence(rotada) - 5) < 0.2, "token rotado: 5 minutos");
    assert.equal(rotada.cliente, "web");

    const login = await pedir("POST", "/api/cuenta/login", { cuerpo: { email, password: PASSWORD } });
    assert.equal(login.status, 200, login.texto);
    assert.ok(Math.abs(vence(await fila(login.nueva)) - 5) < 0.2, "inicio de sesión: 5 minutos");
  });

  test("la app nativa también: su token vence igual y la rotación conserva el tipo 'movil'", async () => {
    await fijarConfig({ token: 1 });
    const { bearer } = await cuentaMovil();
    assert.equal((await fila(bearer)).cliente, "movil");
    assert.equal((await datos({ bearer })).status, 200);
    await atrasar(bearer, { uso: 61 });
    assert.equal((await datos({ bearer })).status, 401);

    await fijarConfig({ token: 259200 });
    const otro = await cuentaMovil();
    await db.query("update sesiones set created_at = now() - interval '2 days' where token_hash = $1", [hashDe(otro.bearer)]);
    const rot = await pedir("POST", "/api/movil/v1/sesion", { bearer: otro.bearer });
    assert.equal(rot.json.origen, "rotada");
    assert.equal((await fila(rot.json.token)).cliente, "movil");
  });
});

// ─── Punto 11 · Inactividad del usuario ───────────────────────────────────────

describe("punto 11: la sesión web se cierra si el usuario no interactúa", { skip: SALTEAR }, () => {
  after(restaurarConfig);

  test("las peticiones de fondo no cuentan como actividad: pasado el límite, se rechaza y se revoca", async () => {
    await fijarConfig({ token: 259200, sesion: 1 });
    const { cookie } = await cuentaWeb();
    const uid = await uidDe(cookie);
    await atrasar(cookie, { actividad: 50 });

    assert.equal((await datos({ cookie })).status, 200, "a los 50 s todavía sirve");
    await pedir("GET", "/api/sesion", { cookie });
    assert.ok(segundosDesde((await fila(cookie)).actividad_at) >= 49, "ni la lectura ni el sondeo movieron la actividad");

    const desde = new Date();
    await atrasar(cookie, { actividad: 61 });
    const r = await datos({ cookie });
    assert.equal(r.status, 401);
    const s = await fila(cookie);
    assert.ok(s.revocada_at, "quedó revocada");
    assert.equal(s.revocada_motivo, "inactividad");
    const a = await auditado(uid, "sesion.revocar", desde);
    assert.equal(a?.detalle.motivo, "inactividad");
    const est = await pedir("GET", "/api/sesion", { cookie });
    assert.equal(est.json.motivo, "inactividad");
  });

  test("el latido sí renueva la actividad (con el `hace` del cliente, sin ir hacia atrás)", async () => {
    await fijarConfig({ token: 259200, sesion: 1 });
    const { cookie } = await cuentaWeb();
    await atrasar(cookie, { actividad: 50 });

    const l = await pedir("POST", "/api/sesion/latido", { cookie, cuerpo: { hace: 5 } });
    assert.equal(l.status, 200, l.texto);
    assert.equal(l.json.config.sesionMinutos, 1, "el latido trae la configuración vigente");
    const tras = segundosDesde((await fila(cookie)).actividad_at);
    assert.ok(tras >= 4 && tras < 8, `la actividad quedó hace ~5 s (${tras})`);
    assert.ok(l.json.config.inactivaSeg >= 4 && l.json.config.inactivaSeg <= 7);

    await pedir("POST", "/api/sesion/latido", { cookie, cuerpo: { hace: 3600 } });
    assert.ok(segundosDesde((await fila(cookie)).actividad_at) < 8, "un latido viejo no la atrasa");

    await atrasar(cookie, { actividad: 55 });
    await pedir("POST", "/api/sesion/latido", { cookie, cuerpo: { hace: 0 } });
    await atrasar(cookie, { uso: 0 });
    assert.equal((await datos({ cookie })).status, 200, "con latidos, la sesión sigue");
  });

  test("el latido valida su cuerpo y, con la sesión cerrada, responde 401 con el motivo", async () => {
    const { cookie } = await cuentaWeb();
    for (const cuerpo of [{}, { hace: -1 }, { hace: "5" }, { hace: 90_000 }]) {
      assert.equal((await pedir("POST", "/api/sesion/latido", { cookie, cuerpo })).status, 400, JSON.stringify(cuerpo));
    }
    await pedir("DELETE", "/api/sesion", { cookie });
    const r = await pedir("POST", "/api/sesion/latido", { cookie, cuerpo: { hace: 0 } });
    assert.equal(r.status, 401);
    assert.equal(r.json.motivo, "cierre");
  });

  test("la app nativa no tiene latido: la regla no se le aplica", async () => {
    await fijarConfig({ token: 259200, sesion: 1 });
    const { bearer } = await cuentaMovil();
    await atrasar(bearer, { actividad: 7200 });
    assert.equal((await datos({ bearer })).status, 200);
    assert.equal((await fila(bearer)).revocada_at, null);
  });

  test("una sesión sin cuenta no se cierra por inactividad (no tiene nada que proteger)", async () => {
    await fijarConfig({ sesion: 1 });
    const anonima = await sesionWeb();
    await uidDe(anonima);
    await atrasar(anonima, { actividad: 7200 });
    const est = await pedir("GET", "/api/sesion", { cookie: anonima });
    assert.equal(est.json.estado, "activa");
  });

  test("activar la cuenta desde el correo cuenta como actividad", async () => {
    await fijarConfig({ sesion: 1 });
    const cookie = await sesionWeb();
    const email = `a3-${randomBytes(6).toString("hex")}@pulso.test`;
    assert.equal((await pedir("POST", "/api/cuenta/registro", { cookie, cuerpo: { email, password: PASSWORD } })).status, 200);
    await uidDe(cookie);
    await atrasar(cookie, { actividad: 7200 });
    const token = await tokenDelCorreo(email);
    assert.equal((await pedir("POST", "/api/cuenta/activar", { cuerpo: { token } })).status, 200);
    assert.equal((await datos({ cookie })).status, 200, "la pestaña donde se registró entra sin volver a iniciar sesión");
  });

  test("cerrar el navegador y volver después: /api/sesion informa 'inactividad' y crea una sesión anónima", async () => {
    await fijarConfig({ sesion: 1 });
    const { cookie } = await cuentaWeb();
    await atrasar(cookie, { actividad: 120 });

    const app = await pedir("GET", "/dashboard", { cookie });
    assert.equal(app.status, 307, "la pantalla manda a /acceso");
    const r = await pedir("POST", "/api/sesion", { cookie, cuerpo: {} });
    assert.equal(r.json.motivo, "inactividad");
    assert.equal(r.json.origen, "nueva");
    assert.equal(r.json.cuenta, "ninguna");
    assert.ok(r.nueva && r.nueva !== cookie, "cookie nueva");
    await uidDe(r.nueva);
  });

  test("el vigía del cliente cierra con ?motivo=inactividad; cualquier otro motivo se rechaza", async () => {
    const { cookie } = await cuentaWeb();
    const uid = await uidDe(cookie);
    assert.equal((await pedir("DELETE", "/api/sesion?motivo=admin", { cookie })).status, 400, "el cliente no elige 'admin'");
    const desde = new Date();
    const r = await pedir("DELETE", "/api/sesion?motivo=inactividad", { cookie });
    assert.equal(r.status, 200);
    assert.match(r.setCookie ?? "", /Max-Age=0/, "borra la cookie");
    assert.equal((await fila(cookie)).revocada_motivo, "inactividad");
    assert.equal((await auditado(uid, "sesion.cerrar", desde))?.detalle.motivo, "inactividad");
  });
});

// ─── Puntos 16 y 18 · Motivo del cierre ───────────────────────────────────────

describe("puntos 16 y 18: el navegador que tenía la sesión se entera de por qué terminó", { skip: SALTEAR }, () => {
  test("cerrar sesión guarda 'cierre': la otra pestaña (la misma cookie) ya no entra y sabe por qué", async () => {
    const { cookie } = await cuentaWeb();
    assert.equal((await datos({ cookie })).status, 200);
    const del = await pedir("DELETE", "/api/sesion", { cookie });
    assert.equal(del.status, 200);
    assert.equal((await fila(cookie)).revocada_motivo, "cierre");

    const r = await datos({ cookie });
    assert.equal(r.status, 401);
    assert.equal(r.json.error, "sesion_requerida");
    const est = await pedir("GET", "/api/sesion", { cookie });
    assert.deepEqual([est.json.estado, est.json.motivo], ["sin_sesion", "cierre"]);
    assert.equal((await pedir("GET", "/recetas", { cookie })).status, 307, "navegar lleva a /acceso");
  });

  for (const motivo of ["otro_inicio", "contrasena", "admin"]) {
    test(`'${motivo}' (lo ponen cuentas y administración): GET lo informa y POST lo dice antes de crear la sesión nueva`, async () => {
      const { cookie } = await cuentaWeb();
      await db.query("update sesiones set revocada_at = now(), revocada_motivo = $2 where token_hash = $1", [hashDe(cookie), motivo]);
      const est = await pedir("GET", "/api/sesion", { cookie });
      assert.deepEqual([est.json.estado, est.json.motivo], ["sin_sesion", motivo]);
      const r = await pedir("POST", "/api/sesion", { cookie, cuerpo: {} });
      assert.equal(r.json.motivo, motivo);
      assert.equal(r.json.origen, "nueva");
      assert.ok(r.nueva && r.nueva !== cookie);
      await uidDe(r.nueva);
      const otra = await pedir("POST", "/api/sesion", { cookie: r.nueva, cuerpo: {} });
      assert.equal(otra.json.motivo, null, "se informa una sola vez: la sesión nueva no tiene motivo");
    });
  }

  test("sin motivo que contar: sesión sin cuenta, token inventado o sin cookie", async () => {
    const anonima = await sesionWeb();
    await uidDe(anonima);
    await pedir("DELETE", "/api/sesion", { cookie: anonima });
    assert.equal((await pedir("GET", "/api/sesion", { cookie: anonima })).json.motivo, null);
    assert.equal((await pedir("GET", "/api/sesion", { cookie: "B".repeat(43) })).json.motivo, null);
    assert.equal((await pedir("GET", "/api/sesion")).json.motivo, null);
  });

  test("la API de la app nativa usa las mismas acciones y no recibe la cookie de aviso de las server actions", async () => {
    const r = await pedir("POST", "/api/movil/v1/metricas", { bearer: "C".repeat(43), cuerpo: { tipo: "peso", valor: 70 } });
    assert.equal(r.status, 401);
    assert.equal(r.res.headers.getSetCookie().length, 0);
  });
});

// ─── En tiempo real ───────────────────────────────────────────────────────────

describe("en tiempo real: token e inactividad en 1 minuto", { skip: SALTEAR }, () => {
  after(restaurarConfig);

  test("pasado el minuto: sin peticiones vence el token; con peticiones de fondo y sin latido se cierra; con latido sigue", { timeout: 120_000 }, async () => {
    await fijarConfig({ token: 1, sesion: 1 });
    const fondo = await cuentaWeb();         // lecturas cada 15 s, sin latido
    const actividadFondo = Date.now();       // ~ su última actividad: la activación de la cuenta
    const quieta = await cuentaWeb();        // nada en todo el minuto
    const latiendo = await cuentaWeb();      // latido cada 15 s (el usuario interactúa)
    const movil = await cuentaMovil();       // la app nativa leyendo cada 15 s
    const movilQuieta = await cuentaMovil(); // la app nativa sin usar
    for (const s of [quieta, fondo, latiendo, movil, movilQuieta]) assert.equal((await datos(s)).status, 200);

    let cerradaPorInactividad = false;
    for (let i = 0; i < 5; i++) {
      await esperar(15_000);
      const r = await datos(fondo);
      const pasaron = (Date.now() - actividadFondo) / 1000;
      // Sin latido, las lecturas no la mantienen: sirve hasta el minuto desde
      // su última actividad (con 3 s de margen a cada lado del borde).
      if (pasaron < 57) assert.equal(r.status, 200, `lectura de fondo a los ${pasaron} s`);
      if (pasaron > 63) assert.equal(r.status, 401, `lectura de fondo a los ${pasaron} s`);
      if (r.status === 401) cerradaPorInactividad = true;
      assert.equal((await pedir("POST", "/api/sesion/latido", { ...latiendo, cuerpo: { hace: 1 } })).status, 200);
      assert.equal((await datos(movil)).status, 200);
    }
    assert.ok(cerradaPorInactividad);

    assert.equal((await datos(quieta)).status, 401);
    assert.equal((await pedir("GET", "/api/sesion", quieta)).json.motivo, "vencida");
    assert.equal((await pedir("GET", "/api/sesion", fondo)).json.motivo, "inactividad");
    assert.equal((await datos(latiendo)).status, 200, "con latidos el usuario sigue adentro");
    assert.equal((await datos(movil)).status, 200, "la app nativa en uso sigue adentro");
    assert.equal((await datos(movilQuieta)).status, 401, "el token de la app nativa sin usar venció");
  });
});
