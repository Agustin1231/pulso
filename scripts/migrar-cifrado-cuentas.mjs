#!/usr/bin/env node
/**
 * Migración del correo de las cuentas a cifrado (integrador, punto 19;
 * contrato C7 de docs/integrador/cuentas.md).
 *
 *   DATABASE_ADMIN_URL=postgres://dueño@…/pulso PULSO_CLAVE_DATOS=… \
 *     node --experimental-strip-types scripts/migrar-cifrado-cuentas.mjs [--simular]
 *
 * Antes, `cuentas.email` guardaba el correo en claro. Ahora la base guarda su
 * índice ciego (`email_hmac`, para buscar y exigir unicidad) y su versión
 * cifrada (`email_cifrado`), con la clave de la APP: PULSO_CLAVE_DATOS tiene
 * que ser exactamente la misma que usa la app en producción, o nadie podrá
 * entrar (el índice ciego no coincidiría) ni se podrán leer los correos.
 *
 * Orden (ver docs/integrador/cuentas.md): `npm run setup-db` (agrega las
 * columnas nuevas y deja `email` opcional) → este script → deploy de la app
 * → `npm run setup-db` otra vez (fija las columnas nuevas como obligatorias).
 *
 * Qué hace, en UNA transacción:
 *   1. bloquea `cuentas` contra escrituras (nadie se registra a la mitad);
 *   2. a cada cuenta con `email` le calcula índice ciego y cifrado (el correo
 *      normalizado: sin espacios y en minúsculas, como la app);
 *   3. verifica TODAS las cuentas: tienen las dos columnas, el cifrado se
 *      descifra, su índice ciego coincide y, si todavía está el correo en
 *      claro, es el mismo;
 *   4. solo si todo dio bien, hace obligatorias las columnas nuevas y BORRA la
 *      columna `email`. Si algo falla, rollback: la base queda como estaba.
 *
 * Es idempotente: sin columna `email` solo verifica. Con --simular hace todo
 * y al final deshace (para probarlo antes contra la base real).
 *
 * Usa Node 22.11 (el de producción) con --experimental-strip-types para
 * importar src/lib/seguridad/cifrado.ts tal cual la usa la app: la misma
 * derivación de claves y el mismo formato.
 */
import pg from "pg";
import { cifrar, descifrar, indiceCiego } from "../src/lib/seguridad/cifrado.ts";

const CONTEXTO = "cuentas.email";
const simular = process.argv.includes("--simular");

/** Igual que `normalizarCorreo` de src/lib/cuenta.ts. */
const normalizar = (email) => email.trim().toLowerCase();

const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) {
  console.error("✗ Falta DATABASE_ADMIN_URL (el rol dueño de la base).");
  process.exit(1);
}

// Que falte o esté mal la clave se nota antes de tocar nada.
try {
  descifrar(cifrar("prueba", CONTEXTO), CONTEXTO);
} catch (err) {
  console.error("✗ PULSO_CLAVE_DATOS:", err instanceof Error ? err.message : err);
  process.exit(1);
}

// Mismos modos que scripts/setup-db.mjs y src/lib/db/pool.ts (opcionesSsl).
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

async function columnas(client) {
  const { rows } = await client.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'cuentas'`
  );
  return new Set(rows.map((r) => r.column_name));
}

const client = new pg.Client({ connectionString, ssl: opcionesSsl() });

try {
  await client.connect();
  await client.query("begin");
  // Lecturas sí, escrituras no: ni registros ni cambios de correo a la mitad.
  await client.query("lock table cuentas in share row exclusive mode");

  const cols = await columnas(client);
  if (!cols.has("email_hmac") || !cols.has("email_cifrado")) {
    throw new Error("cuentas no tiene email_hmac / email_cifrado: corre primero `npm run setup-db`.");
  }
  const conCorreoEnClaro = cols.has("email");

  // 2. Cifrar lo que falte.
  let cifradas = 0;
  if (conCorreoEnClaro) {
    const { rows } = await client.query(
      "select uid, email, email_hmac, email_cifrado from cuentas where email is not null"
    );
    for (const r of rows) {
      const correo = normalizar(r.email);
      const hmac = indiceCiego(correo, CONTEXTO);
      let yaEsta = false;
      if (r.email_hmac === hmac && r.email_cifrado) {
        try {
          yaEsta = descifrar(r.email_cifrado, CONTEXTO) === correo;
        } catch {
          yaEsta = false; // cifrado con otra clave o alterado: se vuelve a cifrar
        }
      }
      if (yaEsta) continue;
      await client.query(
        "update cuentas set email_hmac = $2, email_cifrado = $3 where uid = $1",
        [r.uid, hmac, cifrar(correo, CONTEXTO)]
      );
      cifradas++;
    }
  }

  // 3. Verificar todas (también las que se crearon ya con el código nuevo).
  const { rows: todas } = await client.query(
    `select uid, email_hmac, email_cifrado${conCorreoEnClaro ? ", email" : ""} from cuentas`
  );
  const errores = [];
  for (const r of todas) {
    if (!r.email_hmac || !r.email_cifrado) {
      errores.push(`${r.uid}: sin índice ciego o sin cifrar`);
      continue;
    }
    let correo;
    try {
      correo = descifrar(r.email_cifrado, CONTEXTO);
    } catch {
      errores.push(`${r.uid}: el correo cifrado no se descifra con esta PULSO_CLAVE_DATOS`);
      continue;
    }
    if (indiceCiego(correo, CONTEXTO) !== r.email_hmac) errores.push(`${r.uid}: el índice ciego no coincide`);
    if (conCorreoEnClaro && r.email !== null && normalizar(r.email) !== correo) {
      errores.push(`${r.uid}: el cifrado no coincide con el correo en claro`);
    }
  }
  if (errores.length > 0) {
    // Solo uids (aleatorios): ningún correo sale en la consola.
    throw new Error(`la verificación falló en ${errores.length} cuenta(s):\n  ${errores.join("\n  ")}`);
  }

  // 4. Recién ahora se borra el correo en claro.
  if (conCorreoEnClaro) {
    await client.query(
      "alter table cuentas alter column email_hmac set not null, alter column email_cifrado set not null"
    );
    await client.query("alter table cuentas drop column email");
  }

  if (simular) {
    await client.query("rollback");
    console.log(`✓ Simulación: ${cifradas} cuenta(s) por cifrar, ${todas.length} verificada(s). No se guardó nada.`);
  } else {
    await client.query("commit");
    console.log(
      conCorreoEnClaro
        ? `✓ ${cifradas} cuenta(s) cifrada(s), ${todas.length} verificada(s); columna cuentas.email eliminada.`
        : `✓ Ya estaba migrada: ${todas.length} cuenta(s) verificada(s), sin correos en claro.`
    );
  }
} catch (err) {
  try {
    await client.query("rollback");
  } catch {
    // la conexión pudo caer antes del rollback
  }
  console.error("✗ Migración cancelada (no se cambió nada):", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
