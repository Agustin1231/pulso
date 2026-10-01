"use client";

import { asegurarSesion, marcarBloqueada } from "@/hooks/use-sesion";
import { otorgarConsentimientoIA } from "@/lib/db/consentimiento";

/**
 * Llamadas a las rutas de IA desde el cliente.
 *
 * Las rutas que mandan datos de salud a Anthropic responden 403
 * `consentimiento_requerido` hasta que el usuario lo autoriza (Ley 1581). En
 * vez de que cada componente lo maneje, `fetchIA` abre el diálogo de
 * consentimiento, lo registra si el usuario acepta y reintenta la llamada.
 * El consentimiento se pide en el momento de uso, sabiendo para qué es.
 */

type Responder = (acepta: boolean) => void;
let abrirDialogo: ((responder: Responder) => void) | null = null;

/** Lo llama `DialogoConsentimiento` al montarse. Devuelve la función para desregistrarse. */
export function registrarDialogoConsentimiento(fn: (responder: Responder) => void): () => void {
  abrirDialogo = fn;
  return () => {
    if (abrirDialogo === fn) abrirDialogo = null;
  };
}

function pedirConsentimiento(): Promise<boolean> {
  if (!abrirDialogo) return Promise.resolve(false);
  const abrir = abrirDialogo;
  return new Promise((resolve) => abrir(resolve));
}

export class ConsentimientoRechazado extends Error {
  constructor() {
    super("consentimiento_rechazado");
    this.name = "ConsentimientoRechazado";
  }
}

export class SesionBloqueada extends Error {
  constructor() {
    super("sesion_bloqueada");
    this.name = "SesionBloqueada";
  }
}

export class LimiteAlcanzado extends Error {
  constructor() {
    super("demasiadas_peticiones");
    this.name = "LimiteAlcanzado";
  }
}

async function codigoDeError(res: Response): Promise<string | null> {
  const data = await res.clone().json().catch(() => null);
  return typeof data?.error === "string" ? data.error : null;
}

/** POST JSON a una ruta de IA. Devuelve la respuesta tal cual para leer el stream. */
export async function fetchIA(url: string, cuerpo: unknown = {}): Promise<Response> {
  await asegurarSesion();
  const llamar = () =>
    fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(cuerpo),
    });

  let res = await llamar();

  if (res.status === 403 && (await codigoDeError(res)) === "consentimiento_requerido") {
    if (!(await pedirConsentimiento())) throw new ConsentimientoRechazado();
    const { error } = await otorgarConsentimientoIA();
    if (error) throw new Error(error);
    res = await llamar();
  }

  if (res.status === 429) throw new LimiteAlcanzado();
  if (res.status === 423) {
    // La ventana de desbloqueo venció: la guardia muestra la pantalla de bloqueo.
    marcarBloqueada();
    throw new SesionBloqueada();
  }
  return res;
}

/** Texto para mostrarle al usuario cuando una llamada de IA no se pudo hacer. */
export function mensajeErrorIA(err: unknown, porDefecto: string): string {
  if (err instanceof ConsentimientoRechazado) {
    return "Esta función necesita tu autorización para enviar tus datos de salud al servicio de IA. Podés darla cuando quieras desde Privacidad.";
  }
  if (err instanceof SesionBloqueada) {
    return "Pulso se bloqueó. Desbloquealo para continuar.";
  }
  if (err instanceof LimiteAlcanzado) {
    return "Llegaste al límite de consultas a la IA por esta hora. Probá de nuevo más tarde.";
  }
  return porDefecto;
}
