import { registrarCuenta } from "@/lib/cuenta";
import { correoActivacion, correoYaRegistrado, enviarDespues, urlDeLaApp } from "@/lib/correo";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { registroSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

/**
 * Crea la cuenta sobre la identidad de la sesión (sus datos quedan en la
 * cuenta) y manda el enlace de activación.
 *
 * Si el correo ya es de otra cuenta, la respuesta es la misma ("revisa tu
 * correo") y el aviso le llega al dueño del correo: así el registro no sirve
 * para averiguar quién usa Pulso.
 */
export const POST = rutaProtegida(
  {
    nombre: "cuenta.registrar",
    sinCuenta: true,
    cuerpo: registroSchema,
    limites: (uid, ip) => [limite("registro", uid), limite("registroIp", ip)],
  },
  async ({ uid, ip, cuerpo }) => {
    const { resultado, token } = await registrarCuenta(cuerpo.email, cuerpo.password);
    switch (resultado) {
      case "sin_sesion":          return json({ error: "sesion_requerida" }, 401);
      case "ya_tiene_cuenta":     return json({ error: "ya_tiene_cuenta" }, 409);
      case "contrasena_invalida": return json({ error: "datos_invalidos" }, 400);
    }

    if (resultado === "ok" && token) {
      enviarDespues(cuerpo.email, correoActivacion(urlDeLaApp(`/acceso/activar?token=${token}`)), "activacion");
      await auditar({ uid, accion: "cuenta.registrar", resultado: "ok", ip });
    } else {
      enviarDespues(cuerpo.email, correoYaRegistrado(urlDeLaApp("/acceso")), "ya_registrado");
      await auditar({ uid, accion: "cuenta.registrar", resultado: "denegado", ip, detalle: { motivo: "email_en_uso" } });
    }
    return json({ ok: true });
  }
);
