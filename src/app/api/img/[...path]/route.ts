import path from "node:path";
import { readFile } from "node:fs/promises";
import { MIME_POR_EXT, rutaDentroDeMedia } from "@/lib/media";

export const runtime = "nodejs";

/**
 * Sirve los archivos de MEDIA_DIR. Reemplaza las URLs públicas que antes
 * generaba Supabase Storage: `/api/img/recetas/{uid}/{archivo}`.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const { path: segmentos } = await ctx.params;

  const destino = rutaDentroDeMedia(segmentos ?? []);
  if (!destino) {
    return new Response("Ruta inválida", { status: 400 });
  }

  const mime = MIME_POR_EXT[path.extname(destino).toLowerCase()];
  if (!mime) {
    return new Response("Tipo de archivo no soportado", { status: 415 });
  }

  try {
    const bytes = await readFile(destino);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mime,
        // El nombre del archivo incluye un timestamp, así que el contenido
        // nunca cambia para una misma URL.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
}
