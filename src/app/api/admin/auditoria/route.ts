import { filtrosAuditoriaSchema, parametros } from "@/lib/admin/esquemas";
import { auditoria, entradaInvalida, responder } from "@/lib/admin/servidor";
import { rutaProtegida } from "@/lib/seguridad/ruta";

export const runtime = "nodejs";

/**
 * Registro de auditoría (punto 9), del evento más nuevo al más viejo, 50 por
 * página. Filtros en el query string: `accion` (prefijo, ej. "admin."),
 * `resultado`, `usuario` (uid: lo que hizo y lo que le hicieron), `desde` y
 * `hasta` (ISO 8601) y `antes` (id, para la página siguiente). Exige `auditoria.ver`.
 */
export const GET = rutaProtegida(
  { nombre: "admin.auditoria.ver", cuerpo: null },
  async ({ req, uid, ip }) => {
    const filtros = filtrosAuditoriaSchema.safeParse(parametros(req));
    if (!filtros.success) {
      return entradaInvalida(uid, "admin.auditoria.ver", ip, filtros.error.issues.map((i) => i.path.join(".")));
    }
    return responder(await auditoria(filtros.data, ip));
  }
);
