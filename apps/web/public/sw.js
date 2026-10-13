// PieChat Production Service Worker
const CACHE_NAME = "piechat-core-v1";
const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png"
];

// URLs that must NEVER be cached by the service worker
function isUnsafeToCache(url) {
  const u = new URL(url);
  // Supabase API, database queries, and auth endpoints
  if (u.hostname.includes("supabase.co")) return true;
  // Local API routes and auth flows
  if (u.pathname.startsWith("/api/")) return true;
  if (u.pathname.startsWith("/auth")) return true;
  // Next.js development and server actions
  if (u.pathname.includes("_next/data")) return true;
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  // Only handle GET requests
  if (event.request.method !== "GET") return;

  const url = event.request.url;

  // Never cache Supabase calls, auth, or private API endpoints
  if (isUnsafeToCache(url)) {
    return;
  }

  // Handle navigation (HTML pages): Network-first
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // Static assets (images, icons, manifest): Cache-first with network fallback
  if (
    url.includes("/icons/") ||
    url.includes("manifest.webmanifest") ||
    url.includes("manifest.json")
  ) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }
});
