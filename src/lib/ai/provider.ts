import { anthropic, createAnthropic } from "@ai-sdk/anthropic";

const MODELO = "claude-sonnet-4-6";
const API_ANTHROPIC = "https://api.anthropic.com";

/**
 * Dos formas de hablar con Claude:
 *
 * - `apikey` (default): ANTHROPIC_API_KEY contra la API de Anthropic.
 * - `oauth`: pasa por un proxy que resuelve con el CLI de Claude Code y el
 *   OAuth de la suscripcion. El proxy habla el mismo protocolo que la Messages
 *   API, asi que basta con cambiarle el baseURL al proveedor.
 *
 * En modo `oauth`, si el proxy no responde la peticion se reintenta contra la
 * API de Anthropic con ANTHROPIC_API_KEY. Ver `fetchConFallback`.
 */

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/**
 * Fallos que significan "el proxy esta roto o caido" y justifican reintentar
 * contra la API.
 *
 * Deliberadamente NO incluye 4xx: un 401/403 es un token mal configurado y un
 * 429 es la suscripcion agotada. Taparlos con el fallback los volveria
 * invisibles y movería el gasto a la API sin que nadie se enterara.
 */
function esProxyRoto(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

/** El body hay que poder mandarlo dos veces, asi que se materializa a texto. */
async function cuerpoReplayable(
  body: RequestInit["body"]
): Promise<string | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  return await new Response(body as BodyInit).text();
}

function urlDe(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Envuelve fetch para que, cuando el proxy no conteste, la misma peticion se
 * resuelva contra la API de Anthropic.
 *
 * Limites conocidos:
 * - Solo cubre fallos ANTES de que lleguen las cabeceras de respuesta. Si el
 *   proxy responde 200 y se corta a mitad del stream, ya no hay vuelta atras.
 * - No se impone timeout a proposito: estas peticiones son streaming y pueden
 *   durar minutos legitimamente, asi que un timeout de fetch cortaria
 *   respuestas validas. Un proxy colgado es problema de su supervision.
 */
/** Exportada para `tests/provider-fallback.mjs` (`npm run test:fallback`). */
export function fetchConFallback(): FetchLike {
  return async (input, init) => {
    const url = urlDe(input);
    const body = await cuerpoReplayable(init?.body);
    const reintentable: RequestInit = { ...init, body };

    let motivo: string;
    try {
      const res = await fetch(url, reintentable);
      if (!esProxyRoto(res.status)) return res;
      motivo = `HTTP ${res.status}`;
    } catch (err) {
      motivo = err instanceof Error ? err.message : String(err);
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        `El proxy de Claude fallo (${motivo}) y no hay ANTHROPIC_API_KEY ` +
          `configurada para reintentar contra la API.`
      );
    }

    const origen = new URL(url);
    const destino = new URL(origen.pathname + origen.search, API_ANTHROPIC);
    const headers = new Headers(init?.headers);
    headers.set("x-api-key", apiKey);
    headers.delete("authorization");

    console.warn(
      `[ai] proxy no disponible (${motivo}); reintentando ${origen.pathname} ` +
        `contra la API de Anthropic`
    );
    return fetch(destino, { ...reintentable, headers });
  };
}

function proveedorOAuth() {
  const baseURL = process.env.CLAUDE_PROXY_URL;
  if (!baseURL) {
    throw new Error("CLAUDE_AUTH_MODE=oauth pero falta CLAUDE_PROXY_URL");
  }

  // Sin token el proveedor mandaria una credencial vacia. El proxy escucha en
  // la red interna, donde lo alcanza cualquier contenedor del host: el token es
  // el unico limite, asi que faltar es un error, no un default.
  const token = process.env.CLAUDE_PROXY_TOKEN;
  if (!token) {
    throw new Error("CLAUDE_AUTH_MODE=oauth pero falta CLAUDE_PROXY_TOKEN");
  }

  return createAnthropic({
    baseURL: baseURL.replace(/\/+$/, "") + "/v1",
    apiKey: token,
    fetch: fetchConFallback(),
  });
}

let cache: ReturnType<typeof createAnthropic> | null = null;

export function modeloClaude() {
  if (process.env.CLAUDE_AUTH_MODE !== "oauth") {
    return anthropic(MODELO);
  }
  // El proveedor se memoiza, asi que cambiar CLAUDE_AUTH_MODE necesita
  // reiniciar el proceso (en Coolify, un redeploy).
  cache ??= proveedorOAuth();
  return cache(MODELO);
}
