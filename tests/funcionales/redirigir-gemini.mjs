// Precarga SOLO para el servidor de pruebas funcionales
// (NODE_OPTIONS=--import=file://…/redirigir-gemini.mjs en funcional.env).
//
// La ruta /api/recetas/imagen crea `new GoogleGenAI({ apiKey })` sin opción de
// URL base, y @google/genai 0.7 no lee ninguna variable de entorno para
// cambiarla. Para probar el flujo de la foto sin una clave real, esta
// precarga envuelve `fetch` y manda las llamadas a la API de Gemini al doble
// de prueba (mock-anthropic.mjs). No toca el código de la app.
//
// Solo se activa si GEMINI_MOCK_URL apunta a la propia máquina: aunque se
// cargara por error en otro entorno, nunca desvía tráfico a un tercero.

const destino = process.env.GEMINI_MOCK_URL?.replace(/\/+$/, "");
const GEMINI = "https://generativelanguage.googleapis.com/";

if (destino && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(destino)) {
  const original = globalThis.fetch;
  globalThis.fetch = function fetchConGeminiFalso(input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    if (typeof url === "string" && url.startsWith(GEMINI)) {
      const u = new URL(url);
      const nueva = `${destino}${u.pathname}${u.search}`;
      return original(input instanceof Request ? new Request(nueva, input) : nueva, init);
    }
    return original(input, init);
  };
}
