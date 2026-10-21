"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, Mail, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refrescarEstado, reiniciarSesion, useEstadoSesion, useSesion } from "@/hooks/use-sesion";
import { acceptDisclaimer, limpiarEquipo } from "@/lib/anonymous";
import { Aviso, Campo, enviar, MarcoAcceso, mensajeDeError } from "./comun";

interface Cuenta {
  email:      string;
  verificada: boolean;
}

type Modo = "entrar" | "crear" | "recuperar";
type AvisoTexto = { tipo: "ok" | "error"; texto: string } | null;

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <UserRound className="h-4 w-4 text-teal" />
        <h3 className="text-sm font-bold text-foreground">{titulo}</h3>
      </div>
      <div className="space-y-3 text-xs text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

function Cargando() {
  return <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…</p>;
}

async function leerCuenta(): Promise<Cuenta | null> {
  const res = await fetch("/api/cuenta", { cache: "no-store" }).catch(() => null);
  const data = res?.ok ? await res.json().catch(() => null) : null;
  return data?.cuenta ?? null;
}

/** Cierra la sesión en este equipo, lo limpia y vuelve a la pantalla de acceso. */
async function cerrarSesion(): Promise<void> {
  await fetch("/api/sesion", { method: "DELETE" }).catch(() => null);
  await limpiarEquipo();
  acceptDisclaimer();
  reiniciarSesion();
  // Recarga completa: que ningún componente se quede con datos de la cuenta.
  window.location.assign("/acceso");
}

function BotonCerrarSesion({ texto = "Cerrar sesión" }: { texto?: string }) {
  const [saliendo, setSaliendo] = useState(false);
  return (
    <Button variant="outline" disabled={saliendo} onClick={() => { setSaliendo(true); void cerrarSesion(); }}>
      {saliendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
      {texto}
    </Button>
  );
}

// ─── /cuenta (dentro de la app: ya hay una cuenta activa) ────────────────────

export function CuentaClient() {
  const sesion = useSesion();
  const [cuenta, setCuenta] = useState<Cuenta | null | undefined>(undefined);

  useEffect(() => {
    if (sesion) void leerCuenta().then(setCuenta);
  }, [sesion]);

  if (!cuenta) return <Cargando />;
  return (
    <div className="space-y-4">
      <Seccion titulo="Tu cuenta">
        <p className="flex items-center gap-2 text-sm text-foreground">
          <Mail className="h-4 w-4 text-muted-foreground" /> {cuenta.email}
        </p>
        <p>Cuenta activa. Entras desde cualquier equipo con tu correo y contraseña, y tus datos te siguen.</p>
      </Seccion>
      <Seccion titulo="Cerrar sesión">
        <p>Sale de tu cuenta en este equipo y lo deja limpio. Tus datos siguen en tu cuenta.</p>
        <BotonCerrarSesion />
      </Seccion>
    </div>
  );
}

// ─── /acceso (fuera de la app: iniciar sesión, crear cuenta, activarla) ──────

export function AccesoClient() {
  const router = useRouter();
  const { lista, cuenta } = useEstadoSesion();

  useEffect(() => {
    if (lista && cuenta === "activa") router.replace("/dashboard");
  }, [lista, cuenta, router]);

  if (!lista || cuenta === "activa") {
    return <MarcoAcceso titulo="Pulso"><Cargando /></MarcoAcceso>;
  }
  if (cuenta === "sin_activar") return <Pendiente />;
  return <SinCuenta />;
}

/** La cuenta de esta sesión se creó pero falta abrir el enlace del correo. */
function Pendiente() {
  const [email, setEmail] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<AvisoTexto>(null);

  useEffect(() => {
    void leerCuenta().then((c) => setEmail(c?.email ?? null));
    // Si la activó en otra pestaña o en el celular, al volver ya entra.
    const alVolver = () => {
      if (document.visibilityState === "visible") void refrescarEstado();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, []);

  async function reenviar() {
    setEnviando(true);
    const error = await enviar("/api/cuenta/reenviar");
    setAviso(error ? { tipo: "error", texto: mensajeDeError(error) } : { tipo: "ok", texto: "Te mandamos otro enlace." });
    setEnviando(false);
  }

  async function yaLaActive() {
    await refrescarEstado();
    setAviso({ tipo: "error", texto: "Todavía no está activada. Abre el enlace del correo (revisa también spam)." });
  }

  return (
    <MarcoAcceso titulo="Activa tu cuenta">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Te mandamos un enlace a <strong className="text-foreground">{email ?? "tu correo"}</strong>. Ábrelo para
        activar la cuenta y entrar a Pulso. Vence en 24 horas.
      </p>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      <Button className="w-full" onClick={yaLaActive}>Ya la activé, continuar</Button>
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="link" size="sm" disabled={enviando} onClick={reenviar}>
          {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
          Reenviar el correo
        </Button>
        <Button variant="link" size="sm" onClick={() => void cerrarSesion()}>Usar otro correo</Button>
      </div>
    </MarcoAcceso>
  );
}

function SinCuenta() {
  const [modo, setModo] = useState<Modo>("entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repetida, setRepetida] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<AvisoTexto>(null);

  function cambiar(m: Modo) {
    setModo(m);
    setAviso(null);
    setPassword("");
    setRepetida("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAviso(null);
    if (modo === "crear" && password !== repetida) {
      setAviso({ tipo: "error", texto: "Las contraseñas no coinciden." });
      return;
    }
    setEnviando(true);

    if (modo === "entrar") {
      const error = await enviar("/api/cuenta/login", { email, password });
      if (!error) {
        reiniciarSesion();
        window.location.assign("/dashboard");
        return;
      }
      setAviso({ tipo: "error", texto: mensajeDeError(error) });
    } else if (modo === "crear") {
      const error = await enviar("/api/cuenta/registro", { email, password });
      if (error) {
        setAviso({ tipo: "error", texto: mensajeDeError(error) });
      } else {
        setAviso({ tipo: "ok", texto: `Te mandamos un correo a ${email.trim()} con el enlace para activar tu cuenta.` });
        setPassword("");
        setRepetida("");
        // Pasa a la pantalla de "activa tu cuenta" (si el correo ya era de otra cuenta, se queda acá).
        await refrescarEstado();
      }
    } else {
      const error = await enviar("/api/cuenta/recuperar", { email });
      setAviso(error
        ? { tipo: "error", texto: mensajeDeError(error) }
        : { tipo: "ok", texto: "Si ese correo tiene una cuenta, te llegó un enlace para crear una contraseña nueva. Vence en 1 hora." });
    }
    setEnviando(false);
  }

  return (
    <MarcoAcceso titulo={modo === "crear" ? "Crear cuenta" : modo === "entrar" ? "Iniciar sesión" : "Olvidé mi contraseña"}>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {modo === "crear" && "Para usar Pulso necesitas una cuenta. Si ya usabas Pulso en este navegador, todo lo que guardaste queda en la cuenta nueva."}
        {modo === "entrar" && "Entra con tu correo y contraseña para ver y guardar tus datos."}
        {modo === "recuperar" && "Te mandamos un enlace para crear una contraseña nueva."}
      </p>

      <form onSubmit={onSubmit} className="space-y-3">
        <Campo etiqueta="Correo" type="email" autoComplete="email" required maxLength={254}
               value={email} onChange={(e) => setEmail(e.target.value)} />
        {modo !== "recuperar" && (
          <Campo etiqueta="Contraseña" type="password" required maxLength={72}
                 minLength={modo === "crear" ? 10 : undefined}
                 autoComplete={modo === "crear" ? "new-password" : "current-password"}
                 value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
        {modo === "crear" && (
          <>
            <Campo etiqueta="Repite la contraseña" type="password" required minLength={10} maxLength={72}
                   autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">Mínimo 10 caracteres.</p>
          </>
        )}
        {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
        <Button type="submit" className="w-full" disabled={enviando}>
          {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
          {modo === "crear" ? "Crear cuenta" : modo === "entrar" ? "Entrar" : "Mandar enlace"}
        </Button>
      </form>

      <div className="flex flex-wrap justify-between gap-2">
        {modo === "entrar" ? (
          <>
            <Button variant="link" size="sm" type="button" onClick={() => cambiar("crear")}>Crear una cuenta</Button>
            <Button variant="link" size="sm" type="button" onClick={() => cambiar("recuperar")}>Olvidé mi contraseña</Button>
          </>
        ) : (
          <Button variant="link" size="sm" type="button" onClick={() => cambiar("entrar")}>Ya tengo cuenta, iniciar sesión</Button>
        )}
      </div>
    </MarcoAcceso>
  );
}
