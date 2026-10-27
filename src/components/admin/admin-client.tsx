"use client";

import { useEffect, useMemo, useState } from "react";
import { Bug, KeyRound, Lock, ScrollText, Timer, Users, type LucideIcon } from "lucide-react";
import { pestanasVisibles, type IdPestana } from "@/lib/admin/tipos";
import { cn } from "@/lib/utils";
import { Cargando, Panel } from "./comun";
import { usePermisosAdmin } from "./permisos-admin";
import { PestanaAuditoria } from "./auditoria";
import { PestanaErrores } from "./errores";
import { PestanaRoles } from "./roles";
import { PestanaSesion } from "./sesion";
import { PestanaUsuarios } from "./usuarios";

/**
 * Panel /admin (integrador, puntos 5, 7, 8, 9, 10, 11 y 17). Cada pestaña
 * aparece si el usuario tiene su permiso; la pestaña elegida queda en el
 * `#hash` de la URL para volver a ella al recargar.
 */

function icono(id: IdPestana): LucideIcon {
  switch (id) {
    case "usuarios":  return Users;
    case "roles":     return KeyRound;
    case "auditoria": return ScrollText;
    case "errores":   return Bug;
    case "sesion":    return Timer;
  }
}

export function AdminClient() {
  const permisos = usePermisosAdmin();
  const visibles = useMemo(() => (permisos ? pestanasVisibles(permisos) : []), [permisos]);
  const [activa, setActiva] = useState<IdPestana | null>(null);

  useEffect(() => {
    if (!visibles.length) return;
    const delHash = window.location.hash.slice(1);
    setActiva((actual) =>
      actual && visibles.some((v) => v.id === actual)
        ? actual
        : (visibles.find((v) => v.id === delHash)?.id ?? visibles[0].id)
    );
  }, [visibles]);

  function elegir(id: IdPestana) {
    setActiva(id);
    window.history.replaceState(null, "", `#${id}`);
  }

  if (permisos === null) return <Cargando />;

  if (!visibles.length) {
    return (
      <Panel icono={Lock} titulo="Sin acceso a la administración">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Tu cuenta no tiene ningún permiso de administración. Si lo necesitas, pídeselo a un administrador.
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Secciones de administración"
           className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1">
        {visibles.map((p) => {
          const Icono = icono(p.id);
          const seleccionada = p.id === activa;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              id={`pestana-${p.id}`}
              aria-selected={seleccionada}
              aria-controls={`panel-${p.id}`}
              onClick={() => elegir(p.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
                seleccionada
                  ? "bg-surface-2 text-foreground border border-border"
                  : "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground border border-transparent"
              )}
            >
              <Icono className={cn("h-3.5 w-3.5", seleccionada ? "text-teal" : "")} />
              {p.titulo}
            </button>
          );
        })}
      </div>

      {activa && (
        <div role="tabpanel" id={`panel-${activa}`} aria-labelledby={`pestana-${activa}`}>
          {activa === "usuarios"  && <PestanaUsuarios permisos={permisos} />}
          {activa === "roles"     && <PestanaRoles />}
          {activa === "auditoria" && <PestanaAuditoria permisos={permisos} />}
          {activa === "errores"   && <PestanaErrores />}
          {activa === "sesion"    && <PestanaSesion />}
        </div>
      )}
    </div>
  );
}
