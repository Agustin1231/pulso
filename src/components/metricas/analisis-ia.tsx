"use client";

import { useState, useEffect, useRef } from "react";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getEstado, ESTADO_LABEL, METRICA_MAP } from "@/lib/metricas-config";
import type { MetricaRow } from "@/lib/db/types";

// ─── helpers markdown (mismo estilo que recetas) ─────────────────────────────

function renderInline(text: string): React.ReactNode {
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

function formatearContenido(texto: string): React.ReactNode {
  const lineas = texto.split("\n").filter((l) => !l.match(/^#\s/));
  return lineas.map((linea, i) => {
    if (linea.trim() === "---")
      return <hr key={i} className="border-border/40 my-3" />;
    if (linea.startsWith("> "))
      return (
        <div key={i} className="border-l-2 border-purple/50 bg-purple/5 pl-3 py-1.5 my-2 rounded-r">
          <p className="text-sm text-foreground/75">{renderInline(linea.slice(2))}</p>
        </div>
      );
    if (linea.startsWith("## "))
      return <h2 key={i} className="text-lg font-bold text-foreground mt-4 mb-2 first:mt-0">{linea.slice(3)}</h2>;
    if (linea.startsWith("### "))
      return <h3 key={i} className="text-sm font-semibold text-purple uppercase tracking-widest mt-4 mb-2">{linea.slice(4)}</h3>;
    if (linea.match(/^\*\*.+\*\*$/) && !linea.slice(2, -2).includes("**")) {
      const inner = linea.slice(2, -2);
      if (inner.includes("|")) {
        return (
          <p key={i} className="text-sm text-muted-foreground mb-2 flex gap-3 flex-wrap">
            {inner.split("|").map((c, j) => <span key={j}>{renderInline(c.trim())}</span>)}
          </p>
        );
      }
      return <p key={i} className="text-sm font-semibold text-foreground mb-1">{inner}</p>;
    }
    if (linea.startsWith("- "))
      return (
        <div key={i} className="flex gap-2 text-sm text-foreground/90 mb-1">
          <span className="text-muted-foreground shrink-0 mt-0.5">•</span>
          <span>{renderInline(linea.slice(2))}</span>
        </div>
      );
    if (linea.match(/^\d+\.\s/)) {
      const num = linea.match(/^(\d+)\.\s/)?.[1];
      const content = linea.replace(/^\d+\.\s/, "");
      return (
        <div key={i} className="flex gap-2 text-sm text-foreground/90 mb-1.5">
          <span className="text-purple font-bold shrink-0 min-w-[1.25rem] text-right">{num}.</span>
          <span>{renderInline(content)}</span>
        </div>
      );
    }
    if (linea.trim() === "") return <div key={i} className="h-1" />;
    return <p key={i} className="text-sm text-foreground/90 mb-1 leading-relaxed">{renderInline(linea)}</p>;
  });
}

// ─── componente ───────────────────────────────────────────────────────────────

interface Props {
  metricas: MetricaRow[];
}

export function AnalisisIA({ metricas }: Props) {
  const [textoCompleto, setTextoCompleto] = useState("");
  const [textoMostrado, setTextoMostrado] = useState("");
  const textoRef = useRef("");
  const [loading, setLoading] = useState(false);
  const [listo, setListo] = useState(false);

  // ── typewriter ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (textoMostrado.length >= textoRef.current.length) return;
    const full = textoRef.current;
    const nextSpace = full.indexOf(" ", textoMostrado.length);
    const nextEnd = nextSpace === -1 ? full.length : nextSpace + 1;
    const timer = setTimeout(() => setTextoMostrado(full.slice(0, nextEnd)), 35);
    return () => clearTimeout(timer);
  }, [textoCompleto, textoMostrado]);

  const escribiendo = textoMostrado.length < textoRef.current.length || loading;
  const hayContenido = textoMostrado.length > 0;

  async function analizar() {
    if (metricas.length === 0) return;
    setLoading(true);
    setTextoCompleto("");
    setTextoMostrado("");
    textoRef.current = "";
    setListo(false);

    const payload = metricas.map((m) => ({
      label:  METRICA_MAP[m.tipo]?.label ?? m.tipo,
      valor:  m.valor,
      unidad: m.unidad,
      estado: ESTADO_LABEL[getEstado(m.tipo, m.valor)],
    }));

    try {
      const res = await fetch("/api/analisis-metricas", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ metricas: payload }),
      });

      if (!res.ok || !res.body) throw new Error("Error al conectar con la IA");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acumulado = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("0:")) {
            try {
              const chunk = JSON.parse(line.slice(2));
              if (typeof chunk === "string") {
                acumulado += chunk;
                textoRef.current = acumulado;
                setTextoCompleto(acumulado);
              }
            } catch { /* ignorar líneas malformadas */ }
          }
        }
      }

      setListo(true);
    } catch {
      const err = "No se pudo conectar con el análisis. Verifica tu conexión e intenta de nuevo.";
      textoRef.current = err;
      setTextoCompleto(err);
      setListo(true);
    } finally {
      setLoading(false);
    }
  }

  if (metricas.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 text-center text-sm text-muted-foreground">
        Registra al menos una métrica para obtener tu análisis personalizado.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-purple/30 bg-purple/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-purple/20">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple" />
          <span className="text-sm font-bold text-purple">Análisis personalizado</span>
        </div>
        {hayContenido && (
          <button
            onClick={analizar}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Regenerar análisis"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="p-4">
        {/* Estado inicial */}
        {!hayContenido && !loading && (
          <div className="text-center space-y-3">
            <p className="text-xs text-muted-foreground">
              La IA analiza tus métricas y te da recomendaciones personalizadas.
            </p>
            <Button variant="ghost" className="gap-2 text-purple border border-purple/30" onClick={analizar}>
              <Sparkles className="h-4 w-4" />
              Analizar mis métricas
            </Button>
          </div>
        )}

        {/* Spinner inicial (antes de que llegue texto) */}
        {loading && !hayContenido && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-purple" />
            Analizando tus métricas...
          </div>
        )}

        {/* Contenido con markdown + typewriter */}
        {hayContenido && (
          <div>
            {formatearContenido(textoMostrado)}
            {escribiendo && (
              <span className="inline-block w-0.5 h-4 bg-purple ml-0.5 animate-blink align-middle" />
            )}
          </div>
        )}

        {/* Disclaimer */}
        {listo && !escribiendo && (
          <p className="mt-3 text-[10px] text-muted-foreground border-t border-border/50 pt-2">
            ⚕️ Orientación educativa — no reemplaza la consulta médica.
          </p>
        )}
      </div>
    </div>
  );
}
