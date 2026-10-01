import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

/**
 * Configuración WebAuthn del bloqueo con passkey (plantilla, fila 9).
 *
 * Una passkey queda atada a un dominio (el "rpID"): el autenticador del
 * teléfono no la entrega a ningún otro sitio, así que una página de phishing
 * no puede pedirla. El rpID sale de esta lista cerrada, no de lo que diga el
 * request: un Host inventado no sirve.
 */
const HOSTS_PERMITIDOS = ["pulso.agustinynatalia.site", "localhost"];

export interface RelyingParty {
  rpID:    string;
  /** Orígenes aceptados al verificar (WebAuthn exige HTTPS salvo en localhost). */
  origins: string[];
}

export async function relyingParty(): Promise<RelyingParty | null> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim().toLowerCase();
  const hostname = host.replace(/:\d+$/, "");
  if (!HOSTS_PERMITIDOS.includes(hostname)) return null;

  if (hostname === "localhost") {
    return { rpID: hostname, origins: [`http://${host}`, `https://${host}`] };
  }
  return { rpID: hostname, origins: [`https://${host}`] };
}

/**
 * Identificador de usuario para WebAuthn: opaco y estable. Es un hash del uid,
 * no el uid: el gestor de passkeys del teléfono lo guarda y no tiene por qué
 * conocer el identificador real.
 */
export function idUsuarioWebAuthn(uid: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash("sha256").update(`pulso-webauthn:${uid}`).digest());
}

/** Nombre que muestra el gestor de passkeys. Sin datos personales. */
export function nombrePasskey(uid: string): string {
  const corto = createHash("sha256").update(`pulso-nombre:${uid}`).digest("hex").slice(0, 6);
  return `Pulso · ${corto}`;
}
