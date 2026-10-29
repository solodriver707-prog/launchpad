// treid service worker: web push notifications only (no offline caching — the site always loads fresh)
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('push', function (e) {
  var m = {}; try { m = e.data ? e.data.json() : {}; } catch (er) { m = { title: 'treid', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(String(m.title || 'treid').slice(0, 120), {
    body: String(m.body || '').slice(0, 300), tag: m.tag ? String(m.tag).slice(0, 80) : undefined, renotify: !!m.tag,
    icon: 'icons/app-192.png', badge: 'icons/badge-96.png', data: { path: typeof m.path === 'string' ? m.path : '' } }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var path = String((e.notification.data && e.notification.data.path) || ''); if (!/^#\/[A-Za-z0-9\/_-]*$/.test(path)) path = '';
  var url = self.registration.scope + path;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (ws) {
    for (var i = 0; i < ws.length; i++) if (ws[i].url.indexOf(self.registration.scope) === 0) { ws[i].postMessage({ path: path }); return ws[i].focus(); }
    return self.clients.openWindow(url);
  }));
});
