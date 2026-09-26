"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PushManager } from "@/components/notificaciones/push-manager";

/**
 * Campana del header: abre el panel de notificaciones push. El panel queda
 * montado aunque esté cerrado, para que un recordatorio programado no se pierda.
 */
export function BotonNotificaciones() {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", escape);
    };
  }, [abierto]);

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Notificaciones"
        aria-haspopup="dialog"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
      >
        <Bell className="h-4 w-4" />
      </Button>

      <div
        role="dialog"
        aria-label="Notificaciones"
        hidden={!abierto}
        className="absolute right-0 top-full z-50 mt-2 max-h-[80vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border bg-background p-3 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between px-1">
          <p className="text-sm font-semibold text-foreground">Notificaciones</p>
          <button
            onClick={() => setAbierto(false)}
            aria-label="Cerrar"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <PushManager />
      </div>
    </div>
  );
}
