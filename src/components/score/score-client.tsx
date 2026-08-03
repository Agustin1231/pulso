"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Sparkles, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnonymousId } from "@/hooks/use-anonymous-id";
import { getUltimasMetricas } from "@/lib/db/metricas";
import type { MetricaRow } from "@/lib/db/types";
import { getEstado, METRICA_MAP, type Estado } from "@/lib/metricas-config";
import type { MetricaType } from "@/lib/db/types";

// ─── cálculo del score ────────────────────────────────────────────────────────

const FACTORES_CONFIG = [
  { tipo: "frecuencia_cardiaca" as MetricaType, label: "Frecuencia Cardíaca", emoji: "❤️", maxPuntos: 35 },
  { tipo: "horas_sueno"         as MetricaType, label: "Horas de Sueño",      emoji: "😴", maxPuntos: 35 },
  { tipo: "nivel_estres"        as MetricaType, label: "Nivel de Estrés",     emoji: "🧠", maxPuntos: 30 },
] as const;

const ESTADO_MULT: Record<Estado, number> = {
  normal:      1.0,
  atencion:    0.55,
  riesgo:      0.15,
  "sin-datos": 0,
};

interface Factor {
  tipo: MetricaType;
  label: string;
  emoji: string;
  maxPuntos: number;
  valor: number | undefined;
  unidad: string;
  estado: Estado;
  puntos: number;
}

function calcularScore(metricas: MetricaRow[]): { score: number; factores: Factor[]; disponibles: number } {
  const mapa: Partial<Record<MetricaType, number>> = {};
  metricas.forEach((m) => { mapa[m.tipo] = m.valor; });

  let totalGanado = 0;
  let totalPosible = 0;

  const factores: Factor[] = FACTORES_CONFIG.map((fc) => {
    const valor = mapa[fc.tipo];
    const estado: Estado = valor !== undefined ? getEstado(fc.tipo, valor) : "sin-datos";
    const puntos = Math.round(fc.maxPuntos * ESTADO_MULT[estado]);
    if (estado !== "sin-datos") { totalGanado += puntos; totalPosible += fc.maxPuntos; }
    return { ...fc, valor, unidad: METRICA_MAP[fc.tipo]?.unidad ?? "", estado, puntos };
  });

  const score = totalPosible > 0 ? Math.round((totalGanado / totalPosible) * 100) : 0;
  return { score, factores, disponibles: factores.filter((f) => f.estado !== "sin-datos").length };
}

function getScoreLabel(s: number) {
  if (s >= 85) return "Excelente";
  if (s >= 70) return "Muy bueno";
  if (s >= 55) return "Bueno";
  if (s >= 40) return "Mejorable";
  return "En riesgo";
}

function getScoreColor(s: number) {
  if (s >= 70) return "#00D4AA";
  if (s >= 45) return "#F0A500";
  return "#FF6B6B";
}

function getEstadoBadge(estado: Estado) {
  const map: Record<Estado, { label: string; cls: string }> = {
    normal:      { label: "Normal",    cls: "bg-green/10 text-green border-green/25" },
    atencion:    { label: "Atención",  cls: "bg-amber/10 text-amber border-amber/25" },
    riesgo:      { label: "Riesgo",    cls: "bg-coral/10 text-coral border-coral/25" },
    "sin-datos": { label: "Sin datos", cls: "bg-surface-2 text-muted-foreground border-border" },
  };
  return map[estado];
}

// ─── gauge SVG ────────────────────────────────────────────────────────────────

function ScoreGauge({ score, color }: { score: number; color: string }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);

  return (
    <div className="relative w-40 h-40">
      <svg className="w-full h-full" style={{ transform: "rotate(-90deg)" }} viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#1c2128" strokeWidth="10" />
        <circle
          cx="60" cy="60" r={r} fill="none"
          stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1.2s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold" style={{ color }}>{score}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest">/ 100</span>
      </div>
    </div>
  );
}

// ─── markdown streaming ───────────────────────────────────────────────────────

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g);
  if (parts.length === 1) return text;
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**"))
          return <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>;
        if (p.startsWith("*") && p.endsWith("*"))
          return <em key={i} className="not-italic text-foreground/70">{p.slice(1, -1)}</em>;
        return p;
      })}
    </>
  );
}

function formatearAnalisis(texto: string) {
  return texto.split("\n").map((linea, i) => {
    if (linea.trim() === "---") return <hr key={i} className="border-border/40 my-3" />;
    if (linea.startsWith("> "))
      return (
        <div key={i} className="border-l-2 border-purple/50 bg-purple/5 pl-3 py-1.5 my-2 rounded-r">
          <p className="text-sm text-foreground/75">{renderInline(linea.slice(2))}</p>
        </div>
      );
    if (linea.startsWith("### "))
      return <h3 key={i} className="text-xs font-semibold text-purple uppercase tracking-widest mt-4 mb-2 first:mt-0">{linea.slice(4)}</h3>;
    if (linea.startsWith("- "))
      return (
        <div key={i} className="flex gap-2 text-sm text-foreground/90 mb-1.5">
          <span className="text-muted-foreground shrink-0 mt-0.5">•</span>
          <span>{renderInline(linea.slice(2))}</span>
        </div>
      );
    if (linea.match(/^\d+\.\s/)) {
      const num = linea.match(/^(\d+)\.\s/)?.[1];
      return (
        <div key={i} className="flex gap-2 text-sm text-foreground/90 mb-1.5">
          <span className="text-purple font-bold shrink-0 min-w-[1.25rem] text-right">{num}.</span>
          <span>{renderInline(linea.replace(/^\d+\.\s/, ""))}</span>
        </div>
      );
    }
    if (linea.startsWith("*") && linea.endsWith("*") && !linea.startsWith("**"))
      return <p key={i} className="text-xs text-muted-foreground mt-3 italic">{linea.slice(1, -1)}</p>;
    if (linea.trim() === "") return <div key={i} className="h-1" />;
    return <p key={i} className="text-sm text-foreground/90 mb-1 leading-relaxed">{renderInline(linea)}</p>;
  });
}

// ─── componente principal ─────────────────────────────────────────────────────

export function ScoreClient() {
  const uid = useAnonymousId();
  const [metricas, setMetricas] = useState<MetricaRow[]>([]);
  const [cargando, setCargando] = useState(true);

  // análisis IA
  const [analisisTexto, setAnalisisTexto] = useState("");
  const [textoMostrado, setTextoMostrado] = useState("");
  const analisisRef = useRef("");
  const [estadoIA, setEstadoIA] = useState<"idle" | "cargando" | "streaming" | "listo">("idle");

  useEffect(() => {
    if (!uid) return;
    getUltimasMetricas(uid).then((data) => { setMetricas(data); setCargando(false); });
  }, [uid]);

  // typewriter
  useEffect(() => {
    if (textoMostrado.length >= analisisRef.current.length) return;
    const full = analisisRef.current;
    const nextSpace = full.indexOf(" ", textoMostrado.length);
    const nextEnd = nextSpace === -1 ? full.length : nextSpace + 1;
    const t = setTimeout(() => setTextoMostrado(full.slice(0, nextEnd)), 30);
    return () => clearTimeout(t);
  }, [analisisTexto, textoMostrado]);

  const generarAnalisis = useCallback(async (factores: Factor[], score: number) => {
    setEstadoIA("cargando");
    setAnalisisTexto(""); setTextoMostrado(""); analisisRef.current = "";

    const res = await fetch("/api/score-analisis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score, factores }),
    });

    if (!res.ok || !res.body) { setEstadoIA("idle"); return; }

    setEstadoIA("streaming");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith('0:"')) {
          const chunk = line.slice(3, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
          analisisRef.current += chunk;
          setAnalisisTexto(analisisRef.current);
        }
      }
    }
    setEstadoIA("listo");
  }, []);

  if (!uid || cargando) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Cargando score...</span>
      </div>
    );
  }

  const { score, factores, disponibles } = calcularScore(metricas);
  const color = getScoreColor(score);
  const label = getScoreLabel(score);

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Gauge principal */}
      <div className="rounded-xl border border-border bg-surface p-6 flex flex-col items-center gap-3">
        <ScoreGauge score={disponibles > 0 ? score : 0} color={color} />
        <div className="text-center">
          <p className="text-xl font-bold" style={{ color }}>{disponibles > 0 ? label : "Sin datos"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {disponibles > 0
              ? `Basado en ${disponibles} de ${FACTORES_CONFIG.length} métricas`
              : "Registra tus métricas para ver tu score"}
          </p>
        </div>
      </div>

      {/* Desglose por factor */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Desglose por factor
        </h3>
        <div className="space-y-3">
          {factores.map((f) => {
            const badge = getEstadoBadge(f.estado);
            const pct = f.estado !== "sin-datos" ? (f.puntos / f.maxPuntos) * 100 : 0;
            return (
              <div key={f.tipo} className="rounded-xl border border-border bg-surface p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{f.emoji}</span>
                    <span className="text-sm font-medium">{f.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {f.estado !== "sin-datos" && (
                      <span className="text-xs text-muted-foreground">
                        {f.tipo === "horas_sueno"
                          ? `${Math.floor(f.valor!)}h ${Math.round((f.valor! % 1) * 60)}m`
                          : `${f.tipo === "nivel_estres" ? f.valor : f.valor} ${f.unidad}`}
                      </span>
                    )}
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", badge.cls)}>
                      {badge.label}
                    </span>
                  </div>
                </div>
                <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: pct >= 70 ? "#00D4AA" : pct >= 40 ? "#F0A500" : "#FF6B6B" }}
                  />
                </div>
                <div className="flex justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    {f.estado === "sin-datos" ? "Registra esta métrica para incluirla" : ""}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{f.puntos}/{f.maxPuntos} pts</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Análisis IA */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Análisis personalizado
        </h3>

        {estadoIA === "idle" && (
          <button
            onClick={() => generarAnalisis(factores, score)}
            disabled={disponibles === 0}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-purple/30 bg-purple/5 text-purple text-sm font-semibold hover:bg-purple/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Sparkles className="h-4 w-4" />
            Generar análisis con IA
          </button>
        )}

        {estadoIA === "cargando" && (
          <div className="rounded-xl border border-purple/20 bg-purple/5 p-4 flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-purple shrink-0" />
            <span className="text-sm text-muted-foreground">Analizando tus métricas...</span>
          </div>
        )}

        {(estadoIA === "streaming" || estadoIA === "listo") && (
          <div className="rounded-xl border border-purple/20 bg-surface p-4 space-y-1">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-purple" />
                <span className="text-xs font-semibold text-purple">Análisis IA</span>
              </div>
              {estadoIA === "listo" && (
                <button
                  onClick={() => { setEstadoIA("idle"); setTextoMostrado(""); analisisRef.current = ""; }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="space-y-0.5">
              {formatearAnalisis(textoMostrado)}
              {estadoIA === "streaming" && (
                <span className="inline-block w-0.5 h-3.5 bg-purple animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="rounded-xl border border-amber/20 bg-amber/5 p-4 flex gap-3">
        <AlertTriangle className="h-4 w-4 text-amber shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Este score es una herramienta de bienestar orientativa, no un diagnóstico médico.
          Consulta siempre con un profesional de la salud ante cualquier síntoma o duda.
        </p>
      </div>

    </div>
  );
}
