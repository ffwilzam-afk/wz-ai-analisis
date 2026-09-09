const CACHE = 'wz-manage-pro-pwa-v3';
const APP_SHELL = ['/', '/index.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];
const shownNotificationIds = new Set();

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title || 'WZ MANAGE PRO', {
    body: data.body || 'Ada pembaruan baru.',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || data.icon || '/icons/icon-192.png',
    timestamp: Number(data.timestamp) || Date.now(),
    tag: data.tag || 'wz-notification',
    renotify: false,
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('message', event => {
  const data = event.data;
  if (!data || data.type !== 'WZ_SHOW_NOTIFICATION' || !data.id || shownNotificationIds.has(data.id)) return;
  shownNotificationIds.add(data.id);
  event.waitUntil(self.registration.showNotification(data.title || 'WZ MANAGE PRO', {
    body: data.message || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.icon || '/icons/icon-192.png',
    timestamp: Number(data.timestamp) || Date.now(),
    tag: `wz-${data.id}`,
    renotify: false,
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(clients.matchAll({type: 'window', includeUncontrolled: true}).then(clientList => {
    for (const client of clientList) {
      if ('focus' in client) return client.focus();
    }
    return clients.openWindow(targetUrl);
  }));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Keep API/auth data out of the cache. Business data is server-only. Navigation falls back to the app shell;
  // static assets use a network-first strategy so updates reach the installed app.
  if (url.pathname.startsWith('/api/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('/index.html', copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
