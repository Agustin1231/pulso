"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, Lock, Pencil, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  mensajeAdmin, nombrePermiso, type Correos, type Permiso, type PermisoCatalogo, type RolAdmin,
} from "@/lib/admin/tipos";
import { cn } from "@/lib/utils";
import { AvisoAdmin, CampoAdmin, Cargando, Casilla, Chip, Panel, fechaHora, pedir, type TipoAviso } from "./comun";

/**
 * Pestaña "Roles" (integrador, puntos 5 y 8): crear, editar y borrar roles con
 * sus permisos. El rol de sistema "Administrador" se muestra pero no se edita.
 * Los miembros de cada rol se asignan desde la pestaña "Usuarios".
 */

interface Datos {
  roles:    RolAdmin[];
  catalogo: PermisoCatalogo[];
  correos:  Correos;
}

type Editor = { modo: "crear" } | { modo: "editar"; rol: RolAdmin } | null;
type Aviso = { tipo: TipoAviso; texto: string } | null;

export function PestanaRoles() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const r = await pedir<Datos>("/api/admin/roles");
    if (r.ok) {
      setDatos(r.datos);
      setError(null);
    } else {
      setError(mensajeAdmin(r.error));
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error && !datos) return <AvisoAdmin tipo="error">{error}</AvisoAdmin>;
  if (!datos) return <Cargando texto="Cargando roles…" />;

  async function listo(texto: string) {
    setEditor(null);
    setAviso({ tipo: "ok", texto });
    await cargar();
  }

  return (
    <div className="space-y-4">
      <Panel
        icono={KeyRound}
        titulo={`Roles (${datos.roles.length})`}
        descripcion="Un rol agrupa permisos. Los permisos de un usuario son los de todos sus roles más los que se le den directamente."
        acciones={
          <>
            <Button variant="ghost" size="sm" onClick={() => void cargar()} disabled={cargando}>
              <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} /> Actualizar
            </Button>
            {editor?.modo !== "crear" && (
              <Button size="sm" onClick={() => { setEditor({ modo: "crear" }); setAviso(null); }}>
                <Plus className="h-3.5 w-3.5" /> Nuevo rol
              </Button>
            )}
          </>
        }
      >
        {aviso && <AvisoAdmin tipo={aviso.tipo} className="mb-3">{aviso.texto}</AvisoAdmin>}
        {error && <AvisoAdmin tipo="error" className="mb-3">{error}</AvisoAdmin>}
        {editor?.modo === "crear" && (
          <EditorRol catalogo={datos.catalogo} onCancelar={() => setEditor(null)} onListo={listo} />
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        {datos.roles.map((rol) =>
          editor?.modo === "editar" && editor.rol.id === rol.id ? (
            <Panel key={rol.id} icono={Pencil} titulo={`Editar «${rol.nombre}»`}>
              <EditorRol rol={rol} catalogo={datos.catalogo} onCancelar={() => setEditor(null)} onListo={listo} />
            </Panel>
          ) : (
            <TarjetaRol
              key={rol.id}
              rol={rol}
              catalogo={datos.catalogo}
              correos={datos.correos}
              onEditar={() => { setEditor({ modo: "editar", rol }); setAviso(null); }}
              onBorrado={(nombre) => void listo(`Se borró el rol «${nombre}».`)}
            />
          )
        )}
      </div>
    </div>
  );
}

function TarjetaRol({ rol, catalogo, correos, onEditar, onBorrado }: {
  rol:       RolAdmin;
  catalogo:  PermisoCatalogo[];
  correos:   Correos;
  onEditar:  () => void;
  onBorrado: (nombre: string) => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function borrar() {
    setBorrando(true);
    setError(null);
    const r = await pedir(`/api/admin/roles/${rol.id}`, "DELETE");
    setBorrando(false);
    if (r.ok) {
      onBorrado(rol.nombre);
    } else {
      setError(mensajeAdmin(r.error));
      setConfirmando(false);
    }
  }

  const n = rol.miembros.length;
  return (
    <Panel
      icono={rol.sistema ? Lock : KeyRound}
      titulo={
        <span className="flex flex-wrap items-center gap-2">
          {rol.nombre}
          {rol.sistema && <Chip tono="coral">Sistema</Chip>}
          <Chip><Users className="h-3 w-3" /> {n} {n === 1 ? "miembro" : "miembros"}</Chip>
        </span>
      }
      descripcion={rol.descripcion || "Sin descripción."}
      acciones={
        rol.sistema ? undefined : (
          <>
            <Button variant="ghost" size="sm" onClick={onEditar}><Pencil className="h-3.5 w-3.5" /> Editar</Button>
            <Button variant="ghost" size="sm" className="text-coral hover:text-coral" onClick={() => setConfirmando(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Borrar
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {catalogo.map((p) => (
            <Chip key={p.clave} tono={rol.permisos.includes(p.clave) ? "teal" : "neutro"}
                  className={rol.permisos.includes(p.clave) ? "" : "opacity-40 line-through"} title={p.descripcion}>
              {nombrePermiso(p.clave)}
            </Chip>
          ))}
        </div>
        {n > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Miembros: {rol.miembros.slice(0, 6).map((uid) => correos[uid] ?? "(sin correo)").join(", ")}
            {n > 6 && ` y ${n - 6} más`}
          </p>
        )}
        {rol.sistema && (
          <p className="text-[11px] text-muted-foreground">
            Tiene todos los permisos. No se puede borrar ni quitarle permisos, y siempre queda al menos un usuario con él.
          </p>
        )}
        <p className="text-[10px] text-muted-foreground">Actualizado: {fechaHora(rol.actualizado_at)}</p>
        {error && <AvisoAdmin tipo="error">{error}</AvisoAdmin>}
        {confirmando && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-coral/30 bg-coral/5 p-3">
            <span className="text-xs font-semibold text-foreground">
              ¿Borrar «{rol.nombre}»?{n > 0 && ` Se les quita a ${n} ${n === 1 ? "usuario" : "usuarios"}.`}
            </span>
            <Button variant="destructive" size="sm" disabled={borrando} onClick={() => void borrar()}>
              {borrando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Sí, borrar
            </Button>
            <Button variant="ghost" size="sm" disabled={borrando} onClick={() => setConfirmando(false)}>Cancelar</Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function EditorRol({ rol, catalogo, onCancelar, onListo }: {
  rol?:       RolAdmin;
  catalogo:   PermisoCatalogo[];
  onCancelar: () => void;
  onListo:    (texto: string) => void;
}) {
  const [nombre, setNombre] = useState(rol?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(rol?.descripcion ?? "");
  const [permisos, setPermisos] = useState<Permiso[]>(rol?.permisos ?? []);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const limpio = nombre.trim().replace(/\s+/g, " ");
    if (limpio.length < 2 || limpio.length > 60) {
      setError("El nombre tiene que tener entre 2 y 60 caracteres.");
      return;
    }
    setEnviando(true);
    const cuerpo = { nombre: limpio, descripcion: descripcion.trim(), permisos };
    const r = rol
      ? await pedir(`/api/admin/roles/${rol.id}`, "PUT", cuerpo)
      : await pedir("/api/admin/roles", "POST", cuerpo);
    setEnviando(false);
    if (!r.ok) {
      setError(mensajeAdmin(r.error));
      return;
    }
    onListo(rol ? `Se guardó el rol «${limpio}».` : `Se creó el rol «${limpio}». Asígnalo desde la pestaña Usuarios.`);
  }

  return (
    <form onSubmit={guardar} className="space-y-3 rounded-lg border border-border bg-surface-2/30 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoAdmin etiqueta="Nombre" required minLength={2} maxLength={60} value={nombre}
                    onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Soporte" />
        <CampoAdmin etiqueta="Descripción" maxLength={300} value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)} placeholder="Para qué sirve este rol" />
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">Permisos del rol</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {catalogo.map((p) => (
            <Casilla
              key={p.clave}
              marcada={permisos.includes(p.clave)}
              onCambio={(m) => setPermisos((l) => (m ? [...l.filter((x) => x !== p.clave), p.clave] : l.filter((x) => x !== p.clave)))}
              titulo={nombrePermiso(p.clave)}
              extra={<code className="text-[10px] font-normal text-muted-foreground">{p.clave}</code>}
              descripcion={p.descripcion}
            />
          ))}
        </div>
      </div>
      {error && <AvisoAdmin tipo="error">{error}</AvisoAdmin>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={enviando}>
          {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
          {rol ? "Guardar cambios" : "Crear rol"}
        </Button>
        <Button type="button" variant="ghost" disabled={enviando} onClick={onCancelar}>Cancelar</Button>
      </div>
    </form>
  );
}
