"use client";

import { useCallback, useEffect, useState } from "react";
import { Hourglass, KeyRound, Loader2, MousePointerClick, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mensajeAdmin, type Correos, type ValorConfig } from "@/lib/admin/tipos";
import { cn } from "@/lib/utils";
import { AvisoAdmin, Cargando, Chip, Panel, claseSelect, duracion, fechaHora, pedir, quien, type TipoAviso } from "./comun";

/**
 * Pestaña "Sesión" (integrador, puntos 10 y 11): los dos tiempos de
 * inactividad de `configuracion` (db/plataforma.sql). Acá solo se cambian
 * (contrato C1); los aplica la sesión, que los lee en cada petición.
 */

interface Definicion {
  titulo:      string;
  punto:       string;
  icono:       typeof KeyRound;
  explicacion: React.ReactNode;
  atajos:      number[];
}

const MIN = 1;
const HORA = 60;
const DIA = 1440;

function definicion(clave: string): Definicion | null {
  switch (clave) {
    case "token_inactividad_minutos":
      return {
        titulo: "Expiración del token por inactividad",
        punto:  "Punto 10",
        icono:  KeyRound,
        explicacion: (
          <>
            El token de autenticación (la cookie de sesión del navegador o el token de la app) deja de servir si
            pasa este tiempo <strong className="text-foreground">sin ninguna petición autenticada</strong>. Cada
            petición vuelve a correr el plazo. Al bajarlo, las sesiones que ya estaban quietas más que eso dejan de
            servir en su próxima petición.
          </>
        ),
        atajos: [1 * MIN, 5 * MIN, 30 * MIN, 1 * HORA, 1 * DIA, 30 * DIA, 180 * DIA],
      };
    case "sesion_inactividad_minutos":
      return {
        titulo: "Cierre de la sesión por inactividad del usuario",
        punto:  "Punto 11",
        icono:  MousePointerClick,
        explicacion: (
          <>
            Si el usuario pasa este tiempo <strong className="text-foreground">sin tocar la app</strong> (mouse,
            teclado, toques ni scroll, en cualquiera de sus pestañas), la sesión se cierra con un aviso previo y
            tiene que volver a entrar. Las peticiones automáticas de fondo no cuentan como actividad.
          </>
        ),
        atajos: [1 * MIN, 5 * MIN, 15 * MIN, 30 * MIN, 1 * HORA, 8 * HORA, 1 * DIA],
      };
    default:
      return null;
  }
}

type Unidad = "minutos" | "horas" | "dias";
const FACTOR: Record<Unidad, number> = { minutos: 1, horas: HORA, dias: DIA };

/** La unidad más grande que expresa el valor sin decimales. */
function unidadDe(minutos: number): Unidad {
  if (minutos % DIA === 0) return "dias";
  if (minutos % HORA === 0) return "horas";
  return "minutos";
}

export function PestanaSesion() {
  const [valores, setValores] = useState<ValorConfig[] | null>(null);
  const [correos, setCorreos] = useState<Correos>({});
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const r = await pedir<{ configuracion: ValorConfig[]; correos: Correos }>("/api/admin/configuracion");
    if (!r.ok) {
      setError(mensajeAdmin(r.error));
      return;
    }
    setError(null);
    setValores(r.datos.configuracion);
    setCorreos(r.datos.correos);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error && !valores) return <AvisoAdmin tipo="error">{error}</AvisoAdmin>;
  if (!valores) return <Cargando texto="Cargando configuración…" />;

  function guardado(nuevo: ValorConfig, nuevosCorreos: Correos) {
    setValores((vs) => vs && vs.map((v) => (v.clave === nuevo.clave ? nuevo : v)));
    setCorreos((c) => ({ ...c, ...nuevosCorreos }));
  }

  // Primero los conocidos, en el orden de los puntos; después cualquier otro que se agregue.
  const orden = (c: string) => (c === "token_inactividad_minutos" ? 0 : c === "sesion_inactividad_minutos" ? 1 : 2);
  const ordenados = [...valores].sort((a, b) => orden(a.clave) - orden(b.clave) || a.clave.localeCompare(b.clave));

  return (
    <div className="space-y-4">
      <AvisoAdmin tipo="info">
        Los cambios rigen enseguida: el servidor lee estos valores en cada petición, sin caché, y cada cambio queda
        en la auditoría con el valor anterior y el nuevo.
      </AvisoAdmin>
      <div className="grid gap-4 xl:grid-cols-2">
        {ordenados.map((v) => (
          <TarjetaValor key={v.clave} valor={v} correos={correos} onGuardado={guardado} />
        ))}
      </div>
    </div>
  );
}

function TarjetaValor({ valor, correos, onGuardado }: {
  valor:      ValorConfig;
  correos:    Correos;
  onGuardado: (v: ValorConfig, correos: Correos) => void;
}) {
  const def = definicion(valor.clave);
  const [unidad, setUnidad] = useState<Unidad>(unidadDe(valor.valor));
  const [cantidad, setCantidad] = useState(String(valor.valor / FACTOR[unidadDe(valor.valor)]));
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: TipoAviso; texto: string } | null>(null);

  const n = Number(cantidad.replace(",", "."));
  const minutos = Number.isFinite(n) ? Math.round(n * FACTOR[unidad]) : NaN;
  const fuera = !Number.isInteger(minutos) || minutos < valor.minimo || minutos > valor.maximo;
  const cambiado = !fuera && minutos !== valor.valor;

  function elegirAtajo(m: number) {
    const u = unidadDe(m);
    setUnidad(u);
    setCantidad(String(m / FACTOR[u]));
    setAviso(null);
  }

  async function guardar() {
    if (fuera) return;
    setEnviando(true);
    setAviso(null);
    const r = await pedir<{ configuracion: ValorConfig; correos: Correos }>("/api/admin/configuracion", "PUT", { clave: valor.clave, valor: minutos });
    setEnviando(false);
    if (!r.ok) {
      setAviso({ tipo: "error", texto: mensajeAdmin(r.error) });
      return;
    }
    onGuardado(r.datos.configuracion, r.datos.correos);
    setAviso({ tipo: "ok", texto: `Guardado: ${duracion(valor.valor)} → ${duracion(r.datos.configuracion.valor)}. Ya está rigiendo.` });
  }

  const Icono = def?.icono ?? Hourglass;
  return (
    <Panel
      icono={Icono}
      titulo={<span className="flex flex-wrap items-center gap-2">{def?.titulo ?? valor.clave}{def && <Chip>{def.punto}</Chip>}</span>}
      descripcion={def?.explicacion}
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-surface-2/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Valor actual</p>
          <p className="text-2xl font-black text-foreground">{duracion(valor.valor)}</p>
          <p className="text-[11px] text-muted-foreground">
            {valor.valor.toLocaleString("es-CO")} minutos · <code>{valor.clave}</code>
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Último cambio: {fechaHora(valor.actualizada_at)}
            {valor.actualizada_por && <> por {quien(valor.actualizada_por, correos)}</>}
          </p>
        </div>

        {def && (
          <div>
            <p className="mb-2 text-xs font-semibold text-foreground">Atajos</p>
            <div className="flex flex-wrap gap-1.5">
              {def.atajos.filter((m) => m >= valor.minimo && m <= valor.maximo).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => elegirAtajo(m)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors",
                    minutos === m ? "border-teal/40 bg-teal/10 text-teal-light" : "border-border text-muted-foreground hover:text-foreground",
                    valor.valor === m && "ring-1 ring-blue/40"
                  )}
                >
                  {duracion(m)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <label className="block w-28 space-y-1">
            <span className="text-xs font-semibold text-foreground">Valor</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={cantidad}
              onChange={(e) => { setCantidad(e.target.value); setAviso(null); }}
              className={claseSelect}
            />
          </label>
          <label className="block w-32 space-y-1">
            <span className="text-xs font-semibold text-foreground">Unidad</span>
            <select value={unidad} onChange={(e) => setUnidad(e.target.value as Unidad)} className={claseSelect}>
              <option value="minutos">minutos</option>
              <option value="horas">horas</option>
              <option value="dias">días</option>
            </select>
          </label>
          <Button onClick={() => void guardar()} disabled={!cambiado || enviando}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar
          </Button>
        </div>
        <p className={cn("text-[11px]", fuera ? "text-coral-light" : "text-muted-foreground")}>
          {fuera
            ? `Tiene que estar entre ${duracion(valor.minimo)} y ${duracion(valor.maximo)} (en minutos enteros).`
            : <>Quedaría en <strong className="text-foreground">{duracion(minutos)}</strong>. Límites: de {duracion(valor.minimo)} a {duracion(valor.maximo)}.</>}
        </p>
        {aviso && <AvisoAdmin tipo={aviso.tipo}>{aviso.texto}</AvisoAdmin>}
      </div>
    </Panel>
  );
}
