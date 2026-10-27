// Pruebas del cifrado de los datos de salud (integrador, punto 19).
//
//   BASE_URL=http://127.0.0.1:3205 DATABASE_ADMIN_URL=postgres://postgres:…@127.0.0.1:55445/pulso \
//   MAILPIT_URL=http://127.0.0.1:18025 PULSO_CLAVE_DATOS=… \
//     node --experimental-strip-types --test tests/integrador/cifrado.test.mjs
//
// Corren contra un servidor local y su base DESCARTABLE (nunca producción):
// crean cuentas, alteran filas a propósito y crean y borran una base temporal
// para la migración. PULSO_CLAVE_DATOS tiene que ser la misma del servidor:
// con ella la prueba descifra lo que ve en la base. Sin las variables, se
// saltean. `--experimental-strip-types` hace falta en Node 22 (importa los .ts
// de cifrado); desde Node 23.6 ya viene activado.

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { cifrar, descifrar } from "../../src/lib/seguridad/cifrado.ts";
import { CAMPOS_METRICA, CAMPOS_PERFIL, crearCifradoSalud } from "../../src/lib/db/salud-cifrada.ts";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = (process.env.BASE_URL ?? "").replace(/\/+$/, "");
const ADMIN = process.env.DATABASE_ADMIN_URL;
const MAILPIT = (process.env.MAILPIT_URL ?? "").replace(/\/+$/, "");

if (/agustinynatalia\.site/.test(BASE) || /agustinynatalia\.site/.test(ADMIN ?? "")) {
  throw new Error("Estas pruebas alteran datos: no se corren contra producción.");
}

const SIN_BASE = !ADMIN ? "falta DATABASE_ADMIN_URL (base descartable)" : !process.env.PULSO_CLAVE_DATOS ? "falta PULSO_CLAVE_DATOS (la del servidor)" : false;
const SIN_APP = SIN_BASE || (!BASE ? "falta BASE_URL" : !MAILPIT ? "falta MAILPIT_URL" : false);

// Los errores de descifrado se descartan en silencio en estas pruebas: los
// casos que los provocan los afirman ellos mismos.
const salud = crearCifradoSalud({ cifrar, descifrar }, () => {});
const FORMATO = /^v1\.[A-Za-z0-9_-]+$/;
const hash = (t) => createHash("sha256").update(t).digest("hex");
/** IP de documentación (RFC 3849) nueva por cuenta: no se gastan los límites por IP. */
const nuevaIp = () => `2001:db8:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::5`;

let admin;
before(() => {
  if (!SIN_BASE) admin = new pg.Pool({ connectionString: ADMIN, max: 3 });
});
after(async () => {
  await admin?.end();
});

// ─── Cuenta activada contra el servidor ──────────────────────────────────────

async function enlaceDeActivacion(email) {
  for (let i = 0; i < 40; i++) {
    const r = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    for (const m of r.messages ?? []) {
      const cuerpo = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
      const token = `${cuerpo.Text ?? ""} ${cuerpo.HTML ?? ""}`.match(/activar\?token=([A-Za-z0-9_-]{43})/)?.[1];
      if (token) return token;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no llegó el correo de activación a ${email}`);
}

/** Sesión Bearer de una cuenta activada nueva: { token, uid, api }. */
async function cuentaActivada() {
  const ip = nuevaIp();
  const h = { "X-Forwarded-For": ip, "Content-Type": "application/json" };
  const s = await fetch(`${BASE}/api/movil/v1/sesion`, { method: "POST", headers: h });
  assert.equal(s.status, 200, "sesión nueva");
  const { token } = await s.json();
  const auth = { ...h, Authorization: `Bearer ${token}` };
  const email = `cifrado.${randomBytes(5).toString("hex")}@pulso.test`;
  const reg = await fetch(`${BASE}/api/cuenta/registro`, {
    method: "POST", headers: auth, body: JSON.stringify({ email, password: "Rio#Verde-7429xQ" }),
  });
  assert.equal(reg.status, 200, `registro: ${await reg.clone().text()}`);
  const act = await fetch(`${BASE}/api/cuenta/activar`, {
    method: "POST", headers: h, body: JSON.stringify({ token: await enlaceDeActivacion(email) }),
  });
  assert.equal(act.status, 200, "activación");
  const { rows } = await admin.query("select uid from sesiones where token_hash = $1", [hash(token)]);

  async function api(metodo, ruta, cuerpo) {
    const r = await fetch(`${BASE}/api/movil/v1/${ruta}`, {
      method: metodo, headers: auth, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const texto = await r.text();
    assert.equal(r.status, 200, `${metodo} ${ruta}: ${r.status} ${texto.slice(0, 200)}`);
    return JSON.parse(texto);
  }
  return { token, uid: rows[0].uid, api };
}

// ─── Base actual (nueva o ya migrada) ────────────────────────────────────────

describe("esquema", { skip: SIN_BASE }, () => {
  test("metricas y perfil no tienen columnas en claro; el valor cifrado es obligatorio", async () => {
    const { rows } = await admin.query(
      `select table_name, column_name, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name in ('metricas', 'perfil')`
    );
    const cols = new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, r.is_nullable]));
    for (const c of ["metricas.valor", "metricas.notas", "perfil.edad", "perfil.sexo", "perfil.altura_cm", "perfil.fumador"]) {
      assert.ok(!cols.has(c), `${c} no tendría que existir`);
    }
    for (const c of [...Object.values(CAMPOS_METRICA).map((x) => `metricas.${x.columna}`),
                     ...Object.values(CAMPOS_PERFIL).map((x) => `perfil.${x.columna}`)]) {
      assert.ok(cols.has(c), `falta ${c}`);
    }
    assert.equal(cols.get("metricas.valor_cifrado"), "NO");
    const { rows: trg } = await admin.query(
      "select tgname from pg_trigger where tgrelid in ('metricas'::regclass, 'perfil'::regclass) and not tgisinternal"
    );
    assert.deepEqual(trg, [], "sin triggers de transición");
  });
});

// ─── La app cifra al guardar y descifra al leer ──────────────────────────────

describe("datos de salud cifrados en reposo", { skip: SIN_APP }, () => {
  let c;
  before(async () => {
    c = await cuentaActivada();
    await c.api("POST", "metricas", { tipo: "peso", valor: 81.3, notas: "después de correr 5 km" });
    await c.api("POST", "metricas", { tipo: "frecuencia_cardiaca", valor: 64 });
    await c.api("PUT", "perfil", { edad: 47, sexo: "f", altura_cm: 163, fumador: true });
  });

  test("como dueño de la base se ve v1.… y no el número ni las notas", async () => {
    const { rows } = await admin.query("select * from metricas where uid = $1 order by tipo", [c.uid]);
    assert.equal(rows.length, 2);
    const peso = rows.find((r) => r.tipo === "peso");
    assert.match(peso.valor_cifrado, FORMATO);
    assert.match(peso.notas_cifrado, FORMATO);
    assert.equal(peso.valor, undefined, "no hay columna `valor`");
    const crudo = JSON.stringify(rows);
    for (const dato of ["81.3", "64", "correr"]) assert.ok(!crudo.includes(dato), `"${dato}" aparece en claro en la base`);
    // Con la clave de la app sí se lee.
    assert.equal(salud.abrir(CAMPOS_METRICA.valor, peso.valor_cifrado), 81.3);
    assert.equal(salud.abrir(CAMPOS_METRICA.notas, peso.notas_cifrado), "después de correr 5 km");

    const { rows: [p] } = await admin.query("select * from perfil where uid = $1", [c.uid]);
    for (const campo of Object.values(CAMPOS_PERFIL)) {
      assert.match(p[campo.columna], FORMATO, campo.columna);
      assert.equal(p[campo.claro], undefined, `no hay columna \`${campo.claro}\``);
    }
    assert.equal(salud.abrir(CAMPOS_PERFIL.edad, p.edad_cifrado), 47);
    assert.equal(salud.abrir(CAMPOS_PERFIL.fumador, p.fumador_cifrado), true);
  });

  test("el largo del texto cifrado no delata el dato (fuma o no, 64 o 81.3)", async () => {
    const { rows } = await admin.query("select valor_cifrado from metricas where uid = $1", [c.uid]);
    const { rows: [p] } = await admin.query("select * from perfil where uid = $1", [c.uid]);
    const largos = new Set([...rows.map((r) => r.valor_cifrado.length),
                            ...Object.values(CAMPOS_PERFIL).map((x) => p[x.columna].length)]);
    assert.equal(largos.size, 1, `largos distintos: ${[...largos]}`);
    // Dos cifrados del mismo valor no se parecen (IV aleatorio).
    assert.notEqual(salud.sellar(CAMPOS_PERFIL.fumador, true), salud.sellar(CAMPOS_PERFIL.fumador, true));
  });

  test("la app devuelve los mismos números: últimas, historial, perfil e informe", async () => {
    const ultimas = await c.api("GET", "metricas/ultimas");
    const peso = ultimas.find((m) => m.tipo === "peso");
    assert.equal(peso.valor, 81.3);
    assert.equal(typeof peso.valor, "number");
    assert.equal(peso.notas, "después de correr 5 km");
    assert.equal(peso.unidad, "kg");
    assert.deepEqual(Object.keys(peso).sort(), ["created_at", "id", "notas", "tipo", "uid", "unidad", "valor"]);
    assert.equal(ultimas.find((m) => m.tipo === "frecuencia_cardiaca").valor, 64);

    const hist = await c.api("GET", "metricas/historial?tipo=peso&dias=30");
    assert.deepEqual(hist.map((m) => m.valor), [81.3]);

    const perfil = await c.api("GET", "perfil");
    assert.deepEqual(
      { edad: perfil.edad, sexo: perfil.sexo, altura_cm: perfil.altura_cm, fumador: perfil.fumador },
      { edad: 47, sexo: "f", altura_cm: 163, fumador: true }
    );

    // El motor recibe los números descifrados: IMC = 81.3 / 1.63², tabaquismo = 1, edad en el contexto.
    const informe = await c.api("GET", "informe");
    const imc = informe.riesgo.factores.find((f) => f.clave === "imc");
    assert.ok(Math.abs(imc.valor - 81.3 / 1.63 ** 2) < 0.01, `IMC ${imc.valor}`);
    assert.equal(informe.riesgo.factores.find((f) => f.clave === "tabaquismo").valor, 1);
    assert.ok(informe.riesgo.contexto.detalle.some((d) => d.startsWith("Edad 47")), "la edad llega al motor");
  });

  test("el upsert del día reemplaza el valor cifrado (sigue habiendo una fila)", async () => {
    await c.api("POST", "metricas", { tipo: "frecuencia_cardiaca", valor: 66.5 });
    const { rows } = await admin.query("select valor_cifrado from metricas where uid = $1 and tipo = 'frecuencia_cardiaca'", [c.uid]);
    assert.equal(rows.length, 1);
    assert.equal(salud.abrir(CAMPOS_METRICA.valor, rows[0].valor_cifrado), 66.5);
  });

  test("lo que cifra un script con el mismo módulo (seed, carga, migración) la app lo lee", async () => {
    await admin.query(
      "insert into metricas (uid, tipo, valor_cifrado, unidad, notas_cifrado, created_at) values ($1, 'glucosa', $2, 'mg/dL', $3, now() - interval '2 days')",
      [c.uid, salud.sellar(CAMPOS_METRICA.valor, 98.6), salud.sellar(CAMPOS_METRICA.notas, "cargada por un script")]
    );
    const hist = await c.api("GET", "metricas/historial?tipo=glucosa&dias=7");
    assert.deepEqual(hist.map((m) => [m.valor, m.notas]), [[98.6, "cargada por un script"]]);
  });

  test("la base rechaza un dato en claro en una columna cifrada", async () => {
    await assert.rejects(
      admin.query("update metricas set valor_cifrado = '81.3' where uid = $1", [c.uid]),
      (err) => err.code === "23514"
    );
    await assert.rejects(
      admin.query("update perfil set fumador_cifrado = 'true' where uid = $1", [c.uid]),
      (err) => err.code === "23514"
    );
  });

  test("un valor alterado no se descifra, y la app lo descarta sin romperse", async () => {
    const otra = await cuentaActivada();
    await otra.api("POST", "metricas", { tipo: "peso", valor: 70 });
    await otra.api("POST", "metricas", { tipo: "nivel_estres", valor: 3 });
    await otra.api("PUT", "perfil", { edad: 30, sexo: "m", altura_cm: 180, fumador: false });

    const { rows: [fila] } = await admin.query("select id, valor_cifrado from metricas where uid = $1 and tipo = 'peso'", [otra.uid]);
    // Un carácter cambiado en medio de los datos: sigue con el formato, pero el tag GCM no cierra.
    const i = 40;
    const alterado = fila.valor_cifrado.slice(0, i) + (fila.valor_cifrado[i] === "A" ? "B" : "A") + fila.valor_cifrado.slice(i + 1);
    assert.match(alterado, FORMATO);
    assert.throws(() => descifrar(alterado, "metricas.valor"));
    await admin.query("update metricas set valor_cifrado = $2 where id = $1", [fila.id, alterado]);

    // Un valor bueno copiado a otra columna tampoco: el contexto lo ata a la suya.
    const { rows: [estres] } = await admin.query("select valor_cifrado from metricas where uid = $1 and tipo = 'nivel_estres'", [otra.uid]);
    assert.throws(() => descifrar(estres.valor_cifrado, "perfil.edad"));
    await admin.query("update perfil set edad_cifrado = $2 where uid = $1", [otra.uid, estres.valor_cifrado]);

    const ultimas = await otra.api("GET", "metricas/ultimas");
    assert.deepEqual(ultimas.map((m) => [m.tipo, m.valor]), [["nivel_estres", 3]], "la métrica alterada se descarta, la otra se lee");
    const perfil = await otra.api("GET", "perfil");
    assert.equal(perfil.edad, null, "el campo ilegible queda vacío");
    assert.deepEqual([perfil.sexo, perfil.altura_cm, perfil.fumador], ["m", 180, false], "los demás campos se leen");
    const informe = await otra.api("GET", "informe");
    assert.equal(informe.metricas.peso, undefined);
    assert.ok(informe.metricas.nivel_estres);
  });
});

// ─── Migración desde el esquema de producción (b7ccd69) ──────────────────────

/** SQL de un archivo en un commit, o null si no hay git o el commit. */
function sqlDelCommit(commit, archivo) {
  try {
    return execFileSync("git", ["show", `${commit}:${archivo}`], { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/** Corre un script del repo contra la base temporal. Devuelve { status, salida }. */
function correr(args, env) {
  const r = spawnSync(process.execPath, args, { cwd: RAIZ, env, encoding: "utf8" });
  return { status: r.status, salida: `${r.stdout}${r.stderr}` };
}

const ESQUEMA_VIEJO = SIN_BASE ? null : [sqlDelCommit("b7ccd69", "db/schema.sql"), sqlDelCommit("b7ccd69", "db/seguridad.sql")];
const SIN_GIT = SIN_BASE || (ESQUEMA_VIEJO.some((s) => s === null) ? "no está el commit b7ccd69 (git)" : false);

describe("migración de una base con el esquema de producción", { skip: SIN_GIT }, () => {
  const nombre = `pulso_mig_${randomBytes(4).toString("hex")}`;
  let urlTemp;
  let db;
  let env;
  const ids = {};
  let uid;

  before(async () => {
    await admin.query(`create database ${nombre}`);
    const u = new URL(ADMIN);
    u.pathname = `/${nombre}`;
    urlTemp = u.toString();
    db = new pg.Pool({ connectionString: urlTemp, max: 2 });
    // Sin PULSO_APP_PASSWORD: el rol pulso_app es del servidor entero y ya está.
    env = { ...process.env, DATABASE_ADMIN_URL: urlTemp, NODE_NO_WARNINGS: "1" };
    delete env.PULSO_APP_PASSWORD;
    delete env.DATABASE_URL;

    // La base como está hoy en producción: esquema viejo y datos en claro.
    for (const sql of ESQUEMA_VIEJO) await db.query(sql);
    const { rows } = await db.query("select pulso_crear_sesion($1, 30) as uid", [hash(randomBytes(32).toString("hex"))]);
    uid = rows[0].uid;
    for (const [clave, tipo, valor, notas, dias] of [
      ["a", "peso", 80.25, "en ayunas", 3], ["b", "peso", 79.9, null, 2],
      ["c", "frecuencia_cardiaca", 71, null, 1], ["d", "glucosa", 0.1 + 0.2, "valor con decimales largos", 1],
    ]) {
      const r = await db.query(
        `insert into metricas (uid, tipo, valor, unidad, notas, created_at)
         values ($1, $2, $3, 'u', $4, now() - make_interval(days => $5)) returning id`,
        [uid, tipo, valor, notas, dias]
      );
      ids[clave] = r.rows[0].id;
    }
    await db.query("insert into perfil (uid, edad, sexo, altura_cm, fumador) values ($1, 52, 'otro', 170, null)", [uid]);
  });

  after(async () => {
    await db?.end();
    await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1", [nombre]);
    await admin.query(`drop database if exists ${nombre}`);
  });

  test("paso 1: setup-db agrega las columnas cifradas sin tocar el claro (dos veces seguidas)", async () => {
    for (let i = 0; i < 2; i++) {
      const r = correr(["scripts/setup-db.mjs"], env);
      assert.equal(r.status, 0, r.salida);
    }
    const { rows } = await db.query("select valor, valor_cifrado from metricas where id = $1", [ids.a]);
    assert.deepEqual(rows[0], { valor: 80.25, valor_cifrado: null });
    const { rows: n } = await db.query("select is_nullable from information_schema.columns where table_name = 'metricas' and column_name = 'valor'");
    assert.equal(n[0].is_nullable, "YES", "la versión nueva de la app no escribe `valor`");
  });

  test("transición: gana la última escritura (versión nueva cifra, versión vieja escribe en claro)", async () => {
    // La versión nueva actualiza `a`: lo viejo en claro se borra.
    await db.query("update metricas set valor_cifrado = $2, notas_cifrado = null where id = $1",
      [ids.a, salud.sellar(CAMPOS_METRICA.valor, 81)]);
    let { rows: [a] } = await db.query("select valor, notas, valor_cifrado from metricas where id = $1", [ids.a]);
    assert.equal(a.valor, null);
    assert.equal(a.notas, null);
    assert.match(a.valor_cifrado, FORMATO);

    // La versión nueva escribe `b` y después la vieja lo pisa en claro: el cifrado se borra.
    await db.query("update metricas set valor_cifrado = $2 where id = $1", [ids.b, salud.sellar(CAMPOS_METRICA.valor, 1)]);
    await db.query("update metricas set valor = 78.5, notas = 'pisado por la versión vieja' where id = $1", [ids.b]);
    const { rows: [b] } = await db.query("select valor, valor_cifrado from metricas where id = $1", [ids.b]);
    assert.deepEqual(b, { valor: 78.5, valor_cifrado: null });

    // Una fila nueva de la versión nueva: solo cifrada.
    const { rows: [e] } = await db.query(
      "insert into metricas (uid, tipo, valor_cifrado, unidad) values ($1, 'horas_sueno', $2, 'h') returning id",
      [uid, salud.sellar(CAMPOS_METRICA.valor, 7.5)]
    );
    ids.e = e.id;
    // El perfil, con la versión vieja.
    await db.query("update perfil set edad = 53 where uid = $1", [uid]);
    ({ rows: [a] } = await db.query("select count(*)::int as n from metricas"));
    assert.equal(a.n, 5);
  });

  test("paso 2: con otra clave la verificación falla y no se borra nada", async () => {
    const r = correr(["--experimental-strip-types", "scripts/migrar-cifrado-salud.mjs"],
      { ...env, PULSO_CLAVE_DATOS: randomBytes(32).toString("base64") });
    assert.equal(r.status, 1, r.salida);
    assert.match(r.salida, /no pasan la verificación/);
    const { rows } = await db.query("select count(*)::int as n from information_schema.columns where table_name = 'metricas' and column_name = 'valor'");
    assert.equal(rows[0].n, 1, "la columna en claro sigue ahí");
  });

  test("paso 2: --simular verifica todo y no cambia nada", async () => {
    const r = correr(["--experimental-strip-types", "scripts/migrar-cifrado-salud.mjs", "--simular"], env);
    assert.equal(r.status, 0, r.salida);
    assert.match(r.salida, /Simulación/);
    const { rows } = await db.query("select valor, valor_cifrado from metricas where id = $1", [ids.c]);
    assert.deepEqual(rows[0], { valor: 71, valor_cifrado: null });
  });

  test("paso 2: cifra, verifica y recién entonces borra el claro; los valores quedan exactos", async () => {
    const r = correr(["--experimental-strip-types", "scripts/migrar-cifrado-salud.mjs"], env);
    assert.equal(r.status, 0, r.salida);
    assert.match(r.salida, /métricas: 3 cifradas ahora, 5 verificadas/);

    const { rows: cols } = await db.query(
      `select column_name from information_schema.columns
        where table_name in ('metricas', 'perfil') and column_name in ('valor', 'notas', 'edad', 'sexo', 'altura_cm', 'fumador')`
    );
    assert.deepEqual(cols, [], "no quedan columnas en claro");

    const { rows } = await db.query("select id, valor_cifrado, notas_cifrado from metricas");
    const leer = (id) => {
      const f = rows.find((x) => x.id === id);
      return [salud.abrir(CAMPOS_METRICA.valor, f.valor_cifrado), salud.abrir(CAMPOS_METRICA.notas, f.notas_cifrado)];
    };
    assert.deepEqual(leer(ids.a), [81, null], "lo escribió la versión nueva");
    assert.deepEqual(leer(ids.b), [78.5, "pisado por la versión vieja"], "la última escritura fue de la vieja");
    assert.deepEqual(leer(ids.c), [71, null]);
    assert.deepEqual(leer(ids.d), [0.1 + 0.2, "valor con decimales largos"], "el double vuelve exacto");
    assert.deepEqual(leer(ids.e), [7.5, null]);

    const { rows: [p] } = await db.query("select * from perfil where uid = $1", [uid]);
    assert.deepEqual(
      Object.values(CAMPOS_PERFIL).map((x) => salud.abrir(x, p[x.columna])),
      [53, "otro", 170, null]
    );
    const { rows: aud } = await db.query("select detalle from auditoria where accion = 'datos.cifrar'");
    assert.deepEqual(aud.map((x) => x.detalle), [{ metricas: 3, perfiles: 1 }]);
  });

  test("después: setup-db y la migración vuelven a correr limpias (idempotentes)", async () => {
    for (let i = 0; i < 2; i++) {
      const r = correr(["scripts/setup-db.mjs"], env);
      assert.equal(r.status, 0, r.salida);
    }
    const r = correr(["--experimental-strip-types", "scripts/migrar-cifrado-salud.mjs"], env);
    assert.equal(r.status, 0, r.salida);
    assert.match(r.salida, /ya estaba migrada/);
    const { rows } = await db.query("select is_nullable from information_schema.columns where table_name = 'metricas' and column_name = 'valor_cifrado'");
    assert.equal(rows[0].is_nullable, "NO");
    const { rows: trg } = await db.query(
      "select tgname from pg_trigger where tgrelid in ('metricas'::regclass, 'perfil'::regclass) and not tgisinternal"
    );
    assert.deepEqual(trg, []);
  });
});
