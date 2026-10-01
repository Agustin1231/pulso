/**
 * Lo poco que queda en localStorage: el aviso médico aceptado (no es sensible)
 * y, solo hasta la primera visita después de la migración, el UUID viejo.
 *
 * La identidad ya no vive acá: es una cookie httpOnly que emite el servidor
 * (ver lib/sesion.ts y hooks/use-sesion.ts). Un script de la página no la puede leer.
 */

/** Donde la versión anterior guardaba el uid. Se lee una vez para reclamarlo y se borra. */
const CLAVE_UID_LEGADO = "pulso_uid";
const CLAVE_DISCLAIMER = "pulso_disclaimer";

function leer(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null; // modo privado / storage bloqueado
  }
}

/** UUID que dejó la versión anterior, si todavía está. */
export function uidLegado(): string | null {
  if (typeof window === "undefined") return null;
  return leer(CLAVE_UID_LEGADO);
}

export function olvidarUidLegado(): void {
  try {
    localStorage.removeItem(CLAVE_UID_LEGADO);
  } catch {
    /* nada que borrar */
  }
}

/** Verifica si el usuario ya aceptó el disclaimer médico. */
export function hasAcceptedDisclaimer(): boolean {
  if (typeof window === "undefined") return false;
  return leer(CLAVE_DISCLAIMER) === "true";
}

/** Marca el disclaimer como aceptado. */
export function acceptDisclaimer(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CLAVE_DISCLAIMER, "true");
  } catch {
    /* sin storage: el aviso vuelve a aparecer, no pasa nada */
  }
}

/**
 * Después de borrar los datos (plantilla, fila 9): el equipo queda como si
 * nunca se hubiera usado la app. El origen es solo de Pulso, así que se vacía
 * todo: storage (checklists del mercado, aviso), cachés del service worker y
 * la suscripción push.
 */
export async function limpiarEquipo(): Promise<void> {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* sin storage */
  }
  try {
    if ("caches" in window) {
      for (const clave of await caches.keys()) await caches.delete(clave);
    }
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      await (await reg?.pushManager.getSubscription())?.unsubscribe();
    }
  } catch {
    /* lo que no se pudo limpiar no tiene datos de salud */
  }
}
