import type { z } from "zod";
import { problemasContrasena } from "@/lib/admin/contrasena";
import { contrasenaAdminSchema, uidSchema } from "@/lib/admin/esquemas";
import { avisarCambioDeContrasena, cambiarContrasena, comprobar, entradaInvalida, responder } from "@/lib/admin/servidor";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";

export const runtime = "nodejs";

const ACCION = "admin.usuario.contrasena";

/**
 * Un administrador le cambia la contraseña a otro usuario (punto 7). Tres
 * capas: el formulario (en vivo), zod acá (la misma regla del
 * registro) y la base (`pulso_contrasena_valida`). Si no cumple, responde 400
 * `contrasena_invalida` con `reglas`: qué regla falla, en español.
 *
 * Si se cambia, la base cierra todas las sesiones del usuario (motivo 'admin')
 * y le avisamos por correo. La contraseña no se registra en ningún lado.
 */
export const POST = rutaProtegida<z.infer<typeof contrasenaAdminSchema>, { params: Promise<{ uid: string }> }>(
  {
    nombre: ACCION,
    cuerpo: contrasenaAdminSchema,
    limites: (uid, ip) => [limite("escritura", uid), limite("escrituraIp", ip)],
  },
  async ({ uid, ip, cuerpo }, { params }) => {
    const objetivo = uidSchema.safeParse((await params).uid);
    if (!objetivo.success) return entradaInvalida(uid, ACCION, ip, ["uid"]);

    const reglas = problemasContrasena(cuerpo.password);
    if (reglas.length) {
      // Primero el permiso: a quien no lo tiene se le responde 403, no las reglas.
      const permiso = await comprobar("usuarios.editar", ACCION, ip);
      if (permiso.error) return responder(permiso);
      await auditar({
        uid, accion: ACCION, resultado: "denegado", ip, recurso: "usuario", recursoId: objetivo.data,
        detalle: { motivo: "contrasena_invalida", reglas },
      });
      return json({ error: "contrasena_invalida", reglas }, 400);
    }

    const r = await cambiarContrasena(objetivo.data, cuerpo.password, ip);
    if (r.error === "contrasena_invalida") {
      // zod la aceptó y la base no: manda la regla de la base (ya quedó auditado).
      return json({ error: "contrasena_invalida", reglas: ["No cumple las reglas de seguridad de la base de datos."] }, 400);
    }
    if (!r.error) {
      const correo = Object.values(r.correos ?? {})[0];
      if (correo) avisarCambioDeContrasena(correo);
    }
    // El correo era para el aviso: no hace falta devolverlo.
    return responder({ ...r, correos: undefined });
  }
);
