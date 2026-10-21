"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useEstadoSesion } from "@/hooks/use-sesion";

/**
 * La app exige haber iniciado sesión con una cuenta activada. Sin eso no se
 * renderiza nada y se va a /acceso. Es solo la parte visible: el servidor ya
 * rechaza cualquier lectura o escritura sin cuenta (`pulso_uid_con_cuenta`).
 */
export function GuardiaCuenta({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { lista, cuenta } = useEstadoSesion();
  const fuera = lista && cuenta !== "activa";

  useEffect(() => {
    if (fuera) router.replace("/acceso");
  }, [fuera, router]);

  if (fuera) return null;
  return <>{children}</>;
}
