import { GoogleGenAI, Modality } from "@google/genai";
import { guardarImagenReceta } from "@/lib/media";
import { auditar } from "@/lib/seguridad/auditoria";
import { json, rutaProtegida } from "@/lib/seguridad/ruta";
import { limite } from "@/lib/seguridad/tasa";
import { cuerpoImagenSchema } from "@/lib/seguridad/validacion";

export const runtime = "nodejs";

/**
 * Genera la foto de una receta con Gemini y la guarda en el volumen de medios.
 *
 * Es lo más caro de la app: límite propio, más bajo que el del texto. A Gemini
 * solo va el título de la receta, ningún dato de salud.
 *
 * Antes, ante un error se devolvían el mensaje y el stack completos al
 * cliente, y si no había uid se devolvía la imagen en base64 para que el
 * browser la subiera después. Ahora la guarda siempre el servidor.
 */
export const POST = rutaProtegida(
  {
    nombre:  "ia.imagen",
    cuerpo:  cuerpoImagenSchema,
    limites: (uid, ip) => [limite("imagen", uid), limite("imagenIp", ip)],
  },
  async ({ uid, ip, cuerpo }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[imagen] falta GEMINI_API_KEY");
      return json({ error: "no_disponible" }, 503);
    }

    await auditar({ uid, accion: "ia.imagen", resultado: "ok", ip, detalle: { proveedor: "google" } });

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Professional food photography of "${cuerpo.titulo}". ${
      cuerpo.descripcion || "Healthy cardiovascular dish, Mediterranean style"
    }. Shot from above, natural lighting, rustic wooden table, vibrant colors, appetizing, high resolution.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-image-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const datos = parts.find((p) => p.inlineData?.data)?.inlineData?.data;
    if (!datos) {
      console.error("[imagen] la respuesta no trajo imagen");
      return json({ error: "sin_imagen" }, 502);
    }

    const url = await guardarImagenReceta(uid, Buffer.from(datos, "base64"));
    if (!url) {
      console.error("[imagen] los bytes recibidos no son una imagen válida");
      return json({ error: "sin_imagen" }, 502);
    }

    return json({ imagen: url });
  }
);
