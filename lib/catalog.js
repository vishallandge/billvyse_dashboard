// Mirror of backend/config/catalog.js. The dashboard can't import from the backend, so
// the one rule is: change that file and this one together. Every GST dropdown and unit
// dropdown in the app reads from here — previously each screen carried its own copy, so
// a slab added in one place quietly went missing in another.

// Two halves — see backend/config/catalog.js for the full reasoning.
//
// CURRENT_GST_SLABS is what the product form offers: nil, the 3% gold/silver rate, the two
// ordinary rates, and 40% for the demerit goods (aerated drinks, pan masala, tobacco) a
// teastall or kirana could not bill correctly without.
//
// LEGACY_GST_SLABS (12, 28) stays saveable forever because products and bills already hold
// those rates, but is shown greyed out rather than as a normal choice.
export const CURRENT_GST_SLABS = [0, 3, 5, 18, 40];
export const LEGACY_GST_SLABS = [12, 28];

export const GST_SLABS = [0, 3, 5, 12, 18, 28, 40];

export function isLegacyGstSlab(rate) {
  return LEGACY_GST_SLABS.includes(Number(rate));
}

/**
 * The rates a GST dropdown should show.
 *
 * Always the current slabs. A retired rate (12%, 28%) appears only when the thing being
 * edited is already saved at it — an old product opened for a price change must not
 * silently show a different rate than it has, and must not force the shopkeeper to
 * re-classify it just to fix a typo. It is marked "purana" so the one case where it does
 * show reads as history rather than as a live choice.
 *
 * `selected` is whatever the form currently holds; anything not a legacy rate is ignored
 * here because it is already in the current list.
 */
export function gstRateOptions(selected) {
  const rate = Number(selected);
  const rates = isLegacyGstSlab(rate) ? [...CURRENT_GST_SLABS, rate].sort((a, b) => a - b) : CURRENT_GST_SLABS;
  return rates.map((r) => ({ value: String(r), label: isLegacyGstSlab(r) ? `${r}% (purana)` : `${r}%` }));
}

export const UNIT_GROUPS = [
  { key: 'weight', units: ['kg', 'gram', 'quintal'] },
  { key: 'volume', units: ['litre', 'ml'] },
  { key: 'count', units: ['piece', 'dozen', 'packet', 'box', 'pair', 'set', 'bundle', 'roll', 'bag', 'bottle', 'tray', 'carton'] },
  { key: 'length', units: ['metre', 'cm', 'feet', 'inch', 'sqft'] },
  { key: 'pharma', units: ['tablet', 'capsule', 'strip', 'sachet', 'vial', 'tube', 'ampoule'] },
  { key: 'service', units: ['hour', 'day', 'service'] },
];

export const UNITS = UNIT_GROUPS.flatMap((group) => group.units);

export const SERVICE_UNITS = UNIT_GROUPS.find((group) => group.key === 'service').units;

// ---- Selling loose out of a pack ----
// Mirrors backend/config/catalog.js and backend/utils/packs.js. The browser needs the
// same answers the server will give so a cart line can price and total itself while it is
// being edited — but the server recomputes all of it at /api/seller/bills, so nothing
// here is ever trusted as the final number.

export const FIXED_PACK_SIZES = {
  'kg>gram': 1000,
  'quintal>kg': 100,
  'litre>ml': 1000,
  'dozen>piece': 12,
  'pair>piece': 2,
  'metre>cm': 100,
  'feet>inch': 12,
};

export function defaultPackSize(unit, subUnit) {
  return FIXED_PACK_SIZES[`${unit}>${subUnit}`];
}

export const SUB_UNIT_SUGGESTIONS = {
  packet: ['tablet', 'capsule', 'piece', 'gram', 'ml', 'sachet'],
  strip: ['tablet', 'capsule'],
  box: ['strip', 'piece', 'packet', 'tablet', 'pair'],
  carton: ['packet', 'piece', 'bottle', 'box'],
  bottle: ['ml', 'tablet', 'capsule', 'piece'],
  tray: ['piece'],
  bag: ['kg', 'gram', 'piece', 'packet'],
  bundle: ['piece', 'metre'],
  roll: ['metre', 'piece'],
  set: ['piece'],
  vial: ['ml'],
  tube: ['gram', 'ml'],
  kg: ['gram'],
  quintal: ['kg'],
  litre: ['ml'],
  dozen: ['piece'],
  pair: ['piece'],
  metre: ['cm'],
  feet: ['inch'],
};

export function isSubUnitPair(unit, subUnit) {
  if (!UNITS.includes(unit) || !UNITS.includes(subUnit)) return false;
  if (unit === subUnit) return false;
  if (SERVICE_UNITS.includes(unit) || SERVICE_UNITS.includes(subUnit)) return false;
  return true;
}

/** How many sub-units one pack holds, or 0 when this product isn't sold loose. */
export function packSizeOf(product) {
  if (!product || product.kind === 'service') return 0;
  if (!product.subUnit || !isSubUnitPair(product.unit, product.subUnit)) return 0;
  const size = Number(product.subUnitsPerUnit);
  return Number.isFinite(size) && size > 1 ? size : 0;
}

/**
 * Price of one loose piece, to full precision. The shop's own loose price wins; otherwise
 * the pack price is divided and deliberately NOT rounded — see backend/utils/packs.js for
 * why (rounding ₹45/kg to ₹0.05 a gram overcharges 250g by 11%). Round once, on the line
 * total, using lineTotalOf below — which is exactly what the server does, so the cart
 * total on screen is the total on the bill.
 */
export function subUnitPriceOf(product, packPrice = product?.price) {
  const size = packSizeOf(product);
  if (!size) return Number(packPrice) || 0;
  const explicit = Number(product.subUnitPrice);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit * 100) / 100;
  return (Number(packPrice) || 0) / size;
}

/**
 * A loose line's total rounds UP to the paisa (the shop never loses on a broken pack); a
 * whole-pack line rounds normally, exactly as it always did.
 */
export function lineTotalOf({ price, quantity, loose }) {
  const raw = (Number(price) || 0) * (Number(quantity) || 0);
  return loose ? Math.ceil(raw * 100) / 100 : Math.round(raw * 100) / 100;
}

/**
 * The per-piece price for display: paisa precision for a rupee-sized piece, more for the
 * small ones. "₹3.67 per tablet" and "₹0.045 per gram" are both what the shop charges;
 * "₹0.05 per gram" is not.
 */
export function formatSubUnitPrice(value) {
  const price = Number(value) || 0;
  return price >= 1 ? price.toFixed(2) : String(Math.round(price * 10000) / 10000);
}

/**
 * "188.8 packet" is arithmetically right and useless to someone counting a shelf. Splits a
 * stock figure into the two numbers they'd actually say out loud: whole packs, and the
 * loose pieces left over from the one that's been opened.
 */
export function splitPackStock(product, stockQuantity) {
  const size = packSizeOf(product);
  const total = Number(stockQuantity) || 0;
  if (!size) return { packs: total, loose: 0, subTotal: 0, packSize: 0 };
  const packs = Math.floor(total + 1e-9);
  return { packs, loose: Math.round((total - packs) * size), subTotal: Math.round(total * size), packSize: size };
}

// Prices everywhere in this app are GST-inclusive (kirana-style MRP), so the tax is split
// out of an already-final amount rather than added on top. Same maths as the backend's
// utils/gst.js — this exists only so a form can show the breakup while it is being typed.
export function splitGst(inclusiveAmount, rate) {
  const amount = Number(inclusiveAmount) || 0;
  const gstRate = GST_SLABS.includes(Number(rate)) ? Number(rate) : 0;
  const taxableValue = amount / (1 + gstRate / 100);
  return { taxableValue, gstAmount: amount - taxableValue };
}

/**
 * Renders a grouped <select> of units. Grouping matters once the list passes a dozen —
 * a hardware shop looking for "sqft" shouldn't have to read past every weight unit.
 * `t` is the caller's translator so unit names stay in the shop's own language.
 *
 * `preferred` (from the shop's business type) puts that trade's own units in a short
 * group at the very top. Nothing is removed — a hardware shop that sells one item by the
 * kilo can still find it further down.
 */
export function unitOptions(t, preferred) {
  const groups = UNIT_GROUPS.map((group) => ({
    label: t(`units.group.${group.key}`),
    units: group.units.map((unit) => ({ value: unit, label: t(`units.${unit}`) })),
  }));

  if (!preferred?.length || preferred.length >= UNITS.length) return groups;

  return [
    {
      label: t('units.group.common'),
      units: preferred.filter((unit) => UNITS.includes(unit)).map((unit) => ({ value: unit, label: t(`units.${unit}`) })),
    },
    ...groups,
  ];
}
