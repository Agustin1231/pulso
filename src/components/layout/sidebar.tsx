"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ChefHat,
  Dumbbell,
  CalendarDays,
  HeartPulse,
  Lightbulb,
  Heart,
  FileHeart,
} from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  {
    href:  "/dashboard",
    label: "Métricas",
    icon:  Activity,
    color: "text-coral",
    glow:  "group-hover:shadow-[0_0_12px_rgba(255,107,107,0.4)]",
    bg:    "bg-coral/10 group-hover:bg-coral/15",
  },
  {
    href:  "/recetas",
    label: "Recetas",
    icon:  ChefHat,
    color: "text-teal",
    glow:  "group-hover:shadow-[0_0_12px_rgba(0,212,170,0.4)]",
    bg:    "bg-teal/10 group-hover:bg-teal/15",
  },
  {
    href:  "/rutinas",
    label: "Rutinas",
    icon:  Dumbbell,
    color: "text-blue",
    glow:  "group-hover:shadow-[0_0_12px_rgba(88,166,255,0.4)]",
    bg:    "bg-blue/10 group-hover:bg-blue/15",
  },
  {
    href:  "/calendario",
    label: "Hábitos",
    icon:  CalendarDays,
    color: "text-purple",
    glow:  "group-hover:shadow-[0_0_12px_rgba(163,113,247,0.4)]",
    bg:    "bg-purple/10 group-hover:bg-purple/15",
  },
  {
    href:  "/score",
    label: "Mi Score",
    icon:  HeartPulse,
    color: "text-amber",
    glow:  "group-hover:shadow-[0_0_12px_rgba(240,165,0,0.4)]",
    bg:    "bg-amber/10 group-hover:bg-amber/15",
  },
  {
    href:  "/examenes",
    label: "Exámenes",
    icon:  FileHeart,
    color: "text-teal",
    glow:  "group-hover:shadow-[0_0_12px_rgba(0,212,170,0.4)]",
    bg:    "bg-teal/10 group-hover:bg-teal/15",
  },
  {
    href:  "/tips",
    label: "Tips",
    icon:  Lightbulb,
    color: "text-green",
    glow:  "group-hover:shadow-[0_0_12px_rgba(63,185,80,0.4)]",
    bg:    "bg-green/10 group-hover:bg-green/15",
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 hidden md:flex h-full w-64 flex-col border-r border-border bg-surface">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-border px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-coral/15 animate-pulse-beat">
          <Heart className="h-4 w-4 fill-coral text-coral" />
        </div>
        <span className="text-lg font-black tracking-tight text-foreground">
          Pulso
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {nav.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                    isActive
                      ? cn("bg-surface-2 border border-border text-foreground", item.color)
                      : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-md transition-all duration-200",
                      isActive ? item.bg : "bg-transparent group-hover:" + item.bg.split(" ")[0],
                      item.glow
                    )}
                  >
                    <Icon className={cn("h-4 w-4", isActive ? item.color : "text-muted-foreground group-hover:" + item.color.split("-")[0] + "-" + item.color.split("-")[1])} />
                  </span>
                  {item.label}
                  {isActive && (
                    <span className={cn("ml-auto h-1.5 w-1.5 rounded-full", item.color.replace("text-", "bg-"))} />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-4">
        <div className="rounded-lg bg-amber/8 border border-amber/20 p-3">
          <p className="text-xs font-semibold text-amber mb-1">⚕️ Aviso médico</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Pulso es una herramienta de bienestar. No reemplaza la consulta médica.
          </p>
        </div>
      </div>
    </aside>
  );
}
