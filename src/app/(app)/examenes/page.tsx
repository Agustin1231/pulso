import { ExamenesClient } from "@/components/examenes/examenes-client";

export default function ExamenesPage() {
  return (
    <div className="animate-fade-in space-y-2 max-w-3xl">
      <h2 className="text-2xl font-bold mb-1">Exámenes</h2>
      <p className="text-muted-foreground text-sm mb-6">
        Guarda tus exámenes de laboratorio en PDF, JPG o PNG (hasta 10 MB). Se guardan cifrados y solo tú
        puedes verlos.
      </p>
      <ExamenesClient />
    </div>
  );
}
