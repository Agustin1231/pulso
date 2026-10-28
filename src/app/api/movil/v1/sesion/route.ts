import { cuentaDeSesion, cuentaDeToken } from "@/lib/cuenta";
import { mensajeError } from "@/lib/db/pool";
import {
  asegurarSesionMovil,
  cerrarSesionEnEsteEquipo,
  estadoSesion,
  estadoSesionDeToken,
  eventoSesion,
  motivoDeFin,
  uidDeBearerIgnorandoBloqueo,
  uidIgnorandoBloqueo,
} from "@/lib/sesion";
import { auditar } from "@/lib/seguridad/auditoria";
import { ipCliente, origenValido } from "@/lib/seguridad/red";
import { json } from "@/lib/seguridad/ruta";
import { consumir, limite } from "@/lib/seguridad/tasa";
import { motivoCierreSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

/**
 * Sesión de la app nativa. Es `/api/sesion` sin cookies: el token viaja en
 * `Authorization: Bearer` y, cuando es nuevo o rotó, vuelve en el cuerpo para
 * que la app lo guarde cifrado. El uid tampoco se devuelve acá.
 *
 * La app llama POST al abrirse (y al volver de segundo plano); con un token
 * vigente lo renueva o lo rota, sin token crea una identidad anónima nueva.
 * Abrir la app o volver a ella cuenta como actividad del usuario (punto 11),
 * como abrir o recargar la página en la web.
 *
 * Responde `{ ok, origen, token, bloqueo, motivo, cuenta }`:
 *   - `token`: el que la app tiene que guardar, o null si sigue con el suyo.
 *   - `motivo`: si la app mandó un token que ya no sirve, por qué
 *     ('cierre', 'otro_inicio', 'inactividad', 'contrasena', 'admin' o
 *     'vencida'; null si no había una cuenta que perder). La app lo muestra
 *     en la pantalla de acceso (puntos 10, 11 y 16).
 *   - `cuenta`: `{ email, verificada }` de la sesión que queda, o null si es
 *     anónima. Con eso la app decide a qué pantalla ir: acceso, esperando la
 *     activación o la app. Con el bloqueo con passkey de la web activo y sin
 *     desbloquear, null: no se entrega ni el correo (y `bloqueo` lo dice).
 */
export async function POST() {
  const ip = await ipCliente();
  if (!(await origenValido())) {
    await auditar({ accion: "sesion.asegurar", resultado: "denegado", ip, detalle: { motivo: "origen_no_permitido", cliente: "movil" } });
    return json({ error: "origen_no_permitido" }, 403);
  }

  try {
    // Igual que en la web: solo la creación cuenta para el límite.
    if (!(await uidDeBearerIgnorandoBloqueo())) {
      const cupo = await consumir([limite("sesionIp", ip ?? "sin-ip")]);
      if (!cupo.ok) {
        await auditar({ accion: "sesion.crear", resultado: "denegado", ip, detalle: { motivo: "demasiadas_peticiones", cliente: "movil" } });
        return json({ error: "demasiadas_peticiones" }, 429, { "Retry-After": "3600" });
      }
    }

    const { uid, origen, token, motivo } = await asegurarSesionMovil();

    if (origen !== "existente") {
      await auditar({
        uid, accion: eventoSesion(origen), resultado: "ok", ip,
        detalle: motivo ? { cliente: "movil", anterior: motivo } : { cliente: "movil" },
      });
    }

    // `estadoSesion` y `cuentaDeSesion` leen el token de la petición, que es el
    // viejo si rotó o ninguno si es nueva: se pregunta por el token que la app
    // va a usar desde ahora. Una sesión recién creada no tiene cuenta.
    const { bloqueo } = token ? await estadoSesionDeToken(token) : await estadoSesion();
    const cuenta = origen === "nueva" ? null : token ? await cuentaDeToken(token) : await cuentaDeSesion();
    return json({ ok: true, origen, token, bloqueo, motivo, cuenta });
  } catch (err) {
    console.error("[api] movil sesion:", mensajeError(err));
    return json({ error: "error_interno" }, 500);
  }
}

/**
 * Estado de la sesión y del bloqueo, sin renovarla. Con un token que ya no
 * sirve, `motivo` dice por qué (como `GET /api/sesion`, que es el sondeo
 * completo del vigía, con los tiempos de inactividad).
 */
export async function GET() {
  try {
    const { estado, bloqueo } = await estadoSesion();
    const motivo = estado === "sin_sesion" ? await motivoDeFin() : null;
    return json({ estado, bloqueo, motivo });
  } catch (err) {
    console.error("[api] movil sesion GET:", mensajeError(err));
    return json({ error: "error_interno" }, 500);
  }
}

/**
 * Cerrar sesión en este teléfono: revoca el token. Los datos no se borran.
 * `?motivo=inactividad` cuando la cierra el vigía de inactividad de la app;
 * sin nada, 'cierre' (igual que `DELETE /api/sesion`).
 */
export async function DELETE(req: Request) {
  const ip = await ipCliente();
  if (!(await origenValido())) return json({ error: "origen_no_permitido" }, 403);
  const m = motivoCierreSchema.safeParse(new URL(req.url).searchParams.get("motivo") ?? undefined);
  if (!m.success) return json({ error: "datos_invalidos" }, 400);
  try {
    const uid = await uidIgnorandoBloqueo();
    await cerrarSesionEnEsteEquipo(m.data);
    if (uid) await auditar({ uid, accion: "sesion.cerrar", resultado: "ok", ip, detalle: { cliente: "movil", motivo: m.data } });
    return json({ ok: true });
  } catch (err) {
    console.error("[api] movil sesion DELETE:", mensajeError(err));
    return json({ error: "error_interno" }, 500);
  }
}
