"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Filter, Loader2, RefreshCw, ScrollText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  mensajeAdmin, nombrePermiso, type Correos, type EventoAuditoria, type Permiso, type UsuarioAdmin,
} from "@/lib/admin/tipos";
import { cn } from "@/lib/utils";
import { AvisoAdmin, Cargando, Chip, Panel, claseSelect, diferencia, duracion, fechaHora, pedir, quien } from "./comun";

/**
 * Pestaña "Auditoría" (integrador, punto 9): los eventos de la tabla
 * `auditoria`, del más nuevo al más viejo, con filtros. Los cambios del
 * administrador se muestran con su detalle: quién, qué, a quién, antes y después.
 */

interface Filtros {
  accion:    string;
  resultado: "" | "ok" | "denegado" | "error";
  usuario:   string;
  desde:     string;   // YYYY-MM-DD (hora local)
  hasta:     string;
}

const SIN_FILTROS: Filtros = { accion: "", resultado: "", usuario: "", desde: "", hasta: "" };

const ATAJOS: { texto: string; accion: string }[] = [
  { texto: "Todo",           accion: "" },
  { texto: "Administración", accion: "admin." },
  { texto: "Cuentas",        accion: "cuenta." },
  { texto: "Sesiones",       accion: "sesion." },
  { texto: "Datos",          accion: "datos." },
];

/** Día local → instante ISO (medianoche de ese día, o del siguiente para "hasta"). */
function instante(dia: string, siguiente = false): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return undefined;
  const d = new Date(`${dia}T00:00:00`);
  if (siguiente) d.setDate(d.getDate() + 1);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function consulta(f: Filtros, antes?: number): string {
  const q = new URLSearchParams();
  if (f.accion.trim()) q.set("accion", f.accion.trim().toLowerCase());
  if (f.resultado) q.set("resultado", f.resultado);
  if (f.usuario) q.set("usuario", f.usuario);
  const desde = instante(f.desde);
  const hasta = instante(f.hasta, true);
  if (desde) q.set("desde", desde);
  if (hasta) q.set("hasta", hasta);
  if (antes) q.set("antes", String(antes));
  return q.toString();
}

export function PestanaAuditoria({ permisos }: { permisos: readonly Permiso[] }) {
  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS);
  const [accionEscrita, setAccionEscrita] = useState("");
  const [eventos, setEventos] = useState<EventoAuditoria[] | null>(null);
  const [correos, setCorreos] = useState<Correos>({});
  const [siguiente, setSiguiente] = useState<number | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usuarios, setUsuarios] = useState<{ uid: string; correo: string }[]>([]);

  // Para filtrar por usuario hace falta poder listarlos (usuarios.ver).
  const puedeListarUsuarios = permisos.includes("usuarios.ver");
  useEffect(() => {
    if (!puedeListarUsuarios) return;
    void pedir<{ usuarios: UsuarioAdmin[]; correos: Correos }>("/api/admin/usuarios").then((r) => {
      if (!r.ok) return;
      setUsuarios(
        r.datos.usuarios
          .map((u) => ({ uid: u.uid, correo: r.datos.correos[u.uid] ?? u.uid }))
          .sort((a, b) => a.correo.localeCompare(b.correo))
      );
    });
  }, [puedeListarUsuarios]);

  const cargar = useCallback(async (f: Filtros, antes?: number) => {
    setCargando(true);
    const r = await pedir<{ eventos: EventoAuditoria[]; correos: Correos; siguiente: number | null }>(
      `/api/admin/auditoria?${consulta(f, antes)}`
    );
    setCargando(false);
    if (!r.ok) {
      setError(mensajeAdmin(r.error));
      return;
    }
    setError(null);
    setEventos((previos) => (antes && previos ? [...previos, ...r.datos.eventos] : r.datos.eventos));
    setCorreos((c) => (antes ? { ...c, ...r.datos.correos } : r.datos.correos));
    setSiguiente(r.datos.siguiente);
  }, []);

  useEffect(() => {
    void cargar(filtros);
  }, [filtros, cargar]);

  const cambiar = (parcial: Partial<Filtros>) => setFiltros((f) => ({ ...f, ...parcial }));
  const hayFiltros = JSON.stringify(filtros) !== JSON.stringify(SIN_FILTROS);

  return (
    <div className="space-y-4">
      <Panel
        icono={Filter}
        titulo="Filtros"
        acciones={
          <>
            {hayFiltros && (
              <Button variant="ghost" size="sm" onClick={() => { setFiltros(SIN_FILTROS); setAccionEscrita(""); }}>
                <X className="h-3.5 w-3.5" /> Limpiar
              </Button>
            )}
            <Button variant="ghost" size="sm" disabled={cargando} onClick={() => void cargar(filtros)}>
              <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} /> Actualizar
            </Button>
          </>
        }
      >
        <div className="mb-3 flex flex-wrap gap-1.5">
          {ATAJOS.map((a) => (
            <button
              key={a.texto}
              type="button"
              onClick={() => { cambiar({ accion: a.accion }); setAccionEscrita(a.accion); }}
              className={cn(
                "rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors",
                filtros.accion === a.accion
                  ? "border-teal/40 bg-teal/10 text-teal-light"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {a.texto}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <form onSubmit={(e) => { e.preventDefault(); cambiar({ accion: accionEscrita }); }} className="space-y-1">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-foreground">Acción (empieza con)</span>
              <input
                value={accionEscrita}
                onChange={(e) => setAccionEscrita(e.target.value)}
                onBlur={() => cambiar({ accion: accionEscrita })}
                placeholder="admin.rol"
                maxLength={60}
                className={claseSelect}
              />
            </label>
          </form>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-foreground">Resultado</span>
            <select value={filtros.resultado} onChange={(e) => cambiar({ resultado: e.target.value as Filtros["resultado"] })}
                    className={claseSelect}>
              <option value="">Todos</option>
              <option value="ok">Correcto</option>
              <option value="denegado">Denegado</option>
              <option value="error">Error</option>
            </select>
          </label>
          {puedeListarUsuarios && (
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-foreground">Usuario</span>
              <select value={filtros.usuario} onChange={(e) => cambiar({ usuario: e.target.value })} className={claseSelect}>
                <option value="">Todos</option>
                {usuarios.map((u) => <option key={u.uid} value={u.uid}>{u.correo}</option>)}
              </select>
            </label>
          )}
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-foreground">Desde</span>
            <input type="date" value={filtros.desde} onChange={(e) => cambiar({ desde: e.target.value })} className={claseSelect} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-foreground">Hasta</span>
            <input type="date" value={filtros.hasta} onChange={(e) => cambiar({ hasta: e.target.value })} className={claseSelect} />
          </label>
        </div>
        {filtros.usuario && !puedeListarUsuarios && (
          <p className="mt-2 text-[11px] text-muted-foreground">Filtrando por {quien(filtros.usuario, correos)}.</p>
        )}
      </Panel>

      <Panel
        icono={ScrollText}
        titulo="Eventos"
        descripcion="Del más nuevo al más viejo. La auditoría no se puede modificar ni borrar (ni siquiera el dueño de la base). Las IP se guardan recortadas."
      >
        {error && <AvisoAdmin tipo="error" className="mb-3">{error}</AvisoAdmin>}
        {eventos === null ? (
          <Cargando texto="Cargando eventos…" />
        ) : eventos.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No hay eventos con estos filtros.</p>
        ) : (
          <ul className="divide-y divide-border">
            {eventos.map((e) => (
              <li key={e.id}>
                <FilaEvento evento={e} correos={correos} onUsuario={(uid) => cambiar({ usuario: uid })} />
              </li>
            ))}
          </ul>
        )}
        {siguiente && (
          <div className="mt-3 flex justify-center">
            <Button variant="secondary" size="sm" disabled={cargando} onClick={() => void cargar(filtros, siguiente)}>
              {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Cargar más
            </Button>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ─── Un evento ────────────────────────────────────────────────────────────────

function etiquetaAccion(accion: string): string {
  switch (accion) {
    case "admin.rol.crear":            return "Creó un rol";
    case "admin.rol.editar":           return "Editó un rol";
    case "admin.rol.borrar":           return "Borró un rol";
    case "admin.usuario.acceso":       return "Cambió roles y permisos de un usuario";
    case "admin.usuario.contrasena":   return "Cambió la contraseña de un usuario";
    case "admin.configuracion.fijar":  return "Cambió la configuración de la sesión";
    case "admin.rol.asignar_sistema":  return "Rol Administrador asignado por el dueño de la base";
    case "admin.errores.forzar":       return "Forzó un error de prueba";
    case "admin.usuarios.ver":         return "Ver usuarios";
    case "admin.roles.ver":            return "Ver roles";
    case "admin.auditoria.ver":        return "Ver auditoría";
    case "admin.errores.ver":          return "Ver errores";
    case "admin.configuracion.ver":    return "Ver configuración";
    case "admin.permisos":             return "Consultar permisos";
    case "cuenta.login":               return "Inicio de sesión";
    case "cuenta.registrar":           return "Registro de cuenta";
    case "cuenta.activar":             return "Activación de cuenta";
    case "cuenta.recuperar":           return "Pidió recuperar la contraseña";
    case "cuenta.restablecer":         return "Restableció la contraseña";
    case "cuenta.fusionar":            return "Datos de este equipo sumados a la cuenta";
    case "cuenta.bloquear":            return "Cuenta bloqueada por intentos fallidos";
    case "cuenta.reenviar":            return "Pidió otro enlace de activación";
    case "cuenta.cambiar_contrasena":  return "Cambió su contraseña desde el perfil";
    case "cuenta.cambiar_correo":      return "Pidió cambiar su correo";
    case "cuenta.confirmar_correo":    return "Confirmó su correo nuevo";
    case "sesion.crear":               return "Sesión nueva";
    case "sesion.rotar":               return "Rotación del token";
    case "sesion.reclamar":            return "Reclamo de identidad anterior";
    case "sesion.cerrar":              return "Cierre de sesión";
    case "sesion.vencer":              return "Token vencido por inactividad";
    case "sesion.revocar":             return "Sesión cerrada por inactividad";
    case "examen.subir":               return "Subió un examen";
    case "examen.descargar":           return "Abrió un examen";
    case "examen.eliminar":            return "Borró un examen";
    case "examen.listar":              return "Vio sus exámenes";
    case "datos.eliminar":             return "Borró todos sus datos";
    case "datos.purgar":               return "Purga por inactividad";
    case "datos.cifrar":               return "Migración: datos de salud cifrados";
    default:                           return accion;
  }
}

function textoMotivo(motivo: unknown): string {
  switch (motivo) {
    case "sin_permiso":               return "no tiene el permiso";
    case "sin_sesion":                return "sin sesión";
    case "privilegios_insuficientes": return "intentó otorgar o tocar permisos que no tiene";
    case "nombre_en_uso":             return "ya existe un rol con ese nombre";
    case "rol_de_sistema":            return "el rol Administrador no se modifica";
    case "ultimo_administrador":      return "era el último administrador";
    case "es_tu_cuenta":              return "su propia contraseña se cambia desde el perfil";
    case "contrasena_invalida":       return "la contraseña no cumple las reglas";
    case "fuera_de_rango":            return "valor fuera de los límites";
    case "datos_invalidos":           return "datos inválidos";
    case "no_encontrado":             return "no existe";
    case "cuenta_sin_activar":        return "la cuenta no está activada";
    case "credenciales":              return "correo o contraseña incorrectos";
    case "sin_verificar":             return "la cuenta no está activada";
    case "demasiadas_peticiones":     return "superó el límite de peticiones";
    case "origen_no_permitido":       return "petición desde otro sitio";
    case "sesion_requerida":          return "sin sesión";
    case "cuenta_requerida":          return "sin una cuenta iniciada";
    case "sesion_bloqueada":          return "la sesión estaba bloqueada";
    default:                          return typeof motivo === "string" ? motivo.replace(/_/g, " ") : "rechazado";
  }
}

function nombreConfig(clave: unknown): string {
  if (clave === "token_inactividad_minutos") return "la expiración del token por inactividad";
  if (clave === "sesion_inactividad_minutos") return "el cierre de la sesión por inactividad";
  return String(clave);
}

const lista = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

/** Chips de lo que se agregó (+) y lo que se quitó (−) en una lista. */
function Cambio({ titulo, antes, despues, nombre = (x: string) => x }: {
  titulo:  string;
  antes:   string[];
  despues: string[];
  nombre?: (x: string) => string;
}) {
  const { agregados, quitados } = diferencia(antes, despues);
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px]">
      <span className="font-semibold text-muted-foreground">{titulo}:</span>
      {agregados.length === 0 && quitados.length === 0 ? (
        <span className="text-muted-foreground">sin cambios ({despues.length ? despues.map(nombre).join(", ") : "ninguno"})</span>
      ) : (
        <>
          {agregados.map((x) => <Chip key={`+${x}`} tono="teal">+ {nombre(x)}</Chip>)}
          {quitados.map((x) => <Chip key={`-${x}`} tono="coral" className="line-through">− {nombre(x)}</Chip>)}
          <span className="text-muted-foreground">→ quedó: {despues.length ? despues.map(nombre).join(", ") : "ninguno"}</span>
        </>
      )}
    </div>
  );
}

function Descripcion({ evento, correos }: { evento: EventoAuditoria; correos: Correos }) {
  const d = obj(evento.detalle);
  const antes = obj(d.antes);
  const despues = obj(d.despues);
  const objetivo = evento.recurso === "usuario" ? quien(evento.recurso_id, correos) : null;

  if (evento.resultado === "denegado") {
    return (
      <p className="text-[11px] text-amber-light">
        Rechazado: {textoMotivo(d.motivo)}
        {typeof d.permiso === "string" && <> (hace falta {d.permiso.split(" o ").map(nombrePermiso).join(" o ")})</>}
        {objetivo && <> · sobre {objetivo}</>}
        {typeof d.nombre === "string" && <> · rol «{d.nombre}»</>}
        {lista(d.reglas).length > 0 && <> · {lista(d.reglas).join(" ")}</>}
      </p>
    );
  }
  if (evento.resultado === "error") {
    return <p className="text-[11px] text-coral-light">Error interno: la respuesta fue un mensaje genérico y el detalle quedó en el registro de errores.</p>;
  }

  switch (evento.accion) {
    case "admin.rol.crear":
      return (
        <div className="space-y-1">
          <p className="text-[11px] text-foreground">Rol «{String(despues.nombre)}»{despues.descripcion ? ` — ${String(despues.descripcion)}` : ""}</p>
          <Cambio titulo="Permisos" antes={[]} despues={lista(despues.permisos)} nombre={nombrePermiso} />
        </div>
      );
    case "admin.rol.editar":
      return (
        <div className="space-y-1">
          <p className="text-[11px] text-foreground">
            Rol «{String(antes.nombre)}»{antes.nombre !== despues.nombre && <> → renombrado a «{String(despues.nombre)}»</>}
            {typeof d.miembros_afectados === "number" && ` · afecta a ${d.miembros_afectados} ${d.miembros_afectados === 1 ? "usuario" : "usuarios"}`}
          </p>
          {antes.descripcion !== despues.descripcion && (
            <p className="text-[11px] text-muted-foreground">Descripción: «{String(antes.descripcion)}» → «{String(despues.descripcion)}»</p>
          )}
          <Cambio titulo="Permisos" antes={lista(antes.permisos)} despues={lista(despues.permisos)} nombre={nombrePermiso} />
        </div>
      );
    case "admin.rol.borrar": {
      const miembros = lista(antes.miembros);
      return (
        <div className="space-y-1">
          <p className="text-[11px] text-foreground">
            Rol «{String(antes.nombre)}»
            {miembros.length > 0 ? ` · se les quitó a: ${miembros.map((u) => quien(u, correos)).join(", ")}` : " · no tenía miembros"}
          </p>
          <Cambio titulo="Tenía los permisos" antes={[]} despues={lista(antes.permisos)} nombre={nombrePermiso} />
        </div>
      );
    }
    case "admin.usuario.acceso":
      return (
        <div className="space-y-1">
          <p className="text-[11px] text-foreground">Usuario: <strong>{objetivo}</strong></p>
          <Cambio titulo="Roles" antes={lista(antes.roles)} despues={lista(despues.roles)} />
          <Cambio titulo="Permisos directos" antes={lista(antes.directos)} despues={lista(despues.directos)} nombre={nombrePermiso} />
          <Cambio titulo="Permisos efectivos" antes={lista(antes.efectivos)} despues={lista(despues.efectivos)} nombre={nombrePermiso} />
        </div>
      );
    case "admin.usuario.contrasena":
      return (
        <p className="text-[11px] text-foreground">
          Usuario: <strong>{objetivo}</strong> · se cerraron {String(d.sesiones_revocadas ?? 0)} sesiones suyas. La contraseña no se registra.
        </p>
      );
    case "admin.configuracion.fijar":
      return (
        <p className="text-[11px] text-foreground">
          Cambió {nombreConfig(d.clave)}: <Chip tono="coral" className="line-through">{duracion(Number(d.antes))}</Chip>{" → "}
          <Chip tono="teal">{duracion(Number(d.despues))}</Chip>
        </p>
      );
    case "admin.rol.asignar_sistema":
      return <p className="text-[11px] text-foreground">Usuario: <strong>{objetivo}</strong> · vía {String(d.via ?? "dueño de la base")}</p>;
    default: {
      const claves = Object.entries(d).filter(([, v]) => typeof v !== "object" || v === null).slice(0, 4);
      if (!claves.length && !objetivo) return null;
      return (
        <p className="text-[11px] text-muted-foreground">
          {objetivo && <>Usuario: {objetivo} · </>}
          {claves.map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`).join(" · ")}
        </p>
      );
    }
  }
}

function FilaEvento({ evento, correos, onUsuario }: {
  evento:    EventoAuditoria;
  correos:   Correos;
  onUsuario: (uid: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const tono = evento.resultado === "ok" ? "teal" : evento.resultado === "denegado" ? "amber" : "coral";
  const admin = evento.accion.startsWith("admin.");
  return (
    <div className={cn("py-3", admin && evento.resultado === "ok" && "rounded-lg border-l-2 border-teal/50 pl-3")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Chip tono={tono}>{evento.resultado === "ok" ? "Correcto" : evento.resultado === "denegado" ? "Denegado" : "Error"}</Chip>
        <span className="text-xs font-semibold text-foreground">{etiquetaAccion(evento.accion)}</span>
        <code className="text-[10px] text-muted-foreground">{evento.accion}</code>
        <span className="ml-auto text-[10px] text-muted-foreground">{fechaHora(evento.ocurrido_at, true)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          Por:{" "}
          {evento.uid ? (
            <button type="button" className="font-semibold text-foreground hover:text-teal hover:underline"
                    title="Ver solo los eventos de este usuario" onClick={() => onUsuario(evento.uid!)}>
              {quien(evento.uid, correos)}
            </button>
          ) : (
            <span className="font-semibold text-foreground">{evento.accion.startsWith("admin.") || evento.accion === "datos.purgar" ? "Sistema (dueño de la base)" : "Anónimo"}</span>
          )}
        </span>
        {evento.ip && <span>IP: {evento.ip}</span>}
        <span>#{evento.id}</span>
      </div>
      <div className="mt-1.5">
        <Descripcion evento={evento} correos={correos} />
      </div>
      {evento.detalle && (
        <>
          <button type="button" onClick={() => setAbierto((a) => !a)}
                  className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("h-3 w-3 transition-transform", abierto && "rotate-180")} /> Detalle técnico
          </button>
          {abierto && (
            <pre className="mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-background p-2 text-[10px] leading-relaxed text-muted-foreground">
              {JSON.stringify({ recurso: evento.recurso, recurso_id: evento.recurso_id, ...evento.detalle }, null, 2)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
