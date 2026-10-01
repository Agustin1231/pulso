// Pruebas de los controles de db/seguridad.sql contra una base real.
//
//   DATABASE_ADMIN_URL=postgres://dueño@... DATABASE_URL=postgres://pulso_app@... \
//     node --test tests/seguridad/base.test.mjs
//
// Necesita una base DESCARTABLE con schema.sql + seguridad.sql aplicados
// (npm run setup-db) y estos dos usuarios legado con datos ANTES de la
// migración (para que entren en uids_legado):
//   11111111-1111-4111-8111-111111111111 (métricas + perfil + receta)
//   22222222-2222-4222-8222-222222222222 (métrica + receta "Receta B")
// Las pruebas consumen los reclamos: para repetirlas, recrear la base.
// Sin las variables, las pruebas se saltean.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;
const saltear = !ADMIN || !APP ? "faltan DATABASE_ADMIN_URL / DATABASE_URL" : false;

const LEGADO_A = "11111111-1111-4111-8111-111111111111";
const LEGADO_B = "22222222-2222-4222-8222-222222222222";

let admin;
let app;

const nuevoHash = () => createHash("sha256").update(randomBytes(32)).digest("hex");

/** Corre `fn` en una transacción de pulso_app con `app.uid` fijado. */
async function comoUsuario(uid, fn) {
  const c = await app.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.uid', $1, true)", [uid]);
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => {});
    c.release();
  }
}

/** Espera que la promesa falle con un código de error de Postgres. */
async function fallaCon(promesa, codigo) {
  await assert.rejects(promesa, (err) => {
    assert.equal(err.code, codigo, `esperaba ${codigo}, vino ${err.code}: ${err.message}`);
    return true;
  });
}

before(async () => {
  if (saltear) return;
  admin = new pg.Pool({ connectionString: ADMIN });
  app = new pg.Pool({ connectionString: APP });
});

after(async () => {
  await admin?.end();
  await app?.end();
});

test("la app se conecta como pulso_app y no es superusuario", { skip: saltear }, async () => {
  const { rows } = await app.query(
    "select current_user as u, (select rolsuper from pg_roles where rolname = current_user) as su"
  );
  assert.equal(rows[0].u, "pulso_app");
  assert.equal(rows[0].su, false);
});

test("pulso_app no puede hacer DDL", { skip: saltear }, async () => {
  await fallaCon(app.query("create table intrusa (x int)"), "42501");
  await fallaCon(app.query("drop table metricas"), "42501");
});

test("las tablas de sistema no son legibles por la app", { skip: saltear }, async () => {
  for (const t of ["sesiones", "identidades", "uids_legado", "limites_tasa"]) {
    await fallaCon(app.query(`select * from ${t}`), "42501");
  }
});

test("sin app.uid no se ve ninguna fila (RLS cierra por defecto)", { skip: saltear }, async () => {
  const { rows } = await app.query("select count(*)::int as n from metricas");
  assert.equal(rows[0].n, 0);
  const { rows: admin_ } = await admin.query("select count(*)::int as n from metricas");
  assert.ok(admin_[0].n >= 2, "el dueño sí ve los datos legado");
});

test("un uid legado se reclama una sola vez", { skip: saltear }, async () => {
  const { rows: r1 } = await app.query("select pulso_reclamar_legado($1, $2, 30) as uid", [nuevoHash(), LEGADO_A]);
  assert.equal(r1[0].uid, LEGADO_A);
  const { rows: r2 } = await app.query("select pulso_reclamar_legado($1, $2, 30) as uid", [nuevoHash(), LEGADO_A]);
  assert.equal(r2[0].uid, null, "el segundo reclamo tiene que fallar");
});

test("no se puede reclamar un uid que nunca existió", { skip: saltear }, async () => {
  const inventado = "33333333-3333-4333-8333-333333333333";
  const { rows } = await app.query("select pulso_reclamar_legado($1, $2, 30) as uid", [nuevoHash(), inventado]);
  assert.equal(rows[0].uid, null);
});

test("sesión nueva: el uid lo genera la base; se resuelve y se revoca", { skip: saltear }, async () => {
  const h = nuevoHash();
  const { rows } = await app.query("select pulso_crear_sesion($1, 30) as uid", [h]);
  const uid = rows[0].uid;
  assert.match(uid, /^[0-9a-f-]{36}$/);

  const { rows: r1 } = await app.query("select pulso_resolver_sesion($1) as uid", [h]);
  assert.equal(r1[0].uid, uid);

  await app.query("select pulso_revocar_sesion($1)", [h]);
  const { rows: r2 } = await app.query("select pulso_resolver_sesion($1) as uid", [h]);
  assert.equal(r2[0].uid, null, "una sesión revocada no resuelve");
});

test("una sesión vencida no resuelve ni se renueva", { skip: saltear }, async () => {
  const h = nuevoHash();
  await app.query("select pulso_crear_sesion($1, 30)", [h]);
  await admin.query("update sesiones set expira_at = now() - interval '1 second' where token_hash = $1", [h]);
  const { rows: r1 } = await app.query("select pulso_resolver_sesion($1) as uid", [h]);
  assert.equal(r1[0].uid, null);
  const { rows: r2 } = await app.query("select pulso_renovar_sesion($1, 30) as uid", [h]);
  assert.equal(r2[0].uid, null);
});

test("RLS: cada usuario ve y toca solo lo suyo", { skip: saltear }, async () => {
  await comoUsuario(LEGADO_A, async (c) => {
    const { rows } = await c.query("select uid from metricas");
    assert.deepEqual([...new Set(rows.map((r) => r.uid))], [LEGADO_A]);

    // apuntando a las filas de B, no alcanza ninguna
    const upd = await c.query("update recetas_guardadas set titulo = 'pwned' where uid = $1", [LEGADO_B]);
    assert.equal(upd.rowCount, 0);
    const del = await c.query("delete from recetas_guardadas where uid = $1", [LEGADO_B]);
    assert.equal(del.rowCount, 0);

    // sin ningún filtro, solo alcanza las propias
    const todas = await c.query("update recetas_guardadas set titulo = titulo returning uid");
    assert.ok(todas.rows.every((r) => r.uid === LEGADO_A), "tocó filas de otro usuario");
  });

  // escribir a nombre de otro usuario viola el WITH CHECK
  await comoUsuario(LEGADO_A, async (c) => {
    await fallaCon(
      c.query("insert into metricas (uid, tipo, valor, unidad) values ($1, 'peso', 1, 'kg')", [LEGADO_B]),
      "42501"
    );
  });

  // la receta de B sigue intacta
  const { rows } = await admin.query("select titulo from recetas_guardadas where uid = $1", [LEGADO_B]);
  assert.equal(rows[0].titulo, "Receta B");
});

test("auditoría: la app inserta pero no lee; nadie modifica", { skip: saltear }, async () => {
  await app.query("insert into auditoria (accion, resultado) values ('prueba', 'ok')");
  await fallaCon(app.query("select * from auditoria"), "42501");
  await fallaCon(app.query("update auditoria set accion = 'x'"), "42501");

  // ni siquiera el dueño puede cambiar o borrar (trigger)
  await fallaCon(admin.query("update auditoria set accion = 'x'"), "P0001");
  await fallaCon(admin.query("delete from auditoria"), "P0001");
  await fallaCon(admin.query("truncate auditoria"), "P0001");
});

test("límite de tasa: corta al pasar el máximo", { skip: saltear }, async () => {
  const clave = `prueba:${nuevoHash()}`;
  const resultados = [];
  for (let i = 0; i < 4; i++) {
    const { rows } = await app.query("select pulso_consumir_tasa($1, 3, 3600) as ok", [clave]);
    resultados.push(rows[0].ok);
  }
  assert.deepEqual(resultados, [true, true, true, false]);
});

test("supresión: borra los datos del dueño de la sesión y nada más", { skip: saltear }, async () => {
  const h = nuevoHash();
  const { rows } = await app.query("select pulso_reclamar_legado($1, $2, 30) as uid", [h, LEGADO_B]);
  assert.equal(rows[0].uid, LEGADO_B);

  const { rows: r } = await app.query("select pulso_eliminar_datos($1) as uid", [h]);
  assert.equal(r[0].uid, LEGADO_B);

  const { rows: quedan } = await admin.query(
    "select (select count(*) from metricas where uid = $1)::int as b, (select count(*) from metricas where uid = $2)::int as a",
    [LEGADO_B, LEGADO_A]
  );
  assert.equal(quedan[0].b, 0, "los datos de B se borraron");
  assert.ok(quedan[0].a >= 1, "los de A siguen");

  const { rows: sesion } = await app.query("select pulso_resolver_sesion($1) as uid", [h]);
  assert.equal(sesion[0].uid, null, "la sesión se fue con la identidad");
});

test("las funciones de sesión no son ejecutables por otros roles", { skip: saltear }, async () => {
  const { rows } = await admin.query(
    "select has_function_privilege('pulso_auditor', 'pulso_crear_sesion(text,int)', 'execute') as puede"
  );
  assert.equal(rows[0].puede, false);
});

// ─── Fila 7: rotación del token ──────────────────────────────────────────────

test("rotación: un token de menos de un día solo se renueva", { skip: saltear }, async () => {
  const h = nuevoHash();
  const { rows: c } = await app.query("select pulso_crear_sesion($1, 30) as uid", [h]);
  const { rows } = await app.query("select * from pulso_renovar_o_rotar($1, $2, 30)", [h, nuevoHash()]);
  assert.deepEqual(rows[0], { uid: c[0].uid, rotada: false });
});

test("rotación: un token viejo se reemplaza y deja de servir", { skip: saltear }, async () => {
  const viejo = nuevoHash();
  const nuevo = nuevoHash();
  const { rows: c } = await app.query("select pulso_crear_sesion($1, 30) as uid", [viejo]);
  await admin.query("update sesiones set created_at = now() - interval '2 days' where token_hash = $1", [viejo]);

  const { rows } = await app.query("select * from pulso_renovar_o_rotar($1, $2, 30)", [viejo, nuevo]);
  assert.deepEqual(rows[0], { uid: c[0].uid, rotada: true });

  // el nuevo resuelve al mismo usuario
  const { rows: r1 } = await app.query("select pulso_resolver_sesion($1) as uid", [nuevo]);
  assert.equal(r1[0].uid, c[0].uid);

  // el viejo: no se vuelve a rotar ni a renovar (un token robado no se "refresca")
  const { rows: r2 } = await app.query("select * from pulso_renovar_o_rotar($1, $2, 30)", [viejo, nuevoHash()]);
  assert.equal(r2.length, 0);
  const { rows: r3 } = await app.query("select pulso_renovar_sesion($1, 30) as uid", [viejo]);
  assert.equal(r3[0].uid, null);

  // gracia de 2 minutos para peticiones en vuelo; vencida, no resuelve
  const { rows: g } = await admin.query("select expira_at <= now() + interval '2 minutes' as corta from sesiones where token_hash = $1", [viejo]);
  assert.equal(g[0].corta, true);
  await admin.query("update sesiones set expira_at = now() - interval '1 second' where token_hash = $1", [viejo]);
  const { rows: r4 } = await app.query("select pulso_resolver_sesion($1) as uid", [viejo]);
  assert.equal(r4[0].uid, null);
});

// ─── Fila 9: bloqueo con passkey ─────────────────────────────────────────────

async function sesionConBloqueo() {
  const h = nuevoHash();
  const { rows } = await app.query("select pulso_crear_sesion($1, 30) as uid", [h]);
  const uid = rows[0].uid;
  await comoUsuarioCommit(uid, (c) =>
    c.query("insert into credenciales_bloqueo (id, uid, clave_publica) values ($1, $2, '\\x00')", [nuevoHash().slice(0, 22), uid])
  );
  return { h, uid };
}

/** Como comoUsuario, pero haciendo commit. */
async function comoUsuarioCommit(uid, fn) {
  const c = await app.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.uid', $1, true)", [uid]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

test("bloqueo: con passkey registrada, sin desbloquear no hay uid", { skip: saltear }, async () => {
  const { h, uid } = await sesionConBloqueo();
  const { rows: r } = await app.query("select pulso_resolver_sesion($1) as uid", [h]);
  assert.equal(r[0].uid, null, "bloqueada: el servidor no resuelve el usuario");

  const { rows: e } = await app.query("select * from pulso_estado_sesion($1)", [h]);
  assert.deepEqual(e[0], { estado: "bloqueada", bloqueo: true });

  // el flujo de desbloqueo sí puede saber de quién es la sesión
  const { rows: t } = await app.query("select pulso_uid_de_token($1) as uid", [h]);
  assert.equal(t[0].uid, uid);

  // bloqueada no se pueden borrar los datos (lo frena el resolver)
  const { rows: d } = await app.query("select pulso_eliminar_datos($1) as uid", [h]);
  assert.equal(d[0].uid, null);
});

test("bloqueo: desbloquear abre la ventana, se desliza y 'bloquear ahora' la cierra", { skip: saltear }, async () => {
  const { h, uid } = await sesionConBloqueo();
  await app.query("select pulso_desbloquear($1)", [h]);
  const { rows: r1 } = await app.query("select pulso_resolver_sesion($1) as uid", [h]);
  assert.equal(r1[0].uid, uid);

  // con poco tiempo restante, usarla la corre
  await admin.query("update sesiones set desbloqueada_hasta = now() + interval '1 minute' where token_hash = $1", [h]);
  await app.query("select pulso_resolver_sesion($1)", [h]);
  const { rows: v } = await admin.query("select desbloqueada_hasta > now() + interval '10 minutes' as corrida from sesiones where token_hash = $1", [h]);
  assert.equal(v[0].corrida, true);

  await app.query("select pulso_bloquear($1)", [h]);
  const { rows: r2 } = await app.query("select pulso_resolver_sesion($1) as uid", [h]);
  assert.equal(r2[0].uid, null);
});

test("bloqueo: la ventana vencida vuelve a bloquear", { skip: saltear }, async () => {
  const { h } = await sesionConBloqueo();
  await app.query("select pulso_desbloquear($1)", [h]);
  await admin.query("update sesiones set desbloqueada_hasta = now() - interval '1 second' where token_hash = $1", [h]);
  const { rows } = await app.query("select pulso_resolver_sesion($1) as uid", [h]);
  assert.equal(rows[0].uid, null);
});

test("bloqueo: las passkeys de un usuario no las ve otro (RLS)", { skip: saltear }, async () => {
  await sesionConBloqueo();
  const { rows: c } = await app.query("select pulso_crear_sesion($1, 30) as uid", [nuevoHash()]);
  await comoUsuario(c[0].uid, async (cx) => {
    const { rows } = await cx.query("select count(*)::int as n from credenciales_bloqueo");
    assert.equal(rows[0].n, 0);
  });
});

test("desafío WebAuthn: de un solo uso, por tipo y con vencimiento", { skip: saltear }, async () => {
  const h = nuevoHash();
  await app.query("select pulso_crear_sesion($1, 30)", [h]);

  await app.query("select pulso_fijar_desafio($1, 'registro', 'abc')", [h]);
  const { rows: otro } = await app.query("select pulso_consumir_desafio($1, 'desbloqueo') as d", [h]);
  assert.equal(otro[0].d, null, "otro tipo no lo consume");
  const { rows: uno } = await app.query("select pulso_consumir_desafio($1, 'registro') as d", [h]);
  assert.equal(uno[0].d, "abc");
  const { rows: dos } = await app.query("select pulso_consumir_desafio($1, 'registro') as d", [h]);
  assert.equal(dos[0].d, null, "no se puede reusar");

  await app.query("select pulso_fijar_desafio($1, 'registro', 'xyz')", [h]);
  await admin.query("update sesiones set desafio_expira = now() - interval '1 second' where token_hash = $1", [h]);
  const { rows: vencido } = await app.query("select pulso_consumir_desafio($1, 'registro') as d", [h]);
  assert.equal(vencido[0].d, null);
});
