import { CuentaClient } from "@/components/cuenta/cuenta-client";

export default function CuentaPage() {
  return (
    <div className="animate-fade-in space-y-2 max-w-md">
      <h2 className="text-2xl font-bold mb-1">Cuenta</h2>
      <p className="text-muted-foreground text-sm mb-6">
        Tu correo y tu acceso a Pulso.
      </p>
      <CuentaClient />
    </div>
  );
}
