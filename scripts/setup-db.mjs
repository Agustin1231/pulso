#!/usr/bin/env node
/**
 * Aplica db/schema.sql contra la base apuntada por DATABASE_URL.
 *
 *   npm run setup-db
 *
 * Es idempotente (todo el schema usa `if not exists`), así que se puede correr
 * en cada deploy o a mano sin miedo.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Lee DATABASE_URL del entorno o, si no está, de .env.local / .env. */
async function resolverConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  for (const archivo of [".env.local", ".env"]) {
    try {
      const texto = await readFile(path.join(raiz, archivo), "utf8");
      for (const linea of texto.split("\n")) {
        const m = linea.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
        if (m) return m[1].trim().replace(/^["']|["']$/g, "");
      }
    } catch {
      // el archivo no existe: seguimos con el siguiente
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

const schema = await readFile(path.join(raiz, "db", "schema.sql"), "utf8");

const client = new pg.Client({
  connectionString,
  ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();
  const { rows } = await client.query("select current_database() as db, version() as v");
  console.log(`→ Conectado a "${rows[0].db}" (${rows[0].v.split(" ").slice(0, 2).join(" ")})`);

  await client.query("begin");
  await client.query(schema);
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
