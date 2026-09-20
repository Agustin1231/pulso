#!/usr/bin/env node
/**
 * Carga un usuario de demostración con métricas sintéticas de 90 días,
 * perfil y adherencia a hábitos, generados por `lib/ml/sintetico`.
 *
 *   npm run seed:demo -- --uid <uuid> [--dias 90] [--semilla 7] [--limpiar]
 *
 * El uuid es el que la app guarda en localStorage como `pulso_uid` (abrí la
 * consola del navegador: localStorage.getItem("pulso_uid")). Con --limpiar se
 * borran antes las métricas, hábitos y perfil de ese uid. Lee DATABASE_URL del
 * entorno o de .env.local, igual que setup-db.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { generarUsuario } from "../src/lib/ml/sintetico";
import { diasEntre, hoyLocal, sumarDias } from "../src/lib/ml/series";
import { METRICA_MAP } from "../src/lib/metricas-config";
import type { MetricaType, Observacion } from "../src/lib/ml/tipos";

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const UID = arg("uid");
const DIAS = Number(arg("dias") ?? 90);
const SEMILLA = Number(arg("semilla") ?? 7);
const LIMPIAR = process.argv.includes("--limpiar");

if (!UID || !/^[0-9a-f-]{36}$/i.test(UID)) {
  console.error("✗ Falta --uid <uuid> (el pulso_uid del localStorage del navegador).");
  process.exit(1);
}

function resolverConnectionString(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const archivo of [".env.local", ".env"]) {
    try {
      const texto = readFileSync(path.join(process.cwd(), archivo), "utf8");
      const m = texto.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch {
      // seguimos con el siguiente
    }
  }
  return null;
}

const connectionString = resolverConnectionString();
if (!connectionString) {
  console.error("✗ Falta DATABASE_URL (entorno o .env.local).");
  process.exit(1);
}

/** Los datos sintéticos terminan hoy: se corren las fechas del generador. */
const entrada = generarUsuario(SEMILLA, DIAS);
const desplazamiento = diasEntre(entrada.hoy as string, hoyLocal());
const corrida = (o: Observacion): Observacion => ({ ...o, fecha: sumarDias(o.fecha, desplazamiento) });

/** Mediodía local del día, para que el upsert diario de la app lo vea en el mismo día. */
function mediodia(dia: string): Date {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

const HABITOS_FIJOS = ["hidratacion", "alimentacion", "sueno", "medicamento"];

const client = new pg.Client({
  connectionString,
  ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
});

async function main() {
  await client.connect();
  await client.query("begin");

  if (LIMPIAR) {
    const r1 = await client.query("delete from metricas where uid = $1", [UID]);
    const r2 = await client.query("delete from habitos where uid = $1", [UID]);
    const r3 = await client.query("delete from perfil where uid = $1", [UID]);
    console.log(`→ limpiado: ${r1.rowCount} métricas, ${r2.rowCount} hábitos, ${r3.rowCount} perfil`);
  }

  let nMetricas = 0;
  for (const [tipo, obs] of Object.entries(entrada.metricas) as [MetricaType, Observacion[]][]) {
    const unidad = METRICA_MAP[tipo]?.unidad ?? "";
    for (const o of obs.map(corrida)) {
      await client.query(
        `insert into metricas (uid, tipo, valor, unidad, created_at) values ($1, $2, $3, $4, $5)`,
        [UID, tipo, o.valor, unidad, mediodia(o.fecha).toISOString()]
      );
      nMetricas++;
    }
  }

  let nHabitos = 0;
  for (const o of (entrada.adherencia ?? []).map(corrida)) {
    const completados = Math.round(o.valor * HABITOS_FIJOS.length);
    for (const tipo of HABITOS_FIJOS.slice(0, completados)) {
      await client.query(
        `insert into habitos (uid, fecha, tipo, completado) values ($1, $2, $3, true)
         on conflict (uid, fecha, tipo) do update set completado = true`,
        [UID, o.fecha, tipo]
      );
      nHabitos++;
    }
  }

  const p = entrada.perfil;
  if (p) {
    await client.query(
      `insert into perfil (uid, edad, sexo, altura_cm, fumador) values ($1, $2, $3, $4, $5)
       on conflict (uid) do update set edad = excluded.edad, sexo = excluded.sexo,
         altura_cm = excluded.altura_cm, fumador = excluded.fumador, actualizado_at = now()`,
      [UID, p.edad ?? null, p.sexo ?? null, p.alturaCm ?? null, p.fumador ?? null]
    );
  }

  await client.query("commit");
  console.log(`✓ uid ${UID}: ${nMetricas} métricas en ${DIAS} días (hasta hoy), ${nHabitos} hábitos completados, perfil cargado.`);
  console.log("  Abrí /dashboard y /score con ese uid en localStorage para ver el motor en acción.");
}

main()
  .catch(async (err) => {
    try {
      await client.query("rollback");
    } catch {
      // la conexión pudo caer antes
    }
    console.error("✗", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
