"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Clock, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  actualizarConfig,
  cerrarSesion,
  leerEstadoSesion,
  marcarEnLaApp,
  motivoDe,
  salirDeLaSesion,
  useEstadoSesion,
  verificarSesion,
  vigilarRespuestas,
  type ConfigSesion,
} from "@/hooks/use-sesion";
import { textoMinutos } from "./textos-sesion";

/**
 * Vigía de la sesión dentro de la app (integrador, puntos 10, 11, 16 y 18).
 *
 * Inactividad del usuario (punto 11): cuenta como actividad el mouse, el
 * teclado, los toques, la rueda y el scroll en CUALQUIER pestaña de Pulso de
 * este navegador (la última se comparte por localStorage, y el evento
 * `storage` la reparte al instante). Cuando falta poco para el límite que fijó
 * el administrador, muestra un aviso con cuenta regresiva; si nadie toca
 * "Seguir conectado", cierra la sesión con motivo 'inactividad' y todas las
 * pestañas van a /acceso, que explica por qué. El servidor aplica la misma
 * regla por su lado con los latidos: este cliente manda uno, espaciado, solo
 * cuando hubo interacción (`POST /api/sesion/latido`). Antes de cerrar se
 * confirma con el servidor: una pestaña que estuvo congelada en segundo plano
 * no cierra la sesión que el usuario está usando en otra.
 *
 * Sesión cerrada en otro lado (16 y 18): pregunta el estado (sin renovar nada)
 * al navegar, al volver a la pestaña, cada 20 s y ante cualquier 401 o aviso
 * de una server action (ver `vigilarRespuestas`). Si la sesión ya no sirve, la
 * pestaña sale a /acceso con el motivo.
 *
 * Los tiempos llegan con cada respuesta de /api/sesion y de cada latido: un
 * cambio del administrador rige sin recargar la página.
 */

const SONDEO_MS = 20_000;
/** Última interacción en cualquier pestaña (ms). */
const CLAVE_ACTIVIDAD = "pulso_actividad";
/** Último latido de cualquier pestaña: qué interacción cubrió y cuándo salió (ms). */
const CLAVE_LATIDO = "pulso_latido";

/** Lo que cuenta como "el usuario está". `scroll` no burbujea: se escucha en captura. */
const EVENTOS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

// localStorage puede no estar (modo privado, bloqueado): entonces cada pestaña
// lleva lo suyo en memoria y se sincroniza por el sondeo al servidor.
const enMemoria = new Map<string, string>();

function leer(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return enMemoria.get(clave) ?? null;
  }
}

function guardar(clave: string, valor: string): void {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    enMemoria.set(clave, valor);
  }
}

function leerNumero(clave: string): number {
  const n = Number(leer(clave));
  return Number.isFinite(n) ? n : 0;
}

function leerLatido(): { cubre: number; enviado: number } {
  try {
    const x = JSON.parse(leer(CLAVE_LATIDO) ?? "null") as { cubre?: unknown; enviado?: unknown } | null;
    return { cubre: Number(x?.cubre) || 0, enviado: Number(x?.enviado) || 0 };
  } catch {
    return { cubre: 0, enviado: 0 };
  }
}

/**
 * Tiempos del vigía para una configuración: el límite, cuánto antes avisar
 * (la mitad del límite, entre 10 s y 1 min) y cada cuánto, como mucho, mandar
 * un latido (un cuarto del menor de los dos tiempos, entre 5 s y 2 min: así el
 * servidor se entera antes de que venza el token o la sesión).
 */
function tiempos(c: ConfigSesion) {
  const limite = c.sesionMinutos * 60_000;
  const token = c.tokenMinutos * 60_000;
  return {
    limite,
    aviso:  Math.min(60_000, Math.max(10_000, limite / 2)),
    latido: Math.min(120_000, Math.max(5_000, Math.min(limite, token) / 4)),
  };
}

function reloj(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function VigiaSesion() {
  const { lista, cuenta, saliendo, config } = useEstadoSesion();
  const activa = lista && cuenta === "activa" && !saliendo;
  const pathname = usePathname();
  const [quedanMs, setQuedanMs] = useState<number | null>(null);

  // Estado de los temporizadores: vive fuera del render.
  const vigia = useRef({ ultimaLocal: 0, escrita: 0, aviso: false, cerrando: false, ultimoSondeo: 0 });

  // En la app: canal entre pestañas y vigilancia de respuestas sin sesión.
  useEffect(() => {
    marcarEnLaApp(true);
    vigilarRespuestas();
    return () => marcarEnLaApp(false);
  }, []);

  // Al navegar dentro de la app (no en la primera carga: ahí ya se pidió la sesión).
  const rutaAnterior = useRef(pathname);
  useEffect(() => {
    if (rutaAnterior.current === pathname) return;
    rutaAnterior.current = pathname;
    void verificarSesion();
  }, [pathname]);

  // Al volver a la pestaña, al recuperar la conexión y al volver con "atrás".
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === "visible") void verificarSesion();
    };
    const alMostrar = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      // Restaurada de la caché de "atrás": si se estaba yendo, que se vaya.
      if (leerEstadoSesion().saliendo) window.location.replace("/acceso");
      else void verificarSesion();
    };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    window.addEventListener("online", alVolver);
    window.addEventListener("pageshow", alMostrar);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
      window.removeEventListener("online", alVolver);
      window.removeEventListener("pageshow", alMostrar);
    };
  }, []);

  const enviarLatido = useCallback(async (haceSeg: number) => {
    const res = await fetch("/api/sesion/latido", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ hace: Math.max(0, Math.min(86_400, Math.round(haceSeg))) }),
    }).catch(() => null);
    if (!res) return;
    const data = await res.json().catch(() => null);
    if (res.status === 401) {
      await salirDeLaSesion(motivoDe(data?.motivo));
      return;
    }
    if (res.ok) actualizarConfig(data?.config);
  }, []);

  const registrarActividad = useCallback((ahora: number) => {
    const v = vigia.current;
    v.ultimaLocal = ahora;
    // Escritura espaciada: con el mouse en movimiento hay decenas de eventos por segundo.
    if (ahora - v.escrita >= 1000) {
      v.escrita = ahora;
      guardar(CLAVE_ACTIVIDAD, String(ahora));
    }
  }, []);

  /** "Seguir conectado": cuenta como interacción y avisa al servidor ya, sin esperar el próximo latido. */
  const seguir = useCallback(() => {
    const ahora = Date.now();
    vigia.current.aviso = false;
    vigia.current.escrita = 0;
    registrarActividad(ahora);
    setQuedanMs(null);
    guardar(CLAVE_LATIDO, JSON.stringify({ cubre: ahora, enviado: ahora }));
    void enviarLatido(0);
  }, [enviarLatido, registrarActividad]);

  // Actividad, latidos, cuenta regresiva y sondeo: solo con una sesión con cuenta.
  useEffect(() => {
    if (!activa) return;
    const v = vigia.current;
    // Abrir la página o entrar a la app es actividad (el servidor ya la contó).
    const inicio = Date.now();
    registrarActividad(inicio);
    if (leerLatido().cubre < inicio) guardar(CLAVE_LATIDO, JSON.stringify({ cubre: inicio, enviado: inicio }));
    v.ultimoSondeo = inicio;

    const alInteractuar = () => {
      // Con el aviso a la vista solo cuenta "Seguir conectado": que un roce del
      // mouse no la mantenga abierta sin que nadie la esté mirando.
      if (!vigia.current.aviso) registrarActividad(Date.now());
    };

    const ultimaActividad = (c: ConfigSesion) => {
      // Lo que vio esta pestaña, lo que dejaron las demás y lo que registró el servidor.
      const servidor = c.inactivaSeg !== null ? c.recibidaEn - c.inactivaSeg * 1000 : 0;
      return Math.max(v.ultimaLocal, leerNumero(CLAVE_ACTIVIDAD), servidor);
    };

    const tick = async () => {
      const c = leerEstadoSesion().config;
      if (!c || v.cerrando) return;
      const t = tiempos(c);
      const ahora = Date.now();
      const quedan = ultimaActividad(c) + t.limite - ahora;

      if (quedan <= 0) {
        v.cerrando = true;
        // Confirmar con el servidor antes de cerrar (trae su actividad, o
        // directamente saca a la pestaña si la sesión ya terminó).
        await verificarSesion();
        const fresca = leerEstadoSesion().config ?? c;
        if (ultimaActividad(fresca) + tiempos(fresca).limite - Date.now() <= 0) {
          await cerrarSesion("inactividad");
          return;
        }
        v.cerrando = false;
        return;
      }

      if (quedan <= t.aviso) {
        if (!v.aviso) {
          v.aviso = true;
          void verificarSesion(); // quizá otra pestaña tuvo actividad que esta no vio
        }
        setQuedanMs(quedan);
      } else if (v.aviso) {
        v.aviso = false;
        setQuedanMs(null);
      }

      // Latido: hubo interacción que el servidor todavía no conoce y ya pasó el intervalo.
      const actividad = Math.max(v.ultimaLocal, leerNumero(CLAVE_ACTIVIDAD));
      const latido = leerLatido();
      if (!v.aviso && actividad > latido.cubre && ahora - latido.enviado >= t.latido) {
        guardar(CLAVE_LATIDO, JSON.stringify({ cubre: actividad, enviado: ahora }));
        void enviarLatido((ahora - actividad) / 1000);
      }

      if (ahora - v.ultimoSondeo >= SONDEO_MS) {
        v.ultimoSondeo = ahora;
        void verificarSesion();
      }
    };

    for (const e of EVENTOS) document.addEventListener(e, alInteractuar, { capture: true, passive: true });
    const intervalo = setInterval(() => void tick(), 1000);
    // Al volver a la pestaña, sin esperar al próximo segundo (los temporizadores
    // de una pestaña oculta corren más lento).
    const alVolver = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      for (const e of EVENTOS) document.removeEventListener(e, alInteractuar, { capture: true });
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alVolver);
      v.aviso = false;
      setQuedanMs(null);
    };
  }, [activa, enviarLatido, registrarActividad]);

  const minutos = config?.sesionMinutos ?? null;

  return (
    <Dialog.Root open={activa && quedanMs !== null} onOpenChange={(abierto) => !abierto && seguir()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          role="alertdialog"
          className="fixed left-1/2 top-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-xl focus:outline-none"
        >
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-5 w-5 text-coral" />
            <Dialog.Title className="text-base font-bold text-foreground">¿Sigues ahí?</Dialog.Title>
          </div>
          <Dialog.Description className="text-sm text-muted-foreground leading-relaxed">
            Por seguridad, tu sesión se cierra
            {minutos ? <> después de <strong className="text-foreground">{textoMinutos(minutos)}</strong></> : null} sin
            actividad. Si no haces nada, se cerrará en:
          </Dialog.Description>
          <p className="my-4 text-center text-4xl font-black tabular-nums text-coral" aria-hidden>
            {reloj(quedanMs ?? 0)}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => void cerrarSesion()}>
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </Button>
            <Button autoFocus onClick={seguir}>Seguir conectado</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
