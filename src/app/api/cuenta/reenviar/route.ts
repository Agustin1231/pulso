import { reenviarActivacion } from "@/lib/cuenta";
import { correoActivacion, enviarDespues, urlDeLaApp } from "@/lib/correo";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";

export const runtime = "nodejs";

/** Manda otro enlace de activación a la cuenta (sin activar) de la sesión. El anterior deja de servir. */
export const POST = rutaProtegida(
  {
    nombre: "cuenta.reenviar",
    cuerpo: null,
    limites: (uid, ip) => [limite("reenvio", uid), limite("registroIp", ip)],
  },
  async ({ uid, ip }) => {
    const r = await reenviarActivacion();
    if (!r) return json({ error: "sin_cuenta_pendiente" }, 409);
    enviarDespues(r.email, correoActivacion(urlDeLaApp(`/acceso/activar?token=${r.token}`)), "reenvio");
    await auditar({ uid, accion: "cuenta.reenviar", resultado: "ok", ip });
    return json({ ok: true });
  }
);
