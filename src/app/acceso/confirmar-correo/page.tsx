import type { Metadata } from "next";
import { ConfirmarCorreoClient } from "@/components/cuenta/confirmar-correo-client";

// El token viaja en la URL: que no salga en el Referer hacia ningún lado.
export const metadata: Metadata = { title: "Confirmar correo | Pulso", referrer: "no-referrer" };

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <ConfirmarCorreoClient token={typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null} />;
}
