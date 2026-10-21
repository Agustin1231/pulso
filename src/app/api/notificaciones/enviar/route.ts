import webpush from "web-push";
import { conUsuario } from "@/lib/db/pool";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { cuerpoPushSchema, endpointPushPermitido } from "@/lib/seguridad/validacion";

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

    // Las suscripciones guardadas antes de la lista blanca de servicios de push
    // (SAST-BE-11) pueden apuntar a cualquier host: se filtran también al enviar.
    const suscripciones = await conUsuario(uid, async (db) => {
      const { rows } = await db.query<SuscripcionRow>(
        `select endpoint, keys from suscripciones_push where uid = $1`,
        [uid]
      );
      return rows.filter((s) => endpointPushPermitido(s.endpoint));
    });

    if (!suscripciones.length) {
      return json({ error: "Sin suscripciones activas" }, 404);
    }

    const payload = JSON.stringify({
      title: cuerpo.title || "Pulso",
      body:  cuerpo.body || "Tienes un recordatorio",
      url:   cuerpo.url || "/dashboard",
    });

    // Cada envío resuelve siempre (nunca rechaza) a su endpoint y su resultado.
    // Con timeout: un servicio de push colgado no debe retener la petición.
    const envios = await Promise.all(
      suscripciones.map(async ({ endpoint, keys }) => {
        try {
          await webpush.sendNotification({ endpoint, keys }, payload, { timeout: 10_000 });
          return { endpoint, ok: true, status: 201 };
        } catch (err) {
          return { endpoint, ok: false, status: (err as { statusCode?: number })?.statusCode };
        }
      })
    );

    // 404/410: el navegador dio de baja la suscripción; se borra para no reintentarla.
    const vencidas = envios.filter((e) => e.status === 404 || e.status === 410);
    if (vencidas.length) {
      await conUsuario(uid, (db) =>
        db.query(`delete from suscripciones_push where uid = $1 and endpoint = any($2)`, [
          uid,
          vencidas.map((v) => v.endpoint),
        ])
      ).catch((err) => console.error("[push] no se pudieron borrar suscripciones vencidas:", err));
    }

    const enviados = envios.filter((e) => e.ok).length;
    await auditar({ uid, accion: "push.enviar", resultado: "ok", ip, detalle: { enviados, vencidas: vencidas.length } });
    return json({ ok: true, enviados, vencidas: vencidas.length });
  }
);
