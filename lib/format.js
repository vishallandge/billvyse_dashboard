import { toHindiDigits, EMPTY_NUMBER } from './hindiNumerals';

/**
 * A date the browser could not parse is still a date the shopkeeper must not be shown.
 * `new Date('nonsense').toLocaleDateString()` is the string "Invalid Date", which is the
 * same class of leak as printing "null": English debug output in the middle of a Hindi
 * screen. Every formatter below funnels through this.
 */
function validDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Indian grouping (1,23,456 — not 123,456). Amounts were previously printed with
// `toFixed(2)` all over the app, which reads wrong to an Indian shopkeeper at any size
// above four digits.
const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrCompact = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export function formatMoney(value, lang, { decimals = true } = {}) {
  const number = Number(value) || 0;
  const text = decimals ? inr.format(number) : inrCompact.format(Math.round(number));
  return lang === 'hi' || lang === 'mr' ? toHindiDigits(text) : text;
}

export function formatRupees(value, lang, options) {
  const number = Number(value) || 0;
  const sign = number < 0 ? '−' : '';
  return `${sign}₹${formatMoney(Math.abs(number), lang, options)}`;
}

/**
 * Short money for axis ticks, chart labels and tiles: ₹1.2L, ₹45K, ₹3.4Cr.
 *
 * Indian units, not Western ones — a shopkeeper reads "1.2L" instantly and "120K" not at
 * all. Axis ticks are the whole reason this exists: "₹1,25,000" is wider than the gutter
 * it has to sit in, and four of them stacked up turn the left edge of every chart into a
 * wall of digits.
 */
export function formatCompactRupees(value, lang) {
  const number = Number(value) || 0;
  const sign = number < 0 ? '−' : '';
  const abs = Math.abs(number);

  let text;
  if (abs >= 1e7) text = `${Number((abs / 1e7).toFixed(abs >= 1e8 ? 0 : 1))}Cr`;
  else if (abs >= 1e5) text = `${Number((abs / 1e5).toFixed(abs >= 1e6 ? 0 : 1))}L`;
  else if (abs >= 1000) text = `${Number((abs / 1000).toFixed(abs >= 10000 ? 0 : 1))}K`;
  else text = String(Math.round(abs));

  const digits = lang === 'hi' || lang === 'mr' ? toHindiDigits(text) : text;
  return `${sign}₹${digits}`;
}

export function formatQty(value, lang) {
  // `Number(undefined)` is NaN, and NaN.toFixed(3) is the literal string "NaN" — which
  // used to reach the screen next to a unit, as "NaN kg".
  const number = Number(value);
  if (!Number.isFinite(number)) return EMPTY_NUMBER;
  // Trailing zeros on a weight read as noise: 2.500 kg → 2.5 kg.
  const text = String(Number(number.toFixed(3)));
  return lang === 'hi' || lang === 'mr' ? toHindiDigits(text) : text;
}

export function formatDate(value, lang) {
  const date = validDate(value);
  if (!date) return EMPTY_NUMBER;
  const text = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  return lang === 'hi' || lang === 'mr' ? toHindiDigits(text) : text;
}

export function formatDateTime(value, lang) {
  const date = validDate(value);
  if (!date) return EMPTY_NUMBER;
  const text = date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return lang === 'hi' || lang === 'mr' ? toHindiDigits(text) : text;
}

// "2h ago" / "3d ago" — used on activity feeds where an exact timestamp is less useful
// than a sense of how fresh the entry is. Falls back to a short date once it's old enough
// that "ago" stops being meaningful.
export function formatRelativeTime(value, lang) {
  const date = validDate(value);
  if (!date) return EMPTY_NUMBER;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);

  let text;
  if (diffMin < 1) text = 'just now';
  else if (diffMin < 60) text = `${diffMin}m ago`;
  else if (diffMin < 24 * 60) text = `${Math.round(diffMin / 60)}h ago`;
  else if (diffMin < 30 * 24 * 60) text = `${Math.round(diffMin / (60 * 24))}d ago`;
  else text = formatDate(value, lang);

  return lang === 'hi' || lang === 'mr' ? toHindiDigits(text) : text;
}

// YYYY-MM-DD in the browser's own (i.e. the shop's) timezone — safe for a date input.
export function toDateInput(value = new Date()) {
  // Not EMPTY_NUMBER: this feeds a <input type="date">, where anything but '' or a real
  // YYYY-MM-DD is rejected by the browser.
  const date = validDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
