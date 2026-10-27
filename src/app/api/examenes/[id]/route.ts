import { conUsuario, mensajeError } from "@/lib/db/pool";
import { borrarExamen, buscarExamen } from "@/lib/db/examenes";
import { idExamenSchema } from "@/lib/examenes/esquemas";
import { tipoPorFirma } from "@/lib/examenes/firma";
import { contentDisposition, nombreParaDescarga } from "@/lib/examenes/nombres";
import { mimeDe } from "@/lib/examenes/reglas";
import { borrarArchivosExamen, leerArchivoExamen } from "@/lib/media";
import { auditar, auditarEn } from "@/lib/seguridad/auditoria";
import { descifrar } from "@/lib/seguridad/cifrado";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";

export const runtime = "nodejs";

/**
 * Un examen (integrador, punto 15).
 *
 *   GET    /api/examenes/{id}              lo muestra el navegador (inline)
 *   GET    /api/examenes/{id}?descargar=1  lo baja (attachment)
 *   DELETE /api/examenes/{id}              lo borra (fila y archivo)
 *
 * Solo el dueño: la fila se busca con RLS (`app.uid`) y además por uid. Un
 * examen ajeno responde 404, igual que uno que no existe, para no confirmar
 * que el id es de alguien; el intento queda en la auditoría como 'denegado'.
 *
 * La respuesta lleva el Content-Type del tipo DETECTADO al subir (y se vuelve
 * a comprobar la firma al descifrar), `nosniff` para que el navegador no
 * adivine otro, el nombre saneado en Content-Disposition y `no-store`: un
 * examen médico no se guarda en cachés intermedias ni en la del navegador.
 */

type Ctx = { params: Promise<{ id: string }> };

const NO_ENCONTRADO = () => json({ error: "no_encontrado" }, 404);

/**
 * CSP del archivo servido: no carga nada ni se deja enmarcar. A las imágenes
 * además se les pone `sandbox` (un documento de imagen no necesita scripts);
 * al PDF no, porque el visor de PDF de Chrome no abre en un documento con
 * sandbox. El PDF ya pasó la revisión de contenido activo al subirse.
 */
function csp(tipo: "pdf" | "jpg" | "png"): string {
  const base = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'";
  return tipo === "pdf" ? base : `${base}; sandbox`;
}

export const GET = rutaProtegida<undefined, Ctx>(
  { nombre: "examen.descargar", cuerpo: null },
  async ({ req, uid, ip }, ctx) => {
    const { id } = await ctx.params;
    const negar = async (motivo: string, recursoId: string | null = null) => {
      await auditar({ uid, accion: "examen.descargar", recurso: "examenes", recursoId, resultado: "denegado", ip, detalle: { motivo } });
      return NO_ENCONTRADO();
    };

    const valido = idExamenSchema.safeParse(id);
    if (!valido.success) return negar("id_invalido");
    const fila = await conUsuario(uid, (db) => buscarExamen(db, uid, valido.data));
    if (!fila) return negar("no_encontrado", valido.data); // ajeno o inexistente: lo mismo

    // Tira si el archivo fue alterado (GCM): rutaProtegida responde 500 y lo audita.
    const bytes = await leerArchivoExamen(fila.archivo);
    if (!bytes) {
      console.error(`[api] examen.descargar: falta el archivo del examen ${fila.id}`);
      await auditar({ uid, accion: "examen.descargar", recurso: "examenes", recursoId: fila.id, resultado: "error", ip, detalle: { motivo: "archivo_faltante" } });
      return NO_ENCONTRADO();
    }
    // Defensa en profundidad: lo descifrado sigue siendo del tipo que se guardó.
    if (tipoPorFirma(bytes) !== fila.tipo) throw new Error(`El examen ${fila.id} no coincide con su tipo`);

    let nombre = "examen";
    try {
      nombre = descifrar(fila.nombre_cifrado, "examenes.nombre");
    } catch (err) {
      console.error("[api] examen.descargar: no se pudo descifrar el nombre:", mensajeError(err));
    }

    const adjunto = new URL(req.url).searchParams.get("descargar") === "1";
    await auditar({ uid, accion: "examen.descargar", recurso: "examenes", recursoId: fila.id, resultado: "ok", ip, detalle: { adjunto } });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type":            mimeDe(fila.tipo),
        "Content-Length":          String(bytes.length),
        "Content-Disposition":     contentDisposition(nombreParaDescarga(nombre, fila.tipo), adjunto),
        "X-Content-Type-Options":  "nosniff",
        // next.config.ts pone `no-store` a toda la API y su header gana: el
        // resultado es igual o más estricto. Este queda por si eso cambia.
        "Cache-Control":           "private, no-store",
        "Content-Security-Policy": csp(fila.tipo),
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  }
);

export const DELETE = rutaProtegida<undefined, Ctx>(
  {
    nombre: "examen.eliminar",
    cuerpo: null,
    limites: (uid, ip) => [limite("examen", uid), limite("examenIp", ip)],
  },
  async ({ uid, ip }, ctx) => {
    const { id } = await ctx.params;
    const valido = idExamenSchema.safeParse(id);
    if (!valido.success) {
      await auditar({ uid, accion: "examen.eliminar", recurso: "examenes", resultado: "denegado", ip, detalle: { motivo: "id_invalido" } });
      return NO_ENCONTRADO();
    }

    const archivo = await conUsuario(uid, async (db) => {
      const a = await borrarExamen(db, uid, valido.data);
      await auditarEn(db, {
        uid, accion: "examen.eliminar", recurso: "examenes", recursoId: valido.data, ip,
        resultado: a ? "ok" : "denegado",
        detalle: a ? undefined : { motivo: "no_encontrado" },
      });
      return a;
    });
    if (!archivo) return NO_ENCONTRADO();

    // Después del commit: si el borrado en la base fallara, el archivo sigue ahí.
    try {
      await borrarArchivosExamen([archivo]);
    } catch (err) {
      // Sin fila, el archivo cifrado ya no es accesible; la purga lo barre.
      console.error("[api] examen.eliminar: no se pudo borrar el archivo:", mensajeError(err));
    }
    return json({ ok: true });
  }
);
