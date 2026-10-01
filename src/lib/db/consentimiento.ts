"use server";

import { escritura, lectura, SIN_ENTRADA } from "@/lib/seguridad/accion";
import { tieneConsentimientoIA, VERSION_CONSENTIMIENTO_IA } from "@/lib/seguridad/consentimiento";

/** Si el usuario de la sesión autorizó mandar sus datos de salud a la IA. */
export async function getConsentimientoIA(): Promise<boolean> {
  return lectura("consentimiento.ver", null, SIN_ENTRADA, false, ({ db, uid }) =>
    tieneConsentimientoIA(db, uid)
  );
}

export async function otorgarConsentimientoIA(): Promise<{ error: string | null }> {
  return escritura("consentimiento.otorgar", null, SIN_ENTRADA, async ({ db, uid, auditar }) => {
    await db.query(
      `insert into consentimientos (uid, tipo, version)
       values ($1, 'ia_datos_salud', $2)
       on conflict (uid, tipo) do update
         set version = excluded.version, otorgado_at = now(), revocado_at = null`,
      [uid, VERSION_CONSENTIMIENTO_IA]
    );
    await auditar({
      accion: "consentimiento.otorgar",
      recurso: "consentimientos",
      detalle: { tipo: "ia_datos_salud", version: VERSION_CONSENTIMIENTO_IA },
    });
    return null;
  });
}

export async function revocarConsentimientoIA(): Promise<{ error: string | null }> {
  return escritura("consentimiento.revocar", null, SIN_ENTRADA, async ({ db, uid, auditar }) => {
    await db.query(
      `update consentimientos set revocado_at = now()
        where uid = $1 and tipo = 'ia_datos_salud' and revocado_at is null`,
      [uid]
    );
    await auditar({ accion: "consentimiento.revocar", recurso: "consentimientos", detalle: { tipo: "ia_datos_salud" } });
    return null;
  });
}
