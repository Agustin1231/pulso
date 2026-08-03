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
    // Postgres gestionado (Neon, RDS) exige TLS; el de Coolify va por la red
    // interna de Docker y no lo necesita.
    ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
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

/** Traduce un error de pg al `{ error }` que ya devolvían las funciones de Supabase. */
export function mensajeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
