"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Aviso, enviar, MarcoAcceso, mensajeDeError } from "./comun";

/**
 * Confirma el correo nuevo de la cuenta (integrador, punto 20): el token
 * viene en la URL del correo. A diferencia de la activación, pide un clic: un
 * escáner de correo que abra el enlace no puede cambiar el correo de nadie.
 */
export function ConfirmarCorreoClient({ token }: { token: string | null }) {
  const [estado, setEstado] = useState<"listo_para_confirmar" | "confirmando" | "ok" | string>(
    token ? "listo_para_confirmar" : "enlace_invalido"
  );
  const enviado = useRef(false);

  useEffect(() => {
    // Que el token no quede en el historial del navegador: ya está en memoria.
    if (token) window.history.replaceState(null, "", "/acceso/confirmar-correo");
  }, [token]);

  async function confirmar() {
    if (!token || enviado.current) return;
    enviado.current = true; // el token es de un solo uso: un segundo POST daría "enlace inválido"
    setEstado("confirmando");
    setEstado((await enviar("/api/cuenta/confirmar-correo", { token })) ?? "ok");
  }

  return (
    <MarcoAcceso titulo="Confirmar correo nuevo">
      {estado === "listo_para_confirmar" && (
        <>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Pediste usar este correo en tu cuenta de Pulso. Al confirmar, entras con él desde ahora y el correo
            anterior deja de servir para iniciar sesión.
          </p>
          <Button className="w-full" onClick={confirmar}>Confirmar el correo nuevo</Button>
        </>
      )}
      {estado === "confirmando" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Confirmando…
        </p>
      )}
      {estado === "ok" && <Aviso tipo="ok">Listo, tu cuenta ya usa el correo nuevo. Desde ahora entras con él.</Aviso>}
      {estado !== "listo_para_confirmar" && estado !== "confirmando" && estado !== "ok" && (
        <Aviso tipo="error">
          {mensajeDeError(estado)}
          {estado === "enlace_invalido" && " Si todavía quieres cambiarlo, pídelo de nuevo desde Cuenta."}
        </Aviso>
      )}
      {estado !== "listo_para_confirmar" && estado !== "confirmando" && (
        <Button asChild className="w-full">
          <Link href="/acceso">Ir a Pulso</Link>
        </Button>
      )}
    </MarcoAcceso>
  );
}
