export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { Sidebar }   from "@/components/layout/sidebar";
import { Header }    from "@/components/layout/header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { DialogoConsentimiento } from "@/components/privacidad/dialogo-consentimiento";
import { GuardiaBloqueo } from "@/components/privacidad/guardia-bloqueo";
import { GuardiaCuenta } from "@/components/cuenta/guardia-cuenta";
import { VigiaSesion } from "@/components/cuenta/vigia-sesion";
import { estadoCuenta } from "@/lib/sesion";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Sin una sesión con cuenta activada, el servidor ni siquiera manda la app:
  // quien pega la URL de una pantalla en otro navegador (sin la cookie) o
  // vuelve con una sesión cerrada cae directo en /acceso (integrador, punto 1).
  // Ahí /api/sesion le explica por qué, si había una sesión que se cerró.
  if ((await estadoCuenta()) !== "activa") redirect("/acceso");

  return (
    <>
    {/* Inactividad, cierre en otras pestañas y sesiones revocadas (vigia-sesion.tsx).
        Va fuera de las guardias: sigue atento aunque la app esté desmontada. */}
    <VigiaSesion />
    {/* Sin una cuenta activada, a /acceso (guardia-cuenta.tsx). Con el bloqueo
        activo y sin desbloquear, la pantalla de bloqueo (guardia-bloqueo.tsx). */}
    <GuardiaCuenta>
    <GuardiaBloqueo>
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar — solo desktop */}
      <Sidebar />

      {/* Contenido principal */}
      <div className="flex flex-1 flex-col overflow-hidden md:pl-64">
        <Header />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
          {children}
        </main>
      </div>

      {/* Bottom nav — solo móvil */}
      <BottomNav />

      {/* Lo abre fetchIA cuando una función necesita mandar datos de salud a la IA */}
      <DialogoConsentimiento />
    </div>
    </GuardiaBloqueo>
    </GuardiaCuenta>
    </>
  );
}
