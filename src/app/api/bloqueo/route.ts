import { conUsuario } from "@/lib/db/pool";
import { auditarEn } from "@/lib/seguridad/auditoria";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";

export const runtime = "nodejs";

/**
 * Desactivar el bloqueo: borra las passkeys del usuario. Exige la sesión
 * DESBLOQUEADA (rutaProtegida sin `permitirBloqueada`): quien agarre el
 * teléfono bloqueado no lo puede apagar.
 */
export const DELETE = rutaProtegida(
  {
    nombre:  "bloqueo.desactivar",
    cuerpo:  null,
    limites: (uid, ip) => [limite("passkey", uid), limite("passkeyIp", ip)],
  },
  async ({ uid, ip }) => {
    const borradas = await conUsuario(uid, async (db) => {
      const r = await db.query("delete from credenciales_bloqueo where uid = $1", [uid]);
      await auditarEn(db, { uid, accion: "bloqueo.desactivar", resultado: "ok", ip, recurso: "credenciales_bloqueo", detalle: { passkeys: r.rowCount } });
      return r.rowCount ?? 0;
    });
    return json({ ok: true, borradas });
  }
);
