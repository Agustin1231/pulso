"use client";

import { useCallback, useEffect, useState } from "react";
import { Bug, ChevronDown, Loader2, RefreshCw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mensajeAdmin, type Correos, type ErrorRegistrado } from "@/lib/admin/tipos";
import { cn } from "@/lib/utils";
import { AvisoAdmin, Cargando, Chip, Panel, fechaHora, pedir, quien } from "./comun";

/**
 * Pestaña "Errores" (integrador, punto 17): lo que falló en el servidor y un
 * botón para forzar un error de prueba y ver que el registro lo captura.
 */

type Aviso = { tipo: "ok" | "error" | "info"; texto: React.ReactNode } | null;

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function PestanaErrores() {
  const [errores, setErrores] = useState<ErrorRegistrado[] | null>(null);
  const [correos, setCorreos] = useState<Correos>({});
  const [siguiente, setSiguiente] = useState<number | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forzando, setForzando] = useState<null | "manejado" | "no_manejado">(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [nuevosDesde, setNuevosDesde] = useState<number | null>(null);

  const cargar = useCallback(async (antes?: number): Promise<ErrorRegistrado[] | null> => {
    setCargando(true);
    const r = await pedir<{ errores: ErrorRegistrado[]; correos: Correos; siguiente: number | null }>(
      `/api/admin/errores${antes ? `?antes=${antes}` : ""}`
    );
    setCargando(false);
    if (!r.ok) {
      setError(mensajeAdmin(r.error));
      return null;
    }
    setError(null);
    setErrores((previos) => (antes && previos ? [...previos, ...r.datos.errores] : r.datos.errores));
    setCorreos((c) => ({ ...c, ...r.datos.correos }));
    setSiguiente(r.datos.siguiente);
    return r.datos.errores;
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function forzar(tipo: "manejado" | "no_manejado") {
    setForzando(tipo);
    setAviso(null);
    const ultimo = errores?.[0]?.id ?? 0;
    const r = await pedir("/api/admin/errores/forzar", "POST", { tipo });
    // El no manejado lo registra onRequestError: puede llegar un instante después de la respuesta.
    let lista = await cargar();
    for (let i = 0; i < 5 && lista && !lista.some((e) => e.id > ultimo); i++) {
      await espera(400);
      lista = await cargar();
    }
    setForzando(null);
    setNuevosDesde(ultimo);

    if (r.ok) {
      setAviso({ tipo: "error", texto: "El servidor no falló: no se registró nada." });
    } else if (r.status === 500) {
      const capturado = lista?.find((e) => e.id > ultimo);
      setAviso(capturado
        ? { tipo: "ok", texto: <>El servidor respondió <strong>500 ({r.error})</strong>, sin ningún detalle para el navegador, y el error quedó registrado: es el primero de la lista, resaltado.</> }
        : { tipo: "info", texto: <>El servidor respondió 500 ({r.error}), pero el error todavía no aparece. Actualiza en unos segundos.</> });
    } else {
      setAviso({ tipo: "error", texto: mensajeAdmin(r.error) });
    }
  }

  return (
    <div className="space-y-4">
      <Panel
        icono={Zap}
        titulo="Forzar un error de prueba"
        descripcion="Lanza una excepción a propósito en el servidor para comprobar que el registro de errores la captura. Al navegador solo le llega un mensaje genérico."
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="destructive" disabled={forzando !== null} onClick={() => void forzar("manejado")}>
            {forzando === "manejado" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bug className="h-4 w-4" />}
            Forzar un error de prueba
          </Button>
          <Button variant="outline" disabled={forzando !== null} onClick={() => void forzar("no_manejado")}
                  title="Se lanza fuera del manejo de errores de la ruta: lo captura instrumentation.ts (onRequestError)">
            {forzando === "no_manejado" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bug className="h-4 w-4" />}
            Forzar un error no manejado
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          El primero lo atrapa el manejo de errores de la ruta; el segundo sale sin atrapar y lo captura Next
          (<code>onRequestError</code>).
        </p>
        {aviso && <AvisoAdmin tipo={aviso.tipo} className="mt-3">{aviso.texto}</AvisoAdmin>}
      </Panel>

      <Panel
        icono={Bug}
        titulo="Registro de errores"
        descripcion="Del más nuevo al más viejo; se guardan 90 días. Sin datos de la petición: los correos y tokens del mensaje se reemplazan y la IP va recortada."
        acciones={
          <Button variant="ghost" size="sm" disabled={cargando} onClick={() => void cargar()}>
            <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} /> Actualizar
          </Button>
        }
      >
        {error && <AvisoAdmin tipo="error" className="mb-3">{error}</AvisoAdmin>}
        {errores === null ? (
          <Cargando texto="Cargando errores…" />
        ) : errores.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No hay errores registrados. Prueba con «Forzar un error de prueba».</p>
        ) : (
          <ul className="space-y-2">
            {errores.map((e) => (
              <li key={e.id}>
                <FilaError error={e} correos={correos} nuevo={nuevosDesde !== null && e.id > nuevosDesde} />
              </li>
            ))}
          </ul>
        )}
        {siguiente && (
          <div className="mt-3 flex justify-center">
            <Button variant="secondary" size="sm" disabled={cargando} onClick={() => void cargar(siguiente)}>
              {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Cargar más
            </Button>
          </div>
        )}
      </Panel>
    </div>
  );
}

function FilaError({ error, correos, nuevo }: { error: ErrorRegistrado; correos: Correos; nuevo: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const d = error.detalle ?? {};
  return (
    <div className={cn(
      "rounded-lg border p-3 transition-colors",
      nuevo ? "border-coral/50 bg-coral/5 shadow-[0_0_12px_rgba(255,107,107,0.15)]" : "border-border bg-surface-2/30"
    )}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {nuevo && <Chip tono="coral">Nuevo</Chip>}
        <code className="rounded bg-background px-1.5 py-0.5 text-[10px] text-blue-light">{error.origen}</code>
        {d.no_manejado === true && <Chip tono="amber">No manejado</Chip>}
        {typeof d.codigo === "string" && <Chip>código {d.codigo}</Chip>}
        <span className="ml-auto text-[10px] text-muted-foreground">{fechaHora(error.ocurrido_at, true)}</span>
      </div>
      <p className="mt-1.5 break-words text-xs font-semibold text-foreground">{error.mensaje}</p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>Usuario: {error.uid ? quien(error.uid, correos) : "sin sesión"}</span>
        {error.ip && <span>IP: {error.ip}</span>}
        {typeof d.metodo === "string" && typeof d.ruta === "string" && <span>{d.metodo} {d.ruta}</span>}
        {typeof d.digest === "string" && <span>digest {d.digest}</span>}
        <span>#{error.id}</span>
      </div>
      {error.stack && (
        <>
          <button type="button" onClick={() => setAbierto((a) => !a)}
                  className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("h-3 w-3 transition-transform", abierto && "rotate-180")} /> Stack (recortado)
          </button>
          {abierto && (
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre rounded-lg border border-border bg-background p-2 text-[10px] leading-relaxed text-muted-foreground">
              {error.stack}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
