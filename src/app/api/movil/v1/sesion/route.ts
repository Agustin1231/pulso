import { mensajeError } from "@/lib/db/pool";
import {
  asegurarSesionMovil,
  cerrarSesionEnEsteEquipo,
  estadoSesion,
  estadoSesionDeToken,
  eventoSesion,
  uidDeBearerIgnorandoBloqueo,
  uidIgnorandoBloqueo,
} from "@/lib/sesion";
import { auditar } from "@/lib/seguridad/auditoria";
import { ipCliente, origenValido } from "@/lib/seguridad/red";
import { json } from "@/lib/seguridad/ruta";
import { consumir, limite } from "@/lib/seguridad/tasa";

export const runtime = "nodejs";

/**
 * Sesión de la app nativa. Es `/api/sesion` sin cookies: el token viaja en
 * `Authorization: Bearer` y, cuando es nuevo o rotó, vuelve en el cuerpo para
 * que la app lo guarde cifrado. El uid tampoco se devuelve acá.
 *
 * La app llama POST al abrirse (y al volver de segundo plano); con un token
 * vigente lo renueva o lo rota, sin token crea una identidad anónima nueva.
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

    const { uid, origen, token } = await asegurarSesionMovil();

    if (origen !== "existente") {
      await auditar({ uid, accion: eventoSesion(origen), resultado: "ok", ip, detalle: { cliente: "movil" } });
    }

    // `estadoSesion` lee el token de la petición, que es el viejo si rotó o
    // ninguno si es nueva: el bloqueo es por identidad, así que se pregunta
    // por el token que la app va a usar desde ahora.
    const { bloqueo } = token ? await estadoSesionDeToken(token) : await estadoSesion();
    return json({ ok: true, origen, token, bloqueo });
  } catch (err) {
    console.error("[api] movil sesion:", mensajeError(err));
    return json({ error: "error_interno" }, 500);
  }
}

/** Estado de la sesión y del bloqueo, sin renovarla. */
export async function GET() {
  try {
    const { estado, bloqueo } = await estadoSesion();
    return json({ estado, bloqueo });
  } catch (err) {
    console.error("[api] movil sesion GET:", mensajeError(err));
    return json({ error: "error_interno" }, 500);
  }
}

/** Cerrar sesión en este teléfono: revoca el token. Los datos no se borran. */
export async function DELETE() {
  const ip = await ipCliente();
  if (!(await origenValido())) return json({ error: "origen_no_permitido" }, 403);
  try {
    const uid = await uidIgnorandoBloqueo();
    await cerrarSesionEnEsteEquipo();
    if (uid) await auditar({ uid, accion: "sesion.cerrar", resultado: "ok", ip, detalle: { cliente: "movil" } });
    return json({ ok: true });
  } catch (err) {
    console.error("[api] movil sesion DELETE:", mensajeError(err));
    return json({ error: "error_interno" }, 500);
  }
}
