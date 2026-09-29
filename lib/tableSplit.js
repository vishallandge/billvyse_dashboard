// The arithmetic behind splitting one restaurant table into several bills — kept free of
// React and of any import so the backend tests can load it as-is.
//
// A table's items are shared out between "groups": the three friends are one group, the
// person who came alone is another. Each item goes one of three ways:
//
//   { to: 1 }           the whole line to group 1 (the default is group 0)
//   { share: true }     split evenly across every group — the starter everyone ate from
//   { shareAmong: [0, 2] } split evenly across SOME groups — the pizza chairs 1 and 3 shared
//   { qty: [3, 1] }     a count split by hand — 4 rotis, 3 for the friends and 1 for him
//
// Quantities are worked in thousandths, the same precision the server stores, so the
// shares of a line always add back up to exactly the line: 1 plate over 3 people is
// 0.333 + 0.333 + 0.334, never 0.999.

const SCALE = 1000;

function toUnits(quantity) {
  return Math.round((Number(quantity) || 0) * SCALE);
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Splits a quantity into `count` near-equal parts that add up to it exactly. */
export function shareQuantities(quantity, count) {
  const n = Math.max(1, Math.floor(count));
  const total = toUnits(quantity);
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  const parts = [];
  // The odd thousandths go to the LAST groups, so "Bill 1" reads the round number.
  for (let i = 0; i < n; i += 1) {
    const extra = i >= n - remainder ? 1 : 0;
    parts.push((base + extra) / SCALE);
  }
  return parts;
}

/** Whether a line's quantity can be split by hand — a count of at least two whole things. */
export function canSplitQuantity(item) {
  const quantity = Number(item?.quantity) || 0;
  return quantity >= 2 && Number.isInteger(quantity);
}

/**
 * Shares every item out into `groupCount` groups.
 *
 * Returns the groups (each with its lines and its subtotal) and the ids of any item whose
 * hand-split counts don't add up to the line — those must be fixed before anything bills,
 * because a roti nobody is paying for is a roti the shop loses.
 */
export function buildGroups(items, allocation, groupCount) {
  const n = Math.max(1, Math.floor(groupCount));
  const groups = Array.from({ length: n }, (_, index) => ({ index, lines: [], subtotal: 0 }));
  const unbalanced = [];

  const put = (index, item, quantity) => {
    if (!(quantity > 0)) return;
    const group = groups[index] || groups[0];
    group.lines.push({ item, quantity });
    group.subtotal += item.price * quantity;
  };

  for (const item of items || []) {
    const rule = (allocation || {})[item._id] || {};
    if (rule.share) {
      shareQuantities(item.quantity, n).forEach((quantity, index) => put(index, item, quantity));
    } else if (Array.isArray(rule.shareAmong) && rule.shareAmong.some((i) => Number.isInteger(i) && i >= 0 && i < n)) {
      const among = Array.from(new Set(rule.shareAmong.filter((i) => Number.isInteger(i) && i >= 0 && i < n)));
      shareQuantities(item.quantity, among.length).forEach((quantity, k) => put(among[k], item, quantity));
    } else if (Array.isArray(rule.qty)) {
      const counts = Array.from({ length: n }, (_, index) => Math.max(0, Number(rule.qty[index]) || 0));
      const assigned = counts.reduce((sum, value) => sum + toUnits(value), 0);
      if (assigned !== toUnits(item.quantity)) unbalanced.push(item._id);
      counts.forEach((quantity, index) => put(index, item, quantity));
    } else {
      const index = Number.isInteger(rule.to) && rule.to >= 0 && rule.to < n ? rule.to : 0;
      put(index, item, item.quantity);
    }
  }

  for (const group of groups) group.subtotal = round2(group.subtotal);
  return { groups, unbalanced };
}

/**
 * The section charge on a set of lines — "AC charge 10%".
 *
 * Its GST follows the food it is charged on (a service charge takes the tax of the supply
 * it rides with). With mixed rates on one bill, the rate carrying the most money wins.
 */
export function sectionCharge(lines, percent) {
  const pct = Number(percent) || 0;
  if (pct <= 0) return { amount: 0, gstRate: 0 };
  const byRate = new Map();
  let base = 0;
  for (const { item, quantity } of lines || []) {
    const value = item.price * quantity;
    base += value;
    const rate = Number(item.gstRate) || 0;
    byRate.set(rate, (byRate.get(rate) || 0) + value);
  }
  let gstRate = 0;
  let best = -1;
  for (const [rate, value] of byRate) {
    if (value > best) {
      best = value;
      gstRate = rate;
    }
  }
  return { amount: round2((base * pct) / 100), gstRate };
}

/**
 * The bill line for a section charge, in the shape POST /api/seller/bills takes for a
 * custom (product-less) line. SAC 996331 is restaurant service.
 */
export function sectionChargeLine(label, percent, lines) {
  const { amount, gstRate } = sectionCharge(lines, percent);
  if (amount <= 0) return null;
  return { name: `${label} (${Number(percent)}%)`, price: amount, quantity: 1, gstRate, sacCode: '996331' };
}

/**
 * A stable idempotency key for one bill off a table.
 *
 * It carries a fingerprint of exactly which lines are on the bill. A retry of the same bill
 * after a dropped connection gets the same key (and the server hands back the bill it
 * already made); a bill whose lines were changed after a failure gets a new key rather
 * than silently being answered with the old bill's contents.
 */
export function tableBillKey(orderId, kind, lines, extra = '') {
  const text = JSON.stringify([
    kind,
    extra,
    (lines || []).map(({ item, quantity }) => [String(item._id), toUnits(quantity)]),
  ]);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return `table-${orderId}-${kind}-${hash.toString(36)}`.slice(0, 80);
}

const FRACTIONS = [
  [0.25, '¼'],
  [0.333, '⅓'],
  [0.334, '⅓'],
  [0.5, '½'],
  [0.666, '⅔'],
  [0.667, '⅔'],
  [0.75, '¾'],
];

/** "½", "1⅓", "0.2" — a shared quantity as a waiter would say it. */
export function formatShareQuantity(quantity) {
  const q = Number(quantity) || 0;
  const whole = Math.floor(q + 0.0005);
  const rest = Math.round((q - whole) * SCALE) / SCALE;
  if (rest < 0.0005) return String(whole);
  const match = FRACTIONS.find(([value]) => Math.abs(value - rest) < 0.0006);
  if (match) return `${whole > 0 ? whole : ''}${match[1]}`;
  return String(Number(q.toFixed(3)));
}
