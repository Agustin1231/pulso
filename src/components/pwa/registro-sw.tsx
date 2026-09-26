"use client";

import { useEffect } from "react";

/**
 * Registra /sw.js en cuanto carga la app, para que sea instalable y abra sin
 * conexión. En desarrollo no se registra: el caché de estáticos se mezclaría
 * con la recarga en caliente de Next.
 */
export function RegistroServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[pwa] no se pudo registrar el service worker:", err);
    });
  }, []);
  return null;
}
