// A small localStorage-backed queue for bills created while offline. Kirana counters
// routinely lose internet mid-day; billing shouldn't stop just because the API call
// can't reach the server. Queued bills survive a page reload and get replayed against
// POST /api/seller/bills as soon as connectivity (and a successful sync pass) returns.
const QUEUE_KEY = 'dukaan_offline_bills';

/**
 * A bill's identity, decided in the browser before the request leaves.
 *
 * This is what makes a retry safe. A POST that reached the server but whose response never
 * made it back — a counter on 4G, a page reload mid-request, the queue below replaying
 * something that had in fact already gone through — used to create a second bill and take
 * the stock off a second time. The server treats this key as unique per shop, so the retry
 * is recognised and the original bill is returned instead of a duplicate being written.
 *
 * Not a UUID because `crypto.randomUUID` is missing on the older Android WebViews these
 * counters actually run on; the timestamp plus two random blocks is unique enough for one
 * shop's bills and never throws.
 */
export function newClientBillId() {
  return `cb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
}

export function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * `shopId` tags the bill with the shop it was rung for. The queue lives in the browser, not
 * in an account: without the tag, shop A signing out with bills still waiting and shop B
 * signing in on the same phone sent A's sales into B's books on the next sync — one shop's
 * money lost, the other's inflated. Each shop now only ever syncs (and sees) its own.
 */
export function enqueueBill(payload, shopId = null) {
  const queue = getQueue();
  const entry = {
    localId: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    shop: shopId ? String(shopId) : null,
    // Stamped once, here, and never regenerated — the whole point is that every replay of
    // this entry carries the same key. Reused from the payload when the caller already
    // made one (the online path does, so a bill that failed mid-flight and fell back to
    // the queue keeps the identity it was first sent with).
    payload: { ...payload, clientBillId: payload.clientBillId || newClientBillId() },
    queuedAt: new Date().toISOString(),
    error: null,
  };
  queue.push(entry);
  saveQueue(queue);
  return entry;
}

export function removeFromQueue(localId) {
  saveQueue(getQueue().filter((entry) => entry.localId !== localId));
}

export function updateQueueEntry(localId, patch) {
  saveQueue(getQueue().map((entry) => (entry.localId === localId ? { ...entry, ...patch } : entry)));
}

/**
 * The waiting bills that belong to this shop. Entries queued before tagging existed carry no
 * shop and are left to whoever syncs first — exactly how every entry behaved until now.
 */
export function queueFor(shopId) {
  const id = shopId ? String(shopId) : null;
  // No shop known yet → nothing. Never "everything": that is how one shop's bills would be
  // posted into another's account.
  if (!id) return [];
  return getQueue().filter((entry) => !entry.shop || entry.shop === id);
}

export function queueCount(shopId = null) {
  return queueFor(shopId).length;
}

/**
 * A waiting bill the server has refused for the plan (its monthly bill limit, an expired
 * plan). It is a real sale and must never be thrown away; it goes through once the plan
 * allows it. Until then no more offline bills are taken: billing offline must not be a way
 * round a limit that billing online respects.
 */
export function isPlanRefusal(entry) {
  return entry?.errorStatus === 402 || /^PLAN_|^USAGE_LIMIT/.test(String(entry?.errorCode || ''));
}

/**
 * How long a counter may keep billing without the server.
 *
 * Offline billing exists for the hour the network drops, not as a way to run the shop
 * without ever syncing. Left open-ended, the Play app (which carries its own pages and so
 * keeps working with no network at all) could bill for weeks — past its plan's limit, past
 * an expired plan — with nothing recorded anywhere. 72 hours matches the server, which only
 * dates a queued bill to when it was rung if it arrives within that window.
 */
/**
 * Whether the super admin has switched offline billing ON for this shop (Admin → Modules →
 * "Offline billing", OFF by default). Read from /api/seller/modules while online and kept on
 * the device, because the Play app opens with no network at all and must still know the
 * answer. Never known → OFF. Bills already waiting still sync either way.
 */
const OFFLINE_ALLOWED_PREFIX = 'dukaan_offline_allowed:';

export function rememberOfflineAllowed(shopId, allowed) {
  if (!shopId) return;
  try {
    localStorage.setItem(OFFLINE_ALLOWED_PREFIX + shopId, allowed ? '1' : '0');
  } catch {
    /* unavailable — stays OFF, the safe answer */
  }
}

export function lastKnownOfflineAllowed(shopId) {
  if (!shopId) return false;
  try {
    return localStorage.getItem(OFFLINE_ALLOWED_PREFIX + shopId) === '1';
  } catch {
    return false;
  }
}

export const MAX_OFFLINE_HOURS = 72;
export const MAX_OFFLINE_BILLS = 300;
const LAST_SERVER_OK_KEY = 'dukaan_last_server_ok';

/** Called on every successful API answer (lib/api.js). Written at most once a minute. */
export function markServerReachable(now = Date.now()) {
  try {
    // Throttled against what is actually stored, and only while time moves forward: a
    // cleared storage or a clock set back must never leave an online device looking stale.
    const stored = Number(localStorage.getItem(LAST_SERVER_OK_KEY)) || 0;
    const since = now - stored;
    if (stored && since >= 0 && since < 60 * 1000) return;
    localStorage.setItem(LAST_SERVER_OK_KEY, String(now));
  } catch {
    /* storage unavailable — offline billing simply stays closed on this device */
  }
}

/**
 * Whether this device may queue one more offline bill for this shop.
 *   { ok: true }
 *   { ok: false, reason: 'stale' }    no server contact in MAX_OFFLINE_HOURS (or the clock went back)
 *   { ok: false, reason: 'unsynced' } a waiting bill is older than MAX_OFFLINE_HOURS
 *   { ok: false, reason: 'plan' }     a waiting bill was refused for the plan
 *   { ok: false, reason: 'full' }     MAX_OFFLINE_BILLS already waiting
 *
 * The window is measured from the OLDEST BILL STILL WAITING, not only from the last time the
 * server answered. Otherwise switching the internet on for one minute every three days —
 * long enough for any request to succeed, while the waiting bills are refused or never
 * sent — would keep offline billing open for ever with nothing reaching the books. Only
 * bills actually landing on the server move this clock forward.
 */
export function offlineBillingCheck(now = Date.now(), shopId = null) {
  // A bill that cannot say whose it is cannot wait on this device.
  if (!shopId) return { ok: false, reason: 'stale' };
  const windowMs = MAX_OFFLINE_HOURS * 60 * 60 * 1000;
  const skew = 5 * 60 * 1000;
  let last = 0;
  try {
    last = Number(localStorage.getItem(LAST_SERVER_OK_KEY)) || 0;
  } catch {
    last = 0;
  }
  // A clock set back to before the last confirmed contact is not trusted to measure time.
  const clockWentBack = last && now < last - skew;
  if (!last || clockWentBack || now - last > windowMs) {
    return { ok: false, reason: 'stale' };
  }

  const waiting = queueFor(shopId);
  if (waiting.some(isPlanRefusal)) return { ok: false, reason: 'plan' };
  const times = waiting.map((entry) => Date.parse(entry.queuedAt)).filter(Number.isFinite);
  if (times.length) {
    // A clock set back below a waiting bill's own time is tampering with the same window.
    if (Math.max(...times) > now + skew) return { ok: false, reason: 'unsynced' };
    if (now - Math.min(...times) > windowMs) return { ok: false, reason: 'unsynced' };
  }
  if (waiting.length >= MAX_OFFLINE_BILLS) return { ok: false, reason: 'full' };
  return { ok: true };
}
