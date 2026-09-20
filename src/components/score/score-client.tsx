"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Sparkles, RefreshCw, Loader2, AlertTriangle, ChevronDown, ChevronUp, Info, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnonymousId } from "@/hooks/use-anonymous-id";
import { getInforme } from "@/lib/db/informe";
import type { Informe, FactorResultado, Alerta, MetricaType } from "@/lib/ml/tipos";
import { PerfilForm } from "./perfil-form";
import { SEVERIDAD_CLS, formatear } from "@/components/metricas/pronostico-info";

// ─── presentación ─────────────────────────────────────────────────────────────

function getScoreColor(s: number | null) {
  if (s === null) return "#8b949e";
  if (s >= 70) return "#00D4AA";
  if (s >= 45) return "#F0A500";
  return "#FF6B6B";
}

const ESTADO_BADGE: Record<FactorResultado["estado"], { label: string; cls: string }> = {
  normal:      { label: "Normal",    cls: "bg-green/10 text-green border-green/25" },
  atencion:    { label: "Atención",  cls: "bg-amber/10 text-amber border-amber/25" },
  riesgo:      { label: "Riesgo",    cls: "bg-coral/10 text-coral border-coral/25" },
  "sin-datos": { label: "Sin datos", cls: "bg-surface-2 text-muted-foreground border-border" },
};

const EMOJI: Record<FactorResultado["clave"], string> = {
  frecuencia_cardiaca: "❤️",
  horas_sueno:         "😴",
  nivel_estres:        "🧠",
  imc:                 "⚖️",
  tabaquismo:          "🚭",
};

function valorFactor(f: FactorResultado): string {
  if (f.valor === null) return "";
  if (f.clave === "tabaquismo") return f.valor >= 0.5 ? "Fuma" : "No fuma";
  if (f.clave === "imc") return `${f.valor.toFixed(1)} kg/m²`;
  return formatear(f.clave as MetricaType, f.valor);
}

// ─── gauge SVG ────────────────────────────────────────────────────────────────

function ScoreGauge({ score, color }: { score: number | null; color: string }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - (score ?? 0) / 100);

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
        <span className="text-4xl font-bold" style={{ color }}>{score ?? "—"}</span>
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

// ─── tarjeta de factor ────────────────────────────────────────────────────────

function FactorCard({ f }: { f: FactorResultado }) {
  const [verFuente, setVerFuente] = useState(false);
  const badge = ESTADO_BADGE[f.estado];
  const conDatos = f.valor !== null;
  const conservado = conDatos && f.maxPuntos > 0 ? 1 - f.puntosPerdidos / f.maxPuntos : 0;
  const pct = conservado * 100;

  return (
    <div className="rounded-xl border border-border bg-surface p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">{EMOJI[f.clave]}</span>
          <span className="text-sm font-medium truncate">{f.label}</span>
          {f.evidencia === "baja" && conDatos && (
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground border border-border rounded px-1 shrink-0" title="Evidencia débil">
              ev. débil
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {conDatos && <span className="text-xs text-muted-foreground">{valorFactor(f)}</span>}
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
      <div className="flex justify-between items-center">
        <button onClick={() => setVerFuente((v) => !v)} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
          <Info className="h-3 w-3" />
          {conDatos ? "fuente" : "Registrá esta métrica para incluirla"}
          {conDatos && (verFuente ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
        </button>
        {conDatos && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            −{f.puntosPerdidos.toFixed(1)} de {f.maxPuntos.toFixed(1)} pts
          </span>
        )}
      </div>
      {verFuente && conDatos && (
        <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border/50 pt-2">{f.fuente}</p>
      )}
    </div>
  );
}

// ─── componente principal ─────────────────────────────────────────────────────

export function ScoreClient() {
  const uid = useAnonymousId();
  const [informe, setInforme] = useState<Informe | null>(null);
  const [cargando, setCargando] = useState(true);
  const [verComoSeCalcula, setVerComoSeCalcula] = useState(false);

  // análisis IA
  const [analisisTexto, setAnalisisTexto] = useState("");
  const [textoMostrado, setTextoMostrado] = useState("");
  const analisisRef = useRef("");
  const [estadoIA, setEstadoIA] = useState<"idle" | "cargando" | "streaming" | "listo">("idle");

  const cargar = useCallback(async () => {
    if (!uid) return;
    try {
      setInforme(await getInforme(uid));
    } catch {
      setInforme(null);
    } finally {
      setCargando(false);
    }
  }, [uid]);

  useEffect(() => { cargar(); }, [cargar]);

  // typewriter
  useEffect(() => {
    if (textoMostrado.length >= analisisRef.current.length) return;
    const full = analisisRef.current;
    const nextSpace = full.indexOf(" ", textoMostrado.length);
    const nextEnd = nextSpace === -1 ? full.length : nextSpace + 1;
    const t = setTimeout(() => setTextoMostrado(full.slice(0, nextEnd)), 30);
    return () => clearTimeout(t);
  }, [analisisTexto, textoMostrado]);

  const generarAnalisis = useCallback(async () => {
    if (!uid) return;
    setEstadoIA("cargando");
    setAnalisisTexto(""); setTextoMostrado(""); analisisRef.current = "";

    const res = await fetch("/api/score-analisis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid }),
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
        } else if (line.startsWith("3:")) {
          // Parte de error del stream: el modelo no respondió.
          analisisRef.current += "\n*No se pudo generar el análisis: el servicio de IA no respondió. Los números de arriba los calcula el motor y siguen siendo válidos.*";
          setAnalisisTexto(analisisRef.current);
        }
      }
    }
    setEstadoIA("listo");
  }, [uid]);

  if (!uid || cargando) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Calculando tu índice...</span>
      </div>
    );
  }

  const riesgo = informe?.riesgo ?? null;
  const score = riesgo && !riesgo.insuficiente ? riesgo.score : null;
  const color = getScoreColor(score);
  const proy = informe?.proyeccion ?? null;
  const hayMetricas = !!informe && Object.keys(informe.metricas).length > 0;

  const alertas: Alerta[] = informe
    ? Object.values(informe.metricas).flatMap((m) => m.alertas)
    : [];
  const ORDEN: Record<Alerta["severidad"], number> = { alta: 0, atencion: 1, info: 2 };
  alertas.sort((a, b) => ORDEN[a.severidad] - ORDEN[b.severidad]);

  const DeltaIcon = !proy || proy.delta === null || proy.delta === 0 ? Minus : proy.delta > 0 ? TrendingUp : TrendingDown;
  const deltaColor = !proy || proy.delta === null || proy.delta === 0 ? "text-muted-foreground" : proy.delta > 0 ? "text-green" : "text-coral";

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Gauge principal */}
      <div className="rounded-xl border border-border bg-surface p-6 flex flex-col items-center gap-3">
        <ScoreGauge score={score} color={color} />
        <div className="text-center">
          <p className="text-xl font-bold" style={{ color }}>{score !== null ? riesgo?.etiqueta : "Sin datos"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {riesgo && score !== null
              ? `Basado en ${riesgo.cobertura.disponibles} de ${riesgo.cobertura.total} factores`
              : "Registrá al menos dos factores para ver tu índice"}
          </p>
        </div>
        {riesgo && score !== null && (
          <div className="flex flex-wrap justify-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-full border border-border bg-surface-2 text-muted-foreground">
              Riesgo relativo <span className="text-foreground font-semibold">×{(riesgo.riesgoRelativo ?? 1).toFixed(2)}</span> vs. referencia
            </span>
            {riesgo.contexto.multiplicador !== null && (
              <span
                className="px-2.5 py-1 rounded-full border border-border bg-surface-2 text-muted-foreground"
                title={riesgo.contexto.detalle.join(" · ")}
              >
                Contexto edad/sexo <span className="text-foreground font-semibold">×{riesgo.contexto.multiplicador.toFixed(1)}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Perfil */}
      <PerfilForm uid={uid} onGuardado={cargar} />

      {/* Proyección */}
      {hayMetricas && (
        <div className="rounded-xl border border-border bg-surface p-4 flex items-center gap-4">
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2", deltaColor)}>
            <DeltaIcon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Proyección a {proy?.horizonteDias ?? 30} días</p>
            {proy && proy.score !== null && proy.ic80 ? (
              <p className="text-sm">
                <span className="text-xl font-bold" style={{ color: getScoreColor(proy.score) }}>{proy.score}</span>
                <span className="text-muted-foreground"> (80 %: {proy.ic80[0]}–{proy.ic80[1]})</span>
                {proy.delta !== null && proy.delta !== 0 && (
                  <span className={cn("ml-2 font-semibold", deltaColor)}>{proy.delta > 0 ? "+" : ""}{proy.delta} pts</span>
                )}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Todavía no hay pronóstico suficiente: registrá más días.</p>
            )}
            <p className="text-[10px] text-muted-foreground">Si el patrón reciente de tus métricas se mantiene. Calculado con los pronósticos, no estimado por la IA.</p>
          </div>
        </div>
      )}

      {/* Alertas */}
      {alertas.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
            Cambios detectados
          </h3>
          <div className="space-y-1.5">
            {alertas.map((a, i) => (
              <div key={i} className={cn("rounded-lg border px-3 py-2 text-xs flex gap-2", SEVERIDAD_CLS[a.severidad])}>
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="text-foreground/90">{a.mensaje}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Desglose por factor */}
      {riesgo && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
            Desglose por factor
          </h3>
          <div className="space-y-3">
            {riesgo.factores.map((f) => <FactorCard key={f.clave} f={f} />)}
          </div>
        </div>
      )}

      {/* Análisis IA */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Análisis personalizado
        </h3>

        {estadoIA === "idle" && (
          <button
            onClick={generarAnalisis}
            disabled={!hayMetricas}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-purple/30 bg-purple/5 text-purple text-sm font-semibold hover:bg-purple/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Sparkles className="h-4 w-4" />
            Generar análisis con IA
          </button>
        )}

        {estadoIA === "cargando" && (
          <div className="rounded-xl border border-purple/20 bg-purple/5 p-4 flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-purple shrink-0" />
            <span className="text-sm text-muted-foreground">Interpretando tu informe...</span>
          </div>
        )}

        {(estadoIA === "streaming" || estadoIA === "listo") && (
          <div className="rounded-xl border border-purple/20 bg-surface p-4 space-y-1">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-purple" />
                <span className="text-xs font-semibold text-purple">Análisis IA</span>
                <span className="text-[10px] text-muted-foreground">· redacta sobre los números del motor</span>
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

      {/* Cómo se calcula */}
      {informe && (
        <div className="rounded-xl border border-border bg-surface">
          <button
            onClick={() => setVerComoSeCalcula((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-widest"
          >
            <span className="flex items-center gap-2"><Info className="h-3.5 w-3.5" /> Cómo se calcula</span>
            {verComoSeCalcula ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {verComoSeCalcula && (
            <div className="px-4 pb-4 space-y-2 text-xs text-muted-foreground leading-relaxed">
              <p>
                Cada factor aporta un riesgo relativo continuo tomado de meta-análisis publicados (la fuente está en cada tarjeta).
                Se suman en escala logarítmica y el score es 100 menos la fracción del peor caso posible: por eso los puntos
                perdidos por factor suman exactamente lo que le falta al score. La edad y el sexo no entran al score; se muestran como contexto.
              </p>
              <ul className="space-y-1 list-disc pl-4">
                {informe.limitaciones.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Disclaimer */}
      <div className="rounded-xl border border-amber/20 bg-amber/5 p-4 flex gap-3">
        <AlertTriangle className="h-4 w-4 text-amber shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Este índice es una herramienta de bienestar orientativa, no un diagnóstico médico ni una escala clínica validada.
          Consultá siempre con un profesional de la salud ante cualquier síntoma o duda.
        </p>
      </div>

    </div>
  );
}
