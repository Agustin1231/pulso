#!/usr/bin/env node
/**
 * Purga de identidades inactivas (RP-10 / RL-09; Ley 1581, arts. 4 y 11).
 *
 *   npm run purgar-inactivos -- [--dias 30] [--seco]
 *
 * Llama a `pulso_purgar_inactivos(dias)` (db/seguridad.sql), que borra en la
 * base los datos de las identidades sin sesión utilizable hace más de `dias`
 * días (las sesiones vencen a los 180 días sin uso) y deja la auditoría. Acá
 * se borran además sus imágenes de MEDIA_DIR, que la base no puede tocar.
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
import { rm } from "node:fs/promises";
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

const client = new pg.Client({ connectionString, ssl: opcionesSsl() });
try {
  await client.connect();
  await client.query("begin");
  const { rows } = await client.query("select uid from pulso_purgar_inactivos($1) as uid", [DIAS]);
  if (SECO) {
    await client.query("rollback");
    console.log(`(seco) se borrarían ${rows.length} identidades inactivas hace más de ${DIAS} días.`);
  } else {
    await client.query("commit");
    // Las imágenes, después del commit: si el borrado en la base fallara, no
    // quedan registros apuntando a archivos que ya no existen.
    let carpetas = 0;
    for (const { uid } of rows) {
      for (const carpeta of carpetasDe(uid)) {
        await rm(path.join(MEDIA_DIR, "recetas", carpeta), { recursive: true, force: true });
        carpetas++;
      }
    }
    console.log(`✓ ${rows.length} identidades purgadas (${carpetas} carpetas de imágenes revisadas).`);
  }
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error("✗ Error en la purga:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
