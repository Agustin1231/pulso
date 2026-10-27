import { avisarBloqueo, cuentaDeSesion, enmascararCorreo, solicitarCambioCorreo } from "@/lib/cuenta";
import { correoAvisoCambio, correoCambioEnUso, correoConfirmarCambio, enviarDespues, urlDeLaApp } from "@/lib/correo";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { cambioCorreoSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

/**
 * Pedido de cambio de correo desde el perfil (integrador, punto 20): la
 * contraseña actual (cuenta para el bloqueo de 5 intentos) y el correo nuevo.
 *
 * No cambia nada todavía: manda un enlace de confirmación al correo NUEVO
 * (así se prueba que es de quien lo pide) y un aviso al de siempre. El cambio
 * rige al abrir el enlace (/acceso/confirmar-correo).
 *
 * Si el correo nuevo ya es de otra cuenta, la respuesta es la misma y no se
 * cambia nada: al dueño de ese correo le llega un aviso en vez del enlace.
 * Así esta pantalla tampoco sirve para averiguar quién usa Pulso.
 */
export const POST = rutaProtegida(
  {
    nombre: "cuenta.cambiar_correo",
    cuerpo: cambioCorreoSchema,
    limites: (uid, ip) => [limite("cambioCorreo", uid), limite("cambioCuentaIp", ip)],
  },
  async ({ uid, ip, cuerpo }) => {
    const denegar = async (status: number, motivo: string, extra: Record<string, unknown> = {}) => {
      await auditar({ uid, accion: "cuenta.cambiar_correo", resultado: "denegado", ip, detalle: { motivo, ...extra } });
      return json({ error: motivo, ...extra }, status);
    };

    const cuenta = await cuentaDeSesion();
    if (!cuenta) return denegar(401, "cuenta_requerida");

    const r = await solicitarCambioCorreo(cuerpo.password, cuerpo.email);
    switch (r.resultado) {
      case "sin_cuenta":
        return denegar(401, "cuenta_requerida");
      case "bloqueada": {
        const minutos = r.minutos ?? 15;
        if (r.bloqueoNuevo) await avisarBloqueo({ uid, email: cuenta.email, ip, minutos, origen: "cambio_correo" });
        await auditar({ uid, accion: "cuenta.cambiar_correo", resultado: "denegado", ip, detalle: { motivo: "cuenta_bloqueada", minutos } });
        return json({ error: "cuenta_bloqueada", minutos }, 429, { "Retry-After": String(minutos * 60) });
      }
      case "credenciales":
        return denegar(400, "contrasena_actual_incorrecta", { intentos_restantes: r.intentosRestantes ?? 0 });
      case "mismo":
        return denegar(400, "mismo_correo");
    }

    // Al correo de siempre le llega el aviso en los dos casos: lo que ve quien
    // pidió el cambio es lo mismo, esté o no registrado el correo nuevo.
    enviarDespues(cuenta.email, correoAvisoCambio(urlDeLaApp("/acceso"), enmascararCorreo(cuerpo.email)), "aviso_cambio_correo");
    if (r.resultado === "ok" && r.token) {
      enviarDespues(cuerpo.email, correoConfirmarCambio(urlDeLaApp(`/acceso/confirmar-correo?token=${r.token}`)), "confirmar_correo");
      await auditar({ uid, accion: "cuenta.cambiar_correo", resultado: "ok", ip, detalle: { paso: "solicitud" } });
    } else {
      enviarDespues(cuerpo.email, correoCambioEnUso(urlDeLaApp("/acceso")), "correo_en_uso");
      await auditar({ uid, accion: "cuenta.cambiar_correo", resultado: "denegado", ip, detalle: { motivo: "email_en_uso" } });
    }
    return json({ ok: true });
  }
);
