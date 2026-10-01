import { mensajeError } from "@/lib/db/pool";
import { asegurarSesion, uidDeSesion } from "@/lib/sesion";
import { auditar } from "@/lib/seguridad/auditoria";
import { ipCliente, origenValido } from "@/lib/seguridad/red";
import { json } from "@/lib/seguridad/ruta";
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
 * No devuelve el uid: el cliente no lo necesita y no tiene por qué verlo.
 */
export async function POST(req: Request) {
  const ip = await ipCliente();
  if (!(await origenValido())) {
    await auditar({ accion: "sesion.asegurar", resultado: "denegado", ip, detalle: { motivo: "origen_no_permitido" } });
    return json({ error: "origen_no_permitido" }, 403);
  }

  const r = cuerpoSesionSchema.safeParse(await req.json().catch(() => ({})));
  const legado = r.success ? r.data.legado : undefined;

  try {
    // Solo la creación cuenta para el límite: renovar es gratis.
    if (!(await uidDeSesion())) {
      const cupo = await consumir([limite("sesionIp", ip ?? "sin-ip")]);
      if (!cupo.ok) {
        await auditar({ accion: "sesion.crear", resultado: "denegado", ip, detalle: { motivo: "demasiadas_peticiones" } });
        return json({ error: "demasiadas_peticiones" }, 429, { "Retry-After": "3600" });
      }
    }

    const { uid, origen } = await asegurarSesion(legado);

    if (origen !== "existente") {
      await auditar({ uid, accion: `sesion.${origen === "legado" ? "reclamar" : "crear"}`, resultado: "ok", ip });
    }
    if (legado && origen === "nueva") {
      // Trajo un UUID viejo que no se pudo reclamar: ya reclamado, vencido o inventado.
      await auditar({ uid, accion: "sesion.reclamar", resultado: "denegado", ip, detalle: { motivo: "legado_no_reclamable" } });
    }

    return json({ ok: true, origen });
  } catch (err) {
    console.error("[api] sesion:", mensajeError(err));
    return json({ error: "error_interno" }, 500);
  }
}
