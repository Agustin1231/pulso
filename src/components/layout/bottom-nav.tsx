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
  FileHeart,
} from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard",  label: "Métricas", icon: Activity,     color: "text-coral" },
  { href: "/recetas",    label: "Recetas",  icon: ChefHat,      color: "text-teal" },
  { href: "/rutinas",    label: "Rutinas",  icon: Dumbbell,     color: "text-blue" },
  { href: "/calendario", label: "Hábitos",  icon: CalendarDays, color: "text-purple" },
  { href: "/score",      label: "Score",    icon: HeartPulse,   color: "text-amber" },
  { href: "/examenes",   label: "Exámenes", icon: FileHeart,    color: "text-teal" },
  { href: "/tips",       label: "Tips",     icon: Lightbulb,    color: "text-green" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-border bg-surface/95 backdrop-blur-md">
      <ul className="flex h-16 items-center">
        {nav.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 py-2 transition-all duration-200",
                  isActive ? item.color : "text-muted-foreground"
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200",
                    isActive && "bg-surface-2"
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className={cn(
                  "text-[10px] font-medium leading-none",
                  isActive ? "opacity-100" : "opacity-60"
                )}>
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
