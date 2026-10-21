"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, ShieldAlert, ChefHat, Dumbbell, CalendarDays, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acceptDisclaimer, hasAcceptedDisclaimer } from "@/lib/anonymous";

const features = [
  { icon: Activity,     label: "Métricas cardiovasculares",  color: "text-coral",  bg: "bg-coral/10" },
  { icon: ChefHat,      label: "Recetas con IA + imagen",    color: "text-teal",   bg: "bg-teal/10" },
  { icon: Dumbbell,     label: "Rutinas personalizadas",     color: "text-blue",   bg: "bg-blue/10" },
  { icon: CalendarDays, label: "Calendario de hábitos",      color: "text-purple", bg: "bg-purple/10" },
];

export default function OnboardingPage() {
  const router  = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Si ya aceptó el disclaimer, ir directo al dashboard (sin cuenta, la guardia lo manda a /acceso)
    if (hasAcceptedDisclaimer()) {
      router.replace("/dashboard");
    } else {
      setReady(true);
    }
  }, [router]);

  // Después del aviso, a iniciar sesión o crear la cuenta (la app la exige).
  function handleAccept() {
    acceptDisclaimer();
    router.replace("/acceso");
  }

  if (!ready) return null;

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Glow de fondo */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-96 w-[600px] rounded-full bg-coral/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 h-64 w-96 rounded-full bg-teal/8 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-coral/15 border border-coral/25 shadow-[0_0_32px_rgba(255,107,107,0.2)]">
            <Heart className="h-8 w-8 fill-coral text-coral animate-pulse-beat" />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">Pulso</h1>
          <p className="mt-1 text-sm text-muted-foreground">Tu corazón, tus hábitos, tu vida.</p>
        </div>

        {/* Features */}
        <div className="mb-6 grid grid-cols-2 gap-3">
          {features.map(({ icon: Icon, label, color, bg }) => (
            <div
              key={label}
              className="flex items-center gap-2.5 rounded-lg border border-border bg-surface p-3"
            >
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${bg}`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </span>
              <span className="text-xs font-medium text-foreground leading-tight">{label}</span>
            </div>
          ))}
        </div>

        {/* Disclaimer */}
        <div className="mb-6 rounded-xl border border-amber/30 bg-amber/8 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber" />
            <div>
              <p className="mb-1 text-sm font-bold text-amber">Aviso médico importante</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Pulso es una herramienta de <strong className="text-foreground">bienestar y educación preventiva</strong>.
                La información que genera{" "}
                <strong className="text-foreground">no es un diagnóstico médico</strong>{" "}
                ni reemplaza la consulta con un profesional de la salud.
                Ante cualquier síntoma o duda, consulta siempre a tu médico.
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <Button
          className="w-full h-12 text-base"
          onClick={handleAccept}
        >
          Entendido, empezar
        </Button>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          En el siguiente paso inicias sesión o creas tu cuenta con tu correo. Así entras desde
          cualquier equipo y no pierdes tus datos.
        </p>
      </div>
    </main>
  );
}
