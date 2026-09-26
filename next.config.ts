import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Desde Next 15.2 la metadata de las páginas dinámicas se envía en streaming
  // y termina en el <body>. Chrome solo reconoce el <link rel="manifest"> dentro
  // del <head>: sin esto la PWA no es instalable ("no-manifest"). Con todos los
  // user agents tratados como "limitados", la metadata va en el <head>; como es
  // estática, no demora la respuesta.
  htmlLimitedBots: /.*/,
};

export default nextConfig;
