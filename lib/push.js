import { apiFetch } from './api';
import { looksSignedIn } from './session';

// Browser-side half of web push. The server half is backend/utils/webPush.js.
//
// Every function here is written to fail quietly and return a state rather than throw:
// notification support is genuinely absent on some of the devices this app runs on (an
// iPhone Safari tab that has never been added to the home screen, a locked-down counter
// PC), and none of that is an error the shopkeeper did anything to cause.

// The subscribe API wants the VAPID public key as raw bytes, but it travels as base64url
// in env and JSON. Padding has to be restored by hand — atob rejects the unpadded form
// browsers themselves emit.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

// A PushSubscription serialises to something with ArrayBuffer keys, which JSON.stringify
// turns into `{}`. toJSON() is the only correct way to get the wire shape.
function serialise(subscription) {
  const json = subscription.toJSON();
  return { endpoint: json.endpoint, keys: json.keys };
}

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Everything the settings UI needs to render without asking the user for anything.
 *
 * `permission` is deliberately surfaced separately from `subscribed`: "denied" is a
 * dead end this app cannot recover from — no amount of clicking our button will bring the
 * browser prompt back — so the UI has to stop offering and start explaining instead.
 */
export async function getPushStatus() {
  if (!pushSupported()) return { supported: false, permission: 'unsupported', subscribed: false };

  const permission = Notification.permission;
  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    return {
      supported: true,
      permission,
      subscribed: Boolean(existing),
      endpoint: existing?.endpoint || null,
    };
  } catch {
    return { supported: true, permission, subscribed: false };
  }
}

/**
 * Asks for permission (if not already granted), subscribes, and registers the endpoint
 * with the server.
 *
 * Must be called from a user gesture. Browsers reject a permission prompt that wasn't
 * triggered by a click, and — worse — some count an un-gestured request as a soft denial,
 * which permanently burns the shop's one chance to ask.
 */
export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };

  const config = await apiFetch('/api/seller/push/config').catch(() => null);
  if (!config?.configured || !config.publicKey) {
    return { ok: false, reason: 'server-not-configured' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: permission };

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      // Non-negotiable in every current browser: a push that does not result in a visible
      // notification is treated as abuse and eventually revokes the subscription.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    });
  }

  await apiFetch('/api/seller/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(serialise(subscription)),
  });

  return { ok: true, endpoint: subscription.endpoint };
}

export async function disablePush() {
  if (!pushSupported()) return { ok: false };

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return { ok: true };

  const { endpoint } = serialise(subscription);
  // Server first. If the browser drops the subscription but the row survives, the shop
  // keeps getting notifications it just switched off — the one failure mode here that
  // looks like the app ignoring an explicit instruction.
  await apiFetch('/api/seller/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});

  await subscription.unsubscribe().catch(() => {});
  return { ok: true };
}

/**
 * Re-registers an already-granted subscription with the server on page load.
 *
 * Silent by design and never prompts. It exists because a subscription can be rotated by
 * the push service or dropped by the browser at any time; without this the device stays
 * "on" in the shop's settings while quietly receiving nothing. It also repairs the case
 * where the server row was lost (a restore from backup, a pruned endpoint) but the browser
 * still holds a valid subscription.
 */
export async function syncPushSubscription() {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  // Runs from the root layout, which also renders the login and password-reset screens.
  // Without this guard a signed-out visitor fires an unauthenticated request whose 401
  // now bounces them to /login — mid-typing, on the login page they were already on.
  if (!looksSignedIn()) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (!existing) return;
    await apiFetch('/api/seller/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(serialise(existing)),
    });
  } catch {
    // A failed background sync is not worth a message: the next page load retries, and the
    // Settings screen shows the real state either way.
  }
}

export async function sendTestPush() {
  return apiFetch('/api/seller/push/test', { method: 'POST' });
}
