import webpush from "web-push";
import { conUsuario } from "@/lib/db/pool";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { cuerpoPushSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

interface SuscripcionRow {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Manda un push a los dispositivos del usuario de la SESIÓN (plantilla, fila 4).
 *
 * Antes recibía uid, título, cuerpo y URL sin ningún control: cualquiera podía
 * mandarle a cualquier usuario una notificación con un enlace externo
 * (phishing por push). Ahora solo te podés mandar a vos mismo, con texto
 * acotado, una URL interna y un límite por hora.
 */
export const POST = rutaProtegida(
  {
    nombre:  "push.enviar",
    cuerpo:  cuerpoPushSchema,
    limites: (uid) => [limite("push", uid)],
  },
  async ({ uid, ip, cuerpo }) => {
    const { VAPID_EMAIL, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
    if (!VAPID_EMAIL || !NEXT_PUBLIC_VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      console.error("[push] faltan las claves VAPID");
      return json({ error: "no_disponible" }, 503);
    }
    webpush.setVapidDetails(VAPID_EMAIL, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const suscripciones = await conUsuario(uid, async (db) => {
      const { rows } = await db.query<SuscripcionRow>(
        `select endpoint, keys from suscripciones_push where uid = $1`,
        [uid]
      );
      return rows;
    });

    if (!suscripciones.length) {
      return json({ error: "Sin suscripciones activas" }, 404);
    }

    const payload = JSON.stringify({
      title: cuerpo.title || "Pulso",
      body:  cuerpo.body || "Tienes un recordatorio",
      url:   cuerpo.url || "/dashboard",
    });

    const resultados = await Promise.allSettled(
      suscripciones.map((s) =>
        webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload)
      )
    );

    // 404/410: el navegador dio de baja la suscripción; se borra para no reintentarla.
    const vencidas = suscripciones.filter((_, i) => {
      const r = resultados[i];
      const status = r.status === "rejected" ? (r.reason as { statusCode?: number })?.statusCode : undefined;
      return status === 404 || status === 410;
    });
    if (vencidas.length) {
      await conUsuario(uid, (db) =>
        db.query(`delete from suscripciones_push where uid = $1 and endpoint = any($2)`, [
          uid,
          vencidas.map((v) => v.endpoint),
        ])
      ).catch((err) => console.error("[push] no se pudieron borrar suscripciones vencidas:", err));
    }

    const enviados = resultados.filter((r) => r.status === "fulfilled").length;
    await auditar({ uid, accion: "push.enviar", resultado: "ok", ip, detalle: { enviados, vencidas: vencidas.length } });
    return json({ ok: true, enviados, vencidas: vencidas.length });
  }
);
