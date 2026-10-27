"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserCog } from "lucide-react";
import { useSesion } from "@/hooks/use-sesion";
import { esPermiso, pestanasVisibles, type Permiso } from "@/lib/admin/tipos";
import { cn } from "@/lib/utils";

/**
 * Permisos de administración del usuario de la sesión, para mostrar u ocultar
 * el enlace "Administración" y las pestañas del panel (contrato C6). Es solo la
 * parte visible: cada operación la autoriza el servidor, se vea o no el botón.
 *
 * Un store de módulo, como `use-sesion`: la barra lateral, el header y el
 * panel comparten una sola petición por carga de página.
 */

let permisos: readonly Permiso[] | null = null;
let pendiente: Promise<void> | null = null;
const oyentes = new Set<() => void>();

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

async function cargar(): Promise<void> {
  const res = await fetch("/api/admin/permisos", { cache: "no-store" }).catch(() => null);
  const data = res?.ok ? await res.json().catch(() => null) : null;
  permisos = Array.isArray(data?.permisos) ? data.permisos.filter(esPermiso) : [];
  for (const oyente of oyentes) oyente();
}

/** Vuelve a pedir los permisos (después de cambiarse los propios). */
export function recargarPermisosAdmin(): Promise<void> {
  pendiente = cargar();
  return pendiente;
}

/** null mientras carga o sin sesión con cuenta; la lista (quizás vacía) después. */
export function usePermisosAdmin(): readonly Permiso[] | null {
  const sesion = useSesion();
  useEffect(() => {
    if (sesion) pendiente ??= cargar();
  }, [sesion]);
  const valor = useSyncExternalStore(suscribir, () => permisos, () => null);
  return sesion ? valor : null;
}

function useEnlaceAdmin(): { visible: boolean; activo: boolean } {
  const lista = usePermisosAdmin();
  const pathname = usePathname();
  return {
    visible: !!lista && pestanasVisibles(lista).length > 0,
    activo:  pathname === "/admin" || pathname.startsWith("/admin/"),
  };
}

/** Ítem "Administración" de la barra lateral (escritorio). */
export function EnlaceAdminLateral() {
  const { visible, activo } = useEnlaceAdmin();
  if (!visible) return null;
  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Gestión</p>
      <Link
        href="/admin"
        className={cn(
          "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
          activo
            ? "bg-surface-2 border border-border text-blue"
            : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
        )}
      >
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md transition-all duration-200 group-hover:shadow-[0_0_12px_rgba(88,166,255,0.4)]",
            activo ? "bg-blue/10" : "bg-transparent group-hover:bg-blue/10"
          )}
        >
          <UserCog className={cn("h-4 w-4", activo ? "text-blue" : "text-muted-foreground group-hover:text-blue")} />
        </span>
        Administración
        {activo && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue" />}
      </Link>
    </div>
  );
}

/** Botón "Administración" del header (lo que se ve en el celular). */
export function EnlaceAdminHeader() {
  const { visible, activo } = useEnlaceAdmin();
  if (!visible) return null;
  return (
    <Link
      href="/admin"
      title="Administración"
      aria-label="Administración"
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-2 hover:text-foreground",
        activo ? "bg-surface-2 text-blue" : "text-muted-foreground"
      )}
    >
      <UserCog className="h-4 w-4" />
    </Link>
  );
}
