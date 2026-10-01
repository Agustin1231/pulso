// Autenticador WebAuthn de software para las pruebas del bloqueo con passkey.
//
// Hace lo mismo que el autenticador de un teléfono: crea un par de claves
// ECDSA P-256, entrega la pública en el registro y firma los desafíos en el
// desbloqueo. Así el servidor verifica firmas reales, no un mock: si la
// verificación de @simplewebauthn/server estuviera mal usada, estas pruebas
// fallarían.

import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

const sha256 = (b) => createHash("sha256").update(b).digest();
const b64u = (b) => isoBase64URL.fromBuffer(new Uint8Array(b));

const FLAG_UP = 0x01; // usuario presente
const FLAG_UV = 0x04; // usuario verificado (huella, cara o PIN)
const FLAG_AT = 0x40; // trae datos de credencial

export class AutenticadorSoftware {
  constructor({ origen, rpID }) {
    this.origen = origen;
    this.rpID = rpID;
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privada = privateKey;
    this.publicaJwk = publicKey.export({ format: "jwk" });
    this.credId = randomBytes(16);
    this.contador = 0;
  }

  get id() {
    return b64u(this.credId);
  }

  clientData(tipo, desafio) {
    return Buffer.from(JSON.stringify({ type: tipo, challenge: desafio, origin: this.origen, crossOrigin: false }));
  }

  authData(flags, extra = Buffer.alloc(0)) {
    const contador = Buffer.alloc(4);
    contador.writeUInt32BE(this.contador);
    return Buffer.concat([sha256(this.rpID), Buffer.from([flags]), contador, extra]);
  }

  /** Respuesta a `navigator.credentials.create` con attestation "none". */
  registrar(opciones, { verificarUsuario = true } = {}) {
    const x = Buffer.from(this.publicaJwk.x, "base64url");
    const y = Buffer.from(this.publicaJwk.y, "base64url");
    const cose = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(x)], [-3, new Uint8Array(y)]]));
    const largo = Buffer.alloc(2);
    largo.writeUInt16BE(this.credId.length);
    const datosCredencial = Buffer.concat([Buffer.alloc(16), largo, this.credId, Buffer.from(cose)]);

    const flags = FLAG_UP | FLAG_AT | (verificarUsuario ? FLAG_UV : 0);
    const authData = this.authData(flags, datosCredencial);
    const attestationObject = isoCBOR.encode(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", new Uint8Array(authData)]]));

    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64u(this.clientData("webauthn.create", opciones.challenge)),
        attestationObject: b64u(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** Respuesta a `navigator.credentials.get`. `firmaInvalida` corrompe la firma. */
  firmar(opciones, { firmaInvalida = false, verificarUsuario = true } = {}) {
    this.contador += 1;
    const authData = this.authData(FLAG_UP | (verificarUsuario ? FLAG_UV : 0));
    const clientData = this.clientData("webauthn.get", opciones.challenge);
    const firma = sign("sha256", Buffer.concat([authData, sha256(clientData)]), this.privada);
    if (firmaInvalida) firma[firma.length - 1] ^= 0xff;

    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64u(clientData),
        authenticatorData: b64u(authData),
        signature: b64u(firma),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
