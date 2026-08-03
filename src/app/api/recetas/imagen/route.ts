import { GoogleGenAI, Modality } from "@google/genai";
import { uploadRecetaImagen } from "@/lib/db/recetas";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { titulo, descripcion, uid } = await req.json();

  if (!titulo) {
    return Response.json({ error: "Título requerido" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "API key no configurada" }, { status: 500 });
  }

  try {
    console.log("[imagen] Iniciando generación para:", titulo);
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Professional food photography of "${titulo}". ${
      descripcion ?? "Healthy cardiovascular dish, Mediterranean style"
    }. Shot from above, natural lighting, rustic wooden table, vibrant colors, appetizing, high resolution.`;

    console.log("[imagen] Llamando al modelo de imagen...");
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-image-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });
    console.log("[imagen] Respuesta recibida");

    // Buscar la parte de imagen en la respuesta
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data);

    if (!imagePart?.inlineData?.data) {
      console.error("[imagen] No se encontró imagen en la respuesta:", JSON.stringify(response));
      return Response.json({ error: "No se pudo generar la imagen", detalle: "Sin datos de imagen en respuesta" }, { status: 500 });
    }

    const { data: imageBytes, mimeType = "image/png" } = imagePart.inlineData;
    console.log("[imagen] Imagen OK, mimeType:", mimeType, "tamaño:", imageBytes.length);

    const base64DataUrl = `data:${mimeType};base64,${imageBytes}`;

    // Guardar en el volumen de medios si hay uid
    if (uid) {
      console.log("[imagen] Guardando imagen en disco, uid:", uid);
      const publicUrl = await uploadRecetaImagen(uid, base64DataUrl);
      console.log("[imagen] URL pública:", publicUrl);
      if (publicUrl) {
        return Response.json({ imagen: publicUrl });
      }
      console.warn("[imagen] Guardado en disco falló, usando fallback base64");
    }

    // Fallback: devolver base64 si no hay uid o falló el upload
    return Response.json({ imagen: base64DataUrl });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[imagen] Error:", err);
    return Response.json({ error: "Error al generar imagen", detalle: mensaje, stack }, { status: 500 });
  }
}
