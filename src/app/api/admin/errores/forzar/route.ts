import type { z } from "zod";
import { forzarErrorSchema } from "@/lib/admin/esquemas";
import { comprobar, responder } from "@/lib/admin/servidor";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";

export const runtime = "nodejs";

/**
 * "Forzar un error de prueba" (punto 17): lanza una excepción a propósito
 * para comprobar que el registro de errores la captura. Exige `errores.ver`
 * (si no, cualquiera podría llenar el registro).
 *
 *   - `manejado`: se lanza DENTRO de rutaProtegida; su catch genérico responde
 *     500 `error_interno` (sin detalle) y llama a `registrarError`.
 *   - `no_manejado`: se lanza AFUERA, en el handler que exporta esta ruta; nadie
 *     lo atrapa y Next lo pasa a `onRequestError` (src/instrumentation.ts).
 */
class ErrorDePrueba extends Error {
  constructor(tipo: string) {
    super(`Error de prueba forzado desde el panel de administración (${tipo})`);
    this.name = "ErrorDePrueba";
  }
}

/** Peticiones ya autorizadas que tienen que fallar afuera de rutaProtegida. */
const noManejadas = new WeakSet<Request>();

const autorizada = rutaProtegida<z.infer<typeof forzarErrorSchema>>(
  {
    nombre: "admin.errores.forzar",
    cuerpo: forzarErrorSchema,
    limites: (uid, ip) => [limite("escritura", uid), limite("escrituraIp", ip)],
  },
  async ({ req, uid, ip, cuerpo }) => {
    const permiso = await comprobar("errores.ver", "admin.errores.forzar", ip);
    if (permiso.error) return responder(permiso);

    if (cuerpo.tipo === "manejado") throw new ErrorDePrueba("manejado por rutaProtegida");

    await auditar({ uid, accion: "admin.errores.forzar", resultado: "error", ip, detalle: { tipo: "no_manejado" } });
    noManejadas.add(req);
    return json({ ok: true });
  }
);

export async function POST(req: Request, extra: unknown): Promise<Response> {
  const respuesta = await autorizada(req, extra);
  if (noManejadas.has(req)) throw new ErrorDePrueba("no manejado, lo registra onRequestError");
  return respuesta;
}
