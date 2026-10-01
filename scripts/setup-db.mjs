#!/usr/bin/env node
/**
 * Aplica db/schema.sql y db/seguridad.sql contra la base.
 *
 *   npm run setup-db
 *
 * Es idempotente (todo usa `if not exists` / `create or replace`), así que se
 * puede correr en cada deploy o a mano sin miedo.
 *
 * Necesita el rol DUEÑO de la base (crea tablas, roles y políticas), así que
 * prefiere DATABASE_ADMIN_URL y cae a DATABASE_URL. En producción la app NO usa
 * el dueño: se conecta como `pulso_app`, que no puede correr esto.
 *
 * Si está PULSO_APP_PASSWORD, además habilita el login de `pulso_app` con esa
 * contraseña. Así la contraseña nunca queda escrita en el repo.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Lee la conexión del entorno o, si no está, de .env.local / .env. Prueba
 * DATABASE_ADMIN_URL antes que DATABASE_URL en cada fuente.
 */
async function resolverConnectionString() {
  const claves = ["DATABASE_ADMIN_URL", "DATABASE_URL"];
  for (const clave of claves) {
    if (process.env[clave]) return process.env[clave];
  }

  for (const archivo of [".env.local", ".env"]) {
    let texto;
    try {
      texto = await readFile(path.join(raiz, archivo), "utf8");
    } catch {
      continue; // el archivo no existe: seguimos con el siguiente
    }
    for (const clave of claves) {
      for (const linea of texto.split("\n")) {
        const m = linea.match(new RegExp(`^\\s*${clave}\\s*=\\s*(.*)\\s*$`));
        if (m) return m[1].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return null;
}

const connectionString = await resolverConnectionString();

if (!connectionString) {
  console.error(
    "✗ Falta DATABASE_URL.\n" +
      "  Definila en el entorno o en .env.local (mirá .env.example)."
  );
  process.exit(1);
}

// El orden importa: seguridad.sql protege las tablas que crea schema.sql.
const ARCHIVOS = ["schema.sql", "seguridad.sql"];
const sqls = await Promise.all(
  ARCHIVOS.map((a) => readFile(path.join(raiz, "db", a), "utf8"))
);

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
  if (modo === "require") return { rejectUnauthorized: false };
  return undefined;
}

const client = new pg.Client({ connectionString, ssl: opcionesSsl() });

try {
  await client.connect();
  const { rows } = await client.query("select current_database() as db, version() as v");
  console.log(`→ Conectado a "${rows[0].db}" (${rows[0].v.split(" ").slice(0, 2).join(" ")})`);

  await client.query("begin");
  for (const [i, sql] of sqls.entries()) {
    await client.query(sql);
    console.log(`✓ ${ARCHIVOS[i]}`);
  }

  const password = process.env.PULSO_APP_PASSWORD;
  if (password) {
    if (password.length < 24) {
      throw new Error("PULSO_APP_PASSWORD tiene que tener al menos 24 caracteres.");
    }
    // DDL no admite parámetros: se escapa como literal.
    await client.query(`alter role pulso_app login password ${client.escapeLiteral(password)}`);
    console.log("✓ pulso_app habilitado para login");
  }
  await client.query("commit");

  const { rows: tablas } = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' order by table_name`
  );
  console.log(`✓ Schema aplicado. Tablas (${tablas.length}):`);
  for (const t of tablas) console.log(`   · ${t.table_name}`);
} catch (err) {
  try {
    await client.query("rollback");
  } catch {
    // la conexión pudo caer antes del rollback
  }
  console.error("✗ Error aplicando el schema:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
