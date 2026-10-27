// Pruebas de cuentas y contraseñas (ronda de seguridad del integrador, área A1:
// puntos 2, 3, 4, 6, 12, 13, 14, 16, 19 —correo cifrado— y 20).
//
//   BASE_URL=http://127.0.0.1:3201 \
//   DATABASE_ADMIN_URL=postgres://postgres:…@127.0.0.1:55441/pulso \
//   DATABASE_URL=postgres://pulso_app:…@127.0.0.1:55441/pulso \
//   MAILPIT_URL=http://127.0.0.1:18021 PULSO_CLAVE_DATOS=… PULSO_APP_PASSWORD=… \
//   node --experimental-strip-types --test --test-concurrency=1 tests/integrador/cuentas.test.mjs
//
// Corren contra un servidor de desarrollo y una base DESCARTABLES: crean
// cuentas, bloquean correos y crean (y borran) una base de prueba para la
// migración. Se niegan a correr contra producción. Sin servidor, sin base o
// sin Mailpit, las suites que los necesitan se saltean.
//
// Cada "navegador" de prueba llega con su propia IP de documentación (RFC
// 3849) en X-Forwarded-For, como en tests/funcionales/comun.mjs: así los
// límites por IP de una prueba no cortan la siguiente.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { fallasContrasena, reglasContrasena } from "../../src/lib/seguridad/contrasena.ts";
import { cifrar, descifrar, indiceCiego } from "../../src/lib/seguridad/cifrado.ts";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3201").replace(/\/+$/, "");
const ADMIN = process.env.DATABASE_ADMIN_URL;
const MAILPIT = (process.env.MAILPIT_URL ?? "").replace(/\/+$/, "");

for (const [nombre, valor] of [["BASE_URL", BASE], ["DATABASE_ADMIN_URL", ADMIN ?? ""]]) {
  if (/agustinynatalia\.site/.test(valor) || /:5433\b/.test(valor)) {
    throw new Error(`${nombre} apunta a producción: estas pruebas crean y bloquean cuentas, no se corren ahí.`);
  }
}

async function responde(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).status < 500;
  } catch {
    return false;
  }
}

const SALTEAR = (await responde(`${BASE}/api/sesion`)) ? false : `el servidor no responde en ${BASE}`;
const SIN_ADMIN = !ADMIN ? "falta DATABASE_ADMIN_URL (base descartable)" : false;
const SIN_MAIL = SALTEAR || SIN_ADMIN || (MAILPIT && (await responde(`${MAILPIT}/api/v1/messages`)) ? false : "falta MAILPIT_URL");
const SIN_CLAVE = !process.env.PULSO_CLAVE_DATOS ? "falta PULSO_CLAVE_DATOS (la misma del servidor)" : false;

let pool = null;
const db = () => (pool ??= new pg.Pool({ connectionString: ADMIN, max: 2 }));
after(async () => {
  await pool?.end();
});

// ─── Ayudas ───────────────────────────────────────────────────────────────────

const sha256 = (t) => createHash("sha256").update(t).digest("hex");
const nuevaIp = () => `2001:db8:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::${randomBytes(2).toString("hex")}`;
const correoNuevo = (etiqueta) => `a1-${etiqueta}-${randomBytes(4).toString("hex")}@prueba.test`;
const hmacCorreo = (email) => indiceCiego(email.trim().toLowerCase(), "cuentas.email");

/** Contraseña que cumple la regla (no contiene la parte local de los correos de prueba). */
const BUENA = "Cafe-Lunar#93x";
const OTRA_BUENA = "Rio_Verde!58q";

/** Un navegador: su cookie de sesión y su IP. */
class Navegador {
  constructor() {
    this.cookie = null;
    this.ip = nuevaIp();
  }
  get hash() {
    return this.cookie ? sha256(this.cookie) : null;
  }
  async pedir(metodo, ruta, cuerpo) {
    const res = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      redirect: "manual",
      headers: {
        "X-Forwarded-For": this.ip,
        ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(this.cookie ? { Cookie: `pulso_sesion=${this.cookie}` } : {}),
      },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    for (const c of res.headers.getSetCookie()) {
      const m = c.match(/^pulso_sesion=([^;]*)/);
      if (m) this.cookie = m[1] || null;
    }
    const texto = await res.text();
    let json = null;
    try { json = JSON.parse(texto); } catch { /* no es JSON */ }
    return { status: res.status, json, texto, headers: res.headers };
  }
  async abrir() {
    const r = await this.pedir("POST", "/api/sesion", {});
    assert.equal(r.status, 200, `POST /api/sesion: ${r.texto}`);
    return this;
  }
  login(email, password) {
    return this.pedir("POST", "/api/cuenta/login", { email, password });
  }
  cuenta() {
    return this.pedir("GET", "/api/cuenta");
  }
}

/** Mensajes de Mailpit para una dirección (los más nuevos primero). */
async function correosPara(para) {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${para}"`)}`);
  return (await r.json()).messages ?? [];
}

/** Espera un correo para `para` cuyo asunto contenga `asunto` y devuelve su texto. */
async function esperarCorreo(para, asunto, { ya = 0 } = {}) {
  for (let i = 0; i < 40; i++) {
    const lista = (await correosPara(para)).filter((m) => m.Subject.includes(asunto));
    if (lista.length > ya) {
      const m = await (await fetch(`${MAILPIT}/api/v1/message/${lista[0].ID}`)).json();
      return m.Text;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.fail(`no llegó el correo "${asunto}" a ${para}`);
}

function tokenDe(texto, ruta) {
  const m = texto.match(new RegExp(`/acceso/${ruta}\\?token=([A-Za-z0-9_-]{43})`));
  assert.ok(m, `el correo no trae el enlace de /acceso/${ruta}`);
  return m[1];
}

/** Cuenta registrada y activada; devuelve el navegador que la creó (con su sesión ya utilizable). */
async function cuentaActivada(email, password = BUENA) {
  const nav = await new Navegador().abrir();
  const r = await nav.pedir("POST", "/api/cuenta/registro", { email, password });
  assert.equal(r.status, 200, `registro: ${r.texto}`);
  const token = tokenDe(await esperarCorreo(email, "Activa tu cuenta"), "activar");
  const a = await nav.pedir("POST", "/api/cuenta/activar", { token });
  assert.equal(a.status, 200, `activar: ${a.texto}`);
  return nav;
}

async function uidDeCorreo(email) {
  const { rows } = await db().query("select uid from cuentas where email_hmac = $1", [hmacCorreo(email)]);
  return rows[0]?.uid ?? null;
}

async function ultimaAuditoria(accion, uid) {
  const { rows } = await db().query(
    "select resultado, detalle from auditoria where accion = $1 and uid is not distinct from $2 order by id desc limit 1",
    [accion, uid]
  );
  return rows[0] ?? null;
}

// ─── 13 — Regla de contraseñas ────────────────────────────────────────────────

// Casos con [contraseña, correo]: se comparan TS (contrasena.ts, la de zod y la
// lista en vivo) y SQL (pulso_contrasena_fallas, la que aplica la base).
const CASOS = [
  ["123456789012345", null],
  ["123456789012345", "agus@prueba.test"],
  [BUENA, null],
  [OTRA_BUENA, "camila.rojas@prueba.test"],
  ["Password1!", null],
  ["P@ssw0rd!!x", null],
  ["Qwerty123!", null],
  ["Pulso2026!", null],
  ["Contraseña#99", null],
  ["abcdEFG!93x", null],
  ["DCBA!xq9w2z", null],
  ["xyz9876!Aqq", null],
  ["Zaaaa!9xQw", null],
  ["ZZzz!!!!9xQw", null],
  ["aAaA1!bcdx", null],
  ["Corto1!", null],
  ["sin mayúsculas 9!", null],
  ["SIN MINÚSCULAS 9!", null],
  ["SinNumeros!!xy", null],
  ["SinSimbolos99x", null],
  ["Con Espacio 9x", null],
  ["Ñandú-Feliz#47", null],
  ["ÁRBOL-verde#47", null],
  ["😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀Aa1!", null],
  ["Áá1!" + "é".repeat(33), null],
  ["x".repeat(73), null],
  ["Camila#Rojas93", "camila@prueba.test"],
  ["MiCamila-77#x", "camila@prueba.test"],
  ["Ana#Belen-93x", "ana@prueba.test"],
  ["Prueba!agus.r-93", "Agus.R@Prueba.test "],
  ["", null],
  ["Tab\tSep!9xQ", null],
  ["9876Zz!qwp", null],
  ["7890Zz!qwp", null],
  ["Zz!qwpwxyz9", null],
];

describe("13 — regla de contraseñas (TS y base)", () => {
  test("123456789012345 se rechaza explicando cada regla que falla", () => {
    const ids = fallasContrasena("123456789012345").map((f) => f.id).sort();
    assert.deepEqual(ids, ["mayuscula", "minuscula", "secuencia", "simbolo"]);
    const textos = fallasContrasena("123456789012345").map((f) => f.texto);
    assert.ok(textos.includes("Sin secuencias de 4 o más, como 1234, abcd o 4321"));
  });

  test("una contraseña fuerte pasa; la lista en vivo marca todo en verde", () => {
    assert.deepEqual(fallasContrasena(BUENA, "otra@prueba.test"), []);
    assert.ok(reglasContrasena(BUENA, "otra@prueba.test").every((r) => r.cumple));
    assert.equal(reglasContrasena(BUENA).length, 9, "sin correo no aparece la regla del correo");
    assert.equal(reglasContrasena(BUENA, "x@y.co").length, 10);
  });

  test("la base aplica exactamente la misma regla, con los mismos textos", { skip: SIN_ADMIN }, async () => {
    for (const [p, email] of CASOS) {
      const ts = fallasContrasena(p, email).map((f) => `${f.id}: ${f.texto}`).sort();
      const { rows } = await db().query("select regla, mensaje from pulso_contrasena_fallas($1, $2)", [p, email]);
      const sql = rows.map((r) => `${r.regla}: ${r.mensaje}`).sort();
      assert.deepEqual(sql, ts, `caso ${JSON.stringify(p)} / ${email}`);
      const { rows: v } = await db().query("select pulso_contrasena_valida($1, $2) as ok", [p, email]);
      assert.equal(v[0].ok, ts.length === 0, `pulso_contrasena_valida ${JSON.stringify(p)}`);
    }
  });

  test("pulso_contrasena_valida sigue aceptando un solo argumento (contrato con administración)", { skip: SIN_ADMIN }, async () => {
    const { rows } = await db().query("select pulso_contrasena_valida('a') as uno, pulso_contrasena_valida($1) as fuerte", [BUENA]);
    assert.equal(rows[0].uno, false);
    assert.equal(rows[0].fuerte, true);
  });

  test("crear la cuenta con 123456789012345 da 400 con las reglas, y no se crea nada", { skip: SIN_MAIL }, async () => {
    const email = correoNuevo("regla");
    const nav = await new Navegador().abrir();
    const r = await nav.pedir("POST", "/api/cuenta/registro", { email, password: "123456789012345" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, "contrasena_invalida");
    assert.ok(r.json.reglas.includes("Al menos una letra mayúscula"));
    assert.ok(r.json.reglas.includes("Sin secuencias de 4 o más, como 1234, abcd o 4321"));
    assert.equal(await uidDeCorreo(email), null);
    const a = await ultimaAuditoria("cuenta.registrar", (await db().query("select uid from sesiones where token_hash = $1", [nav.hash])).rows[0].uid);
    assert.equal(a.resultado, "denegado");
    assert.deepEqual(a.detalle.reglas.sort(), ["mayuscula", "minuscula", "secuencia", "simbolo"]);
  });

  test("la base rechaza una contraseña débil aunque se salteen la app y zod", { skip: SIN_ADMIN }, async () => {
    const { rows } = await db().query(
      "select pulso_registrar_cuenta($1, $2, $3, $4, $5, $6) as r",
      [sha256("sin-sesion"), "0".repeat(64), "v1.x", "x@prueba.test", "a", sha256(randomBytes(8).toString("hex"))]
    );
    // Sin sesión responde antes; con una sesión real, la regla.
    assert.equal(rows[0].r, "sin_sesion");
    const token = randomBytes(32).toString("base64url");
    await db().query("select pulso_crear_sesion($1, 1)", [sha256(token)]);
    const { rows: r2 } = await db().query(
      "select pulso_registrar_cuenta($1, $2, $3, $4, $5, $6) as r",
      [sha256(token), "0".repeat(64), "v1.x", "x@prueba.test", "123456789012345", sha256(randomBytes(8).toString("hex"))]
    );
    assert.equal(r2[0].r, "contrasena_invalida");
  });
});

// ─── 2 y 12 — Lo que se escribe en el login ──────────────────────────────────

describe("2 y 12 — campos del login", { skip: SALTEAR || SIN_ADMIN }, () => {
  test("15 caracteres especiales como correo: 400 datos_invalidos, auditado, sin tocar la base", async () => {
    const especiales = "!#$%&/()=?¡¿*+{";
    assert.equal(Array.from(especiales).length, 15);
    const nav = new Navegador();
    const r = await nav.login(especiales, "lo-que-sea");
    assert.equal(r.status, 400);
    assert.deepEqual(r.json, { error: "datos_invalidos" });
    const { rows } = await db().query(
      "select detalle from auditoria where accion = 'cuenta.login' and resultado = 'denegado' order by id desc limit 1"
    );
    assert.equal(rows[0].detalle.motivo, "datos_invalidos");
    assert.deepEqual(rows[0].detalle.campos, ["email"]);
    // En registro y recuperación, igual.
    const nav2 = await new Navegador().abrir();
    assert.equal((await nav2.pedir("POST", "/api/cuenta/registro", { email: especiales, password: BUENA })).status, 400);
    assert.equal((await nav2.pedir("POST", "/api/cuenta/recuperar", { email: especiales })).status, 400);
  });

  test("1…15 como contraseña: 'Correo o contraseña incorrectos' y cuenta para el bloqueo", { skip: SIN_MAIL }, async () => {
    const email = correoNuevo("secuencia");
    await cuentaActivada(email);
    const nav = new Navegador();
    const r = await nav.login(email, "123456789012345");
    assert.equal(r.status, 401);
    assert.equal(r.json.error, "credenciales_invalidas");
    assert.equal(r.json.intentos_restantes, 4);
    const { rows } = await db().query("select fallos from intentos_acceso where email_hmac = $1", [hmacCorreo(email)]);
    assert.equal(rows[0].fallos, 1);
  });
});

// ─── 4 — Bloqueo a los 5 intentos ─────────────────────────────────────────────

describe("4 — bloqueo por intentos fallidos", { skip: SIN_MAIL }, () => {
  test("5 fallos seguidos bloquean 15 minutos: ni la contraseña correcta entra; aviso al dueño y auditoría", async () => {
    const email = correoNuevo("bloqueo");
    await cuentaActivada(email);
    const uid = await uidDeCorreo(email);
    const nav = new Navegador();

    for (const restantes of [4, 3, 2, 1]) {
      const r = await nav.login(email, "123456789012345");
      assert.equal(r.status, 401);
      assert.equal(r.json.intentos_restantes, restantes);
    }
    const quinto = await nav.login(email, "123456789012345");
    assert.equal(quinto.status, 429);
    assert.deepEqual(quinto.json, { error: "cuenta_bloqueada", minutos: 15 });
    assert.equal(quinto.headers.get("retry-after"), "900");

    const correcta = await nav.login(email, BUENA);
    assert.equal(correcta.status, 429, "bloqueada, ni la contraseña correcta entra");
    assert.equal(correcta.json.error, "cuenta_bloqueada");

    const aviso = await esperarCorreo(email, "Bloqueamos tu cuenta");
    assert.match(aviso, /5 intentos seguidos/);
    const b = await ultimaAuditoria("cuenta.bloquear", uid);
    assert.equal(b.resultado, "ok");
    assert.equal(b.detalle.origen, "login");
    assert.equal(b.detalle.minutos, 15);
    const rechazo = await ultimaAuditoria("cuenta.login", uid);
    assert.equal(rechazo.resultado, "denegado");
    assert.equal(rechazo.detalle.motivo, "bloqueada");

    // "Olvidé mi contraseña" la desbloquea.
    assert.equal((await nav.pedir("POST", "/api/cuenta/recuperar", { email })).status, 200);
    const token = tokenDe(await esperarCorreo(email, "Restablece tu contraseña"), "restablecer");
    assert.equal((await nav.pedir("POST", "/api/cuenta/restablecer", { token, password: OTRA_BUENA })).status, 200);
    const despues = await nav.login(email, OTRA_BUENA);
    assert.equal(despues.status, 200, despues.texto);
    const { rows } = await db().query("select count(*)::int as n from intentos_acceso where email_hmac = $1", [hmacCorreo(email)]);
    assert.equal(rows[0].n, 0, "el contador volvió a 0");
  });

  test("un correo SIN cuenta se bloquea igual (el bloqueo no delata quién está registrado) y no se manda correo", async () => {
    const email = correoNuevo("fantasma");
    const nav = new Navegador();
    for (const restantes of [4, 3, 2, 1]) {
      const r = await nav.login(email, "Lo-que-sea#93");
      assert.deepEqual([r.status, r.json], [401, { error: "credenciales_invalidas", intentos_restantes: restantes }]);
    }
    const r = await nav.login(email, "Lo-que-sea#93");
    assert.deepEqual([r.status, r.json], [429, { error: "cuenta_bloqueada", minutos: 15 }]);
    await new Promise((ok) => setTimeout(ok, 1500));
    assert.equal((await correosPara(email)).length, 0);
    const { rows } = await db().query(
      "select detalle from auditoria where accion = 'cuenta.bloquear' and uid is null order by id desc limit 1"
    );
    assert.equal(rows[0].detalle.cuenta_existe, false);
  });

  test("acertar pone el contador en 0: tres fallos, un acierto y cuatro fallos más no bloquean", async () => {
    const email = correoNuevo("reinicio");
    await cuentaActivada(email);
    const nav = new Navegador();
    for (let i = 0; i < 3; i++) assert.equal((await nav.login(email, "Mala-clave#1")).status, 401);
    assert.equal((await nav.login(email, BUENA)).status, 200);
    let ultimo;
    for (let i = 0; i < 4; i++) ultimo = await nav.login(email, "Mala-clave#1");
    assert.equal(ultimo.status, 401);
    assert.equal(ultimo.json.intentos_restantes, 1);
  });
});

// ─── 6 — Duplicados ───────────────────────────────────────────────────────────

describe("6 — mismo correo dos veces", { skip: SIN_MAIL }, () => {
  test("con otras mayúsculas y espacios: misma respuesta, una sola cuenta y aviso al dueño", async () => {
    const email = correoNuevo("duplicado");
    await cuentaActivada(email);

    const otro = await new Navegador().abrir();
    const variante = `  ${email.toUpperCase()}  `;
    const r = await otro.pedir("POST", "/api/cuenta/registro", { email: variante, password: OTRA_BUENA });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true }, "la misma respuesta que un registro nuevo");

    const { rows } = await db().query("select count(*)::int as n from cuentas where email_hmac = $1", [hmacCorreo(email)]);
    assert.equal(rows[0].n, 1);
    const { rows: s } = await db().query(
      "select c.uid from sesiones s left join cuentas c on c.uid = s.uid where s.token_hash = $1", [otro.hash]
    );
    assert.equal(s[0].uid, null, "la segunda sesión no quedó con cuenta");
    await esperarCorreo(email, "Ya tienes una cuenta");
    const { rows: a } = await db().query(
      "select detalle from auditoria a join sesiones s on s.uid = a.uid where s.token_hash = $1 and a.accion = 'cuenta.registrar'",
      [otro.hash]
    );
    assert.equal(a[0].detalle.motivo, "email_en_uso");
  });

  test("la base lo impide aunque se saltee la app: índice único sobre el índice ciego", { skip: SIN_ADMIN }, async () => {
    const { rows } = await db().query(
      "select indexdef from pg_indexes where tablename = 'cuentas' and indexname = 'cuentas_email_hmac_idx'"
    );
    assert.match(rows[0].indexdef, /UNIQUE INDEX .* \(email_hmac\)/);
  });
});

// ─── 19 — Correo cifrado ──────────────────────────────────────────────────────

describe("19 — el correo está cifrado en la base", { skip: SIN_MAIL || SIN_CLAVE }, () => {
  test("cuentas no tiene correo en claro; la app lo descifra para mostrarlo", async () => {
    const email = correoNuevo("cifrado");
    const nav = await cuentaActivada(email);

    const { rows: cols } = await db().query(
      "select column_name from information_schema.columns where table_name = 'cuentas' order by 1"
    );
    assert.ok(!cols.some((c) => c.column_name === "email"), "no hay columna email");

    const { rows } = await db().query("select * from cuentas where email_hmac = $1", [hmacCorreo(email)]);
    const fila = rows[0];
    assert.match(fila.email_cifrado, /^v1\./);
    assert.ok(!JSON.stringify(fila).includes(email.split("@")[0]), "ninguna columna tiene el correo");
    assert.match(fila.password_hash, /^\$2[aby]\$12\$/, "la contraseña, con bcrypt de costo 12");
    assert.equal(descifrar(fila.email_cifrado, "cuentas.email"), email);
    assert.throws(() => descifrar(fila.email_cifrado, "otra.columna"), "con otro contexto no se descifra");

    const c = await nav.cuenta();
    assert.equal(c.status, 200);
    assert.deepEqual(c.json, { cuenta: { email, verificada: true } });

    // Tampoco queda en la auditoría, los límites ni los enlaces.
    const local = email.split("@")[0];
    for (const sql of [
      "select count(*)::int as n from auditoria where detalle::text like '%' || $1 || '%'",
      "select count(*)::int as n from limites_tasa where clave like '%' || $1 || '%'",
      "select count(*)::int as n from intentos_acceso where email_hmac like '%' || $1 || '%'",
    ]) {
      assert.equal((await db().query(sql, [local])).rows[0].n, 0, sql);
    }
  });
});

// ─── 16 — Dos navegadores a la vez ────────────────────────────────────────────

describe("16 — iniciar sesión cierra las demás sesiones", { skip: SIN_MAIL }, () => {
  test("el navegador 2 entra y el 1 queda afuera con motivo 'otro_inicio'", async () => {
    const email = correoNuevo("dos-navegadores");
    await cuentaActivada(email);
    const uid = await uidDeCorreo(email);

    const uno = await new Navegador().abrir();
    assert.equal((await uno.login(email, BUENA)).status, 200);
    assert.equal((await uno.cuenta()).status, 200);

    const dos = await new Navegador().abrir();
    const r = await dos.login(email, BUENA);
    assert.equal(r.status, 200);
    assert.ok(r.json.sesiones_cerradas >= 1);

    const { rows } = await db().query("select revocada_at, revocada_motivo from sesiones where token_hash = $1", [uno.hash]);
    assert.ok(rows[0].revocada_at);
    assert.equal(rows[0].revocada_motivo, "otro_inicio");
    assert.equal((await uno.cuenta()).status, 401, "el navegador 1 ya no entra");
    assert.equal((await dos.cuenta()).status, 200, "el 2 sí");

    const { rows: vivas } = await db().query(
      "select count(*)::int as n from sesiones where uid = $1 and revocada_at is null and expira_at > now()", [uid]
    );
    assert.equal(vivas[0].n, 1, "una sola sesión viva por cuenta");
    const a = await ultimaAuditoria("cuenta.login", uid);
    assert.equal(a.resultado, "ok");
    assert.ok(a.detalle.sesiones_cerradas >= 1);
  });
});

// ─── 20 — Perfil: contraseña ──────────────────────────────────────────────────

/** Otra sesión de la misma cuenta, como si estuviera abierta en otro equipo (el login cerraría la primera). */
async function otraSesion(uid) {
  const nav = new Navegador();
  nav.cookie = randomBytes(32).toString("base64url");
  await db().query(
    "insert into sesiones (token_hash, uid, expira_at, desbloqueada_hasta) values ($1, $2, now() + interval '1 day', now() + interval '15 minutes')",
    [nav.hash, uid]
  );
  return nav;
}

describe("20 — cambiar la contraseña desde el perfil", { skip: SIN_MAIL }, () => {
  test("pide la actual, aplica la regla, cierra las otras sesiones y avisa", async () => {
    const email = correoNuevo("perfil-clave");
    const nav = await cuentaActivada(email);
    const uid = await uidDeCorreo(email);
    const otra = await otraSesion(uid);
    assert.equal((await otra.cuenta()).status, 200);

    const mal = await nav.pedir("POST", "/api/cuenta/contrasena", { actual: "No-es-esta#1", nueva: OTRA_BUENA });
    assert.deepEqual([mal.status, mal.json], [400, { error: "contrasena_actual_incorrecta", intentos_restantes: 4 }]);

    const debil = await nav.pedir("POST", "/api/cuenta/contrasena", { actual: BUENA, nueva: "123456789012345" });
    assert.equal(debil.status, 400);
    assert.equal(debil.json.error, "contrasena_invalida");
    assert.ok(debil.json.reglas.includes("Al menos un símbolo, como ! ? # * -"));

    const conCorreo = await nav.pedir("POST", "/api/cuenta/contrasena", {
      actual: BUENA, nueva: `X#9${email.split("@")[0]}`,
    });
    assert.equal(conCorreo.status, 400);
    assert.ok(conCorreo.json.reglas.includes("Que no contenga tu correo"));

    const misma = await nav.pedir("POST", "/api/cuenta/contrasena", { actual: BUENA, nueva: BUENA });
    assert.deepEqual([misma.status, misma.json.error], [400, "misma_contrasena"]);

    const ok = await nav.pedir("POST", "/api/cuenta/contrasena", { actual: BUENA, nueva: OTRA_BUENA });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal(ok.json.sesiones_cerradas, 1);

    assert.equal((await nav.cuenta()).status, 200, "esta sesión sigue");
    assert.equal((await otra.cuenta()).status, 401, "la otra se cerró");
    const { rows } = await db().query("select revocada_motivo from sesiones where token_hash = $1", [otra.hash]);
    assert.equal(rows[0].revocada_motivo, "contrasena");

    await esperarCorreo(email, "Cambiaste la contraseña");
    const tercero = new Navegador();
    assert.equal((await tercero.login(email, BUENA)).status, 401, "la vieja ya no sirve");
    assert.equal((await tercero.login(email, OTRA_BUENA)).status, 200, "la nueva sí");
    assert.equal((await ultimaAuditoria("cuenta.cambiar_contrasena", uid)).resultado, "ok");
  });

  test("la actual equivocada cuenta para el bloqueo: al 5.º fallo se bloquea también el login", async () => {
    const email = correoNuevo("perfil-bloqueo");
    const nav = await cuentaActivada(email);
    for (let i = 0; i < 4; i++) {
      assert.equal((await nav.pedir("POST", "/api/cuenta/contrasena", { actual: "Mala-clave#1", nueva: OTRA_BUENA })).status, 400);
    }
    const quinto = await nav.pedir("POST", "/api/cuenta/contrasena", { actual: "Mala-clave#1", nueva: OTRA_BUENA });
    assert.deepEqual([quinto.status, quinto.json], [429, { error: "cuenta_bloqueada", minutos: 15 }]);
    assert.equal((await new Navegador().login(email, BUENA)).status, 429, "el login también está bloqueado");
    await esperarCorreo(email, "Bloqueamos tu cuenta");
    const b = await ultimaAuditoria("cuenta.bloquear", await uidDeCorreo(email));
    assert.equal(b.detalle.origen, "cambio_contrasena");
  });

  test("sin sesión de una cuenta activada: 401", async () => {
    const nav = await new Navegador().abrir();
    const r = await nav.pedir("POST", "/api/cuenta/contrasena", { actual: BUENA, nueva: OTRA_BUENA });
    assert.equal(r.status, 401);
  });
});

// ─── 20 — Perfil: correo ──────────────────────────────────────────────────────

describe("20 — cambiar el correo desde el perfil", { skip: SIN_MAIL }, () => {
  test("enlace al correo NUEVO y aviso al viejo; el cambio rige al confirmar", async () => {
    const viejo = correoNuevo("correo-viejo");
    const nuevo = correoNuevo("correo-nuevo");
    const nav = await cuentaActivada(viejo);
    const uid = await uidDeCorreo(viejo);

    const mal = await nav.pedir("POST", "/api/cuenta/correo", { email: nuevo, password: "Mala-clave#1" });
    assert.deepEqual([mal.status, mal.json.error], [400, "contrasena_actual_incorrecta"]);
    const mismo = await nav.pedir("POST", "/api/cuenta/correo", { email: ` ${viejo.toUpperCase()}`, password: BUENA });
    assert.deepEqual([mismo.status, mismo.json.error], [400, "mismo_correo"]);
    const invalido = await nav.pedir("POST", "/api/cuenta/correo", { email: "!#$%&/()=?¡¿*+{", password: BUENA });
    assert.deepEqual([invalido.status, invalido.json.error], [400, "datos_invalidos"]);

    const r = await nav.pedir("POST", "/api/cuenta/correo", { email: nuevo, password: BUENA });
    assert.deepEqual([r.status, r.json], [200, { ok: true }]);

    const token = tokenDe(await esperarCorreo(nuevo, "Confirma tu correo nuevo"), "confirmar-correo");
    const aviso = await esperarCorreo(viejo, "Pidieron cambiar el correo");
    assert.ok(aviso.includes(`${nuevo.slice(0, 2)}•••@prueba.test`), "el aviso muestra el correo nuevo enmascarado");
    assert.ok(!aviso.includes(nuevo), "y no entero");

    // Antes de confirmar, nada cambió.
    assert.equal((await nav.cuenta()).json.cuenta.email, viejo);
    assert.equal((await new Navegador().login(nuevo, BUENA)).status, 401);

    // Se confirma desde otro equipo, sin sesión.
    const otro = new Navegador();
    const c = await otro.pedir("POST", "/api/cuenta/confirmar-correo", { token });
    assert.deepEqual([c.status, c.json], [200, { ok: true }]);
    assert.equal((await otro.pedir("POST", "/api/cuenta/confirmar-correo", { token })).status, 400, "un solo uso");

    assert.equal((await nav.cuenta()).json.cuenta.email, nuevo);
    assert.equal(await uidDeCorreo(nuevo), uid);
    assert.equal(await uidDeCorreo(viejo), null);
    assert.equal((await new Navegador().login(viejo, BUENA)).status, 401, "el correo viejo ya no entra");
    assert.equal((await new Navegador().login(nuevo, BUENA)).status, 200, "el nuevo sí");
    assert.equal((await ultimaAuditoria("cuenta.confirmar_correo", uid)).resultado, "ok");
  });

  test("si el correo nuevo ya es de otra cuenta: misma respuesta, no se cambia nada y se avisa", async () => {
    const mio = correoNuevo("mio");
    const ajeno = correoNuevo("ajeno");
    await cuentaActivada(ajeno);
    const nav = await cuentaActivada(mio);
    const uid = await uidDeCorreo(mio);

    const r = await nav.pedir("POST", "/api/cuenta/correo", { email: ajeno.toUpperCase(), password: BUENA });
    assert.deepEqual([r.status, r.json], [200, { ok: true }], "la misma respuesta que con un correo libre");

    await esperarCorreo(ajeno, "Ya tienes una cuenta");
    await esperarCorreo(mio, "Pidieron cambiar el correo");
    const { rows } = await db().query("select count(*)::int as n from tokens_cuenta where uid = $1 and tipo = 'cambio_correo'", [uid]);
    assert.equal(rows[0].n, 0, "no quedó ningún cambio pendiente");
    assert.equal((await nav.cuenta()).json.cuenta.email, mio);
    assert.equal((await ultimaAuditoria("cuenta.cambiar_correo", uid)).detalle.motivo, "email_en_uso");
  });
});

// ─── 3 — Restablecer de punta a punta ─────────────────────────────────────────

describe("3 — Olvidé mi contraseña", { skip: SIN_MAIL }, () => {
  test("enlace por correo, regla nueva, todas las sesiones cerradas y entra con la nueva", async () => {
    const email = correoNuevo("recuperar");
    const nav = await cuentaActivada(email);
    const uid = await uidDeCorreo(email);

    const r = await new Navegador().pedir("POST", "/api/cuenta/recuperar", { email: `  ${email.toUpperCase()} ` });
    assert.deepEqual([r.status, r.json], [200, { ok: true }]);
    const token = tokenDe(await esperarCorreo(email, "Restablece tu contraseña"), "restablecer");

    const pagina = new Navegador();
    const debil = await pagina.pedir("POST", "/api/cuenta/restablecer", { token, password: "123456789012345" });
    assert.equal(debil.status, 400);
    assert.equal(debil.json.error, "contrasena_invalida");
    const conCorreo = await pagina.pedir("POST", "/api/cuenta/restablecer", { token, password: `Z#7${email.split("@")[0]}` });
    assert.ok(conCorreo.json.reglas.includes("Que no contenga tu correo"), "la del correo la revisa el servidor");

    const ok = await pagina.pedir("POST", "/api/cuenta/restablecer", { token, password: OTRA_BUENA });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal((await pagina.pedir("POST", "/api/cuenta/restablecer", { token, password: OTRA_BUENA })).status, 400, "un solo uso");

    assert.equal((await nav.cuenta()).status, 401, "la sesión abierta se cerró");
    const { rows } = await db().query("select revocada_motivo from sesiones where token_hash = $1", [nav.hash]);
    assert.equal(rows[0].revocada_motivo, "contrasena");
    assert.equal((await new Navegador().login(email, BUENA)).status, 401);
    assert.equal((await new Navegador().login(email, OTRA_BUENA)).status, 200);
    const { rows: a } = await db().query(
      "select detalle from auditoria where accion = 'cuenta.restablecer' and resultado = 'ok' order by id desc limit 1"
    );
    assert.ok(a[0].detalle.sesiones_cerradas >= 1, "auditado con las sesiones que cerró");
    assert.ok(uid);
  });

  test("un correo sin cuenta recibe la misma respuesta y ningún correo", async () => {
    const email = correoNuevo("nadie");
    const r = await new Navegador().pedir("POST", "/api/cuenta/recuperar", { email });
    assert.deepEqual([r.status, r.json], [200, { ok: true }]);
    await new Promise((ok) => setTimeout(ok, 1500));
    assert.equal((await correosPara(email)).length, 0);
  });
});

// ─── 14 y páginas ─────────────────────────────────────────────────────────────

describe("14 — campos de contraseña y páginas", () => {
  test("los campos de contraseña son type=password y bloquean copiar, cortar y arrastrar, sin botón de mostrar", async () => {
    const comun = await readFile(path.join(RAIZ, "src/components/cuenta/comun.tsx"), "utf8");
    const campo = comun.slice(comun.indexOf("export function CampoContrasena"), comun.indexOf("export function Aviso"));
    for (const fragmento of ['type="password"', "onCopy={bloquear}", "onCut={bloquear}", "onDragStart={bloquear}"]) {
      assert.ok(campo.includes(fragmento), `CampoContrasena: falta ${fragmento}`);
    }
    // Ningún formulario de la cuenta arma su propio campo de contraseña ni lo puede mostrar.
    for (const archivo of ["cuenta-client.tsx", "perfil-cuenta.tsx", "restablecer-client.tsx"]) {
      const texto = await readFile(path.join(RAIZ, "src/components/cuenta", archivo), "utf8");
      assert.ok(!texto.includes('type="password"'), `${archivo} usa CampoContrasena`);
      assert.ok(!/type=\{?["']text["']\}?[^>]*contrase/i.test(texto), `${archivo}: nada de mostrar la contraseña`);
      assert.ok(texto.includes("<CampoContrasena"), archivo);
    }
  });

  test("las páginas de la cuenta renderizan (y la de restablecer muestra la regla y el campo enmascarado)", { skip: SALTEAR }, async () => {
    const token = randomBytes(32).toString("base64url");
    for (const [ruta, texto] of [
      ["/acceso", "Pulso"],
      [`/acceso/restablecer?token=${token}`, "Contraseña nueva"],
      [`/acceso/activar?token=${token}`, "Activar cuenta"],
      [`/acceso/confirmar-correo?token=${token}`, "Confirmar correo nuevo"],
      ["/cuenta", "Cuenta"],
    ]) {
      const r = await fetch(`${BASE}${ruta}`, { headers: { "X-Forwarded-For": nuevaIp() } });
      assert.equal(r.status, 200, ruta);
      const html = await r.text();
      assert.ok(html.includes(texto), `${ruta} muestra "${texto}"`);
      if (ruta.startsWith("/acceso/restablecer")) {
        assert.match(html, /type="password"/);
        assert.ok(html.includes("Al menos 10 caracteres"), "la lista de la regla");
      }
    }
  });
});

// ─── 19 — Migración de las cuentas existentes (C7) ────────────────────────────
// Base de prueba con el esquema que corre hoy en producción (commit b7ccd69),
// una cuenta activada con datos, y después: setup-db → migración → setup-db.

describe("19 — migración del correo de las cuentas existentes", { skip: SIN_ADMIN || SIN_CLAVE }, () => {
  test("esquema de producción con datos → setup-db → migrar → setup-db: la cuenta vieja entra y sus datos se leen", async () => {
    const nombre = `pulso_mig_${randomBytes(4).toString("hex")}`;
    const urlDe = (base, db) => { const u = new URL(base); u.pathname = `/${db}`; return u.toString(); };
    const adminTmp = urlDe(ADMIN, nombre);
    await db().query(`create database ${nombre}`);
    const c = new pg.Client({ connectionString: adminTmp });
    try {
      await c.connect();
      // 1. El esquema de producción, tal cual.
      for (const archivo of ["db/schema.sql", "db/seguridad.sql"]) {
        await c.query(execFileSync("git", ["show", `b7ccd69:${archivo}`], { cwd: RAIZ, encoding: "utf8" }));
      }
      // 2. Una cuenta activada con datos, creada con las funciones de entonces.
      const sesion = sha256(randomBytes(32).toString("base64url"));
      const enlace = sha256(randomBytes(32).toString("base64url"));
      const uid = (await c.query("select pulso_crear_sesion($1, 180) as uid", [sesion])).rows[0].uid;
      const viejo = "Cuenta.Vieja@Prueba.test";
      assert.equal((await c.query("select pulso_registrar_cuenta($1, $2, $3, $4) as r", [sesion, viejo, "contrasena-vieja-10", enlace])).rows[0].r, "ok");
      assert.equal((await c.query("select pulso_activar_cuenta($1) as ok", [enlace])).rows[0].ok, true);
      await c.query("insert into metricas (uid, tipo, valor, unidad) values ($1, 'peso', 80.5, 'kg'), ($1, 'frecuencia_cardiaca', 64, 'bpm')", [uid]);

      const correr = (args) => execFileSync(process.execPath, args, {
        cwd: RAIZ, encoding: "utf8", env: { ...process.env, DATABASE_ADMIN_URL: adminTmp, DATABASE_URL: "" },
      });
      const migrar = () => correr(["--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/migrar-cifrado-cuentas.mjs"]);

      // 3. setup-db nuevo sobre el esquema viejo: corre, y una cuenta nueva ya se crea cifrada.
      correr(["scripts/setup-db.mjs"]);
      const sesion2 = sha256(randomBytes(32).toString("base64url"));
      await c.query("select pulso_crear_sesion($1, 180)", [sesion2]);
      const nueva = "nueva@prueba.test";
      assert.equal((await c.query("select pulso_registrar_cuenta($1, $2, $3, $4, $5, $6) as r",
        [sesion2, hmacCorreo(nueva), cifrar(nueva, "cuentas.email"), nueva, BUENA, sha256("x" + nombre)])).rows[0].r, "ok");

      // 4a. Con OTRA clave la verificación falla (la cuenta nueva no se descifra) y no se toca nada.
      assert.throws(
        () => execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/migrar-cifrado-cuentas.mjs"], {
          cwd: RAIZ, encoding: "utf8", stdio: "pipe",
          env: { ...process.env, DATABASE_ADMIN_URL: adminTmp, PULSO_CLAVE_DATOS: randomBytes(32).toString("base64") },
        }),
        (err) => /Migración cancelada .*no se descifra/s.test(String(err.stderr))
      );
      const intacta = (await c.query("select email, email_hmac from cuentas where uid = $1", [uid])).rows[0];
      assert.deepEqual(intacta, { email: "cuenta.vieja@prueba.test", email_hmac: null }, "rollback: el correo viejo sigue igual");

      // 4b. Migración: cifra la vieja, verifica y borra la columna.
      assert.match(migrar(), /1 cuenta\(s\) cifrada\(s\), 2 verificada\(s\); columna cuentas\.email eliminada/);
      const cols = (await c.query("select column_name from information_schema.columns where table_name = 'cuentas'")).rows.map((r) => r.column_name);
      assert.ok(!cols.includes("email"));
      const fila = (await c.query("select email_hmac, email_cifrado from cuentas where uid = $1", [uid])).rows[0];
      assert.equal(fila.email_hmac, hmacCorreo(viejo));
      assert.equal(descifrar(fila.email_cifrado, "cuentas.email"), viejo.toLowerCase());

      // 5. Idempotente: otra vez la migración y otra vez setup-db.
      assert.match(migrar(), /Ya estaba migrada: 2 cuenta\(s\) verificada\(s\)/);
      correr(["scripts/setup-db.mjs"]);
      correr(["scripts/setup-db.mjs"]);
      const nulos = (await c.query("select is_nullable from information_schema.columns where table_name = 'cuentas' and column_name = 'email_hmac'")).rows[0];
      assert.equal(nulos.is_nullable, "NO");

      // 6. La cuenta vieja entra con su contraseña de siempre (el login no aplica la regla nueva)…
      const nuevaSesion = sha256(randomBytes(32).toString("base64url"));
      const login = (await c.query("select * from pulso_iniciar_sesion_cuenta($1, $2, $3, null)",
        [hmacCorreo(" cuenta.vieja@prueba.test"), "contrasena-vieja-10", nuevaSesion])).rows[0];
      assert.equal(login.resultado, "ok");
      assert.equal(login.uid_cuenta, uid);
      // …y sus datos se leen como la app: pulso_app, con RLS y el uid de la sesión.
      const appUrl = new URL(adminTmp);
      appUrl.username = "pulso_app";
      appUrl.password = process.env.PULSO_APP_PASSWORD ?? "";
      const app = new pg.Client({ connectionString: appUrl.toString() });
      await app.connect();
      try {
        const uidApp = (await app.query("select pulso_uid_con_cuenta($1) as uid", [nuevaSesion])).rows[0].uid;
        assert.equal(uidApp, uid);
        await app.query("begin");
        await app.query("select set_config('app.uid', $1, true)", [uidApp]);
        const { rows } = await app.query("select tipo, valor from metricas order by tipo");
        await app.query("commit");
        assert.deepEqual(rows, [{ tipo: "frecuencia_cardiaca", valor: 64 }, { tipo: "peso", valor: 80.5 }]);
        const correo = (await app.query("select * from pulso_cuenta_de_sesion($1)", [nuevaSesion])).rows[0];
        assert.equal(descifrar(correo.email_cifrado, "cuentas.email"), "cuenta.vieja@prueba.test");
      } finally {
        await app.end();
      }
    } finally {
      await c.end();
      await db().query(`drop database if exists ${nombre} with (force)`);
    }
  });
});
