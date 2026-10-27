import { misPermisos, responder } from "@/lib/admin/servidor";
import { rutaProtegida } from "@/lib/seguridad/ruta";

export const runtime = "nodejs";

/**
 * Permisos efectivos del usuario de la sesión (roles ∪ directos), para mostrar
 * u ocultar el enlace "Administración" y las pestañas del panel. Es solo para
 * la interfaz: cada operación de /api/admin vuelve a exigir su permiso en la base.
 */
export const GET = rutaProtegida(
  { nombre: "admin.permisos", cuerpo: null },
  async () => responder(await misPermisos())
);
