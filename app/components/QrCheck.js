'use client';

/**
 * The line under a bill's pay QR that tells the owner, in one glance, that the code is right:
 * "✓ QR sahi hai · Bill #125 · paisa jaayega: shop@okaxis" — the amount is the big figure
 * printed just above it, read out of the same code.
 *
 * Every figure is read OUT of the QR's own link (lib/upi.js checkBillUpiLink), not off the
 * bill — so it says what the customer's UPI app will actually show. When the check fails the
 * QR is not drawn at all, and this line says why in red instead.
 */
export default function QrCheck({ check, t }) {
  if (!check) return null;
  if (!check.ok) {
    return (
      <p className="qr-check is-bad" role="alert">
        ✕ {t(check.reason === 'wrongBill' ? 'seller.qrCheckWrongBill' : 'seller.qrCheckWrongAmount')}
      </p>
    );
  }
  return (
    <p className="qr-check is-ok">
      ✓ {t('seller.qrCheckOk', {
        bill: check.billNumber,
        payee: check.payee,
      })}
    </p>
  );
}
