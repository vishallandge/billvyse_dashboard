import { apiFetch } from './api';
import { getActiveStoreId } from './session';

/**
 * A short-lived cache in front of the handful of GETs the app shell re-reads constantly.
 *
 * THE PROBLEM THIS SOLVES
 *
 * DashboardShell wraps every seller screen, and two of its effects list `pathname` in their
 * dependencies: the sidebar badge counts and the module/plan flags that decide which links
 * exist. That was a deliberate choice — a count has to clear the moment the queue clears,
 * and a screen switched off in Settings has to vanish now rather than on the next reload.
 * The cost of it was invisible: EVERY navigation inside the dashboard fired both calls
 * again, so opening Khata from Billing was three requests, not one.
 *
 * GET /api/seller/notifications is not a cheap request to make three times. It resolves the
 * shop's lens and then runs a Promise.all of roughly twenty reads across stock, expiry
 * batches, orders, khata, claims, promises, appointments, purchase orders, jobs,
 * memberships and estimates, and finishes with a grouped aggregate over the shop's payment
 * history. A shopkeeper clicking through five screens paid for that five times, and every
 * one of those was competing for the connection with the data the screen they asked for
 * actually needed.
 *
 * WHY A TTL RATHER THAN DROPPING `pathname`
 *
 * Because the freshness was the point. A few seconds of cache is invisible to a person
 * clicking through screens, and anything that genuinely changes the numbers already
 * announces itself: the shell listens for `dukaan:notificationsChanged`, for
 * `dukaan:screensChanged`, and for the payment-claim socket events, and each of those calls
 * refresh() below, which ignores the cache entirely. So the counts still clear the instant
 * something clears them — they just stop being recomputed for a navigation that changed
 * nothing.
 *
 * The cache is keyed by the active store as well as the path. Store id travels as a request
 * header, so the same URL means different things in a multi-store shop, and serving one
 * store's low-stock count under another store's name would be worse than any slowness.
 */
const entries = new Map();

function keyFor(path) {
  return `${getActiveStoreId() || ''}|${path}`;
}

/**
 * Resolve `path`, reusing a recent answer when there is one. Concurrent callers share a
 * single request — three effects asking at once is one round trip, not three.
 */
export function freshFetch(path, { ttl = 20000 } = {}) {
  const key = keyFor(path);
  const hit = entries.get(key);

  if (hit) {
    // Somebody already asked and has not been answered yet: wait for their answer.
    if (hit.request) return hit.request;
    if (Date.now() - hit.at < ttl) return Promise.resolve(hit.value);
  }

  const request = apiFetch(path)
    .then((value) => {
      // Ignore results superseded by a refresh, store switch or logout.
      if (entries.get(key)?.request === request) {
        entries.set(key, { at: Date.now(), value, request: null });
      }
      return value;
    })
    .catch((err) => {
      // A failed read must not be remembered as an answer, or the shell would sit on a
      // stale count for the rest of the TTL after one dropped request.
      if (entries.get(key)?.request === request) entries.delete(key);
      throw err;
    });

  entries.set(key, { at: 0, value: undefined, request });
  return request;
}

/** Throw away what we know about `path`, so the next read goes to the server. */
export function invalidate(path) {
  entries.delete(keyFor(path));
}

/** Re-read `path` now, whatever the cache says. What the change events call. */
export function refresh(path) {
  invalidate(path);
  return freshFetch(path);
}

/**
 * Drop everything. Called on logout and on a store switch — the next person at this
 * counter must never be shown the last one's numbers, not even for twenty seconds.
 */
export function clearFreshCache() {
  entries.clear();
}
