// A browser mirror of backend/utils/purchaseTotals.js, so the purchase form can total a
// bill as it is typed without a round trip. THE TWO FILES MUST CHANGE TOGETHER — a form
// that totals a wholesaler's bill one way and saves it another is worse than one that
// doesn't total at all, because the shopkeeper stops checking.
//
// The server is still the authority: whatever this computes, the order is created by the
// same validated endpoint and re-totalled there. This exists to show a number, not to
// decide one.
//
// The conventions it inherits are documented on the server file: cost prices are
// GST-inclusive, free scheme units are never folded into the charged quantity, and
// bill-level charges are held apart from the rates instead of spread back across them.

import { splitGst } from './catalog';

export function round(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function positive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

// Charged units only, less this row's own "Disc." percentage — the free ones arrive but
// are not billed. The rate itself is left exactly as printed on the wholesaler's bill; the
// discount lives beside it, which is what lets a shopkeeper check the screen against the
// paper line by line.
export function chargedTotal(line) {
  const gross = positive(line?.quantity) * positive(line?.costPrice);
  const discount = Math.min(100, positive(line?.discountPercent));
  return round(gross * (1 - discount / 100));
}

// What lands on the shelf: paid for plus free.
export function receivedQuantity(line) {
  return round(positive(line?.quantity) + positive(line?.freeQuantity));
}

// What one received unit really cost. Ten paid for and two free is ₹100 a strip on the
// bill and ₹83.33 a strip on the shelf — the second number is the shop's real margin.
export function effectiveCost(line) {
  const received = receivedQuantity(line);
  if (!(received > 0)) return round(line?.costPrice);
  return round(chargedTotal(line) / received);
}

export function normaliseCharges(charges) {
  const source = charges || {};
  return {
    lineDiscount: round(positive(source.lineDiscount)),
    cashDiscountPercent: round(Math.min(100, positive(source.cashDiscountPercent))),
    cashDiscount: round(positive(source.cashDiscount)),
    freight: round(positive(source.freight)),
    otherCharges: round(positive(source.otherCharges)),
    roundOff: round(source.roundOff),
  };
}

export function hasAnyCharge(charges) {
  const c = normaliseCharges(charges);
  return (
    c.lineDiscount > 0 ||
    c.cashDiscountPercent > 0 ||
    c.cashDiscount > 0 ||
    c.freight > 0 ||
    c.otherCharges > 0 ||
    c.roundOff !== 0
  );
}

export function purchaseTotals(lines, rawCharges, { interState = false } = {}) {
  const items = Array.isArray(lines) ? lines : [];
  const charges = normaliseCharges(rawCharges);
  const grossAmount = round(items.reduce((sum, line) => sum + chargedTotal(line), 0));

  const cashDiscount =
    charges.cashDiscountPercent > 0
      ? round((grossAmount * charges.cashDiscountPercent) / 100)
      : charges.cashDiscount;

  const lessTotal = round(Math.min(grossAmount, charges.lineDiscount + cashDiscount));
  const netOfDiscount = round(grossAmount - lessTotal);
  const factor = grossAmount > 0 ? netOfDiscount / grossAmount : 1;

  let taxableAmount = 0;
  let gstAmount = 0;
  for (const line of items) {
    const split = splitGst(round(chargedTotal(line) * factor), line.gstRate);
    taxableAmount += split.taxableValue;
    gstAmount += split.gstAmount;
  }
  // The same tax, in the two boxes GSTR-3B asks for. The browser's splitGst has no
  // interState mode — the amount is identical either way, only the presentation differs —
  // so it is halved here instead. The server is still the authority on which one applies.
  const totalGst = round(gstAmount);
  const half = round(totalGst / 2);

  const addTotal = round(charges.freight + charges.otherCharges);

  return {
    grossAmount,
    cashDiscount,
    lessTotal,
    addTotal,
    taxableAmount: round(taxableAmount),
    gstAmount: totalGst,
    igstAmount: interState ? totalGst : 0,
    cgstAmount: interState ? 0 : half,
    sgstAmount: interState ? 0 : round(totalGst - half),
    isInterState: Boolean(interState),
    totalAmount: Math.max(0, round(netOfDiscount + addTotal + charges.roundOff)),
  };
}

// Σ(MRP × received quantity) — what this load is worth on the shelf. Against the net
// payable it is the margin on the whole delivery before a single strip is sold. Null when
// no line carries an MRP, because ₹0 would read as "worth nothing".
export function mrpValue(lines) {
  const items = (Array.isArray(lines) ? lines : []).filter((line) => positive(line.mrp) > 0);
  if (items.length === 0) return null;
  return round(items.reduce((sum, line) => sum + Number(line.mrp) * receivedQuantity(line), 0));
}
