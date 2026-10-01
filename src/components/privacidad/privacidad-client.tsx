"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Database, KeyRound, Loader2, ShieldCheck, Trash2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reiniciarSesion, useSesion } from "@/hooks/use-sesion";
import { limpiarEquipo } from "@/lib/anonymous";
import {
  getConsentimientoIA,
  otorgarConsentimientoIA,
  revocarConsentimientoIA,
} from "@/lib/db/consentimiento";

function Seccion({ icono: Icono, titulo, children }: {
  icono: typeof Database;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icono className="h-4 w-4 text-teal" />
        <h3 className="text-sm font-bold text-foreground">{titulo}</h3>
      </div>
      <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

export function PrivacidadClient() {
  const router = useRouter();
  const sesion = useSesion();
  const [consentimiento, setConsentimiento] = useState<boolean | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sesion) return;
    getConsentimientoIA().then(setConsentimiento);
  }, [sesion]);

  async function alternarConsentimiento() {
    setCambiando(true);
    setError(null);
    const { error } = consentimiento ? await revocarConsentimientoIA() : await otorgarConsentimientoIA();
    if (error) setError(error);
    else setConsentimiento(!consentimiento);
    setCambiando(false);
  }

  async function borrarTodo() {
    setBorrando(true);
    setError(null);
    try {
      const res = await fetch("/api/mis-datos", { method: "DELETE" });
      if (!res.ok) throw new Error();
      await limpiarEquipo();
      reiniciarSesion();
      router.replace("/onboarding");
    } catch {
      setError("No se pudieron borrar tus datos. Intentá de nuevo.");
      setBorrando(false);
    }
  }

  return (
    <div className="space-y-4">
      <Seccion icono={Database} titulo="Qué guardamos">
        <p>
          Tus métricas, hábitos, recetas, rutinas, listas del mercado y el perfil del score (edad, sexo,
          altura, tabaquismo). Nada más: <strong className="text-foreground">no pedimos nombre, email ni
          teléfono</strong>. Tus datos están atados a un identificador aleatorio, no a vos.
        </p>
        <p>
          Cada usuario solo puede leer y modificar sus propios datos: lo controla la base de datos, no solo la app.
        </p>
      </Seccion>

      <Seccion icono={KeyRound} titulo="Tu sesión">
        <p>
          Tu acceso es una cookie protegida que el navegador no deja leer a ningún script. Si no usás Pulso
          durante 180 días, la sesión vence. Como no hay cuenta, si borrás las cookies del navegador perdés el
          acceso a tus datos.
        </p>
      </Seccion>

      <Seccion icono={Share2} titulo="Quién recibe tus datos">
        <p>
          <strong className="text-foreground">Anthropic (Claude):</strong> tus métricas, perfil e informe, solo
          si lo autorizaste, para redactar análisis, tips y rutinas. Las recetas y la lista del mercado solo
          envían ingredientes.
        </p>
        <p>
          <strong className="text-foreground">Google (Gemini):</strong> solo el título de la receta, para generar
          su foto. Ningún dato de salud.
        </p>
      </Seccion>

      <Seccion icono={ShieldCheck} titulo="Autorización para la IA">
        {consentimiento === null ? (
          <p className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              {consentimiento
                ? "Autorizaste el envío de tus datos de salud a la IA."
                : "No autorizaste el envío de tus datos de salud a la IA. Te lo vamos a preguntar al usar esas funciones."}
            </p>
            <Button variant="ghost" className="border border-border" disabled={cambiando} onClick={alternarConsentimiento}>
              {cambiando && <Loader2 className="h-4 w-4 animate-spin" />}
              {consentimiento ? "Revocar" : "Autorizar"}
            </Button>
          </div>
        )}
      </Seccion>

      <section className="rounded-xl border border-coral/30 bg-coral/5 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-coral" />
          <h3 className="text-sm font-bold text-coral">Borrar todos mis datos</h3>
        </div>
        <p className="mb-3 text-xs text-muted-foreground leading-relaxed">
          Elimina de forma definitiva todo lo que guardaste en Pulso, tus fotos de recetas y tu sesión, y limpia
          este equipo. <strong className="text-foreground">No se puede deshacer</strong>: como no hay cuenta, no
          hay copia a la que volver.
        </p>
        {!confirmando ? (
          <Button variant="destructive" disabled={!sesion} onClick={() => setConfirmando(true)}>
            Borrar mis datos
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-foreground">¿Seguro? Se borra todo.</span>
            <Button variant="destructive" disabled={borrando} onClick={borrarTodo}>
              {borrando && <Loader2 className="h-4 w-4 animate-spin" />}
              Sí, borrar todo
            </Button>
            <Button variant="ghost" disabled={borrando} onClick={() => setConfirmando(false)}>
              Cancelar
            </Button>
          </div>
        )}
      </section>

      {error && <p className="text-xs text-coral">{error}</p>}
    </div>
  );
}
