"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ChefHat, Sparkles, BookOpen, Loader2, ImageIcon,
  Bookmark, Trash2, RefreshCw, ArrowLeft, Clock, Users,
  ShoppingCart, Send, MessageCircle, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnonymousId } from "@/hooks/use-anonymous-id";
import {
  guardarReceta, getRecetasGuardadas, eliminarReceta, calificarReceta,
  uploadRecetaImagen,
} from "@/lib/db/recetas";
import type { RecetaRow } from "@/lib/db/types";
import {
  guardarListaMercado, getListasMercado, eliminarListaMercado,
} from "@/lib/db/mercado";
import type { ListaMercadoRow } from "@/lib/db/types";

// ─── helpers ─────────────────────────────────────────────────────────────────

function extraerTitulo(texto: string): string {
  const match = texto.match(/^##\s+(.+)/m);
  return match?.[1]?.trim() ?? "Receta cardioprotectora";
}

function extraerIngredientes(texto: string, fallback: string): string[] {
  // Intentar extraer de la sección ### Ingredientes del texto generado
  const seccion = texto.match(/###\s+Ingredientes\s*\n([\s\S]*?)(?=###|$)/i);
  if (seccion) {
    const items = seccion[1]
      .split("\n")
      .filter((l) => l.trim().startsWith("- "))
      .map((l) => l.replace(/^-\s+/, "").split("(")[0].trim())
      .filter(Boolean)
      .slice(0, 12);
    if (items.length > 0) return items;
  }
  // Fallback: usar lo que escribió el usuario
  return fallback.split(/[,\n]+/).map((i) => i.trim()).filter(Boolean);
}

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

function formatearContenido(texto: string, compact = false): React.ReactNode {
  const lineas = texto.split("\n");
  const base = compact ? "text-xs" : "text-sm";
  return lineas.map((linea, i) => {
    if (linea.trim() === "---")
      return <hr key={i} className="border-border/40 my-3" />;
    if (linea.startsWith("> "))
      return (
        <div key={i} className="border-l-2 border-teal/50 bg-teal/5 pl-3 py-1.5 my-2 rounded-r">
          <p className={`${base} text-foreground/75`}>{renderInline(linea.slice(2))}</p>
        </div>
      );
    if (linea.startsWith("## "))
      return <h2 key={i} className={`${compact ? "text-base" : "text-lg"} font-bold text-foreground mt-4 mb-2 first:mt-0`}>{linea.slice(3)}</h2>;
    if (linea.startsWith("### "))
      return <h3 key={i} className={`${base} font-semibold text-teal uppercase tracking-widest mt-4 mb-2`}>{linea.slice(4)}</h3>;
    if (linea.match(/^\*\*.+\*\*$/) && !linea.slice(2, -2).includes("**")) {
      const inner = linea.slice(2, -2);
      if (inner.includes("|"))
        return (
          <p key={i} className={`${base} text-muted-foreground mb-2 flex gap-3 flex-wrap`}>
            {inner.split("|").map((c, j) => <span key={j}>{renderInline(c.trim())}</span>)}
          </p>
        );
      return <p key={i} className={`${base} font-semibold text-foreground mb-1`}>{inner}</p>;
    }
    if (linea.startsWith("- "))
      return (
        <div key={i} className={`flex gap-2 ${base} text-foreground/90 mb-1`}>
          <span className="text-muted-foreground shrink-0 mt-0.5">•</span>
          <span>{renderInline(linea.slice(2))}</span>
        </div>
      );
    if (linea.match(/^\d+\.\s/)) {
      const num = linea.match(/^(\d+)\.\s/)?.[1];
      const content = linea.replace(/^\d+\.\s/, "");
      return (
        <div key={i} className={`flex gap-2 ${base} text-foreground/90 mb-1.5`}>
          <span className="text-teal font-bold shrink-0 min-w-[1.25rem] text-right">{num}.</span>
          <span>{renderInline(content)}</span>
        </div>
      );
    }
    if (linea.trim() === "") return <div key={i} className="h-1" />;
    return <p key={i} className={`${base} text-foreground/90 mb-1 leading-relaxed`}>{renderInline(linea)}</p>;
  });
}

// ─── streaming helper ─────────────────────────────────────────────────────────

async function leerStream(
  res: Response,
  onChunk: (texto: string) => void
): Promise<string> {
  const reader = res.body!.getReader();
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
          if (typeof chunk === "string") { textoCompleto += chunk; onChunk(textoCompleto); }
        } catch { /* skip */ }
      }
    }
  }
  return textoCompleto;
}

// ─── portal (evita problemas de overflow en el layout) ───────────────────────

function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

// ─── tipos ────────────────────────────────────────────────────────────────────

type TabPrincipal = "recetas" | "mercado";
type SubTabRecetas = "nueva" | "guardadas";
type EstadoGeneracion = "idle" | "streaming" | "imagen" | "completo";

interface ChatMsg { role: "user" | "assistant"; content: string; esReceta?: boolean; }

// ─── componente principal ─────────────────────────────────────────────────────

export function RecetasClient() {
  const uid = useAnonymousId();
  const [tabPrincipal, setTabPrincipal] = useState<TabPrincipal>("recetas");
  const [subTab, setSubTab] = useState<SubTabRecetas>("nueva");
  const [ingredientes, setIngredientes] = useState("");

  // Generación
  const [estado, setEstado] = useState<EstadoGeneracion>("idle");
  const [recetaTexto, setRecetaTexto] = useState("");
  const [textoMostrado, setTextoMostrado] = useState("");
  const recetaRef = useRef("");
  const [imagenUrl, setImagenUrl] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardada, setGuardada] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Chat sobre receta
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatCargando, setChatCargando] = useState(false);
  const [chatRespuesta, setChatRespuesta] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  // Guardadas
  const [guardadas, setGuardadas] = useState<RecetaRow[]>([]);
  const [cargandoGuardadas, setCargandoGuardadas] = useState(false);
  const [recetaDetalle, setRecetaDetalle] = useState<RecetaRow | null>(null);

  // ── typewriter ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (textoMostrado.length >= recetaRef.current.length) return;
    const full = recetaRef.current;
    const nextSpace = full.indexOf(" ", textoMostrado.length);
    const nextEnd = nextSpace === -1 ? full.length : nextSpace + 1;
    const timer = setTimeout(() => setTextoMostrado(full.slice(0, nextEnd)), 35);
    return () => clearTimeout(timer);
  }, [recetaTexto, textoMostrado]);

  useEffect(() => {
    chatRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMsgs, chatRespuesta]);

  const escribiendo = textoMostrado.length < recetaRef.current.length || estado === "streaming";
  const hayContenido = textoMostrado.length > 0;

  // ── generar receta ──────────────────────────────────────────────────────────
  const generarReceta = useCallback(async () => {
    if (!ingredientes.trim() || estado === "streaming" || estado === "imagen") return;
    setEstado("streaming");
    setRecetaTexto(""); setTextoMostrado(""); recetaRef.current = "";
    setImagenUrl(null); setGuardada(false); setError(null); setChatMsgs([]);

    try {
      const res = await fetch("/api/recetas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientes: ingredientes.trim() }),
      });
      if (!res.ok || !res.body) throw new Error("Error al conectar con el asistente");

      const textoCompleto = await leerStream(res, (t) => {
        recetaRef.current = t;
        setRecetaTexto(t);
      });

      setEstado("imagen");
      await generarImagen(extraerTitulo(textoCompleto));
      setEstado("completo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
      setEstado("idle");
    }
  }, [ingredientes, estado]);

  const generarImagen = async (titulo: string) => {
    try {
      const res = await fetch("/api/recetas/imagen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo, uid }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.imagen) setImagenUrl(data.imagen);
      }
    } catch { /* silencioso */ }
  };

  // ── chat sobre receta ───────────────────────────────────────────────────────
  const enviarChat = async () => {
    if (!chatInput.trim() || chatCargando) return;
    const pregunta = chatInput.trim();
    setChatInput("");
    setChatCargando(true);
    setChatRespuesta("");

    const historialApi = chatMsgs.map((m) => ({ role: m.role, content: m.content }));
    setChatMsgs((prev) => [...prev, { role: "user", content: pregunta }]);

    try {
      const res = await fetch("/api/recetas/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receta: recetaTexto, pregunta, historial: historialApi }),
      });
      if (!res.ok || !res.body) throw new Error();

      let respuestaCompleta = "";
      await leerStream(res, (t) => { respuestaCompleta = t; setChatRespuesta(t); });

      const esReceta = respuestaCompleta.includes("##") && respuestaCompleta.includes("###");
      setChatMsgs((prev) => [...prev, { role: "assistant", content: respuestaCompleta, esReceta }]);
      setChatRespuesta("");
    } catch {
      setChatMsgs((prev) => [...prev, { role: "assistant", content: "No se pudo procesar tu pregunta. Intenta de nuevo." }]);
    } finally {
      setChatCargando(false);
    }
  };

  const aplicarRecetaChat = (contenido: string) => {
    recetaRef.current = contenido;
    setRecetaTexto(contenido);
    setTextoMostrado(contenido);
    setGuardada(false);
    setImagenUrl(null);
    // Generar nueva imagen con el nuevo título
    generarImagen(extraerTitulo(contenido));
  };

  // ── guardar receta ──────────────────────────────────────────────────────────
  const handleGuardar = async () => {
    if (!uid || !recetaTexto || guardando || guardada) return;
    setGuardando(true);
    const titulo = extraerTitulo(recetaTexto);
    const ingredientesArray = extraerIngredientes(recetaTexto, ingredientes);
    let urlFinal: string | null = imagenUrl;
    if (imagenUrl?.startsWith("data:")) {
      const uploaded = await uploadRecetaImagen(uid, imagenUrl);
      urlFinal = uploaded;
    }
    const { error: errDB } = await guardarReceta(uid, titulo, recetaTexto, urlFinal, ingredientesArray);
    if (!errDB) setGuardada(true);
    else setError("No se pudo guardar la receta. Intenta de nuevo.");
    setGuardando(false);
  };

  // ── guardadas ───────────────────────────────────────────────────────────────
  const cargarGuardadas = useCallback(async () => {
    if (!uid) return;
    setCargandoGuardadas(true);
    setGuardadas(await getRecetasGuardadas(uid));
    setCargandoGuardadas(false);
  }, [uid]);

  const handleEliminar = async (id: string) => {
    await eliminarReceta(id);
    setGuardadas((prev) => prev.filter((r) => r.id !== id));
    if (recetaDetalle?.id === id) setRecetaDetalle(null);
  };

  const resetear = () => {
    setEstado("idle"); setRecetaTexto(""); setTextoMostrado(""); recetaRef.current = "";
    setImagenUrl(null); setGuardada(false); setError(null);
    setIngredientes(""); setChatMsgs([]); setChatInput("");
  };

  // ─── render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="space-y-5 animate-fade-in">
        {/* Tabs principales */}
        <div className="flex gap-1 rounded-xl bg-surface p-1 border border-border w-fit">
          <button
            onClick={() => setTabPrincipal("recetas")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tabPrincipal === "recetas" ? "bg-teal/15 text-teal border border-teal/30" : "text-muted-foreground hover:text-foreground"}`}
          >
            <ChefHat className="h-3.5 w-3.5" /> Recetas
          </button>
          <button
            onClick={() => setTabPrincipal("mercado")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tabPrincipal === "mercado" ? "bg-teal/15 text-teal border border-teal/30" : "text-muted-foreground hover:text-foreground"}`}
          >
            <ShoppingCart className="h-3.5 w-3.5" /> Mercado
          </button>
        </div>

        {/* ── Sección Recetas ───────────────────────────────────────────────── */}
        {tabPrincipal === "recetas" && (
          <div className="flex gap-1 rounded-xl bg-surface p-1 border border-border w-fit">
            <button
              onClick={() => setSubTab("nueva")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${subTab === "nueva" ? "bg-teal/15 text-teal border border-teal/30" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Sparkles className="h-3.5 w-3.5" /> Nueva receta
            </button>
            <button
              onClick={() => { setSubTab("guardadas"); cargarGuardadas(); }}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${subTab === "guardadas" ? "bg-teal/15 text-teal border border-teal/30" : "text-muted-foreground hover:text-foreground"}`}
            >
              <BookOpen className="h-3.5 w-3.5" /> Recetas guardadas
            </button>
          </div>
        )}

        {/* ── Nueva receta ─────────────────────────────────────────────────── */}
        {tabPrincipal === "recetas" && subTab === "nueva" && (
          <div className="space-y-4">
            {(estado === "idle" || estado === "completo") && (
              <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest block">
                  ¿Qué ingredientes tienes?
                </label>
                <textarea
                  value={ingredientes}
                  onChange={(e) => setIngredientes(e.target.value)}
                  placeholder="Ej: pollo, espinacas, ajo, aceite de oliva, limón..."
                  rows={3}
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-teal/50 focus:ring-1 focus:ring-teal/30 transition-all"
                />
                {error && <p className="text-xs text-coral bg-coral/10 border border-coral/20 rounded-lg px-3 py-2">{error}</p>}
                <div className="flex items-center gap-2">
                  {estado === "completo" && (
                    <Button variant="ghost" onClick={resetear} className="gap-1.5 text-muted-foreground border border-border text-sm">
                      <RefreshCw className="h-3.5 w-3.5" /> Nueva
                    </Button>
                  )}
                  <Button onClick={generarReceta} disabled={!ingredientes.trim()} className="gap-2 bg-teal hover:bg-teal/90 text-background font-semibold ml-auto">
                    <Sparkles className="h-4 w-4" /> Generar receta
                  </Button>
                </div>
              </div>
            )}

            {/* Resultado */}
            {(estado === "streaming" || estado === "imagen" || estado === "completo") && hayContenido && (
              <div className="rounded-xl border border-teal/25 bg-teal/5 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-teal/20">
                  <div className="flex items-center gap-2">
                    <ChefHat className="h-4 w-4 text-teal" />
                    <span className="text-sm font-bold text-teal">Receta cardioprotectora</span>
                  </div>
                  {estado === "imagen" && (
                    <div className="flex items-center gap-1.5 text-xs text-purple">
                      <ImageIcon className="h-3 w-3" />
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Generando imagen...</span>
                    </div>
                  )}
                </div>
                <div className="p-4 space-y-4">
                  {(estado === "imagen" || estado === "completo") && (
                    <div className="rounded-lg overflow-hidden border border-border aspect-video">
                      {imagenUrl ? (
                        <img src={imagenUrl} alt="Foto del plato" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-surface-2 relative overflow-hidden">
                          <div className="absolute inset-0 animate-shimmer" style={{ background: "linear-gradient(90deg, transparent 0%, rgba(163,113,247,0.07) 50%, transparent 100%)" }} />
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                            <div className="w-10 h-10 rounded-full bg-purple/10 border border-purple/20 flex items-center justify-center">
                              <ImageIcon className="h-5 w-5 text-purple/50" />
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Loader2 className="h-3 w-3 animate-spin text-purple/70" />
                              <span className="text-xs text-muted-foreground">Generando imagen con IA...</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div>
                    {formatearContenido(textoMostrado)}
                    {escribiendo && <span className="inline-block w-0.5 h-4 bg-teal ml-0.5 animate-blink align-middle" />}
                  </div>
                  {estado === "completo" && (
                    <div className="flex items-center gap-3 pt-2 border-t border-border/50">
                      {!guardada ? (
                        <Button onClick={handleGuardar} disabled={guardando || !uid} variant="ghost" className="gap-2 text-teal border border-teal/30 hover:bg-teal/10">
                          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />}
                          {guardando ? "Guardando..." : "Guardar receta"}
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-teal">
                          <Bookmark className="h-4 w-4 fill-teal" /> Receta guardada
                        </div>
                      )}
                      <button onClick={resetear} className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                        <RefreshCw className="h-3 w-3" /> Nueva receta
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Chat sobre la receta ──────────────────────────────────────── */}
            {estado === "completo" && (
              <div className="rounded-xl border border-border bg-surface overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <MessageCircle className="h-4 w-4 text-teal" />
                  <span className="text-sm font-semibold text-foreground">Preguntas sobre esta receta</span>
                </div>
                <div className="p-4 space-y-3">
                  {/* Sugerencias rápidas */}
                  {chatMsgs.length === 0 && (
                    <div className="flex flex-wrap gap-2">
                      {["¿Qué pasa si no tengo aceite de oliva?", "No me gusta el ajo, ¿cómo lo cambio?", "¿Puedo hacerlo más bajo en calorías?"].map((s) => (
                        <button
                          key={s}
                          onClick={() => { setChatInput(s); }}
                          className="text-xs px-3 py-1.5 rounded-full border border-border bg-surface-2 text-muted-foreground hover:text-foreground hover:border-teal/30 transition-all"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Mensajes */}
                  {chatMsgs.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      {msg.role === "user" ? (
                        <div className="bg-teal/15 border border-teal/20 rounded-2xl rounded-tr-sm px-3 py-2 max-w-[85%]">
                          <p className="text-sm text-foreground">{msg.content}</p>
                        </div>
                      ) : (
                        <div className="max-w-[90%] space-y-2">
                          <div className="bg-surface-2 border border-border rounded-2xl rounded-tl-sm px-3 py-2">
                            {msg.esReceta ? (
                              <div className="space-y-2">
                                <p className="text-xs text-teal font-semibold">Receta actualizada:</p>
                                <div className="max-h-48 overflow-y-auto">{formatearContenido(msg.content, true)}</div>
                              </div>
                            ) : (
                              <p className="text-sm text-foreground/90 leading-relaxed">{msg.content}</p>
                            )}
                          </div>
                          {msg.esReceta && (
                            <button
                              onClick={() => aplicarRecetaChat(msg.content)}
                              className="flex items-center gap-1.5 text-xs text-teal hover:text-teal/80 transition-colors px-1"
                            >
                              <RotateCcw className="h-3 w-3" /> Usar esta versión como receta principal
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Respuesta en streaming */}
                  {chatRespuesta && (
                    <div className="flex justify-start">
                      <div className="bg-surface-2 border border-border rounded-2xl rounded-tl-sm px-3 py-2 max-w-[90%]">
                        <p className="text-sm text-foreground/90 leading-relaxed">{chatRespuesta}</p>
                      </div>
                    </div>
                  )}
                  {chatCargando && !chatRespuesta && (
                    <div className="flex justify-start">
                      <div className="bg-surface-2 border border-border rounded-2xl rounded-tl-sm px-3 py-2">
                        <Loader2 className="h-4 w-4 animate-spin text-teal" />
                      </div>
                    </div>
                  )}
                  <div ref={chatRef} />

                  {/* Input */}
                  <div className="flex gap-2 pt-1">
                    <input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarChat(); } }}
                      placeholder="Ej: no tengo espinacas, ¿qué uso?"
                      className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-teal/50 focus:ring-1 focus:ring-teal/30 transition-all"
                      disabled={chatCargando}
                    />
                    <button
                      onClick={enviarChat}
                      disabled={!chatInput.trim() || chatCargando}
                      className="h-9 w-9 rounded-lg bg-teal text-background flex items-center justify-center disabled:opacity-40 hover:bg-teal/90 transition-colors shrink-0"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {estado === "idle" && (
              <div className="rounded-xl border border-dashed border-border/60 bg-surface/50 p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-teal/10 border border-teal/20 flex items-center justify-center mx-auto">
                  <ChefHat className="h-6 w-6 text-teal/60" />
                </div>
                <p className="text-sm font-medium text-foreground/70">Escribe tus ingredientes</p>
                <p className="text-xs text-muted-foreground">La IA creará una receta cardioprotectora y generará la foto del plato.</p>
              </div>
            )}
          </div>
        )}

        {/* ── Guardadas ────────────────────────────────────────────────────── */}
        {tabPrincipal === "recetas" && subTab === "guardadas" && (
          <div className="space-y-3">
            {cargandoGuardadas ? (
              <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Cargando recetas...</span>
              </div>
            ) : guardadas.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-surface/50 p-10 text-center space-y-2">
                <BookOpen className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                <p className="text-sm text-muted-foreground">Aún no tienes recetas guardadas.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {guardadas.map((receta) => (
                  <RecetaCard key={receta.id} receta={receta} onVerCompleta={() => setRecetaDetalle(receta)} onEliminar={() => handleEliminar(receta.id)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Mercado ──────────────────────────────────────────────────────── */}
        {tabPrincipal === "mercado" && (
          <MercadoView ingredientesRecetas={guardadas.flatMap((r) => r.ingredientes)} />
        )}
      </div>

      {recetaDetalle && (
        <Portal>
          <RecetaDetalle
            receta={recetaDetalle}
            onCerrar={() => setRecetaDetalle(null)}
            onEliminar={() => handleEliminar(recetaDetalle.id)}
            onCalificar={(cal) => {
              calificarReceta(recetaDetalle.id, cal);
              setGuardadas((prev) => prev.map((r) => r.id === recetaDetalle.id ? { ...r, calificacion: cal } : r));
              setRecetaDetalle((prev) => prev ? { ...prev, calificacion: cal } : prev);
            }}
          />
        </Portal>
      )}
    </>
  );
}

// ─── tarjeta guardadas ────────────────────────────────────────────────────────

function RecetaCard({ receta, onVerCompleta, onEliminar }: { receta: RecetaRow; onVerCompleta: () => void; onEliminar: () => void }) {
  const fecha = new Date(receta.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  return (
    <button onClick={onVerCompleta} className="rounded-xl border border-border bg-surface overflow-hidden text-left hover:border-teal/30 hover:bg-surface-2 transition-all group w-full">
      {receta.imagen_url ? (
        <div className="aspect-video overflow-hidden">
          <img src={receta.imagen_url} alt={receta.titulo} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        </div>
      ) : (
        <div className="aspect-video bg-surface-2 flex items-center justify-center">
          <ChefHat className="h-8 w-8 text-muted-foreground/20" />
        </div>
      )}
      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground leading-tight line-clamp-2">{receta.titulo}</h3>
          <button onClick={(e) => { e.stopPropagation(); onEliminar(); }} className="text-muted-foreground hover:text-coral transition-colors shrink-0 p-0.5"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
        <div className="flex items-center justify-between">
          {receta.ingredientes?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {receta.ingredientes.slice(0, 3).map((ing, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal/10 text-teal border border-teal/20">{ing}</span>
              ))}
              {receta.ingredientes.length > 3 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface text-muted-foreground border border-border">+{receta.ingredientes.length - 3}</span>
              )}
            </div>
          )}
          <div className="flex flex-col items-end gap-0.5 ml-auto shrink-0">
            {receta.calificacion && (
              <div className="flex gap-0.5">
                {[1,2,3,4,5].map((s) => <span key={s} className={`text-[10px] ${s <= receta.calificacion! ? "text-amber" : "text-border"}`}>★</span>)}
              </div>
            )}
            <span className="text-[10px] text-muted-foreground">{fecha}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── vista detalle ────────────────────────────────────────────────────────────

function RecetaDetalle({ receta, onCerrar, onEliminar, onCalificar }: { receta: RecetaRow; onCerrar: () => void; onEliminar: () => void; onCalificar: (cal: number) => void }) {
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const tiempoMatch = receta.contenido.match(/Tiempo[:\s]+(\d+\s*minutos?)/i);
  const porcionesMatch = receta.contenido.match(/Porciones[:\s]+(\d+)/i);
  return (
    <div className="fixed inset-0 z-[60] bg-background animate-slide-in-right overflow-y-auto">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={onCerrar} className="h-8 w-8 rounded-full bg-surface border border-border flex items-center justify-center text-foreground hover:bg-surface-2 transition-colors shrink-0"><ArrowLeft className="h-4 w-4" /></button>
          <h2 className="text-sm font-semibold text-foreground truncate flex-1">{receta.titulo}</h2>
          <button
            onClick={() => { if (!confirmarEliminar) { setConfirmarEliminar(true); return; } onEliminar(); }}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${confirmarEliminar ? "bg-coral/10 border-coral/30 text-coral" : "border-border text-muted-foreground hover:text-coral"}`}
          >
            {confirmarEliminar ? "¿Eliminar?" : "Eliminar"}
          </button>
        </div>
      </div>
      {receta.imagen_url && (
        <div className="w-full aspect-video overflow-hidden">
          <img src={receta.imagen_url} alt={receta.titulo} className="w-full h-full object-cover" />
        </div>
      )}
      {(tiempoMatch || porcionesMatch) && (
        <div className="flex gap-3 px-4 pt-4">
          {porcionesMatch && <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-surface border border-border rounded-full px-3 py-1"><Users className="h-3 w-3" />{porcionesMatch[1]} porciones</div>}
          {tiempoMatch && <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-surface border border-border rounded-full px-3 py-1"><Clock className="h-3 w-3" />{tiempoMatch[1]}</div>}
        </div>
      )}
      <div className="flex items-center gap-3 px-4 pt-4">
        <span className="text-xs text-muted-foreground">Tu valoración:</span>
        <div className="flex gap-1">
          {[1,2,3,4,5].map((s) => {
            const activa = s <= (hover ?? receta.calificacion ?? 0);
            return (
              <button key={s} onClick={() => onCalificar(s)} onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(null)} className={`text-2xl transition-all ${activa ? "text-amber scale-110" : "text-border hover:text-amber/50"}`}>★</button>
            );
          })}
        </div>
        {receta.calificacion && <span className="text-xs text-muted-foreground">{receta.calificacion}/5</span>}
      </div>
      <div className="px-4 py-4 pb-8">{formatearContenido(receta.contenido)}</div>
    </div>
  );
}

// ─── mercado ──────────────────────────────────────────────────────────────────

function parsearItemsMercado(contenido: string): { seccion: string; items: string[] }[] {
  const secciones: { seccion: string; items: string[] }[] = [];
  let seccionActual = "";
  let itemsActuales: string[] = [];
  for (const linea of contenido.split("\n")) {
    if (linea.startsWith("### ")) {
      if (seccionActual && itemsActuales.length > 0) secciones.push({ seccion: seccionActual, items: itemsActuales });
      seccionActual = linea.slice(4).trim();
      itemsActuales = [];
    } else if (linea.trim().startsWith("- ")) {
      itemsActuales.push(linea.slice(linea.indexOf("- ") + 2).trim());
    }
  }
  if (seccionActual && itemsActuales.length > 0) secciones.push({ seccion: seccionActual, items: itemsActuales });
  return secciones;
}

function MercadoView({ ingredientesRecetas }: { ingredientesRecetas: string[] }) {
  const uid = useAnonymousId();
  const [periodo, setPeriodo] = useState<"semanal" | "mensual">("semanal");
  const [estado, setEstado] = useState<"idle" | "streaming" | "completo">("idle");
  const [listaTexto, setListaTexto] = useState("");
  const [textoMostrado, setTextoMostrado] = useState("");
  const listaRef = useRef("");
  const [chatMsgs, setChatMsgs] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatCargando, setChatCargando] = useState(false);
  const [chatRespuesta, setChatRespuesta] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [guardada, setGuardada] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [listas, setListas] = useState<ListaMercadoRow[]>([]);
  const [cargandoListas, setCargandoListas] = useState(false);
  const [vistaGuardadas, setVistaGuardadas] = useState(false);
  const [listaDetalle, setListaDetalle] = useState<ListaMercadoRow | null>(null);

  // Cargar historial al montar para tener contexto
  useEffect(() => {
    if (!uid) return;
    getListasMercado(uid).then(setListas);
  }, [uid]);

  // typewriter
  useEffect(() => {
    if (textoMostrado.length >= listaRef.current.length) return;
    const full = listaRef.current;
    const nextSpace = full.indexOf(" ", textoMostrado.length);
    const nextEnd = nextSpace === -1 ? full.length : nextSpace + 1;
    const t = setTimeout(() => setTextoMostrado(full.slice(0, nextEnd)), 30);
    return () => clearTimeout(t);
  }, [listaTexto, textoMostrado]);

  const escribiendo = textoMostrado.length < listaRef.current.length || estado === "streaming";

  const llamarApi = async (pregunta?: string) => {
    const historialApi = chatMsgs.map((m) => ({ role: m.role, content: m.content }));
    if (listaTexto && chatMsgs.length === 0) {
      historialApi.unshift({ role: "assistant" as const, content: listaTexto });
    }
    const res = await fetch("/api/mercado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        periodo,
        ingredientes_recetas: ingredientesRecetas,
        listas_anteriores: listas.slice(0, 2).map((l) => ({ nombre: l.nombre, contenido: l.contenido })),
        historial: historialApi,
        pregunta,
      }),
    });
    if (!res.ok || !res.body) throw new Error("Error al conectar");
    return res;
  };

  const generarLista = async () => {
    setEstado("streaming");
    setListaTexto(""); setTextoMostrado(""); listaRef.current = "";
    setGuardada(false); setChatMsgs([]);
    try {
      const res = await llamarApi();
      await leerStream(res, (t) => { listaRef.current = t; setListaTexto(t); });
      setEstado("completo");
    } catch { setEstado("idle"); }
  };

  const enviarChat = async () => {
    if (!chatInput.trim() || chatCargando) return;
    const pregunta = chatInput.trim();
    setChatInput(""); setChatCargando(true); setChatRespuesta(""); setGuardada(false);
    setChatMsgs((prev) => [...prev, { role: "user", content: pregunta }]);
    try {
      const res = await llamarApi(pregunta);
      let respuesta = "";
      await leerStream(res, (t) => { respuesta = t; setChatRespuesta(t); });
      setChatMsgs((prev) => [...prev, { role: "assistant", content: respuesta }]);
      // Actualizar lista principal con la nueva versión
      listaRef.current = respuesta; setListaTexto(respuesta); setTextoMostrado(respuesta);
      setChatRespuesta("");
    } catch { /* silencioso */ }
    finally { setChatCargando(false); }
  };

  const handleGuardar = async () => {
    const texto = listaRef.current;
    if (!uid || !texto || guardando || guardada) return;
    setGuardando(true);
    setErrorGuardar(null);
    const nombre = `Lista ${periodo} — ${new Date().toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`;
    const { error } = await guardarListaMercado(uid, nombre, periodo, texto);
    if (!error) {
      setGuardada(true);
    } else {
      setErrorGuardar(`Error al guardar: ${error}`);
    }
    setGuardando(false);
  };

  const cargarListas = async () => {
    if (!uid) return;
    setCargandoListas(true);
    const data = await getListasMercado(uid);
    setListas(data);
    setCargandoListas(false);
  };

  if (listaDetalle) {
    return <ListaMercadoChecklist lista={listaDetalle} onVolver={() => setListaDetalle(null)} />;
  }

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-2">
        <button onClick={() => setVistaGuardadas(false)} className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${!vistaGuardadas ? "bg-teal/10 border-teal/30 text-teal" : "border-border text-muted-foreground hover:text-foreground"}`}>
          Nueva lista
        </button>
        <button onClick={() => { setVistaGuardadas(true); cargarListas(); }} className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${vistaGuardadas ? "bg-teal/10 border-teal/30 text-teal" : "border-border text-muted-foreground hover:text-foreground"}`}>
          Listas guardadas
        </button>
      </div>

      {!vistaGuardadas && (
        <>
          {/* Selector período + generar */}
          {estado === "idle" && (
            <div className="rounded-xl border border-border bg-surface p-4 space-y-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">¿Para cuánto tiempo?</p>
              <div className="flex gap-2">
                {(["semanal", "mensual"] as const).map((p) => (
                  <button key={p} onClick={() => setPeriodo(p)} className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-all ${periodo === p ? "bg-teal/10 border-teal/30 text-teal" : "border-border text-muted-foreground hover:text-foreground"}`}>
                    {p === "semanal" ? "Semanal" : "Mensual"}
                  </button>
                ))}
              </div>
              {ingredientesRecetas.length > 0 && (
                <p className="text-xs text-muted-foreground">Se usarán los ingredientes de tus {ingredientesRecetas.length > 0 ? `${new Set(ingredientesRecetas).size} ingredientes guardados` : "recetas"} como base.</p>
              )}
              <Button onClick={generarLista} className="w-full gap-2 bg-teal hover:bg-teal/90 text-background font-semibold">
                <ShoppingCart className="h-4 w-4" /> Generar lista {periodo}
              </Button>
            </div>
          )}

          {/* Lista generada */}
          {(estado === "streaming" || estado === "completo") && listaTexto && (
            <div className="rounded-xl border border-teal/25 bg-teal/5 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-teal/20">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-teal" />
                  <span className="text-sm font-bold text-teal">Lista {periodo}</span>
                </div>
                {estado === "streaming" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
              <div className="p-4">
                {formatearContenido(textoMostrado)}
                {escribiendo && <span className="inline-block w-0.5 h-4 bg-teal ml-0.5 animate-blink align-middle" />}

                {estado === "completo" && (
                  <div className="space-y-2 pt-3 mt-2 border-t border-border/50">
                    <div className="flex items-center gap-3">
                      {!guardada ? (
                        <Button onClick={handleGuardar} disabled={guardando} variant="ghost" className="gap-2 text-teal border border-teal/30 hover:bg-teal/10">
                          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />}
                          {guardando ? "Guardando..." : "Guardar lista"}
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-teal"><Bookmark className="h-4 w-4 fill-teal" />Lista guardada</div>
                      )}
                      <button onClick={() => { setEstado("idle"); setListaTexto(""); setTextoMostrado(""); listaRef.current = ""; setChatMsgs([]); setGuardada(false); setErrorGuardar(null); }} className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                        <RefreshCw className="h-3 w-3" /> Nueva lista
                      </button>
                    </div>
                    {errorGuardar && (
                      <p className="text-xs text-coral bg-coral/10 border border-coral/20 rounded-lg px-3 py-2">{errorGuardar}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Chat para modificar lista */}
          {estado === "completo" && (
            <div className="rounded-xl border border-border bg-surface overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <MessageCircle className="h-4 w-4 text-teal" />
                <span className="text-sm font-semibold text-foreground">Personalizar lista</span>
              </div>
              <div className="p-4 space-y-3">
                {chatMsgs.length === 0 && (
                  <div className="flex flex-wrap gap-2">
                    {["No me gusta el pollo, cámbialo", "Agrega más opciones vegetarianas", "Quita los lácteos"].map((s) => (
                      <button key={s} onClick={() => setChatInput(s)} className="text-xs px-3 py-1.5 rounded-full border border-border bg-surface-2 text-muted-foreground hover:text-foreground hover:border-teal/30 transition-all">{s}</button>
                    ))}
                  </div>
                )}
                {chatMsgs.filter(m => m.role === "user").map((msg, i) => (
                  <div key={i} className="flex justify-end">
                    <div className="bg-teal/15 border border-teal/20 rounded-2xl rounded-tr-sm px-3 py-2 max-w-[85%]">
                      <p className="text-sm text-foreground">{msg.content}</p>
                    </div>
                  </div>
                ))}
                {chatCargando && <div className="flex justify-start"><div className="bg-surface-2 border border-border rounded-2xl px-3 py-2"><Loader2 className="h-4 w-4 animate-spin text-teal" /></div></div>}
                <div className="flex gap-2 pt-1">
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); enviarChat(); } }}
                    placeholder="Ej: no me gusta el salmón, cámbialo por atún"
                    className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-teal/50 focus:ring-1 focus:ring-teal/30 transition-all"
                    disabled={chatCargando}
                  />
                  <button onClick={enviarChat} disabled={!chatInput.trim() || chatCargando} className="h-9 w-9 rounded-lg bg-teal text-background flex items-center justify-center disabled:opacity-40 hover:bg-teal/90 transition-colors shrink-0">
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Listas guardadas */}
      {vistaGuardadas && (
        <div className="space-y-3">
          {cargandoListas ? (
            <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Cargando...</span></div>
          ) : listas.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-surface/50 p-10 text-center space-y-2">
              <ShoppingCart className="h-8 w-8 text-muted-foreground/40 mx-auto" />
              <p className="text-sm text-muted-foreground">No tienes listas guardadas aún.</p>
            </div>
          ) : listas.map((lista) => (
            <button key={lista.id} onClick={() => setListaDetalle(lista)} className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-left hover:border-teal/30 hover:bg-surface-2 transition-all">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{lista.nombre}</p>
                  <p className="text-xs text-muted-foreground">{new Date(lista.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal/10 text-teal border border-teal/20">{lista.periodo}</span>
                  <button onClick={(e) => { e.stopPropagation(); eliminarListaMercado(lista.id); setListas((prev) => prev.filter((l) => l.id !== lista.id)); }} className="text-muted-foreground hover:text-coral transition-colors p-0.5"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── checklist de lista de mercado ────────────────────────────────────────────

function ListaMercadoChecklist({ lista, onVolver }: { lista: ListaMercadoRow; onVolver: () => void }) {
  const storageKey = `mercado-checklist-${lista.id}`;

  const [completados, setCompletados] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  const secciones = parsearItemsMercado(lista.contenido);
  const totalItems = secciones.reduce((acc, s) => acc + s.items.length, 0);
  const totalCompletados = completados.size;

  const toggle = (item: string) => {
    setCompletados((prev) => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      localStorage.setItem(storageKey, JSON.stringify([...next]));
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onVolver} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{totalCompletados}/{totalItems} comprados</span>
          {totalCompletados > 0 && (
            <button onClick={() => { setCompletados(new Set()); localStorage.removeItem(storageKey); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Reiniciar</button>
          )}
        </div>
      </div>

      {/* Barra de progreso */}
      {totalItems > 0 && (
        <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
          <div
            className="h-full bg-teal rounded-full transition-all duration-300"
            style={{ width: `${(totalCompletados / totalItems) * 100}%` }}
          />
        </div>
      )}

      <div className="space-y-4">
        {secciones.length > 0 ? secciones.map((sec) => (
          <div key={sec.seccion}>
            <h3 className="text-xs font-semibold text-teal uppercase tracking-widest mb-2">{sec.seccion}</h3>
            <div className="space-y-1">
              {sec.items.map((item) => {
                const done = completados.has(item);
                return (
                  <button
                    key={item}
                    onClick={() => toggle(item)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                      done ? "border-teal/20 bg-teal/5" : "border-border bg-surface hover:border-teal/20 hover:bg-surface-2"
                    }`}
                  >
                    <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                      done ? "border-teal bg-teal" : "border-border"
                    }`}>
                      {done && <span className="text-background text-[10px] font-bold">✓</span>}
                    </div>
                    <span className={`text-sm flex-1 transition-all ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                      {item}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )) : (
          <div className="p-4">{formatearContenido(lista.contenido)}</div>
        )}
      </div>

      {totalCompletados === totalItems && totalItems > 0 && (
        <div className="rounded-xl border border-teal/30 bg-teal/5 p-4 text-center space-y-1">
          <p className="text-sm font-semibold text-teal">¡Lista completada!</p>
          <p className="text-xs text-muted-foreground">Ya tienes todo lo de tu lista del mercado.</p>
        </div>
      )}
    </div>
  );
}
