"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  CheckCircle2,
  Download,
  Eye,
  FileHeart,
  FileText,
  ImageIcon,
  Loader2,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { marcarBloqueada, useSesion } from "@/hooks/use-sesion";
import {
  ACCEPT_EXAMEN,
  MAX_BYTES_EXAMEN,
  formatearBytes,
  mensajeRechazo,
  nombreTipo,
  tipoPorExtension,
  type CuotaExamenes,
  type Examen,
} from "@/lib/examenes/reglas";
import { cn } from "@/lib/utils";

/**
 * Módulo de exámenes (integrador, punto 15): subir, listar, ver, bajar y
 * borrar. El navegador solo avisa antes de subir lo obvio (tamaño y
 * extensión); la revisión de verdad (la firma del contenido, los ejecutables
 * renombrados, los PDF con JavaScript) la hace el servidor, y acá se muestra
 * su mensaje tal cual.
 */

type Resultado =
  | { tipo: "ok"; archivo: string }
  | { tipo: "error"; archivo: string; mensaje: string; codigo?: string };

/** Mensaje para los errores que no traen `mensaje` (los pone rutaProtegida antes de llegar a la subida). */
function mensajeDeCodigo(codigo: string | undefined, status: number): string {
  switch (codigo) {
    case "demasiadas_peticiones": return "Subiste o borraste demasiados archivos seguidos. Espera un rato y vuelve a intentar.";
    case "sesion_requerida":
    case "cuenta_requerida":      return "Tu sesión terminó. Vuelve a iniciar sesión.";
    case "sesion_bloqueada":      return "Desbloquea Pulso para seguir.";
    case "origen_no_permitido":   return "La petición no salió de Pulso.";
    case "no_encontrado":         return "No se encontró el examen.";
  }
  if (status === 413) return mensajeRechazo("archivo_demasiado_grande");
  return "No se pudo completar. Intenta de nuevo.";
}

function fecha(iso: string): string {
  try {
    return format(new Date(iso), "d MMM yyyy, HH:mm", { locale: es });
  } catch {
    return "";
  }
}

export function ExamenesClient() {
  const router = useRouter();
  const sesion = useSesion();
  const entrada = useRef<HTMLInputElement>(null);
  const [examenes, setExamenes] = useState<Examen[] | null>(null);
  const [cuota, setCuota] = useState<CuotaExamenes | null>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  /** Respuestas que no son de la subida en sí: sesión vencida, bloqueo. */
  const manejarSesion = useCallback((status: number, codigo?: string): boolean => {
    if (status === 423) {
      marcarBloqueada();
      return true;
    }
    if (status === 401 || codigo === "cuenta_requerida" || codigo === "sesion_requerida") {
      router.replace("/acceso");
      return true;
    }
    return false;
  }, [router]);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch("/api/examenes", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (!manejarSesion(res.status, data?.error)) setErrorLista(mensajeDeCodigo(data?.error, res.status));
        return;
      }
      setExamenes(data.examenes);
      setCuota(data.cuota);
      setErrorLista(null);
    } catch {
      setErrorLista("No se pudieron cargar tus exámenes. Revisa tu conexión.");
    }
  }, [manejarSesion]);

  useEffect(() => {
    if (sesion) void cargar();
  }, [sesion, cargar]);

  async function subir(archivo: File) {
    setResultado(null);
    setConfirmando(null);

    // Avisos rápidos con el mismo texto del servidor (que igual lo vuelve a revisar todo).
    if (!tipoPorExtension(archivo.name)) {
      setResultado({ tipo: "error", archivo: archivo.name, mensaje: mensajeRechazo("extension_no_permitida"), codigo: "extension_no_permitida" });
      return;
    }
    if (archivo.size > MAX_BYTES_EXAMEN) {
      setResultado({ tipo: "error", archivo: archivo.name, mensaje: mensajeRechazo("archivo_demasiado_grande"), codigo: "archivo_demasiado_grande" });
      return;
    }

    setSubiendo(archivo.name);
    try {
      const res = await fetch("/api/examenes", {
        method: "POST",
        headers: {
          // El servidor no le cree a este tipo: lo anota en la auditoría y mira los bytes.
          "Content-Type":     archivo.type || "application/octet-stream",
          "X-Nombre-Archivo": encodeURIComponent(archivo.name),
        },
        body: archivo,
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setResultado({ tipo: "ok", archivo: data?.examen?.nombre ?? archivo.name });
        await cargar();
      } else if (!manejarSesion(res.status, data?.error)) {
        setResultado({
          tipo: "error",
          archivo: archivo.name,
          mensaje: typeof data?.mensaje === "string" ? data.mensaje : mensajeDeCodigo(data?.error, res.status),
          codigo: typeof data?.error === "string" ? data.error : undefined,
        });
      }
    } catch {
      setResultado({ tipo: "error", archivo: archivo.name, mensaje: "No se pudo subir el archivo. Revisa tu conexión." });
    } finally {
      setSubiendo(null);
      if (entrada.current) entrada.current.value = "";
    }
  }

  async function borrar(id: string) {
    setBorrando(id);
    setResultado(null);
    try {
      const res = await fetch(`/api/examenes/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok && !manejarSesion(res.status, data?.error)) setErrorLista(mensajeDeCodigo(data?.error, res.status));
      await cargar();
    } finally {
      setBorrando(null);
      setConfirmando(null);
    }
  }

  const ocupado = !sesion || subiendo !== null;

  return (
    <div className="space-y-4">
      {/* Zona de carga */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (!ocupado) setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          const archivo = e.dataTransfer.files?.[0];
          if (archivo && !ocupado) void subir(archivo);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
          arrastrando ? "border-teal bg-teal/10" : "border-border bg-surface hover:border-teal/50 hover:bg-surface-2",
          ocupado && "pointer-events-none opacity-70"
        )}
      >
        <input
          ref={entrada}
          type="file"
          accept={ACCEPT_EXAMEN}
          className="sr-only"
          disabled={ocupado}
          onChange={(e) => {
            const archivo = e.target.files?.[0];
            if (archivo) void subir(archivo);
          }}
        />
        {subiendo ? (
          <>
            <Loader2 className="h-7 w-7 animate-spin text-teal" />
            <span className="text-sm font-semibold text-foreground">Revisando y cifrando «{subiendo}»…</span>
          </>
        ) : (
          <>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal/10">
              <Upload className="h-5 w-5 text-teal" />
            </span>
            <span className="text-sm font-semibold text-foreground">Sube un examen</span>
            <span className="text-xs text-muted-foreground">
              Arrastra el archivo acá o haz clic para elegirlo · PDF, JPG o PNG · máximo {formatearBytes(MAX_BYTES_EXAMEN)}
            </span>
          </>
        )}
      </label>

      {/* Resultado de la última subida */}
      {resultado?.tipo === "ok" && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-teal/30 bg-teal/5 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-teal" />
          <div className="text-sm">
            <p className="font-semibold text-foreground">Examen guardado</p>
            <p className="text-xs text-muted-foreground break-all">«{resultado.archivo}» se revisó y quedó guardado cifrado.</p>
          </div>
        </div>
      )}
      {resultado?.tipo === "error" && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-coral/40 bg-coral/10 p-4">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-coral" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-coral">Archivo rechazado</p>
            <p className="text-xs text-muted-foreground break-all">«{resultado.archivo}»</p>
            <p className="text-foreground">{resultado.mensaje}</p>
            {resultado.codigo && (
              <p className="text-[11px] text-muted-foreground">Código: <code>{resultado.codigo}</code></p>
            )}
          </div>
        </div>
      )}

      {/* Lista */}
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileHeart className="h-4 w-4 text-teal" />
            <h3 className="text-sm font-bold text-foreground">Mis exámenes</h3>
          </div>
          {cuota && (
            <span className="text-xs text-muted-foreground">
              {cuota.examenes} de {cuota.maxExamenes} · {formatearBytes(cuota.bytes)} de {formatearBytes(cuota.maxBytes)}
            </span>
          )}
        </div>
        {cuota && (
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div
              className="h-full rounded-full bg-teal transition-all"
              style={{ width: `${Math.min(100, Math.max((cuota.bytes / cuota.maxBytes) * 100, (cuota.examenes / cuota.maxExamenes) * 100))}%` }}
            />
          </div>
        )}

        {errorLista && <p className="mb-2 text-xs text-coral">{errorLista}</p>}

        {examenes === null ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…
          </p>
        ) : examenes.length === 0 ? (
          <p className="text-xs text-muted-foreground">Todavía no subiste ningún examen.</p>
        ) : (
          <ul className="divide-y divide-border">
            {examenes.map((ex) => {
              const Icono = ex.tipo === "pdf" ? FileText : ImageIcon;
              const url = `/api/examenes/${encodeURIComponent(ex.id)}`;
              return (
                <li key={ex.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                    ex.tipo === "pdf" ? "bg-coral/10 text-coral" : "bg-blue/10 text-blue"
                  )}>
                    <Icono className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground" title={ex.nombre}>{ex.nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      {nombreTipo(ex.tipo)} · {formatearBytes(ex.bytes)} · {fecha(ex.created_at)}
                    </p>
                  </div>
                  {confirmando === ex.id ? (
                    <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                      <span className="text-xs font-semibold text-foreground">¿Borrarlo?</span>
                      <Button size="sm" variant="destructive" disabled={borrando === ex.id} onClick={() => void borrar(ex.id)}>
                        {borrando === ex.id && <Loader2 className="animate-spin" />}
                        Sí, borrar
                      </Button>
                      <Button size="sm" variant="ghost" disabled={borrando === ex.id} onClick={() => setConfirmando(null)}>
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button asChild size="sm" variant="ghost" title="Ver">
                        <a href={url} target="_blank" rel="noopener noreferrer"><Eye /> <span className="hidden sm:inline">Ver</span></a>
                      </Button>
                      <Button asChild size="sm" variant="ghost" title="Descargar">
                        <a href={`${url}?descargar=1`} download><Download /> <span className="hidden sm:inline">Descargar</span></a>
                      </Button>
                      <Button size="icon-sm" variant="ghost" title="Borrar" aria-label={`Borrar ${ex.nombre}`} onClick={() => setConfirmando(ex.id)}>
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Cómo se protegen */}
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-teal" />
          <h3 className="text-sm font-bold text-foreground">Cómo protegemos tus exámenes</h3>
        </div>
        <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          <li>
            <strong className="text-foreground">Revisamos el contenido real del archivo</strong>, no solo su nombre: un
            programa con la extensión cambiada, una imagen disfrazada de PDF o un PDF con JavaScript se rechazan.
          </li>
          <li className="flex gap-1.5">
            <Lock className="mt-0.5 h-3 w-3 shrink-0 text-teal" />
            <span>
              Se guardan <strong className="text-foreground">cifrados</strong> (AES-256), con un nombre aleatorio; el
              nombre original también va cifrado.
            </span>
          </li>
          <li>Solo tú puedes verlos o bajarlos. Si borras tus datos en Privacidad, se borran también.</li>
        </ul>
      </section>
    </div>
  );
}
