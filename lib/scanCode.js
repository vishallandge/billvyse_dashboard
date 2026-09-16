/**
 * What a scanned code actually SAYS.
 *
 * A scanner hands back one string, and in 2026 that string is no longer just a barcode's
 * digits. The same gun — and every phone camera — reads:
 *   - a plain retail barcode: "8901234567894"
 *   - a QR the shop printed itself: the catalog link off our own price sticker
 *   - a GS1 QR / DataMatrix: what is now printed on medicine strips, cartons and most
 *     branded packs, carrying the GTIN *plus* batch, expiry and serial in one payload
 *   - a GS1 Digital Link: the same thing dressed as an https:// URL
 *   - a WEIGHING SCALE'S OWN STICKER, printed in the shop a minute ago, whose digits are
 *     not a product code at all but an item number with the packet's price or weight
 *     buried inside them
 *   - and plenty of QRs that are not a product at all (a UPI QR, a website, a vCard)
 *
 * Every caller used to treat that string as `Product.barcode` and compare it exactly, so
 * only the first case ever worked: scanning the QR next to the barcode on the same pack
 * found nothing. This turns the string into what it means, once — so the counter, the
 * product form and the server all read a scan the same way.
 *
 * MIRRORED at backend/utils/scanCode.js — the two files must stay identical. The client
 * needs it to clean up what the camera decoded before it puts anything in a form field, and
 * the server needs it because a hardware scanner gun types straight into the box and never
 * goes through the camera path at all. (Same arrangement as config/catalog.js and
 * utils/labelSpec.js.)
 *
 * Nothing here touches the database. It is pure string work: `parseScan()` in, a described
 * scan out.
 */

const OBJECT_ID = /^[a-f\d]{24}$/i;

/** FNC1 — what a scanner emits between two variable-length GS1 fields. */
const GS = String.fromCharCode(29);

/** ]Q3 (GS1 QR), ]d2 (GS1 DataMatrix), ]C1 (GS1-128): the symbology identifier some
 * scanners prepend. It describes the symbol, not the goods, so it is dropped. */
const SYMBOLOGY = /^\](?:Q3|d2|C1|e0|E0)/;

/** QR payloads that are definitely not a product: payment, contact, WiFi, geo, dial. */
const NON_PRODUCT_QR = /^(?:upi|tez|phonepe|paytmmp|bitcoin|tel|sms|smsto|mailto|geo|wifi|mecard|matmsg|otpauth|market|intent|whatsapp):|^BEGIN:V(?:CARD|EVENT)/i;

/**
 * How many digits the Application Identifier itself is, keyed by its first two. This is the
 * GS1 table, and it is the only way to walk a payload that has no separators in it —
 * "3103" is one four-digit AI, "31" followed by "03" is not.
 */
const AI_PREFIX_LEN = {
  '00': 2, '01': 2, '02': 2, 10: 2, 11: 2, 12: 2, 13: 2, 15: 2, 16: 2, 17: 2, 20: 2, 21: 2, 22: 2, 30: 2, 37: 2,
  90: 2, 91: 2, 92: 2, 93: 2, 94: 2, 95: 2, 96: 2, 97: 2, 98: 2, 99: 2,
  23: 3, 24: 3, 25: 3, 40: 3, 41: 3, 42: 3, 43: 3, 70: 3, 71: 3, 72: 3, 80: 3, 81: 3, 82: 3,
  31: 4, 32: 4, 33: 4, 34: 4, 35: 4, 36: 4, 39: 4,
};

/** AIs whose data is a fixed number of characters — no separator follows them. */
const AI_FIXED_LEN = { '00': 18, '01': 14, '02': 14, 11: 6, 12: 6, 13: 6, 15: 6, 16: 6, 17: 6, 20: 2, 422: 3, 424: 3 };

/** Longest the variable-length AIs we care about are allowed to be. */
const AI_MAX_LEN = { 10: 20, 21: 20, 22: 20, 30: 8, 37: 8, 240: 30, 241: 30, 250: 30, 251: 30, 253: 30, 254: 20, 255: 25 };

function fixedLengthOf(ai) {
  if (AI_FIXED_LEN[ai]) return AI_FIXED_LEN[ai];
  // 31nn–36nn are the measures (net weight, volume, length) and are always six digits.
  if (/^3[1-6]\d\d$/.test(ai)) return 6;
  return 0;
}

/* ------------------------------------------------------------------ *
 * GS1
 * ------------------------------------------------------------------ */

/**
 * Reads a GS1 element string into `{ ai: value }`.
 *
 * Accepts both forms a scanner produces: the human-readable one with brackets,
 * "(01)08901234567894(17)261231(10)AB12", and the raw one where FNC1 separates the
 * variable-length fields and nothing separates the fixed ones.
 *
 * Stops at the first thing it cannot identify rather than guessing — a half-read payload
 * that still yields the GTIN is useful; an invented batch number is not.
 */
function parseElementString(input) {
  // Bracketed form → separated form, so one walker handles both.
  const payload = input.includes('(') ? input.replace(/\((\d{2,4})\)/g, `${GS}$1`) : input;

  const found = {};
  let index = 0;
  let steps = 0;

  while (index < payload.length && steps < 32) {
    steps += 1;
    if (payload[index] === GS) {
      index += 1;
      continue;
    }

    const aiLength = AI_PREFIX_LEN[payload.slice(index, index + 2)];
    if (!aiLength) break;
    const ai = payload.slice(index, index + aiLength);
    if (ai.length < aiLength) break;
    index += aiLength;

    const fixed = fixedLengthOf(ai);
    let value;
    if (fixed) {
      value = payload.slice(index, index + fixed);
      if (value.length < fixed) break;
      index += fixed;
    } else {
      const separator = payload.indexOf(GS, index);
      const end = separator === -1 ? Math.min(payload.length, index + (AI_MAX_LEN[ai] || 30)) : separator;
      value = payload.slice(index, end);
      index = end;
    }

    if (!value) break;
    found[ai] = value;
  }

  return Object.keys(found).length ? found : null;
}

/**
 * YYMMDD → "YYYY-MM-DD". A day of "00" is GS1 for "end of this month", which is what an
 * expiry printed as "12/26" means, so it becomes the last day of the month rather than an
 * invalid date.
 */
function gs1Date(value, today = new Date()) {
  if (!/^\d{6}$/.test(value)) return null;
  const yy = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  if (month < 1 || month > 12 || day > 31) return null;

  // GS1's own century rule, near enough: a two-digit year more than 30 years ahead of today
  // is in the past, not the future.
  let year = 2000 + yy;
  if (year - today.getFullYear() > 30) year -= 100;

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const resolved = day === 0 ? lastDay : Math.min(day, lastDay);
  return `${year}-${String(month).padStart(2, '0')}-${String(resolved).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * Matching a code against what the shop has on its shelf
 * ------------------------------------------------------------------ */

/**
 * The same product's code, written every way a scanner might hand it over.
 *
 * This is the one piece of real-world grubbiness worth spelling out: the SAME pack is a
 * 12-digit UPC-A on an American scanner, a 13-digit EAN with a leading zero on an Indian
 * one, and a zero-padded 14-digit GTIN inside a GS1 QR. All three are the same GTIN. A shop
 * that typed the 13-digit form once should not fail to scan because the QR carried 14 —
 * which, before this, was exactly what happened.
 *
 * Only applied to codes 8–14 digits long: padding a short in-store number like "123456" out
 * to 13 digits would be inventing a GTIN nobody printed.
 */
export function codeVariants(value) {
  const code = String(value || '').trim();
  if (!code) return [];

  const out = [code];
  const push = (candidate) => {
    if (candidate && !out.includes(candidate)) out.push(candidate);
  };

  if (/^\d{8,14}$/.test(code)) {
    const bare = code.replace(/^0+/, '') || '0';
    push(bare);
    if (bare.length <= 14) {
      [12, 13, 14].forEach((width) => {
        if (bare.length <= width) push(bare.padStart(width, '0'));
      });
    }
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * The weighing scale's own sticker
 * ------------------------------------------------------------------ */

/**
 * The barcode a shop's own kaanta prints, and why it needs code of its own.
 *
 * A sabzi, mithai or kirana counter does not wire its scale to the computer. The scale
 * weighs the packet, multiplies by its own rate, prints a sticker, and the sticker goes on
 * the packet. The counter then scans that sticker like anything else.
 *
 * The catch is that the digits on it are not a product code. They are:
 *
 *     2 0   1 2 3 4 5   0 5 7 5 0   4
 *     └prefix┘ └─item──┘ └──value──┘ └check
 *
 * — an item number the scale was programmed with, and the PACKET'S OWN price (₹57.50) or
 * weight, which is different on every single sticker. Looking the whole string up as a
 * barcode therefore finds nothing, ever, and the counter says "no product found" while
 * holding a packet whose price is printed on the label in its hand. That is the bug this
 * exists to fix, and it needs no cable, no driver and no hardware integration at all —
 * only the willingness to read the number properly.
 *
 * GS1 reserves prefixes 02 and 20–29 for exactly this ("restricted distribution"), so no
 * manufacturer's pack can legitimately carry one and there is nothing to disambiguate
 * against. The layout inside them, however, is NOT standardised — every scale brand is
 * configured differently — which is why this takes the shop's own layout as an argument
 * rather than assuming one. See billingSettings.scaleBarcode, and `detectScaleLayout`
 * below, which works the layout out from one sample sticker so nobody has to know any of
 * the above.
 */

/** Prefixes GS1 reserves for a shop's own in-store codes. Nothing else may use them. */
export const SCALE_PREFIXES = ['02', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29'];

/** An EAN-13 is 13 digits: 2 prefix + item + value + 1 check. So item + value is always 10. */
const SCALE_BODY_DIGITS = 10;

/**
 * EAN-13's check digit. Verified rather than trusted: a half-read symbol that still starts
 * with "21" would otherwise be turned into a confident, wrong price on a customer's bill.
 * A failed check falls through and is looked up as an ordinary code, which at worst finds
 * nothing — the honest outcome.
 */
function ean13CheckDigit(twelve) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Read one sticker with a known layout.
 *
 * @param code    the scanned digits
 * @param layout  { prefixes, itemDigits, valueMeans: 'price'|'weight', valueDecimals }
 * @returns {{ itemCode: string, price: number|null, weight: number|null }|null}
 *          null whenever this is not a sticker in that layout — which is the common case,
 *          because almost everything scanned at a counter is an ordinary barcode.
 */
export function readScaleSticker(code, layout) {
  const digits = String(code || '').trim();
  if (!/^\d{13}$/.test(digits)) return null;

  const prefixes = layout?.prefixes?.length ? layout.prefixes : SCALE_PREFIXES;
  if (!prefixes.includes(digits.slice(0, 2))) return null;
  if (Number(digits[12]) !== ean13CheckDigit(digits)) return null;

  const itemDigits = Number(layout?.itemDigits) || 5;
  if (itemDigits < 3 || itemDigits >= SCALE_BODY_DIGITS) return null;

  const body = digits.slice(2, 12);
  const itemCode = body.slice(0, itemDigits);
  const rawValue = Number(body.slice(itemDigits));
  if (!Number.isFinite(rawValue)) return null;

  const decimals = Number(layout?.valueDecimals);
  const value = rawValue / 10 ** (Number.isFinite(decimals) ? decimals : 2);

  return {
    itemCode,
    price: layout?.valueMeans === 'weight' ? null : value,
    weight: layout?.valueMeans === 'weight' ? value : null,
  };
}

/**
 * Work the layout out from ONE sticker, given what was printed on it.
 *
 * The alternative is asking a shopkeeper how many digits his scale's item code is and how
 * many implied decimals its value carries, which is a question about GS1 internals dressed
 * up as a setting. This asks the only two things he can see without knowing any of that:
 * the sticker, and the number printed on it.
 *
 * Every plausible layout is tried and the ones whose arithmetic reproduces that number are
 * kept. Ties are broken toward the common configuration (a 5-digit item code, two implied
 * decimals) — and because the chosen layout is shown back to him decoded, a wrong guess is
 * visible immediately rather than a month later on a customer's bill.
 *
 * @param sample the scanned sticker
 * @param known  { price } or { weight } — whichever the sticker actually printed
 * @returns the layout, or null if nothing reproduces that number
 */
export function detectScaleLayout(sample, known) {
  const digits = String(sample || '').trim();
  if (!/^\d{13}$/.test(digits)) return null;

  const valueMeans = known?.weight != null && known?.weight !== '' ? 'weight' : 'price';
  const target = Number(valueMeans === 'weight' ? known.weight : known?.price);
  if (!Number.isFinite(target) || target <= 0) return null;

  const matches = [];
  for (const itemDigits of [5, 6, 4]) {
    for (const valueDecimals of [2, 3, 1, 0]) {
      const layout = { prefixes: SCALE_PREFIXES, itemDigits, valueMeans, valueDecimals };
      const read = readScaleSticker(digits, layout);
      if (!read) continue;
      const value = valueMeans === 'weight' ? read.weight : read.price;
      // Half of the smallest unit the sticker can express — a printed ₹57.50 must match
      // 57.50 exactly, not "roughly".
      if (Math.abs(value - target) < 0.005) matches.push(layout);
    }
  }
  return matches[0] || null;
}

/* ------------------------------------------------------------------ *
 * The one function everything calls
 * ------------------------------------------------------------------ */

function blank(raw) {
  return {
    raw,
    kind: 'empty',
    code: '',
    candidates: [],
    productId: null,
    gtin: null,
    batch: null,
    expiry: null,
    serial: null,
    url: null,
    // Set only for kind 'scale': what the shop's own sticker said about THIS packet.
    // { itemCode, price, weight } — see readScaleSticker.
    scale: null,
  };
}

function fromAiMap(ai, raw, url) {
  const gtin = ai['01'] || ai['02'] || null;
  return {
    ...blank(raw),
    kind: 'gs1',
    code: gtin || '',
    candidates: gtin ? codeVariants(gtin) : [],
    gtin,
    batch: ai['10'] || null,
    // 17 is the expiry; 15 ("best before") is what food packs carry instead, and for a shop
    // deciding whether to sell something they mean the same thing.
    expiry: gs1Date(ai['17'] || ai['15'] || '') || null,
    serial: ai['21'] || null,
    url: url || null,
  };
}

/**
 * @param {string} input whatever the scanner, camera or scanner-gun-typed input box produced
 * @param {{ scale?: object }} [options] the shop's own rules. `scale` is
 *   billingSettings.scaleBarcode; leave it out and a scale sticker is read as the ordinary
 *   code it looks like, which is exactly what every caller did before stickers existed.
 * @returns {{
 *   raw: string, kind: 'empty'|'code'|'gs1'|'product'|'link'|'scale',
 *   code: string, candidates: string[], productId: string|null,
 *   gtin: string|null, batch: string|null, expiry: string|null, serial: string|null,
 *   url: string|null, scale: { itemCode: string, price: number|null, weight: number|null }|null
 * }}
 *   `candidates` is every code worth looking up, best first — hand it straight to a
 *   `barcode: { $in: … }` query. `kind` is what to tell the shopkeeper when nothing matches:
 *   a 'link' that found no product is a website QR, not a missing product.
 */
export function parseScan(input, options) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return blank(raw);

  const body = raw.replace(SYMBOLOGY, '').trim();
  if (!body) return blank(raw);

  if (/^https?:\/\//i.test(body)) return parseLink(body, raw);

  // A QR that is plainly not about a product: the UPI QR taped to the counter, a WiFi card,
  // a saved contact. Naming it here is what lets the counter say "yeh payment ka QR hai"
  // instead of hunting the whole catalog for a product called "upi://pay?pa=…".
  if (NON_PRODUCT_QR.test(body) || body.includes('\n')) return { ...blank(raw), kind: 'link' };

  // A GS1 payload announces itself: brackets, an FNC1 separator, or a GTIN AI followed by
  // more than a GTIN's worth of digits (no retail barcode is 16 digits long).
  const looksGs1 = body.includes(GS) || /^\(\d{2,4}\)/.test(body) || /^(?:01|02)\d{14}./.test(body);
  if (looksGs1) {
    const ai = parseElementString(body);
    if (ai && (ai['01'] || ai['02'])) return fromAiMap(ai, raw, null);
    // Parsed as GS1 but with no GTIN in it (a logistics label, say) — fall through and treat
    // the text as a code, which at worst simply finds nothing.
  }

  /*
   * The shop's own scale sticker. Last, on purpose: it is only ever reached by a plain run
   * of 13 digits that nothing else claimed, and it is gated on the shop having said it uses
   * one — so a shop with no kaanta cannot have an ordinary barcode taken apart as if it
   * were a price.
   *
   * The item code leads `candidates` because that is what a product is actually stored
   * under, but the whole sticker follows it: a shop that pasted a complete sample code into
   * a product's alternate codes should still find its product rather than be told the
   * feature it just switched on has broken scanning.
   */
  if (options?.scale?.enabled) {
    const sticker = readScaleSticker(body, options.scale);
    if (sticker) {
      return {
        ...blank(raw),
        kind: 'scale',
        code: sticker.itemCode,
        candidates: [...codeVariants(sticker.itemCode), ...codeVariants(body)],
        scale: sticker,
      };
    }
  }

  return {
    ...blank(raw),
    kind: 'code',
    code: body,
    candidates: codeVariants(body),
  };
}

/**
 * A URL can be three different things, and the order here matters.
 *
 * 1. A GS1 Digital Link — "https://id.gs1.org/01/08901234567894/10/AB12?17=261231". This is
 *    what new packs are moving to, and it carries strictly more than a barcode does.
 * 2. One of our own stickers — "/c/<shop>/catalog?p=<productId>". Scanned by a customer's
 *    phone it opens the item in the shop's catalog; scanned at the counter it is a product
 *    id, which is a better match than any barcode because it cannot be ambiguous.
 * 3. Somebody else's QR entirely. Reported as `kind: 'link'` with no code, so the screen can
 *    say "this QR is a website, not a product" instead of "barcode not found".
 */
function parseLink(href, raw) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return { ...blank(raw), kind: 'code', code: href, candidates: codeVariants(href) };
  }

  const segments = url.pathname.split('/').filter(Boolean);

  const ai = {};
  let index = 0;
  while (index < segments.length - 1) {
    if (/^\d{2,4}$/.test(segments[index])) {
      ai[segments[index]] = safeDecode(segments[index + 1]);
      index += 2;
      continue;
    }
    index += 1;
  }
  url.searchParams.forEach((value, key) => {
    if (/^\d{2,4}$/.test(key)) ai[key] = value;
  });
  if (ai['01'] || ai['02']) return fromAiMap(ai, raw, url.href);

  const paramId = url.searchParams.get('p') || url.searchParams.get('product') || url.searchParams.get('pid') || '';
  const lastSegment = segments.length ? safeDecode(segments[segments.length - 1]) : '';
  const productId = OBJECT_ID.test(paramId) ? paramId : OBJECT_ID.test(lastSegment) ? lastSegment : null;
  const codeParam = (url.searchParams.get('code') || url.searchParams.get('barcode') || '').trim();

  if (productId || codeParam) {
    return {
      ...blank(raw),
      kind: 'product',
      code: codeParam,
      candidates: codeParam ? codeVariants(codeParam) : [],
      productId,
      url: url.href,
    };
  }

  return { ...blank(raw), kind: 'link', url: url.href };
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The short line a screen shows after a scan: what the pack said beyond its code. Empty when
 * there is nothing extra, so a caller can `if (summary)` without checking three fields.
 */
export function scanExtras(scan) {
  if (!scan) return '';
  const bits = [];
  if (scan.batch) bits.push(`Batch ${scan.batch}`);
  if (scan.expiry) {
    const [year, month] = scan.expiry.split('-');
    bits.push(`Exp ${month}/${year.slice(-2)}`);
  }
  if (scan.serial) bits.push(`Sr ${scan.serial}`);
  return bits.join(' · ');
}
