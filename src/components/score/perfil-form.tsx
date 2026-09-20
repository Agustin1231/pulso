"use client";

import { useEffect, useState } from "react";
import { UserRound, Pencil, X, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPerfil, guardarPerfil } from "@/lib/db/perfil";
import type { PerfilRow, Sexo } from "@/lib/db/types";

interface Props {
  uid:        string;
  onGuardado?: () => void;
}

const SEXOS: { valor: Sexo; label: string }[] = [
  { valor: "f",    label: "Femenino" },
  { valor: "m",    label: "Masculino" },
  { valor: "otro", label: "Otro" },
];

const inputCls =
  "w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-foreground " +
  "placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-coral";

function chip(activo: boolean) {
  return cn(
    "flex-1 text-xs font-medium px-2 py-1.5 rounded-lg border transition-all",
    activo
      ? "bg-coral/10 text-coral border-coral/30"
      : "bg-surface-2 text-muted-foreground border-border hover:text-foreground"
  );
}

/**
 * Perfil anónimo mínimo para el motor de riesgo: edad y sexo (contexto),
 * altura (IMC) y tabaquismo. Todo opcional; lo que falte se excluye del índice.
 */
export function PerfilForm({ uid, onGuardado }: Props) {
  const [perfil,    setPerfil]    = useState<PerfilRow | null | undefined>(undefined);
  const [editando,  setEditando]  = useState(false);
  const [edad,      setEdad]      = useState("");
  const [sexo,      setSexo]      = useState<Sexo | "">("");
  const [altura,    setAltura]    = useState("");
  const [fumador,   setFumador]   = useState<"" | "si" | "no">("");
  const [guardando, setGuardando] = useState(false);
  const [ok,        setOk]        = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  useEffect(() => {
    getPerfil(uid).then((p) => {
      setPerfil(p);
      if (!p) setEditando(true);
    });
  }, [uid]);

  function abrir() {
    setEdad(perfil?.edad != null ? String(perfil.edad) : "");
    setSexo(perfil?.sexo ?? "");
    setAltura(perfil?.altura_cm != null ? String(perfil.altura_cm) : "");
    setFumador(perfil?.fumador == null ? "" : perfil.fumador ? "si" : "no");
    setError(null);
    setEditando(true);
  }

  async function guardar() {
    const data = {
      edad:      edad !== "" ? Number(edad) : null,
      sexo:      sexo === "" ? null : sexo,
      altura_cm: altura !== "" ? Number(altura) : null,
      fumador:   fumador === "" ? null : fumador === "si",
    };
    if (data.edad !== null && (!Number.isInteger(data.edad) || data.edad < 18 || data.edad > 120)) {
      setError("La edad tiene que estar entre 18 y 120.");
      return;
    }
    if (data.altura_cm !== null && (!Number.isInteger(data.altura_cm) || data.altura_cm < 100 || data.altura_cm > 250)) {
      setError("La altura tiene que estar entre 100 y 250 cm.");
      return;
    }
    setError(null);
    setGuardando(true);
    const res = await guardarPerfil(uid, data);
    setGuardando(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setPerfil({ uid, ...data, actualizado_at: new Date().toISOString() });
    setOk(true);
    setTimeout(() => {
      setOk(false);
      setEditando(false);
      onGuardado?.();
    }, 800);
  }

  if (perfil === undefined) return null;

  // ── vista resumen ──────────────────────────────────────────────────────────
  if (!editando) {
    const partes: string[] = [];
    if (perfil?.edad != null) partes.push(`${perfil.edad} años`);
    if (perfil?.sexo) partes.push(SEXOS.find((s) => s.valor === perfil.sexo)?.label ?? perfil.sexo);
    if (perfil?.altura_cm != null) partes.push(`${perfil.altura_cm} cm`);
    if (perfil?.fumador != null) partes.push(perfil.fumador ? "Fuma" : "No fuma");
    const faltan = 4 - partes.length;

    return (
      <div className="rounded-xl border border-border bg-surface px-4 py-3 flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue/10">
          <UserRound className="h-4 w-4 text-blue" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {partes.length ? partes.join(" · ") : "Perfil sin completar"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {faltan > 0
              ? `Faltan ${faltan} dato${faltan > 1 ? "s" : ""}: completalos para incluir IMC, tabaquismo y contexto en el índice`
              : "Se usa para IMC, tabaquismo y el contexto de edad y sexo"}
          </p>
        </div>
        <button onClick={abrir} title="Editar perfil" className="text-muted-foreground hover:text-foreground transition-colors">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // ── vista edición ──────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-2">
        <div>
          <p className="text-sm font-bold">Tu perfil</p>
          <p className="text-xs text-muted-foreground">Todo es opcional y anónimo. Sirve para IMC, tabaquismo y contexto.</p>
        </div>
        {perfil && (
          <button onClick={() => setEditando(false)} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="p-4 grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Edad</label>
          <div className="relative">
            <input type="number" inputMode="numeric" min={18} max={120} placeholder="—"
              value={edad} onChange={(e) => setEdad(e.target.value)} className={cn(inputCls, "pr-12")} />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">años</span>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Altura</label>
          <div className="relative">
            <input type="number" inputMode="numeric" min={100} max={250} placeholder="—"
              value={altura} onChange={(e) => setAltura(e.target.value)} className={cn(inputCls, "pr-10")} />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">cm</span>
          </div>
        </div>
        <div className="col-span-2 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Sexo</label>
          <div className="flex gap-2">
            {SEXOS.map((s) => (
              <button key={s.valor} onClick={() => setSexo(sexo === s.valor ? "" : s.valor)} className={chip(sexo === s.valor)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="col-span-2 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">¿Fumás actualmente?</label>
          <div className="flex gap-2">
            <button onClick={() => setFumador(fumador === "no" ? "" : "no")} className={chip(fumador === "no")}>No</button>
            <button onClick={() => setFumador(fumador === "si" ? "" : "si")} className={chip(fumador === "si")}>Sí</button>
          </div>
        </div>
      </div>

      {error && <p className="px-4 pb-2 text-xs text-coral">{error}</p>}

      <div className="px-4 pb-4">
        <button
          onClick={guardar}
          disabled={guardando || ok}
          className={cn(
            "w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-all",
            ok
              ? "bg-green/15 text-green border border-green/30"
              : "bg-coral/10 text-coral border border-coral/30 hover:bg-coral/20 disabled:opacity-50"
          )}
        >
          {ok ? <><Check className="h-4 w-4" /> Guardado</>
            : guardando ? <Loader2 className="h-4 w-4 animate-spin" />
            : "Guardar perfil"}
        </button>
      </div>
    </div>
  );
}
