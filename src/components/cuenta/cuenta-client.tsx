"use client";

import { useEffect, useState } from "react";
import { Loader2, LogOut, Mail, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reiniciarSesion, useSesion } from "@/hooks/use-sesion";
import { acceptDisclaimer, limpiarEquipo } from "@/lib/anonymous";
import { Aviso, Campo, enviar, mensajeDeError } from "./comun";

interface Cuenta {
  email:      string;
  verificada: boolean;
}

type Modo = "entrar" | "crear" | "recuperar";

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

export function CuentaClient() {
  const sesion = useSesion();
  // undefined = cargando
  const [cuenta, setCuenta] = useState<Cuenta | null | undefined>(undefined);

  async function cargar() {
    const res = await fetch("/api/cuenta", { cache: "no-store" }).catch(() => null);
    const data = res?.ok ? await res.json().catch(() => null) : null;
    setCuenta(data?.cuenta ?? null);
  }

  useEffect(() => {
    if (sesion) void cargar();
  }, [sesion]);

  if (cuenta === undefined) {
    return <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…</p>;
  }
  return cuenta ? <ConCuenta cuenta={cuenta} /> : <SinCuenta alCrear={cargar} />;
}

function ConCuenta({ cuenta }: { cuenta: Cuenta }) {
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [saliendo, setSaliendo] = useState(false);

  async function reenviar() {
    setEnviando(true);
    const error = await enviar("/api/cuenta/reenviar");
    setAviso(error ? { tipo: "error", texto: mensajeDeError(error) } : { tipo: "ok", texto: `Te mandamos otro enlace a ${cuenta.email}.` });
    setEnviando(false);
  }

  async function cerrarSesion() {
    setSaliendo(true);
    await fetch("/api/sesion", { method: "DELETE" }).catch(() => null);
    await limpiarEquipo();
    acceptDisclaimer();
    reiniciarSesion();
    // Recarga completa: que ningún componente se quede con datos de la cuenta.
    window.location.assign("/cuenta");
  }

  return (
    <div className="space-y-4">
      <Seccion titulo="Tu cuenta">
        <p className="flex items-center gap-2 text-sm text-foreground">
          <Mail className="h-4 w-4 text-muted-foreground" /> {cuenta.email}
        </p>
        {cuenta.verificada ? (
          <p>Cuenta activa. Puedes entrar desde cualquier equipo con tu correo y contraseña, y tus datos te siguen.</p>
        ) : (
          <>
            <p>
              Falta activarla: abre el enlace que te mandamos a tu correo (vence en 24 horas). Mientras tanto
              sigues usando Pulso normal en este equipo.
            </p>
            <Button variant="outline" size="sm" disabled={enviando} onClick={reenviar}>
              {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
              Reenviar el correo
            </Button>
          </>
        )}
        {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      </Seccion>

      <Seccion titulo="Cerrar sesión">
        <p>
          Sale de tu cuenta en este equipo y lo deja limpio. Tus datos siguen en tu cuenta: vuelves a verlos al
          iniciar sesión.
        </p>
        <Button variant="outline" disabled={saliendo} onClick={cerrarSesion}>
          {saliendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          Cerrar sesión
        </Button>
      </Seccion>
    </div>
  );
}

function SinCuenta({ alCrear }: { alCrear: () => Promise<void> }) {
  const [modo, setModo] = useState<Modo>("entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repetida, setRepetida] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

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
        await alCrear();
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
    <div className="space-y-4">
      <Seccion titulo={modo === "crear" ? "Crear cuenta" : modo === "entrar" ? "Iniciar sesión" : "Olvidé mi contraseña"}>
        {modo === "crear" && (
          <p>
            Hoy tus datos están atados a este navegador. Con una cuenta entras desde cualquier equipo y no los
            pierdes si borras las cookies. Todo lo que ya guardaste queda en la cuenta.
          </p>
        )}
        {modo === "entrar" && (
          <p>Si ya usaste Pulso en este equipo sin cuenta, lo que guardaste se suma a tu cuenta al entrar.</p>
        )}
        {modo === "recuperar" && <p>Te mandamos un enlace para crear una contraseña nueva.</p>}

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
              <p className="text-[11px]">Mínimo 10 caracteres.</p>
            </>
          )}
          {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
          <Button type="submit" className="w-full" disabled={enviando}>
            {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
            {modo === "crear" ? "Crear cuenta" : modo === "entrar" ? "Entrar" : "Mandar enlace"}
          </Button>
        </form>

        <div className="flex flex-wrap justify-between gap-2 pt-1">
          {modo === "entrar" ? (
            <>
              <Button variant="link" size="sm" type="button" onClick={() => cambiar("crear")}>Crear una cuenta</Button>
              <Button variant="link" size="sm" type="button" onClick={() => cambiar("recuperar")}>Olvidé mi contraseña</Button>
            </>
          ) : (
            <Button variant="link" size="sm" type="button" onClick={() => cambiar("entrar")}>Ya tengo cuenta, iniciar sesión</Button>
          )}
        </div>
      </Seccion>
    </div>
  );
}
