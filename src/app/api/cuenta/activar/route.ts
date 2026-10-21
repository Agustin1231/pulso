import { activarCuenta } from "@/lib/cuenta";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaPublica } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { activarSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

/**
 * Activa la cuenta con el token del correo. Lo llama la página
 * /acceso/activar, que lo lee de la URL: la activación no pasa por un GET para
 * que un enlace pedido por otro (una vista previa, un proxy) no tenga efectos.
 */
export const POST = rutaPublica(
  {
    nombre: "cuenta.activar",
    cuerpo: activarSchema,
    limites: (ip) => [limite("enlaceIp", ip)],
  },
  async ({ ip, cuerpo }) => {
    if (!(await activarCuenta(cuerpo.token))) {
      await auditar({ accion: "cuenta.activar", resultado: "denegado", ip, detalle: { motivo: "enlace_invalido" } });
      return json({ error: "enlace_invalido" }, 400);
    }
    await auditar({ accion: "cuenta.activar", resultado: "ok", ip });
    return json({ ok: true });
  }
);
