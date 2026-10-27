import { confirmarCambioCorreo } from "@/lib/cuenta";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaPublica } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { activarSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

/**
 * Confirma el cambio de correo con el token que llegó al correo nuevo
 * (integrador, punto 20). Lo llama /acceso/confirmar-correo cuando el usuario
 * aprieta "Confirmar": como la activación, no pasa por un GET, para que una
 * vista previa del enlace no cambie nada. No pide sesión: el enlace se puede
 * abrir en otro equipo, y es la prueba de que el correo es de quien lo pidió.
 */
export const POST = rutaPublica(
  {
    nombre: "cuenta.confirmar_correo",
    cuerpo: activarSchema,
    limites: (ip) => [limite("enlaceIp", ip)],
  },
  async ({ ip, cuerpo }) => {
    const r = await confirmarCambioCorreo(cuerpo.token);
    if (r.resultado !== "ok") {
      await auditar({ uid: r.uid, accion: "cuenta.confirmar_correo", resultado: "denegado", ip, detalle: { motivo: r.resultado } });
      // Quien tiene el enlace tiene el correo nuevo: decirle que ya es de otra cuenta no revela nada ajeno.
      return r.resultado === "en_uso" ? json({ error: "correo_en_uso" }, 409) : json({ error: "enlace_invalido" }, 400);
    }
    await auditar({ uid: r.uid, accion: "cuenta.confirmar_correo", resultado: "ok", ip });
    return json({ ok: true });
  }
);
