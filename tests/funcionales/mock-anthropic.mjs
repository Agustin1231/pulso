// Doble de prueba de los proveedores de IA para las pruebas funcionales.
//
// Sin API keys reales no se pueden probar de punta a punta las rutas de IA
// (`/api/recetas`, `/api/rutinas`, `/api/tips`, …): sin modelo responden con
// la parte de error `3:` del stream. Este servidor habla el MISMO protocolo
// que la Messages API de Anthropic (SSE con `message_start`,
// `content_block_delta`, …) que consume `@ai-sdk/anthropic`, y el de
// `generateContent` de Gemini para las fotos de recetas. El servidor
// funcional se apunta acá con las variables de
// `~/.local/share/pulso-toolchain/srv/funcional.env`:
//
//   CLAUDE_AUTH_MODE=oauth  CLAUDE_PROXY_URL=http://127.0.0.1:3190  CLAUDE_PROXY_TOKEN=<token>
//   GEMINI_API_KEY=<cualquiera>  GEMINI_MOCK_URL=http://127.0.0.1:3190
//   NODE_OPTIONS=--import=file://…/tests/funcionales/redirigir-gemini.mjs
//
// Uso:  MOCK_IA_TOKEN=<token> node tests/funcionales/mock-anthropic.mjs [--puerto 3190]
//
// Las respuestas son deterministas y respetan el formato EXACTO que pide el
// prompt de cada ruta: así la app las puede parsear (ejercicios de la rutina,
// ingredientes de la receta, secciones del mercado) igual que las del modelo real.
//
// Control para las pruebas (solo escucha en 127.0.0.1):
//   GET    /__salud                       { ok: true }
//   GET    /__peticiones?n=10             últimas peticiones recibidas (sin cabeceras)
//   DELETE /__peticiones                  vacía el registro
//   POST   /__fallas {tipo, modo, veces}  inyecta una falla en las próximas `veces`
//          peticiones de ese tipo ("receta", "receta_chat", "rutina", "tips",
//          "score", "analisis", "mercado", "imagen" o "*"). Modos:
//            http500       el "proxy" responde 500 (el servidor no tiene a dónde
//                          reintentar y el SDK emite la parte `3:`)
//            error_stream  manda un poco de texto y corta con `event: error`
//            vacio         un mensaje sin texto
//            sin_imagen    (Gemini) responde solo texto, sin la imagen
//            imagen_invalida (Gemini) bytes que no son una imagen
//   DELETE /__fallas                      quita todas las fallas pendientes

import { createServer } from "node:http";
import { deflateSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const DEMORA_MS = Number(process.env.MOCK_IA_DEMORA_MS ?? 8);
const MAX_REGISTRO = 100;

// ─── Contenido ────────────────────────────────────────────────────────────────

/** Qué ruta del backend hizo la petición, por su prompt de sistema. */
export function tipoDePeticion(system, mensajes) {
  const s = typeof system === "string" ? system : JSON.stringify(system ?? "");
  if (s.includes("quiere hacerte preguntas")) return "receta_chat";
  if (s.includes("crear recetas saludables")) return "receta";
  if (s.includes("entrenador personal cardiovascular")) return "rutina";
  if (s.includes("3 tips personalizados")) return "tips";
  if (s.includes("analista de salud cardiovascular")) return "score";
  if (s.includes("listas de compra para el supermercado")) return "mercado";
  if (s.includes("asistente de salud cardiovascular")) return "analisis";
  return mensajes?.length ? "otro" : "vacio";
}

const textoDe = (m) =>
  typeof m?.content === "string"
    ? m.content
    : (m?.content ?? []).filter((p) => p.type === "text").map((p) => p.text).join("\n");

const ultimoUsuario = (mensajes) => textoDe([...(mensajes ?? [])].reverse().find((m) => m.role === "user"));

/** Lo que el servidor envolvió en <datos_usuario> (el texto que escribió el usuario). */
const datosUsuario = (t) => t.match(/<datos_usuario>([\s\S]*?)<\/datos_usuario>/)?.[1]?.trim() ?? "";

const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function receta(ingredientesCrudos, sufijo = "") {
  const ingredientes = ingredientesCrudos
    .split(/[,\n]+|\sy\s/)
    .map((i) => i.trim())
    .filter(Boolean)
    .slice(0, 6);
  if (ingredientes.length === 0) ingredientes.push("verduras de estación");
  const principal = ingredientes[0].toLowerCase();
  return [
    `## Bowl cardioprotector de ${principal}${sufijo}`,
    "",
    "**Porciones:** 2 | **Tiempo:** 25 minutos",
    "",
    "### Ingredientes",
    ...ingredientes.map((i, n) => `- ${capital(i)} (${150 + n * 50} g)`),
    "- Aceite de oliva extra virgen (1 cucharada)",
    "- Limón (1 unidad)",
    "",
    "### Preparación",
    `1. Lavá y cortá ${principal} en cubos medianos.`,
    "2. Cociná al vapor 10 minutos para conservar el potasio.",
    "3. Serví con el aceite de oliva y unas gotas de limón.",
    "",
    "### Beneficios cardiovasculares",
    "Aporta fibra y potasio, que ayudan a mantener una presión arterial saludable. El aceite de oliva suma grasas monoinsaturadas en lugar de grasas saturadas.",
  ].join("\n");
}

function rutina(pedido) {
  const lugar = pedido.match(/Lugar de entrenamiento: (.+)/)?.[1]?.trim() ?? "En casa";
  const tiempo = Number(pedido.match(/Tiempo disponible: (\d+)/)?.[1] ?? 30);
  const nivel = pedido.match(/Nivel de actividad: ([^(\n]+)/)?.[1]?.trim() ?? "Sedentario";
  const sueno = pedido.match(/Sueño de anoche: ([\d.]+)h/)?.[1];
  const semana = pedido.match(/semana (\d+) del plan/)?.[1] ?? "1";
  const cal = Math.max(3, Math.round(tiempo * 0.2));
  const calma = Math.max(2, Math.round(tiempo * 0.15));
  const principal = tiempo - cal - calma;
  return [
    `## Corazón en Marcha: Semana ${semana}`,
    "",
    `**Nivel:** ${nivel} | **Duración:** ${tiempo} min | **Lugar:** ${lugar}`,
    "",
    `### Calentamiento (${cal} min)`,
    "1. **Marcha en el lugar** | 2 minutos | Descanso: 5 seg",
    "   Eleva las rodillas suavemente y balancea los brazos.",
    "2. **Rotación de hombros** | 1 minuto | Descanso: 0 seg",
    "   Círculos amplios hacia adelante y hacia atrás.",
    "",
    `### Parte principal (${principal} min)`,
    "1. **Sentadillas a la silla** | 3 series × 10 repeticiones | Descanso: 5 seg",
    "   Baja controlado hasta rozar la silla, sin dejarte caer.",
    "2. **Flexiones en la pared** | 3 series × 12 repeticiones | Descanso: 5 seg",
    "   Mantén el cuerpo alineado de la cabeza a los talones.",
    "3. **Paso lateral con brazos** | 2 series × 20 pasos | Descanso: 5 seg",
    "   Ritmo constante que eleva suavemente la frecuencia cardíaca.",
    "",
    `### Vuelta a la calma (${calma} min)`,
    "1. **Respiración diafragmática** | 2 minutos | Descanso: 0 seg",
    "   Inhala en 4 tiempos y exhala en 6.",
    "2. **Estiramiento de gemelos** | 30 segundos | Descanso: 0 seg",
    "   Mantén sin rebotes, apoyado en la pared.",
    "",
    "### Beneficios para tu corazón",
    "> El trabajo aeróbico moderado mejora la eficiencia del corazón y ayuda a bajar la frecuencia cardíaca en reposo.",
    "",
    "---",
    `**Consejo de hoy:** ${sueno ? `Dormiste ${sueno}h: hidratate bien y escuchá a tu cuerpo.` : "Hidratate antes y después de entrenar."}`,
  ].join("\n");
}

const TIPS = [
  "### 💧 Empezá el día con agua",
  "Tomá un vaso de agua apenas te levantes. La hidratación ayuda a que el corazón bombee con menos esfuerzo.",
  "",
  "### 🚶 Sumá una caminata corta",
  "Diez minutos de caminata después de comer mejoran la circulación. Hoy es un buen día para empezar.",
  "",
  "### 😴 Cuidá tu descanso",
  "Intentá acostarte a la misma hora esta noche. Un sueño regular ayuda a mantener estable la presión arterial.",
].join("\n");

const SCORE = [
  "### Lo que está bien",
  "> Estás monitoreando tu salud de forma constante, y eso ya es un gran paso.",
  "",
  "### Lo que puede mejorar",
  "- **Sueño:** el informe lo marca como un factor a vigilar. — Acostate 30 minutos antes esta semana.",
  "- **Estrés:** el informe indica que suma riesgo. — Hacé 5 minutos de respiración diafragmática al día.",
  "",
  "### Tu plan esta semana",
  "1. Hoy: caminá 15 minutos después de la cena.",
  "2. Los próximos días: registrá tus métricas cada mañana.",
  "3. Objetivo de la semana: dormir al menos 7 horas cinco noches.",
  "",
  "### Si mantienes el ritmo",
  "> La proyección del informe supone que el patrón reciente se mantiene. Consultá a tu médico ante cualquier síntoma.",
].join("\n");

const ANALISIS = [
  "Tus registros muestran un patrón estable en las métricas que cargaste. El motor calculó la tendencia y el pronóstico con los datos disponibles.",
  "",
  "Si el informe marca confianza baja, es porque todavía hay pocos registros: seguí cargando tus métricas para mejorar la precisión.",
  "",
  "Recomendaciones:",
  "1. Registrá tu frecuencia cardíaca en reposo cada mañana.",
  "2. Sumá 20 minutos de actividad moderada al día.",
  "3. Mantené un horario de sueño regular.",
  "",
  "*Esto es orientación educativa, no un diagnóstico médico.*",
].join("\n");

function mercado(pedido, pregunta) {
  const periodo = /mensual/i.test(pedido) ? "mensual" : "semanal";
  const sinPescado = /pescado|salm[oó]n/i.test(pregunta ?? "");
  return [
    `## Lista del mercado ${periodo}`,
    "",
    "### 🥬 Verduras y Frutas",
    "- Espinaca (2 atados) — aporta potasio y folatos",
    "- Tomate (1 kg) — licopeno antioxidante",
    "- Banana (6 unidades) — potasio para la presión arterial",
    "",
    "### 🥩 Proteínas",
    sinPescado ? "- Lentejas (500 g) — proteína vegetal y fibra" : "- Salmón (400 g) — omega-3",
    "- Pechuga de pollo (500 g) — proteína magra",
    "",
    "### 🌾 Granos y Cereales",
    "- Avena (500 g) — fibra soluble que baja el colesterol",
    "",
    "### 🫒 Aceites, Frutos Secos y Semillas",
    "- Nueces (200 g) — omega-3 vegetal",
    "",
    "---",
    "**Progresión:** Mantiene los básicos e incorpora legumbres para variar las proteínas.",
    "",
    "**Consejo:** Leé las etiquetas y elegí productos con menos de 120 mg de sodio por porción.",
  ].join("\n");
}

function respuestaPara(tipo, mensajes) {
  const ultimo = ultimoUsuario(mensajes);
  switch (tipo) {
    case "receta":
      return receta(datosUsuario(ultimo));
    case "receta_chat": {
      const pregunta = datosUsuario(ultimo);
      if (/no tengo|no me gusta|cambi|sin |reemplaz/i.test(pregunta)) {
        // Como el modelo real: una frase y la receta regenerada en el mismo formato.
        const base = datosUsuario(textoDe(mensajes?.[0])).match(/^## Bowl cardioprotector de (.+?)(?: \(|$)/m)?.[1] ?? "verduras";
        return `¡Claro! Te propongo esta versión adaptada:\n\n${receta(base, " (versión adaptada)")}`;
      }
      return "Podés cocinar las verduras al vapor en lugar de hervirlas: así conservan más potasio y vitaminas.";
    }
    case "rutina":
      return rutina(ultimo);
    case "tips":
      return TIPS;
    case "score":
      return SCORE;
    case "analisis":
      return ANALISIS;
    case "mercado": {
      // Con pregunta, el último turno es solo la pregunta; sin ella, el pedido de la lista.
      const pregunta = datosUsuario(ultimo);
      const pedido = (mensajes ?? []).map(textoDe).join("\n");
      return mercado(pedido, pregunta);
    }
    default:
      return "Respuesta de prueba.";
  }
}

// ─── Imagen (Gemini) ──────────────────────────────────────────────────────────

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function bloque(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

/** PNG real de 256×256: un "plato" verde sobre una mesa de madera. Válido para la firma que exige `lib/media`. */
export function pngDePrueba() {
  const lado = 256;
  const filas = [];
  for (let y = 0; y < lado; y++) {
    const fila = Buffer.alloc(1 + lado * 3);
    for (let x = 0; x < lado; x++) {
      const d = Math.hypot(x - 128, y - 128);
      const [r, g, b] =
        d < 70 ? [76, 175, 80] : d < 100 ? [245, 245, 240] : [150 + ((x + y) % 24), 105, 60];
      fila[1 + x * 3] = r;
      fila[2 + x * 3] = g;
      fila[3 + x * 3] = b;
    }
    filas.push(fila);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque("IHDR", ihdr),
    bloque("IDAT", deflateSync(Buffer.concat(filas))),
    bloque("IEND", Buffer.alloc(0)),
  ]);
}

// ─── Servidor ─────────────────────────────────────────────────────────────────

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Trozos de ~3 palabras, como llegan los deltas del modelo real. */
function trozos(texto) {
  const partes = texto.split(/(?<=\s)/);
  const salida = [];
  for (let i = 0; i < partes.length; i += 3) salida.push(partes.slice(i, i + 3).join(""));
  return salida;
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    req.on("data", (c) => partes.push(c));
    req.on("end", () => resolve(Buffer.concat(partes).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, cuerpo) {
  const b = JSON.stringify(cuerpo);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(b) });
  res.end(b);
}

export function crearMock({ token = process.env.MOCK_IA_TOKEN ?? "token-de-prueba", demoraMs = DEMORA_MS } = {}) {
  const registro = [];
  /** tipo → [{ modo, veces }] */
  const fallas = new Map();

  function tomarFalla(tipo) {
    for (const clave of [tipo, "*"]) {
      const cola = fallas.get(clave);
      if (!cola?.length) continue;
      const f = cola[0];
      if (--f.veces <= 0) cola.shift();
      return f.modo;
    }
    return null;
  }

  async function sse(res, eventos) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "request-id": `req_mock_${Date.now()}`,
    });
    for (const [evento, datos] of eventos) {
      if (res.destroyed) return;
      res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);
      if (evento === "content_block_delta" && demoraMs > 0) await espera(demoraMs);
    }
    res.end();
  }

  async function mensajes(req, res) {
    if (req.headers["x-api-key"] !== token) {
      return json(res, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
    }
    if (!req.headers["anthropic-version"]) {
      return json(res, 400, { type: "error", error: { type: "invalid_request_error", message: "anthropic-version requerido" } });
    }
    let cuerpo;
    try {
      cuerpo = JSON.parse(await leerCuerpo(req));
    } catch {
      return json(res, 400, { type: "error", error: { type: "invalid_request_error", message: "JSON inválido" } });
    }
    if (!cuerpo?.model || !Array.isArray(cuerpo.messages) || !Number.isInteger(cuerpo.max_tokens)) {
      return json(res, 400, { type: "error", error: { type: "invalid_request_error", message: "faltan model, messages o max_tokens" } });
    }

    const tipo = tipoDePeticion(cuerpo.system, cuerpo.messages);
    const system = Array.isArray(cuerpo.system) ? cuerpo.system.map((p) => p.text).join("\n") : cuerpo.system ?? "";
    // Regla de la Messages API: el primer mensaje tiene que ser del usuario. La
    // API real responde 400 invalid_request_error; el doble hace lo mismo para
    // que un historial mal armado falle acá igual que en producción.
    const primeroNoEsUsuario = cuerpo.messages[0]?.role !== "user";
    const falla = primeroNoEsUsuario ? "primer_mensaje_no_es_user" : tomarFalla(tipo);
    registro.push({
      ts: new Date().toISOString(), proveedor: "anthropic", tipo, falla,
      modelo: cuerpo.model, max_tokens: cuerpo.max_tokens, stream: !!cuerpo.stream,
      system, mensajes: cuerpo.messages.map((m) => ({ role: m.role, texto: textoDe(m) })),
    });
    if (registro.length > MAX_REGISTRO) registro.shift();

    if (primeroNoEsUsuario) {
      return json(res, 400, { type: "error", error: { type: "invalid_request_error", message: 'messages: first message must use the "user" role' } });
    }

    if (falla === "http500") {
      return json(res, 500, { type: "error", error: { type: "api_error", message: "falla inyectada por la prueba" } });
    }
    const texto = falla === "vacio" ? "" : respuestaPara(tipo, cuerpo.messages);
    const id = `msg_mock_${Math.random().toString(36).slice(2, 12)}`;
    const usoEntrada = Math.ceil(JSON.stringify(cuerpo.messages).length / 4);
    const usoSalida = Math.ceil(texto.length / 4);

    if (!cuerpo.stream) {
      return json(res, 200, {
        id, type: "message", role: "assistant", model: cuerpo.model,
        content: texto ? [{ type: "text", text: texto }] : [],
        stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: usoEntrada, output_tokens: usoSalida },
      });
    }

    const eventos = [
      ["message_start", {
        type: "message_start",
        message: {
          id, type: "message", role: "assistant", model: cuerpo.model, content: [],
          stop_reason: null, stop_sequence: null, usage: { input_tokens: usoEntrada, output_tokens: 1 },
        },
      }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["ping", { type: "ping" }],
    ];
    const partes = trozos(texto);
    const enviar = falla === "error_stream" ? partes.slice(0, Math.min(4, partes.length)) : partes;
    for (const t of enviar) {
      eventos.push(["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } }]);
    }
    if (falla === "error_stream") {
      eventos.push(["error", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]);
    } else {
      eventos.push(
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: usoSalida } }],
        ["message_stop", { type: "message_stop" }],
      );
    }
    return sse(res, eventos);
  }

  async function gemini(req, res, modelo) {
    if (!req.headers["x-goog-api-key"]) {
      return json(res, 403, { error: { code: 403, message: "falta la API key", status: "PERMISSION_DENIED" } });
    }
    let cuerpo;
    try {
      cuerpo = JSON.parse(await leerCuerpo(req));
    } catch {
      return json(res, 400, { error: { code: 400, message: "JSON inválido", status: "INVALID_ARGUMENT" } });
    }
    const prompt = (cuerpo?.contents ?? []).flatMap((c) => c.parts ?? []).map((p) => p.text ?? "").join("\n");
    const falla = tomarFalla("imagen");
    registro.push({ ts: new Date().toISOString(), proveedor: "gemini", tipo: "imagen", falla, modelo, prompt });
    if (registro.length > MAX_REGISTRO) registro.shift();

    const partes =
      falla === "sin_imagen" ? [{ text: "No puedo generar esa imagen." }]
      : falla === "imagen_invalida" ? [{ inlineData: { mimeType: "image/png", data: Buffer.from("esto no es un png").toString("base64") } }]
      : [{ text: "Foto del plato." }, { inlineData: { mimeType: "image/png", data: pngDePrueba().toString("base64") } }];
    return json(res, 200, {
      candidates: [{ content: { role: "model", parts: partes }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: Math.ceil(prompt.length / 4), candidatesTokenCount: 1290, totalTokenCount: 1300 },
      modelVersion: modelo,
    });
  }

  const servidor = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://mock");
      const ruta = url.pathname;
      if (req.method === "GET" && ruta === "/__salud") return json(res, 200, { ok: true });
      if (ruta === "/__peticiones") {
        if (req.method === "DELETE") { registro.length = 0; return json(res, 200, { ok: true }); }
        const n = Number(url.searchParams.get("n") ?? 20);
        return json(res, 200, registro.slice(-n));
      }
      if (ruta === "/__fallas") {
        if (req.method === "DELETE") { fallas.clear(); return json(res, 200, { ok: true }); }
        const { tipo = "*", modo, veces = 1 } = JSON.parse((await leerCuerpo(req)) || "{}");
        if (!modo) return json(res, 400, { error: "falta modo" });
        if (!fallas.has(tipo)) fallas.set(tipo, []);
        fallas.get(tipo).push({ modo, veces });
        return json(res, 200, { ok: true });
      }
      if (req.method === "POST" && ruta === "/v1/messages") return await mensajes(req, res);
      const g = ruta.match(/^\/v1beta\/models\/([^/:]+):generateContent$/);
      if (req.method === "POST" && g) return await gemini(req, res, g[1]);
      return json(res, 404, { type: "error", error: { type: "not_found_error", message: `sin ruta ${req.method} ${ruta}` } });
    } catch (err) {
      if (!res.headersSent) json(res, 500, { type: "error", error: { type: "api_error", message: String(err?.message ?? err) } });
      else res.destroy();
    }
  });

  return { servidor, registro, fallas };
}

// Ejecutado directamente: queda escuchando hasta recibir SIGTERM.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const i = process.argv.indexOf("--puerto");
  const puerto = Number(i > 0 ? process.argv[i + 1] : process.env.MOCK_IA_PUERTO ?? 3190);
  const { servidor } = crearMock();
  servidor.listen(puerto, "127.0.0.1", () => console.log(`mock de IA escuchando en http://127.0.0.1:${puerto}`));
  for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => servidor.close(() => process.exit(0)));
}
