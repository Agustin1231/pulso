"use client";

import { AlertTriangle, CheckCircle2, Info, Loader2, type LucideIcon } from "lucide-react";
import { marcarBloqueada, refrescarEstado } from "@/hooks/use-sesion";
import { cn } from "@/lib/utils";

/**
 * Piezas comunes del panel /admin (integrador): el fetch a /api/admin, los
 * avisos, las casillas y los formatos de fecha y duración.
 */

// ─── Peticiones ───────────────────────────────────────────────────────────────

export type Respuesta<T> =
  | { ok: true; datos: T }
  | { ok: false; error: string; status: number; cuerpo: Record<string, unknown> };

/**
 * JSON a /api/admin/*. Un 401 refresca el estado de la sesión (la guardia de
 * la app lleva a /acceso) y un 423 muestra la pantalla de bloqueo.
 */
export async function pedir<T>(ruta: string, metodo = "GET", cuerpo?: unknown): Promise<Respuesta<T>> {
  try {
    const res = await fetch(ruta, {
      method:  metodo,
      cache:   "no-store",
      headers: cuerpo === undefined ? undefined : { "Content-Type": "application/json" },
      body:    cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const datos = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, datos: datos as T };
    if (res.status === 401) void refrescarEstado();
    if (res.status === 423) marcarBloqueada();
    return { ok: false, error: typeof datos.error === "string" ? datos.error : "error_interno", status: res.status, cuerpo: datos };
  } catch {
    return { ok: false, error: "error_interno", status: 0, cuerpo: {} };
  }
}

// ─── Piezas visuales ──────────────────────────────────────────────────────────

export function Cargando({ texto = "Cargando…" }: { texto?: string }) {
  return (
    <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {texto}
    </p>
  );
}

export type TipoAviso = "ok" | "error" | "info";

export function AvisoAdmin({ tipo, children, className }: { tipo: TipoAviso; children: React.ReactNode; className?: string }) {
  const Icono = tipo === "ok" ? CheckCircle2 : tipo === "error" ? AlertTriangle : Info;
  return (
    <div
      role={tipo === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed",
        tipo === "ok" && "border-teal/30 bg-teal/5 text-foreground",
        tipo === "error" && "border-coral/30 bg-coral/5 text-coral-light",
        tipo === "info" && "border-blue/30 bg-blue/5 text-foreground",
        className
      )}
    >
      <Icono className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tipo === "ok" ? "text-teal" : tipo === "error" ? "text-coral" : "text-blue")} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Tarjeta de una sección del panel. */
export function Panel({ icono: Icono, titulo, descripcion, acciones, children, className }: {
  icono:        LucideIcon;
  titulo:       React.ReactNode;
  descripcion?: React.ReactNode;
  acciones?:    React.ReactNode;
  children:     React.ReactNode;
  className?:   string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-surface p-4", className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icono className="h-4 w-4 shrink-0 text-teal" />
            <h3 className="text-sm font-bold text-foreground">{titulo}</h3>
          </div>
          {descripcion && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{descripcion}</p>}
        </div>
        {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
      </div>
      {children}
    </section>
  );
}

/** Casilla con su texto y una descripción debajo. */
export function Casilla({ marcada, onCambio, deshabilitada, titulo, descripcion, extra }: {
  marcada:        boolean;
  onCambio:       (marcada: boolean) => void;
  deshabilitada?: boolean;
  titulo:         React.ReactNode;
  descripcion?:   React.ReactNode;
  extra?:         React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        marcada ? "border-teal/40 bg-teal/5" : "border-border bg-surface-2/40",
        deshabilitada ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:border-muted"
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 accent-[#00d4aa]"
        checked={marcada}
        disabled={deshabilitada}
        onChange={(e) => onCambio(e.target.checked)}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-foreground">{titulo}{extra}</span>
        {descripcion && <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{descripcion}</span>}
      </span>
    </label>
  );
}

/** Etiqueta chica (permiso, rol, estado). */
export function Chip({ children, tono = "neutro", title, className }: {
  children:   React.ReactNode;
  tono?:      "neutro" | "teal" | "coral" | "amber" | "blue" | "purple";
  title?:     string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4",
        tono === "neutro" && "border-border bg-surface-2 text-muted-foreground",
        tono === "teal" && "border-teal/30 bg-teal/10 text-teal-light",
        tono === "coral" && "border-coral/30 bg-coral/10 text-coral-light",
        tono === "amber" && "border-amber/30 bg-amber/10 text-amber-light",
        tono === "blue" && "border-blue/30 bg-blue/10 text-blue-light",
        tono === "purple" && "border-purple/30 bg-purple/10 text-purple-light",
        className
      )}
    >
      {children}
    </span>
  );
}

/** Campo de texto del panel, con el estilo de los formularios de la cuenta. */
export function CampoAdmin({ etiqueta, ayuda, className, ...props }: {
  etiqueta: string;
  ayuda?:   React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-xs font-semibold text-foreground">{etiqueta}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-coral disabled:opacity-60"
      />
      {ayuda && <span className="block text-[11px] text-muted-foreground">{ayuda}</span>}
    </label>
  );
}

export const claseSelect =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-coral";

// ─── Formatos ─────────────────────────────────────────────────────────────────

const FECHA_HORA = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" });
const FECHA_HORA_SEG = new Intl.DateTimeFormat("es-CO", {
  year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
const RELATIVO = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

export function fechaHora(iso: string | null | undefined, segundos = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : (segundos ? FECHA_HORA_SEG : FECHA_HORA).format(d);
}

/** "hace 5 minutos", "ayer"… */
export function haceCuanto(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  const seg = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (Number.isNaN(seg)) return "—";
  const abs = Math.abs(seg);
  if (abs < 60) return "hace un momento";
  if (abs < 3600) return RELATIVO.format(Math.round(seg / 60), "minute");
  if (abs < 86_400) return RELATIVO.format(Math.round(seg / 3600), "hour");
  if (abs < 30 * 86_400) return RELATIVO.format(Math.round(seg / 86_400), "day");
  return fechaHora(iso);
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Minutos en palabras: "1 minuto", "30 minutos", "1 h 30 min", "180 días". */
export function duracion(minutos: number): string {
  if (!Number.isFinite(minutos)) return "—";
  const d = Math.floor(minutos / 1440);
  const h = Math.floor((minutos % 1440) / 60);
  const m = minutos % 60;
  const partes: { n: number; uno: string; varios: string; corto: string }[] = [];
  if (d) partes.push({ n: d, uno: "día", varios: "días", corto: "d" });
  if (h) partes.push({ n: h, uno: "hora", varios: "horas", corto: "h" });
  if (m) partes.push({ n: m, uno: "minuto", varios: "minutos", corto: "min" });
  if (partes.length === 0) return "0 minutos";
  if (partes.length === 1) return plural(partes[0].n, partes[0].uno, partes[0].varios);
  return partes.map((p) => `${p.n} ${p.corto}`).join(" ");
}

/** Lo que había antes y lo que hay después de una lista: qué se agregó y qué se quitó. */
export function diferencia(antes: readonly string[], despues: readonly string[]): { agregados: string[]; quitados: string[] } {
  return {
    agregados: despues.filter((x) => !antes.includes(x)),
    quitados:  antes.filter((x) => !despues.includes(x)),
  };
}

/** Correo para mostrar de un uid, o un texto que dice por qué no hay. */
export function quien(uid: string | null | undefined, correos: Record<string, string | null>): string {
  if (!uid) return "Sistema";
  const correo = correos[uid];
  // Sin correo: una sesión anónima, o una cuenta que se borró (la auditoría la sobrevive).
  return correo ?? `Sin cuenta o eliminado (${uid.slice(0, 8)}…)`;
}
