import type { z } from "zod";
import { rolSchema } from "@/lib/admin/esquemas";
import { crearRol, responder, roles } from "@/lib/admin/servidor";
import { rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";

export const runtime = "nodejs";

/**
 * Roles con sus permisos y sus miembros, y el catálogo de permisos. Lo ven
 * quien tiene `roles.gestionar` o `usuarios.ver` (para saber qué da cada rol).
 */
export const GET = rutaProtegida(
  { nombre: "admin.roles.ver", cuerpo: null },
  async ({ ip }) => responder(await roles(ip))
);

/** Crea un rol (punto 5): `{ nombre, descripcion, permisos }`. Exige `roles.gestionar`. */
export const POST = rutaProtegida<z.infer<typeof rolSchema>>(
  {
    nombre: "admin.rol.crear",
    cuerpo: rolSchema,
    limites: (uid, ip) => [limite("escritura", uid), limite("escrituraIp", ip)],
  },
  async ({ ip, cuerpo }) => responder(await crearRol(cuerpo, ip))
);
