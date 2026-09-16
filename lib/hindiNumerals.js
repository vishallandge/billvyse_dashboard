const DIGIT_MAP = { 0: '०', 1: '१', 2: '२', 3: '३', 4: '४', 5: '५', 6: '६', 7: '७', 8: '८', 9: '९' };

/**
 * A missing number, in a shape a shopkeeper can read.
 *
 * NOTHING in this app may print the words "null", "undefined" or "NaN". They are not a
 * value a dukandar can interpret — he reads them as the app being broken, and from that
 * moment he does not trust the figures next to them either. The em dash is the same
 * "nothing here" mark formatDate() has always used, so a blank number and a blank date
 * look the same down a column.
 *
 * Zero is NOT missing. `formatNumber(0)` must stay "0" — a shop with zero pending bills
 * has an answer, and printing a dash for it would hide it.
 */
export const EMPTY_NUMBER = '—';

function isMissing(value) {
  return value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value));
}

export function toHindiDigits(value) {
  // `String(null)` is the word "null", and this function sits under every number the
  // Hindi and Marathi dashboards print — so the guard belongs here, at the bottom, not
  // at each of the callers.
  if (isMissing(value)) return EMPTY_NUMBER;
  return String(value).replace(/[0-9]/g, (d) => DIGIT_MAP[d]);
}

export function formatNumber(value, lang) {
  if (isMissing(value)) return EMPTY_NUMBER;
  return lang === 'hi' || lang === 'mr' ? toHindiDigits(value) : String(value);
}
