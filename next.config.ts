import type { NextConfig } from "next";

/**
 * Headers de seguridad para todas las respuestas (plantilla, fila 10). La CSP
 * va aparte, en src/middleware.ts, porque lleva un nonce por petición.
 */
const headersSeguridad = [
  // Solo HTTPS durante 2 años, también en subdominios. Sin `preload`: es
  // difícil de deshacer y el dominio no es solo de esta app.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options",    value: "nosniff" },
  // Para navegadores viejos que no entienden `frame-ancestors` de la CSP.
  { key: "X-Frame-Options",           value: "DENY" },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Desde Next 15.2 la metadata de las páginas dinámicas se envía en streaming
  // y termina en el <body>. Chrome solo reconoce el <link rel="manifest"> dentro
  // del <head>: sin esto la PWA no es instalable ("no-manifest"). Con todos los
  // user agents tratados como "limitados", la metadata va en el <head>; como es
  // estática, no demora la respuesta.
  htmlLimitedBots: /.*/,

  // No anunciar el framework (`X-Powered-By: Next.js`): es información gratis
  // para quien busca versiones con vulnerabilidades conocidas.
  poweredByHeader: false,

  async headers() {
    return [
      { source: "/:path*", headers: headersSeguridad },
      // Las respuestas de la API son datos de un usuario: que nadie en el
      // camino (proxy, CDN) las guarde. Las imágenes ponen su propio
      // `private` (ver api/img).
      { source: "/api/:path((?!img/).*)", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
