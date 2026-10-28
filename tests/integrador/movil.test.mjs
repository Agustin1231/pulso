// Pruebas de lo que el servidor le da a la app nativa para las 20 pruebas del
// integrador (contratos C1–C4, ver docs/integrador/movil.md):
//   C1 · POST /api/movil/v1/cuenta/login: el login de la web, con el token en
//        el cuerpo en vez de la cookie, y la sesión marcada 'movil'.
//   C2 · POST /api/movil/v1/sesion: `motivo` (por qué dejó de servir el token
//        que mandó la app) y `cuenta` (la de la sesión que queda).
//   C3 · la inactividad de la sesión (punto 11) también para la app nativa,
//        con el mismo latido que la web.
//   C4 · las rutas que ya existían, llamadas como las llama la app: Bearer y
//        sin Origin (cuenta, sesión, exámenes y administración).
//
//   BASE_URL=http://127.0.0.1:3205 \
//   DATABASE_ADMIN_URL=postgres://postgres:…@127.0.0.1:55445/pulso \
//   MAILPIT_URL=http://127.0.0.1:18025 \
//     node --test --test-concurrency=1 tests/integrador/movil.test.mjs
//
// Corren SIEMPRE contra un servidor y una base descartables: crean cuentas
// reales (registro → enlace en Mailpit → activación), bloquean correos, le dan
// el rol Administrador a una cuenta de prueba, cambian los dos tiempos de
// `configuracion` (y los dejan como estaban) y mueven fechas de `sesiones` con
// el dueño de la base para simular el paso del tiempo. Sin las variables o sin
// servidor, se saltean. Nunca contra producción.

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";
import pg from "pg";

const BASE = (process.env.BASE_URL ?? "").replace(/\/+$/, "");
const ADMIN = process.env.DATABASE_ADMIN_URL;
const MAILPIT = (process.env.MAILPIT_URL ?? "").replace(/\/+$/, "");

if (/agustinynatalia\.site/.test(BASE) || /agustinynatalia\.site|:5433\//.test(ADMIN ?? "")) {
  throw new Error("Estas pruebas crean cuentas y cambian la configuración: no se corren contra producción.");
}

async function responde(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(5000) })).status < 500;
  } catch {
    return false;
  }
}

const SALTEAR = !BASE || !ADMIN || !MAILPIT
  ? "faltan BASE_URL, DATABASE_ADMIN_URL o MAILPIT_URL (entorno descartable)"
  : !(await responde(`${BASE}/api/sesion`)) ? `el servidor no responde en ${BASE}`
  : !(await responde(`${MAILPIT}/api/v1/messages?limit=1`)) ? `Mailpit no responde en ${MAILPIT}`
  : false;

const SCRIPT_ADMIN = fileURLToPath(new URL("../../scripts/asignar-admin.mjs", import.meta.url));

// ─── Ayudas ───────────────────────────────────────────────────────────────────

let db = null;
const creados = new Set();
let configOriginal = null;

const hashDe = (token) => createHash("sha256").update(token).digest("hex");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const h = () => randomBytes(2).toString("hex");
/** IP de documentación (RFC 3849) nueva: cada teléfono con su cupo de los límites por IP. */
const nuevaIp = () => `2001:db8:${h()}:${h()}::${h()}`;
const correoNuevo = (etiqueta) => `movil-${etiqueta}-${randomBytes(4).toString("hex")}@pulso.test`;

const PASSWORD = "Clave-Segura#9x7Q";
const OTRA = "Rio_Verde!58q";

/**
 * Petición como la hace la app nativa (OkHttp): token en `Authorization:
 * Bearer`, sin Origin y sin cookies. `cookie` es para simular un navegador.
 */
async function pedir(metodo, ruta, { bearer, cookie, cuerpo, ip = nuevaIp(), headers = {}, crudo } = {}) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    redirect: "manual",
    headers: {
      "X-Forwarded-For": ip,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(cookie ? { Cookie: `pulso_sesion=${cookie}` } : {}),
      ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: crudo ?? (cuerpo === undefined ? undefined : JSON.stringify(cuerpo)),
  });
  const texto = await res.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* no es JSON */ }
  const setCookie = res.headers.getSetCookie().find((c) => /^(__Host-)?pulso_sesion=/.test(c)) ?? null;
  const nueva = setCookie?.match(/pulso_sesion=([A-Za-z0-9_-]{43})/)?.[1] ?? null;
  return { status: res.status, json, texto, res, setCookie, nueva };
}

/**
 * Un teléfono con la app: su token (lo que guardaría el TokenStore) y su IP.
 * `abrir` es lo que hace la app al arrancar y al volver de segundo plano.
 */
class App {
  constructor() {
    this.token = null;
    this.ip = nuevaIp();
  }
  pedir(metodo, ruta, cuerpo, extra = {}) {
    return pedir(metodo, ruta, { bearer: this.token, ip: this.ip, cuerpo, ...extra });
  }
  async abrir() {
    const r = await this.pedir("POST", "/api/movil/v1/sesion");
    assert.equal(r.status, 200, `POST /api/movil/v1/sesion: ${r.texto}`);
    if (r.json.token) this.token = r.json.token;
    await uidDe(this.token);
    return r;
  }
  async login(email, password) {
    const r = await this.pedir("POST", "/api/movil/v1/cuenta/login", { email, password });
    if (r.status === 200) {
      this.token = r.json.token;
      await uidDe(this.token);
    }
    return r;
  }
  datos() {
    return this.pedir("GET", "/api/movil/v1/metricas/ultimas");
  }
}

async function uidDe(token) {
  if (!token) return null;
  const { rows } = await db.query("select uid from sesiones where token_hash = $1", [hashDe(token)]);
  if (rows[0]) creados.add(rows[0].uid);
  return rows[0]?.uid ?? null;
}

async function fila(token) {
  const { rows } = await db.query("select * from sesiones where token_hash = $1", [hashDe(token)]);
  return rows[0];
}

/** Texto del correo más nuevo para `para` cuyo asunto contiene `asunto` (espera a que llegue). */
async function correo(para, asunto, { ya = 0 } = {}) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${para}"`)}`);
    const lista = ((await r.json()).messages ?? []).filter((m) => m.Subject.includes(asunto));
    if (lista.length > ya) {
      const m = await (await fetch(`${MAILPIT}/api/v1/message/${lista[0].ID}`)).json();
      return `${m.Text ?? ""}`;
    }
    await esperar(250);
  }
  throw new Error(`no llegó el correo «${asunto}» a ${para}`);
}

const tokenDelEnlace = (texto) => texto.match(/token=([A-Za-z0-9_-]{43})/)?.[1];

/** Registro desde la app (sobre su sesión anónima), sin activar. */
async function registrada(etiqueta, password = PASSWORD) {
  const app = new App();
  await app.abrir();
  const email = correoNuevo(etiqueta);
  const r = await app.pedir("POST", "/api/cuenta/registro", { email, password });
  assert.equal(r.status, 200, `registro: ${r.texto}`);
  return { app, email, uid: await uidDe(app.token) };
}

/** Registro y activación desde la app, por el camino de verdad: el enlace llega a Mailpit. */
async function activada(etiqueta, password = PASSWORD) {
  const c = await registrada(etiqueta, password);
  const token = tokenDelEnlace(await correo(c.email, "Activa"));
  assert.ok(token, "el correo trae el enlace de activación");
  const a = await pedir("POST", "/api/cuenta/activar", { cuerpo: { token } });
  assert.equal(a.status, 200, `activar: ${a.texto}`);
  return c;
}

async function auditado(uid, accion, desde, resultado = null) {
  const { rows } = await db.query(
    `select resultado, detalle from auditoria
      where uid is not distinct from $1 and accion = $2 and ocurrido_at >= $3
        and ($4::text is null or resultado = $4)
      order by id desc limit 1`,
    [uid, accion, desde, resultado]
  );
  return rows[0] ?? null;
}

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
 * peticiones (`uso`) o sin que el usuario tocara la app (`actividad`; también
 * la activación de la cuenta, que cuenta como actividad).
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

const segundosDesde = (fecha) => (Date.now() - new Date(fecha).getTime()) / 1000;

before(async () => {
  if (SALTEAR) return;
  db = new pg.Pool({ connectionString: ADMIN, max: 2 });
  const { rows } = await db.query(
    "select clave, valor from configuracion where clave in ('token_inactividad_minutos', 'sesion_inactividad_minutos')"
  );
  configOriginal = rows;
  // Los tiempos por defecto: las pruebas que necesitan otros los fijan y los restauran.
  await fijarConfig({ token: 259200, sesion: 30 });
});

after(async () => {
  if (!db) return;
  await restaurarConfig();
  if (creados.size) await db.query("delete from identidades where uid = any($1)", [[...creados]]);
  await db.end();
});

// ─── C1 · Login de la app ─────────────────────────────────────────────────────

describe("C1: POST /api/movil/v1/cuenta/login", { skip: SALTEAR }, () => {
  test("entra: el token nuevo vuelve en el cuerpo y sin cookies, la sesión es 'movil' y el token anterior queda revocado", async () => {
    const a = await activada("c1"); // el teléfono donde se registró
    const telefono = new App();
    await telefono.abrir();
    const anterior = telefono.token;
    const anonimo = await uidDe(anterior);
    const desde = new Date();

    const r = await telefono.login(a.email, PASSWORD);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.ok, true);
    assert.match(r.json.token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(r.json.token, anterior);
    assert.equal(r.json.sesiones_cerradas, 1, "se cerró la del otro teléfono");
    assert.equal(r.res.headers.getSetCookie().length, 0, "la app no recibe cookies");

    const nueva = await fila(r.json.token);
    assert.equal(nueva.uid, a.uid, "la sesión nueva es de la cuenta");
    assert.equal(nueva.cliente, "movil");
    const { rows } = await db.query("select 1 from identidades where uid = $1", [anonimo]);
    assert.equal(rows.length, 0, "la identidad anónima del teléfono se sumó a la cuenta");
    assert.equal(await fila(anterior), undefined, "y su sesión se fue con ella: el token anterior no existe más");

    assert.equal((await telefono.datos()).status, 200, "con el token nuevo hay datos");
    assert.equal((await pedir("GET", "/api/movil/v1/metricas/ultimas", { bearer: anterior })).status, 401, "con el viejo, no");
    assert.deepEqual((await telefono.pedir("GET", "/api/cuenta")).json, { cuenta: { email: a.email, verificada: true } });

    const ev = await auditado(a.uid, "cuenta.login", desde, "ok");
    assert.equal(ev.detalle.cliente, "movil");
    assert.equal(ev.detalle.datos_sumados, true);
    assert.equal(ev.detalle.sesiones_cerradas, 1);
  });

  test("punto 16 entre clientes: entrar en el teléfono cierra el navegador y entrar en el navegador cierra el teléfono, con 'otro_inicio'", async () => {
    const a = await activada("c1-16");
    // El navegador entra: cierra la sesión del teléfono donde se registró.
    const web = await pedir("POST", "/api/cuenta/login", { cuerpo: { email: a.email, password: PASSWORD } });
    assert.equal(web.status, 200, web.texto);
    assert.equal(web.json.token, undefined, "la web no recibe el token en el cuerpo");
    assert.ok(web.nueva, "la web lo recibe en la cookie");
    assert.equal((await fila(web.nueva)).cliente, "web");
    assert.equal((await fila(a.app.token)).revocada_motivo, "otro_inicio");

    const abierta = await a.app.abrir();
    assert.equal(abierta.json.motivo, "otro_inicio", "la app se entera al volver a primer plano");
    assert.equal(abierta.json.cuenta, null);

    // Ahora el teléfono entra: cierra el navegador.
    const r = await a.app.login(a.email, PASSWORD);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.sesiones_cerradas, 1);
    const est = await pedir("GET", "/api/sesion", { cookie: web.nueva });
    assert.deepEqual([est.json.estado, est.json.motivo], ["sin_sesion", "otro_inicio"]);
  });

  test("sin Bearer también entra; una cookie no cuenta como la sesión del teléfono (ni se revoca ni se suma)", async () => {
    const a = await activada("c1-cookie");
    const navegador = await pedir("POST", "/api/sesion", { cuerpo: {} });
    const cookie = navegador.nueva;
    const uidNavegador = await uidDe(cookie);

    const r = await pedir("POST", "/api/movil/v1/cuenta/login", { cookie, cuerpo: { email: a.email, password: PASSWORD } });
    assert.equal(r.status, 200, r.texto);
    assert.match(r.json.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(r.setCookie, null, "no toca la cookie");
    assert.equal((await fila(cookie)).revocada_at, null, "la sesión del navegador sigue");
    const { rows } = await db.query("select 1 from identidades where uid = $1", [uidNavegador]);
    assert.equal(rows.length, 1, "y su identidad no se sumó a la cuenta");
  });

  test("punto 2: 15 caracteres especiales como correo → 400 datos_invalidos con `campos`, auditado con cliente 'movil'", async () => {
    const desde = new Date();
    const r = await pedir("POST", "/api/movil/v1/cuenta/login", { cuerpo: { email: "!#$%&/()=?¡*[]{", password: "x" } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json, { error: "datos_invalidos", campos: ["email"] });
    const ev = await auditado(null, "cuenta.login", desde, "denegado");
    assert.equal(ev.detalle.motivo, "datos_invalidos");
    assert.equal(ev.detalle.cliente, "movil");
    // La web, igual que antes: sin `campos` en la respuesta.
    const web = await pedir("POST", "/api/cuenta/login", { cuerpo: { email: "!#$%&/()=?¡*[]{", password: "x" } });
    assert.deepEqual(web.json, { error: "datos_invalidos" });
  });

  test("puntos 4 y 12: cada fallo dice cuántos intentos quedan; el 5.º bloquea 15 minutos (429 con Retry-After) y ni la correcta entra", async () => {
    const a = await activada("c1-bloqueo");
    const telefono = new App();
    await telefono.abrir();
    const desde = new Date();
    for (const [i, mala] of ["123456789012345", "mala-1", "mala-2", "mala-3"].entries()) {
      const r = await telefono.login(a.email, mala);
      assert.equal(r.status, 401, r.texto);
      assert.deepEqual(r.json, { error: "credenciales_invalidas", intentos_restantes: 4 - i });
    }
    const quinto = await telefono.login(a.email, "mala-4");
    assert.equal(quinto.status, 429);
    assert.deepEqual(quinto.json, { error: "cuenta_bloqueada", minutos: 15 });
    assert.equal(quinto.res.headers.get("retry-after"), "900");
    const correcta = await telefono.login(a.email, PASSWORD);
    assert.equal(correcta.status, 429, "bloqueada, ni la correcta entra");
    assert.equal(correcta.json.error, "cuenta_bloqueada");
    assert.ok(correcta.json.minutos >= 14 && correcta.json.minutos <= 15);

    const ev = await auditado(a.uid, "cuenta.login", desde, "denegado");
    assert.equal(ev.detalle.cliente, "movil");
    assert.equal(ev.detalle.bloqueada, true);
    await correo(a.email, "Bloqueamos");
  });

  test("una cuenta sin activar → 403 cuenta_sin_activar", async () => {
    const c = await registrada("c1-sin-activar");
    const r = await new App().login(c.email, PASSWORD);
    assert.equal(r.status, 403);
    assert.deepEqual(r.json, { error: "cuenta_sin_activar" });
  });

  test("límite por correo: la 11.ª petición de la hora es 429 demasiadas_peticiones, exista o no la cuenta", async () => {
    const email = correoNuevo("c1-limite");
    const telefono = new App();
    for (let i = 0; i < 10; i++) {
      const r = await telefono.login(email, `mala-${i}`);
      assert.ok([401, 429].includes(r.status), r.texto);
      if (r.status === 429) assert.equal(r.json.error, "cuenta_bloqueada");
    }
    const r = await telefono.login(email, "mala-final");
    assert.equal(r.status, 429);
    assert.deepEqual(r.json, { error: "demasiadas_peticiones" });
  });

  test("con el Origin de otro sitio, 403 (la app no manda Origin)", async () => {
    const r = await pedir("POST", "/api/movil/v1/cuenta/login", {
      cuerpo: { email: correoNuevo("c1-origen"), password: "x" }, headers: { Origin: "https://evil.example" },
    });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, "origen_no_permitido");
  });
});

// ─── C2 · Motivo y cuenta al abrir la app ─────────────────────────────────────

describe("C2: POST /api/movil/v1/sesion trae `motivo` y `cuenta`", { skip: SALTEAR }, () => {
  after(restaurarConfig);

  test("anónima, registrada sin activar y activada: `cuenta` dice a qué pantalla ir", async () => {
    const app = new App();
    const nueva = await app.abrir();
    assert.deepEqual([nueva.json.origen, nueva.json.motivo, nueva.json.cuenta], ["nueva", null, null]);
    assert.deepEqual(nueva.json.bloqueo, { activo: false, bloqueada: false });

    const email = correoNuevo("c2");
    assert.equal((await app.pedir("POST", "/api/cuenta/registro", { email, password: PASSWORD })).status, 200);
    const pendiente = await app.abrir();
    assert.equal(pendiente.json.origen, "existente");
    assert.deepEqual(pendiente.json.cuenta, { email, verificada: false });

    const token = tokenDelEnlace(await correo(email, "Activa"));
    assert.equal((await pedir("POST", "/api/cuenta/activar", { cuerpo: { token } })).status, 200);
    const lista = await app.abrir();
    assert.deepEqual(lista.json.cuenta, { email, verificada: true });
    assert.equal(lista.json.motivo, null);
    assert.ok(!("uid" in lista.json), "el uid no se devuelve");
  });

  test("con un token rotado, la cuenta es la del token nuevo", async () => {
    const a = await activada("c2-rota");
    await db.query("update sesiones set created_at = now() - interval '2 days' where token_hash = $1", [hashDe(a.app.token)]);
    const viejo = a.app.token;
    const r = await a.app.abrir();
    assert.equal(r.json.origen, "rotada");
    assert.notEqual(r.json.token, viejo);
    assert.deepEqual(r.json.cuenta, { email: a.email, verificada: true });
    assert.equal((await fila(r.json.token)).cliente, "movil");
  });

  const motivos = {
    cierre:      async (a) => assert.equal((await a.app.pedir("DELETE", "/api/sesion")).status, 200),
    otro_inicio: async (a) => assert.equal((await pedir("POST", "/api/cuenta/login", { cuerpo: { email: a.email, password: PASSWORD } })).status, 200),
    inactividad: async (a) => { await fijarConfig({ sesion: 1 }); await atrasar(a.app.token, { actividad: 61 }); },
    vencida:     async (a) => { await fijarConfig({ token: 1 }); await atrasar(a.app.token, { uso: 61 }); },
    contrasena:  async (a) => {
      // El usuario cambia la contraseña desde el navegador: cierra las demás sesiones.
      const web = await pedir("POST", "/api/cuenta/login", { cuerpo: { email: a.email, password: PASSWORD } });
      await db.query("update sesiones set revocada_at = null, revocada_motivo = null where token_hash = $1", [hashDe(a.app.token)]);
      const r = await pedir("POST", "/api/cuenta/contrasena", { cookie: web.nueva, cuerpo: { actual: PASSWORD, nueva: OTRA } });
      assert.equal(r.status, 200, r.texto);
    },
    admin:       async (a) => {
      await db.query("update sesiones set revocada_at = now(), revocada_motivo = 'admin' where token_hash = $1", [hashDe(a.app.token)]);
    },
  };

  for (const [motivo, provocar] of Object.entries(motivos)) {
    test(`'${motivo}': la app se entera al abrir, con una sesión anónima nueva, una sola vez`, async () => {
      const a = await activada(`c2-${motivo}`);
      const anterior = a.app.token;
      await provocar(a);
      const desde = new Date();
      const r = await a.app.abrir();
      await restaurarConfig();
      assert.equal(r.json.motivo, motivo);
      assert.equal(r.json.origen, "nueva");
      assert.equal(r.json.cuenta, null);
      assert.ok(r.json.token && r.json.token !== anterior, "token nuevo (anónimo)");
      const ev = await auditado(await uidDe(r.json.token), "sesion.crear", desde);
      assert.deepEqual(ev.detalle, { cliente: "movil", anterior: motivo });

      const otra = await a.app.abrir();
      assert.equal(otra.json.motivo, null, "con la sesión nueva ya no hay motivo");
      assert.equal(otra.json.origen, "existente");
    });
  }

  test("sin motivo que contar: token inventado o sesión anónima cerrada", async () => {
    const inventado = await pedir("POST", "/api/movil/v1/sesion", { bearer: "Z".repeat(43) });
    assert.deepEqual([inventado.json.origen, inventado.json.motivo], ["nueva", null]);
    await uidDe(inventado.json.token);

    const app = new App();
    await app.abrir();
    await app.pedir("DELETE", "/api/movil/v1/sesion");
    assert.equal((await app.abrir()).json.motivo, null);
  });

  test("GET /api/movil/v1/sesion también dice el motivo, sin crear nada", async () => {
    const a = await activada("c2-get");
    await a.app.pedir("DELETE", "/api/sesion");
    const r = await a.app.pedir("GET", "/api/movil/v1/sesion");
    assert.deepEqual([r.json.estado, r.json.motivo], ["sin_sesion", "cierre"]);
    assert.equal(r.json.token, undefined);
  });
});

// ─── C3 · Inactividad en la app nativa ────────────────────────────────────────

describe("C3: la inactividad de la sesión (punto 11) también cierra la app nativa", { skip: SALTEAR }, () => {
  after(restaurarConfig);

  test("sin latido, las lecturas de fondo no la mantienen: pasado el límite se rechaza, se revoca con 'inactividad' y se audita", async () => {
    await fijarConfig({ token: 259200, sesion: 1 });
    const a = await activada("c3");
    await atrasar(a.app.token, { actividad: 50 });
    assert.equal((await a.app.datos()).status, 200, "a los 50 s todavía sirve");
    assert.ok(segundosDesde((await fila(a.app.token)).actividad_at) >= 49, "la lectura no movió la actividad");

    const desde = new Date();
    await atrasar(a.app.token, { actividad: 61 });
    const r = await a.app.datos();
    assert.equal(r.status, 401);
    assert.equal(r.json.error, "sesion_requerida");
    const s = await fila(a.app.token);
    assert.equal(s.revocada_motivo, "inactividad");
    const ev = await auditado(a.uid, "sesion.revocar", desde);
    assert.deepEqual([ev.detalle.motivo, ev.detalle.cliente, ev.detalle.minutos], ["inactividad", "movil", 1]);

    const est = await a.app.pedir("GET", "/api/sesion");
    assert.deepEqual([est.json.estado, est.json.motivo], ["sin_sesion", "inactividad"]);
    const latido = await a.app.pedir("POST", "/api/sesion/latido", { hace: 0 });
    assert.equal(latido.status, 401);
    assert.deepEqual([latido.json.error, latido.json.motivo], ["sesion_requerida", "inactividad"]);
  });

  test("el latido de la app (Bearer) mueve la actividad; GET /api/sesion le da los segundos y los tiempos vigentes", async () => {
    await fijarConfig({ token: 259200, sesion: 1 });
    const a = await activada("c3-latido");
    await atrasar(a.app.token, { actividad: 50 });

    const antes = await a.app.pedir("GET", "/api/sesion");
    assert.equal(antes.json.estado, "activa");
    assert.equal(antes.json.cuenta, "activa");
    assert.equal(antes.json.config.sesionMinutos, 1);
    assert.ok(antes.json.config.inactivaSeg >= 49 && antes.json.config.inactivaSeg <= 52, "la app nativa ya no recibe null");

    const l = await a.app.pedir("POST", "/api/sesion/latido", { hace: 5 });
    assert.equal(l.status, 200, l.texto);
    assert.ok(l.json.config.inactivaSeg >= 4 && l.json.config.inactivaSeg <= 7);
    const tras = segundosDesde((await fila(a.app.token)).actividad_at);
    assert.ok(tras >= 4 && tras < 8, `la actividad quedó hace ~5 s (${tras})`);

    await atrasar(a.app.token, { actividad: 55 });
    await a.app.pedir("POST", "/api/sesion/latido", { hace: 0 });
    await atrasar(a.app.token, { uso: 0 });
    assert.equal((await a.app.datos()).status, 200, "con latidos, la sesión sigue");
  });

  test("abrir la app o volver a ella (POST /api/movil/v1/sesion) cuenta como actividad", async () => {
    await fijarConfig({ token: 259200, sesion: 1 });
    const a = await activada("c3-abrir");
    await atrasar(a.app.token, { actividad: 50 });
    const r = await a.app.abrir();
    assert.equal(r.json.origen, "existente");
    assert.ok(segundosDesde((await fila(a.app.token)).actividad_at) < 3);
  });

  test("volver después del límite: la app se entera con 'inactividad' y queda sin cuenta", async () => {
    await fijarConfig({ token: 259200, sesion: 1 });
    const a = await activada("c3-volver");
    await atrasar(a.app.token, { actividad: 120 });
    const r = await a.app.abrir();
    assert.deepEqual([r.json.origen, r.json.motivo, r.json.cuenta], ["nueva", "inactividad", null]);
  });

  test("el vigía de la app cierra con ?motivo=inactividad (por las dos rutas); otro motivo, 400", async () => {
    const a = await activada("c3-vigia");
    assert.equal((await a.app.pedir("DELETE", "/api/movil/v1/sesion?motivo=admin")).status, 400, "el cliente no elige 'admin'");
    assert.equal((await a.app.pedir("DELETE", "/api/sesion?motivo=otro_inicio")).status, 400);
    const desde = new Date();
    const r = await a.app.pedir("DELETE", "/api/movil/v1/sesion?motivo=inactividad");
    assert.equal(r.status, 200);
    assert.equal((await fila(a.app.token)).revocada_motivo, "inactividad");
    const ev = await auditado(a.uid, "sesion.cerrar", desde);
    assert.deepEqual(ev.detalle, { cliente: "movil", motivo: "inactividad" });

    const b = await activada("c3-vigia-b");
    assert.equal((await b.app.pedir("DELETE", "/api/sesion?motivo=inactividad")).status, 200);
    assert.equal((await fila(b.app.token)).revocada_motivo, "inactividad");
  });

  test("una sesión anónima de la app no se cierra por inactividad (no tiene nada que proteger)", async () => {
    await fijarConfig({ sesion: 1 });
    const app = new App();
    await app.abrir();
    await atrasar(app.token, { actividad: 7200 });
    assert.equal((await app.pedir("GET", "/api/sesion")).json.estado, "activa");
    assert.equal((await app.pedir("GET", "/api/sesion")).json.config.inactivaSeg, null);
  });
});

// ─── C4 · Las rutas de siempre, con la sesión de la app ──────────────────────

/** PDF mínimo válido (xref correcta), como los de tests/integrador/examenes.test.mjs. */
function pdfSimple() {
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    (() => {
      const datos = deflateSync(Buffer.from("BT /F1 24 Tf 72 700 Td (Hemograma) Tj ET"));
      return Buffer.concat([Buffer.from(`<< /Filter /FlateDecode /Length ${datos.length} >>\nstream\n`, "latin1"), datos, Buffer.from("\nendstream", "latin1")]);
    })(),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const partes = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [];
  let pos = partes[0].length;
  objetos.forEach((cuerpo, i) => {
    offsets.push(pos);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo, "latin1"), Buffer.from("\nendobj\n")]);
    partes.push(b);
    pos += b.length;
  });
  let xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  partes.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(partes);
}

/** Un .exe de Windows (MZ + PE): el del punto 15, renombrado a .pdf. */
const EXE = Buffer.concat([
  Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff", "latin1"),
  Buffer.alloc(46),
  Buffer.from([0x80, 0, 0, 0]),
  Buffer.from("\x0e\x1f\xba\x0e\x00\xb4\x09\xcd\x21\xb8\x01\x4c\xcd\x21This program cannot be run in DOS mode.\r\r\n$", "latin1"),
  Buffer.alloc(40),
  Buffer.from("PE\x00\x00\x4c\x01", "latin1"),
  randomBytes(1024),
]);

describe("C4: las rutas existentes funcionan con la sesión de la app (Bearer, sin Origin)", { skip: SALTEAR }, () => {
  test("cuenta: registro → activar → login de la app → sesión, latido, /api/cuenta, reenviar, contraseña y correo del perfil, cerrar sesión", async () => {
    const telefono = new App();
    await telefono.abrir();
    const email = correoNuevo("c4");
    const reg = await telefono.pedir("POST", "/api/cuenta/registro", { email, password: PASSWORD });
    assert.equal(reg.status, 200, reg.texto);
    assert.deepEqual((await telefono.pedir("GET", "/api/cuenta")).json, { cuenta: { email, verificada: false } });
    assert.equal((await telefono.datos()).status, 401, "sin activar no hay datos");
    assert.equal((await telefono.datos()).json.error, "cuenta_requerida");

    const reenviar = await telefono.pedir("POST", "/api/cuenta/reenviar");
    assert.equal(reenviar.status, 200, reenviar.texto);
    const enlace = tokenDelEnlace(await correo(email, "Activa", { ya: 1 }));
    assert.equal((await pedir("POST", "/api/cuenta/activar", { cuerpo: { token: enlace } })).status, 200);
    assert.equal((await telefono.pedir("POST", "/api/cuenta/reenviar")).status, 409, "ya está activada");

    // Otro teléfono entra con la cuenta (es la sesión que va a usar la app de verdad).
    const app = new App();
    await app.abrir();
    const login = await app.login(email, PASSWORD);
    assert.equal(login.status, 200, login.texto);

    const sesion = await app.pedir("GET", "/api/sesion");
    assert.deepEqual([sesion.json.estado, sesion.json.cuenta, sesion.json.motivo], ["activa", "activa", null]);
    assert.deepEqual(Object.keys(sesion.json.config).sort(), ["inactivaSeg", "sesionMinutos", "tokenMinutos"]);
    assert.equal((await app.pedir("POST", "/api/sesion/latido", { hace: 2 })).status, 200);
    assert.deepEqual((await app.pedir("GET", "/api/cuenta")).json, { cuenta: { email, verificada: true } });

    // Punto 20: contraseña desde el perfil (con la regla y los intentos).
    const corta = await app.pedir("POST", "/api/cuenta/contrasena", { actual: PASSWORD, nueva: "a" });
    assert.equal(corta.status, 400);
    assert.equal(corta.json.error, "contrasena_invalida");
    assert.ok(Array.isArray(corta.json.reglas) && corta.json.reglas.length > 0);
    const mala = await app.pedir("POST", "/api/cuenta/contrasena", { actual: "no-es", nueva: OTRA });
    assert.deepEqual([mala.status, mala.json.error, mala.json.intentos_restantes], [400, "contrasena_actual_incorrecta", 4]);
    const cambio = await app.pedir("POST", "/api/cuenta/contrasena", { actual: PASSWORD, nueva: OTRA });
    assert.equal(cambio.status, 200, cambio.texto);
    assert.equal((await app.datos()).status, 200, "la sesión de este teléfono sigue");
    await correo(email, "Cambiaste la contraseña");

    // Punto 20: correo desde el perfil (sigue el viejo hasta confirmar).
    const nuevo = correoNuevo("c4-nuevo");
    const pedido = await app.pedir("POST", "/api/cuenta/correo", { email: nuevo, password: OTRA });
    assert.equal(pedido.status, 200, pedido.texto);
    assert.equal((await app.pedir("GET", "/api/cuenta")).json.cuenta.email, email, "hasta confirmar, el de antes");
    const confirmar = tokenDelEnlace(await correo(nuevo, "Confirma"));
    assert.equal((await pedir("POST", "/api/cuenta/confirmar-correo", { cuerpo: { token: confirmar } })).status, 200);
    assert.equal((await app.pedir("GET", "/api/cuenta")).json.cuenta.email, nuevo);

    // Cerrar sesión: el token deja de servir y la app lo sabe.
    assert.equal((await app.pedir("DELETE", "/api/sesion")).status, 200);
    assert.equal((await app.datos()).status, 401);
    assert.equal((await app.pedir("GET", "/api/sesion")).json.motivo, "cierre");
  });

  test("punto 3: recuperar desde la app; el enlace del correo se usa sin sesión y la app se entera con 'contrasena'", async () => {
    const a = await activada("c4-recuperar");
    const r = await a.app.pedir("POST", "/api/cuenta/recuperar", { email: a.email });
    assert.deepEqual([r.status, r.json], [200, { ok: true }]);
    const inexistente = await a.app.pedir("POST", "/api/cuenta/recuperar", { email: correoNuevo("nadie") });
    assert.deepEqual([inexistente.status, inexistente.json], [200, { ok: true }], "misma respuesta si no existe");

    const token = tokenDelEnlace(await correo(a.email, "Restablece"));
    const pagina = await pedir("GET", `/acceso/restablecer?token=${token}`);
    assert.equal(pagina.status, 200, "la página pública se abre en el navegador del teléfono sin sesión");
    const rest = await pedir("POST", "/api/cuenta/restablecer", { cuerpo: { token, password: OTRA } });
    assert.equal(rest.status, 200, rest.texto);

    const abierta = await a.app.abrir();
    assert.equal(abierta.json.motivo, "contrasena");
    assert.equal((await a.app.login(a.email, PASSWORD)).status, 401, "la vieja ya no sirve");
    assert.equal((await a.app.login(a.email, OTRA)).status, 200, "con la nueva entra");
  });

  test("punto 15: exámenes con el Bearer: subir un PDF, listarlo, abrirlo y borrarlo; un .exe renombrado a .pdf se rechaza", async () => {
    const a = await activada("c4-examenes");
    const subir = (nombre, bytes, tipo) => a.app.pedir("POST", "/api/examenes", undefined, {
      crudo: bytes, headers: { "Content-Type": tipo, "X-Nombre-Archivo": encodeURIComponent(nombre) },
    });
    const pdf = pdfSimple();
    const ok = await subir("hemograma.pdf", pdf, "application/pdf");
    assert.equal(ok.status, 201, ok.texto);
    const id = ok.json.examen.id;

    const exe = await subir("resultados.pdf", EXE, "application/pdf");
    assert.equal(exe.status, 415);
    assert.equal(exe.json.error, "archivo_ejecutable");
    assert.ok(exe.json.mensaje);

    const lista = await a.app.pedir("GET", "/api/examenes");
    assert.equal(lista.status, 200);
    assert.deepEqual(lista.json.examenes.map((e) => [e.id, e.nombre, e.tipo]), [[id, "hemograma.pdf", "pdf"]]);
    assert.equal(lista.json.cuota.examenes, 1);

    const ver = await a.app.pedir("GET", `/api/examenes/${id}`);
    assert.equal(ver.status, 200);
    assert.match(ver.res.headers.get("content-type") ?? "", /application\/pdf/);
    assert.equal(ver.texto.length > 0, true);

    assert.equal((await pedir("GET", `/api/examenes/${id}`)).status, 401, "sin el token, nada");
    const otro = await activada("c4-examenes-otro");
    assert.equal((await otro.app.pedir("GET", `/api/examenes/${id}`)).status, 404, "otra cuenta no lo ve");

    assert.equal((await a.app.pedir("DELETE", `/api/examenes/${id}`)).status, 200);
    assert.equal((await a.app.pedir("GET", "/api/examenes")).json.examenes.length, 0);
  });

  test("administración: con el rol Administrador, todas las rutas de /api/admin responden a la app", async () => {
    const admin = await activada("c4-admin");
    const usuario = await activada("c4-usuario");
    assert.equal((await admin.app.pedir("GET", "/api/admin/usuarios")).status, 403, "sin el rol, 403");
    assert.deepEqual((await admin.app.pedir("GET", "/api/admin/permisos")).json, { permisos: [] });

    await promisify(execFile)(process.execPath, ["--experimental-strip-types", SCRIPT_ADMIN, admin.email], {
      env: { ...process.env, DATABASE_ADMIN_URL: ADMIN },
    });

    const permisos = await admin.app.pedir("GET", "/api/admin/permisos");
    assert.equal(permisos.status, 200);
    assert.ok(permisos.json.permisos.includes("usuarios.editar"));

    const usuarios = await admin.app.pedir("GET", "/api/admin/usuarios");
    assert.equal(usuarios.status, 200, usuarios.texto);
    assert.ok(usuarios.json.usuarios.some((u) => u.uid === usuario.uid));

    const rol = await admin.app.pedir("POST", "/api/admin/roles", {
      nombre: `Soporte móvil ${h()}`, descripcion: "Creado desde la app", permisos: ["usuarios.ver", "auditoria.ver"],
    });
    assert.equal(rol.status, 200, rol.texto);
    const idRol = rol.json.rol.id;
    const editado = await admin.app.pedir("PUT", `/api/admin/roles/${idRol}`, {
      nombre: rol.json.rol.nombre, descripcion: "Editado desde la app", permisos: ["usuarios.ver"],
    });
    assert.equal(editado.status, 200, editado.texto);
    assert.equal((await admin.app.pedir("GET", "/api/admin/roles")).status, 200);

    const acceso = await admin.app.pedir("PUT", `/api/admin/usuarios/${usuario.uid}/acceso`, { roles: [idRol], permisos: ["errores.ver"] });
    assert.equal(acceso.status, 200, acceso.texto);
    assert.deepEqual(acceso.json.usuario.efectivos.map((e) => e.permiso), ["errores.ver", "usuarios.ver"]);

    const corta = await admin.app.pedir("POST", `/api/admin/usuarios/${usuario.uid}/contrasena`, { password: "x" });
    assert.equal(corta.status, 400, "punto 7: un solo carácter se rechaza");
    assert.equal(corta.json.error, "contrasena_invalida");
    const clave = await admin.app.pedir("POST", `/api/admin/usuarios/${usuario.uid}/contrasena`, { password: OTRA });
    assert.equal(clave.status, 200, clave.texto);
    assert.equal((await usuario.app.abrir()).json.motivo, "admin", "la app del usuario se entera de que la cerró un administrador");

    const auditoria = await admin.app.pedir("GET", `/api/admin/auditoria?${new URLSearchParams({ accion: "admin.", usuario: usuario.uid })}`);
    assert.equal(auditoria.status, 200, auditoria.texto);
    assert.ok(auditoria.json.eventos.some((e) => e.accion === "admin.usuario.acceso"));

    const forzado = await admin.app.pedir("POST", "/api/admin/errores/forzar", { tipo: "manejado" });
    assert.deepEqual([forzado.status, forzado.json], [500, { error: "error_interno" }]);
    const errores = await admin.app.pedir("GET", "/api/admin/errores");
    assert.equal(errores.status, 200);
    assert.equal(errores.json.errores[0].origen, "api:admin.errores.forzar");

    const config = await admin.app.pedir("GET", "/api/admin/configuracion");
    assert.equal(config.status, 200);
    const actual = config.json.configuracion.find((c) => c.clave === "sesion_inactividad_minutos").valor;
    const fijar = await admin.app.pedir("PUT", "/api/admin/configuracion", { clave: "sesion_inactividad_minutos", valor: actual + 1 });
    assert.equal(fijar.status, 200, fijar.texto);
    assert.equal((await admin.app.pedir("PUT", "/api/admin/configuracion", { clave: "sesion_inactividad_minutos", valor: actual })).status, 200);

    assert.equal((await admin.app.pedir("DELETE", `/api/admin/roles/${idRol}`)).status, 200);
  });

  test("401 de las rutas protegidas: sin token → sesion_requerida; con una sesión anónima → cuenta_requerida", async () => {
    for (const ruta of ["/api/cuenta/contrasena", "/api/admin/permisos", "/api/examenes", "/api/movil/v1/metricas/ultimas"]) {
      const metodo = ruta === "/api/cuenta/contrasena" ? "POST" : "GET";
      const cuerpo = metodo === "POST" ? { actual: "x", nueva: "y" } : undefined;
      const sin = await pedir(metodo, ruta, { cuerpo });
      assert.deepEqual([sin.status, sin.json.error], [401, "sesion_requerida"], `${ruta} sin token`);
      const app = new App();
      await app.abrir();
      const anonima = await app.pedir(metodo, ruta, cuerpo);
      assert.deepEqual([anonima.status, anonima.json.error], [401, "cuenta_requerida"], `${ruta} anónima`);
    }
  });
});
