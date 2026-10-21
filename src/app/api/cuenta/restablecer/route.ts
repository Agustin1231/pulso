import { restablecerContrasena } from "@/lib/cuenta";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaPublica } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { restablecerSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

/** Contraseña nueva con el token del correo. Cierra todas las sesiones de la cuenta. */
export const POST = rutaPublica(
  {
    nombre: "cuenta.restablecer",
    cuerpo: restablecerSchema,
    limites: (ip) => [limite("enlaceIp", ip)],
  },
  async ({ ip, cuerpo }) => {
    if (!(await restablecerContrasena(cuerpo.token, cuerpo.password))) {
      await auditar({ accion: "cuenta.restablecer", resultado: "denegado", ip, detalle: { motivo: "enlace_invalido" } });
      return json({ error: "enlace_invalido" }, 400);
    }
    await auditar({ accion: "cuenta.restablecer", resultado: "ok", ip });
    return json({ ok: true });
  }
);
