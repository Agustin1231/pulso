import { filtrosErroresSchema, parametros } from "@/lib/admin/esquemas";
import { entradaInvalida, errores, responder } from "@/lib/admin/servidor";
import { rutaProtegida } from "@/lib/seguridad/ruta";

export const runtime = "nodejs";

/**
 * Registro de errores (punto 17), del más nuevo al más viejo. Filtros:
 * `origen` (prefijo) y `antes` (id, para la página siguiente). Exige `errores.ver`.
 */
export const GET = rutaProtegida(
  { nombre: "admin.errores.ver", cuerpo: null },
  async ({ req, uid, ip }) => {
    const filtros = filtrosErroresSchema.safeParse(parametros(req));
    if (!filtros.success) {
      return entradaInvalida(uid, "admin.errores.ver", ip, filtros.error.issues.map((i) => i.path.join(".")));
    }
    return responder(await errores(filtros.data, ip));
  }
);
