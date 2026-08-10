import { anthropic, createAnthropic } from "@ai-sdk/anthropic";

const MODELO = "claude-sonnet-4-6";

/**
 * Dos formas de hablar con Claude:
 *
 * - `apikey` (default): ANTHROPIC_API_KEY contra la API de Anthropic.
 * - `oauth`: pasa por un proxy que resuelve con el CLI de Claude Code y el
 *   OAuth de la suscripcion. El proxy habla el mismo protocolo que la Messages
 *   API, asi que basta con cambiarle el baseURL al proveedor.
 *
 * El default es `apikey` a proposito: si el proxy se cae, Pulso sigue vivo.
 */
function proveedorOAuth() {
  const baseURL = process.env.CLAUDE_PROXY_URL;
  if (!baseURL) {
    throw new Error(
      "CLAUDE_AUTH_MODE=oauth pero falta CLAUDE_PROXY_URL"
    );
  }
  return createAnthropic({
    baseURL: baseURL.replace(/\/+$/, "") + "/v1",
    apiKey: process.env.CLAUDE_PROXY_TOKEN ?? "",
  });
}

let cache: ReturnType<typeof createAnthropic> | null = null;

export function modeloClaude() {
  if (process.env.CLAUDE_AUTH_MODE !== "oauth") {
    return anthropic(MODELO);
  }
  cache ??= proveedorOAuth();
  return cache(MODELO);
}
