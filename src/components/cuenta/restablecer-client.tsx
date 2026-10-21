"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Aviso, Campo, enviar, MarcoAcceso, mensajeDeError } from "./comun";

export function RestablecerClient({ token }: { token: string | null }) {
  const [password, setPassword] = useState("");
  const [repetida, setRepetida] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : mensajeDeError("enlace_invalido"));

  useEffect(() => {
    // Que el token no quede en el historial: ya está en memoria.
    if (token) window.history.replaceState(null, "", "/acceso/restablecer");
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // eslint-disable-next-line security/detect-possible-timing-attacks -- compara los dos campos del propio formulario, en el navegador
    if (password !== repetida) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setEnviando(true);
    setError(null);
    const codigo = await enviar("/api/cuenta/restablecer", { token, password });
    if (codigo) {
      setError(mensajeDeError(codigo) + (codigo === "enlace_invalido" ? " Pide otro desde \"Olvidé mi contraseña\"." : ""));
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
            Listo, tu contraseña cambió. Por seguridad cerramos las sesiones abiertas de tu cuenta: entra de nuevo
            con la contraseña nueva.
          </Aviso>
          <Button asChild className="w-full">
            <Link href="/cuenta">Iniciar sesión</Link>
          </Button>
        </>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <Campo etiqueta="Contraseña nueva" type="password" required minLength={10} maxLength={72}
                 autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Campo etiqueta="Repite la contraseña" type="password" required minLength={10} maxLength={72}
                 autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">Mínimo 10 caracteres.</p>
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
