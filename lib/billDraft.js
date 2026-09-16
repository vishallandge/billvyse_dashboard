/**
 * The half-built bill, kept where a crash cannot reach it.
 *
 * Everything else on the billing screen survives an accident: a parked cart is on the
 * server, an offline bill is in the queue, a quotation is a document. The *open* cart —
 * the eleven items already scanned, with the customer picked and the discount typed — lived
 * only in React state, and React state does not survive a closed tab, a reloaded PWA, a
 * flat battery, or the "this page is using too much memory" reload that Android Chrome
 * does to a shop's ₹6,000 phone without asking.
 *
 * That is the one failure on this screen a customer standing at the counter actually sees:
 * everything has to be scanned again, in front of them, with the queue watching.
 *
 * So every change to the cart is mirrored to localStorage, and a page that opens with an
 * empty cart and a recent draft OFFERS it back. It is never applied on its own — an
 * unattended restore is how a counter bills yesterday's items to today's customer — and it
 * expires, because a cart nobody came back for within a shift is not a cart any more.
 */

const DRAFT_KEY = 'dukaan_billing_draft';
// One shift. Long enough that a phone which died at 8pm still has its cart when the shop
// opens at 9am is NOT true on purpose — that cart is stale and the goods went back on the
// shelf. Long enough for a crash, a reboot, a lunch break.
const DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function saveBillDraft(draft) {
  try {
    if (!draft?.cart?.length) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    /* a full or blocked localStorage must never stop a sale */
  }
}

export function clearBillDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to do — the draft simply stays until it expires */
  }
}

/**
 * The draft this device can legitimately offer back, or null.
 *
 * `userId` is checked, not just read: a shared counter machine where the owner logs out and
 * a staff cashier logs in must not be handed the other person's open cart — the lines would
 * be billed under the wrong cashier, against the wrong permissions, possibly in the wrong
 * shop.
 */
export function readBillDraft(userId) {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!raw?.cart?.length) return null;
    if (raw.userId && userId && raw.userId !== userId) return null;
    if (!raw.savedAt || Date.now() - raw.savedAt > DRAFT_MAX_AGE_MS) {
      clearBillDraft();
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}
