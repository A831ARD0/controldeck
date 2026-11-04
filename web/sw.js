// Service worker de la app de tablet (solo con HTTPS, por ejemplo vía Tailscale).
// Primero la red y, si no hay conexión, la última copia guardada: así la app abre al instante
// y siempre carga la versión más nueva cuando hay red. Nunca guarda la conexión cifrada (/ws).

const CACHE = 'controldeck-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/ws') return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached ?? new Response('Sin conexión con la computadora', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))),
  );
});
