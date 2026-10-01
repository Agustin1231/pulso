import { generateRegistrationOptions } from "@simplewebauthn/server";
import { conUsuario } from "@/lib/db/pool";
import { fijarDesafio } from "@/lib/sesion";
import { idUsuarioWebAuthn, nombrePasskey, relyingParty } from "@/lib/seguridad/passkey";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";

export const runtime = "nodejs";

/**
 * Paso 1 de activar el bloqueo (plantilla, fila 9): opciones para que el
 * teléfono cree una passkey (huella, Face ID o PIN del equipo). El desafío
 * queda guardado en la sesión, de un solo uso y por 5 minutos.
 */
export const POST = rutaProtegida(
  {
    nombre:  "bloqueo.registro_opciones",
    cuerpo:  null,
    limites: (uid, ip) => [limite("passkey", uid), limite("passkeyIp", ip)],
  },
  async ({ uid }) => {
    const rp = await relyingParty();
    if (!rp) return json({ error: "host_no_permitido" }, 400);

    const existentes = await conUsuario(uid, async (db) => {
      const { rows } = await db.query<{ id: string; transportes: string[] }>(
        "select id, transportes from credenciales_bloqueo where uid = $1",
        [uid]
      );
      return rows;
    });

    const opciones = await generateRegistrationOptions({
      rpName:          "Pulso",
      rpID:            rp.rpID,
      userID:          idUsuarioWebAuthn(uid),
      userName:        nombrePasskey(uid),
      userDisplayName: "Pulso",
      attestationType: "none",
      excludeCredentials: existentes.map((c) => ({ id: c.id, transports: c.transportes })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      preferredAuthenticatorType: "localDevice",
    });

    await fijarDesafio("registro", opciones.challenge);
    return json(opciones);
  }
);
