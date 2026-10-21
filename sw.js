// Tavolo demo: funziona anche senza internet dopo la prima apertura
const C = "tavolo-demo-1.11.0";
const FILE = ["./", "index.html", "ordina.html", "demo.js", "qrcode.js", "icona.svg", "icona-192.png", "icona-512.png", "icona-180.png", "manifest.webmanifest"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILE))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copia = r.clone(); caches.open(C).then(c => c.put(e.request, copia)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
