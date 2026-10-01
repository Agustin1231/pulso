export const dynamic = "force-dynamic";

import { Sidebar }   from "@/components/layout/sidebar";
import { Header }    from "@/components/layout/header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { DialogoConsentimiento } from "@/components/privacidad/dialogo-consentimiento";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
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
  );
}
