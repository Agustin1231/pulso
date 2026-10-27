import type { z } from "zod";
import { rolIdSchema, rolSchema } from "@/lib/admin/esquemas";
import { borrarRol, editarRol, entradaInvalida, responder } from "@/lib/admin/servidor";
import { rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Edita un rol: nombre, descripción y TODOS sus permisos. Al rol de sistema
 * (Administrador) no se le cambia nada: la base responde `rol_de_sistema`.
 */
export const PUT = rutaProtegida<z.infer<typeof rolSchema>, Params>(
  {
    nombre: "admin.rol.editar",
    cuerpo: rolSchema,
    limites: (uid, ip) => [limite("escritura", uid), limite("escrituraIp", ip)],
  },
  async ({ uid, ip, cuerpo }, { params }) => {
    const id = rolIdSchema.safeParse((await params).id);
    if (!id.success) return entradaInvalida(uid, "admin.rol.editar", ip, ["id"]);
    return responder(await editarRol(id.data, cuerpo, ip));
  }
);

/** Borra un rol y se lo quita a sus miembros. El de sistema no se borra. */
export const DELETE = rutaProtegida<undefined, Params>(
  {
    nombre: "admin.rol.borrar",
    cuerpo: null,
    limites: (uid, ip) => [limite("escritura", uid), limite("escrituraIp", ip)],
  },
  async ({ uid, ip }, { params }) => {
    const id = rolIdSchema.safeParse((await params).id);
    if (!id.success) return entradaInvalida(uid, "admin.rol.borrar", ip, ["id"]);
    return responder(await borrarRol(id.data, ip));
  }
);
