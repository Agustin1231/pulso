#!/usr/bin/env node
/**
 * Prepara la base de CARGA (nunca producción) para las pruebas no funcionales:
 *
 *   1. Crea N sesiones anónimas directamente en la base, con el rol dueño,
 *      llamando a `pulso_crear_sesion(sha256(token), 30)` (ver src/lib/sesion.ts
 *      y db/seguridad.sql). Así la prueba de carga NO pasa por
 *      POST /api/movil/v1/sesion, cuyo límite de tasa (30 sesiones nuevas por IP
 *      y hora) es un control de seguridad que no se desactiva.
 *   2. Carga a cada identidad un historial realista: 90 días de métricas
 *      (FC, peso, sueño, estrés), perfil, hábitos fijos y personalizados,
 *      recetas, una lista de mercado y una rutina.
 *   3. Escribe los tokens en claro en `--salida` (por defecto
 *      tests/carga/.data/tokens.json, ignorado por git): son de una base
 *      descartable y k6 los manda como `Authorization: Bearer`.
 *
 * Uso:
 *   DATABASE_ADMIN_URL=postgres://postgres:...@127.0.0.1:55433/pulso_carga \
 *     node tests/carga/preparar.mjs --usuarios 200 [--dias 90] [--salida ruta] [--limpiar]
 *
 *   node tests/carga/preparar.mjs --uid <uid>   → solo carga el historial a una
 *     identidad que ya existe (p. ej. la que creó la app en el emulador).
 *
 * Se niega a correr si la URL no apunta a 127.0.0.1/localhost.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const USUARIOS = Number(arg("usuarios", 200));
const DIAS = Number(arg("dias", 90));
const SALIDA = arg("salida", path.join(aqui, ".data", "tokens.json"));
const LIMPIAR = process.argv.includes("--limpiar");
const UID = arg("uid", null);

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error("✗ Falta DATABASE_ADMIN_URL (rol dueño de la base de carga).");
  process.exit(1);
}
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error(`✗ La base ${host} no es local: este script solo corre contra la base descartable.`);
  process.exit(1);
}

const sha256 = (t) => createHash("sha256").update(t).digest("hex");
// Generador determinista (mulberry32) para que dos corridas den el mismo perfil de datos.
function azar(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RECETA = "## Ingredientes\n- 1 taza de avena\n- 2 bananas\n- canela\n\n## Preparación\n" +
  "1. Mezclar la avena con agua tibia.\n2. Agregar la banana pisada.\n3. Hornear 20 minutos a 180 °C.\n\n" +
  "Rica en fibra soluble, ayuda a bajar el colesterol LDL. ".repeat(12);
const MERCADO = "## Frutas y verduras\n- 6 bananas\n- 1 kg de manzanas\n- espinaca\n\n## Proteínas\n- 1 kg de pollo\n- 12 huevos\n\n" +
  "## Granos\n- avena\n- arroz integral\n".repeat(4);
const RUTINA = {
  texto: "## Rutina en casa\n\nCalentamiento, bloque principal de fuerza y vuelta a la calma.",
  nivel: "principiante", tiempo: "30 minutos", lugar: "casa", limitacion: "ninguna",
  ejercicios: Array.from({ length: 8 }, (_, i) => ({
    bloque: i < 2 ? "Calentamiento" : i < 7 ? "Principal" : "Vuelta a la calma",
    nombre: `Ejercicio ${i + 1}`, detalle: "3 series de 12 repeticiones", descanso: 45,
    descripcion: "Mantener la espalda recta y respirar de forma controlada.",
  })),
};

const client = new pg.Client({ connectionString: url });
await client.connect();
const t0 = Date.now();

if (LIMPIAR) {
  // Borra solo lo que creó una corrida anterior de este script (origen 'nueva' y sin datos web).
  // `auditoria` es append-only también frente a TRUNCATE (trigger `auditoria_inmutable`): se conserva.
  await client.query("truncate metricas, habitos, habitos_definicion, habitos_registro, recetas_guardadas, " +
    "listas_mercado, rutinas, perfil, limites_tasa");
  await client.query("delete from identidades");
  console.log("✓ base de carga vaciada");
}

async function sembrar(uid, r) {
  const fcBase = 60 + Math.round(r() * 25);
  const pesoBase = 55 + Math.round(r() * 45);
  // Métricas: una por día y tipo durante DIAS días, al mediodía.
  await client.query(
    `insert into metricas (uid, tipo, valor, unidad, created_at)
     select $1, t.tipo,
            round((case t.tipo
               when 'frecuencia_cardiaca' then $2 + 6 * sin(d / 7.0) + random() * 4
               when 'peso'                then $3 - d * 0.01 + random() * 0.6
               when 'horas_sueno'         then 6 + random() * 2.5
               else                            3 + floor(random() * 5) end)::numeric, 1)::float8,
            t.unidad,
            date_trunc('day', now()) - make_interval(days => d) + interval '12 hours'
       from generate_series(0, $4 - 1) d,
            (values ('frecuencia_cardiaca','bpm'), ('peso','kg'), ('horas_sueno','h'), ('nivel_estres','/10')) t(tipo, unidad)`,
    [uid, fcBase, pesoBase, DIAS]
  );
  await client.query(
    "insert into perfil (uid, edad, sexo, altura_cm, fumador) values ($1, $2, $3, $4, $5) on conflict (uid) do nothing",
    [uid, 25 + Math.floor(r() * 45), r() < 0.5 ? "f" : "m", 150 + Math.floor(r() * 40), r() < 0.2]
  );
  await client.query(
    `insert into habitos (uid, fecha, tipo, completado)
     select $1, (current_date - d), t, random() < 0.7
       from generate_series(0, 29) d, unnest(array['ejercicio','alimentacion','sueno','medicamento','hidratacion']) t
     on conflict do nothing`,
    [uid]
  );
  const defs = await client.query(
    `insert into habitos_definicion (uid, nombre, emoji, frecuencia, hora, dias_semana)
     values ($1, 'Caminar 30 minutos', '🚶', 'diario', '07:30', '{}'),
            ($1, 'Meditar', '🧘', 'semanal', '21:00', '{lunes,miercoles,viernes}'),
            ($1, 'Tomar 2 litros de agua', '💧', 'diario', null, '{}')
     returning id`,
    [uid]
  );
  for (const { id } of defs.rows) {
    await client.query(
      `insert into habitos_registro (uid, fecha, tipo, ref_id)
       select $1, current_date - d, 'habito_custom', $2 from generate_series(0, 29, 2) d`,
      [uid, id]
    );
  }
  for (let k = 0; k < 3; k++) {
    await client.query(
      `insert into recetas_guardadas (uid, titulo, contenido, ingredientes, calificacion)
       values ($1, $2, $3, $4, $5)`,
      [uid, `Receta saludable ${k + 1}`, RECETA, ["avena", "banana", "canela"], 1 + Math.floor(r() * 5)]
    );
  }
  await client.query(
    "insert into listas_mercado (uid, nombre, periodo, contenido) values ($1, 'Semana saludable', 'semanal', $2)",
    [uid, MERCADO]
  );
  await client.query("insert into rutinas (uid, nombre, contenido) values ($1, 'Rutina en casa', $2::jsonb)", [
    uid, JSON.stringify(RUTINA),
  ]);
}

const tokens = [];
if (UID) {
  await client.query("begin");
  await sembrar(UID, azar(7));
  await client.query("commit");
  console.log(`✓ historial cargado para la identidad ${UID}`);
} else {
  for (let i = 0; i < USUARIOS; i++) {
    const token = randomBytes(32).toString("base64url");
    await client.query("begin");
    const { rows } = await client.query("select pulso_crear_sesion($1, 30) as uid", [sha256(token)]);
    await sembrar(rows[0].uid, azar(1000 + i));
    await client.query("commit");
    tokens.push(token);
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${USUARIOS} identidades`);
  }
}

const { rows: conteo } = await client.query(
  `select (select count(*) from identidades) identidades, (select count(*) from metricas) metricas,
          (select count(*) from habitos) habitos, (select count(*) from recetas_guardadas) recetas,
          pg_size_pretty(pg_database_size(current_database())) tamano`
);
await client.end();

if (!UID) {
  mkdirSync(path.dirname(SALIDA), { recursive: true });
  writeFileSync(SALIDA, JSON.stringify(tokens), { mode: 0o600 });
  console.log(`✓ ${USUARIOS} sesiones en ${((Date.now() - t0) / 1000).toFixed(1)} s → ${SALIDA}`);
}
console.log("  base:", JSON.stringify(conteo[0]));
