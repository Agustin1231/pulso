import "server-only";
import { avisarBloqueo, hmacCorreo, sujetoCorreo } from "@/lib/cuenta";
import { mensajeError } from "@/lib/db/pool";
import { moverImagenes } from "@/lib/media";
import { iniciarSesionConCuenta } from "@/lib/sesion";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaPublica } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { loginSchema } from "@/lib/seguridad/validacion";

/**
 * Inicio de sesión con correo y contraseña, el mismo para los dos clientes:
 * `POST /api/cuenta/login` (web) y `POST /api/movil/v1/cuenta/login` (app
 * nativa). Cambia solo cómo viaja el token:
 *   - web: la sesión de este equipo es la cookie (o el Bearer, si viene) y el
 *     token nuevo va a la cookie. La respuesta no lo trae.
 *   - movil: la sesión de este equipo es el Bearer, no se toca ninguna cookie y
 *     el token nuevo vuelve en el cuerpo (`token`) para que la app lo guarde
 *     cifrado en lugar del anterior, que queda revocado. Sus sesiones quedan
 *     marcadas `cliente = 'movil'`.
 * Todo lo demás (validación, límites, bloqueo, auditoría, fusión de datos) es
 * el mismo código: lo que se prueba en la web vale para la app.
 *
 * Con una contraseña mala o un correo que no existe responde lo mismo
 * (`credenciales_invalidas`), y la base hace el mismo trabajo en los dos casos
 * para que el tiempo tampoco lo diga. Un texto que no es un correo
 * (integrador, punto 2) ni llega acá: `rutaPublica` lo rechaza con 400.
 *
 * Bloqueo (punto 4): 5 fallos seguidos con un correo, exista o no la cuenta,
 * lo bloquean 15 minutos (429 `cuenta_bloqueada`). Cada fallo cuenta, también
 * una contraseña como "123456789012345" (punto 12): el login no aplica la
 * regla de contraseñas, así que es un fallo más. El límite por IP de siempre
 * sigue aparte.
 *
 * Sesiones (punto 16): entrar cierra las demás sesiones de la cuenta, de los
 * dos clientes: entrar en el teléfono saca al navegador y al revés.
 *
 * Lo guardado en este equipo sin cuenta se suma a la cuenta (ver
 * `pulso_fusionar_identidad`); acá se mueven además sus imágenes.
 *
 * Cada evento de la auditoría lleva `cliente`, para distinguir en el panel de
 * dónde se entró (o se intentó).
 */
export function rutaLogin(cliente: "web" | "movil"): (req: Request) => Promise<Response> {
  return rutaPublica(
    {
      nombre: "cuenta.login",
      cuerpo: loginSchema,
      limites: (ip, cuerpo) => [limite("login", sujetoCorreo(cuerpo.email)), limite("loginIp", ip)],
      detalle: { cliente },
      camposEnRespuesta: cliente === "movil",
    },
    async ({ ip, cuerpo }) => {
      const r = await iniciarSesionConCuenta(hmacCorreo(cuerpo.email), cuerpo.password, cliente);

      if (r.resultado === "bloqueada") {
        if (r.bloqueoNuevo) {
          await avisarBloqueo({ uid: r.uid, email: cuerpo.email, ip, minutos: r.minutos, origen: "login" });
        }
        await auditar({
          uid: r.uid, accion: "cuenta.login", resultado: "denegado", ip,
          detalle: { motivo: r.bloqueoNuevo ? "credenciales" : "bloqueada", bloqueada: true, minutos: r.minutos, cliente },
        });
        return json({ error: "cuenta_bloqueada", minutos: r.minutos }, 429, { "Retry-After": String(r.minutos * 60) });
      }
      if (r.resultado === "credenciales") {
        await auditar({
          uid: r.uid, accion: "cuenta.login", resultado: "denegado", ip,
          detalle: { motivo: "credenciales", intentos_restantes: r.intentosRestantes, cliente },
        });
        return json({ error: "credenciales_invalidas", intentos_restantes: r.intentosRestantes }, 401);
      }
      if (r.resultado === "sin_verificar") {
        await auditar({ uid: r.uid, accion: "cuenta.login", resultado: "denegado", ip, detalle: { motivo: "sin_verificar", cliente } });
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
        detalle: { cliente, datos_sumados: r.fusionado !== null, sesiones_cerradas: r.sesionesCerradas },
      });
      return cliente === "movil"
        ? json({ ok: true, token: r.token, sesiones_cerradas: r.sesionesCerradas })
        : json({ ok: true, sesiones_cerradas: r.sesionesCerradas });
    }
  );
}
