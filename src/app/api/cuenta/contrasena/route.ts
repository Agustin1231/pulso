import { avisarBloqueo, cambiarContrasena, cuentaDeSesion } from "@/lib/cuenta";
import { correoContrasenaCambiada, enviarDespues, urlDeLaApp } from "@/lib/correo";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { cambioContrasenaSchema, fallasDeContrasena } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

/**
 * Cambio de contraseña desde el perfil (integrador, punto 20): la actual, la
 * nueva (con la regla de contraseñas) y la sesión de una cuenta activada.
 *
 * La actual equivocada cuenta para el bloqueo de 5 intentos, como en el
 * login: con una sesión robada no se puede probar contraseñas sin freno. Si
 * sale bien, se cierran las DEMÁS sesiones de la cuenta (motivo 'contrasena';
 * la de este equipo sigue) y se avisa por correo.
 */
export const POST = rutaProtegida(
  {
    nombre: "cuenta.cambiar_contrasena",
    cuerpo: cambioContrasenaSchema,
    limites: (uid, ip) => [limite("cambioContrasena", uid), limite("cambioCuentaIp", ip)],
  },
  async ({ uid, ip, cuerpo }) => {
    const denegar = async (status: number, motivo: string, extra: Record<string, unknown> = {}) => {
      await auditar({ uid, accion: "cuenta.cambiar_contrasena", resultado: "denegado", ip, detalle: { motivo, ...extra } });
      return json({ error: motivo, ...extra }, status);
    };

    const cuenta = await cuentaDeSesion();
    if (!cuenta) return denegar(401, "cuenta_requerida");

    const reglas = fallasDeContrasena(cuerpo.nueva, cuenta.email);
    if (reglas.length > 0) {
      await auditar({ uid, accion: "cuenta.cambiar_contrasena", resultado: "denegado", ip, detalle: { motivo: "contrasena_invalida", reglas: reglas.map((r) => r.regla) } });
      return json({ error: "contrasena_invalida", reglas: reglas.map((r) => r.texto) }, 400);
    }

    const r = await cambiarContrasena(cuerpo.actual, cuerpo.nueva, cuenta.email);
    switch (r.resultado) {
      case "sin_cuenta":
        return denegar(401, "cuenta_requerida");
      case "bloqueada": {
        const minutos = r.minutos ?? 15;
        if (r.bloqueoNuevo) await avisarBloqueo({ uid, email: cuenta.email, ip, minutos, origen: "cambio_contrasena" });
        await auditar({ uid, accion: "cuenta.cambiar_contrasena", resultado: "denegado", ip, detalle: { motivo: "cuenta_bloqueada", minutos } });
        return json({ error: "cuenta_bloqueada", minutos }, 429, { "Retry-After": String(minutos * 60) });
      }
      case "credenciales":
        return denegar(400, "contrasena_actual_incorrecta", { intentos_restantes: r.intentosRestantes ?? 0 });
      case "contrasena_invalida":
        return denegar(400, "contrasena_invalida", { reglas: [] });
      case "misma":
        return denegar(400, "misma_contrasena");
    }

    enviarDespues(cuenta.email, correoContrasenaCambiada(urlDeLaApp("/acceso")), "contrasena_cambiada");
    await auditar({ uid, accion: "cuenta.cambiar_contrasena", resultado: "ok", ip, detalle: { sesiones_cerradas: r.sesionesCerradas } });
    return json({ ok: true, sesiones_cerradas: r.sesionesCerradas });
  }
);
