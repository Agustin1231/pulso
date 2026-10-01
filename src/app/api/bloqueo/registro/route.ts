import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { conUsuario, mensajeError } from "@/lib/db/pool";
import { consumirDesafio, desbloquearSesion } from "@/lib/sesion";
import { auditar, auditarEn } from "@/lib/seguridad/auditoria";
import { relyingParty } from "@/lib/seguridad/passkey";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { respuestaRegistroSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

/**
 * Paso 2 de activar el bloqueo: verifica la passkey recién creada y guarda su
 * clave PÚBLICA. Exige verificación de usuario (huella, cara o PIN), no solo
 * presencia. Desde acá, la sesión necesita desbloquearse para usarse.
 */
export const POST = rutaProtegida(
  {
    nombre:  "bloqueo.activar",
    cuerpo:  respuestaRegistroSchema,
    limites: (uid, ip) => [limite("passkey", uid), limite("passkeyIp", ip)],
  },
  async ({ uid, ip, cuerpo }) => {
    const rp = await relyingParty();
    if (!rp) return json({ error: "host_no_permitido" }, 400);

    const desafio = await consumirDesafio("registro");
    if (!desafio) return json({ error: "desafio_vencido" }, 400);

    let verificada;
    try {
      verificada = await verifyRegistrationResponse({
        response:                cuerpo as unknown as RegistrationResponseJSON,
        expectedChallenge:       desafio,
        expectedOrigin:          rp.origins,
        expectedRPID:            rp.rpID,
        requireUserVerification: true,
      });
    } catch (err) {
      console.warn("[bloqueo] registro rechazado:", mensajeError(err));
      verificada = { verified: false as const };
    }
    if (!verificada.verified) {
      await auditar({ uid, accion: "bloqueo.activar", resultado: "denegado", ip, detalle: { motivo: "passkey_invalida" } });
      return json({ error: "passkey_invalida" }, 400);
    }

    const { credential } = verificada.registrationInfo;

    // Primero se abre la ventana de uso y después se guarda la passkey: si
    // fuera al revés, una petición en el medio vería la sesión bloqueada.
    await desbloquearSesion();
    await conUsuario(uid, async (db) => {
      await db.query(
        `insert into credenciales_bloqueo (id, uid, clave_publica, contador, transportes)
         values ($1, $2, $3, $4, $5)`,
        [credential.id, uid, Buffer.from(credential.publicKey), credential.counter, credential.transports ?? []]
      );
      await auditarEn(db, { uid, accion: "bloqueo.activar", resultado: "ok", ip, recurso: "credenciales_bloqueo" });
    });

    return json({ ok: true });
  }
);
