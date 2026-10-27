"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refrescarEstado, reiniciarSesion, useEstadoSesion, useSesion } from "@/hooks/use-sesion";
import { acceptDisclaimer, limpiarEquipo } from "@/lib/anonymous";
import { Aviso, Campo, CampoContrasena, enviar, enviarConDetalle, MarcoAcceso, mensajeDeError, Seccion } from "./comun";
import { CambiarContrasena, CambiarCorreo } from "./perfil-cuenta";
import { ReglasContrasena } from "./reglas-contrasena";

interface Cuenta {
  email:      string;
  verificada: boolean;
}

/** "revisar": después de crear la cuenta, revisa tu correo. */
type Modo = "entrar" | "crear" | "recuperar" | "revisar";
type AvisoTexto = { tipo: "ok" | "error"; texto: string } | null;

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
        <p>Por seguridad, tu cuenta tiene una sola sesión abierta: si entras desde otro equipo, aquí se cierra.</p>
      </Seccion>
      <CambiarContrasena email={cuenta.email} />
      <CambiarCorreo email={cuenta.email} />
      <Seccion titulo="Cerrar sesión" icono={LogOut}>
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
  const [bloqueada, setBloqueada] = useState(false);

  function cambiar(m: Modo) {
    setModo(m);
    setAviso(null);
    setBloqueada(false);
    setPassword("");
    setRepetida("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAviso(null);
    setBloqueada(false);
    // El formulario es `noValidate`: en vez del globo del navegador (en su
    // idioma), los avisos van acá. El formato del correo lo juzga el servidor
    // (400 si no es un correo, integrador, punto 2) y acá se explica.
    if (!email.trim()) {
      setAviso({ tipo: "error", texto: "Escribe tu correo." });
      return;
    }
    if (modo !== "recuperar" && !password) {
      setAviso({ tipo: "error", texto: "Escribe tu contraseña." });
      return;
    }
    if (modo === "crear" && password !== repetida) {
      setAviso({ tipo: "error", texto: "Las contraseñas no coinciden." });
      return;
    }
    setEnviando(true);

    if (modo === "entrar") {
      const { error, datos } = await enviarConDetalle("/api/cuenta/login", { email, password });
      if (!error) {
        reiniciarSesion();
        window.location.assign("/dashboard");
        return;
      }
      setBloqueada(error === "cuenta_bloqueada");
      setAviso({ tipo: "error", texto: mensajeDeError(error, datos) });
    } else if (modo === "crear") {
      const { error, datos } = await enviarConDetalle("/api/cuenta/registro", { email, password });
      if (error) {
        setAviso({ tipo: "error", texto: mensajeDeError(error, datos) });
      } else {
        // Misma pantalla tenga o no cuenta el correo (punto 6): la respuesta
        // del servidor tampoco lo dice.
        setPassword("");
        setRepetida("");
        setModo("revisar");
      }
    } else if (modo === "recuperar") {
      const error = await enviar("/api/cuenta/recuperar", { email });
      setAviso(error
        ? { tipo: "error", texto: mensajeDeError(error) }
        : { tipo: "ok", texto: "Si ese correo tiene una cuenta, te llegó un enlace para crear una contraseña nueva. Vence en 1 hora." });
    }
    setEnviando(false);
  }

  async function yaAbriElEnlace() {
    // Activada → /dashboard; creada sin activar → pantalla de "activa tu cuenta".
    await refrescarEstado();
    setAviso({
      tipo: "error",
      texto: "Todavía no vemos una cuenta activada en este equipo. Abre el enlace del correo (revisa también spam); si ese correo ya tenía cuenta, inicia sesión.",
    });
  }

  if (modo === "revisar") {
    return (
      <MarcoAcceso titulo="Revisa tu correo">
        <Aviso tipo="ok">
          Si <strong>{email.trim()}</strong> no tenía cuenta, te llegará el enlace de activación (vence en 24 horas);
          si ya la tenía, te avisamos por correo.
        </Aviso>
        {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
        <Button className="w-full" onClick={yaAbriElEnlace}>Ya abrí el enlace, continuar</Button>
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="link" size="sm" type="button" onClick={() => cambiar("entrar")}>Iniciar sesión</Button>
          {/* Como en "activa tu cuenta": si la cuenta se creó, quedó en esta sesión; se empieza con una nueva. */}
          <Button variant="link" size="sm" type="button" onClick={() => void cerrarSesion()}>Usar otro correo</Button>
        </div>
      </MarcoAcceso>
    );
  }

  return (
    <MarcoAcceso titulo={modo === "crear" ? "Crear cuenta" : modo === "entrar" ? "Iniciar sesión" : "Olvidé mi contraseña"}>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {modo === "crear" && "Para usar Pulso necesitas una cuenta. Si ya usabas Pulso en este navegador, todo lo que guardaste queda en la cuenta nueva."}
        {modo === "entrar" && "Entra con tu correo y contraseña para ver y guardar tus datos."}
        {modo === "recuperar" && "Te mandamos un enlace para crear una contraseña nueva. Si tu cuenta está bloqueada por intentos fallidos, también la desbloquea."}
      </p>

      <form onSubmit={onSubmit} noValidate className="space-y-3">
        <Campo etiqueta="Correo" type="email" inputMode="email" autoComplete="email" maxLength={254}
               value={email} onChange={(e) => setEmail(e.target.value)} />
        {modo !== "recuperar" && (
          <CampoContrasena etiqueta="Contraseña" maxLength={modo === "crear" ? 128 : 72}
                           autoComplete={modo === "crear" ? "new-password" : "current-password"}
                           value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
        {modo === "crear" && (
          <>
            <ReglasContrasena password={password} email={email} />
            <CampoContrasena etiqueta="Repite la contraseña" maxLength={128} autoComplete="new-password"
                             value={repetida} onChange={(e) => setRepetida(e.target.value)} />
          </>
        )}
        {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
        {bloqueada && (
          <Button variant="outline" type="button" className="w-full" onClick={() => cambiar("recuperar")}>
            Olvidé mi contraseña
          </Button>
        )}
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
