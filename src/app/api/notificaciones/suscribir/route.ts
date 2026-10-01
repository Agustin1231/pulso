import { conUsuario } from "@/lib/db/pool";
import { auditarEn } from "@/lib/seguridad/auditoria";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { cuerpoSuscripcionSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

/** Suscripciones que se conservan por usuario (las más nuevas). */
const MAX_SUSCRIPCIONES = 5;

/**
 * Registra la suscripción push del browser para el usuario de la SESIÓN.
 * Antes aceptaba cualquier uid: alguien podía suscribirse a las notificaciones
 * de otro.
 */
export const POST = rutaProtegida(
  { nombre: "push.suscribir", cuerpo: cuerpoSuscripcionSchema },
  async ({ uid, ip, cuerpo }) => {
    const { endpoint, keys } = cuerpo.subscription;

    await conUsuario(uid, async (db) => {
      await db.query(
        `insert into suscripciones_push (uid, endpoint, keys)
         values ($1, $2, $3::jsonb)
         on conflict (uid, endpoint)
           do update set keys = excluded.keys, created_at = now()`,
        [uid, endpoint, JSON.stringify(keys)]
      );
      await db.query(
        `delete from suscripciones_push
          where uid = $1
            and id not in (
              select id from suscripciones_push
               where uid = $1
               order by created_at desc
               limit $2
            )`,
        [uid, MAX_SUSCRIPCIONES]
      );
      await auditarEn(db, { uid, accion: "push.suscribir", resultado: "ok", ip, recurso: "suscripciones_push" });
    });

    return json({ ok: true });
  }
);
