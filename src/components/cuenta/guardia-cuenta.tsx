"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useEstadoSesion } from "@/hooks/use-sesion";

/**
 * La app exige haber iniciado sesión con una cuenta activada. Sin eso no se
 * renderiza nada y se va a /acceso. Es solo la parte visible: el servidor ya
 * rechaza cualquier lectura o escritura sin cuenta (`pulso_uid_con_cuenta`) y
 * el layout ni siquiera manda la app sin una sesión con cuenta.
 *
 * Mientras la sesión se cierra (`saliendo`: se cerró en esta u otra pestaña,
 * venció, quedó inactiva) tampoco se renderiza nada: los componentes se
 * desmontan y los datos de la cuenta salen del DOM antes de ir a /acceso
 * (integrador, punto 18).
 */
export function GuardiaCuenta({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { lista, cuenta, saliendo } = useEstadoSesion();
  const fuera = lista && cuenta !== "activa";

  useEffect(() => {
    if (fuera && !saliendo) router.replace("/acceso");
  }, [fuera, saliendo, router]);

  if (fuera || saliendo) return null;
  return <>{children}</>;
}
