"use client";

import { useState } from "react";
import { KeyRound, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Aviso, Campo, CampoContrasena, enviarConDetalle, mensajeDeError, Seccion } from "./comun";
import { ReglasContrasena } from "./reglas-contrasena";

/**
 * Cambio de contraseña y de correo desde /cuenta (integrador, punto 20). Las
 * dos piden la contraseña actual: una sesión abierta en un equipo ajeno no
 * alcanza para quedarse con la cuenta. La actual equivocada cuenta para el
 * bloqueo de 5 intentos.
 */

type AvisoTexto = { tipo: "ok" | "error"; texto: string } | null;

export function CambiarContrasena({ email }: { email: string }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<AvisoTexto>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAviso(null);
    if (!actual || !nueva) {
      setAviso({ tipo: "error", texto: "Escribe tu contraseña actual y la nueva." });
      return;
    }
    if (nueva !== repetida) {
      setAviso({ tipo: "error", texto: "La contraseña nueva y su repetición no coinciden." });
      return;
    }
    setEnviando(true);
    const { error, datos } = await enviarConDetalle("/api/cuenta/contrasena", { actual, nueva });
    if (error) {
      setAviso({ tipo: "error", texto: mensajeDeError(error === "datos_invalidos" ? "contrasena_invalida" : error, datos) });
    } else {
      const n = typeof datos.sesiones_cerradas === "number" ? datos.sesiones_cerradas : 0;
      setAviso({
        tipo: "ok",
        texto: "Listo, tu contraseña cambió. " +
          (n > 0
            ? `Cerramos ${n === 1 ? "la otra sesión abierta" : `las otras ${n} sesiones abiertas`} de tu cuenta; en este equipo sigues dentro. `
            : "En este equipo sigues dentro. ") +
          "Te mandamos un aviso al correo.",
      });
      setActual("");
      setNueva("");
      setRepetida("");
    }
    setEnviando(false);
  }

  return (
    <Seccion titulo="Cambiar contraseña" icono={KeyRound}>
      <p>Al cambiarla se cierran tus sesiones en los demás equipos.</p>
      <form onSubmit={onSubmit} noValidate className="space-y-3">
        <CampoContrasena etiqueta="Contraseña actual" autoComplete="current-password" maxLength={128}
                         value={actual} onChange={(e) => setActual(e.target.value)} />
        <CampoContrasena etiqueta="Contraseña nueva" autoComplete="new-password" maxLength={128}
                         value={nueva} onChange={(e) => setNueva(e.target.value)} />
        <ReglasContrasena password={nueva} email={email} />
        <CampoContrasena etiqueta="Repite la contraseña nueva" autoComplete="new-password" maxLength={128}
                         value={repetida} onChange={(e) => setRepetida(e.target.value)} />
        {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
        <Button type="submit" disabled={enviando}>
          {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
          Cambiar contraseña
        </Button>
      </form>
    </Seccion>
  );
}

export function CambiarCorreo({ email }: { email: string }) {
  const [nuevo, setNuevo] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<AvisoTexto>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAviso(null);
    if (!nuevo.trim() || !password) {
      setAviso({ tipo: "error", texto: "Escribe el correo nuevo y tu contraseña actual." });
      return;
    }
    setEnviando(true);
    const { error, datos } = await enviarConDetalle("/api/cuenta/correo", { email: nuevo, password });
    if (error) {
      setAviso({ tipo: "error", texto: mensajeDeError(error, datos) });
    } else {
      // Mismo texto esté o no registrado el correo nuevo: la respuesta del servidor también es la misma.
      setAviso({
        tipo: "ok",
        texto: `Si ${nuevo.trim()} no es de otra cuenta, te llegará ahí un enlace para confirmarlo. El cambio rige cuando lo abras ` +
          `(vence en 24 horas); hasta entonces sigues entrando con ${email}. A tu correo actual le mandamos un aviso.`,
      });
      setPassword("");
    }
    setEnviando(false);
  }

  return (
    <Seccion titulo="Cambiar correo" icono={Mail}>
      <p>Te mandamos un enlace al correo nuevo para confirmar que es tuyo.</p>
      <form onSubmit={onSubmit} noValidate className="space-y-3">
        <Campo etiqueta="Correo nuevo" type="email" autoComplete="email" maxLength={254}
               value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
        <CampoContrasena etiqueta="Contraseña actual" autoComplete="current-password" maxLength={128}
                         value={password} onChange={(e) => setPassword(e.target.value)} />
        {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
        <Button type="submit" disabled={enviando}>
          {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
          Cambiar correo
        </Button>
      </form>
    </Seccion>
  );
}
