"use client";

import Link from "next/link";
import { Heart, UserRound } from "lucide-react";

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

const bloquear = (e: React.SyntheticEvent) => e.preventDefault();

/**
 * Campo de contraseña (integrador, punto 14): siempre enmascarado y sin botón
 * de "mostrar". Copiar, cortar y arrastrar lo que tiene se bloquean: lo
 * escrito no puede terminar en el portapapeles ni en otra ventana. Pegar sí se
 * deja, para los gestores de contraseñas.
 */
export function CampoContrasena(props: { etiqueta: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <Campo
      {...props}
      type="password"
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      onCopy={bloquear}
      onCut={bloquear}
      onDragStart={bloquear}
    />
  );
}

export function Aviso({ tipo, children }: { tipo: "ok" | "error"; children: React.ReactNode }) {
  return (
    <p role={tipo === "error" ? "alert" : "status"} className={`rounded-lg border p-3 text-xs leading-relaxed ${
      tipo === "ok" ? "border-teal/30 bg-teal/5 text-foreground" : "border-coral/30 bg-coral/5 text-coral"
    }`}>
      {children}
    </p>
  );
}

/** Bloque con título de la página de la cuenta. */
export function Seccion({ titulo, icono: Icono = UserRound, children }: {
  titulo: string;
  icono?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icono className="h-4 w-4 text-teal" />
        <h3 className="text-sm font-bold text-foreground">{titulo}</h3>
      </div>
      <div className="space-y-3 text-xs text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

/** Datos extra que acompañan a un error de /api/cuenta/* (minutos de bloqueo, reglas que faltan…). */
export type DatosError = Record<string, unknown>;

function numero(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function intentos(datos: DatosError | undefined): string {
  const n = numero(datos?.intentos_restantes);
  if (n === null || n <= 0) return "";
  return n === 1
    ? " Te queda 1 intento: si fallas, la cuenta se bloquea 15 minutos."
    : ` Te quedan ${n} intentos antes de que la cuenta se bloquee 15 minutos.`;
}

/** "Al menos una letra mayúscula" → "al menos una letra mayúscula", para encadenar reglas en una frase. */
function enFrase(regla: string): string {
  return regla.charAt(0).toLowerCase() + regla.slice(1);
}

/** Mensaje para el usuario según el código de error de /api/cuenta/* y sus datos. */
export function mensajeDeError(codigo: string | undefined, datos?: DatosError): string {
  switch (codigo) {
    case "credenciales_invalidas": return "Correo o contraseña incorrectos." + intentos(datos);
    case "contrasena_actual_incorrecta": return "La contraseña actual no es correcta." + intentos(datos);
    case "cuenta_bloqueada": {
      const m = numero(datos?.minutos) ?? 15;
      return `La cuenta está bloqueada por ${m} ${m === 1 ? "minuto" : "minutos"} por demasiados intentos con una contraseña equivocada. ` +
        "Espera o usa \"Olvidé mi contraseña\" para crear una nueva: eso la desbloquea enseguida.";
    }
    case "contrasena_invalida": {
      const reglas = Array.isArray(datos?.reglas) ? datos.reglas.filter((r): r is string => typeof r === "string") : [];
      return reglas.length > 0
        ? `La contraseña no cumple: ${reglas.map(enFrase).join("; ")}.`
        : "La contraseña no cumple las reglas de seguridad.";
    }
    case "misma_contrasena":       return "La contraseña nueva tiene que ser distinta de la actual.";
    case "mismo_correo":           return "Ese ya es el correo de tu cuenta.";
    case "correo_en_uso":          return "Ese correo ya es de otra cuenta de Pulso, así que no se cambió nada.";
    case "cuenta_sin_activar":
      return "Tu cuenta todavía no está activada. Abre el enlace que te llegó al correo, o usa \"Olvidé mi contraseña\" para recibir uno nuevo.";
    case "ya_tiene_cuenta":        return "Este equipo ya tiene una cuenta. Recarga la página.";
    case "cuenta_requerida":       return "Inicia sesión para seguir.";
    // El sobre de las rutas solo rechaza así el correo: las contraseñas tienen su propio mensaje.
    case "datos_invalidos":        return "Ese correo no es válido. Escríbelo completo, como nombre@ejemplo.com.";
    case "demasiadas_peticiones":  return "Demasiados intentos. Espera un rato y vuelve a intentar.";
    case "enlace_invalido":        return "El enlace venció o ya se usó.";
    case "sesion_bloqueada":       return "Desbloquea Pulso para seguir.";
    default:                       return "No se pudo completar. Intenta de nuevo.";
  }
}

/** POST JSON a /api/cuenta/*: `error` es null si salió bien; `datos` es el cuerpo de la respuesta. */
export async function enviarConDetalle(ruta: string, cuerpo?: unknown): Promise<{ error: string | null; datos: DatosError }> {
  try {
    const res = await fetch(ruta, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const datos = (await res.json().catch(() => ({}))) as DatosError;
    if (res.ok) return { error: null, datos };
    return { error: typeof datos.error === "string" ? datos.error : "error_interno", datos };
  } catch {
    return { error: "error_interno", datos: {} };
  }
}

/** POST JSON a /api/cuenta/*: devuelve null si salió bien, o el código de error. */
export async function enviar(ruta: string, cuerpo?: unknown): Promise<string | null> {
  return (await enviarConDetalle(ruta, cuerpo)).error;
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
