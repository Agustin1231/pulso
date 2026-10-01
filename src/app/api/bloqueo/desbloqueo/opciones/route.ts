import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { conUsuario } from "@/lib/db/pool";
import { fijarDesafio } from "@/lib/sesion";
import { relyingParty } from "@/lib/seguridad/passkey";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";

export const runtime = "nodejs";

/**
 * Paso 1 de desbloquear: el desafío que el teléfono tiene que firmar con la
 * passkey. Acepta la sesión bloqueada (si no, no habría forma de salir).
 */
export const POST = rutaProtegida(
  {
    nombre:            "bloqueo.desbloqueo_opciones",
    cuerpo:            null,
    permitirBloqueada: true,
    limites:           (uid, ip) => [limite("desbloqueo", uid), limite("desbloqueoIp", ip)],
  },
  async ({ uid }) => {
    const rp = await relyingParty();
    if (!rp) return json({ error: "host_no_permitido" }, 400);

    const credenciales = await conUsuario(uid, async (db) => {
      const { rows } = await db.query<{ id: string; transportes: string[] }>(
        "select id, transportes from credenciales_bloqueo where uid = $1",
        [uid]
      );
      return rows;
    });
    if (!credenciales.length) return json({ error: "sin_bloqueo" }, 400);

    const opciones = await generateAuthenticationOptions({
      rpID:             rp.rpID,
      allowCredentials: credenciales.map((c) => ({ id: c.id, transports: c.transportes })),
      userVerification: "required",
    });

    await fijarDesafio("desbloqueo", opciones.challenge);
    return json(opciones);
  }
);
