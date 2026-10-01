"use client";

import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint, Heart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { limpiarEquipo } from "@/lib/anonymous";
import { marcarDesbloqueada, reiniciarSesion } from "@/hooks/use-sesion";

/** Mensaje para el usuario según cómo falló la verificación. */
function mensajeDe(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "NotAllowedError") return "Se canceló la verificación. Probá de nuevo.";
    if (err.message) return err.message;
  }
  return "No se pudo desbloquear. Probá de nuevo.";
}

/**
 * Pantalla de bloqueo: se pide la passkey (huella, Face ID o PIN del equipo)
 * para volver a usar la app. El servidor verifica la firma; recién ahí abre la
 * ventana de uso. Si el usuario no puede desbloquear, puede cerrar la sesión de
 * este equipo (los datos no se borran, pero quedan inaccesibles desde acá).
 */
export function PantallaBloqueo() {
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saliendo, setSaliendo] = useState(false);
  const [confirmarSalida, setConfirmarSalida] = useState(false);

  async function desbloquear() {
    setVerificando(true);
    setError(null);
    try {
      const r1 = await fetch("/api/bloqueo/desbloqueo/opciones", { method: "POST" });
      if (r1.status === 429) throw new Error("Demasiados intentos. Probá de nuevo en un rato.");
      if (!r1.ok) throw new Error("No se pudo iniciar el desbloqueo.");
      const respuesta = await startAuthentication({ optionsJSON: await r1.json() });

      const r2 = await fetch("/api/bloqueo/desbloqueo", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(respuesta),
      });
      if (!r2.ok) throw new Error("La passkey no se pudo verificar. Probá de nuevo.");
      marcarDesbloqueada();
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setVerificando(false);
    }
  }

  async function cerrarSesion() {
    setSaliendo(true);
    await fetch("/api/sesion", { method: "DELETE" }).catch(() => null);
    await limpiarEquipo();
    reiniciarSesion();
    window.location.replace("/onboarding");
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 text-center animate-fade-in">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-coral/15 border border-coral/25">
          <Heart className="h-7 w-7 fill-coral text-coral" />
        </div>
        <h1 className="text-lg font-bold text-foreground">Pulso está bloqueado</h1>
        <p className="mt-1 mb-5 text-sm text-muted-foreground">
          Usá tu huella, Face ID o el PIN del equipo para ver tus datos de salud.
        </p>

        <Button className="w-full h-11" disabled={verificando || saliendo} onClick={desbloquear}>
          {verificando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
          Desbloquear
        </Button>
        {error && <p className="mt-3 text-xs text-coral">{error}</p>}

        <div className="mt-6 border-t border-border pt-4">
          {!confirmarSalida ? (
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              onClick={() => setConfirmarSalida(true)}
            >
              ¿No podés desbloquear?
            </button>
          ) : (
            <div className="space-y-2 text-left">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Podés cerrar la sesión en este equipo y empezar de cero. Tus datos <strong className="text-foreground">no se
                borran</strong>, pero sin tu passkey no vas a poder volver a verlos desde acá.
              </p>
              <div className="flex gap-2">
                <Button variant="destructive" disabled={saliendo} onClick={cerrarSesion}>
                  {saliendo && <Loader2 className="h-4 w-4 animate-spin" />}
                  Cerrar sesión aquí
                </Button>
                <Button variant="ghost" disabled={saliendo} onClick={() => setConfirmarSalida(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
