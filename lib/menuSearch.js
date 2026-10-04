/**
 * Finding a dish on a table's menu the way people actually type it.
 *
 * A waiter types fast, on a phone, with half an eye on the guest: "panner tika", "2 naan",
 * "biryni", "chiken", "cold drink under 100". The old filter was a plain `includes` on the
 * name — one wrong letter and the screen said "nothing found" about a dish that was right
 * there. This ranks instead of filtering:
 *
 *   - every word counts, in any order ("tikka paneer" finds "Paneer Tikka");
 *   - a word can match the name, the category or a code the kitchen uses;
 *   - spelling is forgiven — one slip in a short word, two in a long one, and Hinglish
 *     spellings ("paneer"/"panir", "daal"/"dal", "chicken"/"chiken") meet on a shared
 *     consonant skeleton;
 *   - a leading count is a quantity ("2 naan", "3x roti"), and a price phrase is a filter
 *     ("under 200", "200 se kam", "above 150", "100-300").
 *
 * Pure and self-contained (no imports) so backend/tests/menuSearch.test.js can load it
 * as a data: URL, the way tableSplit and billMath are tested.
 */

const MAX_QTY = 99;

/** Lower-case, accents off, punctuation to spaces. Devanagari is kept as it is. */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

function words(text) {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

const LATIN = /^[a-z0-9]+$/;

/**
 * The consonant skeleton of a Latin word: what "paneer", "panir" and "paneeer" share.
 * Vowels and a trailing-h (kh/dh/bh) are where Hinglish spellings disagree; consonants
 * are where they agree. Only used for words of 4+ letters — on shorter ones too many
 * different dishes collapse onto the same two letters.
 */
export function skeleton(word) {
  if (!LATIN.test(word)) return word;
  const w = word
    .replace(/ck/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/q/g, 'k')
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/(.)\1+/g, '$1');
  const head = w[0];
  const rest = w.slice(1).replace(/[aeiouyh]/g, '').replace(/(.)\1+/g, '$1');
  return head + rest;
}

/**
 * Edit distance with adjacent swaps counted as one ("tikak" → "tikka"), giving up as soon
 * as it is past `max` — the answer is only ever compared against 1 or 2.
 */
export function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

/** How many slips a typed word is allowed: none under 4 letters, 1 up to 6, then 2. */
function allowedSlips(token) {
  if (token.length < 4) return 0;
  return token.length <= 6 ? 1 : 2;
}

/**
 * How well one typed word matches one word of a dish, 0..1.
 * 1 exact · .9 start of the word · .7 inside it · .6 same skeleton · .5 a slip or two.
 */
function wordScore(token, word) {
  if (word === token) return 1;
  if (word.startsWith(token)) return 0.9;
  if (token.length >= 2 && word.includes(token)) return 0.7;
  if (!LATIN.test(token) || !LATIN.test(word)) return 0;
  if (token.length >= 4) {
    const ts = skeleton(token);
    const ws = skeleton(word);
    if (ts.length >= 3 && (ws === ts || ws.startsWith(ts))) return 0.6;
  }
  const slips = allowedSlips(token);
  if (slips > 0) {
    // Whole word, or the word's start when the waiter is still typing ("panne" → paneer).
    if (editDistance(token, word, slips) <= slips) return 0.5;
    if (word.length > token.length && editDistance(token, word.slice(0, token.length), slips) <= slips) return 0.45;
  }
  return 0;
}

function bestScore(token, fieldWords) {
  let best = 0;
  for (const w of fieldWords) {
    const s = wordScore(token, w);
    if (s > best) best = s;
    if (best === 1) break;
  }
  return best;
}

function codesOf(product) {
  return [product.sku, product.barcode, ...(Array.isArray(product.altCodes) ? product.altCodes : [])]
    .filter((c) => c !== undefined && c !== null && String(c).trim() !== '')
    .map((c) => normalize(c).replace(/ /g, ''));
}

const PRICE_UNDER = /(?:^|\s)(?:under|below|less than|upto|up to|within|max|<=?)\s*(?:rs\.?|₹|inr)?\s*(\d{1,6})(?:\s*(?:rs|rupees?|₹))?(?=\s|$)/i;
const PRICE_OVER = /(?:^|\s)(?:above|over|more than|min|>=?)\s*(?:rs\.?|₹|inr)?\s*(\d{1,6})(?:\s*(?:rs|rupees?|₹))?(?=\s|$)/i;
const PRICE_HI_UNDER = /(?:^|\s)(?:rs\.?|₹)?\s*(\d{1,6})\s*(?:rs|rupees?|₹)?\s*(?:se kam|ke niche|ke neeche|ke andar|tak|or less)(?=\s|$)/i;
const PRICE_HI_OVER = /(?:^|\s)(?:rs\.?|₹)?\s*(\d{1,6})\s*(?:rs|rupees?|₹)?\s*(?:se zyada|se jyada|se upar|ke upar|or more|\+)(?=\s|$)/i;
const PRICE_RANGE = /(?:^|\s)(?:between\s+)?(?:rs\.?|₹)\s*(\d{1,6})\s*(?:-|to|and|se)\s*(?:rs\.?|₹)?\s*(\d{1,6})(?=\s|$)|(?:^|\s)(\d{1,6})\s*(?:-|to)\s*(\d{1,6})\s*(?:rs|rupees?|₹)(?=\s|$)|(?:^|\s)between\s+(\d{1,6})\s*(?:and|-|to)\s*(\d{1,6})(?=\s|$)/i;

/**
 * Splits what was typed into the words to look for, a quantity and a price window.
 *
 *   "2 butter naan"        → { text: 'butter naan', qty: 2 }
 *   "roti x3"              → { text: 'roti', qty: 3 }
 *   "paneer under 250"     → { text: 'paneer', price: { max: 250 } }
 *   "₹100-200"             → { text: '', price: { min: 100, max: 200 } }
 *
 * A number on its own ("101") is left as text — it is far more likely a dish code.
 */
// Typed in Hindi/Marathi: Devanagari digits read as numbers, and the price phrases people
// say ("200 से कम", "300 पेक्षा जास्त") work like their English ones. NFD so a ज़ typed
// as one character or as ज + nukta is the same text.
const DEVANAGARI_DIGITS = /[०-९]/g;
const DEV_UNDER = /(?:^|\s)(\d{1,6})\s*(?:रु\.?|रुपये|₹)?\s*(?:से कम|के नीचे|के अंदर|तक|पेक्षा कमी|च्या आत|पर्यंत)(?=\s|$)/u;
const DEV_OVER = /(?:^|\s)(\d{1,6})\s*(?:रु\.?|रुपये|₹)?\s*(?:से ज़?्यादा|से ऊपर|से उपर|पेक्षा जास्त|च्या वर)(?=\s|$)/u;

export function parseMenuQuery(raw) {
  let text = ` ${String(raw ?? '')
    .normalize('NFD')
    .replace(DEVANAGARI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0966))
    .trim()} `;
  let price = null;
  const setPrice = (min, max) => {
    const lo = min === undefined ? undefined : Number(min);
    const hi = max === undefined ? undefined : Number(max);
    price = { ...(price || {}) };
    if (Number.isFinite(lo)) price.min = lo;
    if (Number.isFinite(hi)) price.max = hi;
    if (price.min !== undefined && price.max !== undefined && price.min > price.max) {
      [price.min, price.max] = [price.max, price.min];
    }
  };

  let m = PRICE_RANGE.exec(text);
  if (m) {
    const [lo, hi] = m[1] ? [m[1], m[2]] : m[3] ? [m[3], m[4]] : [m[5], m[6]];
    setPrice(lo, hi);
    text = text.replace(m[0], ' ');
  }
  for (const [re, kind] of [[PRICE_UNDER, 'max'], [PRICE_HI_UNDER, 'max'], [DEV_UNDER, 'max'], [PRICE_OVER, 'min'], [PRICE_HI_OVER, 'min'], [DEV_OVER, 'min']]) {
    m = re.exec(text);
    if (m) {
      if (kind === 'max') setPrice(undefined, m[1]);
      else setPrice(m[1], undefined);
      text = text.replace(m[0], ' ');
    }
  }

  let qty = null;
  text = text.trim();
  const lead = /^(\d{1,2})\s*(?:x|×|\*|pcs?|plates?|nos?)?\s+(.+)$/i.exec(text);
  const trail = /^(.+?)\s+(?:x|×|\*)\s*(\d{1,2})$/i.exec(text) || /^(.+?)\s+(\d{1,2})\s*(?:x|×|pcs?|plates?)$/i.exec(text);
  if (lead && /\p{L}/u.test(lead[2])) {
    qty = Number(lead[1]);
    text = lead[2];
  } else if (trail && /\p{L}/u.test(trail[1])) {
    qty = Number(trail[2]);
    text = trail[1];
  }
  if (qty !== null && !(qty >= 1 && qty <= MAX_QTY)) qty = null;

  return { text: text.replace(/\s+/g, ' ').trim(), qty, price };
}

/**
 * Scores one dish against the typed words. Returns { score, matched } where `matched` is
 * how many of the words found something on it.
 */
function scoreProduct(product, tokens, joined) {
  const nameWords = words(product.name);
  const catWords = words(product.category);
  const codes = codesOf(product);
  const compact = joined.replace(/ /g, '');

  // A code typed in full beats every name match: it is what a kitchen calls the dish.
  if (compact && codes.includes(compact)) return { score: 100, matched: tokens.length };

  let score = 0;
  let matched = 0;
  for (const token of tokens) {
    const byName = bestScore(token, nameWords);
    const byCat = bestScore(token, catWords) * 0.6;
    const byCode = codes.some((c) => c.startsWith(token)) ? (token.length >= 2 ? 0.8 : 0.3) : 0;
    const s = Math.max(byName, byCat, byCode);
    if (s > 0) {
      matched += 1;
      score += s;
    }
  }
  if (matched === 0) return { score: 0, matched: 0 };

  const name = normalize(product.name);
  if (name === joined) score += 2;
  else if (name.startsWith(joined)) score += 1;
  else if (name.includes(joined) && joined.length >= 3) score += 0.5;
  return { score, matched };
}

function inPrice(product, price) {
  if (!price) return true;
  const p = Number(product.price) || 0;
  if (price.min !== undefined && p < price.min) return false;
  if (price.max !== undefined && p > price.max) return false;
  return true;
}

function popularity(product, tally) {
  return Number(tally?.[String(product._id)]) || 0;
}

const SORTS = {
  relevance: null,
  popular: (a, b, tally) => popularity(b.product, tally) - popularity(a.product, tally),
  priceAsc: (a, b) => (Number(a.product.price) || 0) - (Number(b.product.price) || 0),
  priceDesc: (a, b) => (Number(b.product.price) || 0) - (Number(a.product.price) || 0),
  name: (a, b) => String(a.product.name).localeCompare(String(b.product.name)),
};
export const MENU_SORTS = Object.keys(SORTS);

/**
 * The closest spelling the menu actually has, for "did you mean". Each typed word is
 * swapped for the nearest dish/category word within a few slips; null when nothing is
 * close enough or nothing would change.
 */
function suggestSpelling(tokens, products) {
  const vocab = new Set();
  for (const p of products) {
    for (const w of words(p.name)) if (w.length >= 3) vocab.add(w);
    for (const w of words(p.category)) if (w.length >= 3) vocab.add(w);
  }
  let changed = false;
  const out = tokens.map((token) => {
    if (vocab.has(token) || !LATIN.test(token) || token.length < 3) return token;
    const max = Math.max(2, Math.floor(token.length / 3));
    let best = null;
    let bestD = max + 1;
    for (const w of vocab) {
      const d = editDistance(token, w, max);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    if (best) {
      changed = true;
      return best;
    }
    return token;
  });
  return changed ? out.join(' ') : null;
}

/**
 * The menu for what was typed.
 *
 * @param products   every product; archived ones are left out here
 * @param raw        the search box, as typed
 * @param options    { category, sort, tally, limit }
 * @returns {{
 *   results: Array<{ product, score }>,  ranked, category + price applied, ≤ limit
 *   total: number,                        how many matched before the limit
 *   facets: Map<string, number>,          matches per category, before the category filter
 *   parsed: { text, qty, price },
 *   partial: boolean,                     no dish had every word; these have most of them
 *   didYouMean: string | null,
 * }}
 */
export function searchMenu(products, raw, { category = '', sort = 'relevance', tally = {}, limit = 60 } = {}) {
  const live = (products || []).filter((p) => p && p.status !== 'archived');
  let parsed = parseMenuQuery(raw);

  const run = (p) => {
    const tokens = words(p.text);
    const joined = tokens.join(' ');
    let pool = live.filter((product) => inPrice(product, p.price));
    if (tokens.length === 0) {
      return { hits: pool.map((product, i) => ({ product, score: 0, order: i })), partial: false, tokens };
    }
    const scored = [];
    for (let i = 0; i < pool.length; i++) {
      const { score, matched } = scoreProduct(pool[i], tokens, joined);
      if (matched > 0) scored.push({ product: pool[i], score, matched, order: i });
    }
    const all = scored.filter((s) => s.matched === tokens.length);
    if (all.length > 0 || tokens.length === 1) return { hits: all, partial: false, tokens };
    // No dish has every word: show the ones with most of them rather than nothing.
    const need = Math.ceil(tokens.length / 2);
    return { hits: scored.filter((s) => s.matched >= need), partial: true, tokens };
  };

  // "7 up" is a drink, not seven of "up": when a dish's name starts with exactly what was
  // typed, number and all, the number is part of the name.
  if (parsed.qty !== null) {
    const whole = normalize(`${parsed.qty} ${parsed.text}`);
    if (live.some((product) => normalize(product.name).startsWith(whole))) {
      parsed = { ...parsed, text: `${parsed.qty} ${parsed.text}`, qty: null };
    }
  }

  let { hits, partial, tokens } = run(parsed);
  // And when the quantity reading finds nothing at all, try the words as typed.
  if (hits.length === 0 && parsed.qty !== null) {
    const asTyped = { ...parsed, text: `${parsed.qty} ${parsed.text}`, qty: null };
    const second = run(asTyped);
    if (second.hits.length > 0) {
      parsed = asTyped;
      ({ hits, partial, tokens } = second);
    }
  }

  const facets = new Map();
  for (const h of hits) {
    const c = h.product.category;
    if (c) facets.set(c, (facets.get(c) || 0) + 1);
  }

  let list = category ? hits.filter((h) => h.product.category === category) : hits;
  const cmp = SORTS[sort] || null;
  list = [...list].sort((a, b) => {
    if (cmp) {
      const d = cmp(a, b, tally);
      if (d !== 0) return d;
    }
    if (tokens.length > 0 && b.score !== a.score) return b.score - a.score;
    if (tokens.length > 0) {
      const pop = popularity(b.product, tally) - popularity(a.product, tally);
      if (pop !== 0) return pop;
    }
    return a.order - b.order;
  });

  const didYouMean = hits.length === 0 && tokens.length > 0 ? suggestSpelling(tokens, live) : null;

  return {
    results: list.slice(0, limit).map(({ product, score }) => ({ product, score })),
    total: list.length,
    facets,
    parsed,
    partial,
    didYouMean,
  };
}

/**
 * The parts of a name to draw in bold for what was typed: [{ text, hit }]. Only plain
 * substring hits are marked — a forgiven spelling has nothing honest to underline.
 */
export function highlightParts(name, raw) {
  const label = String(name ?? '');
  const tokens = words(parseMenuQuery(raw).text).filter((tk) => tk.length >= 1);
  if (!label || tokens.length === 0) return [{ text: label, hit: false }];
  const lower = label.toLowerCase();
  // A few letters change length when lower-cased ("İ"); the indices would drift.
  if (lower.length !== label.length) return [{ text: label, hit: false }];
  const marks = new Array(label.length).fill(false);
  for (const tk of tokens) {
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(tk, from);
      if (at === -1) break;
      // Start of a word only, so "an" does not light up the middle of "Paneer" and "Naan".
      if (at === 0 || !/[\p{L}\p{N}]/u.test(lower[at - 1])) {
        for (let i = at; i < at + tk.length && i < marks.length; i++) marks[i] = true;
      }
      from = at + 1;
    }
  }
  const parts = [];
  for (let i = 0; i < label.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.hit === marks[i]) last.text += label[i];
    else parts.push({ text: label[i], hit: marks[i] });
  }
  return parts;
}
