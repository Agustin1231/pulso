"use client";

import { useEffect, useSyncExternalStore } from "react";
import { olvidarUidLegado, uidLegado } from "@/lib/anonymous";

/**
 * Asegura la sesión anónima antes de que la página hable con el servidor, y
 * lleva el estado del bloqueo con passkey (plantilla, fila 9).
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
 *
 * El estado vive en un store de módulo: todos los componentes ven lo mismo, y
 * cuando la sesión se bloquea o desbloquea, todos se enteran a la vez.
 */

export interface EstadoBloqueo {
  /** El usuario registró una passkey. */
  activo:    boolean;
  /** Activo y sin desbloquear: el servidor no entrega datos. */
  bloqueada: boolean;
}

export interface EstadoSesion {
  lista:   boolean;
  bloqueo: EstadoBloqueo;
}

const INICIAL: EstadoSesion = { lista: false, bloqueo: { activo: false, bloqueada: false } };

let estado: EstadoSesion = INICIAL;
const oyentes = new Set<() => void>();

function fijar(parcial: Partial<EstadoSesion>): void {
  estado = { ...estado, ...parcial };
  for (const oyente of oyentes) oyente();
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

function normalizar(b: unknown): EstadoBloqueo {
  const x = (b ?? {}) as Partial<EstadoBloqueo>;
  return { activo: x.activo === true, bloqueada: x.bloqueada === true };
}

// ─── Sesión ───────────────────────────────────────────────────────────────────

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
  const data = await res.json().catch(() => ({}));
  fijar({ lista: true, bloqueo: normalizar(data.bloqueo) });
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

/** Olvida la sesión de esta carga (después de borrar los datos o cerrar sesión). */
export function reiniciarSesion(): void {
  pendiente = null;
  fijar(INICIAL);
}

// ─── Bloqueo ──────────────────────────────────────────────────────────────────

/**
 * Vuelve a preguntar el estado sin renovar la sesión. Así se nota que la
 * ventana de desbloqueo venció mientras la app estaba abierta.
 */
export async function refrescarEstado(): Promise<void> {
  const res = await fetch("/api/sesion", { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return;
  const data = await res.json().catch(() => null);
  if (!data) return;
  if (data.estado === "sin_sesion") {
    // La sesión venció o se revocó en otro lado: se pide una nueva.
    reiniciarSesion();
    void asegurarSesion();
    return;
  }
  fijar({ bloqueo: normalizar(data.bloqueo) });
}

/** El servidor respondió 423: la sesión está bloqueada. */
export function marcarBloqueada(): void {
  fijar({ bloqueo: { activo: true, bloqueada: true } });
}

export function marcarDesbloqueada(): void {
  fijar({ bloqueo: { activo: true, bloqueada: false } });
}

/** Después de activar o desactivar el bloqueo. */
export function marcarBloqueoActivo(activo: boolean): void {
  fijar({ bloqueo: { activo, bloqueada: false } });
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/** Estado completo de la sesión y del bloqueo. Si falla, reintenta una vez a los 3 s. */
export function useEstadoSesion(): EstadoSesion {
  useEffect(() => {
    let vivo = true;
    let reintento: ReturnType<typeof setTimeout> | undefined;

    asegurarSesion().then((ok) => {
      if (!vivo || ok) return;
      reintento = setTimeout(() => void asegurarSesion(), 3000);
    });

    return () => {
      vivo = false;
      clearTimeout(reintento);
    };
  }, []);

  return useSyncExternalStore(suscribir, () => estado, () => INICIAL);
}

/**
 * true cuando la sesión está lista Y no está bloqueada: es lo que esperan los
 * componentes para pedir datos. Bloqueada, da false y ninguno los pide.
 */
export function useSesion(): boolean {
  const { lista, bloqueo } = useEstadoSesion();
  return lista && !bloqueo.bloqueada;
}
