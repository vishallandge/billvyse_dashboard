// Stock counting happens in the one place a shop has no signal: standing between the
// shelves, or in a godown behind a concrete wall. Two different things can be lost there,
// and this file holds both.
//
//  1. The DRAFT — an hour of typed counts that a closed tab, a dead battery or an
//     accidental back-swipe would otherwise wipe. Saved on every keystroke.
//  2. The SUBMISSION — a finished count that had nowhere to go because the request could
//     not reach the server. Queued and replayed when the connection comes back.
//
// What makes (2) safe is on the server: each row carries the quantity the device *saw*
// when it was counted, and the server applies the difference rather than overwriting with
// an absolute number. A count taken at 3pm and synced at 6pm therefore does not un-sell
// what went out of the door in between. See submitStockTake.

const DRAFT_KEY = 'dukaan_stock_take_draft';
const QUEUE_KEY = 'dukaan_stock_take_queue';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked localStorage must never take the count down with it — the numbers
    // on screen are still good, they just stop being crash-proof.
  }
}

// ── Draft ────────────────────────────────────────────────────────────────────────────

export function readDraft() {
  const draft = read(DRAFT_KEY, null);
  if (!draft || typeof draft.counts !== 'object') return null;
  // A draft older than a day is almost certainly abandoned, and offering to resume last
  // week's count against today's stock would be actively harmful.
  const age = Date.now() - new Date(draft.savedAt || 0).getTime();
  if (!Number.isFinite(age) || age > 24 * 60 * 60 * 1000) {
    clearDraft();
    return null;
  }
  return draft;
}

export function saveDraft({ counts, note, scopeLabel }) {
  const typed = Object.values(counts || {}).filter((v) => v !== undefined && v !== '').length;
  if (typed === 0) {
    clearDraft();
    return;
  }
  write(DRAFT_KEY, { counts, note, scopeLabel, typed, savedAt: new Date().toISOString() });
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to clear */
  }
}

// ── Queued submissions ───────────────────────────────────────────────────────────────

export function getStockTakeQueue() {
  const queue = read(QUEUE_KEY, []);
  return Array.isArray(queue) ? queue : [];
}

export function enqueueStockTake(payload) {
  const queue = getStockTakeQueue();
  queue.push({
    localId: `stk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    payload,
    queuedAt: new Date().toISOString(),
  });
  write(QUEUE_KEY, queue);
  return queue.length;
}

export function removeFromStockTakeQueue(localId) {
  write(
    QUEUE_KEY,
    getStockTakeQueue().filter((entry) => entry.localId !== localId)
  );
}

export function stockTakeQueueCount() {
  return getStockTakeQueue().length;
}

/**
 * Replays queued counts. Returns how many went through.
 *
 * Stops at the first network-shaped failure (a `TypeError` is what fetch throws when it
 * cannot reach the host at all) so a still-offline device does not burn through the queue
 * marking everything as broken. A real server rejection — a product deleted since the
 * count, say — drops the entry rather than retrying it forever, and reports the reason.
 */
export async function syncStockTakeQueue(submit) {
  let synced = 0;
  const failures = [];
  for (const entry of getStockTakeQueue()) {
    try {
      await submit(entry.payload);
      removeFromStockTakeQueue(entry.localId);
      synced += 1;
    } catch (err) {
      if (err instanceof TypeError) break;
      removeFromStockTakeQueue(entry.localId);
      failures.push(err.message);
    }
  }
  return { synced, failures };
}
