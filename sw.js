// 電波がないときでも開けるように、ページのファイルを覚えておく。
// 電波があるときは、いつもサーバーから新しいものを読む（直した版がすぐに届くように）。
const CACHE = 'onsei-v7';
const ICS_CACHE = 'onsei-ics'; // 今の予定のファイル（app.js が入れる）。サーバーには送らない
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png',
  'js/date.js', 'js/app.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  // 同じ chocorin0000.github.io にほかのアプリもあるので、消すのは自分（onsei-）の覚えだけ
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('onsei-') && k !== CACHE && k !== ICS_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (!u.pathname.includes('/chou-onsei/') && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return; // ほかのアプリのファイルには手を出さない
  if (u.pathname.endsWith('/ics/yotei.ics')) {
    e.respondWith(caches.open(ICS_CACHE).then(c => c.match(u.origin + u.pathname)).then(res => {
      if (!res) return new Response('', { status: 404 });
      return res.text().then(t => new Response(t, { headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="yotei.ics"',
        'Cache-Control': 'no-store',
      } }));
    }));
    return;
  }
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
