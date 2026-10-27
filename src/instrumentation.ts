import type { Instrumentation } from "next";

/**
 * Errores no manejados (integrador, punto 17; contrato C5).
 *
 * Next 15 llama a `onRequestError` con todo error que nadie atrapó en un route
 * handler, un server component, una server action o el middleware. Los que sí
 * se atrapan (los catch genéricos de rutaProtegida, rutaPublica, escritura y
 * lectura) ya llaman a `registrarError` ellos mismos, así que acá no se repiten.
 *
 * Solo en el runtime de Node: el registro usa `pg`, que no corre en el edge
 * (el middleware). El import es dinámico y está dentro del `if` para que el
 * bundle del edge no lo incluya.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registrarErrorDePeticion } = await import("@/lib/seguridad/errores");
    await registrarErrorDePeticion(err, request, context);
  }
};
