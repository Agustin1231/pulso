import { sujetoCorreo } from "@/lib/cuenta";
import { mensajeError } from "@/lib/db/pool";
import { moverImagenes } from "@/lib/media";
import { iniciarSesionConCuenta } from "@/lib/sesion";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaPublica } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { loginSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

/**
 * Inicia sesión con correo y contraseña. Con una contraseña mala o un correo
 * que no existe responde lo mismo (`credenciales_invalidas`), y la base hace el
 * mismo trabajo en los dos casos para que el tiempo tampoco lo diga.
 *
 * Lo guardado en este equipo sin cuenta se suma a la cuenta (ver
 * `pulso_fusionar_identidad`); acá se mueven además sus imágenes.
 */
export const POST = rutaPublica(
  {
    nombre: "cuenta.login",
    cuerpo: loginSchema,
    limites: (ip, cuerpo) => [limite("login", sujetoCorreo(cuerpo.email)), limite("loginIp", ip)],
  },
  async ({ ip, cuerpo }) => {
    const r = await iniciarSesionConCuenta(cuerpo.email, cuerpo.password);
    if (r.resultado === "credenciales") {
      await auditar({ accion: "cuenta.login", resultado: "denegado", ip, detalle: { motivo: "credenciales" } });
      return json({ error: "credenciales_invalidas" }, 401);
    }
    if (r.resultado === "sin_verificar") {
      await auditar({ accion: "cuenta.login", resultado: "denegado", ip, detalle: { motivo: "sin_verificar" } });
      return json({ error: "cuenta_sin_activar" }, 403);
    }

    if (r.fusionado) {
      try {
        await moverImagenes(r.fusionado, r.uid);
      } catch (err) {
        // Los datos ya están en la cuenta; solo se pierde la foto de alguna receta.
        console.error("[api] cuenta.login: no se pudieron mover las imágenes:", mensajeError(err));
      }
    }
    await auditar({ uid: r.uid, accion: "cuenta.login", resultado: "ok", ip, detalle: { datos_sumados: r.fusionado !== null } });
    return json({ ok: true });
  }
);
