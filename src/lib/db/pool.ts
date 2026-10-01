import "server-only";
import pg from "pg";

const { Pool, types } = pg;

// Supabase devolvía las fechas como ISO strings porque viajaban por JSON.
// node-postgres las convierte a Date por defecto, lo que rompería los tipos de
// fila (`created_at: string`) y el formateo en los componentes. Las forzamos al
// mismo formato que antes para que nada más tenga que cambiar.
types.setTypeParser(types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString());
types.setTypeParser(types.builtins.TIMESTAMP, (v) => new Date(v).toISOString());
// `date` se deja crudo: Postgres ya lo entrega como YYYY-MM-DD, que es
// exactamente lo que las tablas de hábitos escriben y leen.
types.setTypeParser(types.builtins.DATE, (v) => v);

declare global {
  // eslint-disable-next-line no-var
  var __pulsoPool: pg.Pool | undefined;
}

/**
 * TLS hacia Postgres (plantilla, fila 10: el tráfico app ↔ base lleva datos de
 * salud entre contenedores).
 *
 *   PGSSL=verify-full  cifra Y verifica el certificado del servidor y su
 *                      nombre contra PGSSL_CA (la CA en PEM; los saltos de
 *                      línea pueden venir como "\n"). Es lo que usa producción:
 *                      Coolify firma el certificado de la base con su CA, a
 *                      nombre del contenedor.
 *   PGSSL=require      cifra sin verificar (Postgres gestionado, Neon, RDS).
 *   vacío              sin TLS (desarrollo con una base local).
 */
export function opcionesSsl(): pg.ConnectionConfig["ssl"] {
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

/**
 * El pool se crea en la primera query, no al importar el módulo.
 *
 * Importa que sea perezoso: `next build` evalúa los módulos "use server" para
 * registrar las server actions, y si el pool se creara al importar, un build
 * sin DATABASE_URL fallaría (o abriría conexiones durante el build).
 *
 * El cache en `globalThis` es para dev: Next recarga los módulos en cada cambio
 * y sin él se abriría un pool nuevo por recarga hasta agotar las conexiones.
 */
function obtenerPool(): pg.Pool {
  if (globalThis.__pulsoPool) return globalThis.__pulsoPool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL no está configurada. Copiá .env.example a .env.local y apuntala a tu Postgres."
    );
  }

  const creado = new Pool({
    connectionString,
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: opcionesSsl(),
  });

  // Un error en una conexión idle no debe tumbar el proceso.
  creado.on("error", (err) => {
    console.error("[db] error en conexión idle:", err.message);
  });

  globalThis.__pulsoPool = creado;
  return creado;
}

/**
 * Fachada con la misma forma que `pg.Pool.query`, para que los módulos de datos
 * se escriban igual que con un pool directo pero sin perder la inicialización
 * perezosa.
 */
export const pool = {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<pg.QueryResult<R>> {
    return obtenerPool().query<R>(sql, params as unknown[]);
  },
};

/** Lo mínimo que necesita un módulo de datos: la misma forma que `pool.query`. */
export interface Db {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<pg.QueryResult<R>>;
}

/**
 * Corre `fn` en una transacción con `app.uid` fijado, que es lo que leen las
 * políticas de RLS (db/seguridad.sql). Fuera de esto, la app conectada como
 * `pulso_app` no ve ni escribe ninguna fila de datos.
 *
 * `set_config(..., true)` es local a la transacción: al hacer commit o rollback
 * se borra, así que una conexión devuelta al pool no arrastra el uid de nadie.
 */
export async function conUsuario<T>(uid: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await obtenerPool().connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.uid', $1, true)", [uid]);
    const resultado = await fn({
      query: (sql, params) => client.query(sql, params as unknown[]),
    });
    await client.query("commit");
    return resultado;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Mensaje de un error para el LOG del servidor. Nunca se devuelve al cliente:
 * los mensajes de pg traen nombres de tablas, columnas y restricciones.
 */
export function mensajeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
