"use client";

import { useEffect, useSyncExternalStore } from "react";
import { acceptDisclaimer, limpiarEquipo, olvidarUidLegado, uidLegado } from "@/lib/anonymous";

/**
 * Asegura la sesión anónima antes de que la página hable con el servidor, y
 * lleva el estado del bloqueo con passkey (plantilla, fila 9).
 *
 * La identidad es una cookie httpOnly que pone `POST /api/sesion`; el cliente
 * nunca ve el uid. La primera vez después de la migración se manda el UUID
 * viejo del localStorage para reclamar el historial, y después se borra.
 *
 * Un solo POST por carga de página (la promesa se comparte entre componentes)
 * y uno a la vez entre pestañas: si dos pestañas abrieran la app juntas sin
 * cookie, las dos intentarían reclamar el mismo UUID; la segunda perdería y
 * crearía una identidad vacía cuya cookie pisaría la buena. Con el lock, la
 * segunda ya encuentra la cookie de la primera y solo la renueva.
 *
 * El estado vive en un store de módulo: todos los componentes ven lo mismo, y
 * cuando la sesión se bloquea o desbloquea, todos se enteran a la vez.
 *
 * Fin de la sesión (integrador, puntos 10, 11, 16 y 18). Cuando la sesión deja
 * de servir —el usuario la cerró en otra pestaña, entró desde otro navegador,
 * venció, se cerró por inactividad—, `salirDeLaSesion` desmonta la app,
 * avisa a las demás pestañas por un canal compartido (BroadcastChannel o, si no
 * hay, el evento `storage`), limpia el equipo y va a /acceso, que le explica
 * al usuario por qué. Quién lo detecta: el vigía de sesión (vigia-sesion.tsx)
 * al navegar, al volver a la pestaña, cada 20 s y ante cualquier 401 o aviso
 * de una server action.
 */

export interface EstadoBloqueo {
  /** El usuario registró una passkey. */
  activo:    boolean;
  /** Activo y sin desbloquear: el servidor no entrega datos. */
  bloqueada: boolean;
}

/** La cuenta de la sesión. Sin una cuenta "activa" la app no muestra datos (ver GuardiaCuenta). */
export type EstadoCuenta = "ninguna" | "sin_activar" | "activa";

/** Por qué terminó una sesión con cuenta (ver `pulso_motivo_sesion` en db/plataforma.sql). */
export type MotivoFin = "cierre" | "otro_inicio" | "inactividad" | "contrasena" | "admin" | "vencida";

/** Los dos tiempos de inactividad que fija el administrador, y la actividad que ve el servidor. */
export interface ConfigSesion {
  tokenMinutos:  number;
  sesionMinutos: number;
  /** Segundos desde la última interacción que registró el servidor; null si la regla no aplica. */
  inactivaSeg:   number | null;
  /** Cuándo llegó (Date.now()), para descontar lo que pasó desde entonces. */
  recibidaEn:    number;
}

export interface EstadoSesion {
  lista:    boolean;
  bloqueo:  EstadoBloqueo;
  cuenta:   EstadoCuenta;
  /** Por qué terminó la sesión anterior de este navegador, si el servidor lo informó al crear la nueva. */
  motivo:   MotivoFin | null;
  config:   ConfigSesion | null;
  /** La sesión se está cerrando: la app no muestra nada mientras la pestaña se va. */
  saliendo: boolean;
}

const INICIAL: EstadoSesion = {
  lista: false, bloqueo: { activo: false, bloqueada: false }, cuenta: "ninguna",
  motivo: null, config: null, saliendo: false,
};

let estado: EstadoSesion = INICIAL;
const oyentes = new Set<() => void>();

function fijar(parcial: Partial<EstadoSesion>): void {
  estado = { ...estado, ...parcial };
  for (const oyente of oyentes) oyente();
}

/** El estado en este momento, fuera de React (para los temporizadores del vigía). */
export function leerEstadoSesion(): EstadoSesion {
  return estado;
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

function cuentaDe(c: unknown): EstadoCuenta {
  return c === "activa" || c === "sin_activar" ? c : "ninguna";
}

function normalizar(b: unknown): EstadoBloqueo {
  const x = (b ?? {}) as Partial<EstadoBloqueo>;
  return { activo: x.activo === true, bloqueada: x.bloqueada === true };
}

const MOTIVOS: readonly MotivoFin[] = ["cierre", "otro_inicio", "inactividad", "contrasena", "admin", "vencida"];

export function motivoDe(m: unknown): MotivoFin | null {
  return MOTIVOS.includes(m as MotivoFin) ? (m as MotivoFin) : null;
}

function configDe(c: unknown): ConfigSesion | null {
  const x = (c ?? {}) as Partial<Record<keyof ConfigSesion, unknown>>;
  const entero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const token = entero(x.tokenMinutos);
  const sesion = entero(x.sesionMinutos);
  if (!token || !sesion) return null;
  return { tokenMinutos: token, sesionMinutos: sesion, inactivaSeg: entero(x.inactivaSeg), recibidaEn: Date.now() };
}

/** Lo llama el vigía con la configuración que vuelve en cada latido. */
export function actualizarConfig(c: unknown): void {
  const config = configDe(c);
  if (config) fijar({ config });
}

// ─── Sesión ───────────────────────────────────────────────────────────────────

let pendiente: Promise<boolean> | null = null;

async function pedir(): Promise<boolean> {
  const legado = uidLegado();
  const res = await fetch("/api/sesion", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(legado ? { legado } : {}),
  });
  if (!res.ok) return false;
  // Reclamado o no, ya no sirve para nada: la identidad ahora es la cookie.
  if (legado) olvidarUidLegado();
  const data = await res.json().catch(() => ({}));
  fijar({
    lista:   true,
    bloqueo: normalizar(data.bloqueo),
    cuenta:  cuentaDe(data.cuenta),
    motivo:  motivoDe(data.motivo) ?? estado.motivo,
    config:  configDe(data.config),
  });
  return true;
}

async function conLock(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("pulso-sesion", pedir);
  }
  return pedir();
}

export function asegurarSesion(): Promise<boolean> {
  pendiente ??= conLock()
    .catch(() => false)
    .then((ok) => {
      if (!ok) pendiente = null; // que el próximo intento vuelva a probar
      return ok;
    });
  return pendiente;
}

/** Olvida la sesión de esta carga, sin avisar a nadie (para pedir una nueva). */
function olvidarSesionLocal(): void {
  pendiente = null;
  fijar({ ...INICIAL, motivo: estado.motivo });
}

/**
 * Olvida la sesión de esta carga (después de borrar los datos, cerrar sesión o
 * iniciarla). Siempre la sigue una navegación: mientras tanto la app no
 * muestra nada (que no quede una pantalla con datos de la cuenta, ni en la
 * caché de "atrás" del navegador), y las demás pestañas revisan su sesión.
 */
export function reiniciarSesion(): void {
  olvidarSesionLocal();
  fijar({ saliendo: true });
  publicar({ tipo: "cambio" });
}

// ─── Canal entre pestañas (punto 18) ──────────────────────────────────────────

type Mensaje =
  /** La sesión terminó: todas las pestañas van a /acceso con este motivo. */
  | { tipo: "cerrada"; motivo: MotivoFin | null }
  /** La sesión cambió en otra pestaña (entró, salió, borró sus datos): revisarla. */
  | { tipo: "cambio" };

const NOMBRE_CANAL = "pulso-sesion";
/** Respaldo sin BroadcastChannel: un valor en localStorage dispara `storage` en las demás pestañas. */
const CLAVE_CANAL = "pulso_canal_sesion";

let canal: BroadcastChannel | null | undefined;

function recibir(m: unknown): void {
  // Esta pestaña ya se está yendo (la que cerró sesión, por ejemplo): los
  // avisos de las demás no le cambian nada, ni el motivo que va a mostrar.
  if (estado.saliendo) return;
  const x = m as Partial<Mensaje> | null;
  if (x?.tipo === "cerrada") {
    // Ya revocada (o cerrada) por quien avisó: acá solo se sale.
    if (enLaApp) void salirDeLaSesion(motivoDe(x.motivo), { avisar: false });
  } else if (x?.tipo === "cambio") {
    void verificarSesion({ siNoHay: "cierre" });
  }
}

function abrirCanal(): void {
  if (canal !== undefined || typeof window === "undefined") return;
  canal = typeof BroadcastChannel === "function" ? new BroadcastChannel(NOMBRE_CANAL) : null;
  canal?.addEventListener("message", (e) => recibir(e.data));
  window.addEventListener("storage", (e) => {
    if (e.key === CLAVE_CANAL && e.newValue && !canal) {
      try {
        recibir(JSON.parse(e.newValue));
      } catch {
        /* valor ajeno */
      }
    }
    // Otra pestaña vació el storage: es `limpiarEquipo`, que corre al cerrar sesión.
    if (e.key === null) recibir({ tipo: "cambio" });
  });
}

function publicar(m: Mensaje): void {
  abrirCanal();
  if (canal) {
    canal.postMessage(m);
    return;
  }
  try {
    localStorage.setItem(CLAVE_CANAL, JSON.stringify({ ...m, n: Math.random() }));
  } catch {
    /* sin storage: las demás pestañas se enteran por su sondeo */
  }
}

// ─── Fin de la sesión ─────────────────────────────────────────────────────────

/** El vigía está montado: esta pestaña está dentro de la app con una cuenta. */
let enLaApp = false;

export function marcarEnLaApp(dentro: boolean): void {
  enLaApp = dentro;
  if (!dentro) return;
  abrirCanal();
  // Se volvió a la app sin recargar después de un `reiniciarSesion` (que
  // siempre navega): ya no hay nada que esconder.
  if (estado.saliendo && !saliendoYa) fijar({ saliendo: false });
}

/** Motivo que /acceso tiene que explicar, para esta pestaña (sobrevive a la recarga). */
const CLAVE_MOTIVO = "pulso_motivo_fin";

function guardarMotivo(motivo: MotivoFin | null): void {
  try {
    if (motivo) sessionStorage.setItem(CLAVE_MOTIVO, motivo);
  } catch {
    /* sin storage: /acceso se entera por /api/sesion, si puede */
  }
}

/** El motivo que dejó la salida de esta pestaña, una sola vez (al recargar /acceso ya no está). */
export function tomarMotivoGuardado(): MotivoFin | null {
  try {
    const m = motivoDe(sessionStorage.getItem(CLAVE_MOTIVO));
    sessionStorage.removeItem(CLAVE_MOTIVO);
    return m;
  } catch {
    return null;
  }
}

let saliendoYa = false;

interface OpcionesSalida {
  /** Revocar la sesión en el servidor (cuando la decisión es de esta pestaña). */
  revocar?: boolean;
  /** Avisar a las demás pestañas (no cuando el aviso vino de otra). */
  avisar?:  boolean;
  /** Dejar el motivo para que /acceso lo explique. */
  explicar?: boolean;
}

/**
 * La sesión terminó. En orden: la app se desmonta (GuardiaCuenta no muestra
 * nada), se revoca la sesión si corresponde, se avisa a las demás pestañas
 * (después de revocar: que ninguna llegue a /acceso con la sesión todavía
 * viva), se limpia el equipo como en "Cerrar sesión" y se va a /acceso con
 * recarga completa, reemplazando la entrada del historial: ningún componente
 * se queda con datos de la cuenta en memoria.
 */
export async function salirDeLaSesion(
  motivo: MotivoFin | null,
  { revocar = false, avisar = true, explicar = true }: OpcionesSalida = {}
): Promise<void> {
  if (saliendoYa) return;
  saliendoYa = true;
  fijar({ saliendo: true });
  if (revocar) {
    const consulta = motivo === "inactividad" ? "?motivo=inactividad" : "";
    await fetch(`/api/sesion${consulta}`, { method: "DELETE" }).catch(() => null);
  }
  if (avisar) publicar({ tipo: "cerrada", motivo });
  await limpiarEquipo();
  acceptDisclaimer();
  if (explicar) guardarMotivo(motivo);
  window.location.replace("/acceso");
}

/**
 * Cerrar sesión desde esta pestaña: la revoca, saca a las demás al instante y
 * va a /acceso. Con 'inactividad' la cierra el vigía, y /acceso lo explica.
 */
export function cerrarSesion(motivo: "cierre" | "inactividad" = "cierre"): Promise<void> {
  return salirDeLaSesion(motivo, { revocar: true, explicar: motivo !== "cierre" });
}

// ─── Estado ───────────────────────────────────────────────────────────────────

let verificando: Promise<void> | null = null;

/**
 * Vuelve a preguntar el estado sin renovar la sesión (no cuenta como uso ni
 * como actividad). Así se nota que la ventana de desbloqueo venció mientras la
 * app estaba abierta, o que la sesión se cerró en otro lado: dentro de la app,
 * sin una sesión con cuenta, sale a /acceso con el motivo que da el servidor
 * (`siNoHay` si no da ninguno). Fuera de la app pide una sesión nueva.
 * Una sola consulta a la vez: las llamadas juntas comparten la respuesta.
 */
export function verificarSesion({ siNoHay = null }: { siNoHay?: MotivoFin | null } = {}): Promise<void> {
  verificando ??= consultar(siNoHay).finally(() => {
    verificando = null;
  });
  return verificando;
}

async function consultar(siNoHay: MotivoFin | null): Promise<void> {
  const res = await fetch("/api/sesion", { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return;
  const data = await res.json().catch(() => null);
  if (!data) return;
  const config = configDe(data.config);
  if (enLaApp && (data.estado === "sin_sesion" || cuentaDe(data.cuenta) !== "activa")) {
    await salirDeLaSesion(motivoDe(data.motivo) ?? siNoHay);
    return;
  }
  if (data.estado === "sin_sesion") {
    // La sesión venció o se revocó en otro lado: se pide una nueva.
    olvidarSesionLocal();
    if (motivoDe(data.motivo)) fijar({ motivo: motivoDe(data.motivo) });
    void asegurarSesion();
    return;
  }
  fijar({ bloqueo: normalizar(data.bloqueo), cuenta: cuentaDe(data.cuenta), ...(config ? { config } : {}) });
}

/** Lo de siempre: revisa el estado (lo usan la guardia del bloqueo y la pantalla de activación). */
export function refrescarEstado(): Promise<void> {
  return verificarSesion();
}

// ─── Respuestas sin sesión (punto 18) ─────────────────────────────────────────

/** Igual que COOKIE_AVISO en lib/sesion.ts: la deja una server action que no encontró la sesión. */
const COOKIE_AVISO = "pulso_aviso_sesion";

let vigilandoRespuestas = false;

function urlDe(entrada: RequestInfo | URL): URL | null {
  try {
    const texto = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    return new URL(texto, window.location.href);
  } catch {
    return null;
  }
}

function revisarRespuesta(entrada: RequestInfo | URL, res: Response): void {
  if (!enLaApp) return;
  if (document.cookie.split("; ").some((c) => c.startsWith(`${COOKIE_AVISO}=`))) {
    const segura = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE_AVISO}=; Max-Age=0; Path=/; SameSite=Strict${segura}`;
    void verificarSesion();
    return;
  }
  if (res.status !== 401) return;
  const url = urlDe(entrada);
  if (!url || url.origin !== window.location.origin) return;
  if (!url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/sesion")) return;
  void res.clone().json().then(
    (d: { error?: unknown } | null) => {
      if (d?.error === "sesion_requerida" || d?.error === "cuenta_requerida") void verificarSesion();
    },
    () => {}
  );
}

/** Esta pestaña está cerrando la sesión (`DELETE /api/sesion`), la pida quien la pida. */
function esCierreDeSesion(entrada: RequestInfo | URL, init?: RequestInit): boolean {
  const metodo = init?.method ?? (entrada instanceof Request ? entrada.method : "GET");
  if (metodo.toUpperCase() !== "DELETE") return false;
  const url = urlDe(entrada);
  return url?.origin === window.location.origin && url.pathname === "/api/sesion";
}

/**
 * Mira TODAS las respuestas de la página (rutas de la API, IA, push, bloqueo y
 * las server actions, que también viajan por fetch): ante un 401
 * `sesion_requerida` / `cuenta_requerida` o la cookie de aviso, revisa la
 * sesión y, si terminó, la pestaña va a /acceso. No toca la respuesta: el
 * componente que la pidió la recibe igual.
 *
 * Y si esta pestaña cierra la sesión (el botón de /cuenta o el de la pantalla
 * de bloqueo), desde ese momento la app no muestra nada y los avisos de las
 * demás pestañas no la afectan: es ella la que se va.
 */
export function vigilarRespuestas(): void {
  if (vigilandoRespuestas || typeof window === "undefined") return;
  vigilandoRespuestas = true;
  const original = window.fetch.bind(window);
  window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
    try {
      if (esCierreDeSesion(entrada, init)) fijar({ saliendo: true });
    } catch {
      /* mirar nunca rompe la petición */
    }
    const res = await original(entrada, init);
    try {
      revisarRespuesta(entrada, res);
    } catch {
      /* mirar nunca rompe la petición */
    }
    return res;
  };
}

// ─── Bloqueo ──────────────────────────────────────────────────────────────────

/** El servidor respondió 423: la sesión está bloqueada. */
export function marcarBloqueada(): void {
  fijar({ bloqueo: { activo: true, bloqueada: true } });
}

export function marcarDesbloqueada(): void {
  fijar({ bloqueo: { activo: true, bloqueada: false } });
}

/** Después de activar o desactivar el bloqueo. */
export function marcarBloqueoActivo(activo: boolean): void {
  fijar({ bloqueo: { activo, bloqueada: false } });
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/** Estado completo de la sesión y del bloqueo. Si falla, reintenta una vez a los 3 s. */
export function useEstadoSesion(): EstadoSesion {
  useEffect(() => {
    let vivo = true;
    let reintento: ReturnType<typeof setTimeout> | undefined;

    asegurarSesion().then((ok) => {
      if (!vivo || ok) return;
      reintento = setTimeout(() => void asegurarSesion(), 3000);
    });

    return () => {
      vivo = false;
      clearTimeout(reintento);
    };
  }, []);

  return useSyncExternalStore(suscribir, () => estado, () => INICIAL);
}

/**
 * true cuando la sesión está lista, tiene una cuenta activada Y no está
 * bloqueada: es lo que esperan los componentes para pedir datos. Si falta
 * algo, da false y ninguno los pide.
 */
export function useSesion(): boolean {
  const { lista, bloqueo, cuenta, saliendo } = useEstadoSesion();
  return lista && cuenta === "activa" && !bloqueo.bloqueada && !saliendo;
}
