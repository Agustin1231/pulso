"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Sparkles, RefreshCw, Clock, ChevronDown, ChevronUp, Loader2, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnonymousId } from "@/hooks/use-anonymous-id";
import { getUltimasMetricas } from "@/lib/db/metricas";
import type { MetricaRow } from "@/lib/db/types";

// ─── artículos curados ─────────────────────────────────────────────────────────

type Categoria = "Corazón" | "Nutrición" | "Movimiento" | "Sueño" | "Estrés";
type ArticuloColor = "coral" | "teal" | "purple" | "amber";

interface Articulo {
  id: string;
  categoria: Categoria;
  emoji: string;
  color: ArticuloColor;
  titulo: string;
  extracto: string;
  contenido: string;
  fuente: string;
  lectura: string;
}

const ARTICULOS: Articulo[] = [
  {
    id: "a1",
    categoria: "Corazón",
    emoji: "❤️",
    color: "coral",
    titulo: "Frecuencia cardíaca en reposo: el número que lo dice todo",
    extracto:
      "Una FC entre 60-100 bpm es normal, pero la tendencia importa más que el número aislado. Aprende a leer lo que te dice tu corazón.",
    contenido: `Una frecuencia cardíaca en reposo de **60-100 bpm** es normal para adultos. Sin embargo, el punto clave no es un número aislado sino la tendencia: si tu FC sube **5-10 bpm** sin causa aparente durante varios días, puede indicar estrés, enfermedad o sobreentrenamiento.

Los atletas bien entrenados suelen tener FC de **40-60 bpm** porque su corazón bombea más eficientemente con cada latido.

**Para medirla correctamente:** hazlo al despertar, antes de levantarte, en reposo total. Repítelo varios días para tener un promedio confiable.

**Cómo reducirla con hábitos:**
- Ejercicio aeróbico regular (caminar, nadar, ciclismo)
- Respiración profunda y meditación
- Sueño de calidad 7-9 horas
- Reducir la cafeína si consumes en exceso

> Una FC en reposo por debajo de 60 no siempre es mala señal — puede indicar buena forma física. Por encima de 100 en reposo merece atención médica.`,
    fuente: "Cardiología Preventiva",
    lectura: "3 min",
  },
  {
    id: "a2",
    categoria: "Nutrición",
    emoji: "🥗",
    color: "teal",
    titulo: "5 alimentos que cuidan tu corazón cada día",
    extracto:
      "Nueces, salmón, arándanos, aceite de oliva y avena: aliados comprobados para reducir el LDL y proteger tus arterias.",
    contenido: `Estos cinco alimentos tienen respaldo científico sólido para la salud cardiovascular:

**1. Nueces** — Ricas en omega-3 y magnesio. Reducen el colesterol LDL y la inflamación vascular. Un puñado (30g) al día es suficiente.

**2. Salmón o sardinas** — Los ácidos grasos EPA y DHA protegen las paredes arteriales y reducen los triglicéridos en sangre.

**3. Arándanos** — Sus antioxidantes flavonoides mejoran la función del endotelio (la capa interna de las arterias).

**4. Aceite de oliva virgen extra** — El ácido oleico reduce el colesterol total sin bajar el HDL (el colesterol "bueno").

**5. Avena** — Sus beta-glucanos forman un gel en el intestino que atrapa el colesterol antes de que se absorba.

Incorporar estos alimentos **3-5 veces por semana** puede reducir el riesgo cardiovascular hasta un **30%** según estudios de seguimiento a largo plazo.`,
    fuente: "Nutrición Clínica",
    lectura: "4 min",
  },
  {
    id: "a3",
    categoria: "Movimiento",
    emoji: "🏃",
    color: "purple",
    titulo: "30 minutos de caminata: la dosis mínima para tu corazón",
    extracto:
      "No necesitas correr ni ir al gym. Caminar 30 min/día, 5 días a la semana, reduce el riesgo de enfermedad cardíaca en un 35%.",
    contenido: `No necesitas correr ni ir al gimnasio. Estudios muestran que caminar **30 minutos al día, 5 días a la semana**, reduce el riesgo de enfermedad cardíaca en un **35%**.

**Por qué funciona:**
- Mejora la sensibilidad a la insulina
- Reduce la presión arterial sistólica 4-8 mmHg
- Fortalece el músculo cardíaco
- Eleva el HDL (colesterol "bueno")
- Reduce los triglicéridos en sangre

**Si no tienes 30 minutos continuos:** divide en 3 caminatas de 10 minutos — el efecto cardiovascular es prácticamente idéntico según investigaciones del Colegio Americano de Medicina del Deporte.

**Tip extra:** Camina después de comer. Los músculos absorben la glucosa de los alimentos sin necesidad de insulina, aplanando los picos de azúcar y favoreciendo la digestión.`,
    fuente: "Medicina del Ejercicio",
    lectura: "3 min",
  },
  {
    id: "a4",
    categoria: "Sueño",
    emoji: "😴",
    color: "purple",
    titulo: "Dormir menos de 6 horas eleva el riesgo cardíaco un 34%",
    extracto:
      "Durante el sueño profundo tu presión baja naturalmente. Sin descanso suficiente, este proceso reparador no ocurre.",
    contenido: `Durante el sueño profundo, la presión arterial baja naturalmente un **10-20%** — esto se llama "dipping nocturno" y es esencial para la recuperación vascular diaria.

**Lo que sucede sin sueño suficiente:**
- El cuerpo produce más cortisol y adrenalina
- Las arterias permanecen tensas más horas
- Aumenta la inflamación sistémica
- Se altera el ritmo circadiano del corazón

Quienes duermen menos de **6 horas** tienen un **34% más de riesgo de infarto** según metaanálisis de más de 3 millones de personas.

**Para mejorar el sueño:**
- Acuéstate a la misma hora todos los días (±30 minutos)
- Habitación fría: **18-20°C** es la temperatura ideal
- Sin pantallas **1 hora** antes de dormir
- Luz solar natural al despertar — regula la producción de melatonina

> La deuda de sueño acumulada durante la semana no se "recupera" completamente durmiendo más el fin de semana.`,
    fuente: "Medicina del Sueño",
    lectura: "5 min",
  },
  {
    id: "a5",
    categoria: "Estrés",
    emoji: "🧘",
    color: "amber",
    titulo: "Respiración 4-7-8: calma tu sistema nervioso en minutos",
    extracto:
      "Inhala 4 seg, sostén 7 seg, exhala 8 seg. Esta técnica baja la FC y el cortisol de forma inmediata y comprobada.",
    contenido: `Esta técnica activa el **sistema nervioso parasimpático** (el "freno" del estrés) en menos de 2 minutos.

**Procedimiento paso a paso:**
1. Exhala completamente por la boca
2. Inhala por la nariz contando hasta **4**
3. Sostén el aire contando hasta **7**
4. Exhala completamente por la boca contando hasta **8**
5. Repite el ciclo **4 veces**

**Efecto inmediato:** baja la frecuencia cardíaca, reduce el cortisol en sangre y alivia la tensión muscular.

**Efecto acumulado:** practicarlo **2 veces al día** durante 4 semanas mejora la variabilidad de la frecuencia cardíaca (HRV), un indicador clave de resiliencia cardiovascular.

**Cuándo usarla:**
- Antes de situaciones estresantes
- Al acostarte si tienes pensamientos acelerados
- En cualquier momento de ansiedad o presión

> Practica con los ojos cerrados para maximizar el efecto de activación parasimpática.`,
    fuente: "Psicofisiología Clínica",
    lectura: "3 min",
  },
  {
    id: "a6",
    categoria: "Corazón",
    emoji: "💧",
    color: "teal",
    titulo: "Deshidratación y presión arterial: el vínculo invisible",
    extracto:
      "Con solo un 2% de pérdida de agua corporal, tu sangre se espesa y el corazón trabaja más. La solución es simple.",
    contenido: `Cuando estás deshidratado (pérdida de solo el **2% de peso corporal**), tu sangre se vuelve más viscosa y el corazón debe ejercer más fuerza para bombearla. Resultado: la frecuencia cardíaca sube y la presión arterial puede aumentar.

**Señales de deshidratación leve:**
- Orina amarilla oscura (como jugo de manzana)
- FC en reposo 5-10 bpm más alta de lo normal
- Fatiga sin causa aparente
- Dificultad para concentrarte

**La dosis recomendada:** 35 ml por kg de peso corporal al día.
- Si pesas 60 kg → ~2.1 litros
- Si pesas 80 kg → ~2.8 litros

**Truco de la mañana:** Bebe un vaso grande al despertar. Durante el sueño pierdes ~500 ml por la respiración y el sudor.

La orina de color **amarillo claro** (como limonada diluida) indica hidratación óptima a lo largo del día.`,
    fuente: "Fisiología Cardiovascular",
    lectura: "3 min",
  },
  {
    id: "a7",
    categoria: "Nutrición",
    emoji: "🩸",
    color: "amber",
    titulo: "Picos de glucosa: tres hábitos que cambian todo",
    extracto:
      "Los picos repetidos de azúcar dañan las paredes vasculares silenciosamente. Estas estrategias los reducen hasta un 40%.",
    contenido: `Cada vez que comes carbohidratos refinados, tu glucosa sube rápidamente. Estos **picos glucémicos repetidos** dañan las paredes de los vasos sanguíneos por glucosilación, acelerando el envejecimiento arterial.

**3 estrategias para aplanar los picos:**

**1. Orden de los alimentos:**
Come primero fibra (verduras), luego proteína y grasa, y por último los carbohidratos. Esto reduce el pico glucémico hasta un **40%** sin cambiar lo que comes.

**2. Caminata post-comida:**
10 minutos de caminata después de comer. Los músculos absorben glucosa directamente sin necesidad de insulina, estabilizando el azúcar.

**3. Vinagre de manzana antes de comer:**
1 cucharada diluida en agua antes de una comida con muchos carbohidratos. El ácido acético ralentiza el vaciado gástrico y mejora la sensibilidad a la insulina.

> Si tienes diabetes o pre-diabetes, consulta con tu médico antes de cambiar tu dieta o rutina de ejercicio.`,
    fuente: "Endocrinología Preventiva",
    lectura: "4 min",
  },
  {
    id: "a8",
    categoria: "Nutrición",
    emoji: "🧂",
    color: "coral",
    titulo: "Sal oculta: los alimentos que más sodio te dan sin saberlo",
    extracto:
      "El 75% del sodio que consumimos viene de procesados, no del salero. Reducirlo baja la presión 5-7 mmHg en 4 semanas.",
    contenido: `La mayoría del sodio que consumimos **no viene del salero** — viene de los alimentos procesados que compramos sin revisarlos.

**Los mayores culpables (por porción):**
- Pan de molde: ~400 mg por 2 rebanadas
- Embutidos (jamón, salchichón): 600-800 mg por 100g
- Salsas y aderezos: 400-700 mg por cucharada
- Cereales de caja: 200-400 mg por porción
- Quesos curados: 400-600 mg por 40g

La **OMS recomienda menos de 2g de sodio al día** (equivale a 5g de sal de mesa).

**El efecto de reducirlo:** bajar el sodio a ese nivel puede reducir la presión sistólica **5-7 mmHg** en 4 semanas — sin medicamentos.

**Tip práctico:** Lee etiquetas y elige productos con menos de **120 mg de sodio por cada 100g**. Busca "bajo en sodio" o "sin sal añadida" en el empaque.`,
    fuente: "Cardiología Preventiva",
    lectura: "4 min",
  },
];

// ─── helpers de color ──────────────────────────────────────────────────────────

function badgeClasses(color: ArticuloColor) {
  if (color === "coral") return "bg-coral/10 text-coral border-coral/25";
  if (color === "teal")  return "bg-teal/10 text-teal border-teal/25";
  if (color === "amber") return "bg-amber/10 text-amber border-amber/25";
  return "bg-purple/10 text-purple border-purple/25";
}

function accentBorder(color: ArticuloColor) {
  if (color === "coral") return "border-l-coral/50";
  if (color === "teal")  return "border-l-teal/50";
  if (color === "amber") return "border-l-amber/50";
  return "border-l-purple/50";
}

function headerBg(color: ArticuloColor) {
  if (color === "coral") return "bg-coral/8";
  if (color === "teal")  return "bg-teal/8";
  if (color === "amber") return "bg-amber/8";
  return "bg-purple/8";
}

// ─── markdown renderer ─────────────────────────────────────────────────────────

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

function renderMarkdown(texto: string) {
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
    if (linea.trim() === "") return <div key={i} className="h-1.5" />;
    return <p key={i} className="text-sm text-foreground/90 mb-1 leading-relaxed">{renderInline(linea)}</p>;
  });
}

// ─── tarjeta de artículo ───────────────────────────────────────────────────────

function ArticuloCard({ art, expandido, onToggle }: {
  art: Articulo;
  expandido: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={cn(
      "rounded-xl border bg-surface overflow-hidden transition-all",
      "border-l-4",
      accentBorder(art.color),
      expandido ? "border-border/80" : "border-border"
    )}>
      {/* Header */}
      <button
        onClick={onToggle}
        className={cn("w-full text-left px-4 py-3.5 transition-colors", headerBg(art.color))}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-lg leading-none">{art.emoji}</span>
              <span className={cn(
                "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                badgeClasses(art.color)
              )}>
                {art.categoria}
              </span>
            </div>
            <h4 className="text-sm font-semibold text-foreground leading-snug">{art.titulo}</h4>
            {!expandido && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                {art.extracto}
              </p>
            )}
          </div>
          <div className="shrink-0 mt-0.5">
            {expandido
              ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
              : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>
      </button>

      {/* Contenido expandido */}
      {expandido && (
        <div className="px-4 pb-4 pt-1">
          <div className="space-y-0.5">
            {renderMarkdown(art.contenido)}
          </div>
          <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border/50">
            <BookOpen className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
            <span className="text-xs text-muted-foreground">{art.fuente}</span>
            <div className="flex items-center gap-1 ml-auto">
              <Clock className="h-3 w-3 text-muted-foreground/60" />
              <span className="text-xs text-muted-foreground">{art.lectura}</span>
            </div>
          </div>
        </div>
      )}

      {/* Footer compacto cuando está cerrado */}
      {!expandido && (
        <div className="flex items-center gap-3 px-4 py-2.5 border-t border-border/50">
          <BookOpen className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          <span className="text-xs text-muted-foreground/70">{art.fuente}</span>
          <div className="flex items-center gap-1 ml-auto">
            <Clock className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-xs text-muted-foreground/70">{art.lectura}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── componente principal ──────────────────────────────────────────────────────

const CATEGORIAS: Array<Categoria | "Todos"> = ["Todos", "Corazón", "Nutrición", "Movimiento", "Sueño", "Estrés"];

export function TipsClient() {
  const uid = useAnonymousId();
  const [metricas, setMetricas] = useState<MetricaRow[]>([]);
  const [cargando, setCargando] = useState(true);

  // tips IA
  const [tipsTexto, setTipsTexto] = useState("");
  const [textoMostrado, setTextoMostrado] = useState("");
  const tipsRef = useRef("");
  const [estadoIA, setEstadoIA] = useState<"idle" | "cargando" | "streaming" | "listo">("idle");

  // artículos
  const [expandidoId, setExpandidoId] = useState<string | null>(null);
  const [categoriaFiltro, setCategoriaFiltro] = useState<Categoria | "Todos">("Todos");

  // cargar métricas
  useEffect(() => {
    if (!uid) return;
    getUltimasMetricas(uid).then((data) => {
      setMetricas(data);
      setCargando(false);
    });
  }, [uid]);

  // typewriter effect
  useEffect(() => {
    if (textoMostrado === tipsTexto) return;
    const full = tipsTexto;
    const nextSpace = full.indexOf(" ", textoMostrado.length);
    const nextEnd = nextSpace === -1 ? full.length : nextSpace + 1;
    const t = setTimeout(() => setTextoMostrado(full.slice(0, nextEnd)), 25);
    return () => clearTimeout(t);
  }, [tipsTexto, textoMostrado]);

  const generarTips = useCallback(async () => {
    if (!uid) return;
    setEstadoIA("cargando");
    setTipsTexto(""); setTextoMostrado(""); tipsRef.current = "";

    // El servidor calcula el informe del motor (factores, alertas, tendencias)
    // a partir del uid; la IA redacta los tips sobre esos números.
    const res = await fetch("/api/tips", {
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
          tipsRef.current += chunk;
          setTipsTexto(tipsRef.current);
        } else if (line.startsWith("3:")) {
          tipsRef.current += "\nNo se pudieron generar los tips: el servicio de IA no respondió. Probá de nuevo en un momento.";
          setTipsTexto(tipsRef.current);
        }
      }
    }
    setEstadoIA("listo");
  }, [uid]);

  const articulosFiltrados = categoriaFiltro === "Todos"
    ? ARTICULOS
    : ARTICULOS.filter((a) => a.categoria === categoriaFiltro);

  if (!uid || cargando) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Cargando...</span>
      </div>
    );
  }

  const tieneDatos = metricas.length > 0;

  return (
    <div className="space-y-8 animate-fade-in">

      {/* ── Tips personalizados ────────────────────────────────────────────── */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Para ti hoy
        </h3>

        {estadoIA === "idle" && (
          <button
            onClick={generarTips}
            className="w-full flex flex-col items-center gap-2 py-6 rounded-xl border border-purple/25 bg-purple/5 hover:bg-purple/10 transition-all"
          >
            <Sparkles className="h-6 w-6 text-purple" />
            <div className="text-center">
              <p className="text-sm font-semibold text-purple">
                {tieneDatos ? "Generar tips personalizados" : "Generar tips generales"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {tieneDatos
                  ? "Basados en tus tendencias, alertas y factores de riesgo"
                  : "Registra métricas para tips más precisos"}
              </p>
            </div>
          </button>
        )}

        {estadoIA === "cargando" && (
          <div className="rounded-xl border border-purple/20 bg-purple/5 p-5 flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-purple shrink-0" />
            <span className="text-sm text-muted-foreground">Analizando tu perfil...</span>
          </div>
        )}

        {(estadoIA === "streaming" || estadoIA === "listo") && (
          <div className="rounded-xl border border-purple/20 bg-surface p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-purple" />
                <span className="text-xs font-semibold text-purple uppercase tracking-widest">
                  Tips del día
                </span>
              </div>
              {estadoIA === "listo" && (
                <button
                  onClick={generarTips}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Regenerar tips"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="space-y-0.5">
              {renderMarkdown(textoMostrado)}
              {estadoIA === "streaming" && (
                <span className="inline-block w-0.5 h-3.5 bg-purple animate-blink ml-0.5 align-middle" />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Artículos ─────────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Artículos de salud
        </h3>

        {/* Filtro de categorías */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-4 no-scrollbar">
          {CATEGORIAS.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoriaFiltro(cat)}
              className={cn(
                "shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-all",
                categoriaFiltro === cat
                  ? "bg-teal/15 text-teal border-teal/30"
                  : "bg-surface-2 text-muted-foreground border-border hover:border-border/80 hover:text-foreground"
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Cards */}
        <div className="space-y-3">
          {articulosFiltrados.map((art) => (
            <ArticuloCard
              key={art.id}
              art={art}
              expandido={expandidoId === art.id}
              onToggle={() => setExpandidoId(expandidoId === art.id ? null : art.id)}
            />
          ))}
        </div>

        <p className="text-[10px] text-muted-foreground/50 text-center mt-4">
          Contenido informativo. No reemplaza la consulta médica profesional.
        </p>
      </div>

    </div>
  );
}
