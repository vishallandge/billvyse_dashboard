'use client';

import { useEffect } from 'react';
import { syncPushSubscription } from '../../lib/push';

export default function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;

    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        // Re-registers an already-granted subscription with the server on every load.
        // A push service can rotate or drop a subscription at any time, and a restore from
        // backup can lose the server's copy — either way the device stays "on" in Settings
        // while quietly receiving nothing until something re-registers it. Never prompts.
        .then((registration) => {
          // Fetch worker updates even when an installed app has an older controller.
          registration.update().catch(() => {});
          return syncPushSubscription();
        })
        .catch(() => {
          console.warn('Service worker registration failed');
        });
    };

    // The service worker tells us when the browser retires a subscription; only the page
    // has the auth token needed to register the replacement.
    const onMessage = (event) => {
      if (event.data?.type === 'push-subscription-expired') {
        syncPushSubscription();
      }
    };

    const onVisible = () => { if (document.visibilityState === 'visible') onLoad(); };
    window.addEventListener('focus', onLoad);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('load', onLoad);
    window.addEventListener('online', onLoad);
    navigator.serviceWorker.addEventListener('message', onMessage);
    // `load` has usually already fired by the time React hydrates, which would leave the
    // worker unregistered until a full refresh.
    if (document.readyState === 'complete') onLoad();

    return () => {
      window.removeEventListener('focus', onLoad);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('load', onLoad);
      window.removeEventListener('online', onLoad);
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, []);

  return null;
}
