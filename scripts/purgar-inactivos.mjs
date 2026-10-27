#!/usr/bin/env node
/**
 * Purga de identidades inactivas (RP-10 / RL-09; Ley 1581, arts. 4 y 11).
 *
 *   npm run purgar-inactivos -- [--dias 30] [--seco]
 *
 * Llama a `pulso_purgar_inactivos(dias)` (db/seguridad.sql), que borra en la
 * base los datos de las identidades sin sesión utilizable hace más de `dias`
 * días (las sesiones vencen a los 180 días sin uso) y deja la auditoría. Acá
 * se borran además sus imágenes y sus exámenes de MEDIA_DIR, que la base no
 * puede tocar.
 *
 * Exámenes (integrador, punto 15): su archivo no depende del uid
 * (`examenes/<id aleatorio>`), así que antes de purgar se anota qué archivos
 * tiene cada identidad. Después se barren además los archivos de exámenes
 * HUÉRFANOS (sin fila en la base) de más de una hora: los que dejó una
 * supresión o un borrado que no pudo tocar el disco, o una subida cortada. La
 * hora de gracia es para no llevarse una subida que está en curso.
 *
 * Necesita el rol DUEÑO (DATABASE_ADMIN_URL): la app no tiene permiso de
 * ejecutar la purga. Se programa fuera de la app, una vez por día; por
 * ejemplo, una tarea programada de Coolify sobre el contenedor de la app:
 *
 *   node scripts/purgar-inactivos.mjs --dias 30
 *
 * o, si solo interesa la base, pg_cron en Postgres:
 *
 *   select cron.schedule('pulso-purga', '30 3 * * *', $$select pulso_purgar_inactivos(30)$$);
 *
 * `--seco` corre todo en una transacción que se deshace: muestra cuántas
 * identidades se borrarían sin borrar nada (ni en la base ni en el disco).
 */
import { createHash } from "node:crypto";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const args = process.argv.slice(2);
const SECO = args.includes("--seco");
const iDias = args.indexOf("--dias");
const DIAS = iDias >= 0 ? Number(args[iDias + 1]) : 30;
if (!Number.isInteger(DIAS) || DIAS < 0 || DIAS > 3650) {
  console.error("✗ --dias tiene que ser un entero entre 0 y 3650.");
  process.exit(1);
}

const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) {
  console.error("✗ Falta DATABASE_ADMIN_URL (rol dueño de la base).");
  process.exit(1);
}

// Mismos modos que src/lib/db/pool.ts (opcionesSsl): siempre verificando el certificado.
function opcionesSsl() {
  const modo = process.env.PGSSL ?? "";
  if (modo === "verify-full") {
    const ca = process.env.PGSSL_CA?.replace(/\\n/g, "\n");
    if (!ca?.includes("BEGIN CERTIFICATE")) throw new Error("PGSSL=verify-full necesita PGSSL_CA en PEM.");
    return { ca, rejectUnauthorized: true };
  }
  if (modo === "require") return { rejectUnauthorized: true };
  if (modo !== "") throw new Error(`PGSSL="${modo}" no es válido: verify-full, require o vacío.`);
  return undefined;
}

// Las mismas carpetas que src/lib/media.ts: la vieja (el uid) y la nueva (hash del uid).
const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR ?? path.join(process.cwd(), ".data"));
const CARPETA_RE = /^[A-Za-z0-9_-]{1,64}$/;
function carpetasDe(uid) {
  const nueva = createHash("sha256").update(`pulso-media:${uid}`).digest("hex").slice(0, 32);
  return [uid, nueva].filter((c) => CARPETA_RE.test(c));
}

// Exámenes: `MEDIA_DIR/examenes/<archivo>`, el mismo patrón que ARCHIVO_EXAMEN_RE de media.ts.
const DIR_EXAMENES = path.join(MEDIA_DIR, "examenes");
const ARCHIVO_EXAMEN_RE = /^[0-9a-f]{32}$/;
const GRACIA_HUERFANOS_MS = 60 * 60 * 1000;

/**
 * Archivos de exámenes por uid. `row_security = off` hace que la consulta
 * FALLE si RLS la filtrara (un dueño que no es superusuario): sin eso, una
 * lista vacía haría creer que todos los archivos son huérfanos.
 */
async function archivosDeExamenes(db) {
  await db.query("set local row_security = off");
  const { rows } = await db.query("select uid, archivo from examenes");
  await db.query("set local row_security = on");
  return rows;
}

/** Archivos de exámenes en disco sin fila en la base y con más de una hora. */
async function huerfanos(enLaBase) {
  let nombres;
  try {
    nombres = await readdir(DIR_EXAMENES);
  } catch {
    return []; // todavía no se subió ningún examen
  }
  const conFila = new Set(enLaBase);
  const viejos = [];
  for (const n of nombres) {
    if (!ARCHIVO_EXAMEN_RE.test(n) || conFila.has(n)) continue;
    const { mtimeMs } = await stat(path.join(DIR_EXAMENES, n));
    if (Date.now() - mtimeMs > GRACIA_HUERFANOS_MS) viejos.push(n);
  }
  return viejos;
}

const client = new pg.Client({ connectionString, ssl: opcionesSsl() });
try {
  await client.connect();
  await client.query("begin");
  const examenes = await archivosDeExamenes(client);
  const { rows } = await client.query("select uid from pulso_purgar_inactivos($1) as uid", [DIAS]);
  const purgados = new Set(rows.map((r) => r.uid));
  const examenesPurgados = examenes.filter((e) => purgados.has(e.uid)).map((e) => e.archivo);
  const quedan = examenes.filter((e) => !purgados.has(e.uid)).map((e) => e.archivo);

  if (SECO) {
    await client.query("rollback");
    const sobrantes = await huerfanos(examenes.map((e) => e.archivo));
    console.log(
      `(seco) se borrarían ${rows.length} identidades inactivas hace más de ${DIAS} días, ` +
      `${examenesPurgados.length} archivos de sus exámenes y ${sobrantes.length} archivos de exámenes huérfanos.`
    );
  } else {
    await client.query("commit");
    // Los archivos, después del commit: si el borrado en la base fallara, no
    // quedan registros apuntando a archivos que ya no existen.
    let carpetas = 0;
    for (const { uid } of rows) {
      for (const carpeta of carpetasDe(uid)) {
        await rm(path.join(MEDIA_DIR, "recetas", carpeta), { recursive: true, force: true });
        carpetas++;
      }
    }
    for (const archivo of examenesPurgados) {
      if (ARCHIVO_EXAMEN_RE.test(archivo)) await rm(path.join(DIR_EXAMENES, archivo), { force: true });
    }
    const sobrantes = await huerfanos(quedan);
    for (const archivo of sobrantes) await rm(path.join(DIR_EXAMENES, archivo), { force: true });
    console.log(
      `✓ ${rows.length} identidades purgadas (${carpetas} carpetas de imágenes revisadas, ` +
      `${examenesPurgados.length} archivos de exámenes y ${sobrantes.length} huérfanos borrados).`
    );
  }
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error("✗ Error en la purga:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
