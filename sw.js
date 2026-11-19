/* Nuclear System service worker — offline + online */
const VER = "v1";
const SHELL = "ns-shell-" + VER;
const RUNTIME = "ns-runtime-" + VER;
const SHELL_FILES = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png", "./icons/favicon.svg", "./icons/favicon-32.png"
];
// third-party files the app needs to run offline (cached, never blocks install)
const EXTRA = [
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js",
  "https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Manrope:wght@500;600;700;800&family=Space+Mono:ital,wght@0,400;0,700;1,400&family=Sora:wght@600;700;800&display=swap"
];
const CACHEABLE_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "www.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await Promise.all(SHELL_FILES.map(u => shell.add(new Request(u, { cache: "reload" })).catch(() => {})));
    const rt = await caches.open(RUNTIME);
    await Promise.all(EXTRA.map(u => fetch(new Request(u, { mode: "no-cors" })).then(r => rt.put(u, r)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keep = [SHELL, RUNTIME];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const good = r => r && (r.ok || r.type === "opaque");

async function networkFirst(req, fallbackKey, ms) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))
    ]);
    if (good(res)) cache.put(fallbackKey || req, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(req, { ignoreSearch: true })) ||
           (await cache.match(fallbackKey)) ||
           (await cache.match("./index.html")) ||
           new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (good(res)) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || new Response("", { status: 504 });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Pages: network first (fresh when online), cached copy when offline
  if (req.mode === "navigate") {
    e.respondWith(networkFirst(req, "./index.html", 4000));
    return;
  }
  // Own files
  if (url.origin === self.location.origin) {
    e.respondWith(staleWhileRevalidate(req, SHELL));
    return;
  }
  // Fonts + Firebase SDK scripts
  if (CACHEABLE_HOSTS.includes(url.hostname) && (url.hostname !== "www.gstatic.com" || url.pathname.startsWith("/firebasejs/"))) {
    e.respondWith(staleWhileRevalidate(req, RUNTIME));
    return;
  }
  // Everything else (Firestore, Google sign-in, auth handler) goes straight to network
});
