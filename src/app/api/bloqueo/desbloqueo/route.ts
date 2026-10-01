import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { conUsuario, mensajeError } from "@/lib/db/pool";
import { consumirDesafio, desbloquearSesion } from "@/lib/sesion";
import { auditar, auditarEn } from "@/lib/seguridad/auditoria";
import { relyingParty } from "@/lib/seguridad/passkey";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { respuestaAutenticacionSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

interface CredencialRow {
  id:            string;
  clave_publica: Buffer;
  contador:      string; // bigint llega como string
  transportes:   string[];
}

/**
 * Paso 2 de desbloquear: verifica la firma de la passkey contra la clave
 * pública guardada. Exige verificación de usuario. El contador detecta una
 * passkey clonada (si no avanza, se rechaza). Si sale bien, abre una ventana
 * de uso de 15 minutos que se corre mientras se usa la app.
 */
export const POST = rutaProtegida(
  {
    nombre:            "bloqueo.desbloquear",
    cuerpo:            respuestaAutenticacionSchema,
    permitirBloqueada: true,
    limites:           (uid, ip) => [limite("desbloqueo", uid), limite("desbloqueoIp", ip)],
  },
  async ({ uid, ip, cuerpo }) => {
    const rp = await relyingParty();
    if (!rp) return json({ error: "host_no_permitido" }, 400);

    const desafio = await consumirDesafio("desbloqueo");
    if (!desafio) return json({ error: "desafio_vencido" }, 400);

    const credencial = await conUsuario(uid, async (db) => {
      const { rows } = await db.query<CredencialRow>(
        "select id, clave_publica, contador, transportes from credenciales_bloqueo where uid = $1 and id = $2",
        [uid, cuerpo.id]
      );
      return rows[0] ?? null;
    });

    const rechazar = async (motivo: string) => {
      await auditar({ uid, accion: "bloqueo.desbloquear", resultado: "denegado", ip, detalle: { motivo } });
      return json({ error: "passkey_invalida" }, 401);
    };
    if (!credencial) return rechazar("credencial_desconocida");

    let verificada;
    try {
      verificada = await verifyAuthenticationResponse({
        response:          cuerpo as unknown as AuthenticationResponseJSON,
        expectedChallenge: desafio,
        expectedOrigin:    rp.origins,
        expectedRPID:      rp.rpID,
        credential: {
          id:         credencial.id,
          publicKey:  new Uint8Array(credencial.clave_publica),
          counter:    Number(credencial.contador),
          transports: credencial.transportes,
        },
        requireUserVerification: true,
      });
    } catch (err) {
      console.warn("[bloqueo] desbloqueo rechazado:", mensajeError(err));
      return rechazar("firma_invalida");
    }
    if (!verificada.verified) return rechazar("firma_invalida");

    await conUsuario(uid, async (db) => {
      await db.query(
        "update credenciales_bloqueo set contador = $3, ultimo_uso = now() where uid = $1 and id = $2",
        [uid, credencial.id, verificada.authenticationInfo.newCounter]
      );
      await auditarEn(db, { uid, accion: "bloqueo.desbloquear", resultado: "ok", ip, recurso: "credenciales_bloqueo" });
    });
    await desbloquearSesion();

    return json({ ok: true });
  }
);
