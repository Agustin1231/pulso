import webpush from "web-push";
import { pool } from "@/lib/db/pool";

export const runtime = "nodejs";

interface SuscripcionRow {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function POST(req: Request) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  const { uid, title, body, url } = await req.json();

  if (!uid) return Response.json({ error: "uid requerido" }, { status: 400 });

  let suscripciones: SuscripcionRow[];
  try {
    const { rows } = await pool.query<SuscripcionRow>(
      `select endpoint, keys from suscripciones_push where uid = $1`,
      [uid]
    );
    suscripciones = rows;
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    return Response.json({ error: mensaje }, { status: 500 });
  }

  if (!suscripciones.length) {
    return Response.json({ error: "Sin suscripciones activas" }, { status: 404 });
  }

  const payload = JSON.stringify({
    title: title ?? "Pulso",
    body: body ?? "Tienes un recordatorio",
    url: url ?? "/dashboard",
  });

  const resultados = await Promise.allSettled(
    suscripciones.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload)
    )
  );

  const enviados = resultados.filter((r) => r.status === "fulfilled").length;
  return Response.json({ ok: true, enviados });
}
