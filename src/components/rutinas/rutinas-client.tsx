"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
import {
  Dumbbell, Sparkles, RefreshCw, Loader2, ChevronRight,
  Bookmark, BookOpen, Trash2, ArrowLeft, Moon, Brain,
  Play, CheckCircle, SkipForward, Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnonymousId } from "@/hooks/use-anonymous-id";
import { getUltimasMetricas } from "@/lib/db/metricas";
import {
  guardarRutina, getRutinasGuardadas, eliminarRutina,
} from "@/lib/db/rutinas";
import type { RutinaRow, Ejercicio } from "@/lib/db/types";

// ─── parser de ejercicios ─────────────────────────────────────────────────────

function parsearEjercicios(texto: string): Ejercicio[] {
  const ejercicios: Ejercicio[] = [];
  let bloqueActual = "";
  const lineas = texto.split("\n");

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (linea.startsWith("### ")) {
      bloqueActual = linea.slice(4).replace(/\(.*\)/, "").trim();
      continue;
    }
    // Formato: "N. **Nombre** | detalle | Descanso: X seg"
    const match = linea.match(/^\d+\.\s+\*\*(.+?)\*\*\s*\|\s*(.+?)\s*\|\s*Descanso:\s*(\d+)/i);
    if (match) {
      const sig = lineas[i + 1]?.trim() ?? "";
      const descripcion = sig && !sig.match(/^\d+\./) && !sig.startsWith("#") && !sig.startsWith("*") && !sig.startsWith(">") ? sig : undefined;
      ejercicios.push({
        bloque: bloqueActual,
        nombre: match[1].trim(),
        detalle: match[2].trim(),
        descanso: parseInt(match[3]),
        descripcion,
      });
    }
  }
  return ejercicios;
}

// ─── helpers markdown ─────────────────────────────────────────────────────────

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
    if (linea.trim() === "---") return <hr key={i} className="border-border/40 my-3" />;
    if (linea.startsWith("> "))
      return (
        <div key={i} className="border-l-2 border-coral/50 bg-coral/5 pl-3 py-1.5 my-2 rounded-r">
          <p className="text-sm text-foreground/75">{renderInline(linea.slice(2))}</p>
        </div>
      );
    if (linea.startsWith("## "))
      return <h2 key={i} className="text-lg font-bold text-foreground mt-4 mb-2 first:mt-0">{linea.slice(3)}</h2>;
    if (linea.startsWith("### "))
      return <h3 key={i} className="text-sm font-semibold text-coral uppercase tracking-widest mt-4 mb-2">{linea.slice(4)}</h3>;
    if (linea.match(/^\*\*.+\*\*$/) && !linea.slice(2, -2).includes("**")) {
      const inner = linea.slice(2, -2);
      if (inner.includes("|"))
        return (
          <p key={i} className="text-sm text-muted-foreground mb-2 flex gap-3 flex-wrap">
            {inner.split("|").map((c, j) => <span key={j}>{renderInline(c.trim())}</span>)}
          </p>
        );
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
          <span className="text-coral font-bold shrink-0 min-w-[1.25rem] text-right">{num}.</span>
          <span>{renderInline(content)}</span>
        </div>
      );
    }
    if (linea.trim() === "") return <div key={i} className="h-1" />;
    return <p key={i} className="text-sm text-foreground/90 mb-1 leading-relaxed">{renderInline(linea)}</p>;
  });
}

function extraerNombre(texto: string): string {
  const match = texto.match(/^##\s+(.+)/m);
  return match?.[1]?.trim() ?? "Rutina cardiovascular";
}

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

// ─── tipos ────────────────────────────────────────────────────────────────────

const PASOS = [
  {
    id: "nivel" as const,
    pregunta: "¿Cuál es tu nivel de actividad actual?",
    opciones: [
      { valor: "Sedentario (poco o nada de ejercicio)", etiqueta: "Sedentario", desc: "Poco o nada de ejercicio" },
      { valor: "Algo activo (camino regularmente)", etiqueta: "Algo activo", desc: "Camino regularmente" },
      { valor: "Activo (ejercicio 2-3 veces por semana)", etiqueta: "Activo", desc: "2-3 veces por semana" },
    ],
  },
  {
    id: "tiempo" as const,
    pregunta: "¿Cuánto tiempo tienes disponible?",
    opciones: [
      { valor: "15", etiqueta: "15 min", desc: "Sesión rápida" },
      { valor: "30", etiqueta: "30 min", desc: "Sesión estándar" },
      { valor: "45", etiqueta: "45 min", desc: "Sesión completa" },
      { valor: "60", etiqueta: "60 min", desc: "Sesión larga" },
    ],
  },
  {
    id: "lugar" as const,
    pregunta: "¿Dónde vas a entrenar?",
    opciones: [
      { valor: "En casa sin equipamiento", etiqueta: "En casa", desc: "Sin equipamiento" },
      { valor: "Gimnasio con máquinas", etiqueta: "Gimnasio", desc: "Con máquinas" },
      { valor: "Al aire libre", etiqueta: "Al aire libre", desc: "Parque o calle" },
    ],
  },
  {
    id: "limitacion" as const,
    pregunta: "¿Tienes alguna limitación física?",
    opciones: [
      { valor: "Ninguna limitación", etiqueta: "Ninguna", desc: "Sin restricciones" },
      { valor: "Problemas en rodillas o piernas", etiqueta: "Rodillas/piernas", desc: "Evitar impacto" },
      { valor: "Problemas en espalda o lumbar", etiqueta: "Espalda", desc: "Cuidar lumbar" },
      { valor: "Problemas en hombros o brazos", etiqueta: "Hombros/brazos", desc: "Cuidar tren superior" },
    ],
  },
] as const;

type PasoId = (typeof PASOS)[number]["id"];
type Respuestas = Partial<Record<PasoId, string>>;
type Vista = "nueva" | "guardadas";
type EstadoGen = "idle" | "streaming" | "completo";

// ─── componente principal ─────────────────────────────────────────────────────

export function RutinasClient() {
  const uid = useAnonymousId();
  const [vista, setVista] = useState<Vista>("nueva");
  const [sueno, setSueno] = useState<number | undefined>();
  const [estres, setEstres] = useState<number | undefined>();

  const [paso, setPaso] = useState(0);
  const [respuestas, setRespuestas] = useState<Respuestas>({});

  const [estado, setEstado] = useState<EstadoGen>("idle");
  const [rutinaTexto, setRutinaTexto] = useState("");
  const [textoMostrado, setTextoMostrado] = useState("");
  const rutinaRef = useRef("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardada, setGuardada] = useState(false);

  const [guardadas, setGuardadas] = useState<RutinaRow[]>([]);
  const [cargandoGuardadas, setCargandoGuardadas] = useState(false);
  const [rutinaDetalle, setRutinaDetalle] = useState<RutinaRow | null>(null);

  useEffect(() => {
    if (!uid) return;
    getUltimasMetricas(uid).then((metricas) => {
      const s = metricas.find((m) => m.tipo === "horas_sueno");
      const e = metricas.find((m) => m.tipo === "nivel_estres");
      if (s) setSueno(Math.round(Number(s.valor) * 10) / 10);
      if (e) setEstres(Math.round(Number(e.valor)));
    });
  }, [uid]);

  const cargarGuardadas = useCallback(async () => {
    if (!uid) return;
    setCargandoGuardadas(true);
    setGuardadas(await getRutinasGuardadas(uid));
    setCargandoGuardadas(false);
  }, [uid]);

  // typewriter
  useEffect(() => {
    if (textoMostrado.length >= rutinaRef.current.length) return;
    const full = rutinaRef.current;
    const nextSpace = full.indexOf(" ", textoMostrado.length);
    const nextEnd = nextSpace === -1 ? full.length : nextSpace + 1;
    const timer = setTimeout(() => setTextoMostrado(full.slice(0, nextEnd)), 35);
    return () => clearTimeout(timer);
  }, [rutinaTexto, textoMostrado]);

  const escribiendo = textoMostrado.length < rutinaRef.current.length || estado === "streaming";
  const hayContenido = textoMostrado.length > 0;

  const seleccionar = (pasoId: PasoId, valor: string) => {
    const nuevas = { ...respuestas, [pasoId]: valor };
    setRespuestas(nuevas);
    if (paso < PASOS.length - 1) setPaso(paso + 1);
    else generarRutina(nuevas);
  };

  const generarRutina = useCallback(async (r: Respuestas) => {
    setEstado("streaming");
    setRutinaTexto(""); setTextoMostrado(""); rutinaRef.current = "";
    setGuardada(false); setError(null);

    try {
      const res = await fetch("/api/rutinas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nivel: r.nivel, tiempo: r.tiempo, lugar: r.lugar, limitacion: r.limitacion,
          metricas: { sueno, estres },
          historial_count: guardadas.length,
          ejercicios_previos: guardadas
            .slice(0, 5)
            .flatMap((r) => r.contenido.ejercicios?.map((e) => e.nombre) ?? [])
            .filter((n, i, arr) => arr.indexOf(n) === i),
        }),
      });
      if (!res.ok || !res.body) throw new Error("Error al conectar con el asistente");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", textoCompleto = "";

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
                textoCompleto += chunk;
                rutinaRef.current = textoCompleto;
                setRutinaTexto(textoCompleto);
              }
            } catch { /* skip */ }
          }
        }
      }
      setEstado("completo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
      setEstado("idle");
    }
  }, [sueno, estres, guardadas.length]);

  const handleGuardar = async () => {
    if (!uid || !rutinaTexto || guardando || guardada) return;
    setGuardando(true);
    const nombre = extraerNombre(rutinaTexto);
    const ejercicios = parsearEjercicios(rutinaTexto);
    const contenido = {
      texto: rutinaTexto,
      nivel: respuestas.nivel ?? "",
      tiempo: respuestas.tiempo ?? "",
      lugar: respuestas.lugar ?? "",
      limitacion: respuestas.limitacion ?? "",
      metricas: { sueno, estres },
      ejercicios,
    };
    const { error: err } = await guardarRutina(uid, nombre, contenido);
    if (!err) {
      setGuardada(true);
      setGuardadas((prev) => [{
        id: Date.now().toString(), uid, nombre, contenido, activa: true,
        created_at: new Date().toISOString(),
      }, ...prev]);
    }
    setGuardando(false);
  };

  const handleEliminar = async (id: string) => {
    await eliminarRutina(id);
    setGuardadas((prev) => prev.filter((r) => r.id !== id));
    if (rutinaDetalle?.id === id) setRutinaDetalle(null);
  };

  const resetear = () => {
    setPaso(0); setRespuestas({}); setEstado("idle");
    setRutinaTexto(""); setTextoMostrado(""); rutinaRef.current = "";
    setGuardada(false); setError(null);
  };

  const banners: { icon: React.ReactNode; texto: string; color: string }[] = [];
  if (sueno !== undefined && sueno < 7)
    banners.push({ icon: <Moon className="h-3.5 w-3.5" />, texto: `Dormiste ${fmt(sueno)}h — la rutina será de menor intensidad para que tu cuerpo recupere.`, color: "border-teal/30 bg-teal/5 text-teal" });
  if (estres !== undefined && estres > 5)
    banners.push({ icon: <Brain className="h-3.5 w-3.5" />, texto: `Estrés en ${estres}/10 — incluiremos ejercicios que reducen el cortisol.`, color: "border-amber/30 bg-amber/5 text-amber" });

  const semana = Math.floor(guardadas.length / 3) + 1;

  // Vista detalle / guiada
  if (rutinaDetalle) {
    return (
      <Portal>
        <RutinaGuiada
          rutina={rutinaDetalle}
          onCerrar={() => setRutinaDetalle(null)}
          onEliminar={() => handleEliminar(rutinaDetalle.id)}
        />
      </Portal>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-surface p-1 border border-border w-fit">
        <button
          onClick={() => setVista("nueva")}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${vista === "nueva" ? "bg-coral/15 text-coral border border-coral/30" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Dumbbell className="h-3.5 w-3.5" /> Nueva rutina
        </button>
        <button
          onClick={() => { setVista("guardadas"); cargarGuardadas(); }}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${vista === "guardadas" ? "bg-coral/15 text-coral border border-coral/30" : "text-muted-foreground hover:text-foreground"}`}
        >
          <BookOpen className="h-3.5 w-3.5" /> Mis rutinas
          {guardadas.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-coral/20 text-coral font-bold">{guardadas.length}</span>
          )}
        </button>
      </div>

      {/* ── Nueva rutina ───────────────────────────────────────────────────── */}
      {vista === "nueva" && (
        <div className="space-y-4">
          {estado === "idle" && banners.map((b, i) => (
            <div key={i} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs ${b.color}`}>
              {b.icon}<span>{b.texto}</span>
            </div>
          ))}

          {estado === "idle" && guardadas.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="px-2 py-0.5 rounded-full bg-coral/10 text-coral border border-coral/20 font-semibold">Semana {semana}</span>
              <span>{guardadas.length} rutina{guardadas.length !== 1 ? "s" : ""} completada{guardadas.length !== 1 ? "s" : ""}</span>
            </div>
          )}

          {estado === "idle" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {PASOS.map((_, i) => (
                  <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i < paso ? "bg-coral" : i === paso ? "bg-coral/50" : "bg-border"}`} />
                ))}
              </div>
              <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
                <span className="text-xs font-semibold text-coral uppercase tracking-widest">{paso + 1} / {PASOS.length}</span>
                <p className="text-base font-semibold text-foreground">{PASOS[paso].pregunta}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {PASOS[paso].opciones.map((op) => (
                    <button
                      key={op.valor}
                      onClick={() => seleccionar(PASOS[paso].id, op.valor)}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3 text-left transition-all hover:border-coral/40 hover:bg-coral/5 group"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{op.etiqueta}</p>
                        <p className="text-xs text-muted-foreground">{op.desc}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-coral transition-colors shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
              {paso > 0 && (
                <div className="flex flex-wrap gap-2">
                  {PASOS.slice(0, paso).map((p) => (
                    <span key={p.id} className="text-xs px-2.5 py-1 rounded-full bg-surface border border-border text-muted-foreground">
                      {p.opciones.find((o) => o.valor === respuestas[p.id])?.etiqueta}
                    </span>
                  ))}
                  <button onClick={resetear} className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:text-coral hover:border-coral/30 transition-colors">Reiniciar</button>
                </div>
              )}
              {error && <p className="text-xs text-coral bg-coral/10 border border-coral/20 rounded-lg px-3 py-2">{error}</p>}
            </div>
          )}

          {(estado === "streaming" || estado === "completo") && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {PASOS.map((p) => (
                  <span key={p.id} className="text-xs px-2.5 py-1 rounded-full bg-surface border border-border text-muted-foreground">
                    {p.opciones.find((o) => o.valor === respuestas[p.id])?.etiqueta}
                  </span>
                ))}
                {sueno !== undefined && sueno < 7 && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-teal/10 border border-teal/20 text-teal flex items-center gap-1">
                    <Moon className="h-3 w-3" /> {fmt(sueno)}h sueño
                  </span>
                )}
                {estres !== undefined && estres > 5 && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-amber/10 border border-amber/20 text-amber flex items-center gap-1">
                    <Brain className="h-3 w-3" /> Estrés {estres}/10
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-coral/25 bg-coral/5 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-coral/20">
                  <div className="flex items-center gap-2">
                    <Dumbbell className="h-4 w-4 text-coral" />
                    <span className="text-sm font-bold text-coral">Tu rutina personalizada</span>
                  </div>
                  {estado === "streaming" && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /><span>Generando...</span>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  {hayContenido && (
                    <div>
                      {formatearContenido(textoMostrado)}
                      {escribiendo && <span className="inline-block w-0.5 h-4 bg-coral ml-0.5 animate-blink align-middle" />}
                    </div>
                  )}
                  {estado === "completo" && !escribiendo && (
                    <div className="flex items-center gap-3 pt-3 mt-2 border-t border-border/50">
                      {!guardada ? (
                        <Button onClick={handleGuardar} disabled={guardando || !uid} variant="ghost" className="gap-2 text-coral border border-coral/30 hover:bg-coral/10">
                          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />}
                          {guardando ? "Guardando..." : "Guardar rutina"}
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-coral">
                          <Bookmark className="h-4 w-4 fill-coral" /> Rutina guardada
                        </div>
                      )}
                      <button onClick={resetear} className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5">
                        <RefreshCw className="h-3 w-3" /> Nueva rutina
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground px-1">
                ⚕️ Orientación educativa — consulta a tu médico antes de iniciar un programa de ejercicio.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Mis rutinas ────────────────────────────────────────────────────── */}
      {vista === "guardadas" && (
        <div className="space-y-3">
          {cargandoGuardadas ? (
            <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Cargando rutinas...</span>
            </div>
          ) : guardadas.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-surface/50 p-10 text-center space-y-2">
              <Dumbbell className="h-8 w-8 text-muted-foreground/40 mx-auto" />
              <p className="text-sm text-muted-foreground">Aún no tienes rutinas guardadas.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {guardadas.map((rutina, idx) => {
                const fecha = new Date(rutina.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
                const semanaRutina = Math.floor((guardadas.length - 1 - idx) / 3) + 1;
                const ejercicioCount = rutina.contenido.ejercicios?.length ?? 0;
                return (
                  <button
                    key={rutina.id}
                    onClick={() => setRutinaDetalle(rutina)}
                    className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-left hover:border-coral/30 hover:bg-surface-2 transition-all group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{rutina.nombre}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-coral/10 text-coral border border-coral/20">Sem. {semanaRutina}</span>
                          <span className="text-[10px] text-muted-foreground">{rutina.contenido.nivel?.split(" ")[0]}</span>
                          <span className="text-[10px] text-muted-foreground">·</span>
                          <span className="text-[10px] text-muted-foreground">{rutina.contenido.tiempo} min</span>
                          {ejercicioCount > 0 && <span className="text-[10px] text-muted-foreground">· {ejercicioCount} ejercicios</span>}
                          {rutina.contenido.metricas?.sueno !== undefined && rutina.contenido.metricas.sueno < 7 && (
                            <span className="text-[10px] text-teal flex items-center gap-0.5"><Moon className="h-2.5 w-2.5" />{fmt(rutina.contenido.metricas.sueno)}h</span>
                          )}
                          {rutina.contenido.metricas?.estres !== undefined && rutina.contenido.metricas.estres > 5 && (
                            <span className="text-[10px] text-amber flex items-center gap-0.5"><Brain className="h-2.5 w-2.5" />E:{rutina.contenido.metricas.estres}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-1 text-[10px] text-coral">
                          <Play className="h-3 w-3" /> Iniciar
                        </div>
                        <span className="text-[10px] text-muted-foreground">{fecha}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleEliminar(rutina.id); }}
                          className="text-muted-foreground hover:text-coral transition-colors p-0.5"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── vista guiada paso a paso ─────────────────────────────────────────────────

function RutinaGuiada({
  rutina,
  onCerrar,
  onEliminar,
}: {
  rutina: RutinaRow;
  onCerrar: () => void;
  onEliminar: () => void;
}) {
  const ejercicios = rutina.contenido.ejercicios ?? [];
  const [modo, setModo] = useState<"resumen" | "guiada">("resumen");
  const [stepIdx, setStepIdx] = useState(0);
  const [fase, setFase] = useState<"ejercicio" | "descanso" | "fin">("ejercicio");
  const [countdown, setCountdown] = useState(0);
  const [confirmar, setConfirmar] = useState(false);

  const ejercicioActual = ejercicios[stepIdx];

  // Countdown de descanso
  useEffect(() => {
    if (fase !== "descanso" || countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [fase, countdown]);

  useEffect(() => {
    if (fase === "descanso" && countdown === 0) {
      avanzar();
    }
  }, [fase, countdown]);

  const terminarEjercicio = () => {
    const descanso = ejercicioActual?.descanso ?? 0;
    if (descanso > 0 && stepIdx < ejercicios.length - 1) {
      setFase("descanso");
      setCountdown(descanso);
    } else {
      avanzar();
    }
  };

  const avanzar = () => {
    const siguiente = stepIdx + 1;
    if (siguiente >= ejercicios.length) {
      setFase("fin");
    } else {
      setStepIdx(siguiente);
      setFase("ejercicio");
    }
  };

  const bloques = Array.from(new Set(ejercicios.map((e) => e.bloque)));

  return (
    <div className="fixed inset-0 z-[60] bg-background overflow-y-auto animate-slide-in-right">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={onCerrar}
            className="h-8 w-8 rounded-full bg-surface border border-border flex items-center justify-center hover:bg-surface-2 transition-colors shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-foreground truncate">{rutina.nombre}</h2>
            <p className="text-[10px] text-muted-foreground">{new Date(rutina.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "long" })}</p>
          </div>
          {modo === "resumen" && (
            <button
              onClick={() => setConfirmar(c => !c)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${confirmar ? "bg-coral/10 border-coral/30 text-coral" : "border-border text-muted-foreground hover:text-coral"}`}
            >
              {confirmar ? "¿Eliminar?" : "Eliminar"}
            </button>
          )}
          {confirmar && (
            <button onClick={onEliminar} className="text-xs px-2.5 py-1 rounded-lg border bg-coral/10 border-coral/30 text-coral">Sí</button>
          )}
        </div>
      </div>

      {/* ── Modo resumen ──────────────────────────────────────────────────── */}
      {modo === "resumen" && (
        <div className="p-4 pb-8 space-y-4">
          {/* Chips */}
          <div className="flex flex-wrap gap-2">
            <span className="text-xs px-2.5 py-1 rounded-full bg-surface border border-border text-muted-foreground">{rutina.contenido.nivel?.split(" ")[0]}</span>
            <span className="text-xs px-2.5 py-1 rounded-full bg-surface border border-border text-muted-foreground">{rutina.contenido.tiempo} min</span>
            <span className="text-xs px-2.5 py-1 rounded-full bg-surface border border-border text-muted-foreground">{rutina.contenido.lugar?.split(" ")[0]}</span>
            {rutina.contenido.metricas?.sueno !== undefined && rutina.contenido.metricas.sueno < 7 && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-teal/10 border border-teal/20 text-teal flex items-center gap-1"><Moon className="h-3 w-3" />{fmt(rutina.contenido.metricas.sueno)}h sueño</span>
            )}
            {rutina.contenido.metricas?.estres !== undefined && rutina.contenido.metricas.estres > 5 && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-amber/10 border border-amber/20 text-amber flex items-center gap-1"><Brain className="h-3 w-3" />Estrés {rutina.contenido.metricas.estres}/10</span>
            )}
          </div>

          {/* Lista de ejercicios por bloque */}
          {ejercicios.length > 0 ? (
            <div className="space-y-4">
              {bloques.map((bloque) => (
                <div key={bloque}>
                  <h3 className="text-xs font-semibold text-coral uppercase tracking-widest mb-2">{bloque}</h3>
                  <div className="space-y-2">
                    {ejercicios.filter((e) => e.bloque === bloque).map((ej, i) => (
                      <div key={i} className="rounded-lg border border-border bg-surface px-3 py-2.5 space-y-0.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">{ej.nombre}</p>
                          {ej.descanso > 0 && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 shrink-0"><Timer className="h-3 w-3" />{ej.descanso}s</span>
                          )}
                        </div>
                        <p className="text-xs text-coral">{ej.detalle}</p>
                        {ej.descripcion && <p className="text-xs text-muted-foreground">{ej.descripcion}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">{formatearContenido(rutina.contenido.texto)}</div>
          )}

          {/* Botón iniciar */}
          {ejercicios.length > 0 && (
            <Button
              onClick={() => { setModo("guiada"); setStepIdx(0); setFase("ejercicio"); }}
              className="w-full gap-2 bg-coral hover:bg-coral/90 text-white font-semibold"
            >
              <Play className="h-4 w-4" /> Iniciar rutina guiada
            </Button>
          )}
        </div>
      )}

      {/* ── Modo guiado ───────────────────────────────────────────────────── */}
      {modo === "guiada" && fase !== "fin" && ejercicioActual && (
        <div className="flex flex-col min-h-[calc(100vh-56px)] p-4">
          {/* Progreso */}
          <div className="space-y-2 mb-6">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{ejercicioActual.bloque}</span>
              <span>{stepIdx + 1} / {ejercicios.length}</span>
            </div>
            <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-coral rounded-full transition-all duration-500"
                style={{ width: `${((stepIdx + 1) / ejercicios.length) * 100}%` }}
              />
            </div>
          </div>

          {fase === "ejercicio" && (
            <div className="flex-1 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="rounded-2xl border border-coral/25 bg-coral/5 p-6 space-y-3 text-center">
                  <p className="text-xs font-semibold text-coral uppercase tracking-widest">{ejercicioActual.bloque}</p>
                  <h2 className="text-2xl font-bold text-foreground">{ejercicioActual.nombre}</h2>
                  <p className="text-lg text-coral font-semibold">{ejercicioActual.detalle}</p>
                  {ejercicioActual.descripcion && (
                    <p className="text-sm text-muted-foreground leading-relaxed">{ejercicioActual.descripcion}</p>
                  )}
                </div>

                {/* Siguiente ejercicio preview */}
                {stepIdx + 1 < ejercicios.length && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-border text-xs text-muted-foreground">
                    <span>Siguiente:</span>
                    <span className="font-medium text-foreground">{ejercicios[stepIdx + 1].nombre}</span>
                    <span className="ml-auto">{ejercicios[stepIdx + 1].detalle}</span>
                  </div>
                )}
              </div>

              <div className="space-y-3 mt-6">
                <Button onClick={terminarEjercicio} className="w-full gap-2 bg-coral hover:bg-coral/90 text-white font-semibold py-6 text-base">
                  <CheckCircle className="h-5 w-5" />
                  {stepIdx === ejercicios.length - 1 ? "Finalizar rutina" : "¡Listo! Siguiente"}
                </Button>
                <button onClick={onCerrar} className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-2">
                  Pausar y salir
                </button>
              </div>
            </div>
          )}

          {fase === "descanso" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">Descanso</p>
                <div className="text-7xl font-bold text-foreground tabular-nums">{countdown}</div>
                <p className="text-sm text-muted-foreground">segundos</p>
              </div>
              <div className="w-24 h-24 rounded-full border-4 border-coral/20 flex items-center justify-center">
                <Timer className="h-10 w-10 text-coral/60" />
              </div>
              {stepIdx + 1 < ejercicios.length && (
                <p className="text-sm text-muted-foreground">Preparate para: <span className="font-semibold text-foreground">{ejercicios[stepIdx + 1].nombre}</span></p>
              )}
              <button onClick={avanzar} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <SkipForward className="h-3.5 w-3.5" /> Saltar descanso
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Fin ───────────────────────────────────────────────────────────── */}
      {modo === "guiada" && fase === "fin" && (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-56px)] p-6 text-center space-y-6">
          <div className="w-20 h-20 rounded-full bg-coral/10 border border-coral/20 flex items-center justify-center">
            <CheckCircle className="h-10 w-10 text-coral" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-foreground">¡Rutina completada!</h2>
            <p className="text-sm text-muted-foreground">{ejercicios.length} ejercicios · {rutina.contenido.tiempo} min</p>
          </div>
          <p className="text-sm text-muted-foreground max-w-xs">
            Excelente trabajo. Recuerda hidratarte y registrar tus métricas si las mediste hoy.
          </p>
          <div className="flex flex-col gap-2 w-full max-w-xs">
            <Button onClick={() => { setModo("guiada"); setStepIdx(0); setFase("ejercicio"); }} variant="ghost" className="gap-2 border border-border">
              <RefreshCw className="h-4 w-4" /> Repetir rutina
            </Button>
            <Button onClick={onCerrar} className="bg-coral hover:bg-coral/90 text-white">
              Volver a mis rutinas
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
