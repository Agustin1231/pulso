import { AdminClient } from "@/components/admin/admin-client";

export default function AdminPage() {
  return (
    <div className="animate-fade-in space-y-2">
      <h2 className="text-2xl font-bold mb-1">Administración</h2>
      <p className="text-muted-foreground text-sm mb-6">
        Usuarios, roles y permisos, auditoría, errores y tiempos de la sesión. Ves las pestañas que tus permisos
        habilitan, y el servidor vuelve a comprobar cada permiso en cada operación.
      </p>
      <AdminClient />
    </div>
  );
}
