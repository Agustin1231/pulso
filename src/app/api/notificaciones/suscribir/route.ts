import { pool } from "@/lib/db/pool";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { uid, subscription } = await req.json();

  if (!uid || !subscription?.endpoint) {
    return Response.json({ error: "Datos incompletos" }, { status: 400 });
  }

  try {
    await pool.query(
      `insert into suscripciones_push (uid, endpoint, keys)
       values ($1, $2, $3::jsonb)
       on conflict (uid, endpoint)
         do update set keys = excluded.keys`,
      [uid, subscription.endpoint, JSON.stringify(subscription.keys ?? {})]
    );
    return Response.json({ ok: true });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    return Response.json({ error: mensaje }, { status: 500 });
  }
}
