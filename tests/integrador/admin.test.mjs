// Pruebas de la administración (integrador, puntos 5, 7, 8, 9, 10/11 y 17):
// roles y permisos, auditoría, cambio de contraseña por el administrador,
// registro de errores, configuración y scripts/asignar-admin.mjs.
//
//   BASE_URL=http://127.0.0.1:3202 \
//   DATABASE_ADMIN_URL=postgres://postgres:…@127.0.0.1:55442/pulso \
//   MAILPIT_URL=http://127.0.0.1:18022 \
//   node --test --test-concurrency=1 tests/integrador/admin.test.mjs
//
// Corren contra el servidor de desarrollo y su base DESCARTABLE: crean cuentas
// (registro → enlace del correo en Mailpit → activar → iniciar sesión), les dan
// roles y permisos, fuerzan errores y al final borran lo que crearon. Sin las
// tres variables, o si el servidor no responde, se saltean. Nunca contra
// producción.

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";

const BASE = (process.env.BASE_URL ?? "").replace(/\/+$/, "");
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const MAILPIT = (process.env.MAILPIT_URL ?? "").replace(/\/+$/, "");

if (/agustinynatalia\.site/.test(BASE)) {
  throw new Error("Estas pruebas crean cuentas y cambian permisos: no se corren contra producción.");
}

async function responde(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(5000) })).status < 500;
  } catch {
    return false;
  }
}

const SALTEAR = !BASE || !ADMIN_URL || !MAILPIT
  ? "faltan BASE_URL, DATABASE_ADMIN_URL o MAILPIT_URL (entorno descartable)"
  : !(await responde(`${BASE}/api/sesion`)) ? `el servidor no responde en ${BASE}`
  : !(await responde(`${MAILPIT}/api/v1/messages`)) ? `Mailpit no responde en ${MAILPIT}`
  : false;

const SCRIPT = fileURLToPath(new URL("../../scripts/asignar-admin.mjs", import.meta.url));
const ejecutar = promisify(execFile);

// Cumple la regla actual (10 a 72) y la del integrador (mayúscula, minúscula,
// número, símbolo, sin secuencias ni repeticiones ni la parte local del correo).
const CLAVE = "Pulso#Prueba-Rx7q";
const CLAVE_NUEVA = "Otra!Clave-Vk29m";

const sufijo = randomBytes(3).toString("hex");
const hash = (t) => createHash("sha256").update(t).digest("hex");
const h = () => randomBytes(2).toString("hex");
/** IP de documentación (RFC 3849) distinta por navegador: no gasta los límites por IP de otros. */
const ipNueva = () => `2001:db8:${h()}:${h()}::${h()}`;

let db;
const creados = [];    // uids a borrar al final
const rolesCreados = [];
let configOriginal = [];

// ─── Un "navegador": cookie de sesión e IP propias ───────────────────────────

class Navegador {
  constructor() {
    this.cookie = null;
    this.ip = ipNueva();
  }

  get token() {
    return this.cookie?.split("=")[1] ?? null;
  }

  async pedir(metodo, ruta, cuerpo) {
    const res = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: {
        "X-Forwarded-For": this.ip,
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const nueva = res.headers.getSetCookie().find((v) => /pulso_sesion=/.test(v));
    if (nueva) {
      const par = nueva.split(";")[0];
      this.cookie = par.endsWith("=") ? null : par;
    }
    const texto = await res.text();
    let json = null;
    try { json = JSON.parse(texto); } catch { /* no es JSON */ }
    return { status: res.status, json, texto };
  }
}

/** Enlace del último correo que le llegó a `para` en Mailpit (espera a que llegue). */
async function correoPara(para, asunto) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${para}"`)}`);
    const { messages = [] } = await r.json();
    const m = messages.find((x) => !asunto || x.Subject.includes(asunto));
    if (m) return (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`no llegó el correo a ${para}${asunto ? ` («${asunto}»)` : ""}`);
}

/** Cuenta activada y con la sesión iniciada, por el mismo camino que un usuario. */
async function cuentaActivada(prefijo) {
  const nav = new Navegador();
  const email = `${prefijo}-${sufijo}-${h()}@pulso.test`;
  assert.equal((await nav.pedir("POST", "/api/sesion", {})).status, 200);
  const reg = await nav.pedir("POST", "/api/cuenta/registro", { email, password: CLAVE });
  assert.equal(reg.status, 200, `registro: ${reg.texto}`);

  const mensaje = await correoPara(email, "Activa");
  const token = mensaje.Text.match(/token=([A-Za-z0-9_-]{43})/)?.[1];
  assert.ok(token, "el correo trae el enlace de activación");
  const act = await nav.pedir("POST", "/api/cuenta/activar", { token });
  assert.equal(act.status, 200, `activar: ${act.texto}`);

  const login = await nav.pedir("POST", "/api/cuenta/login", { email, password: CLAVE });
  assert.equal(login.status, 200, `login: ${login.texto}`);
  const { rows } = await db.query("select uid from sesiones where token_hash = $1", [hash(nav.token)]);
  const uid = rows[0].uid;
  creados.push(uid);
  return { nav, email, uid };
}

/** Filas de auditoría que coinciden (las más nuevas primero). */
async function auditoria(accion, condiciones = {}) {
  const { rows } = await db.query(
    `select * from auditoria
      where accion = $1
        and ($2::text is null or uid = $2)
        and ($3::text is null or resultado = $3)
        and ($4::text is null or recurso_id = $4)
        and ($5::text is null or detalle->>'motivo' = $5)
      order by id desc`,
    [accion, condiciones.uid ?? null, condiciones.resultado ?? null, condiciones.recursoId ?? null, condiciones.motivo ?? null]
  );
  return rows;
}

/** Corre `fn` como pulso_app (la app) dentro de una transacción que se deshace. */
async function comoApp(fn) {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query("set local role pulso_app");
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => {});
    c.release();
  }
}

const idSistema = async () => (await db.query("select id from roles where sistema")).rows[0].id;
const efectivos = (usuario) => usuario.efectivos.map((e) => e.permiso);

// ─── Pruebas ──────────────────────────────────────────────────────────────────

describe("administración: roles, permisos, auditoría y errores", { skip: SALTEAR }, () => {
  let admin, a, b, c;
  let soporte, auditor;

  before(async () => {
    db = new pg.Pool({ connectionString: ADMIN_URL, max: 3 });
    configOriginal = (await db.query("select clave, valor, actualizada_at, actualizada_por from configuracion")).rows;
    [admin, a, b, c] = [
      await cuentaActivada("admin"),
      await cuentaActivada("usuario-a"),
      await cuentaActivada("usuario-b"),
      await cuentaActivada("usuario-c"),
    ];
  });

  after(async () => {
    if (!db) return;
    for (const f of configOriginal) {
      await db.query("update configuracion set valor = $2, actualizada_at = $3, actualizada_por = $4 where clave = $1",
        [f.clave, f.valor, f.actualizada_at, f.actualizada_por]);
    }
    if (rolesCreados.length) await db.query("delete from roles where id = any($1) and not sistema", [rolesCreados]);
    // En cascada: cuentas, sesiones, roles y permisos asignados (la auditoría queda).
    if (creados.length) await db.query("delete from identidades where uid = any($1)", [creados]);
    await db.end();
  });

  test("asignar-admin: le da el rol Administrador a la cuenta, lo audita y se puede repetir", async () => {
    const env = { ...process.env, DATABASE_ADMIN_URL: ADMIN_URL };
    const { stdout } = await ejecutar(process.execPath, ["--experimental-strip-types", SCRIPT, admin.email.toUpperCase()], { env });
    assert.match(stdout, /ahora tiene el rol Administrador/);

    const [fila] = await auditoria("admin.rol.asignar_sistema", { recursoId: admin.uid });
    assert.ok(fila, "quedó en la auditoría");
    assert.equal(fila.uid, null, "sin actor: lo hizo el dueño de la base");
    assert.equal(fila.detalle.via, "scripts/asignar-admin.mjs");

    const otra = await ejecutar(process.execPath, ["--experimental-strip-types", SCRIPT, admin.email], { env });
    assert.match(otra.stdout, /ya tenía el rol/);

    await assert.rejects(ejecutar(process.execPath, ["--experimental-strip-types", SCRIPT, `nadie-${sufijo}@pulso.test`], { env }), (err) => {
      assert.equal(err.code, 2);
      assert.match(err.stdout, /No hay ninguna cuenta/);
      return true;
    });

    const r = await admin.nav.pedir("GET", "/api/admin/permisos");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.permisos, [
      "auditoria.ver", "configuracion.editar", "errores.ver", "roles.gestionar", "usuarios.editar", "usuarios.ver",
    ]);
  });

  test("sin sesión: 401; con sesión pero sin permiso: 403 sin_permiso, y el rechazo queda auditado", async () => {
    const anonimo = new Navegador();
    assert.equal((await anonimo.pedir("GET", "/api/admin/usuarios")).status, 401);

    assert.deepEqual((await a.nav.pedir("GET", "/api/admin/permisos")).json, { permisos: [] });

    const casos = [
      ["GET", "/api/admin/usuarios", undefined, "admin.usuarios.ver"],
      ["GET", "/api/admin/auditoria", undefined, "admin.auditoria.ver"],
      ["GET", "/api/admin/errores", undefined, "admin.errores.ver"],
      ["GET", "/api/admin/configuracion", undefined, "admin.configuracion.ver"],
      ["POST", "/api/admin/roles", { nombre: "Intruso", permisos: ["usuarios.ver"] }, "admin.rol.crear"],
      ["PUT", `/api/admin/usuarios/${a.uid}/acceso`, { roles: [await idSistema()], permisos: [] }, "admin.usuario.acceso"],
      ["POST", `/api/admin/usuarios/${admin.uid}/contrasena`, { password: CLAVE_NUEVA }, "admin.usuario.contrasena"],
      ["PUT", "/api/admin/configuracion", { clave: "sesion_inactividad_minutos", valor: 5 }, "admin.configuracion.fijar"],
      ["POST", "/api/admin/errores/forzar", { tipo: "manejado" }, "admin.errores.forzar"],
    ];
    for (const [metodo, ruta, cuerpo, accion] of casos) {
      const r = await a.nav.pedir(metodo, ruta, cuerpo);
      assert.equal(r.status, 403, `${metodo} ${ruta}: ${r.texto}`);
      assert.equal(r.json.error, "sin_permiso");
      const [fila] = await auditoria(accion, { uid: a.uid, resultado: "denegado", motivo: "sin_permiso" });
      assert.ok(fila, `rechazo de ${accion} auditado`);
    }
    // El intento de darse el rol Administrador no cambió nada.
    const { rows } = await db.query("select count(*)::int as n from usuario_roles where uid = $1", [a.uid]);
    assert.equal(rows[0].n, 0);
    // Y el error de prueba no se forzó.
    const err = await db.query("select count(*)::int as n from errores where uid = $1", [a.uid]);
    assert.equal(err.rows[0].n, 0);
  });

  test("punto 5: rol nuevo asignado a 2 usuarios, con 2 permisos directos distintos para cada uno", async () => {
    const r = await admin.nav.pedir("POST", "/api/admin/roles", {
      nombre: `Soporte ${sufijo}`, descripcion: "Atiende a los usuarios", permisos: ["usuarios.ver", "auditoria.ver"],
    });
    assert.equal(r.status, 200, r.texto);
    soporte = r.json.rol;
    rolesCreados.push(soporte.id);
    assert.deepEqual(soporte.permisos, ["auditoria.ver", "usuarios.ver"]);

    // Mismo nombre con otras mayúsculas y espacios: es el mismo rol.
    const dup = await admin.nav.pedir("POST", "/api/admin/roles", { nombre: `  soporte   ${sufijo.toUpperCase()} `, permisos: [] });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.error, "nombre_en_uso");

    const ra = await admin.nav.pedir("PUT", `/api/admin/usuarios/${a.uid}/acceso`,
      { roles: [soporte.id], permisos: ["errores.ver", "configuracion.editar"] });
    assert.equal(ra.status, 200, ra.texto);
    const rb = await admin.nav.pedir("PUT", `/api/admin/usuarios/${b.uid}/acceso`,
      { roles: [soporte.id], permisos: ["roles.gestionar", "usuarios.editar"] });
    assert.equal(rb.status, 200, rb.texto);

    // Efectivos = rol ∪ directos, y cada uno dice de dónde sale.
    assert.deepEqual(efectivos(ra.json.usuario), ["auditoria.ver", "configuracion.editar", "errores.ver", "usuarios.ver"]);
    assert.deepEqual(efectivos(rb.json.usuario), ["auditoria.ver", "roles.gestionar", "usuarios.editar", "usuarios.ver"]);
    const origen = (u, p) => u.efectivos.find((e) => e.permiso === p).origenes;
    assert.deepEqual(origen(ra.json.usuario, "usuarios.ver"), [{ tipo: "rol", id: soporte.id, nombre: soporte.nombre }]);
    assert.deepEqual(origen(ra.json.usuario, "errores.ver"), [{ tipo: "directo" }]);
    assert.equal(ra.json.correos[a.uid], a.email);

    // La lista de roles muestra a los dos como miembros.
    const roles = await admin.nav.pedir("GET", "/api/admin/roles");
    const enLista = roles.json.roles.find((x) => x.id === soporte.id);
    assert.deepEqual([...enLista.miembros].sort(), [a.uid, b.uid].sort());

    // Y rigen: A ve usuarios (por el rol) y errores (directo), pero no gestiona roles.
    assert.deepEqual((await a.nav.pedir("GET", "/api/admin/permisos")).json.permisos,
      ["auditoria.ver", "configuracion.editar", "errores.ver", "usuarios.ver"]);
    assert.equal((await a.nav.pedir("GET", "/api/admin/usuarios")).status, 200);
    assert.equal((await a.nav.pedir("GET", "/api/admin/errores")).status, 200);
    assert.equal((await a.nav.pedir("POST", "/api/admin/roles", { nombre: "X de A", permisos: [] })).status, 403);
    assert.equal((await b.nav.pedir("GET", "/api/admin/errores")).status, 403);

    const [creacion] = await auditoria("admin.rol.crear", { uid: admin.uid, resultado: "ok", recursoId: String(soporte.id) });
    assert.deepEqual(creacion.detalle.despues.permisos, ["auditoria.ver", "usuarios.ver"]);
    const [acceso] = await auditoria("admin.usuario.acceso", { uid: admin.uid, resultado: "ok", recursoId: a.uid });
    assert.deepEqual(acceso.detalle.antes, { roles: [], directos: [], efectivos: [] });
    assert.deepEqual(acceso.detalle.despues.roles, [soporte.nombre]);
    assert.deepEqual(acceso.detalle.despues.directos, ["configuracion.editar", "errores.ver"]);
  });

  test("punto 8: dos roles a un mismo usuario y cambio de TODOS sus permisos", async () => {
    const r = await admin.nav.pedir("POST", "/api/admin/roles", {
      nombre: `Auditor ${sufijo}`, descripcion: "", permisos: ["auditoria.ver", "errores.ver"],
    });
    assert.equal(r.status, 200, r.texto);
    auditor = r.json.rol;
    rolesCreados.push(auditor.id);

    const uno = await admin.nav.pedir("PUT", `/api/admin/usuarios/${c.uid}/acceso`,
      { roles: [soporte.id, auditor.id], permisos: ["usuarios.editar"] });
    assert.equal(uno.status, 200, uno.texto);
    assert.deepEqual([...uno.json.usuario.roles].sort((x, y) => x - y), [soporte.id, auditor.id].sort((x, y) => x - y));
    assert.deepEqual(efectivos(uno.json.usuario), ["auditoria.ver", "errores.ver", "usuarios.editar", "usuarios.ver"]);
    // auditoria.ver lo dan los dos roles.
    const origenes = uno.json.usuario.efectivos.find((e) => e.permiso === "auditoria.ver").origenes.map((o) => o.nombre).sort();
    assert.deepEqual(origenes, [auditor.nombre, soporte.nombre].sort());

    // Ahora TODO distinto: un solo rol y otros permisos directos (los anteriores se quitan).
    const dos = await admin.nav.pedir("PUT", `/api/admin/usuarios/${c.uid}/acceso`,
      { roles: [auditor.id], permisos: ["configuracion.editar", "roles.gestionar"] });
    assert.equal(dos.status, 200, dos.texto);
    assert.deepEqual(dos.json.usuario.directos, ["configuracion.editar", "roles.gestionar"]);
    assert.deepEqual(efectivos(dos.json.usuario), ["auditoria.ver", "configuracion.editar", "errores.ver", "roles.gestionar"]);

    const [fila] = await auditoria("admin.usuario.acceso", { uid: admin.uid, resultado: "ok", recursoId: c.uid });
    assert.deepEqual(fila.detalle.antes.efectivos, ["auditoria.ver", "errores.ver", "usuarios.editar", "usuarios.ver"]);
    assert.deepEqual(fila.detalle.despues.efectivos, ["auditoria.ver", "configuracion.editar", "errores.ver", "roles.gestionar"]);

    // Rige en la próxima petición: ya no ve usuarios, sí la configuración.
    assert.equal((await c.nav.pedir("GET", "/api/admin/usuarios")).status, 403);
    assert.equal((await c.nav.pedir("GET", "/api/admin/configuracion")).status, 200);

    // Editar el rol cambia a sus miembros: sin errores.ver en el rol, C lo pierde.
    const ed = await admin.nav.pedir("PUT", `/api/admin/roles/${auditor.id}`,
      { nombre: auditor.nombre, descripcion: "Solo auditoría", permisos: ["auditoria.ver"] });
    assert.equal(ed.status, 200, ed.texto);
    assert.equal((await c.nav.pedir("GET", "/api/admin/errores")).status, 403);
    const [edicion] = await auditoria("admin.rol.editar", { uid: admin.uid, recursoId: String(auditor.id) });
    assert.deepEqual(edicion.detalle.antes.permisos, ["auditoria.ver", "errores.ver"]);
    assert.deepEqual(edicion.detalle.despues.permisos, ["auditoria.ver"]);
    assert.equal(edicion.detalle.miembros_afectados, 1);
  });

  test("el rol de sistema no se borra ni se edita, y siempre queda un administrador", async () => {
    const sistema = await idSistema();
    const borrar = await admin.nav.pedir("DELETE", `/api/admin/roles/${sistema}`);
    assert.equal(borrar.status, 409);
    assert.equal(borrar.json.error, "rol_de_sistema");
    const editar = await admin.nav.pedir("PUT", `/api/admin/roles/${sistema}`, { nombre: "Administrador", permisos: [] });
    assert.equal(editar.status, 409);
    assert.equal(editar.json.error, "rol_de_sistema");
    assert.ok((await auditoria("admin.rol.borrar", { uid: admin.uid, resultado: "denegado", motivo: "rol_de_sistema" })).length);
    const { rows } = await db.query("select count(*)::int as n from rol_permisos where rol_id = $1", [sistema]);
    assert.equal(rows[0].n, 6, "sigue con los 6 permisos");

    // Ni el dueño de la base lo rompe con DML a mano (triggers).
    const conTransaccion = async (fn) => {
      const cx = await db.connect();
      try { await cx.query("begin"); return await fn(cx); } finally { await cx.query("rollback"); cx.release(); }
    };
    await conTransaccion(async (cx) => {
      await assert.rejects(cx.query("delete from roles where sistema"), /pulso_rol_de_sistema/);
    });
    await conTransaccion(async (cx) => {
      await assert.rejects(cx.query("delete from rol_permisos where rol_id = $1", [sistema]), /pulso_rol_de_sistema/);
    });
    await conTransaccion(async (cx) => {
      await assert.rejects(cx.query("delete from usuario_roles where rol_id = $1", [sistema]), /pulso_ultimo_administrador/);
    });

    // Quitarse el rol siendo el único administrador: la base lo rechaza. Se
    // prueba en una transacción que deja al admin de la prueba como único (y se deshace).
    await conTransaccion(async (cx) => {
      await cx.query("delete from usuario_roles where rol_id = $1 and uid <> $2", [sistema, admin.uid]);
      await cx.query("set local role pulso_app");
      const { rows: [r] } = await cx.query("select pulso_admin_fijar_acceso($1, $2, '{}', '{}', null) as r",
        [hash(admin.nav.token), admin.uid]);
      assert.equal(r.r.error, "ultimo_administrador");
    });
    const { rows: [{ n: admins }] } = await db.query("select count(*)::int as n from usuario_roles where rol_id = $1", [sistema]);
    if (admins === 1) {
      const r = await admin.nav.pedir("PUT", `/api/admin/usuarios/${admin.uid}/acceso`, { roles: [], permisos: [] });
      assert.equal(r.status, 409);
      assert.equal(r.json.error, "ultimo_administrador");
    }

    // Con dos administradores, a uno se le puede quitar.
    const dar = await admin.nav.pedir("PUT", `/api/admin/usuarios/${c.uid}/acceso`, { roles: [sistema], permisos: [] });
    assert.equal(dar.status, 200, dar.texto);
    const quitar = await admin.nav.pedir("PUT", `/api/admin/usuarios/${c.uid}/acceso`, { roles: [], permisos: [] });
    assert.equal(quitar.status, 200, quitar.texto);
    assert.deepEqual(quitar.json.usuario.efectivos, []);

    // El derecho de supresión no queda bloqueado: borrar la identidad entera
    // del único administrador sí se puede (la membresía cae en cascada).
    await conTransaccion(async (cx) => {
      await cx.query("delete from usuario_roles where rol_id = $1 and uid <> $2", [sistema, admin.uid]);
      await cx.query("delete from identidades where uid = $1", [admin.uid]);
    });
  });

  test("no se otorga lo que uno no tiene: usuarios.editar no alcanza para escalar privilegios", async () => {
    // B: usuarios.ver y auditoria.ver (rol Soporte) + roles.gestionar y usuarios.editar (directos).
    const sistema = await idSistema();
    const casos = [
      ["PUT", `/api/admin/usuarios/${b.uid}/acceso`, { roles: [soporte.id, sistema], permisos: ["roles.gestionar", "usuarios.editar"] }],
      ["PUT", `/api/admin/usuarios/${b.uid}/acceso`, { roles: [soporte.id], permisos: ["roles.gestionar", "usuarios.editar", "configuracion.editar"] }],
      // A tiene configuracion.editar, que B no: B no puede tocarlo.
      ["PUT", `/api/admin/usuarios/${a.uid}/acceso`, { roles: [], permisos: [] }],
      // Ni cambiarle la contraseña a quien tiene más permisos (tomar su cuenta).
      ["POST", `/api/admin/usuarios/${admin.uid}/contrasena`, { password: CLAVE_NUEVA }],
      ["POST", "/api/admin/roles", { nombre: `Escalada ${sufijo}`, permisos: ["configuracion.editar"] }],
      ["PUT", `/api/admin/roles/${soporte.id}`, { nombre: soporte.nombre, permisos: ["usuarios.ver", "auditoria.ver", "errores.ver"] }],
    ];
    for (const [metodo, ruta, cuerpo] of casos) {
      const r = await b.nav.pedir(metodo, ruta, cuerpo);
      assert.equal(r.status, 403, `${metodo} ${ruta}: ${r.texto}`);
      assert.equal(r.json.error, "privilegios_insuficientes");
    }
    assert.ok((await auditoria("admin.usuario.acceso", { uid: b.uid, motivo: "privilegios_insuficientes" })).length >= 3);
    assert.deepEqual((await b.nav.pedir("GET", "/api/admin/permisos")).json.permisos,
      ["auditoria.ver", "roles.gestionar", "usuarios.editar", "usuarios.ver"], "sus permisos no cambiaron");

    // Dentro de lo que tiene, sí puede.
    const propio = await b.nav.pedir("POST", "/api/admin/roles", { nombre: `Lector ${sufijo}`, permisos: ["usuarios.ver"] });
    assert.equal(propio.status, 200, propio.texto);
    rolesCreados.push(propio.json.rol.id);
  });

  test("punto 7: una contraseña de 1 carácter se rechaza en el servidor y en la base, aunque se saltee zod", async () => {
    const antes = (await db.query("select password_hash from cuentas where uid = $1", [a.uid])).rows[0].password_hash;

    const r = await admin.nav.pedir("POST", `/api/admin/usuarios/${a.uid}/contrasena`, { password: "x" });
    assert.equal(r.status, 400, r.texto);
    assert.equal(r.json.error, "contrasena_invalida");
    assert.ok(Array.isArray(r.json.reglas) && r.json.reglas.length > 0, "dice qué regla falla");
    assert.ok(r.json.reglas.some((m) => /10/.test(m)), `menciona el mínimo: ${r.json.reglas}`);
    const [fila] = await auditoria("admin.usuario.contrasena", { uid: admin.uid, resultado: "denegado", motivo: "contrasena_invalida", recursoId: a.uid });
    assert.ok(fila, "el rechazo quedó auditado");

    // Directo a la base como la app, sin pasar por zod: la base la rechaza igual.
    await comoApp(async (cx) => {
      const { rows: [x] } = await cx.query("select pulso_admin_cambiar_contrasena($1, $2, $3, null) as r",
        [hash(admin.nav.token), a.uid, "x"]);
      assert.deepEqual(x.r, { error: "contrasena_invalida" });
    });
    const despues = (await db.query("select password_hash from cuentas where uid = $1", [a.uid])).rows[0].password_hash;
    assert.equal(despues, antes, "la contraseña no cambió");

    // La propia no se cambia por acá.
    const propia = await admin.nav.pedir("POST", `/api/admin/usuarios/${admin.uid}/contrasena`, { password: CLAVE_NUEVA });
    assert.equal(propia.status, 409);
    assert.equal(propia.json.error, "es_tu_cuenta");
  });

  test("punto 7: un cambio válido cierra todas las sesiones del usuario (motivo 'admin') y entra con la nueva", async () => {
    assert.equal((await a.nav.pedir("GET", "/api/admin/permisos")).status, 200, "antes la sesión sirve");

    const r = await admin.nav.pedir("POST", `/api/admin/usuarios/${a.uid}/contrasena`, { password: CLAVE_NUEVA });
    assert.equal(r.status, 200, r.texto);
    assert.ok(r.json.sesiones_revocadas >= 1);
    assert.equal(r.json.correos, undefined, "no devuelve el correo");

    const { rows } = await db.query(
      "select revocada_at is not null as revocada, revocada_motivo from sesiones where uid = $1 and created_at < now()", [a.uid]);
    assert.ok(rows.length >= 1 && rows.every((s) => s.revocada), "todas revocadas");
    assert.ok(rows.some((s) => s.revocada_motivo === "admin"));

    const vieja = await a.nav.pedir("GET", "/api/admin/permisos");
    assert.equal(vieja.status, 401, "la sesión vieja ya no sirve");

    const otra = new Navegador();
    await otra.pedir("POST", "/api/sesion", {});
    assert.equal((await otra.pedir("POST", "/api/cuenta/login", { email: a.email, password: CLAVE })).status, 401);
    assert.equal((await otra.pedir("POST", "/api/cuenta/login", { email: a.email, password: CLAVE_NUEVA })).status, 200);
    a.nav = otra;

    const [fila] = await auditoria("admin.usuario.contrasena", { uid: admin.uid, resultado: "ok", recursoId: a.uid });
    assert.ok(fila.detalle.sesiones_revocadas >= 1);
    const todo = JSON.stringify((await db.query("select detalle from auditoria where accion like 'admin.%'")).rows);
    assert.ok(!todo.includes(CLAVE_NUEVA), "la contraseña no está en la auditoría");

    const aviso = await correoPara(a.email, "administrador");
    assert.match(aviso.Text, /cambió la contraseña/);
  });

  test("punto 17: el error forzado responde 500 sin detalle y aparece en `errores` y en el panel", async () => {
    const r = await admin.nav.pedir("POST", "/api/admin/errores/forzar", { tipo: "manejado" });
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: "error_interno" });
    assert.ok(!/ErrorDePrueba|at /.test(r.texto), "sin stack para el cliente");

    const { rows: [fila] } = await db.query(
      "select * from errores where origen = 'api:admin.errores.forzar' and uid = $1 order by id desc limit 1", [admin.uid]);
    assert.ok(fila, "quedó en la tabla errores");
    assert.match(fila.mensaje, /Error de prueba forzado/);
    assert.ok(fila.stack, "con el stack");
    assert.ok(fila.stack.length <= 4000);
    assert.match(fila.ip, /::\/48$/, "IP anonimizada");

    const lista = await admin.nav.pedir("GET", "/api/admin/errores");
    assert.equal(lista.status, 200);
    assert.equal(lista.json.errores[0].id, Number(fila.id), "es el primero de la lista");
    assert.equal(lista.json.correos[admin.uid], admin.email);
    assert.ok((await auditoria("admin.errores.forzar", { uid: admin.uid, resultado: "error" })).length);

    // El no manejado sale de la ruta sin atrapar: lo registra onRequestError (instrumentation.ts).
    const n = await admin.nav.pedir("POST", "/api/admin/errores/forzar", { tipo: "no_manejado" });
    assert.equal(n.status, 500);
    let capturado = null;
    for (let i = 0; i < 20 && !capturado; i++) {
      const { rows } = await db.query(
        "select * from errores where origen = 'route:/api/admin/errores/forzar' and id > $1 order by id desc limit 1", [fila.id]);
      capturado = rows[0] ?? null;
      if (!capturado) await new Promise((res) => setTimeout(res, 250));
    }
    assert.ok(capturado, "onRequestError lo registró");
    assert.equal(capturado.detalle.no_manejado, true);
    assert.equal(capturado.detalle.metodo, "POST");
    assert.equal(capturado.uid, admin.uid);
  });

  test("pulso_registrar_error recorta mensaje y stack, y la app escribe errores pero no los lee", async () => {
    await comoApp(async (cx) => {
      const { rows: [r] } = await cx.query(
        "select pulso_registrar_error($1, $2, $3, null, null, null) as ok", [`prueba:tope-${sufijo}`, "x".repeat(5000), "y".repeat(9000)]);
      assert.equal(r.ok, true);
      await cx.query("savepoint leer");
      await assert.rejects(cx.query("select * from errores limit 1"), (err) => err.code === "42501", "la app no lee `errores`");
      await cx.query("rollback to savepoint leer");
      await cx.query("reset role");
      const { rows: [e] } = await cx.query(
        "select length(mensaje) as m, length(stack) as s from errores where origen = $1", [`prueba:tope-${sufijo}`]);
      assert.equal(e.m, 1000);
      assert.equal(e.s, 4000);
    });
  });

  test("puntos 10 y 11 (C1): fijar_config valida los límites, audita el antes y el después y rige enseguida", async () => {
    const { rows: [{ valor: original }] } = await db.query("select valor from configuracion where clave = 'sesion_inactividad_minutos'");
    for (const valor of [0, 1441]) {
      const r = await admin.nav.pedir("PUT", "/api/admin/configuracion", { clave: "sesion_inactividad_minutos", valor });
      assert.equal(r.status, 400, `${valor}: ${r.texto}`);
      assert.equal(r.json.error, "fuera_de_rango");
      assert.equal(r.json.maximo, 1440);
    }
    const nuevo = original === 45 ? 46 : 45;
    const r = await admin.nav.pedir("PUT", "/api/admin/configuracion", { clave: "sesion_inactividad_minutos", valor: nuevo });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.configuracion.valor, nuevo);
    assert.equal(r.json.configuracion.actualizada_por, admin.uid);
    assert.equal(r.json.correos[admin.uid], admin.email, "con el correo de quien lo cambió");
    await comoApp(async (cx) => {
      const { rows: [x] } = await cx.query("select pulso_config('sesion_inactividad_minutos') as v");
      assert.equal(x.v, nuevo, "pulso_config ya devuelve el valor nuevo");
    });
    const [fila] = await auditoria("admin.configuracion.fijar", { uid: admin.uid, resultado: "ok" });
    assert.deepEqual(fila.detalle, { clave: "sesion_inactividad_minutos", antes: original, despues: nuevo });

    const desconocida = await admin.nav.pedir("PUT", "/api/admin/configuracion", { clave: "no_existe", valor: 5 });
    assert.equal(desconocida.status, 404);

    const lista = await admin.nav.pedir("GET", "/api/admin/configuracion");
    const claves = lista.json.configuracion.map((x) => x.clave);
    assert.ok(claves.includes("token_inactividad_minutos") && claves.includes("sesion_inactividad_minutos"));
    assert.equal(lista.json.correos[admin.uid], admin.email);
  });

  test("punto 9: la auditoría muestra los cambios del administrador con su detalle, filtrable y paginada", async () => {
    const q = new URLSearchParams({ accion: "admin.", usuario: a.uid });
    const r = await admin.nav.pedir("GET", `/api/admin/auditoria?${q}`);
    assert.equal(r.status, 200, r.texto);
    const acceso = r.json.eventos.find((e) => e.accion === "admin.usuario.acceso" && e.recurso_id === a.uid && e.resultado === "ok");
    assert.ok(acceso, "está el cambio de acceso de A");
    assert.equal(acceso.uid, admin.uid);
    assert.ok(acceso.detalle.antes && acceso.detalle.despues);
    assert.equal(r.json.correos[admin.uid], admin.email, "el actor se ve con su correo");
    assert.equal(r.json.correos[a.uid], a.email, "y el usuario afectado también");
    assert.ok(r.json.eventos.every((e) => e.accion.startsWith("admin.")));
    assert.ok(r.json.eventos.every((e) => e.uid === a.uid || e.recurso_id === a.uid));

    const denegados = await admin.nav.pedir("GET", `/api/admin/auditoria?accion=admin.usuarios.ver&resultado=denegado`);
    assert.ok(denegados.json.eventos.some((e) => e.uid === a.uid && e.detalle.motivo === "sin_permiso"));
    assert.ok(denegados.json.eventos.every((e) => e.resultado === "denegado"));

    const futuro = new Date(Date.now() + 86_400_000).toISOString();
    assert.deepEqual((await admin.nav.pedir("GET", `/api/admin/auditoria?desde=${encodeURIComponent(futuro)}`)).json.eventos, []);

    const p1 = await admin.nav.pedir("GET", "/api/admin/auditoria?accion=admin.&limite=2");
    assert.equal(p1.json.eventos.length, 2);
    assert.ok(p1.json.siguiente);
    const p2 = await admin.nav.pedir("GET", `/api/admin/auditoria?accion=admin.&limite=2&antes=${p1.json.siguiente}`);
    assert.ok(p2.json.eventos.every((e) => e.id < p1.json.eventos[1].id), "la página 2 sigue después de la 1");

    const mal = await admin.nav.pedir("GET", "/api/admin/auditoria?desde=ayer");
    assert.equal(mal.status, 400);
  });

  test("la app no puede leer ni tocar las tablas de administración (solo las funciones)", async () => {
    const consultas = [
      ...["permisos", "roles", "rol_permisos", "usuario_roles", "usuario_permisos", "errores"].map((t) => `select * from ${t} limit 1`),
      "insert into usuario_roles (uid, rol_id) select uid, 1 from identidades limit 1",
      // Las internas tampoco: ni la del primer administrador ni la de permisos.
      `select pulso_admin_asignar_rol_sistema('${a.uid}', 'x')`,
      `select pulso_permisos_de('${a.uid}')`,
    ];
    for (const sql of consultas) {
      await comoApp(async (cx) => {
        await assert.rejects(cx.query(sql), (err) => err.code === "42501", sql);
      });
    }
  });

  test("borrar un rol se lo quita a sus miembros y queda auditado con quiénes eran", async () => {
    const r = await admin.nav.pedir("DELETE", `/api/admin/roles/${soporte.id}`);
    assert.equal(r.status, 200, r.texto);
    const { rows } = await db.query("select count(*)::int as n from usuario_roles where rol_id = $1", [soporte.id]);
    assert.equal(rows[0].n, 0);
    const [fila] = await auditoria("admin.rol.borrar", { uid: admin.uid, resultado: "ok", recursoId: String(soporte.id) });
    assert.deepEqual([...fila.detalle.antes.miembros].sort(), [a.uid, b.uid].sort());
    // A conserva sus permisos directos.
    assert.deepEqual((await a.nav.pedir("GET", "/api/admin/permisos")).json.permisos, ["configuracion.editar", "errores.ver"]);
  });
});
