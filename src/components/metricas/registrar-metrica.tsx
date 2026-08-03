"use client";

import { useState } from "react";
import { Plus, X, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { METRICAS } from "@/lib/metricas-config";
import { guardarMetrica } from "@/lib/db/metricas";
import type { MetricaType } from "@/lib/db/types";

interface Props {
  uid:       string;
  onGuardar: () => void;
}

export function RegistrarMetrica({ uid, onGuardar }: Props) {
  const [abierto, setAbierto]     = useState(false);
  const [valores, setValores]     = useState<Partial<Record<MetricaType, string>>>({});
  const [suenoH, setSuenoH]       = useState("");   // horas de sueño (parte entera)
  const [suenoM, setSuenoM]       = useState("");   // minutos de sueño
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk]               = useState(false);

  function cambiarValor(tipo: MetricaType, val: string) {
    setValores((prev) => ({ ...prev, [tipo]: val }));
  }

  async function guardar() {
    // Métricas normales (excluyendo sueño)
    const entradas = METRICAS.filter((m) => {
      if (m.tipo === "horas_sueno") return false;
      const v = valores[m.tipo];
      return v !== undefined && v !== "" && !isNaN(Number(v));
    });

    // Sueño como decimal
    const tieneSueno = suenoH !== "" || suenoM !== "";
    const valorSueno = (parseFloat(suenoH) || 0) + (parseFloat(suenoM) || 0) / 60;

    if (entradas.length === 0 && !tieneSueno) return;

    setGuardando(true);
    for (const m of entradas) {
      await guardarMetrica(uid, m.tipo, Number(valores[m.tipo]), m.unidad);
    }
    if (tieneSueno && valorSueno > 0) {
      await guardarMetrica(uid, "horas_sueno", valorSueno, "h");
    }
    setGuardando(false);
    setOk(true);
    setValores({});
    setSuenoH("");
    setSuenoM("");
    setTimeout(() => {
      setOk(false);
      setAbierto(false);
      onGuardar();
    }, 1200);
  }

  const hayValores =
    METRICAS.some((m) => {
      if (m.tipo === "horas_sueno") return false;
      return valores[m.tipo] !== undefined && valores[m.tipo] !== "";
    }) || suenoH !== "" || suenoM !== "";

  if (!abierto) {
    return (
      <Button className="w-full gap-2" onClick={() => setAbierto(true)}>
        <Plus className="h-4 w-4" />
        Registrar métricas de hoy
      </Button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-2">
        <div>
          <p className="text-sm font-bold">Registrar métricas</p>
          <p className="text-xs text-muted-foreground">Completa solo las que tengas disponibles</p>
        </div>
        <button onClick={() => setAbierto(false)} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Campos */}
      <div className="p-4 grid grid-cols-2 gap-3">
        {METRICAS.map((m) => {
          // Input especial para horas de sueño (h + min)
          if (m.tipo === "horas_sueno") {
            return (
              <div key={m.tipo} className="col-span-2 space-y-1">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <span>{m.emoji}</span> {m.label}
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={23}
                      step={1}
                      placeholder="7"
                      value={suenoH}
                      onChange={(e) => setSuenoH(e.target.value)}
                      className={cn(
                        "w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-foreground",
                        "placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-coral pr-9"
                      )}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">h</span>
                  </div>
                  <div className="relative flex-1">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={59}
                      step={1}
                      placeholder="30"
                      value={suenoM}
                      onChange={(e) => setSuenoM(e.target.value)}
                      className={cn(
                        "w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-foreground",
                        "placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-coral pr-12"
                      )}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">min</span>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={m.tipo} className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <span>{m.emoji}</span> {m.label}
              </label>
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  min={m.min}
                  max={m.max}
                  step={m.paso}
                  placeholder="—"
                  value={valores[m.tipo] ?? ""}
                  onChange={(e) => cambiarValor(m.tipo, e.target.value)}
                  className={cn(
                    "w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-foreground",
                    "placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-coral pr-10"
                  )}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  {m.unidad}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 pb-4">
        <Button className="w-full" onClick={guardar} disabled={!hayValores || guardando || ok}>
          {ok ? (
            <><Check className="h-4 w-4" /> Guardado</>
          ) : guardando ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Guardando...</>
          ) : (
            "Guardar"
          )}
        </Button>
      </div>
    </div>
  );
}
