// Mirrors backend/utils/upi.js — used for a live QR preview while the seller is still
// building a bill, before a bill number exists. The final receipt QR uses the
// server-built link instead (backend/utils/upi.js) so amount/bill-number always match.
export function buildUpiLink({ upiId, payeeName, amount, note }) {
  if (!upiId) return null;
  const params = new URLSearchParams();
  params.set('pa', upiId);
  params.set('pn', (payeeName || 'Dukaan').slice(0, 50));
  if (amount != null) params.set('am', Number(amount).toFixed(2));
  params.set('cu', 'INR');
  if (note) params.set('tn', note.slice(0, 50));
  return `upi://pay?${params.toString()}`;
}

// The amount a UPI link actually asks for (its `am`), or 0. Every printed "₹X — scan to pay"
// reads its figure through this, so the words and the code can never be two numbers.
export function upiLinkAmount(link) {
  if (!link) return 0;
  const value = Number(new URLSearchParams(String(link).split('?')[1] || '').get('am'));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// Whether a bill's pay link is THIS bill's: the server writes `tn=Bill <number>` into it
// (backend getBillReceiptText). A link carrying another bill's number is never drawn — the
// last line of defence against one bill's QR reaching another bill's slip.
export function upiLinkIsForBill(link, billNumber) {
  if (!link) return false;
  const note = new URLSearchParams(String(link).split('?')[1] || '').get('tn');
  if (!note) return true;
  return billNumber != null && note.trim() === `Bill ${billNumber}`;
}

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * What a bill should still collect through UPI — the dashboard's copy of backend
 * utils/billUpiDue.js for the payment modes a slip carries a pay QR for:
 *   upi   → the bill, less anything returned
 *   split → only its UPI part (never more than the bill, less returns)
 *   anything else → 0
 */
export function billUpiExpected(bill) {
  if (!bill || bill.status === 'cancelled') return 0;
  const returned = (bill.returns || []).reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
  const owed = Math.max(0, round2((Number(bill.payableTotal ?? bill.total) || 0) - returned));
  if (bill.paymentMode === 'upi') return owed;
  if (bill.paymentMode === 'split') {
    const upiPart = (bill.payments || [])
      .filter((entry) => entry.mode === 'upi')
      .reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
    return round2(Math.min(owed, upiPart));
  }
  return 0;
}

/**
 * Reads a bill's pay link back and checks it against the bill — the one check behind both
 * "draw this QR or not" and the line the owner reads under it.
 *
 * Returns { ok, amount, billNumber, payee, reason } where everything is read OUT of the link
 * (what the customer's UPI app will actually show), and `reason` is set when ok is false:
 *   'wrongBill'   — the link names another bill
 *   'wrongAmount' — the amount inside is not what this bill owes by UPI
 */
export function checkBillUpiLink(link, bill) {
  const params = new URLSearchParams(String(link || '').split('?')[1] || '');
  const amount = upiLinkAmount(link);
  const payee = params.get('pa') || '';
  const billNumber = bill?.billNumber;
  if (!link || !upiLinkIsForBill(link, billNumber)) return { ok: false, amount, billNumber, payee, reason: 'wrongBill' };
  const expected = billUpiExpected(bill);
  if (!(expected > 0) || Math.abs(amount - expected) >= 0.01) {
    return { ok: false, amount, billNumber, payee, reason: 'wrongAmount' };
  }
  return { ok: true, amount, billNumber, payee, reason: null };
}
