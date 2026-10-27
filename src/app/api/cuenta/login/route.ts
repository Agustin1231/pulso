import { avisarBloqueo, hmacCorreo, sujetoCorreo } from "@/lib/cuenta";
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
 * mismo trabajo en los dos casos para que el tiempo tampoco lo diga. Un texto
 * que no es un correo (integrador, punto 2) ni llega acá: `rutaPublica` lo
 * rechaza con 400.
 *
 * Bloqueo (punto 4): 5 fallos seguidos con un correo, exista o no la cuenta,
 * lo bloquean 15 minutos (429 `cuenta_bloqueada`). Cada fallo cuenta, también
 * una contraseña como "123456789012345" (punto 12): el login no aplica la
 * regla de contraseñas, así que es un fallo más. El límite por IP de siempre
 * sigue aparte.
 *
 * Sesiones (punto 16): entrar cierra las demás sesiones de la cuenta.
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
    const r = await iniciarSesionConCuenta(hmacCorreo(cuerpo.email), cuerpo.password);

    if (r.resultado === "bloqueada") {
      if (r.bloqueoNuevo) {
        await avisarBloqueo({ uid: r.uid, email: cuerpo.email, ip, minutos: r.minutos, origen: "login" });
      }
      await auditar({
        uid: r.uid, accion: "cuenta.login", resultado: "denegado", ip,
        detalle: { motivo: r.bloqueoNuevo ? "credenciales" : "bloqueada", bloqueada: true, minutos: r.minutos },
      });
      return json({ error: "cuenta_bloqueada", minutos: r.minutos }, 429, { "Retry-After": String(r.minutos * 60) });
    }
    if (r.resultado === "credenciales") {
      await auditar({
        uid: r.uid, accion: "cuenta.login", resultado: "denegado", ip,
        detalle: { motivo: "credenciales", intentos_restantes: r.intentosRestantes },
      });
      return json({ error: "credenciales_invalidas", intentos_restantes: r.intentosRestantes }, 401);
    }
    if (r.resultado === "sin_verificar") {
      await auditar({ uid: r.uid, accion: "cuenta.login", resultado: "denegado", ip, detalle: { motivo: "sin_verificar" } });
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
    await auditar({
      uid: r.uid, accion: "cuenta.login", resultado: "ok", ip,
      detalle: { datos_sumados: r.fusionado !== null, sesiones_cerradas: r.sesionesCerradas },
    });
    return json({ ok: true, sesiones_cerradas: r.sesionesCerradas });
  }
);
