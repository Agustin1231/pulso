import { bloquearSesion } from "@/lib/sesion";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";

export const runtime = "nodejs";

/** "Bloquear ahora": cierra la ventana de uso de esta sesión (por ejemplo, antes de prestar el teléfono). */
export const POST = rutaProtegida(
  { nombre: "bloqueo.bloquear", cuerpo: null },
  async ({ uid, ip }) => {
    await bloquearSesion();
    await auditar({ uid, accion: "bloqueo.bloquear", resultado: "ok", ip });
    return json({ ok: true });
  }
);
