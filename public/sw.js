const OFFLINE_CACHE = 'billvyse-offline-v4';
const OFFLINE_PAGE = '/offline.html';
const OFFLINE_LOGO = '/icon-192.png';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(OFFLINE_CACHE);
    await cache.addAll([OFFLINE_PAGE, OFFLINE_LOGO].map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && url.origin === self.location.origin &&
      (url.pathname === OFFLINE_LOGO || url.pathname === OFFLINE_PAGE)) {
    event.respondWith((async () => {
      const cache = await caches.open(OFFLINE_CACHE);
      return (await cache.match(url.pathname)) || fetch(event.request);
    })());
    return;
  }
  event.respondWith(fetch(event.request).catch(async () => {
    // Only document navigations get HTML; API and asset failures retain a 503.
    if (event.request.mode === 'navigate') {
      const cache = await caches.open(OFFLINE_CACHE);
      const page = await cache.match(OFFLINE_PAGE);
      if (page) return new Response(await page.text(), {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return new Response('Connection unavailable. Please try again.', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }));
});

// ---------------------------------------------------------------------------
// Push notifications
//
// This is the only part of the app that runs when the dashboard is closed. Everything
// the notification system computes — a payment claim waiting, an online order nobody has
// accepted, tomorrow's expiry — used to exist only inside an open tab, which is exactly
// when a shopkeeper is not looking at it.
// ---------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // A push that isn't our JSON (a provider health check, an older payload shape) should
    // still surface something rather than throw inside the worker.
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'BillVyse';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Same tag replaces the previous notification instead of stacking, so the morning
      // summary never piles up. `renotify` makes the replacement still buzz — otherwise a
      // tagged update arrives completely silently and is never seen.
      tag: data.tag || 'billvyse',
      renotify: true,
      // A new order or a payment claim stays on screen until it is dealt with; routine
      // summaries auto-dismiss like any other notification.
      requireInteraction: data.urgency === 'high',
      timestamp: Date.now(),
      data: { url: data.url || '/seller' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/seller';

  // Focus the dashboard if it is already open somewhere rather than opening a second
  // window — a counter machine ending the day with nine dashboard tabs is its own bug.
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            await client.navigate(target).catch(() => {});
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});

// Push services expire subscriptions on their own schedule. Without this the device goes
// quiet permanently and neither side ever finds out — the server keeps "delivering" to an
// endpoint the browser has already retired.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // The worker has no access to the auth token, so it cannot re-register by itself.
      // It tells any open tab instead, and the page re-subscribes with its credentials.
      // If no tab is open, the next page load re-subscribes anyway (see PushSetup.js).
      for (const client of windows) {
        client.postMessage({ type: 'push-subscription-expired' });
      }
    })()
  );
});
