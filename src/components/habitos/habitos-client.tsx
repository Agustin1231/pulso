"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, X, Check, Loader2, ChevronRight, Pencil, Clock, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnonymousId } from "@/hooks/use-anonymous-id";
import { getRutinasGuardadas } from "@/lib/db/rutinas";
import type { RutinaRow, Ejercicio } from "@/lib/db/types";
import {
  getHabitosDefinicion, crearHabitoDefinicion, editarHabitoDefinicion, eliminarHabitoDefinicion,
  getHabitosFecha, getHabitosSemana, toggleHabitoFijo, toggleHabitoRegistro,
} from "@/lib/db/habitos";
import type { HabitoDefinicionRow, HabitoFormData, Frecuencia } from "@/lib/db/types";

// ─── constantes ───────────────────────────────────────────────────────────────

const DIAS_ES    = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const DIAS_KEY   = ["domingo","lunes","martes","miercoles","jueves","viernes","sabado"];
const DIAS_CORTOS = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const DIAS_CHIP  = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
const DIAS_CHIP_KEY = ["lunes","martes","miercoles","jueves","viernes","sabado","domingo"];
const MESES_ES   = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

const HABITOS_FIJOS = [
  { tipo: "hidratacion", emoji: "💧", label: "Hidratación" },
  { tipo: "alimentacion", emoji: "🥗", label: "Alimentación saludable" },
  { tipo: "sueno",        emoji: "😴", label: "Dormir bien" },
  { tipo: "medicamento",  emoji: "💊", label: "Medicamentos" },
] as const;

const EMOJIS_PICKER = ["🎯","💪","📚","🧘","🚶","🧴","🍎","🥑","☕","🌿","🫀","🧠","😊","⏰","🛁","🎵","✍️","🌅","🥛","🍵"];

const FREC_LABEL: Record<Frecuencia, string> = {
  diario:   "Diario",
  semanal:  "Semanal",
  mensual:  "Mensual",
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function hoyISO() { return new Date().toISOString().split("T")[0]; }

function getSemanaActual(): string[] {
  const hoy = new Date();
  const dow = hoy.getDay();
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lunes);
    d.setDate(lunes.getDate() + i);
    return d.toISOString().split("T")[0];
  });
}

function diaLabel(fecha: string) {
  return DIAS_CORTOS[new Date(fecha + "T12:00:00").getDay()];
}

function normalizar(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function ejerciciosDelDia(rutina: RutinaRow | null): Ejercicio[] {
  if (!rutina?.contenido.ejercicios) return [];
  const hoyDia = normalizar(DIAS_ES[new Date().getDay()]);
  return rutina.contenido.ejercicios.filter((e) => normalizar(e.bloque).includes(hoyDia));
}

function habitoEsHoy(h: HabitoDefinicionRow): boolean {
  if (h.frecuencia === "diario") return true;
  if (h.frecuencia === "semanal") {
    const hoyKey = DIAS_KEY[new Date().getDay()];
    return (h.dias_semana ?? []).includes(hoyKey);
  }
  if (h.frecuencia === "mensual") {
    return new Date().getDate() === (h.dia_mes ?? 1);
  }
  return true;
}

function frecuenciaResumen(h: HabitoDefinicionRow): string {
  if (h.frecuencia === "diario") return "Todos los días";
  if (h.frecuencia === "semanal") {
    const dias = (h.dias_semana ?? [])
      .map((k) => DIAS_CHIP[DIAS_CHIP_KEY.indexOf(k)])
      .filter(Boolean);
    return dias.length ? dias.join(", ") : "Sin días seleccionados";
  }
  if (h.frecuencia === "mensual") return `Día ${h.dia_mes ?? 1} de cada mes`;
  return "";
}

// ─── form data vacío ─────────────────────────────────────────────────────────

function formVacio(): HabitoFormData {
  return { nombre: "", emoji: "🎯", frecuencia: "diario", hora: null, lugar: null, dias_semana: [], dia_mes: null };
}

function formDesdeRow(h: HabitoDefinicionRow): HabitoFormData {
  return {
    nombre: h.nombre, emoji: h.emoji, frecuencia: h.frecuencia,
    hora: h.hora, lugar: h.lugar,
    dias_semana: h.dias_semana ?? [], dia_mes: h.dia_mes,
  };
}

// ─── ToggleItem ───────────────────────────────────────────────────────────────

function ToggleItem({
  emoji, label, sublabel, done, onToggle, cargando = false, onEdit,
}: {
  emoji: string; label: string; sublabel?: string;
  done: boolean; onToggle: () => void; cargando?: boolean;
  onEdit?: () => void;
}) {
  return (
    <div className={cn(
      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all group",
      done ? "border-teal/30 bg-teal/8" : "border-border bg-surface hover:border-border/80 hover:bg-surface-2"
    )}>
      <button onClick={onToggle} disabled={cargando}
        className="flex items-center gap-3 flex-1 text-left min-w-0 active:scale-[0.98]">
        <div className={cn(
          "h-6 w-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
          done ? "border-teal bg-teal" : "border-border"
        )}>
          {cargando
            ? <Loader2 className="h-3 w-3 animate-spin text-background" />
            : done && <Check className="h-3 w-3 text-background" strokeWidth={3} />}
        </div>
        <span className="text-base shrink-0">{emoji}</span>
        <div className="flex-1 min-w-0">
          <p className={cn("text-sm transition-colors", done ? "line-through text-muted-foreground" : "text-foreground")}>
            {label}
          </p>
          {sublabel && <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>}
        </div>
      </button>
      {onEdit && (
        <button onClick={onEdit}
          className="shrink-0 p-1 text-muted-foreground/40 hover:text-foreground md:text-muted-foreground/0 md:group-hover:text-muted-foreground transition-colors">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ─── HabitoForm (crear y editar) ──────────────────────────────────────────────

function HabitoForm({
  inicial, onGuardar, onCancelar, guardando,
}: {
  inicial: HabitoFormData;
  onGuardar: (data: HabitoFormData) => Promise<void>;
  onCancelar: () => void;
  guardando: boolean;
}) {
  const [form, setForm] = useState<HabitoFormData>(inicial);

  function set<K extends keyof HabitoFormData>(k: K, v: HabitoFormData[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  function toggleDia(key: string) {
    set("dias_semana", form.dias_semana.includes(key)
      ? form.dias_semana.filter((d) => d !== key)
      : [...form.dias_semana, key]);
  }

  return (
    <div className="rounded-xl border border-coral/30 bg-surface p-4 space-y-4 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{inicial.nombre ? "Editar hábito" : "Nuevo hábito"}</p>
        <button onClick={onCancelar} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Emoji */}
      <div>
        <p className="text-xs text-muted-foreground mb-2">Emoji</p>
        <div className="flex flex-wrap gap-1.5">
          {EMOJIS_PICKER.map((e) => (
            <button key={e} onClick={() => set("emoji", e)}
              className={cn("text-lg h-9 w-9 rounded-lg flex items-center justify-center transition-all",
                form.emoji === e ? "bg-coral/20 ring-1 ring-coral/40" : "bg-surface-2 hover:bg-surface-2/80"
              )}>{e}</button>
          ))}
        </div>
      </div>

      {/* Nombre */}
      <input
        type="text" placeholder="Nombre del hábito"
        value={form.nombre} onChange={(e) => set("nombre", e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && form.nombre.trim()) onGuardar(form); }}
        maxLength={40} autoFocus
        className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-coral placeholder:text-muted-foreground"
      />

      {/* Frecuencia */}
      <div>
        <p className="text-xs text-muted-foreground mb-2">Frecuencia</p>
        <div className="flex gap-2">
          {(["diario","semanal","mensual"] as Frecuencia[]).map((f) => (
            <button key={f} onClick={() => set("frecuencia", f)}
              className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all",
                form.frecuencia === f
                  ? "bg-coral/10 border-coral/40 text-coral"
                  : "border-border bg-surface-2 text-muted-foreground hover:text-foreground"
              )}
            >{FREC_LABEL[f]}</button>
          ))}
        </div>

        {/* Días de la semana */}
        {form.frecuencia === "semanal" && (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground mb-2">¿Qué días?</p>
            <div className="flex gap-1.5">
              {DIAS_CHIP.map((d, i) => {
                const key = DIAS_CHIP_KEY[i];
                const sel = form.dias_semana.includes(key);
                return (
                  <button key={key} onClick={() => toggleDia(key)}
                    className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all",
                      sel ? "bg-teal/15 border-teal/40 text-teal" : "border-border bg-surface-2 text-muted-foreground"
                    )}>{d}</button>
                );
              })}
            </div>
          </div>
        )}

        {/* Día del mes */}
        {form.frecuencia === "mensual" && (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground mb-2">¿Qué día del mes?</p>
            <div className="relative max-w-[120px]">
              <input
                type="number" min={1} max={28}
                placeholder="Ej: 1"
                value={form.dia_mes ?? ""}
                onChange={(e) => set("dia_mes", e.target.value ? parseInt(e.target.value) : null)}
                className="w-full rounded-lg bg-surface-2 border border-border px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-coral pr-8"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">/ mes</span>
            </div>
          </div>
        )}
      </div>

      {/* Hora */}
      <div>
        <p className="text-xs text-muted-foreground mb-2">Hora <span className="text-muted-foreground/60">(opcional)</span></p>
        <div className="relative max-w-[140px]">
          <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="time"
            value={form.hora ?? ""}
            onChange={(e) => set("hora", e.target.value || null)}
            className="w-full rounded-lg bg-surface-2 border border-border pl-8 pr-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-coral"
          />
        </div>
      </div>

      {/* Lugar */}
      <div>
        <p className="text-xs text-muted-foreground mb-2">Lugar <span className="text-muted-foreground/60">(opcional)</span></p>
        <div className="relative">
          <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text" placeholder="Ej: Gimnasio, Casa, Parque..."
            value={form.lugar ?? ""}
            onChange={(e) => set("lugar", e.target.value || null)}
            maxLength={40}
            className="w-full rounded-lg bg-surface-2 border border-border pl-8 pr-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-coral placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Guardar */}
      <button
        onClick={() => onGuardar(form)}
        disabled={!form.nombre.trim() || (form.frecuencia === "semanal" && form.dias_semana.length === 0) || guardando}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-coral/10 text-coral border border-coral/30 text-sm font-semibold hover:bg-coral/20 transition-all disabled:opacity-50"
      >
        {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="h-4 w-4" /> Guardar</>}
      </button>
    </div>
  );
}

// ─── componente principal ─────────────────────────────────────────────────────

export function HabitosClient() {
  const uid = useAnonymousId();
  const [tab, setTab] = useState<"hoy" | "semana" | "gestionar">("hoy");

  const [rutinaActiva, setRutinaActiva] = useState<RutinaRow | null>(null);
  const [habitosDef, setHabitosDef] = useState<HabitoDefinicionRow[]>([]);
  const [cargando, setCargando] = useState(true);

  const [fijosDone, setFijosDone] = useState<Set<string>>(new Set());
  const [registroDone, setRegistroDone] = useState<Set<string>>(new Set());
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  const [semanaData, setSemanaData] = useState<Record<string, number>>({});
  const [cargandoSemana, setCargandoSemana] = useState(false);

  // form
  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [formInicial, setFormInicial] = useState<HabitoFormData>(formVacio());
  const [guardando, setGuardando] = useState(false);

  const fecha = hoyISO();

  // ── carga inicial ───────────────────────────────────────────────────────────
  const cargarDatos = useCallback(async () => {
    if (!uid) return;
    setCargando(true);
    const [rutinas, defs, { fijos, registro }] = await Promise.all([
      getRutinasGuardadas(uid),
      getHabitosDefinicion(uid),
      getHabitosFecha(uid, fecha),
    ]);
    setRutinaActiva(rutinas[0] ?? null);
    setHabitosDef(defs);
    setFijosDone(new Set(fijos.filter((f) => f.completado).map((f) => f.tipo)));
    setRegistroDone(new Set(registro.map((r) => r.ref_id)));
    setCargando(false);
  }, [uid, fecha]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  const cargarSemana = useCallback(async () => {
    if (!uid) return;
    setCargandoSemana(true);
    const dias = getSemanaActual();
    const { fijos, registro } = await getHabitosSemana(uid, dias[0], dias[6]);
    const conteo: Record<string, number> = {};
    dias.forEach((d) => { conteo[d] = 0; });
    fijos.filter((f) => f.completado).forEach((f) => { conteo[f.fecha] = (conteo[f.fecha] ?? 0) + 1; });
    registro.forEach((r) => { conteo[r.fecha] = (conteo[r.fecha] ?? 0) + 1; });
    setSemanaData(conteo);
    setCargandoSemana(false);
  }, [uid]);

  useEffect(() => { if (tab === "semana") cargarSemana(); }, [tab, cargarSemana]);

  // ── toggles ─────────────────────────────────────────────────────────────────
  async function toggleFijo(tipo: string) {
    const key = `fijo-${tipo}`;
    if (toggling.has(key)) return;
    const done = !fijosDone.has(tipo);
    setFijosDone((prev) => { const n = new Set(prev); done ? n.add(tipo) : n.delete(tipo); return n; });
    setToggling((prev) => new Set(prev).add(key));
    await toggleHabitoFijo(uid!, fecha, tipo, done);
    setToggling((prev) => { const n = new Set(prev); n.delete(key); return n; });
  }

  async function toggleRegistro(refId: string, tipo: string) {
    const key = `reg-${refId}`;
    if (toggling.has(key)) return;
    const done = !registroDone.has(refId);
    setRegistroDone((prev) => { const n = new Set(prev); done ? n.add(refId) : n.delete(refId); return n; });
    setToggling((prev) => new Set(prev).add(key));
    await toggleHabitoRegistro(uid!, fecha, tipo, refId, done);
    setToggling((prev) => { const n = new Set(prev); n.delete(key); return n; });
  }

  // ── form handlers ────────────────────────────────────────────────────────────
  function abrirCrear() {
    setEditandoId(null);
    setFormInicial(formVacio());
    setMostrandoForm(true);
  }

  function abrirEditar(h: HabitoDefinicionRow) {
    setEditandoId(h.id);
    setFormInicial(formDesdeRow(h));
    setMostrandoForm(true);
  }

  function cerrarForm() {
    setMostrandoForm(false);
    setEditandoId(null);
  }

  async function handleGuardar(data: HabitoFormData) {
    if (!uid) return;
    setGuardando(true);
    if (editandoId) {
      await editarHabitoDefinicion(editandoId, data);
    } else {
      await crearHabitoDefinicion(uid, data);
    }
    await cargarDatos();
    cerrarForm();
    setGuardando(false);
  }

  async function handleEliminar(id: string) {
    await eliminarHabitoDefinicion(id);
    setHabitosDef((prev) => prev.filter((h) => h.id !== id));
  }

  // ── derivados ────────────────────────────────────────────────────────────────
  const ejHoy = ejerciciosDelDia(rutinaActiva);
  const habitosHoy = habitosDef.filter(habitoEsHoy);
  const totalHoy = HABITOS_FIJOS.length + habitosHoy.length + ejHoy.length;
  const completadosHoy =
    [...fijosDone].length +
    [...registroDone].filter((r) => ejHoy.some((e) => `ej-${e.nombre}` === r) || habitosHoy.some((h) => h.id === r)).length;

  const hoyFecha = new Date();
  const hoyLabel = `${DIAS_ES[hoyFecha.getDay()]} ${hoyFecha.getDate()} de ${MESES_ES[hoyFecha.getMonth()]}`;

  if (!uid || cargando) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Cargando hábitos...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Tabs */}
      <div className="flex gap-1 bg-surface rounded-xl p-1 border border-border">
        {(["hoy","semana","gestionar"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("flex-1 py-1.5 rounded-lg text-sm font-medium transition-all",
              tab === t ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground"
            )}>
            {t === "hoy" ? "Hoy" : t === "semana" ? "Semana" : "Gestionar"}
          </button>
        ))}
      </div>

      {/* ─── Tab Hoy ───────────────────────────────────────────────── */}
      {tab === "hoy" && (
        <div className="space-y-5">

          {/* Header progreso */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">Hoy</p>
                <p className="text-base font-bold text-foreground capitalize">{hoyLabel}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-teal">{completadosHoy}</p>
                <p className="text-xs text-muted-foreground">de {totalHoy}</p>
              </div>
            </div>
            {totalHoy > 0 && (
              <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                <div className="h-full bg-teal rounded-full transition-all duration-500"
                  style={{ width: `${(completadosHoy / totalHoy) * 100}%` }} />
              </div>
            )}
          </div>

          {/* Rutina */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Rutina de hoy</h3>
            {rutinaActiva === null ? (
              <div className="rounded-xl border border-dashed border-border bg-surface p-4 text-center space-y-2">
                <p className="text-sm text-muted-foreground">Sin rutina activa</p>
                <a href="/rutinas" className="text-xs text-coral hover:underline inline-flex items-center gap-1">
                  Genera una rutina <ChevronRight className="h-3 w-3" />
                </a>
              </div>
            ) : ejHoy.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface p-4 text-center">
                <p className="text-sm text-muted-foreground">Hoy es día de descanso 🧘</p>
              </div>
            ) : (
              <div className="space-y-2">
                {ejHoy.map((ej) => {
                  const refId = `ej-${ej.nombre}`;
                  return (
                    <ToggleItem key={refId} emoji="🏋️"
                      label={ej.nombre} sublabel={ej.detalle}
                      done={registroDone.has(refId)} cargando={toggling.has(`reg-${refId}`)}
                      onToggle={() => toggleRegistro(refId, "ejercicio")} />
                  );
                })}
              </div>
            )}
          </div>

          {/* Hábitos */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Hábitos</h3>
              <button onClick={abrirCrear}
                className="flex items-center gap-1 text-xs text-coral hover:text-coral/80 transition-colors">
                <Plus className="h-3.5 w-3.5" /> Nuevo
              </button>
            </div>

            <div className="space-y-2">
              {HABITOS_FIJOS.map((h) => (
                <ToggleItem key={h.tipo} emoji={h.emoji} label={h.label}
                  done={fijosDone.has(h.tipo)} cargando={toggling.has(`fijo-${h.tipo}`)}
                  onToggle={() => toggleFijo(h.tipo)} />
              ))}

              {habitosHoy.map((h) => {
                if (editandoId === h.id) {
                  return (
                    <HabitoForm key={h.id} inicial={formInicial}
                      onGuardar={handleGuardar} onCancelar={cerrarForm} guardando={guardando} />
                  );
                }
                const sublabel = [
                  h.hora ? `⏰ ${h.hora}` : null,
                  h.lugar ? `📍 ${h.lugar}` : null,
                ].filter(Boolean).join("  ");
                return (
                  <ToggleItem key={h.id} emoji={h.emoji} label={h.nombre}
                    sublabel={sublabel || undefined}
                    done={registroDone.has(h.id)} cargando={toggling.has(`reg-${h.id}`)}
                    onToggle={() => toggleRegistro(h.id, "habito_custom")}
                    onEdit={() => abrirEditar(h)} />
                );
              })}

              {habitosDef.length === 0 && (
                <button onClick={abrirCrear}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-dashed border-border bg-surface text-muted-foreground hover:border-coral/30 hover:text-foreground transition-all">
                  <div className="h-6 w-6 rounded-full border-2 border-dashed border-border flex items-center justify-center shrink-0">
                    <Plus className="h-3 w-3" />
                  </div>
                  <span className="text-sm">Agrega tu primer hábito personalizado</span>
                </button>
              )}
            </div>
          </div>

          {mostrandoForm && !editandoId && (
            <HabitoForm inicial={formInicial} onGuardar={handleGuardar} onCancelar={cerrarForm} guardando={guardando} />
          )}
        </div>
      )}

      {/* ─── Tab Semana ────────────────────────────────────────────── */}
      {tab === "semana" && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">Completados por día esta semana</p>
          {cargandoSemana ? (
            <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Cargando...</span>
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-2">
              {getSemanaActual().map((d) => {
                const isHoy = d === hoyISO();
                const count = semanaData[d] ?? 0;
                return (
                  <div key={d} className="flex flex-col items-center gap-2">
                    <span className={cn("text-xs font-medium", isHoy ? "text-teal" : "text-muted-foreground")}>
                      {diaLabel(d)}
                    </span>
                    <div className={cn(
                      "h-12 w-12 rounded-full flex items-center justify-center border-2 transition-all",
                      isHoy && !count ? "border-teal/40 bg-teal/5" :
                      count ? "border-teal bg-teal/15" : "border-border bg-surface"
                    )}>
                      {count ? <span className="text-sm font-bold text-teal">{count}</span>
                             : <span className="text-muted-foreground/40 text-xs">—</span>}
                    </div>
                    {isHoy && <div className="h-1.5 w-1.5 rounded-full bg-teal" />}
                  </div>
                );
              })}
            </div>
          )}
          <div className="rounded-xl border border-border bg-surface p-3">
            <p className="text-xs text-muted-foreground text-center">
              El número indica cuántos hábitos + ejercicios completaste ese día
            </p>
          </div>
        </div>
      )}

      {/* ─── Tab Gestionar ─────────────────────────────────────────── */}
      {tab === "gestionar" && (
        <div className="space-y-4">

          {/* Predefinidos */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Predefinidos</h3>
            <div className="space-y-2">
              {HABITOS_FIJOS.map((h) => (
                <div key={h.tipo} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-surface">
                  <span className="text-base">{h.emoji}</span>
                  <span className="text-sm text-foreground flex-1">{h.label}</span>
                  <span className="text-xs text-muted-foreground bg-surface-2 px-2 py-0.5 rounded-full">Diario</span>
                </div>
              ))}
            </div>
          </div>

          {/* Custom */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Mis hábitos</h3>
              <button onClick={abrirCrear}
                className="flex items-center gap-1 text-xs text-coral hover:text-coral/80 transition-colors">
                <Plus className="h-3.5 w-3.5" /> Nuevo
              </button>
            </div>

            {mostrandoForm && (
              <div className="mb-3">
                <HabitoForm inicial={formInicial} onGuardar={handleGuardar} onCancelar={cerrarForm} guardando={guardando} />
              </div>
            )}

            {habitosDef.length === 0 && !mostrandoForm ? (
              <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center">
                <p className="text-sm text-muted-foreground mb-1">Sin hábitos personalizados</p>
                <p className="text-xs text-muted-foreground">Toca &ldquo;Nuevo&rdquo; para agregar el primero</p>
              </div>
            ) : (
              <div className="space-y-2">
                {habitosDef.map((h) => (
                  <div key={h.id} className={cn(
                    "rounded-xl border bg-surface transition-all",
                    editandoId === h.id ? "border-coral/40" : "border-border"
                  )}>
                    {editandoId === h.id ? (
                      <div className="p-3">
                        <HabitoForm inicial={formInicial} onGuardar={handleGuardar} onCancelar={cerrarForm} guardando={guardando} />
                      </div>
                    ) : (
                      <div className="flex items-start gap-3 px-3 py-2.5 group">
                        <span className="text-base mt-0.5">{h.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground">{h.nombre}</p>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                            <span className="text-[10px] text-muted-foreground">{frecuenciaResumen(h)}</span>
                            {h.hora && <span className="text-[10px] text-muted-foreground">⏰ {h.hora}</span>}
                            {h.lugar && <span className="text-[10px] text-muted-foreground">📍 {h.lugar}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => abrirEditar(h)}
                            className="text-muted-foreground/0 group-hover:text-muted-foreground hover:text-foreground transition-colors p-1">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleEliminar(h.id)}
                            className="text-muted-foreground/0 group-hover:text-muted-foreground hover:text-coral transition-colors p-1">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
