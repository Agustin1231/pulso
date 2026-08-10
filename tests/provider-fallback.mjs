// Test del fallback proxy → API de Anthropic.
// Intercepta globalThis.fetch para no salir a la red.
import { fetchConFallback } from "../.tmp-test/provider.js";

const PROXY = "http://10.0.1.1:7779/v1/messages";
let fallos = 0;

function chequear(nombre, cond, extra = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${nombre}${cond ? "" : "  ← " + extra}`);
  if (!cond) fallos++;
}

/** Arma un fetch falso: `proxy` decide qué hace el proxy, la API siempre 200. */
function stub(proxy) {
  const llamadas = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.href ?? input.url;
    llamadas.push({ url, init });
    if (url.startsWith("https://api.anthropic.com")) {
      return new Response('{"ok":true}', { status: 200 });
    }
    if (typeof proxy === "number") return new Response("boom", { status: proxy });
    throw proxy;
  };
  return llamadas;
}

const initBase = () => ({
  method: "POST",
  body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [] }),
  headers: { "x-api-key": "token-del-proxy", "anthropic-version": "2023-06-01" },
});

// ── 1. Proxy OK: no debe haber fallback ──────────────────────────────────────
{
  console.log("\n1) proxy responde 200");
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  const llamadas = stub(200);
  const res = await fetchConFallback()(PROXY, initBase());
  chequear("una sola llamada", llamadas.length === 1, `hubo ${llamadas.length}`);
  chequear("fue al proxy", llamadas[0].url === PROXY, llamadas[0]?.url);
  chequear("status 200", res.status === 200);
}

// ── 2. Proxy 503: fallback a la API ──────────────────────────────────────────
{
  console.log("\n2) proxy responde 503");
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  const llamadas = stub(503);
  const res = await fetchConFallback()(PROXY, initBase());
  chequear("dos llamadas", llamadas.length === 2, `hubo ${llamadas.length}`);
  chequear(
    "la segunda va a api.anthropic.com/v1/messages",
    llamadas[1]?.url === "https://api.anthropic.com/v1/messages",
    llamadas[1]?.url
  );
  const h = new Headers(llamadas[1]?.init?.headers);
  chequear("x-api-key reemplazada por la real", h.get("x-api-key") === "sk-ant-test", h.get("x-api-key"));
  chequear("anthropic-version preservada", h.get("anthropic-version") === "2023-06-01");
  chequear("body preservado en el reintento", llamadas[1]?.init?.body === initBase().body);
  chequear("devuelve la respuesta de la API", res.status === 200);
}

// ── 3. Proxy caído (ECONNREFUSED): fallback ──────────────────────────────────
{
  console.log("\n3) proxy rechaza la conexión");
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  const err = Object.assign(new Error("connect ECONNREFUSED 10.0.1.1:7779"), { code: "ECONNREFUSED" });
  const llamadas = stub(err);
  const res = await fetchConFallback()(PROXY, initBase());
  chequear("dos llamadas", llamadas.length === 2, `hubo ${llamadas.length}`);
  chequear("la segunda va a la API", llamadas[1]?.url.startsWith("https://api.anthropic.com"), llamadas[1]?.url);
  chequear("status 200", res.status === 200);
}

// ── 4 y 5. 4xx NO deben caer atrás ──────────────────────────────────────────
for (const status of [401, 403, 429, 400]) {
  console.log(`\n4) proxy responde ${status} (no debe haber fallback)`);
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  const llamadas = stub(status);
  const res = await fetchConFallback()(PROXY, initBase());
  chequear("una sola llamada", llamadas.length === 1, `hubo ${llamadas.length}`);
  chequear(`propaga el ${status}`, res.status === status, String(res.status));
}

// ── 6. 503 sin ANTHROPIC_API_KEY: error claro ───────────────────────────────
{
  console.log("\n5) proxy 503 y no hay ANTHROPIC_API_KEY");
  delete process.env.ANTHROPIC_API_KEY;
  stub(503);
  let mensaje = null;
  try {
    await fetchConFallback()(PROXY, initBase());
  } catch (e) {
    mensaje = e.message;
  }
  chequear("tira error", mensaje !== null);
  chequear("el mensaje nombra ANTHROPIC_API_KEY", (mensaje ?? "").includes("ANTHROPIC_API_KEY"), mensaje);
}

// ── 7. Preserva query string y path ─────────────────────────────────────────
{
  console.log("\n6) preserva path y query en el fallback");
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  const llamadas = stub(502);
  await fetchConFallback()("http://10.0.1.1:7779/v1/messages?beta=true", initBase());
  chequear(
    "path + query intactos",
    llamadas[1]?.url === "https://api.anthropic.com/v1/messages?beta=true",
    llamadas[1]?.url
  );
}

console.log(fallos === 0 ? "\n✅ Todo pasa" : `\n❌ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
