import { apiFetch } from './api';

/**
 * The two questions an address box asks somebody else, and nothing more.
 *
 * The *shape* of an address — how it is written down, taken apart and judged — lives in
 * ./addressRules.js, which is a character-for-character mirror of the server's own copy, so
 * the rule that refuses a save and the sentence that explains it can never drift apart.
 * This file is only the wire: what a pincode means, and where this device is.
 *
 * Storage did not change for any of it. Every address in the product is one string — that
 * is what gets printed on an invoice, pasted into a WhatsApp message and read out over the
 * phone — so the structure lives in the box, not in the database.
 */

export {
  PINCODE_RE,
  ADDRESS_MAX,
  ADDRESS_PART_MAX,
  EMPTY_ADDRESS,
  composeAddress,
  parseAddress,
  cleanAddressText,
  cleanPincode,
  addressProblem,
  addressPartProblem,
  addressCrossFieldProblem,
  addressErrorText,
} from './addressRules';

/** 6 digits → { valid, city, state, localities } | { unreachable }. Never throws. */
export async function lookupPincode(code) {
  try {
    return await apiFetch(`/api/public/pincode/${code}`);
  } catch (error) {
    // A 400 (badly-shaped code) comes back as a rejection too, and its body is the answer.
    if (error?.data && typeof error.data === 'object') return error.data;
    return { valid: false, unreachable: true };
  }
}

/**
 * The device's own position, asked for once, on a tap.
 *
 * Never called on page load. A browser permission prompt that appears on its own is the
 * fastest way to teach a shopkeeper to press "Block", after which the button is dead for
 * good and nothing in the app can undo it.
 */
export function getCurrentPosition({ timeoutMs = 12000 } = {}) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ ok: false, reason: 'unsupported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ ok: true, lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => resolve({ ok: false, reason: err?.code === 1 ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 }
    );
  });
}

/**
 * Tap → address. Returns `{ ok: true, ...parts }`, or `{ ok: false, reason }` where reason
 * is one the caller has a sentence for: unsupported | denied | unavailable | unreachable.
 */
export async function locateAddress() {
  const fix = await getCurrentPosition();
  if (!fix.ok) return fix;
  try {
    const data = await apiFetch(`/api/public/geo/reverse?lat=${fix.lat}&lng=${fix.lng}`);
    if (!data.ok) return { ok: false, reason: 'unreachable', lat: fix.lat, lng: fix.lng };
    return { ...data, lat: fix.lat, lng: fix.lng };
  } catch {
    return { ok: false, reason: 'unreachable', lat: fix.lat, lng: fix.lng };
  }
}
