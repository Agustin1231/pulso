"use client";

import { useEffect, useState } from "react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { marcarBloqueada, marcarBloqueoActivo, useEstadoSesion } from "@/hooks/use-sesion";

/**
 * Bloqueo con passkey (plantilla, fila 9: "quien abra el navegador entra
 * directo al historial de salud"). Es opcional y no crea una cuenta: la
 * passkey vive en el teléfono (huella, Face ID o PIN del equipo) y el servidor
 * solo guarda su clave pública.
 */
export function SeccionBloqueo() {
  const { lista, bloqueo } = useEstadoSesion();
  const [soporta, setSoporta] = useState<boolean | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSoporta(browserSupportsWebAuthn()), []);

  async function correr(fn: () => Promise<void>) {
    setTrabajando(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Se canceló la verificación."
          : err instanceof Error && err.message
            ? err.message
            : "No se pudo completar. Probá de nuevo."
      );
    } finally {
      setTrabajando(false);
    }
  }

  const activar = () =>
    correr(async () => {
      const r1 = await fetch("/api/bloqueo/registro/opciones", { method: "POST" });
      if (!r1.ok) throw new Error("No se pudo iniciar la activación.");
      const respuesta = await startRegistration({ optionsJSON: await r1.json() });
      const r2 = await fetch("/api/bloqueo/registro", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(respuesta),
      });
      if (!r2.ok) throw new Error("No se pudo verificar la passkey.");
      marcarBloqueoActivo(true);
    });

  const bloquearAhora = () =>
    correr(async () => {
      const r = await fetch("/api/bloqueo/bloquear", { method: "POST" });
      if (!r.ok) throw new Error("No se pudo bloquear.");
      marcarBloqueada();
    });

  const desactivar = () =>
    correr(async () => {
      const r = await fetch("/api/bloqueo", { method: "DELETE" });
      if (!r.ok) throw new Error("No se pudo desactivar.");
      marcarBloqueoActivo(false);
    });

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <Fingerprint className="h-4 w-4 text-teal" />
        <h3 className="text-sm font-bold text-foreground">Bloqueo con huella o Face ID</h3>
      </div>
      <div className="space-y-3 text-xs text-muted-foreground leading-relaxed">
        <p>
          Si alguien toma tu teléfono, no va a poder abrir tus datos de salud sin tu huella, tu cara o el PIN del
          equipo. Pulso se bloquea solo después de 15 minutos sin uso. La verificación la hace tu teléfono: Pulso
          nunca ve tu huella.
        </p>

        {soporta === false && (
          <p className="text-amber">Este navegador no soporta passkeys, así que el bloqueo no está disponible acá.</p>
        )}

        {soporta && lista && (
          bloqueo.activo ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-foreground">El bloqueo está activado.</span>
              <Button variant="ghost" className="border border-border" disabled={trabajando} onClick={bloquearAhora}>
                <Lock className="h-4 w-4" /> Bloquear ahora
              </Button>
              <Button variant="ghost" disabled={trabajando} onClick={desactivar}>
                Desactivar
              </Button>
            </div>
          ) : (
            <Button variant="ghost" className="border border-border" disabled={trabajando} onClick={activar}>
              {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
              Activar bloqueo
            </Button>
          )
        )}

        {error && <p className="text-coral">{error}</p>}
      </div>
    </section>
  );
}
