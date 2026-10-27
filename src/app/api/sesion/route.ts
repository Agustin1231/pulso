import { mensajeError } from "@/lib/db/pool";
import {
  asegurarSesion,
  cerrarSesionEnEsteEquipo,
  estadoCuenta,
  estadoSesion,
  eventoSesion,
  inactividadDeSesion,
  motivoDeFin,
  uidIgnorandoBloqueo,
  type InactividadSesion,
} from "@/lib/sesion";
import { auditar } from "@/lib/seguridad/auditoria";
import { ipCliente, origenValido } from "@/lib/seguridad/red";
import { CuerpoDemasiadoGrande, json, leerJson } from "@/lib/seguridad/ruta";
import { consumir, limite } from "@/lib/seguridad/tasa";
import { cuerpoSesionSchema, motivoCierreSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

/**
 * Lo que el vigía de sesión del cliente necesita para la cuenta regresiva de
 * inactividad (integrador, punto 11): los dos tiempos vigentes y hace cuánto
 * interactuó el usuario según el servidor. Va en cada respuesta, así un cambio
 * del administrador rige sin recargar la página.
 */
function config(i: InactividadSesion) {
  return { tokenMinutos: i.tokenMinutos, sesionMinutos: i.sesionMinutos, inactivaSeg: i.inactivaSeg };
}

/**
 * Asegura la sesión del browser. La llama `useSesion` al abrir la app.
 *
 * - Con una cookie vigente: la renueva (vencimiento deslizante).
 * - Sin cookie: crea una sesión nueva. Si el body trae `legado` (el UUID viejo
 *   del localStorage), intenta reclamarlo para conservar el historial; cada uid
 *   viejo se puede reclamar una sola vez.
 * - Con la cookie de una sesión que ya no sirve: devuelve en `motivo` por qué
 *   (`otro_inicio`, `inactividad`, `cierre`, `contrasena`, `admin`, `vencida`)
 *   y recién después crea la sesión anónima nueva. /acceso se lo explica al
 *   usuario (integrador, punto 16 y los demás).
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

    const { uid, origen, motivo } = await asegurarSesion(legado);

    if (origen !== "existente") {
      await auditar({ uid, accion: eventoSesion(origen), resultado: "ok", ip, detalle: motivo ? { anterior: motivo } : undefined });
    }
    if (legado && origen === "nueva") {
      // Trajo un UUID viejo que no se pudo reclamar: ya reclamado, vencido o inventado.
      await auditar({ uid, accion: "sesion.reclamar", resultado: "denegado", ip, detalle: { motivo: "legado_no_reclamable" } });
    }

    const { bloqueo } = await estadoSesion();
    // Una sesión recién creada todavía no viaja en la petición: no tiene cuenta.
    const nueva = origen === "nueva" || origen === "legado";
    const cuenta = nueva ? "ninguna" : await estadoCuenta();
    const inactividad = await inactividadDeSesion();
    return json({ ok: true, origen, bloqueo, cuenta, motivo, config: config(nueva ? { ...inactividad, inactivaSeg: null } : inactividad) });
  } catch (err) {
    console.error("[api] sesion:", mensajeError(err));
    return json({ error: "error_interno" }, 500);
  }
}

/**
 * Estado de la sesión y del bloqueo, sin renovarla: el cliente lo consulta
 * cada tanto (cada 20 s, al volver a la pestaña y al navegar) y eso no cuenta
 * como uso ni como actividad del usuario. Si la sesión dejó de servir, trae el
 * motivo: así el navegador viejo del punto 16 se entera en segundos.
 */
export async function GET() {
  try {
    const { estado, bloqueo } = await estadoSesion();
    const motivo = estado === "sin_sesion" ? await motivoDeFin() : null;
    return json({ estado, bloqueo, cuenta: await estadoCuenta(), motivo, config: config(await inactividadDeSesion()) });
  } catch (err) {
    console.error("[api] sesion GET:", mensajeError(err));
    return json({ error: "error_interno" }, 500);
  }
}

/**
 * Cerrar sesión en este equipo: revoca el token y borra la cookie. Funciona
 * con la sesión bloqueada: es la salida si no se puede desbloquear. Los datos
 * no se borran (para eso está /api/mis-datos, que exige desbloquear).
 * `?motivo=inactividad` cuando la cierra el vigía de inactividad del cliente;
 * sin nada, 'cierre'. Ese motivo es el que ven las demás pestañas.
 */
export async function DELETE(req: Request) {
  const ip = await ipCliente();
  if (!(await origenValido())) return json({ error: "origen_no_permitido" }, 403);
  const m = motivoCierreSchema.safeParse(new URL(req.url).searchParams.get("motivo") ?? undefined);
  if (!m.success) return json({ error: "datos_invalidos" }, 400);
  try {
    const uid = await uidIgnorandoBloqueo();
    await cerrarSesionEnEsteEquipo(m.data);
    if (uid) await auditar({ uid, accion: "sesion.cerrar", resultado: "ok", ip, detalle: { motivo: m.data } });
    return json({ ok: true });
  } catch (err) {
    console.error("[api] sesion DELETE:", mensajeError(err));
    return json({ error: "error_interno" }, 500);
  }
}
