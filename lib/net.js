/**
 * The network layer every request in the dashboard goes through.
 *
 * A kirana counter does not have a network in the sense a laptop on office wifi does. It
 * has a phone hotspot that drops when a bus goes past, a broadband line that resets at
 * noon, and a 4G signal that varies with where the shopkeeper is standing. Until now every
 * one of those turned into the same thing on screen: a red "Failed to fetch", a lost form,
 * and a shopkeeper who has to remember what they typed.
 *
 * What this file adds, and what each part is actually for:
 *
 *   - a DEADLINE on every request. `fetch` has none. On a dead-but-not-closed connection —
 *     the normal mobile failure, where the socket is gone and neither end has been told —
 *     a request hangs until the browser gives up, which can be minutes of a spinner.
 *   - RETRIES, with exponential backoff and jitter, for the failures that are worth
 *     retrying: a dropped connection, a 502/503/504 from a server that is restarting, a 429
 *     that told us exactly how long to wait. Most outages last seconds; a retry means the
 *     shopkeeper never learns one happened.
 *   - an IDEMPOTENCY KEY on every write, so those retries cannot double-save. The key is
 *     minted once per logical request and reused across its retries; the server recognises
 *     the second arrival and replays the first answer instead of billing anyone twice.
 *     (backend/middleware/idempotency.js.)
 *   - CONNECTION STATE the whole app can see, so "you are offline" is a calm line in the
 *     chrome rather than an error on whichever screen happened to be open, and so screens
 *     can refetch the moment the connection is back.
 */

const OFFLINE_EVENT = 'billvyse:net-status';
const RECOVERED_EVENT = 'billvyse:net-recovered';

// Retried. A 500 is deliberately NOT in this list: it means the server understood the
// request and broke, and sending it again just breaks it again — the transient database
// failures worth retrying are answered as 503 by the API on purpose.
const RETRYABLE_STATUS = new Set([408, 425, 429, 502, 503, 504]);

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_RETRY_WAIT_MS = 15000;

const state = {
  // What the browser thinks. Necessary but not sufficient — a phone connected to a wifi
  // router whose internet is down reports `online: true` all day.
  online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  // What our own requests have actually proved. This is the one the banner trusts.
  reachable: true,
  // A request is mid-retry right now, so the chrome can say "reconnecting" rather than
  // "offline" — they are different situations and the second one is not the user's fault.
  retrying: false,
  lastOkAt: Date.now(),
};

export function getNetStatus() {
  return { ...state, healthy: state.online && state.reachable };
}

function emit() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OFFLINE_EVENT, { detail: getNetStatus() }));
}

/** Subscribe to connection changes. Returns an unsubscribe. */
export function onNetStatus(handler) {
  if (typeof window === 'undefined') return () => {};
  const listener = (event) => handler(event.detail);
  window.addEventListener(OFFLINE_EVENT, listener);
  return () => window.removeEventListener(OFFLINE_EVENT, listener);
}

/**
 * Fires once each time the connection comes BACK.
 *
 * The reason it is a separate event: a screen that was open while the connection was down
 * is showing stale data, and the honest thing to do is refetch. Every seller page loads its
 * data in a `useEffect`, so one listener per screen is all it takes — see DashboardShell,
 * which refetches the notification feed on it.
 */
export function onNetRecovered(handler) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(RECOVERED_EVENT, handler);
  return () => window.removeEventListener(RECOVERED_EVENT, handler);
}

function markReachable() {
  const wasDown = !state.reachable || !state.online;
  state.reachable = true;
  state.online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  state.retrying = false;
  state.lastOkAt = Date.now();
  emit();
  if (wasDown && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(RECOVERED_EVENT));
    stopProbing();
  }
}

function markUnreachable() {
  if (state.reachable) {
    state.reachable = false;
    emit();
  }
  startProbing();
}

function markRetrying(retrying) {
  if (state.retrying !== retrying) {
    state.retrying = retrying;
    emit();
  }
}

/**
 * While the connection is down, keep asking whether it is back.
 *
 * The browser's `online` event is not enough on its own: it fires when the network
 * interface comes up, not when the internet behind it works, and on a hotspot those are
 * minutes apart. So once something has actually failed, this pings the cheapest endpoint the
 * API has until it answers — backing off from 3 seconds to 30 so a long outage costs a
 * battery nothing.
 */
let probeTimer = null;
let probeDelay = 3000;

function stopProbing() {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = null;
  probeDelay = 3000;
}

function startProbing() {
  if (probeTimer || typeof window === 'undefined') return;
  const tick = async () => {
    probeTimer = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${API_BASE()}/api/health`, {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timer);
      // A 503 from the readiness probe means the server is up but its database is not.
      // That is still "not reachable" as far as the shopkeeper is concerned.
      if (res.ok) {
        markReachable();
        return;
      }
    } catch {
      // still down
    }
    probeDelay = Math.min(probeDelay * 1.6, 30000);
    probeTimer = setTimeout(tick, probeDelay);
  };
  probeTimer = setTimeout(tick, probeDelay);
}

function API_BASE() {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    state.online = true;
    emit();
    // Do not declare victory yet — the interface is up, which is not the same as the
    // internet working. Let a real request prove it.
    startProbing();
  });
  window.addEventListener('offline', () => {
    state.online = false;
    emit();
  });
}

/**
 * A request's identity, minted once and reused by every retry of it.
 *
 * Not `crypto.randomUUID`: it is missing on the older Android WebViews these counters
 * actually run on, and a crash here would break every save in the app. Timestamp plus two
 * random blocks is unique enough for one browser's requests and never throws. Same
 * reasoning as newClientBillId() in lib/offlineQueue.js.
 */
export function newIdempotencyKey() {
  return `idem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
}

function cancellationError(signal) {
  return signal?.reason || new DOMException('Request cancelled', 'AbortError');
}

/**
 * Waits for the delay — but wakes early if the connection comes back first.
 *
 * The difference matters at the counter. Backing off 8 seconds when the wifi returned after
 * 1 is 7 seconds of a shopkeeper watching a spinner with a customer in front of them.
 */
function waitBeforeRetry(ms, signal) {
  if (signal?.aborted) return Promise.reject(cancellationError(signal));
  return new Promise((resolve, reject) => {
    let done = false;
    const listenOnline = typeof window !== 'undefined' && navigator.onLine === false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (listenOnline) window.removeEventListener('online', onOnline);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onOnline = () => finish();
    const onAbort = () => finish(cancellationError(signal));
    const timer = setTimeout(() => finish(), Math.min(ms, MAX_RETRY_WAIT_MS));
    if (listenOnline) window.addEventListener('online', onOnline);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** How long the server asked us to wait, if it said. Capped — a 15-minute limit window is
 *  not something to hold a request open for; that one surfaces to the user instead. */
function retryAfterMs(response) {
  const header = response.headers.get('Retry-After');
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds * 1000 <= MAX_RETRY_WAIT_MS ? seconds * 1000 : null;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(cancellationError(init.signal));
  if (init.signal?.aborted) throw cancellationError(init.signal);
  init.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * The one function every request in the app ends up calling.
 *
 * `retries` counts EXTRA attempts, not total. Writes are retried too — that is the whole
 * point of the idempotency key — but one attempt fewer, because a write that is genuinely
 * in doubt is better surfaced to a human than hammered.
 */
export async function resilientFetch(url, init = {}, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = (init.method || 'GET').toUpperCase() === 'GET' ? 3 : 2,
    retryOn = RETRYABLE_STATUS,
  } = options;

  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    if (init.signal?.aborted) throw cancellationError(init.signal);
    try {
      const response = await fetchWithTimeout(url, init, timeoutMs);

      // Anything the server answered — including a 400 or a 500 — means we reached it.
      markReachable();

      if (attempt < retries && retryOn.has(response.status)) {
        const wait = retryAfterMs(response) ?? backoffFor(attempt);
        markRetrying(true);
        await waitBeforeRetry(wait, init.signal);
        attempt += 1;
        continue;
      }

      markRetrying(false);
      return response;
    } catch (error) {
      // Superseded searches are cancellations, not connectivity failures.
      if (init.signal?.aborted) {
        markRetrying(false);
        throw cancellationError(init.signal);
      }
      lastError = error;
      // A thrown fetch is always a transport problem: DNS, TLS, a dropped connection, or
      // our own AbortController firing. None of them mean the request was refused, and all
      // of them are worth trying again.
      markUnreachable();

      if (attempt >= retries) break;
      markRetrying(true);
      try {
        await waitBeforeRetry(backoffFor(attempt), init.signal);
      } catch (cancelled) {
        markRetrying(false);
        throw cancelled;
      }
      attempt += 1;
    }
  }

  markRetrying(false);

  // One honest error, in the app's own voice, instead of the browser's "Failed to fetch" —
  // which every shopkeeper reads as "the app is broken".
  const error = new Error('NETWORK_UNREACHABLE');
  error.code = 'NETWORK_UNREACHABLE';
  error.status = 0;
  error.cause = lastError;
  error.offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  throw error;
}

/**
 * Exponential, with jitter.
 *
 * The jitter is not decoration. Without it, every request that failed during the same
 * two-second blip retries at the same millisecond — a market's worth of counters hitting a
 * server that is already struggling, which is how a brief outage becomes a long one.
 */
function backoffFor(attempt) {
  const base = Math.min(600 * 2 ** attempt, 8000);
  return Math.round(base / 2 + Math.random() * (base / 2));
}
