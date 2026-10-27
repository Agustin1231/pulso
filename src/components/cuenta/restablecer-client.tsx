"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Aviso, CampoContrasena, enviarConDetalle, MarcoAcceso, mensajeDeError } from "./comun";
import { ReglasContrasena } from "./reglas-contrasena";

/**
 * Contraseña nueva con el enlace de "Olvidé mi contraseña" (integrador, punto
 * 3). Muestra la regla en vivo; la del correo ("que no contenga tu correo")
 * la revisa el servidor, porque esta página no sabe de qué cuenta es.
 */
export function RestablecerClient({ token }: { token: string | null }) {
  const [password, setPassword] = useState("");
  const [repetida, setRepetida] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : mensajeDeError("enlace_invalido"));

  useEffect(() => {
    // Que el token no quede en el historial ni en la barra: ya está en memoria.
    if (token) window.history.replaceState(null, "", "/acceso/restablecer");
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      setError("Escribe la contraseña nueva.");
      return;
    }
    // eslint-disable-next-line security/detect-possible-timing-attacks -- compara los dos campos del propio formulario, en el navegador
    if (password !== repetida) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setEnviando(true);
    setError(null);
    const { error: codigo, datos } = await enviarConDetalle("/api/cuenta/restablecer", { token, password });
    if (codigo) {
      setError(mensajeDeError(codigo, datos) + (codigo === "enlace_invalido" ? " Pide otro desde \"Olvidé mi contraseña\"." : ""));
    } else {
      setListo(true);
    }
    setEnviando(false);
  }

  return (
    <MarcoAcceso titulo="Contraseña nueva">
      {listo ? (
        <>
          <Aviso tipo="ok">
            Listo, tu contraseña cambió y la cuenta quedó desbloqueada. Por seguridad cerramos las sesiones abiertas de
            tu cuenta: entra de nuevo con la contraseña nueva.
          </Aviso>
          <Button asChild className="w-full">
            <Link href="/acceso">Iniciar sesión</Link>
          </Button>
        </>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-3">
          <CampoContrasena etiqueta="Contraseña nueva" maxLength={128} autoComplete="new-password"
                           value={password} onChange={(e) => setPassword(e.target.value)} />
          <ReglasContrasena password={password} />
          <CampoContrasena etiqueta="Repite la contraseña" maxLength={128} autoComplete="new-password"
                           value={repetida} onChange={(e) => setRepetida(e.target.value)} />
          {error && <Aviso tipo="error">{error}</Aviso>}
          <Button type="submit" className="w-full" disabled={enviando || !token}>
            {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar contraseña
          </Button>
        </form>
      )}
    </MarcoAcceso>
  );
}
