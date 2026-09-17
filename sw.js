// Service Worker：把所有檔案存到手機上，離線也能開
// 版本號在 version.js，每次部署把 APP_BUILD 加一，使用者會看到「有新版本」提示

importScripts('./version.js');
const CACHE = `solitaire-${self.APP_VERSION}-${self.APP_BUILD}`;
const ASSETS = [
  './',
  './index.html',
  './version.js',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/engine.js',
  './js/render.js',
  './js/cards.js',
  './js/rng.js',
  './js/rules.js',
  './js/sound.js',
  './js/games/index.js',
  './js/games/klondike.js',
  './js/games/spider.js',
  './js/games/freecell.js',
  './js/games/pyramid.js',
  './js/games/tripeaks.js',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

// 本機開發時不走快取，方便看到最新修改
const DEV = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

self.addEventListener('fetch', (e) => {
  if (DEV || e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined));
    })
  );
});
