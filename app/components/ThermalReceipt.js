'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import UpiQr from './UpiQr';
import { billUpiExpected, checkBillUpiLink, upiLinkAmount } from '../../lib/upi';
import usePrinters from '../../lib/printer/usePrinters';
import { getRolePrinter, printerDots } from '../../lib/printer';
import { shopPaper } from '../../lib/printer/slip';
import { usePrintLogo } from '../../lib/printer/logo';

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

// A column figure: two decimals, no ₹ (the column head and the total carry the currency).
function figure(value) {
  return Number(value || 0).toFixed(2);
}

// "2", "0.25 kg", "1.5 L" — a counted piece needs no unit, a weighed or measured one does.
// Trailing zeros go: 0.500 kg reads as 0.5 kg.
function qtyText(item) {
  const qty = Number(Number(item.quantity || 0).toFixed(3));
  const unit = String(item.unit || '').trim();
  const counted = !unit || /^(pc|pcs|piece|pieces|nos?|unit|units)$/i.test(unit);
  return counted ? String(qty) : `${qty} ${unit}`;
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

// `paidCopy`: the copy printed AFTER the shopkeeper has seen the UPI money arrive — no pay
// QR (it is paid), and the customer's download QR in its place. Only ever set by a button the
// shopkeeper presses after confirming the payment; never the default slip.
export default function ThermalReceipt({ receipt, shop, upiLink, billLink, t, paidCopy = false }) {
  // Portals need the DOM; only render after mount to stay SSR-safe.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Settings → Printers can leave the bill-link QR off the slip: ~3cm of roll per bill.
  const { settings: printerSettings } = usePrinters();
  const showBillQr = printerSettings.billQr !== false;
  // The shop's logo, from Settings → Invoice look. data-print-logo tells the printer code to
  // turn it into black-and-white dots a thermal head can print (lib/printer/raster.js).
  const logoUrl = usePrintLogo(shop);
  const showLogo = Boolean(logoUrl) && printerSettings.printLogo !== false;

  // How much room the item name gets. Four columns on one line is the bill everyone reads,
  // but on a 58mm roll — or at a big text size — Qty, Rate and Amount leave the name two
  // letters wide and it prints one syllable per line. Then the name takes a line of its
  // own and the three figures sit under their headings on the next.
  const receiptPrinter = getRolePrinter('receipt');
  const rollMm = receiptPrinter ? (printerDots(receiptPrinter) > 384 ? 80 : 58) : shopPaper(shop).widthMm;
  const textScale = printerSettings.textScale || 1.4;
  const narrow = rollMm < 70 || textScale >= 1.8;
  // Characters that fit the name column on one line at this size (80mm roll).
  const nameFits = Math.floor(22 / textScale);
  const stacked = (name) => narrow || String(name || '').length > nameFits;

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
  // The pay QR rides on a UPI bill, and on a split bill for its UPI part. The amount printed
  // under it is read straight OUT of the link the QR encodes — so the number the customer
  // reads and the number their UPI app shows can never be two different figures.
  //
  // Verified before it is drawn: the amount in the link must equal what THIS bill still owes
  // through UPI (the same rule as backend utils/billUpiDue.js). A link that belongs to some
  // other bill, or carries any other figure, prints no QR at all — a missing code costs the
  // customer one question; a wrong one costs them money.
  // One check, shared with the screen's "✓ QR sahi hai" line: lib/upi.js checkBillUpiLink.
  const upiAmount = upiLinkAmount(upiLink);
  const expectedUpi = paidCopy ? 0 : billUpiExpected(receipt);
  // Settings → Printers can take the pay QR off paper. Turning it off never puts the download
  // QR in its place: that one opens a page saying PAID, and this bill is not paid yet.
  const showUpiQr =
    printerSettings.upiQr !== false && !paidCopy && Boolean(upiLink) && checkBillUpiLink(upiLink, receipt).ok;
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
        {showLogo && (
          <div className="tr-logo" data-print-logo="">
            <img src={logoUrl} alt="" />
          </div>
        )}
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
        {/* Four columns — Item Description · Qty · Rate · Amount — the layout every
            shopkeeper already reads on a printed bill. Figures without the ₹ sign: it sits
            once on the total, and four ₹ per line is width an 80mm roll does not have. */}
        {/* The heading is always two lines — "Item Description" over "Qty Rate Amount" —
            so it never breaks mid-word whatever the paper or text size. */}
        <div className="tr-row4 tr-item-head tr-stacked">
          <span className="tr-name">{t('seller.receiptColItem')}</span>
          <span className="tr-qty">{t('seller.receiptColQty')}</span>
          <span className="tr-rate">{t('seller.receiptColRate')}</span>
          <span className="tr-amt">{t('seller.receiptColAmount')}</span>
        </div>
        {receipt.items.map((item, index) => (
          <div className={`tr-row4 tr-item${stacked(item.name) ? ' tr-stacked' : ''}${narrow ? ' tr-narrow' : ''}`} key={index}>
            <div className="tr-name">
              <div className="tr-item-name">{item.name}</div>
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
            <span className="tr-qty">{qtyText(item)}</span>
            <span className="tr-rate">{figure(item.price)}</span>
            <span className="tr-amt">{figure(item.lineTotal)}</span>
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

      {showUpiQr && (
        // data-print-mm: the QR keeps this real size on paper whatever the text size — the
        // smallest that still scans reliably off a phone camera (see lib/printer/raster.js).
        <div className="tr-qr tr-qr-upi" data-print-mm="32">
          <UpiQr link={upiLink} size={150} />
          {upiAmount > 0 && <div className="tr-line"><strong>{money(upiAmount)}</strong></div>}
          <div className="tr-line">{t('seller.scanToPay')}</div>
        </div>
      )}

      {/* The customer's own link to this bill (no login, PDF download). A thermal slip
          fades in a month and gets lost sooner; the QR is how a warranty claim or a return
          still finds the real bill. Not on a UPI-pending slip, which already carries a QR
          the customer has to scan first — two codes on one slip get scanned in the wrong order.
          Keyed on the money still owed by UPI, not on whether a pay QR got drawn: the page this
          opens says PAID, so a UPI bill whose pay QR is missing (no UPI ID in Settings) must
          not hand the customer a "PAID" screen to show instead of paying. */}
      {(showBillQr || paidCopy) && billLink && expectedUpi === 0 && (
        <div className="tr-qr tr-qr-bill" data-print-mm="28">
          <UpiQr link={billLink} size={110} />
          <div className="tr-line">{t('seller.billLinkScan')}</div>
        </div>
      )}
      <div className="tr-rule tr-dashed" />

      <div className="tr-foot">
        <div className="tr-thanks">{t('seller.receiptThanks') || 'Dhanyavaad! Phir aaiyega 🙏'}</div>
        {/* Resolved against the shop's plan server-side and carried on /auth/me, so the
            counter slip agrees with the A4 bill without a fetch of its own. Absent on an
            older cached session, which prints it — the Free-plan answer. */}
        {shop?.showAppCredit !== false && <div className="tr-brand">Powered by BillVyse</div>}
      </div>
    </div>,
    document.body
  );
}
