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
