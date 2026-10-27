import type { Metadata } from "next";
import { AccesoClient } from "@/components/cuenta/cuenta-client";
import { AvisoMotivo } from "@/components/cuenta/aviso-motivo";

export const metadata: Metadata = { title: "Iniciar sesión | Pulso" };

export default function AccesoPage() {
  return (
    <>
      {/* Por qué se cerró la sesión anterior, si se cerró (integrador, punto 16). */}
      <AvisoMotivo />
      <AccesoClient />
    </>
  );
}
