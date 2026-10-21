"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Aviso, enviar, MarcoAcceso, mensajeDeError } from "./comun";

/** Activa la cuenta apenas abre la página: el token viene en la URL del correo. */
export function ActivarClient({ token }: { token: string | null }) {
  const [estado, setEstado] = useState<"activando" | "ok" | string>(token ? "activando" : "enlace_invalido");
  const enviado = useRef(false);

  useEffect(() => {
    if (!token || enviado.current) return;
    enviado.current = true; // el token es de un solo uso: un segundo POST daría "enlace inválido"
    // Que el token no quede en el historial del navegador.
    window.history.replaceState(null, "", "/acceso/activar");
    enviar("/api/cuenta/activar", { token }).then((error) => setEstado(error ?? "ok"));
  }, [token]);

  return (
    <MarcoAcceso titulo="Activar cuenta">
      {estado === "activando" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Activando tu cuenta…
        </p>
      )}
      {estado === "ok" && <Aviso tipo="ok">Listo, tu cuenta quedó activada.</Aviso>}
      {estado !== "activando" && estado !== "ok" && (
        <Aviso tipo="error">
          {mensajeDeError(estado)}
          {estado === "enlace_invalido" && " Si ya la activaste, solo inicia sesión. Si no, pide otro correo desde la pantalla de acceso."}
        </Aviso>
      )}
      {estado !== "activando" && (
        <Button asChild className="w-full">
          <Link href="/acceso">Ir a Pulso</Link>
        </Button>
      )}
    </MarcoAcceso>
  );
}
