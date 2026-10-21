import type { Metadata } from "next";
import { AccesoClient } from "@/components/cuenta/cuenta-client";

export const metadata: Metadata = { title: "Iniciar sesión | Pulso" };

export default function AccesoPage() {
  return <AccesoClient />;
}
