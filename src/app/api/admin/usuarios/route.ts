import { responder, usuarios } from "@/lib/admin/servidor";
import { rutaProtegida } from "@/lib/seguridad/ruta";

export const runtime = "nodejs";

/**
 * Usuarios con cuenta (puntos 5 y 8): estado, roles, permisos directos y
 * efectivos con su origen, última actividad y sesiones abiertas; los correos
 * van aparte, en `correos`. Exige `usuarios.ver` (lo comprueba la base, que
 * audita el rechazo).
 */
export const GET = rutaProtegida(
  { nombre: "admin.usuarios.ver", cuerpo: null },
  async ({ ip }) => responder(await usuarios(ip))
);
