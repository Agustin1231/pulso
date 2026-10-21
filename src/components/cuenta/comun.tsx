"use client";

import Link from "next/link";
import { Heart } from "lucide-react";

/** Campo de texto de los formularios de la cuenta. */
export function Campo({ etiqueta, ...props }: { etiqueta: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-foreground">{etiqueta}</span>
      <input
        {...props}
        className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-coral"
      />
    </label>
  );
}

export function Aviso({ tipo, children }: { tipo: "ok" | "error"; children: React.ReactNode }) {
  return (
    <p className={`rounded-lg border p-3 text-xs leading-relaxed ${
      tipo === "ok" ? "border-teal/30 bg-teal/5 text-foreground" : "border-coral/30 bg-coral/5 text-coral"
    }`}>
      {children}
    </p>
  );
}

/** Mensaje para el usuario según el código de error de /api/cuenta/*. */
export function mensajeDeError(codigo: string | undefined): string {
  switch (codigo) {
    case "credenciales_invalidas": return "Correo o contraseña incorrectos.";
    case "cuenta_sin_activar":
      return "Tu cuenta todavía no está activada. Abre el enlace que te llegó al correo, o usa \"Olvidé mi contraseña\" para recibir uno nuevo.";
    case "ya_tiene_cuenta":        return "Este equipo ya tiene una cuenta. Recarga la página.";
    case "cuenta_requerida":       return "Inicia sesión para seguir.";
    case "datos_invalidos":        return "Revisa el correo y la contraseña (de 10 a 72 caracteres).";
    case "demasiadas_peticiones":  return "Demasiados intentos. Espera un rato y vuelve a intentar.";
    case "enlace_invalido":        return "El enlace venció o ya se usó.";
    case "sesion_bloqueada":       return "Desbloquea Pulso para seguir.";
    default:                       return "No se pudo completar. Intenta de nuevo.";
  }
}

/** POST JSON a /api/cuenta/*: devuelve null si salió bien, o el código de error. */
export async function enviar(ruta: string, cuerpo?: unknown): Promise<string | null> {
  try {
    const res = await fetch(ruta, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return typeof data.error === "string" ? data.error : "error_interno";
  } catch {
    return "error_interno";
  }
}

/** Marco de las páginas que se abren desde el correo (fuera de la app). */
export function MarcoAcceso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-fade-in">
        <Link href="/acceso" className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-coral/15 border border-coral/25">
            <Heart className="h-4 w-4 fill-coral text-coral" />
          </div>
          <span className="text-xl font-black tracking-tight text-foreground">Pulso</span>
        </Link>
        <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <h1 className="text-base font-bold text-foreground">{titulo}</h1>
          {children}
        </section>
      </div>
    </main>
  );
}
