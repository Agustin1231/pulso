import { PrivacidadClient } from "@/components/privacidad/privacidad-client";

export default function PrivacidadPage() {
  return (
    <div className="animate-fade-in space-y-2">
      <h2 className="text-2xl font-bold mb-1">Privacidad</h2>
      <p className="text-muted-foreground text-sm mb-6">
        Qué datos guarda Pulso, quién los recibe y cómo ejercer tus derechos (Ley 1581 de 2012).
      </p>
      <PrivacidadClient />
    </div>
  );
}
