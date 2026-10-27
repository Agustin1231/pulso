import type { z } from "zod";
import { accesoSchema, uidSchema } from "@/lib/admin/esquemas";
import { entradaInvalida, fijarAcceso, responder } from "@/lib/admin/servidor";
import { rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";

export const runtime = "nodejs";

/**
 * Fija TODOS los roles y TODOS los permisos directos de un usuario (puntos 5
 * y 8): `{ roles: [ids], permisos: [claves] }`. Lo que no viene se le quita.
 * Exige `usuarios.editar`; la base además impide otorgar lo que uno no tiene y
 * dejar el sistema sin administradores, y audita el antes y el después.
 */
export const PUT = rutaProtegida<z.infer<typeof accesoSchema>, { params: Promise<{ uid: string }> }>(
  {
    nombre: "admin.usuario.acceso",
    cuerpo: accesoSchema,
    limites: (uid, ip) => [limite("escritura", uid), limite("escrituraIp", ip)],
  },
  async ({ uid, ip, cuerpo }, { params }) => {
    const objetivo = uidSchema.safeParse((await params).uid);
    if (!objetivo.success) return entradaInvalida(uid, "admin.usuario.acceso", ip, ["uid"]);
    return responder(await fijarAcceso(objetivo.data, cuerpo, ip));
  }
);
