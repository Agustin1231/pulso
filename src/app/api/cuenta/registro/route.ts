import { registrarCuenta } from "@/lib/cuenta";
import { correoActivacion, correoYaRegistrado, enviarDespues, urlDeLaApp } from "@/lib/correo";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { fallasDeContrasena, registroSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

/**
 * Crea la cuenta sobre la identidad de la sesión (sus datos quedan en la
 * cuenta) y manda el enlace de activación.
 *
 * Regla de contraseñas (integrador, punto 13): si no la cumple, 400
 * `contrasena_invalida` con el texto de cada regla que falla. La base la
 * vuelve a aplicar.
 *
 * Duplicados (punto 6): si el correo ya es de otra cuenta (también escrito con
 * otras mayúsculas o con espacios), la respuesta es la misma y el aviso le
 * llega al dueño del correo: así el registro no sirve para averiguar quién usa
 * Pulso. La base lo impide igual con un índice único sobre el correo.
 */
export const POST = rutaProtegida(
  {
    nombre: "cuenta.registrar",
    sinCuenta: true,
    cuerpo: registroSchema,
    limites: (uid, ip) => [limite("registro", uid), limite("registroIp", ip)],
  },
  async ({ uid, ip, cuerpo }) => {
    const reglas = fallasDeContrasena(cuerpo.password, cuerpo.email);
    if (reglas.length > 0) {
      await auditar({ uid, accion: "cuenta.registrar", resultado: "denegado", ip, detalle: { motivo: "contrasena_invalida", reglas: reglas.map((r) => r.regla) } });
      return json({ error: "contrasena_invalida", reglas: reglas.map((r) => r.texto) }, 400);
    }

    const { resultado, token } = await registrarCuenta(cuerpo.email, cuerpo.password);
    switch (resultado) {
      case "sin_sesion":          return json({ error: "sesion_requerida" }, 401);
      case "ya_tiene_cuenta":     return json({ error: "ya_tiene_cuenta" }, 409);
      case "contrasena_invalida":
        await auditar({ uid, accion: "cuenta.registrar", resultado: "denegado", ip, detalle: { motivo: "contrasena_invalida", capa: "base" } });
        return json({ error: "contrasena_invalida", reglas: [] }, 400);
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
