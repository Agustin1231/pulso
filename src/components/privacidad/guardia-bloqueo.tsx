"use client";

import { useEffect } from "react";
import { refrescarEstado, useEstadoSesion } from "@/hooks/use-sesion";
import { PantallaBloqueo } from "./pantalla-bloqueo";

/**
 * Bloqueo con passkey (plantilla, fila 9). Con la sesión bloqueada no se
 * renderiza la app: los componentes se DESMONTAN, así que los datos que ya se
 * habían mostrado salen del DOM (no alcanza con taparlos con un overlay).
 *
 * La ventana de desbloqueo vence en el servidor; acá se consulta cada minuto y
 * al volver a la pestaña para enterarse y mostrar la pantalla de bloqueo.
 */
export function GuardiaBloqueo({ children }: { children: React.ReactNode }) {
  const { lista, bloqueo } = useEstadoSesion();
  const vigilar = bloqueo.activo && !bloqueo.bloqueada;

  useEffect(() => {
    if (!vigilar) return;
    const intervalo = setInterval(() => void refrescarEstado(), 60_000);
    const alVolver = () => {
      if (document.visibilityState === "visible") void refrescarEstado();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [vigilar]);

  if (lista && bloqueo.bloqueada) return <PantallaBloqueo />;
  return <>{children}</>;
}
