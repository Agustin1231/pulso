"use client";

import { useEffect, useState } from "react";
import { olvidarUidLegado, uidLegado } from "@/lib/anonymous";

/**
 * Asegura la sesión anónima antes de que la página hable con el servidor.
 *
 * La identidad es una cookie httpOnly que pone `POST /api/sesion`; el cliente
 * nunca ve el uid. La primera vez después de la migración se manda el UUID
 * viejo del localStorage para reclamar el historial, y después se borra.
 *
 * Un solo POST por carga de página (la promesa se comparte entre componentes)
 * y uno a la vez entre pestañas: si dos pestañas abrieran la app juntas sin
 * cookie, las dos intentarían reclamar el mismo UUID; la segunda perdería y
 * crearía una identidad vacía cuya cookie pisaría la buena. Con el lock, la
 * segunda ya encuentra la cookie de la primera y solo la renueva.
 */

let pendiente: Promise<boolean> | null = null;

async function pedir(): Promise<boolean> {
  const legado = uidLegado();
  const res = await fetch("/api/sesion", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(legado ? { legado } : {}),
  });
  if (!res.ok) return false;
  // Reclamado o no, ya no sirve para nada: la identidad ahora es la cookie.
  if (legado) olvidarUidLegado();
  return true;
}

async function conLock(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("pulso-sesion", pedir);
  }
  return pedir();
}

export function asegurarSesion(): Promise<boolean> {
  pendiente ??= conLock()
    .catch(() => false)
    .then((ok) => {
      if (!ok) pendiente = null; // que el próximo intento vuelva a probar
      return ok;
    });
  return pendiente;
}

/** Olvida la sesión de esta carga (después de borrar los datos). */
export function reiniciarSesion(): void {
  pendiente = null;
}

/** true cuando la sesión está lista. Si falla, reintenta una vez a los 3 s. */
export function useSesion(): boolean {
  const [lista, setLista] = useState(false);

  useEffect(() => {
    let vivo = true;
    let reintento: ReturnType<typeof setTimeout> | undefined;

    asegurarSesion().then((ok) => {
      if (!vivo) return;
      if (ok) return setLista(true);
      reintento = setTimeout(() => {
        asegurarSesion().then((ok2) => vivo && setLista(ok2));
      }, 3000);
    });

    return () => {
      vivo = false;
      clearTimeout(reintento);
    };
  }, []);

  return lista;
}
