// Service Worker de Pulso — modo offline básico y push notifications.
//
// Estrategias de caché:
//   · Navegaciones (HTML): red primero; si no hay conexión, la última versión
//     visitada de esa página y, si nunca se visitó, una página "sin conexión".
//   · /_next/static/ e íconos: caché primero (los nombres llevan hash, no cambian).
//   · /api/ y cualquier cosa que no sea GET: siempre red (IA, push, server actions).
// Los datos se leen con server actions (POST), así que sin conexión la interfaz
// abre pero los números necesitan red. Subir VERSION al cambiar este archivo.

const VERSION = "pulso-v2";
const CACHE_PAGINAS = `${VERSION}-paginas`;
const CACHE_ESTATICO = `${VERSION}-estatico`;
const MAX_PAGINAS = 30;
const MAX_ESTATICO = 250;
const PRECARGA = ["/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

const PAGINA_SIN_CONEXION = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#ff6b6b">
<title>Pulso — Sin conexión</title>
<style>
  body { margin: 0; box-sizing: border-box; min-height: 100vh; display: grid; place-items: center; padding: 16px;
         background: #0d1117; color: #e6edf3; font-family: system-ui, sans-serif; text-align: center; }
  img { width: 72px; height: 72px; border-radius: 16px; }
  h1 { font-size: 1.25rem; margin: 16px 0 8px; }
  p { color: #8b949e; max-width: 22rem; margin: 0 auto 20px; line-height: 1.5; }
  button { background: #ff6b6b; color: #0d1117; border: 0; border-radius: 10px; padding: 10px 18px;
           font-weight: 700; font-size: 0.95rem; cursor: pointer; }
</style></head>
<body><main>
  <img src="/icons/icon-192.png" alt="">
  <h1>Sin conexión</h1>
  <p>Esta pantalla todavía no se abrió con internet en este dispositivo. Las que ya visitaste siguen disponibles; los datos se actualizan cuando vuelva la conexión.</p>
  <button onclick="location.reload()">Reintentar</button>
</main></body></html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_ESTATICO).then((c) => c.addAll(PRECARGA)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function recortar(nombre, maximo) {
  const cache = await caches.open(nombre);
  const claves = await cache.keys();
  for (const k of claves.slice(0, Math.max(0, claves.length - maximo))) await cache.delete(k);
}

const cacheable = (res) => res && res.ok && res.type === "basic";

async function redPrimero(request) {
  const cache = await caches.open(CACHE_PAGINAS);
  try {
    const res = await fetch(request);
    if (cacheable(res)) {
      await cache.put(request, res.clone());
      recortar(CACHE_PAGINAS, MAX_PAGINAS);
    }
    return res;
  } catch (_) {
    const guardada = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
    return guardada ?? new Response(PAGINA_SIN_CONEXION, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

async function cachePrimero(request) {
  const cache = await caches.open(CACHE_ESTATICO);
  const guardada = await cache.match(request);
  if (guardada) return guardada;
  const res = await fetch(request);
  if (cacheable(res)) {
    await cache.put(request, res.clone());
    recortar(CACHE_ESTATICO, MAX_ESTATICO);
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(redPrimero(request));
  } else if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cachePrimero(request));
  }
});

// ─── Push notifications ────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = { title: "Pulso", body: "Tienes un recordatorio", url: "/dashboard" };

  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {}

  const options = {
    body: data.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    vibrate: [100, 50, 100],
    data: { url: data.url ?? "/dashboard" },
    actions: [
      { action: "abrir", title: "Ver Pulso" },
      { action: "cerrar", title: "Cerrar" },
    ],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// ─── Click en notificación ────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "cerrar") return;

  const url = event.notification.data?.url ?? "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        existing.navigate(url);
      } else {
        self.clients.openWindow(url);
      }
    })
  );
});
