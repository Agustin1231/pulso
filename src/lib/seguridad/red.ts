import "server-only";
import { BlockList, isIP } from "node:net";
import { headers } from "next/headers";

/**
 * Delante de la app hay dos proxies: Cloudflare y Traefik (Coolify).
 *
 * Traefik no confía en los X-Forwarded-For que le llegan: los descarta y pone
 * la IP de quien le abrió la conexión. Así que el último valor de XFF es el par
 * real, y casi siempre es un borde de Cloudflare. La IP del usuario viene en
 * `CF-Connecting-IP`, pero ese header lo puede inventar cualquiera que le pegue
 * directo al origen: solo se le cree si el par está en los rangos de Cloudflare.
 *
 * Rangos: https://www.cloudflare.com/ips-v4 y /ips-v6.
 */
const CLOUDFLARE = new BlockList();
for (const cidr of [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
]) {
  const [red, prefijo] = cidr.split("/");
  CLOUDFLARE.addSubnet(red, Number(prefijo), "ipv4");
}
for (const cidr of [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
  "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
]) {
  const [red, prefijo] = cidr.split("/");
  CLOUDFLARE.addSubnet(red, Number(prefijo), "ipv6");
}

function limpiar(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v = ip.trim().replace(/^::ffff:/, "");
  return isIP(v) ? v : null;
}

function esCloudflare(ip: string): boolean {
  return CLOUDFLARE.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");
}

/** IP del cliente, o null si no se puede determinar. */
export async function ipCliente(): Promise<string | null> {
  const h = await headers();
  const par =
    limpiar(h.get("x-forwarded-for")?.split(",").at(-1)) ?? limpiar(h.get("x-real-ip"));
  if (!par) return null;

  if (esCloudflare(par)) {
    return limpiar(h.get("cf-connecting-ip")) ?? par;
  }
  return par;
}

/**
 * IP recortada para guardar en la auditoría: /24 en IPv4 y /48 en IPv6.
 * Alcanza para ver patrones (muchos intentos desde la misma red) sin guardar
 * la IP exacta de nadie.
 */
export function anonimizarIp(ip: string | null): string | null {
  if (!ip) return null;
  const tipo = isIP(ip);
  if (tipo === 4) return ip.split(".").slice(0, 3).join(".") + ".0/24";
  if (tipo !== 6) return null;
  // Expandir `::` antes de cortar: "2001:db8::1" son 8 grupos, no 3.
  const [cabeza, cola] = ip.split("::");
  const a = cabeza ? cabeza.split(":") : [];
  const b = cola ? cola.split(":") : [];
  const grupos = cola === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill("0"), ...b];
  return grupos.slice(0, 3).join(":") + "::/48";
}

/**
 * Defensa extra contra CSRF en los route handlers: si el browser manda Origin,
 * tiene que ser el mismo host. (Las server actions ya lo chequea Next, y la
 * cookie SameSite=Strict no viaja desde otro sitio.)
 */
export async function origenValido(): Promise<boolean> {
  const h = await headers();
  const origen = h.get("origin");
  if (!origen) return true; // peticiones no-browser: las frena la falta de cookie
  const host = h.get("x-forwarded-host") ?? h.get("host");
  try {
    return new URL(origen).host === host;
  } catch {
    return false;
  }
}
