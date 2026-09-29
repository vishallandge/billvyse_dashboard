// What a bill will actually come to, worked out on the screen the same way the server
// works it out when the bill is saved (backend/utils/billTotals.js → computeBillTotals).
//
// The table screen used to add up line prices and take the discount off, and stop there —
// while the saved bill also rounds to the whole rupee. So the waiter told the customer
// ₹104.50 and the printed bill said ₹105. Every "to pay" on the table screen goes through
// this now, and backend/tests/billMath.test.js checks it against the server's own function
// on thousands of random bills so the two can never drift apart again.
//
// Prices are GST-inclusive in this app, so tax is inside these numbers, not added on top.
// Import-free so the backend test can load it as-is.

// Exactly the server's rounding (toFixed), not Math.round(x*100)/100: the two disagree on
// numbers like 467.835 (stored as 467.83499…), and a paisa off per line is a bill that
// doesn't match the screen.
function round2(value) {
  return Number((Number(value) || 0).toFixed(2));
}

/**
 * @param lines          [{ price, quantity }] — dishes, plus any charge line (quantity 1)
 * @param discountPercent the % typed at the counter (wins over an amount, as on the server)
 * @param discountAmount  a flat ₹ discount
 * @param roundOff        the shop's "round to the rupee" setting (on unless switched off)
 * @returns { subtotal, discount, total, roundOff, payable }
 */
export function billMoney({ lines, discountPercent = 0, discountAmount = 0, roundOff = true }) {
  // Each line is rounded to paise on its own first — exactly as applyLineDiscount does —
  // and only then added up. Adding first and rounding once can differ by a paisa per line.
  const subtotal = round2((lines || []).reduce((sum, l) => sum + round2((Number(l.price) || 0) * (Number(l.quantity) || 0)), 0));
  const percent = Math.min(Math.max(Number(discountPercent) || 0, 0), 100);
  let discount = percent > 0 ? round2((subtotal * percent) / 100) : round2(Math.max(0, Number(discountAmount) || 0));
  discount = Math.max(0, Math.min(discount, subtotal));
  const total = round2(subtotal - discount);
  let payable = total < 0 ? 0 : total;
  let rounding = 0;
  if (roundOff && payable > 0) {
    const whole = Math.round(payable);
    rounding = round2(whole - payable);
    payable = round2(whole);
  }
  return { subtotal, discount, total, roundOff: rounding, payable };
}
