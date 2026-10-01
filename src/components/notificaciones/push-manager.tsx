"use client";

import { useState, useEffect } from "react";
import { Bell, BellOff, Check, Loader2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSesion } from "@/hooks/use-sesion";

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const arr = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i);
  return arr.buffer as ArrayBuffer;
}

type PermisoState = "default" | "granted" | "denied" | "unsupported";

/** Códigos de error del servidor que conviene traducir. */
const MENSAJES_ERROR: Record<string, string> = {
  demasiadas_peticiones: "llegaste al límite de notificaciones por esta hora",
  sesion_requerida:      "tu sesión no es válida, recargá la página",
};

// Se inyecta en el build: si falta, el servidor no puede firmar los envíos.
const VAPID_PUBLICA = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
// El service worker solo se registra en producción (RegistroServiceWorker).
const SIN_SW_EN_DESARROLLO = process.env.NODE_ENV !== "production";

export function PushManager() {
  const sesion = useSesion();
  const [permiso, setPermiso] = useState<PermisoState>("default");
  const [suscrito, setSuscrito] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [horaRecordatorio, setHoraRecordatorio] = useState("11:20");
  const [recordatorioProgramado, setRecordatorioProgramado] = useState(false);
  const [timerRef, setTimerRef] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Leer estado (el service worker lo registra RegistroServiceWorker en el layout)
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPermiso("unsupported");
      return;
    }
    if (!VAPID_PUBLICA || SIN_SW_EN_DESARROLLO) return;

    // Estado actual
    setPermiso(Notification.permission as PermisoState);

    // Verificar si ya hay suscripción activa
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setSuscrito(!!sub);
      });
    });
  }, []);

  async function activarNotificaciones() {
    if (!sesion) return;
    setCargando(true);
    setResultado(null);

    try {
      const permResult = await Notification.requestPermission();
      setPermiso(permResult as PermisoState);

      if (permResult !== "granted") {
        setCargando(false);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLICA!),
      });

      const subJson = sub.toJSON();
      const res = await fetch("/api/notificaciones/suscribir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subJson }),
      });
      if (!res.ok) throw new Error(`suscribir: HTTP ${res.status}`);

      setSuscrito(true);
      setResultado("¡Notificaciones activadas!");
    } catch (err) {
      console.error("[push] no se pudo activar:", err);
      setResultado("Error al activar. Intenta de nuevo.");
    }

    setCargando(false);
  }

  async function enviarPrueba() {
    if (!sesion) return;
    setEnviando(true);
    setResultado(null);

    const res = await fetch("/api/notificaciones/enviar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Pulso 💚",
        body: "¡Las notificaciones funcionan! Cuida tu corazón hoy.",
        url: "/dashboard",
      }),
    });

    const data = await res.json();
    setResultado(res.ok ? "✓ Notificación enviada — revisa tu dispositivo" : `Error: ${MENSAJES_ERROR[data.error] ?? data.error}`);
    setEnviando(false);
  }

  function programarRecordatorio() {
    if (!sesion || !horaRecordatorio) return;

    // Cancelar si ya había uno programado
    if (timerRef) clearTimeout(timerRef);

    const [h, m] = horaRecordatorio.split(":").map(Number);
    const ahora = new Date();
    const objetivo = new Date();
    objetivo.setHours(h, m, 0, 0);

    // Si la hora ya pasó hoy, programar para mañana
    if (objetivo <= ahora) objetivo.setDate(objetivo.getDate() + 1);

    const msRestantes = objetivo.getTime() - ahora.getTime();
    const minutos = Math.round(msRestantes / 60000);

    const ref = setTimeout(async () => {
      await fetch("/api/notificaciones/enviar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Pulso — Recordatorio 🥗",
          body: "Es hora de revisar tu alimentación. ¿Comiste algo saludable hoy?",
          url: "/recetas",
        }),
      });
      setRecordatorioProgramado(false);
    }, msRestantes);

    setTimerRef(ref);
    setRecordatorioProgramado(true);
    setResultado(`Recordatorio programado en ${minutos < 60 ? `${minutos} min` : `${Math.round(minutos / 60)}h`}`);
  }

  function cancelarRecordatorio() {
    if (timerRef) clearTimeout(timerRef);
    setTimerRef(null);
    setRecordatorioProgramado(false);
    setResultado("Recordatorio cancelado");
  }

  if (permiso === "unsupported") {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="text-sm text-muted-foreground">
          Tu navegador no soporta notificaciones push. Prueba en Chrome o Firefox.
        </p>
      </div>
    );
  }

  if (!VAPID_PUBLICA || SIN_SW_EN_DESARROLLO) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="text-sm text-muted-foreground">
          {!VAPID_PUBLICA
            ? "Las notificaciones push no están configuradas en este servidor (faltan las claves VAPID)."
            : "En desarrollo el service worker está desactivado; las notificaciones se prueban con el build de producción."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Estado de suscripción */}
      <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "h-9 w-9 rounded-full flex items-center justify-center",
            suscrito ? "bg-teal/15" : "bg-surface-2"
          )}>
            {suscrito
              ? <Bell className="h-4 w-4 text-teal" />
              : <BellOff className="h-4 w-4 text-muted-foreground" />
            }
          </div>
          <div>
            <p className="text-sm font-medium">
              {suscrito ? "Notificaciones activas" : "Notificaciones desactivadas"}
            </p>
            <p className="text-xs text-muted-foreground">
              {permiso === "denied"
                ? "Bloqueadas en el navegador — actívalas en ajustes"
                : suscrito
                ? "Recibirás recordatorios en este dispositivo"
                : "Activa para recibir recordatorios de hábitos"}
            </p>
          </div>
        </div>

        {!suscrito && permiso !== "denied" && (
          <button
            onClick={activarNotificaciones}
            disabled={cargando}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-teal/10 text-teal border border-teal/30 text-sm font-semibold hover:bg-teal/20 transition-all disabled:opacity-50"
          >
            {cargando
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <><Bell className="h-4 w-4" /> Activar notificaciones</>
            }
          </button>
        )}
      </div>

      {/* Test y recordatorio — solo si está suscrito */}
      {suscrito && (
        <>
          {/* Enviar prueba inmediata */}
          <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Prueba
            </p>
            <button
              onClick={enviarPrueba}
              disabled={enviando}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-purple/10 text-purple border border-purple/30 text-sm font-semibold hover:bg-purple/20 transition-all disabled:opacity-50"
            >
              {enviando
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <><Bell className="h-4 w-4" /> Enviar notificación de prueba</>
              }
            </button>
          </div>

          {/* Programar recordatorio */}
          <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Recordatorio programado
            </p>
            <p className="text-xs text-muted-foreground">
              Se enviará una vez cuando llegue la hora. Funciona con la app abierta.
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="time"
                  value={horaRecordatorio}
                  onChange={(e) => setHoraRecordatorio(e.target.value)}
                  disabled={recordatorioProgramado}
                  className="w-full rounded-lg bg-surface-2 border border-border pl-8 pr-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-coral disabled:opacity-50"
                />
              </div>
              {recordatorioProgramado ? (
                <button
                  onClick={cancelarRecordatorio}
                  className="px-3 py-2 rounded-lg bg-coral/10 text-coral border border-coral/30 text-sm font-semibold hover:bg-coral/20 transition-all"
                >
                  Cancelar
                </button>
              ) : (
                <button
                  onClick={programarRecordatorio}
                  className="px-3 py-2 rounded-lg bg-coral/10 text-coral border border-coral/30 text-sm font-semibold hover:bg-coral/20 transition-all"
                >
                  Programar
                </button>
              )}
            </div>

            {recordatorioProgramado && (
              <div className="flex items-center gap-2 text-teal">
                <Check className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">Recordatorio activo para las {horaRecordatorio}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Resultado */}
      {resultado && (
        <p className={cn(
          "text-xs text-center py-2 px-3 rounded-lg",
          resultado.startsWith("Error") || resultado.startsWith("Bloq")
            ? "bg-coral/10 text-coral"
            : "bg-teal/10 text-teal"
        )}>
          {resultado}
        </p>
      )}
    </div>
  );
}
