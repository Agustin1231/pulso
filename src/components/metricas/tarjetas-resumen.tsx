"use client";

import { useState } from "react";
import { Pencil, X, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  METRICAS,
  getEstado,
  ESTADO_COLORS,
  ESTADO_BG,
  ESTADO_LABEL,
  type MetricaConfig,
} from "@/lib/metricas-config";
import { guardarMetrica } from "@/lib/db/metricas";
import type { MetricaRow, MetricaType } from "@/lib/db/types";

interface Props {
  metricas:      MetricaRow[];
  uid:           string;
  onSelect:      (tipo: MetricaType) => void;
  seleccion:     MetricaType | null;
  onActualizar:  () => void;
}

export function TarjetasResumen({ metricas, uid, onSelect, seleccion, onActualizar }: Props) {
  const mapaUltimas = Object.fromEntries(metricas.map((m) => [m.tipo, m.valor]));

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {METRICAS.map((cfg) => (
        <MetricaCard
          key={cfg.tipo}
          cfg={cfg}
          valor={mapaUltimas[cfg.tipo]}
          uid={uid}
          activa={seleccion === cfg.tipo}
          onSelect={onSelect}
          onActualizar={onActualizar}
        />
      ))}
    </div>
  );
}

// ─── tarjeta individual con edición inline ────────────────────────────────────

function MetricaCard({
  cfg, valor, uid, activa, onSelect, onActualizar,
}: {
  cfg:          MetricaConfig;
  valor:        number | undefined;
  uid:          string;
  activa:       boolean;
  onSelect:     (tipo: MetricaType) => void;
  onActualizar: () => void;
}) {
  const [editando,  setEditando]  = useState(false);
  const [input,     setInput]     = useState("");
  const [suenoH,    setSuenoH]    = useState("");
  const [suenoM,    setSuenoM]    = useState("");
  const [guardando, setGuardando] = useState(false);
  const [guardado,  setGuardado]  = useState(false);

  const tieneData = valor !== undefined;
  const estado    = tieneData ? getEstado(cfg.tipo, valor) : "sin-datos";

  function abrirEdicion(e: React.MouseEvent) {
    e.stopPropagation();
    if (cfg.tipo === "horas_sueno" && valor !== undefined) {
      setSuenoH(String(Math.floor(valor)));
      setSuenoM(String(Math.round((valor - Math.floor(valor)) * 60)));
    } else {
      setInput(valor !== undefined ? String(cfg.paso < 1 ? valor.toFixed(1) : Math.round(valor)) : "");
    }
    setEditando(true);
  }

  async function handleGuardar(e: React.MouseEvent) {
    e.stopPropagation();
    setGuardando(true);

    let valorNum: number;
    if (cfg.tipo === "horas_sueno") {
      valorNum = (parseFloat(suenoH) || 0) + (parseFloat(suenoM) || 0) / 60;
    } else {
      valorNum = parseFloat(input);
    }

    if (!isNaN(valorNum) && valorNum >= 0) {
      await guardarMetrica(uid, cfg.tipo, valorNum, cfg.unidad);
      setGuardado(true);
      setTimeout(() => {
        setGuardado(false);
        setEditando(false);
        onActualizar();
      }, 800);
    }
    setGuardando(false);
  }

  function cancelar(e: React.MouseEvent) {
    e.stopPropagation();
    setEditando(false);
  }

  // ── vista edición ────────────────────────────────────────────────
  if (editando) {
    return (
      <div className="rounded-xl border border-coral/40 bg-surface p-3 space-y-2.5 animate-fade-in">
        {/* Header edit */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            {cfg.emoji} {cfg.label}
          </span>
          <button onClick={cancelar} className="text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Input(s) */}
        {cfg.tipo === "horas_sueno" ? (
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <input
                type="number" inputMode="numeric"
                min={0} max={23} placeholder="7"
                value={suenoH}
                onChange={(e) => setSuenoH(e.target.value)}
                autoFocus
                className="w-full rounded-lg bg-surface-2 border border-border px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-coral pr-6"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">h</span>
            </div>
            <div className="relative flex-1">
              <input
                type="number" inputMode="numeric"
                min={0} max={59} placeholder="30"
                value={suenoM}
                onChange={(e) => setSuenoM(e.target.value)}
                className="w-full rounded-lg bg-surface-2 border border-border px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-coral pr-8"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">min</span>
            </div>
          </div>
        ) : (
          <div className="relative">
            <input
              type="number" inputMode="decimal"
              min={cfg.min} max={cfg.max} step={cfg.paso}
              placeholder={String(cfg.min)}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
              className="w-full rounded-lg bg-surface-2 border border-border px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-coral pr-10"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{cfg.unidad}</span>
          </div>
        )}

        {/* Guardar */}
        <button
          onClick={handleGuardar}
          disabled={guardando || guardado}
          className={cn(
            "w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
            guardado
              ? "bg-green/15 text-green border border-green/30"
              : "bg-coral/10 text-coral border border-coral/30 hover:bg-coral/20"
          )}
        >
          {guardado ? (
            <><Check className="h-3.5 w-3.5" /> Guardado</>
          ) : guardando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            "Guardar"
          )}
        </button>
      </div>
    );
  }

  // ── vista normal ─────────────────────────────────────────────────
  return (
    <div
      onClick={() => onSelect(cfg.tipo)}
      className={cn(
        "rounded-xl border p-3 text-left transition-all duration-200 cursor-pointer active:scale-95 group relative",
        activa
          ? "border-coral/50 bg-coral/8 ring-1 ring-coral/30"
          : "border-border bg-surface hover:border-border/80 hover:bg-surface-2"
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-xl">{cfg.emoji}</span>
        <div className="flex items-center gap-1">
          <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", ESTADO_BG[estado])}>
            {ESTADO_LABEL[estado]}
          </span>
          {/* Botón editar — siempre visible en mobile, hover en desktop */}
          <button
            onClick={abrirEdicion}
            title="Editar"
            className="text-muted-foreground/0 group-hover:text-muted-foreground hover:text-foreground transition-colors ml-0.5 touch-manipulation"
            style={{ WebkitTapHighlightColor: "transparent" }}
          >
            <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 md:block hidden transition-opacity" />
            {/* En mobile siempre visible */}
            <Pencil className="h-3 w-3 md:hidden text-muted-foreground/50" />
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-0.5 truncate">{cfg.label}</p>

      {tieneData ? (
        <p className={cn("text-lg font-bold leading-none", ESTADO_COLORS[estado])}>
          {cfg.tipo === "horas_sueno" ? (
            <>
              {Math.floor(valor)}
              <span className="text-xs font-normal text-muted-foreground">h </span>
              {Math.round((valor - Math.floor(valor)) * 60)}
              <span className="text-xs font-normal text-muted-foreground">m</span>
            </>
          ) : (
            <>
              {cfg.paso < 1 ? valor.toFixed(1) : Math.round(valor)}
              <span className="text-xs font-normal text-muted-foreground ml-1">{cfg.unidad}</span>
            </>
          )}
        </p>
      ) : (
        <p className="text-sm font-medium text-muted-foreground">Toca para editar</p>
      )}
    </div>
  );
}
