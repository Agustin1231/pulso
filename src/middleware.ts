import { NextResponse, type NextRequest } from "next/server";

/**
 * Content-Security-Policy con nonce (plantilla, fila 10; también frena el robo
 * de datos por XSS de la fila 7).
 *
 * Cada respuesta HTML lleva un nonce nuevo y solo corren los scripts que lo
 * tienen: Next se lo pone a los suyos al leerlo de este header. Un script
 * inyectado no lo conoce, así que no corre. `strict-dynamic` deja que esos
 * scripts carguen los chunks de la app.
 *
 * Para que el nonce llegue al HTML, las páginas se renderizan por petición
 * (`dynamic = "force-dynamic"` en el layout raíz).
 *
 * El resto de los headers de seguridad están en next.config.ts.
 */
export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Tailwind y Radix ponen estilos inline; un estilo inyectado no ejecuta código.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Solo documentos HTML: ni la API, ni los estáticos, ni el service worker.
      source: "/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.json|icons).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
