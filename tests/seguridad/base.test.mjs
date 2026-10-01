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
