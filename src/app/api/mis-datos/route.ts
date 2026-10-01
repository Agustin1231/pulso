import { borrarImagenesDe } from "@/lib/media";
import { mensajeError } from "@/lib/db/pool";
import { eliminarDatosDeLaSesion } from "@/lib/sesion";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";

export const runtime = "nodejs";

/**
 * Derecho de supresión (Ley 1581 de 2012, art. 8): borra todos los datos del
 * usuario de la sesión, sus imágenes, la sesión y la cookie. No tiene vuelta
 * atrás: el usuario es anónimo y no hay copia a la que volver.
 *
 * Queda un registro en la auditoría con el uid (aleatorio, sin datos
 * personales) para poder demostrar que el borrado se pidió y se hizo.
 */
export const DELETE = rutaProtegida(
  {
    nombre: "datos.eliminar",
    cuerpo: null,
    limites: (uid, ip) => [limite("supresion", uid), limite("supresion", ip)],
  },
  async ({ uid, ip }) => {
    const borrado = await eliminarDatosDeLaSesion();
    if (!borrado) return json({ error: "sesion_requerida" }, 401);

    try {
      await borrarImagenesDe(borrado);
    } catch (err) {
      // Los datos de la base ya no están; las imágenes huérfanas no son
      // accesibles (la ruta de imágenes exige la sesión del dueño).
      console.error("[api] mis-datos: no se pudieron borrar las imágenes:", mensajeError(err));
    }

    await auditar({ uid, accion: "datos.eliminar", resultado: "ok", ip });
    return json({ ok: true });
  }
);
