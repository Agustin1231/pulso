"use client";

import { usePathname } from "next/navigation";
import { Heart } from "lucide-react";
import { BotonNotificaciones } from "@/components/notificaciones/boton-notificaciones";

const titles: Record<string, { label: string; desc: string }> = {
  "/dashboard":  { label: "Métricas",  desc: "Tu salud cardiovascular hoy" },
  "/recetas":    { label: "Recetas",   desc: "Cocina saludable para tu corazón" },
  "/rutinas":    { label: "Rutinas",   desc: "Ejercicio adaptado a tu perfil" },
  "/calendario": { label: "Hábitos",   desc: "Tu seguimiento diario" },
  "/score":      { label: "Mi Score",  desc: "Análisis de riesgo cardiovascular" },
  "/tips":       { label: "Tips",      desc: "Consejos personalizados" },
};

export function Header() {
  const pathname = usePathname();
  const base     = "/" + (pathname.split("/")[1] ?? "");
  const info     = titles[base] ?? { label: "Pulso", desc: "" };

  return (
    <header className="sticky top-0 z-30 flex h-14 md:h-16 items-center justify-between border-b border-border bg-surface/80 backdrop-blur-md px-4 md:px-6">
      {/* Logo en móvil / Título en desktop */}
      <div className="flex items-center gap-3">
        {/* Logo — solo visible en móvil */}
        <div className="flex md:hidden items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-coral/15">
            <Heart className="h-3.5 w-3.5 fill-coral text-coral" />
          </div>
          <span className="text-base font-black tracking-tight text-foreground">Pulso</span>
        </div>

        {/* Título de sección — solo visible en desktop */}
        <div className="hidden md:block">
          <h1 className="text-base font-bold text-foreground leading-tight">{info.label}</h1>
          {info.desc && (
            <p className="text-xs text-muted-foreground">{info.desc}</p>
          )}
        </div>

        {/* Título de sección en móvil — subtítulo pequeño */}
        <div className="flex md:hidden ml-1">
          <span className="text-xs text-muted-foreground">{info.label}</span>
        </div>
      </div>

      <BotonNotificaciones />
    </header>
  );
}
