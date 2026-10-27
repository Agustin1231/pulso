#!/usr/bin/env node
/**
 * Carga un usuario de demostración con métricas sintéticas de 90 días,
 * perfil y adherencia a hábitos, generados por `lib/ml/sintetico`.
 *
 *   npm run seed:demo -- (--email <correo> | --uid <uuid>) [--dias 90] [--semilla 7] [--limpiar]
 *
 * Desde que la cuenta es obligatoria, el usuario es una cuenta activada:
 * creala en la app y pasá su correo (o el uid de su identidad). Con --limpiar
 * se borran antes las métricas, hábitos y perfil de ese usuario.
 *
 * Las métricas y el perfil se guardan cifrados, igual que los guarda la app
 * (integrador, punto 19), así que hace falta PULSO_CLAVE_DATOS: la misma clave
 * que usa la app, o no los va a poder leer. Se conecta con DATABASE_ADMIN_URL
 * (hace falta para --email) o con DATABASE_URL; como `pulso_app` escribe dentro
 * de la transacción del usuario (`app.uid`), igual que la app, y RLS lo deja.
 * Lee las variables del entorno o de .env.local / .env.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { generarUsuario } from "../src/lib/ml/sintetico";
import { diasEntre, hoyLocal, sumarDias } from "../src/lib/ml/series";
import { METRICA_MAP } from "../src/lib/metricas-config";
import { cifrar, descifrar, indiceCiego } from "../src/lib/seguridad/cifrado";
import { crearCifradoSalud } from "../src/lib/db/salud-cifrada";
import type { MetricaType, Observacion } from "../src/lib/ml/tipos";

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const UID_ARG = arg("uid");
const EMAIL = arg("email");
const DIAS = Number(arg("dias") ?? 90);
const SEMILLA = Number(arg("semilla") ?? 7);
const LIMPIAR = process.argv.includes("--limpiar");

if (!EMAIL && (!UID_ARG || !/^[0-9a-f-]{36}$/i.test(UID_ARG))) {
  console.error("✗ Falta --email <correo> (el de una cuenta activada) o --uid <uuid>.");
  process.exit(1);
}

/** Variable del entorno o, si no está, de .env.local / .env. */
function variable(nombre: string): string | null {
  const delEntorno = process.env[nombre];
  if (delEntorno) return delEntorno;
  for (const archivo of [".env.local", ".env"]) {
    let texto: string;
    try {
      texto = readFileSync(path.join(process.cwd(), archivo), "utf8");
    } catch {
      continue; // el archivo no existe: seguimos con el siguiente
    }
    // Se compara el nombre en vez de armar una RegExp con él (como setup-db).
    for (const linea of texto.split("\n")) {
      const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[1] === nombre) return m[2].replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

const connectionString = variable("DATABASE_ADMIN_URL") ?? variable("DATABASE_URL");
if (!connectionString) {
  console.error("✗ Falta DATABASE_ADMIN_URL o DATABASE_URL (entorno o .env.local).");
  process.exit(1);
}
const clave = variable("PULSO_CLAVE_DATOS");
if (!clave) {
  console.error("✗ Falta PULSO_CLAVE_DATOS (la misma clave que usa la app): las métricas se guardan cifradas.");
  process.exit(1);
}
process.env.PULSO_CLAVE_DATOS = clave;
const salud = crearCifradoSalud({ cifrar, descifrar });

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

// Mismos modos que src/lib/db/pool.ts (opcionesSsl): siempre verificando el
// certificado, nunca cifrar a ciegas (SAST-BE-08).
function opcionesSsl(): pg.ConnectionConfig["ssl"] {
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

const client = new pg.Client({ connectionString, ssl: opcionesSsl() });

/**
 * uid de la cuenta con ese correo. Con el correo cifrado (integrador, punto
 * 19) se busca por su índice ciego; con el esquema anterior, por el correo.
 * Solo el dueño puede leer `cuentas`.
 */
async function uidDeCorreo(email: string): Promise<string | null> {
  const normalizado = email.trim().toLowerCase();
  const { rows: cols } = await client.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'cuentas'"
  );
  const porHmac = cols.some((c) => c.column_name === "email_hmac");
  const { rows } = await client.query<{ uid: string }>(
    porHmac ? "select uid from cuentas where email_hmac = $1" : "select uid from cuentas where email = $1",
    [porHmac ? indiceCiego(normalizado, "cuentas.email") : normalizado]
  );
  return rows[0]?.uid ?? null;
}

async function main() {
  await client.connect();
  const { rows: rol } = await client.query<{ app: boolean }>("select current_user = 'pulso_app' as app");
  const comoApp = rol[0].app;
  if (EMAIL && comoApp) throw new Error("--email necesita DATABASE_ADMIN_URL (pulso_app no puede leer las cuentas). Usá --uid.");

  const UID = EMAIL ? await uidDeCorreo(EMAIL) : (UID_ARG as string);
  if (!UID) throw new Error(`no hay ninguna cuenta con el correo ${EMAIL}`);
  if (!comoApp) {
    const { rows } = await client.query<{ activa: boolean | null }>(
      `select (select c.verificada_at is not null from cuentas c where c.uid = i.uid) as activa
         from identidades i where i.uid = $1`,
      [UID]
    );
    if (!rows[0]) throw new Error(`el uid ${UID} no es una identidad de la base`);
    if (!rows[0].activa) console.warn("! Esa identidad no tiene una cuenta activada: la app no le va a mostrar los datos hasta que la active.");
  }

  await client.query("begin");
  // Como pulso_app, RLS solo deja tocar las filas del usuario de la transacción.
  await client.query("select set_config('app.uid', $1, true)", [UID]);

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
        `insert into metricas (uid, tipo, valor_cifrado, unidad, created_at) values ($1, $2, $3, $4, $5)`,
        [UID, tipo, salud.cifrarMetrica(o.valor, null).valor_cifrado, unidad, mediodia(o.fecha).toISOString()]
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
    const c = salud.cifrarPerfil({
      edad: p.edad ?? null, sexo: p.sexo ?? null, altura_cm: p.alturaCm ?? null, fumador: p.fumador ?? null,
    });
    await client.query(
      `insert into perfil (uid, edad_cifrado, sexo_cifrado, altura_cm_cifrado, fumador_cifrado) values ($1, $2, $3, $4, $5)
       on conflict (uid) do update set edad_cifrado = excluded.edad_cifrado, sexo_cifrado = excluded.sexo_cifrado,
         altura_cm_cifrado = excluded.altura_cm_cifrado, fumador_cifrado = excluded.fumador_cifrado, actualizado_at = now()`,
      [UID, c.edad_cifrado, c.sexo_cifrado, c.altura_cm_cifrado, c.fumador_cifrado]
    );
  }

  await client.query("commit");
  console.log(`✓ uid ${UID}: ${nMetricas} métricas en ${DIAS} días (hasta hoy), ${nHabitos} hábitos completados, perfil cargado.`);
  console.log("  Entrá con esa cuenta y abrí /dashboard y /score para ver el motor en acción.");
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
