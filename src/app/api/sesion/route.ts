import { mensajeError } from "@/lib/db/pool";
import { asegurarSesion, cerrarSesionEnEsteEquipo, estadoSesion, eventoSesion, uidIgnorandoBloqueo } from "@/lib/sesion";
import { auditar } from "@/lib/seguridad/auditoria";
import { ipCliente, origenValido } from "@/lib/seguridad/red";
import { CuerpoDemasiadoGrande, json, leerJson } from "@/lib/seguridad/ruta";
import { consumir, limite } from "@/lib/seguridad/tasa";
import { cuerpoSesionSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

/**
 * Asegura la sesión del browser. La llama `useSesion` al abrir la app.
 *
 * - Con una cookie vigente: la renueva (vencimiento deslizante).
 * - Sin cookie: crea una sesión nueva. Si el body trae `legado` (el UUID viejo
 *   del localStorage), intenta reclamarlo para conservar el historial; cada uid
 *   viejo se puede reclamar una sola vez.
 *
 * Devuelve también el estado del bloqueo con passkey (fila 9), para que el
 * cliente muestre la pantalla de bloqueo si corresponde. No devuelve el uid:
 * el cliente no lo necesita y no tiene por qué verlo.
 */
export async function POST(req: Request) {
  const ip = await ipCliente();
  if (!(await origenValido())) {
    await auditar({ accion: "sesion.asegurar", resultado: "denegado", ip, detalle: { motivo: "origen_no_permitido" } });
    return json({ error: "origen_no_permitido" }, 403);
  }

  // El cuerpo solo trae el UUID viejo: 4 KB sobran. Se lee con tope porque
  // esta ruta no exige sesión (SAST-BE-10).
  let crudo: unknown;
  try {
    crudo = await leerJson(req, 4 * 1024);
  } catch (err) {
    if (!(err instanceof CuerpoDemasiadoGrande)) throw err;
    await auditar({ accion: "sesion.asegurar", resultado: "denegado", ip, detalle: { motivo: "cuerpo_demasiado_grande" } });
    return json({ error: "cuerpo_demasiado_grande" }, 413);
  }
  const r = cuerpoSesionSchema.safeParse(crudo ?? {});
  const legado = r.success ? r.data.legado : undefined;

  try {
    // Solo la creación cuenta para el límite: renovar es gratis. (Una sesión
    // bloqueada sigue siendo una sesión: no se crea otra.)
    if (!(await uidIgnorandoBloqueo())) {
      const cupo = await consumir([limite("sesionIp", ip ?? "sin-ip")]);
      if (!cupo.ok) {
        await auditar({ accion: "sesion.crear", resultado: "denegado", ip, detalle: { motivo: "demasiadas_peticiones" } });
        return json({ error: "demasiadas_peticiones" }, 429, { "Retry-After": "3600" });
      }
    }

    const { uid, origen } = await asegurarSesion(legado);

    if (origen !== "existente") {
      await auditar({ uid, accion: eventoSesion(origen), resultado: "ok", ip });
    }
    if (legado && origen === "nueva") {
      // Trajo un UUID viejo que no se pudo reclamar: ya reclamado, vencido o inventado.
      await auditar({ uid, accion: "sesion.reclamar", resultado: "denegado", ip, detalle: { motivo: "legado_no_reclamable" } });
    }

    const { bloqueo } = await estadoSesion();
    return json({ ok: true, origen, bloqueo });
  } catch (err) {
    console.error("[api] sesion:", mensajeError(err));
    return json({ error: "error_interno" }, 500);
  }
}

/** Estado de la sesión y del bloqueo, sin renovarla. El cliente lo consulta cada tanto. */
export async function GET() {
  try {
    const { estado, bloqueo } = await estadoSesion();
    return json({ estado, bloqueo });
  } catch (err) {
    console.error("[api] sesion GET:", mensajeError(err));
    return json({ error: "error_interno" }, 500);
  }
}

/**
 * Cerrar sesión en este equipo: revoca el token y borra la cookie. Funciona
 * con la sesión bloqueada: es la salida si no se puede desbloquear. Los datos
 * no se borran (para eso está /api/mis-datos, que exige desbloquear).
 */
export async function DELETE() {
  const ip = await ipCliente();
  if (!(await origenValido())) return json({ error: "origen_no_permitido" }, 403);
  try {
    const uid = await uidIgnorandoBloqueo();
    await cerrarSesionEnEsteEquipo();
    if (uid) await auditar({ uid, accion: "sesion.cerrar", resultado: "ok", ip });
    return json({ ok: true });
  } catch (err) {
    console.error("[api] sesion DELETE:", mensajeError(err));
    return json({ error: "error_interno" }, 500);
  }
}
