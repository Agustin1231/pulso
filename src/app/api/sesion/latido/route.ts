import { mensajeError } from "@/lib/db/pool";
import { latidoDeSesion, motivoDeFin } from "@/lib/sesion";
import { auditar } from "@/lib/seguridad/auditoria";
import { ipCliente, origenValido } from "@/lib/seguridad/red";
import { CuerpoDemasiadoGrande, json, leerJson } from "@/lib/seguridad/ruta";
import { latidoSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

/**
 * Latido del vigía de sesión (integrador, punto 11). El cliente lo manda solo
 * cuando el usuario interactuó con la app (mouse, teclado, toques, scroll), y
 * espaciado: no uno por evento. Es la ÚNICA petición que mueve la actividad de
 * la sesión en el servidor; las lecturas, los guardados y los sondeos de fondo
 * no la tocan. Así, una sesión web sin interacción durante
 * `sesion_inactividad_minutos` se rechaza aunque una pestaña siga abierta
 * pidiendo datos, y también si el usuario cerró el navegador y vuelve después.
 *
 * Responde los dos tiempos vigentes: el cliente ajusta su cuenta regresiva en
 * cada latido, sin recargar, cuando el administrador los cambia. Si la sesión
 * ya no sirve, 401 con el motivo, igual que /api/sesion.
 */
export async function POST(req: Request) {
  const ip = await ipCliente();
  if (!(await origenValido())) return json({ error: "origen_no_permitido" }, 403);

  let crudo: unknown;
  try {
    crudo = await leerJson(req, 1024);
  } catch (err) {
    if (!(err instanceof CuerpoDemasiadoGrande)) throw err;
    return json({ error: "cuerpo_demasiado_grande" }, 413);
  }
  const r = latidoSchema.safeParse(crudo);
  if (!r.success) return json({ error: "datos_invalidos" }, 400);

  try {
    const i = await latidoDeSesion(r.data.hace);
    const config = { tokenMinutos: i.tokenMinutos, sesionMinutos: i.sesionMinutos, inactivaSeg: i.inactivaSeg };
    if (!i.vigente) {
      const motivo = await motivoDeFin();
      await auditar({ accion: "sesion.latido", resultado: "denegado", ip, detalle: { motivo: motivo ?? "sin_sesion" } });
      return json({ error: "sesion_requerida", motivo, config }, 401);
    }
    return json({ ok: true, config });
  } catch (err) {
    console.error("[api] sesion latido:", mensajeError(err));
    return json({ error: "error_interno" }, 500);
  }
}
