import { cuentaDeSesion } from "@/lib/cuenta";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";

export const runtime = "nodejs";

/** Cuenta de la sesión: `{ cuenta: { email, verificada } }`, o `{ cuenta: null }` si es anónima. */
export const GET = rutaProtegida(
  { nombre: "cuenta.ver", cuerpo: null, sinCuenta: true },
  async () => json({ cuenta: await cuentaDeSesion() })
);
