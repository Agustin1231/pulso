import { borrarArchivosExamen, borrarImagenesDe } from "@/lib/media";
import { conUsuario, mensajeError } from "@/lib/db/pool";
import { archivosDeExamenes } from "@/lib/db/examenes";
import { eliminarDatosDeLaSesion } from "@/lib/sesion";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";

export const runtime = "nodejs";

/**
 * Derecho de supresión (Ley 1581 de 2012, art. 8): borra todos los datos del
 * usuario de la sesión, sus imágenes, sus exámenes, la sesión y la cookie. No
 * tiene vuelta atrás: el usuario es anónimo y no hay copia a la que volver.
 *
 * Queda un registro en la auditoría con el uid (aleatorio, sin datos
 * personales) para poder demostrar que el borrado se pidió y se hizo.
 */
export const DELETE = rutaProtegida(
  {
    nombre: "datos.eliminar",
    // El derecho de supresión no depende de tener cuenta.
    sinCuenta: true,
    cuerpo: null,
    limites: (uid, ip) => [limite("supresion", uid), limite("supresion", ip)],
  },
  async ({ uid, ip }) => {
    // Los archivos de los exámenes (integrador, punto 15) no dependen del uid:
    // se anotan ANTES de borrar las filas, porque después ya no se sabe cuáles
    // eran. Si se sube uno justo en el medio, queda huérfano y lo barre la
    // purga (scripts/purgar-inactivos.mjs).
    const examenes = await conUsuario(uid, (db) => archivosDeExamenes(db, uid));

    const borrado = await eliminarDatosDeLaSesion();
    if (!borrado) return json({ error: "sesion_requerida" }, 401);

    try {
      await borrarImagenesDe(borrado);
    } catch (err) {
      // Los datos de la base ya no están; las imágenes huérfanas no son
      // accesibles (la ruta de imágenes exige la sesión del dueño).
      console.error("[api] mis-datos: no se pudieron borrar las imágenes:", mensajeError(err));
    }
    try {
      await borrarArchivosExamen(examenes);
    } catch (err) {
      // Ídem: sin fila, un examen cifrado no se puede bajar; la purga lo barre.
      console.error("[api] mis-datos: no se pudieron borrar los exámenes:", mensajeError(err));
    }

    await auditar({ uid, accion: "datos.eliminar", resultado: "ok", ip, detalle: { examenes: examenes.length } });
    return json({ ok: true });
  }
);
