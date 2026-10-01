import path from "node:path";
import { readFile } from "node:fs/promises";
import { carpetasPermitidas, MIME_POR_EXT, RECETAS_SUBDIR, rutaDentroDeMedia } from "@/lib/media";
import { auditar } from "@/lib/seguridad/auditoria";
import { rutaProtegida } from "@/lib/seguridad/ruta";

export const runtime = "nodejs";

const NO_ENCONTRADO = () => new Response("No encontrado", { status: 404 });

/**
 * Sirve las imágenes de recetas: `/api/img/recetas/{carpeta}/{archivo}`.
 *
 * Exige la sesión del dueño: la carpeta tiene que ser la del usuario (la
 * vieja con el uid, o la nueva con el hash del uid). Ante una carpeta ajena
 * responde 404, no 403, para no confirmar que el archivo existe.
 *
 * `private`: antes el Cache-Control era `public`, así que un proxy o CDN
 * intermedio podía guardar y servir la foto a cualquiera.
 */
export const GET = rutaProtegida<undefined, { params: Promise<{ path: string[] }> }>(
  { nombre: "imagen.ver", cuerpo: null },
  async ({ uid, ip }, ctx) => {
    const { path: segmentos = [] } = await ctx.params;
    const [subdir, carpeta, archivo, ...resto] = segmentos;

    if (subdir !== RECETAS_SUBDIR || !carpeta || !archivo || resto.length) return NO_ENCONTRADO();
    if (!carpetasPermitidas(uid).includes(carpeta)) {
      await auditar({ uid, accion: "imagen.ver", resultado: "denegado", ip, detalle: { motivo: "carpeta_ajena" } });
      return NO_ENCONTRADO();
    }

    const destino = rutaDentroDeMedia([subdir, carpeta, archivo]);
    const mime = destino ? MIME_POR_EXT[path.extname(destino).toLowerCase()] : undefined;
    if (!destino || !mime) return NO_ENCONTRADO();

    try {
      const bytes = await readFile(destino);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": mime,
          // El nombre es único, así que el contenido de una URL nunca cambia.
          "Cache-Control": "private, max-age=31536000, immutable",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      });
    } catch {
      return NO_ENCONTRADO();
    }
  }
);
