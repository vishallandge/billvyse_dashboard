'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import UpiQr from './UpiQr';

// The receipt the browser "Print" button actually prints. Rendered through a portal as a
// direct child of <body> and hidden on screen (display:none); handlePrint adds a
// `printing-receipt` class to <body>, and an @media print block then hides every other
// body child and sizes the page to an 80mm roll — so what comes out is a crisp thermal
// receipt, not the raw text dump on an A4 sheet with browser header/footer chrome it was.
// Being a direct body child (not buried in the dashboard tree) is what lets us hide
// everything else cleanly, with no stray blank pages.
//
// Everything is laid out from the `receipt` (the created bill) plus the shop profile, so
// there is no second source of truth to drift from the on-screen summary.

function money(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

// The lots a line went out of, from whichever of the two shapes this component was handed.
// A line can span two lots when the older one runs out mid-sale.
function lotsOf(item) {
  return (item.batches || item.batchAllocation || []).filter((lot) => lot?.batchNumber);
}

// "06/28" — the month, the way it is printed on the strip. A 58mm slip has no room for a
// full date and a medicine is sellable for its whole expiry month anyway.
function expiryMonth(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getFullYear()).slice(-2)}`;
}

export default function ThermalReceipt({ receipt, shop, upiLink, t }) {
  // Portals need the DOM; only render after mount to stay SSR-safe.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Offline "pending sync" receipts aren't real bills yet — nothing to print.
  if (!receipt || receipt.offline || !mounted) return null;

  const date = new Date(receipt.createdAt || Date.now());
  const showGst = receipt.gstAmount > 0;
  // Every reduction the counter gave, not just the coupon/points ones. A printed receipt
  // whose total is lower than the items above it, with nothing explaining the gap, is the
  // one thing a customer will stand at the counter and query.
  const discount =
    (receipt.couponDiscount || 0) +
    (receipt.pointsRedeemedValue || 0) +
    (receipt.billDiscount || 0) +
    (receipt.itemDiscountTotal || 0);
  const roundOff = receipt.roundOff || 0;
  const grandTotal = receipt.payableTotal ?? receipt.total;
  // What the shop's own prices saved the customer against the printed MRP — a different
  // thing from the discount above, and the line a customer actually reads twice.
  const savedAgainstMrp = (receipt.items || []).reduce(
    (sum, item) => sum + (item.mrp > 0 ? Math.max(0, (item.mrp - item.price) * item.quantity) : 0),
    0
  );
  const modeLabel = { cash: t('seller.cash'), upi: t('seller.upi'), card: t('seller.card'), khata: t('nav.khata') }[receipt.paymentMode] || receipt.paymentMode;

  return createPortal(
    <div className="thermal-receipt" aria-hidden="true">
      <div className="tr-head">
        <div className="tr-shop">{shop?.shopName || 'Dukaan'}</div>
        {shop?.shopAddress && <div className="tr-line">{shop.shopAddress}</div>}
        {shop?.shopPhone && <div className="tr-line">Ph: {shop.shopPhone}</div>}
        {showGst && shop?.gstin && <div className="tr-line">GSTIN: {shop.gstin}</div>}
      </div>

      <div className="tr-rule" />

      <div className="tr-meta">
        <span>Bill #{receipt.billNumber}</span>
        <span>
          {date.toLocaleDateString('en-IN')} · {date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {receipt.counter && (
        <div className="tr-meta">
          <span>{t('seller.counter') || 'Counter'}</span>
          <span>{receipt.counter}</span>
        </div>
      )}

      <div className="tr-rule" />

      <div className="tr-items">
        <div className="tr-item tr-item-head">
          <span className="tr-name">{t('seller.productName')}</span>
          <span className="tr-amt">{t('seller.price')}</span>
        </div>
        {receipt.items.map((item, index) => (
          <div className="tr-item" key={index}>
            <div className="tr-name">
              <div className="tr-item-name">{item.name}</div>
              <div className="tr-item-sub">
                {item.quantity}{item.unit ? ` ${item.unit}` : ''} × {money(item.price)}
              </div>
              {/* Batch and expiry on the counter slip too, not only on the A4 invoice — a
                  chemist hands out far more of these, and a strip is brought back against
                  whichever piece of paper went out with it. Only ever present on a
                  batch-tracked line, so a kirana's slip is unchanged.

                  Two field names because this component is fed from two places: the freshly
                  created bill straight off the API (`batchAllocation`, the raw stored
                  field) and the built invoice payload (`batches`). See utils/invoice.js. */}
              {lotsOf(item).length > 0 && (
                <div className="tr-item-sub tr-batch">
                  {lotsOf(item)
                    .map((lot) => `B.${lot.batchNumber}${lot.expiryDate ? ` E.${expiryMonth(lot.expiryDate)}` : ''}`)
                    .join('  ')}
                </div>
              )}
              {/* The single most-read line on a receipt that carried a scheme. A customer
                  who came in for "1 pe 1 free" wants to see FREE against the thing they
                  got, not a smaller number at the bottom they have to work backwards from. */}
              {item.freeQuantity > 0 && (
                <div className="tr-item-sub">
                  {item.freeQuantity} FREE — {item.offerName || 'offer'}
                </div>
              )}
            </div>
            <span className="tr-amt">{money(item.lineTotal)}</span>
          </div>
        ))}
      </div>

      <div className="tr-rule" />

      <div className="tr-totals">
        {(showGst || discount > 0) && (
          <div className="tr-total-row">
            <span>{t('seller.subtotal')}</span>
            <span>{money(receipt.subtotal ?? receipt.total)}</span>
          </div>
        )}
        {showGst && (
          <>
            <div className="tr-total-row tr-muted">
              <span>{t('seller.taxable')}</span>
              <span>{money(receipt.taxableAmount)}</span>
            </div>
            <div className="tr-total-row tr-muted">
              <span>{t('seller.gst')}</span>
              <span>{money(receipt.gstAmount)}</span>
            </div>
          </>
        )}
        {discount > 0 && (
          <div className="tr-total-row">
            <span>{t('seller.discount')}</span>
            <span>−{money(discount)}</span>
          </div>
        )}
        {/* Named separately from the anonymous "Discount" row above, which already contains
            it: this is the shop's own advertising printed back as proof it was honoured,
            and folding it into a nameless number throws that away. */}
        {(receipt.offers || []).map((entry, index) => (
          <div className="tr-total-row tr-muted" key={index}>
            <span>{entry.name}</span>
            <span>{entry.discount > 0 ? `−${money(entry.discount)}` : `${entry.freeUnits} FREE`}</span>
          </div>
        ))}
        {Math.abs(roundOff) >= 0.005 && (
          <div className="tr-total-row tr-muted">
            <span>{t('seller.roundOff')}</span>
            <span>
              {roundOff > 0 ? '+' : '−'}
              {money(Math.abs(roundOff))}
            </span>
          </div>
        )}
        <div className="tr-grand">
          <span>{t('seller.total')}</span>
          <span>{money(grandTotal)}</span>
        </div>
        <div className="tr-mode">{modeLabel}</div>
        {savedAgainstMrp > 0 && (
          <div className="tr-points">{t('seller.mrpSaving', { amount: savedAgainstMrp.toFixed(2) })}</div>
        )}
        {receipt.pointsEarned > 0 && (
          <div className="tr-points">★ {receipt.pointsEarned} {t('seller.pointsEarned')}</div>
        )}
      </div>

      {receipt.paymentMode === 'upi' && upiLink && (
        <div className="tr-qr">
          <UpiQr link={upiLink} size={150} />
          <div className="tr-line">{t('seller.scanToPay')}</div>
        </div>
      )}

      <div className="tr-rule tr-dashed" />

      <div className="tr-foot">
        <div className="tr-thanks">{t('seller.receiptThanks') || 'Dhanyavaad! Phir aaiyega 🙏'}</div>
        {/* Resolved against the shop's plan server-side and carried on /auth/me, so the
            counter slip agrees with the A4 bill without a fetch of its own. Absent on an
            older cached session, which prints it — the Free-plan answer. */}
        {shop?.showAppCredit !== false && <div className="tr-brand">Billed with BillVyse</div>}
      </div>
    </div>,
    document.body
  );
}
