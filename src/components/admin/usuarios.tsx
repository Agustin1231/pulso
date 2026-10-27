"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Check, KeyRound, Loader2, RefreshCw, Search, ShieldCheck, UserRound, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { problemasContrasena } from "@/lib/admin/contrasena";
import {
  mensajeAdmin, nombrePermiso,
  type Correos, type OrigenPermiso, type Permiso, type PermisoCatalogo, type RolAdmin, type UsuarioAdmin,
} from "@/lib/admin/tipos";
import { cn } from "@/lib/utils";
import {
  AvisoAdmin, CampoAdmin, Cargando, Casilla, Chip, Panel, fechaHora, haceCuanto, pedir, type TipoAviso,
} from "./comun";
import { recargarPermisosAdmin } from "./permisos-admin";

/**
 * Pestaña "Usuarios" (integrador, puntos 5, 7 y 8): la lista de cuentas y, en
 * el detalle de cada una, sus roles, TODOS sus permisos directos, los efectivos
 * con su origen (qué rol los da o si son directos) y el cambio de contraseña.
 */

interface Datos {
  usuarios: UsuarioAdmin[];
  correos:  Correos;
  roles:    RolAdmin[];
  catalogo: PermisoCatalogo[];
}

type Aviso = { tipo: TipoAviso; texto: React.ReactNode } | null;

export function PestanaUsuarios({ permisos }: { permisos: readonly Permiso[] }) {
  const puedeEditar = permisos.includes("usuarios.editar");
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [elegido, setElegidoInterno] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const setElegido = (uid: string | null) => {
    setElegidoInterno(uid);
    setGuardado(null);
  };

  const cargar = useCallback(async () => {
    setCargando(true);
    const [u, r] = await Promise.all([
      pedir<{ usuarios: UsuarioAdmin[]; correos: Correos }>("/api/admin/usuarios"),
      pedir<{ roles: RolAdmin[]; catalogo: PermisoCatalogo[] }>("/api/admin/roles"),
    ]);
    if (!u.ok || !r.ok) {
      setError(mensajeAdmin(!u.ok ? u.error : !r.ok ? r.error : undefined));
    } else {
      setError(null);
      setDatos({ usuarios: u.datos.usuarios, correos: u.datos.correos, roles: r.datos.roles, catalogo: r.datos.catalogo });
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    if (!datos) return [];
    const f = filtro.trim().toLowerCase();
    return datos.usuarios.filter((u) => !f || (datos.correos[u.uid] ?? "").toLowerCase().includes(f));
  }, [datos, filtro]);

  if (error && !datos) return <AvisoAdmin tipo="error">{error}</AvisoAdmin>;
  if (!datos) return <Cargando texto="Cargando usuarios…" />;

  const usuario = datos.usuarios.find((u) => u.uid === elegido) ?? null;

  function actualizado(nuevo: UsuarioAdmin, correos: Correos) {
    setGuardado(nuevo.uid);
    setDatos((d) => d && {
      ...d,
      usuarios: d.usuarios.map((u) => (u.uid === nuevo.uid ? nuevo : u)),
      correos:  { ...d.correos, ...correos },
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Lista (en el celular se oculta al abrir un usuario) */}
      <div className={cn("min-w-0", usuario && "hidden lg:block")}>
        <Panel
          icono={Users}
          titulo={`Usuarios (${datos.usuarios.length})`}
          descripcion="Cuentas con correo. Elige una para ver y editar sus roles y permisos."
          acciones={
            <Button variant="ghost" size="sm" onClick={() => void cargar()} disabled={cargando} title="Actualizar">
              <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} /> Actualizar
            </Button>
          }
        >
          <label className="relative mb-3 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar por correo"
              aria-label="Buscar por correo"
              className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-coral"
            />
          </label>
          {error && <AvisoAdmin tipo="error" className="mb-3">{error}</AvisoAdmin>}
          {visibles.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">Ningún usuario coincide.</p>
          ) : (
            <ul className="max-h-[32rem] space-y-1.5 overflow-y-auto pr-1">
              {visibles.map((u) => (
                <li key={u.uid}>
                  <FilaUsuario
                    usuario={u}
                    correo={datos.correos[u.uid] ?? null}
                    roles={datos.roles}
                    elegido={u.uid === elegido}
                    onElegir={() => setElegido(u.uid)}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Detalle */}
      <div className={cn("min-w-0", !usuario && "hidden lg:block")}>
        {usuario ? (
          <div className="space-y-4">
            <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setElegido(null)}>
              <ArrowLeft className="h-4 w-4" /> Volver a la lista
            </Button>
            <DetalleUsuario
              // Al cambiar de usuario (o al guardar) el formulario arranca de lo guardado.
              key={`${usuario.uid}:${usuario.roles.join(",")}:${usuario.directos.join(",")}`}
              usuario={usuario}
              correo={datos.correos[usuario.uid] ?? null}
              roles={datos.roles}
              catalogo={datos.catalogo}
              puedeEditar={puedeEditar}
              recienGuardado={guardado === usuario.uid}
              onGuardado={actualizado}
            />
            {puedeEditar && (
              <SeccionContrasena key={`clave:${usuario.uid}`} usuario={usuario} correo={datos.correos[usuario.uid] ?? null} />
            )}
          </div>
        ) : (
          <div className="flex h-full min-h-48 items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            Elige un usuario de la lista para ver su detalle.
          </div>
        )}
      </div>
    </div>
  );
}

function EstadoCuenta({ estado }: { estado: UsuarioAdmin["estado"] }) {
  return estado === "activa"
    ? <Chip tono="teal">Activa</Chip>
    : <Chip tono="amber">Sin activar</Chip>;
}

function FilaUsuario({ usuario, correo, roles, elegido, onElegir }: {
  usuario:  UsuarioAdmin;
  correo:   string | null;
  roles:    RolAdmin[];
  elegido:  boolean;
  onElegir: () => void;
}) {
  const susRoles = roles.filter((r) => usuario.roles.includes(r.id));
  return (
    <button
      type="button"
      onClick={onElegir}
      aria-current={elegido}
      className={cn(
        "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
        elegido ? "border-teal/40 bg-teal/5" : "border-border bg-surface-2/40 hover:border-muted"
      )}
    >
      <div className="flex items-center gap-2">
        <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{correo ?? "(sin correo)"}</span>
        {usuario.es_tu_cuenta && <Chip tono="blue">Tú</Chip>}
        <EstadoCuenta estado={usuario.estado} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {susRoles.length === 0 && usuario.directos.length === 0 && (
          <span className="text-[11px] text-muted-foreground">Sin roles ni permisos</span>
        )}
        {susRoles.map((r) => (
          <Chip key={r.id} tono={r.sistema ? "coral" : "purple"}>{r.nombre}</Chip>
        ))}
        {usuario.directos.length > 0 && (
          <Chip tono="blue">{usuario.directos.length} directo{usuario.directos.length === 1 ? "" : "s"}</Chip>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">Activo {haceCuanto(usuario.ultima_actividad)}</span>
      </div>
    </button>
  );
}

// ─── Detalle: roles y permisos ────────────────────────────────────────────────

type Efectivo = { permiso: Permiso; origenes: OrigenPermiso[] };

/** Permisos efectivos de una selección (vista previa antes de guardar): roles ∪ directos. */
function efectivosDe(rolesElegidos: number[], directos: Permiso[], roles: RolAdmin[], catalogo: PermisoCatalogo[]): Efectivo[] {
  return catalogo
    .map((p) => ({
      permiso: p.clave,
      origenes: [
        ...roles
          .filter((r) => rolesElegidos.includes(r.id) && r.permisos.includes(p.clave))
          .map((r): OrigenPermiso => ({ tipo: "rol", id: r.id, nombre: r.nombre })),
        ...(directos.includes(p.clave) ? [{ tipo: "directo" } as OrigenPermiso] : []),
      ],
    }))
    .filter((e) => e.origenes.length > 0);
}

const mismos = <T,>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((x) => b.includes(x));

function alternar<T>(lista: T[], valor: T, marcado: boolean): T[] {
  return marcado ? (lista.includes(valor) ? lista : [...lista, valor]) : lista.filter((x) => x !== valor);
}

function DetalleUsuario({ usuario, correo, roles, catalogo, puedeEditar, recienGuardado, onGuardado }: {
  usuario:        UsuarioAdmin;
  correo:         string | null;
  roles:          RolAdmin[];
  catalogo:       PermisoCatalogo[];
  puedeEditar:    boolean;
  recienGuardado: boolean;
  onGuardado:     (u: UsuarioAdmin, correos: Correos) => void;
}) {
  const [rolesSel, setRolesSel] = useState<number[]>(usuario.roles);
  const [directosSel, setDirectosSel] = useState<Permiso[]>(usuario.directos);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);

  const cambiado = !mismos(rolesSel, usuario.roles) || !mismos(directosSel, usuario.directos);
  const efectivos = cambiado ? efectivosDe(rolesSel, directosSel, roles, catalogo) : usuario.efectivos;
  const sistema = roles.find((r) => r.sistema);
  const seQuitaAdmin = usuario.es_tu_cuenta && !!sistema && usuario.roles.includes(sistema.id) && !rolesSel.includes(sistema.id);
  const editable = puedeEditar && usuario.estado === "activa";

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    const r = await pedir<{ usuario: UsuarioAdmin; correos: Correos }>(
      `/api/admin/usuarios/${encodeURIComponent(usuario.uid)}/acceso`, "PUT", { roles: rolesSel, permisos: directosSel }
    );
    setGuardando(false);
    if (!r.ok) {
      setAviso({ tipo: "error", texto: mensajeAdmin(r.error) });
      return;
    }
    if (usuario.es_tu_cuenta) void recargarPermisosAdmin();
    onGuardado(r.datos.usuario, r.datos.correos);
  }

  function descartar() {
    setRolesSel(usuario.roles);
    setDirectosSel(usuario.directos);
    setAviso(null);
  }

  return (
    <Panel
      icono={ShieldCheck}
      titulo={<span className="flex flex-wrap items-center gap-2">{correo ?? "(sin correo)"} <EstadoCuenta estado={usuario.estado} />{usuario.es_tu_cuenta && <Chip tono="blue">Tú</Chip>}</span>}
      descripcion={
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          <span>Cuenta creada: {fechaHora(usuario.creada_at)}</span>
          <span>Última actividad: {fechaHora(usuario.ultima_actividad)}</span>
          <span>Sesiones abiertas: {usuario.sesiones_abiertas}</span>
        </span>
      }
    >
      <div className="space-y-5">
        {!puedeEditar && (
          <AvisoAdmin tipo="info">Puedes ver este usuario, pero no editarlo (te falta el permiso «Editar usuarios»).</AvisoAdmin>
        )}
        {puedeEditar && usuario.estado !== "activa" && (
          <AvisoAdmin tipo="info">La cuenta todavía no está activada: se le pueden asignar roles y permisos después de que abra el enlace del correo.</AvisoAdmin>
        )}

        <div>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Roles</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map((r) => (
              <Casilla
                key={r.id}
                marcada={rolesSel.includes(r.id)}
                deshabilitada={!editable}
                onCambio={(m) => setRolesSel((l) => alternar(l, r.id, m))}
                titulo={r.nombre}
                extra={r.sistema ? <Chip tono="coral">Sistema</Chip> : undefined}
                descripcion={
                  <span className="mt-1 flex flex-wrap gap-1">
                    {r.permisos.length === 0
                      ? <span>Sin permisos</span>
                      : catalogo.filter((p) => r.permisos.includes(p.clave)).map((p) => <Chip key={p.clave}>{nombrePermiso(p.clave)}</Chip>)}
                  </span>
                }
              />
            ))}
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Permisos directos</h4>
          <p className="mb-2 text-[11px] text-muted-foreground">Se suman a los de sus roles. Lo que desmarques se le quita.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {catalogo.map((p) => (
              <Casilla
                key={p.clave}
                marcada={directosSel.includes(p.clave)}
                deshabilitada={!editable}
                onCambio={(m) => setDirectosSel((l) => alternar(l, p.clave, m))}
                titulo={nombrePermiso(p.clave)}
                extra={<code className="text-[10px] font-normal text-muted-foreground">{p.clave}</code>}
                descripcion={p.descripcion}
              />
            ))}
          </div>
        </div>

        <TablaEfectivos efectivos={efectivos} catalogo={catalogo} previa={cambiado} />

        {seQuitaAdmin && (
          <AvisoAdmin tipo="info">Te estás quitando el rol Administrador. Si eres el último, el servidor no lo va a permitir.</AvisoAdmin>
        )}
        {aviso && <AvisoAdmin tipo={aviso.tipo}>{aviso.texto}</AvisoAdmin>}
        {recienGuardado && !cambiado && !aviso && (
          <AvisoAdmin tipo="ok">Cambios guardados. Los permisos efectivos de arriba son los que quedaron en el servidor (y el cambio quedó en la auditoría).</AvisoAdmin>
        )}

        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void guardar()} disabled={!cambiado || guardando}>
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Guardar roles y permisos
            </Button>
            <Button variant="ghost" onClick={descartar} disabled={!cambiado || guardando}>Descartar cambios</Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function TablaEfectivos({ efectivos, catalogo, previa }: { efectivos: Efectivo[]; catalogo: PermisoCatalogo[]; previa: boolean }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Permisos efectivos</h4>
        <span className="text-[11px] text-muted-foreground">= los de sus roles ∪ los directos</span>
        {previa && <Chip tono="amber">Vista previa: sin guardar</Chip>}
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-surface-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">Permiso</th>
              <th className="px-3 py-2 font-semibold">De dónde sale</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {catalogo.map((p) => {
              const e = efectivos.find((x) => x.permiso === p.clave);
              return (
                <tr key={p.clave} className={e ? "" : "opacity-50"}>
                  <td className="px-3 py-2 align-top">
                    <span className="flex items-center gap-1.5 font-semibold text-foreground">
                      {e ? <Check className="h-3.5 w-3.5 text-teal" /> : <span className="inline-block h-3.5 w-3.5" />}
                      {nombrePermiso(p.clave)}
                    </span>
                    <code className="ml-5 text-[10px] text-muted-foreground">{p.clave}</code>
                  </td>
                  <td className="px-3 py-2 align-top">
                    {e ? (
                      <span className="flex flex-wrap gap-1">
                        {e.origenes.map((o) =>
                          o.tipo === "rol"
                            ? <Chip key={`r${o.id}`} tono="purple">Rol: {o.nombre}</Chip>
                            : <Chip key="d" tono="blue">Directo</Chip>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">No lo tiene</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Detalle: cambiar la contraseña (punto 7) ─────────────────────────────────

/** Bloquea copiar, cortar y arrastrar desde un campo de contraseña. */
const sinCopiar = {
  onCopy:      (e: React.ClipboardEvent) => e.preventDefault(),
  onCut:       (e: React.ClipboardEvent) => e.preventDefault(),
  onDragStart: (e: React.DragEvent) => e.preventDefault(),
};

function SeccionContrasena({ usuario, correo }: { usuario: UsuarioAdmin; correo: string | null }) {
  const [password, setPassword] = useState("");
  const [repetida, setRepetida] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);

  // Validación en el cliente, en vivo, con la misma regla que el servidor (incluido el correo del usuario).
  const problemas = password ? problemasContrasena(password, correo) : [];

  if (usuario.es_tu_cuenta) {
    return (
      <Panel icono={KeyRound} titulo="Cambiar contraseña">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Tu propia contraseña no se cambia desde la administración: hazlo desde{" "}
          <Link href="/cuenta" className="font-semibold text-coral hover:underline">tu perfil</Link>, que te pide la actual.
        </p>
      </Panel>
    );
  }

  async function cambiar(e: React.FormEvent) {
    e.preventDefault();
    setAviso(null);
    const fallas = problemasContrasena(password, correo);
    if (fallas.length) {
      setAviso({ tipo: "error", texto: <ListaReglas titulo="La contraseña no cumple las reglas:" reglas={fallas} /> });
      return;
    }
    // Compara dos campos que escribió el mismo usuario en su navegador: no hay secreto que medir.
    // eslint-disable-next-line security/detect-possible-timing-attacks -- comparación en el cliente
    if (password !== repetida) {
      setAviso({ tipo: "error", texto: "Las contraseñas no coinciden." });
      return;
    }
    setEnviando(true);
    const r = await pedir<{ sesiones_revocadas: number }>(
      `/api/admin/usuarios/${encodeURIComponent(usuario.uid)}/contrasena`, "POST", { password }
    );
    setEnviando(false);
    if (!r.ok) {
      const reglas = Array.isArray(r.cuerpo.reglas) ? r.cuerpo.reglas.filter((x): x is string => typeof x === "string") : [];
      setAviso({
        tipo: "error",
        texto: reglas.length ? <ListaReglas titulo="El servidor rechazó la contraseña:" reglas={reglas} /> : mensajeAdmin(r.error),
      });
      return;
    }
    setPassword("");
    setRepetida("");
    const n = r.datos.sesiones_revocadas;
    setAviso({
      tipo: "ok",
      texto: `Listo: la contraseña de ${correo ?? "este usuario"} cambió. Se ${n === 1 ? "cerró 1 sesión" : `cerraron ${n} sesiones`} suyas y le avisamos por correo.`,
    });
  }

  return (
    <Panel
      icono={KeyRound}
      titulo="Cambiar contraseña"
      descripcion="Pone una contraseña nueva y cierra todas las sesiones abiertas del usuario. Se valida aquí, en el servidor y en la base de datos."
    >
      <form onSubmit={cambiar} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoAdmin etiqueta="Contraseña nueva" type="password" autoComplete="new-password" maxLength={200}
                      value={password} onChange={(e) => setPassword(e.target.value)} {...sinCopiar} />
          <CampoAdmin etiqueta="Repite la contraseña" type="password" autoComplete="new-password" maxLength={200}
                      value={repetida} onChange={(e) => setRepetida(e.target.value)} {...sinCopiar} />
        </div>
        {password && !(aviso?.tipo === "error") && (
          problemas.length
            ? <ListaReglas reglas={problemas} />
            : <p className="flex items-center gap-1.5 text-[11px] text-teal"><Check className="h-3.5 w-3.5" /> Cumple las reglas de seguridad.</p>
        )}
        {aviso && <AvisoAdmin tipo={aviso.tipo}>{aviso.texto}</AvisoAdmin>}
        <Button type="submit" variant="secondary" disabled={enviando || !password}>
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Cambiar contraseña
        </Button>
      </form>
    </Panel>
  );
}

function ListaReglas({ titulo, reglas }: { titulo?: string; reglas: string[] }) {
  return (
    <div className="text-[11px] leading-relaxed">
      {titulo && <p className="font-semibold">{titulo}</p>}
      <ul className="space-y-0.5">
        {reglas.map((r) => (
          <li key={r} className="flex items-start gap-1.5 text-coral-light">
            <span aria-hidden className="mt-0.5">✗</span> {r}
          </li>
        ))}
      </ul>
    </div>
  );
}
