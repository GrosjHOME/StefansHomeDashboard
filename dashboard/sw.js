// Service Worker: macht das Dashboard als App installierbar (Android, Windows) und
// laesst es auch ohne Netz starten.
//
// Strategie "Netzwerk zuerst": jede Anfrage geht zuerst ins Netz, damit immer die
// neueste Version kommt (Updates wirken wie bisher sofort nach dem Push). Der Cache
// ist nur Rueckfall ohne Verbindung. Live-Daten (ThingSpeak, Open-Meteo) laufen von
// einem fremden Server und werden hier gar nicht angefasst.
//
// Bei Aenderungen an dieser Datei die Version hochzaehlen - dann raeumt "activate"
// den alten Cache weg.
const CACHE = "zuhause-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./favicon.svg",
               "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // nur eigene Dateien (GET); Daten-APIs anderer Server direkt durchlassen
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});
