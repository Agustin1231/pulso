import "server-only";
import type { TextStreamPart, ToolSet } from "ai";

/**
 * Respuesta de las rutas de IA en el protocolo de datos del AI SDK 4 ("data
 * stream"): una parte por línea, `0:"texto"` para cada fragmento, `3:"mensaje"`
 * si el modelo falla y `d:{...}` al terminar.
 *
 * El AI SDK 4 arrastraba vulnerabilidades sin parche en esa línea (SAST-BE-01:
 * `jsondiffpatch`, `@ai-sdk/provider-utils`), así que se actualizó a la 5. La 5
 * reemplazó `toDataStreamResponse` por otro protocolo (SSE de "UI messages"),
 * pero la web (`recetas-client`, `analisis-ia`, …) y la app Android
 * (`PulsoApi.streamIA`) leen el de la 4. Para no romper a ningún cliente, el
 * servidor lo sigue hablando: se arma acá a partir de `fullStream`, sin
 * depender de cómo serialice cada versión del SDK.
 *
 * Igual que el SDK 4, al cliente le llega un error genérico: el detalle (que
 * puede traer la URL del proveedor o el cuerpo de su respuesta) va solo al log,
 * por el `onError` de cada ruta.
 */
const ERROR_IA = "An error occurred.";

export function respuestaStreamIA(resultado: { fullStream: AsyncIterable<TextStreamPart<ToolSet>> }): Response {
  const codificador = new TextEncoder();
  const parte = (tipo: string, valor: unknown) => codificador.encode(`${tipo}:${JSON.stringify(valor)}\n`);
  const iterador = resultado.fullStream[Symbol.asyncIterator]();

  /** La línea del protocolo para una parte del SDK, o null si el cliente no la usa. */
  const traducir = (p: TextStreamPart<ToolSet>): Uint8Array | null => {
    if (p.type === "text-delta") return p.text ? parte("0", p.text) : null;
    if (p.type === "error") return parte("3", ERROR_IA);
    if (p.type === "finish") return parte("d", { finishReason: p.finishReason });
    return null; // inicio de paso, metadatos, …
  };

  const cuerpo = new ReadableStream<Uint8Array>({
    // Cada `pull` tiene que encolar algo o cerrar: si vuelve sin hacer ninguna
    // de las dos, el stream no lo llama de nuevo y la respuesta queda colgada.
    // Por eso se saltean en un bucle las partes que no van al cliente.
    async pull(controlador) {
      try {
        for (;;) {
          const { done, value } = await iterador.next();
          if (done) {
            controlador.close();
            return;
          }
          const linea = traducir(value);
          if (linea) {
            controlador.enqueue(linea);
            return;
          }
        }
      } catch {
        controlador.enqueue(parte("3", ERROR_IA));
        controlador.close();
      }
    },
    // El cliente cortó (cerró la pantalla o canceló): se deja de leer al modelo.
    async cancel() {
      await iterador.return?.();
    },
  });

  return new Response(cuerpo, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Vercel-AI-Data-Stream": "v1",
    },
  });
}
