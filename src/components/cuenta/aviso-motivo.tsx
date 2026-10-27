"use client";

import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";
import { tomarMotivoGuardado, useEstadoSesion, type MotivoFin } from "@/hooks/use-sesion";
import { mensajeMotivo } from "./textos-sesion";

/**
 * Aviso de /acceso: por qué terminó la sesión anterior de este navegador
 * (integrador, punto 16 y los demás). El motivo sale de dos lados:
 *   - lo que dejó esta pestaña al salir (se cerró por inactividad, o la cerró
 *     otra pestaña), guardado en sessionStorage;
 *   - lo que informa `POST /api/sesion` cuando la cookie es de una sesión que
 *     ya no sirve (se entró en otro navegador, se cambió la contraseña, un
 *     administrador la cerró, venció).
 * Se muestra una vez: al recargar /acceso ya no está.
 */
export function AvisoMotivo() {
  const { motivo: delServidor, config } = useEstadoSesion();
  const [guardado, setGuardado] = useState<MotivoFin | null>(null);
  const [cerrado, setCerrado] = useState(false);

  // sessionStorage solo existe en el navegador: se lee después de hidratar.
  useEffect(() => setGuardado(tomarMotivoGuardado()), []);

  const motivo = guardado ?? delServidor;
  if (!motivo || cerrado) return null;
  const { titulo, texto } = mensajeMotivo(motivo, config);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center p-3 animate-fade-in">
      <div
        role="status"
        className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-coral/30 bg-surface p-3 shadow-lg"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-coral" />
        <div className="flex-1 space-y-0.5">
          <p className="text-sm font-semibold text-foreground">{titulo}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{texto}</p>
        </div>
        <button
          type="button"
          onClick={() => setCerrado(true)}
          aria-label="Cerrar aviso"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
