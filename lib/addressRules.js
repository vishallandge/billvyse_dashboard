/**
 * What counts as an address, and the sentence to show when it isn't — in the shopkeeper's
 * own language.
 *
 * Mirrors backend/utils/addressRules.js. That file is the enforcement; this one is the
 * explanation, and it exists because a refusal that arrives from the server lands as one
 * line at the top of a form with no way to tell which of six boxes it meant. **The two must
 * change together** — the codes are the contract between them, and every rule below is a
 * character-for-character copy of the one there.
 *
 * The principle both sides share: a warning that does not block is not validation. Every
 * problem here refuses the save and points at the box. And the characters that can never be
 * valid never make it into the box at all — `cleanAddressText` runs on the way in, the same
 * way the pincode box has always dropped non-digits.
 */

export const PINCODE_RE = /^[1-9][0-9]{5}$/;

const DISALLOWED_CHAR = /[^\p{L}\p{M}\p{N} ,.\-/#&'()]/u;
const DISALLOWED_CHAR_G = /[^\p{L}\p{M}\p{N} ,.\-/#&'()]/gu;

export const ADDRESS_PART_MAX = Object.freeze({
  flat: 60,
  street: 80,
  locality: 60,
  city: 50,
  state: 50,
  pincode: 6,
});

export const ADDRESS_MAX = 200;

function meaningful(value) {
  const matches = String(value ?? '').match(/[\p{L}\p{N}]/gu);
  return matches ? matches.length : 0;
}

export function cleanAddressText(value, max) {
  const cleaned = String(value ?? '')
    .replace(DISALLOWED_CHAR_G, '')
    .replace(/\s+/g, ' ');
  return max ? cleaned.slice(0, max) : cleaned;
}

export function cleanPincode(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 6);
}

/** flat, street, locality, city, state - pincode — the order an Indian envelope is read in. */
export function composeAddress(parts, { omitPlace = false } = {}) {
  const fields = omitPlace
    ? [parts.flat, parts.street, parts.locality]
    : [parts.flat, parts.street, parts.locality, parts.city, parts.state];
  const head = fields
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(', ');
  const pin = omitPlace ? '' : String(parts.pincode || '').trim();
  if (!pin) return head;
  return head ? `${head} - ${pin}` : pin;
}

export const EMPTY_ADDRESS = Object.freeze({
  flat: '',
  street: '',
  locality: '',
  city: '',
  state: '',
  pincode: '',
});

export function parseAddress(value) {
  const raw = String(value || '').trim();
  if (!raw) return { ...EMPTY_ADDRESS };

  let pincode = '';
  let head = raw;
  const tail = raw.match(/^(.*?)[,\s-]*\b([1-9][0-9]{5})\s*$/);
  if (tail) {
    pincode = tail[2];
    head = tail[1].replace(/[,\s-]+$/, '');
  }

  const parts = head
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  let state = '';
  let city = '';
  let locality = '';
  if (pincode && parts.length >= 2) {
    state = parts.pop();
    city = parts.pop();
    if (parts.length >= 3) locality = parts.pop();
  }
  const flat = parts.shift() || '';
  const street = parts.join(', ');
  return { flat, street, locality, city, state, pincode };
}

/**
 * The boxes a PIN code obliges you to fill.
 *
 * A pincode on its own is not an address — it is the one part of an address a person types
 * first and the one part that means nothing alone. "411038" tells a delivery boy the sorting
 * office and nothing else, and it is what a half-filled form saves when the only required
 * box happens to be the one the customer filled.
 *
 * So the rule is conditional, not absolute: an address with NO pincode is left exactly as it
 * was (plenty of shops write "Near Hanuman Mandir, main road" and always have), but the
 * moment there IS one, the three things that make it deliverable have to be there with it.
 *
 * Takes the parts rather than the composed line so both callers can use it: the form, which
 * holds separate boxes and may keep the city/state/pin in columns of its own (`omitPlace`),
 * and the server, which only ever sees the stored line. One rule, two shapes, no drift.
 */
export function addressCrossFieldProblem(parts) {
  const p = parts || {};
  if (!PINCODE_RE.test(String(p.pincode ?? '').trim())) return null;
  if (meaningful(p.city) < 2) return { field: 'city', code: 'ADDRESS_CITY_REQUIRED' };
  if (meaningful(p.state) < 2) return { field: 'state', code: 'ADDRESS_STATE_REQUIRED' };
  // Flat OR street — a shop is "Shop 4" or it is "Station Road", and plenty are only one.
  if (meaningful(`${p.flat ?? ''} ${p.street ?? ''}`) < 3) {
    return { field: 'flat', code: 'ADDRESS_LINE_REQUIRED' };
  }
  return null;
}

/**
 * A firm's name, as it is written on a document somebody else's accountant reads.
 *
 * Separate from the address rules above and deliberately using the same character class:
 * "M/s Sharma Traders & Sons (Prop. R. Sharma)" is an ordinary Indian firm name and every
 * one of those marks is in it. What is excluded is the same thing an address excludes —
 * emoji, angle brackets, `@`, tabs, pasted line breaks — because this string is printed in
 * the "Bill To" block of a tax invoice.
 *
 * Blank always passes. A walk-in khata customer has no firm and never will.
 */
export const PARTY_NAME_MAX = 100;

export function partyNameProblem(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (raw.length > PARTY_NAME_MAX) return 'PARTY_NAME_LONG';
  if (DISALLOWED_CHAR.test(raw)) return 'PARTY_NAME_CHARS';
  // One letter or digit. A firm called "3M" is real; a firm called "." is not.
  if (!/[\p{L}\p{N}]/u.test(raw)) return 'PARTY_NAME_THIN';
  return null;
}

export function addressPartProblem(field, value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (field === 'pincode') {
    return PINCODE_RE.test(raw) ? null : 'ADDRESS_PIN_INVALID';
  }
  if (DISALLOWED_CHAR.test(raw)) return 'ADDRESS_CHARS';
  const max = ADDRESS_PART_MAX[field];
  if (max && raw.length > max) return 'ADDRESS_LONG';
  return null;
}

export function addressProblem(value, { required = false, maxLength = ADDRESS_MAX } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return required ? { field: 'pincode', code: 'ADDRESS_REQUIRED' } : null;
  if (raw.length > maxLength) return { field: 'street', code: 'ADDRESS_LONG' };
  if (DISALLOWED_CHAR.test(raw)) return { field: 'street', code: 'ADDRESS_CHARS' };
  if (meaningful(raw) < 3) return { field: 'street', code: 'ADDRESS_THIN' };

  const parts = parseAddress(raw);
  for (const field of ['flat', 'street', 'locality', 'city', 'state']) {
    const code = addressPartProblem(field, parts[field]);
    if (code) return { field, code };
  }

  // A pincode obliges the rest — same rule, same order, as backend/utils/addressRules.js.
  const cross = addressCrossFieldProblem(parts);
  if (cross) return cross;

  if (!required) return null;

  if (!PINCODE_RE.test(parts.pincode)) return { field: 'pincode', code: 'ADDRESS_PIN_REQUIRED' };
  if (meaningful(`${parts.flat} ${parts.street}`) < 3) return { field: 'flat', code: 'ADDRESS_LINE_REQUIRED' };
  return null;
}

/**
 * A code from either side of the wire into a sentence, translated.
 *
 * The server's own English is deliberately ignored: it answers in one language, and this
 * app is read in ten. A code it does not recognise falls through to the server's sentence
 * rather than to nothing, so a rule added on the server before it is added here still says
 * something useful.
 */
export function addressErrorText(code, t, fallback = '') {
  const key = {
    ADDRESS_REQUIRED: 'address.errRequired',
    ADDRESS_PIN_REQUIRED: 'address.errPinRequired',
    ADDRESS_PIN_INVALID: 'address.errPin',
    ADDRESS_CHARS: 'address.errChars',
    ADDRESS_LONG: 'address.errLong',
    ADDRESS_THIN: 'address.errThin',
    ADDRESS_LINE_REQUIRED: 'address.errLine',
    ADDRESS_CITY_REQUIRED: 'address.errCity',
    ADDRESS_STATE_REQUIRED: 'address.errState',
    ADDRESS_PIN_UNKNOWN: 'address.errPinUnknown',
    // Raised by the address box itself (only it knows the post offices under a pincode).
    ADDRESS_LOCALITY_REQUIRED: 'address.errLocality',
    // Not an error the shopkeeper did anything to cause — it holds Save for the moment the
    // lookup takes, and reads as progress rather than as a complaint.
    ADDRESS_PIN_CHECKING: 'address.errPinChecking',
    PARTY_NAME_LONG: 'address.errNameLong',
    PARTY_NAME_CHARS: 'address.errNameChars',
    PARTY_NAME_THIN: 'address.errNameThin',
  }[code];
  if (!key) return fallback;
  const text = t(key);
  // translate() hands back the path when a key is missing everywhere — never show that.
  return text === key ? fallback : text;
}
