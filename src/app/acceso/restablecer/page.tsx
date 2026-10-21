import type { Metadata } from "next";
import { RestablecerClient } from "@/components/cuenta/restablecer-client";

// El token viaja en la URL: que no salga en el Referer hacia ningún lado.
export const metadata: Metadata = { title: "Contraseña nueva | Pulso", referrer: "no-referrer" };

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <RestablecerClient token={typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null} />;
}
