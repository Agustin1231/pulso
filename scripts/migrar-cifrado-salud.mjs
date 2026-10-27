#!/usr/bin/env node
/**
 * Paso 2 de la migración de los datos de salud a columnas cifradas
 * (integrador, punto 19). El paso 1 es db/cifrado.sql (npm run setup-db).
 *
 *   DATABASE_ADMIN_URL=postgres://dueño@… PULSO_CLAVE_DATOS=… \
 *     node --experimental-strip-types scripts/migrar-cifrado-salud.mjs [--simular]
 *
 * En UNA transacción, con `metricas` y `perfil` bloqueadas:
 *   1. borra los triggers de transición de db/cifrado.sql;
 *   2. cifra, desde las columnas en claro, toda fila que todavía tenga un dato
 *      en claro (por los triggers, el claro es siempre la última escritura);
 *   3. lee de vuelta TODAS las filas y las descifra con el mismo código que la
 *      app (src/lib/db/salud-cifrada.ts): cada métrica tiene que tener valor,
 *      todo tiene que descifrarse y, donde había claro, coincidir exactamente;
 *   4. solo si no falló ninguna, borra las columnas en claro y deja
 *      `valor_cifrado` como obligatorio.
 * Si algo no cuadra, rollback: no se toca nada y se listan las filas con
 * problema (id y campo, nunca el dato). Con --simular hace todo y al final
 * también deshace, para probar contra producción sin cambiar nada.
 *
 * Es idempotente: sobre una base ya migrada solo verifica que todo se
 * descifra (y si algo no, lo lista y sale con 1: sirve de chequeo). Necesita la MISMA PULSO_CLAVE_DATOS que la app (con otra, nada se
 * descifra y el paso 3 aborta) y el rol dueño, que no está sujeto a RLS:
 * `row_security = off` hace que, si lo estuviera, falle en vez de ver cero
 * filas y dar la migración por hecha.
 *
 * Corre con el Node de producción (22.11) y `--experimental-strip-types`: por
 * eso importa los .ts por ruta relativa y con extensión. No lee .env.local a
 * propósito: las variables se pasan explícitas.
 */
import pg from "pg";
import { cifrar, descifrar } from "../src/lib/seguridad/cifrado.ts";
import { CAMPOS_METRICA, CAMPOS_PERFIL, crearCifradoSalud } from "../src/lib/db/salud-cifrada.ts";

const SIMULAR = process.argv.includes("--simular");
const LOTE = 500;

const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) {
  console.error("✗ Falta DATABASE_ADMIN_URL (el rol dueño de la base).");
  process.exit(1);
}
if (!process.env.PULSO_CLAVE_DATOS) {
  console.error("✗ Falta PULSO_CLAVE_DATOS: la misma clave que usa la app.");
  process.exit(1);
}

// Mismos modos que src/lib/db/pool.ts (opcionesSsl).
function opcionesSsl() {
  const modo = process.env.PGSSL ?? "";
  if (modo === "verify-full") {
    const ca = process.env.PGSSL_CA?.replace(/\\n/g, "\n");
    if (!ca?.includes("BEGIN CERTIFICATE")) {
      throw new Error("PGSSL=verify-full necesita PGSSL_CA con el certificado de la CA en PEM.");
    }
    return { ca, rejectUnauthorized: true };
  }
  if (modo === "require") return { rejectUnauthorized: true };
  if (modo !== "") throw new Error(`PGSSL="${modo}" no es válido: verify-full, require o vacío.`);
  return undefined;
}

// En la verificación, un dato ilegible tiene que abortar, no descartarse.
const salud = crearCifradoSalud({ cifrar, descifrar });

const TABLAS = {
  metricas: { clave: "id", tipoClave: "uuid", campos: Object.values(CAMPOS_METRICA) },
  perfil:   { clave: "uid", tipoClave: "text", campos: Object.values(CAMPOS_PERFIL) },
};

const client = new pg.Client({ connectionString, ssl: opcionesSsl() });

/** Columnas que existen hoy en una tabla. */
async function columnas(tabla) {
  const { rows } = await client.query(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`,
    [tabla]
  );
  return new Set(rows.map((r) => r.column_name));
}

/** Cifra desde el claro las filas que todavía tienen un dato en claro. Devuelve cuántas. */
async function cifrarPendientes(tabla, { clave, tipoClave, campos }) {
  const conClaro = campos.map((c) => `${c.claro} is not null`).join(" or ");
  const { rows } = await client.query(
    `select ${clave} as clave, ${campos.map((c) => c.claro).join(", ")} from ${tabla} where ${conClaro}`
  );
  for (let i = 0; i < rows.length; i += LOTE) {
    const lote = rows.slice(i, i + LOTE);
    const columnasLote = campos.map((c) => lote.map((f) => salud.sellar(c, f[c.claro])));
    await client.query(
      `update ${tabla} t
          set ${campos.map((c, j) => `${c.columna} = u.c${j}`).join(", ")}
         from unnest($1::${tipoClave}[], ${campos.map((_, j) => `$${j + 2}::text[]`).join(", ")})
              as u(clave, ${campos.map((_, j) => `c${j}`).join(", ")})
        where t.${clave} = u.clave`,
      [lote.map((f) => f.clave), ...columnasLote]
    );
  }
  return rows.length;
}

/** Lee todas las filas y las descifra. Devuelve [filas verificadas, problemas]. */
async function verificar(tabla, { clave, campos }, conClaro) {
  const cols = campos.map((c) => c.columna).concat(conClaro ? campos.map((c) => c.claro) : []);
  const { rows } = await client.query(`select ${clave} as clave, ${cols.join(", ")} from ${tabla}`);
  const problemas = [];
  for (const f of rows) {
    // Una fila que tenía claro se cifró desde él: tiene que coincidir campo por campo.
    const veniaEnClaro = conClaro && campos.some((c) => f[c.claro] !== null);
    for (const c of campos) {
      let valor;
      try {
        valor = salud.abrir(c, f[c.columna]);
      } catch (err) {
        problemas.push(`${tabla} ${f.clave} ${c.columna}: ${err.message}`);
        continue;
      }
      if (c === CAMPOS_METRICA.valor && valor === null) {
        problemas.push(`${tabla} ${f.clave} ${c.columna}: falta el valor`);
      } else if (veniaEnClaro && valor !== f[c.claro]) {
        problemas.push(`${tabla} ${f.clave} ${c.columna}: no coincide con la columna en claro`);
      }
    }
  }
  return [rows.length, problemas];
}

try {
  await client.connect();
  const { rows: info } = await client.query("select current_database() as db, current_user as rol");
  console.log(`→ Conectado a "${info[0].db}" como ${info[0].rol}${SIMULAR ? " (simulación: al final se deshace todo)" : ""}`);

  await client.query("begin");
  await client.query("set local lock_timeout = '15s'");
  await client.query("set local row_security = off");

  // Nadie lee ni escribe las dos tablas mientras tanto (son unos segundos). Se
  // toma el lock más fuerte de entrada: subirlo después, con el `drop column`,
  // se puede trabar con una transacción de la app que leyó y quiere escribir.
  await client.query("lock table metricas, perfil in access exclusive mode");

  const resumen = {};
  let quedaClaro = false;
  for (const [tabla, def] of Object.entries(TABLAS)) {
    const hay = await columnas(tabla);
    const faltan = def.campos.filter((c) => !hay.has(c.columna)).map((c) => c.columna);
    if (faltan.length) throw new Error(`a ${tabla} le faltan ${faltan.join(", ")}: corré primero npm run setup-db (db/cifrado.sql)`);
    def.conClaro = def.campos.some((c) => hay.has(c.claro));
    quedaClaro ||= def.conClaro;
  }

  for (const [tabla, def] of Object.entries(TABLAS)) {
    resumen[tabla] = { cifradas: 0 };
    if (!def.conClaro) continue;
    await client.query(`drop trigger if exists ${tabla}_cifrado_anula_claro on ${tabla}`);
    await client.query(`drop trigger if exists ${tabla}_claro_anula_cifrado on ${tabla}`);
    resumen[tabla].cifradas = await cifrarPendientes(tabla, def);
  }

  const problemas = [];
  for (const [tabla, def] of Object.entries(TABLAS)) {
    const [n, p] = await verificar(tabla, def, def.conClaro);
    resumen[tabla].verificadas = n;
    problemas.push(...p);
  }
  if (problemas.length) {
    // En una base ya migrada esto es un chequeo de salud: datos alterados o
    // cifrados con otra clave. La app los descarta al leer; acá se avisan.
    console.error(
      quedaClaro
        ? `✗ ${problemas.length} dato(s) no pasan la verificación. No se cambió nada:`
        : `✗ La base ya estaba migrada, pero ${problemas.length} dato(s) no se descifran (alterados o de otra clave):`
    );
    for (const p of problemas.slice(0, 20)) console.error(`   · ${p}`);
    if (problemas.length > 20) console.error(`   · … y ${problemas.length - 20} más`);
    throw new Error(quedaClaro ? "verificación fallida" : "hay datos ilegibles");
  }

  if (quedaClaro) {
    for (const [tabla, def] of Object.entries(TABLAS)) {
      if (!def.conClaro) continue;
      await client.query(`alter table ${tabla} ${def.campos.map((c) => `drop column if exists ${c.claro}`).join(", ")}`);
    }
    await client.query("alter table metricas alter column valor_cifrado set not null");
    await client.query(
      `insert into auditoria (accion, recurso, resultado, detalle) values ('datos.cifrar', 'metricas,perfil', 'ok', $1)`,
      [JSON.stringify({ metricas: resumen.metricas.cifradas, perfiles: resumen.perfil.cifradas })]
    );
  }

  if (SIMULAR) {
    await client.query("rollback");
  } else {
    await client.query("commit");
  }

  const r = resumen;
  console.log(`✓ métricas: ${r.metricas.cifradas} cifradas ahora, ${r.metricas.verificadas} verificadas`);
  console.log(`✓ perfiles: ${r.perfil.cifradas} cifrados ahora, ${r.perfil.verificadas} verificados`);
  if (!quedaClaro) console.log("✓ La base ya estaba migrada: no quedaban columnas en claro.");
  else if (SIMULAR) console.log("✓ Simulación: todo se descifró bien. Se deshizo; corré sin --simular para aplicarla.");
  else console.log("✓ Columnas en claro borradas. Los datos de salud quedan solo cifrados.");
} catch (err) {
  try {
    await client.query("rollback");
  } catch {
    // la conexión pudo caer antes del rollback
  }
  console.error("✗ No se cambió nada:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
