import { solicitarRecuperacion, sujetoCorreo } from "@/lib/cuenta";
import { correoRecuperacion, enviarDespues, urlDeLaApp } from "@/lib/correo";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaPublica } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { recuperarSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

/**
 * Manda el enlace para crear una contraseña nueva ("Olvidé mi contraseña",
 * integrador, punto 3). Responde lo mismo exista o no la cuenta, y el correo
 * sale después de responder: ni la respuesta ni su tiempo dicen si el correo
 * está registrado. Funciona aunque la cuenta esté bloqueada por intentos
 * fallidos: restablecer es la forma de desbloquearla.
 */
export const POST = rutaPublica(
  {
    nombre: "cuenta.recuperar",
    cuerpo: recuperarSchema,
    limites: (ip, cuerpo) => [limite("recuperacion", sujetoCorreo(cuerpo.email)), limite("recuperacionIp", ip)],
  },
  async ({ ip, cuerpo }) => {
    const token = await solicitarRecuperacion(cuerpo.email);
    if (token) {
      enviarDespues(cuerpo.email, correoRecuperacion(urlDeLaApp(`/acceso/restablecer?token=${token}`)), "recuperacion");
    }
    await auditar({ accion: "cuenta.recuperar", resultado: "ok", ip });
    return json({ ok: true });
  }
);
