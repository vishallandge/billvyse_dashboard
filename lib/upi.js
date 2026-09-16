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
