import { correoDeRecuperacion, restablecerContrasena } from "@/lib/cuenta";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaPublica } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { fallasDeContrasena, restablecerSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

/**
 * Contraseña nueva con el token del correo (integrador, punto 3). Aplica la
 * regla de contraseñas (400 `contrasena_invalida` con lo que falla), cierra
 * todas las sesiones de la cuenta con el motivo 'contrasena' y levanta el
 * bloqueo por intentos fallidos: es la salida que se ofrece a una cuenta
 * bloqueada.
 */
export const POST = rutaPublica(
  {
    nombre: "cuenta.restablecer",
    cuerpo: restablecerSchema,
    limites: (ip) => [limite("enlaceIp", ip)],
  },
  async ({ ip, cuerpo }) => {
    const invalido = async () => {
      await auditar({ accion: "cuenta.restablecer", resultado: "denegado", ip, detalle: { motivo: "enlace_invalido" } });
      return json({ error: "enlace_invalido" }, 400);
    };

    // El correo de la cuenta hace falta para la regla "que no contenga tu correo".
    const email = await correoDeRecuperacion(cuerpo.token);
    if (!email) return invalido();

    const reglas = fallasDeContrasena(cuerpo.password, email);
    if (reglas.length > 0) {
      await auditar({ accion: "cuenta.restablecer", resultado: "denegado", ip, detalle: { motivo: "contrasena_invalida", reglas: reglas.map((r) => r.regla) } });
      return json({ error: "contrasena_invalida", reglas: reglas.map((r) => r.texto) }, 400);
    }

    const r = await restablecerContrasena(cuerpo.token, cuerpo.password, email);
    if (r.resultado === "contrasena_invalida") {
      await auditar({ accion: "cuenta.restablecer", resultado: "denegado", ip, detalle: { motivo: "contrasena_invalida", capa: "base" } });
      return json({ error: "contrasena_invalida", reglas: [] }, 400);
    }
    if (r.resultado !== "ok") return invalido();

    await auditar({ accion: "cuenta.restablecer", resultado: "ok", ip, detalle: { sesiones_cerradas: r.sesionesCerradas } });
    return json({ ok: true });
  }
);
