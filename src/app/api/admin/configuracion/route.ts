import type { z } from "zod";
import { configSchema } from "@/lib/admin/esquemas";
import { configuracion, fijarConfig, responder } from "@/lib/admin/servidor";
import { rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";

export const runtime = "nodejs";

/**
 * Tiempos de inactividad (puntos 10 y 11): `token_inactividad_minutos` y
 * `sesion_inactividad_minutos`, con sus límites. Exige `configuracion.editar`.
 */
export const GET = rutaProtegida(
  { nombre: "admin.configuracion.ver", cuerpo: null },
  async ({ ip }) => responder(await configuracion(ip))
);

/**
 * Cambia un valor (contrato C1: `pulso_admin_fijar_config`). La base lo
 * valida contra su mínimo y su máximo y audita el antes y el después. Quien lo
 * aplica lo lee en cada petición, así que rige enseguida.
 */
export const PUT = rutaProtegida<z.infer<typeof configSchema>>(
  {
    nombre: "admin.configuracion.fijar",
    cuerpo: configSchema,
    limites: (uid, ip) => [limite("escritura", uid), limite("escrituraIp", ip)],
  },
  async ({ ip, cuerpo }) => responder(await fijarConfig(cuerpo.clave, cuerpo.valor, ip))
);
