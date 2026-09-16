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

export function enqueueBill(payload) {
  const queue = getQueue();
  const entry = {
    localId: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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

export function queueCount() {
  return getQueue().length;
}
