#!/usr/bin/env node
/**
 * Le da el rol Administrador a una cuenta (integrador, punto 5).
 *
 *   npm run asignar-admin -- correo@dominio.com
 *
 * Es la única forma de crear el PRIMER administrador: desde la app, el rol solo
 * lo puede dar alguien que ya lo tiene. Necesita el rol DUEÑO de la base
 * (DATABASE_ADMIN_URL): la app no puede ejecutar `pulso_admin_asignar_rol_sistema`.
 * La cuenta tiene que estar activada. Queda en la auditoría como
 * `admin.rol.asignar_sistema` (sin actor: lo hizo quien tiene el dueño).
 *
 * Se puede correr de nuevo: si la cuenta ya era administradora, no cambia nada.
 */
import pg from "pg";

const correo = process.argv[2]?.trim().toLowerCase();
if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || correo.length > 254) {
  console.error("Uso: npm run asignar-admin -- correo@dominio.com");
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

/**
 * uid de la cuenta con ese correo, o null. ÚNICO lugar del script que mira el
 * correo (C3). Con el correo cifrado (columna `email_hmac`) se busca por su
 * índice ciego, `indiceCiego(correo, "cuentas.email")` de
 * src/lib/seguridad/cifrado.ts: para importarlo el script corre con
 * --experimental-strip-types (ver package.json) y necesita PULSO_CLAVE_DATOS.
 * Mientras exista el correo en claro, se busca también por él.
 */
async function buscarCuenta(client, correo) {
  const { rows: columnas } = await client.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'cuentas'"
  );
  const tiene = (c) => columnas.some((x) => x.column_name === c);

  if (tiene("email_hmac")) {
    const { indiceCiego } = await import("../src/lib/seguridad/cifrado.ts");
    const { rows } = await client.query("select uid from cuentas where email_hmac = $1", [indiceCiego(correo, "cuentas.email")]);
    if (rows[0]) return rows[0].uid;
  }
  if (tiene("email")) {
    const { rows } = await client.query("select uid from cuentas where email = $1", [correo]);
    return rows[0]?.uid ?? null;
  }
  return null;
}

const MENSAJES = {
  ok:          "✓ Listo: la cuenta ahora tiene el rol Administrador.",
  ya_tenia:    "✓ La cuenta ya tenía el rol Administrador: no se cambió nada.",
  sin_activar: "✗ La cuenta existe pero no está activada: primero hay que abrir el enlace del correo.",
  sin_cuenta:  "✗ No hay ninguna cuenta con ese correo.",
};

const client = new pg.Client({ connectionString, ssl: opcionesSsl() });
try {
  await client.connect();
  await client.query("begin");
  const uid = await buscarCuenta(client, correo);
  const resultado = uid
    ? (await client.query("select pulso_admin_asignar_rol_sistema($1, $2) as r", [uid, "scripts/asignar-admin.mjs"])).rows[0].r
    : "sin_cuenta";
  await client.query("commit");
  console.log(MENSAJES[resultado] ?? `Resultado: ${resultado}`);
  if (resultado === "sin_cuenta" || resultado === "sin_activar") process.exitCode = 2;
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error("✗ Error:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
