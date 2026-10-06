'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import UpiQr from '../../components/UpiQr';
import PhoneField from '../../components/PhoneField';
import PrinterStatusChip from '../../components/PrinterStatusChip';
import { recordHref } from '../../../lib/routeId';
import { formatRupees } from '../../../lib/format';
import { customerLine } from '../../../lib/customerLabel';
import {
  CheckCircleIcon,
  PrinterIcon,
  ReceiptIcon,
  WhatsappIcon,
  CopyIcon,
  UsersIcon,
  SpinnerIcon,
  CheckIcon,
  XIcon,
} from '../../components/Icons';

/**
 * What the counter sees the moment a table is paid — the same things the billing counter
 * offers after a sale, so a restaurant loses nothing by settling from the floor:
 *
 *   - the bill itself: what was on it, how it was paid, discount / round-off / GST;
 *   - the A4 "professional bill", the printed slip, the customer's own link;
 *   - WhatsApp to the customer, or a number to put on a walk-in's bill first;
 *   - for UPI, the scan-to-pay QR right there, sized for the customer's phone.
 *
 * Print says what happened — "Printing…", then a green "Printed" — because a thermal
 * printer gives no sign on screen and a waiter pressing it again prints the bill twice.
 *
 * Both components render ONE element each.
 */

// cash / upi / card / bank come from the expense-mode labels (the only set that has "bank",
// which a split payment can carry); anything unknown is shown as typed, never as a key.
// Units that only mean "this many" — "× 2 piece" says nothing "× 2" does not. Weight and
// volume (kg, litre) still show.
const COUNT_UNITS = new Set(['pcs', 'pc', 'piece', 'pieces', 'nos', 'no', 'unit', 'units', 'plate', 'plates', 'each']);

function payModeLabel(mode, t) {
  if (mode === 'khata') return t('nav.khata');
  if (mode === 'split') return t('seller.splitPayment');
  const key = `expenses.mode.${mode}`;
  const label = t(key);
  return label && label !== key ? label : String(mode || '');
}

/**
 * The print button with its own outcome. `onPrint` resolves with printSlip's answer:
 * 'direct' (went to the printer), 'system' (the Print screen opened), 'skipped'.
 */
function usePrintState(billId) {
  const [state, setState] = useState('idle');
  useEffect(() => setState('idle'), [billId]);
  return [state, setState];
}

function PrintButton({ state, onClick, t, compact = false }) {
  const done = state === 'printed' || state === 'sent';
  const label = state === 'printing'
    ? t('tables.done.printing')
    : state === 'printed'
      ? t('tables.done.printed')
      : state === 'sent'
        ? t('tables.done.printSent')
        : t('tables.printBill');
  const icon = state === 'printing' ? <SpinnerIcon size={16} /> : done ? <CheckIcon size={16} /> : <PrinterIcon size={16} />;
  if (compact) {
    return (
      <button
        type="button"
        className={`icon-btn print-btn${done ? ' is-done' : ''}${state === 'printing' ? ' is-busy' : ''}`}
        onClick={onClick}
        disabled={state === 'printing'}
        data-tip={done ? `${label} · ${t('tables.done.printAgain')}` : label}
        aria-label={label}
        aria-live="polite"
      >
        {icon}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`btn btn-secondary btn-small print-btn${done ? ' is-done' : ''}${state === 'printing' ? ' is-busy' : ''}`}
      onClick={onClick}
      disabled={state === 'printing'}
      data-tip={done ? t('tables.done.printAgain') : undefined}
      aria-live="polite"
    >
      {icon} {label}
    </button>
  );
}

async function runPrint(setState, onPrint, entry) {
  setState('printing');
  try {
    const outcome = await onPrint(entry);
    setState(outcome === 'direct' ? 'printed' : outcome === 'system' ? 'sent' : 'idle');
  } catch {
    setState('idle');
  }
}

/** Keeps the panel in view the moment a new bill lands on it. */
function useScrollIntoView(ref, key) {
  useEffect(() => {
    if (!key || !ref.current) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // A frame later, so the floor that re-renders under it has its final height.
    const id = requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }));
    return () => cancelAnimationFrame(id);
  }, [key, ref]);
}

export function SettledBill({ entry, t, lang, whatsappOn, onPrint, onSend, onCopyLink, onAttachCustomer, onClose }) {
  const ref = useRef(null);
  const bill = entry.bill;
  const [printState, setPrintState] = usePrintState(bill._id);
  const [capture, setCapture] = useState({ phone: '', name: '', busy: false, error: '' });
  useEffect(() => setCapture({ phone: '', name: '', busy: false, error: '' }), [bill._id]);
  useScrollIntoView(ref, bill._id);

  const payable = bill.payableTotal ?? bill.total;
  const discount = (bill.couponDiscount || 0) + (bill.pointsRedeemedValue || 0) + (bill.billDiscount || 0) + (bill.itemDiscountTotal || 0);
  const phoneDigits = capture.phone.replace(/\D/g, '').slice(-10);

  async function submitCapture(event) {
    event.preventDefault();
    if (capture.busy) return;
    if (phoneDigits.length < 10) {
      setCapture((c) => ({ ...c, error: t('seller.phoneIncomplete') }));
      return;
    }
    setCapture((c) => ({ ...c, busy: true, error: '' }));
    try {
      await onAttachCustomer(capture.phone.trim(), capture.name.trim());
      setCapture({ phone: '', name: '', busy: false, error: '' });
    } catch (err) {
      setCapture((c) => ({ ...c, busy: false, error: err?.message || t('seller.voiceFailed') }));
    }
  }

  return (
    <div
      ref={ref}
      className="panel moment-receipt receipt-result settled-bill"
      style={{ scrollMarginTop: '1rem', position: 'relative' }}
    >
      <span className="moment-burst" aria-hidden="true" />
      <div className="settled-bill__head">
        <h2 className="settled-bill__title">
          <span className="settled-bill__tick"><CheckCircleIcon size={22} className="moment-tick" /></span>
          <span>
            {t('tables.settled', { table: bill.counter, number: bill.billNumber })}
            <small>{t('tables.done.paidBy', { amount: formatRupees(payable, lang), mode: payModeLabel(bill.paymentMode, t) })}</small>
          </span>
        </h2>
        <button type="button" className="icon-btn settled-bill__close" onClick={onClose} data-tip={t('common.close')} aria-label={t('common.close')}>
          <XIcon size={17} />
        </button>
      </div>

      {/* One row of what can be done with the bill — the loudest first. */}
      <div className="settled-bill__actions">
        {whatsappOn && entry.customer?.phone && (
          <button type="button" className="btn btn-primary btn-small settled-bill__primary" onClick={() => onSend(entry)}>
            <WhatsappIcon size={16} /> {t('seller.shareWhatsapp')}
          </button>
        )}
        <PrintButton state={printState} onClick={() => runPrint(setPrintState, onPrint, entry)} t={t} />
        <Link href={recordHref('/seller/invoice/[id]', bill._id)} className="btn btn-secondary btn-small" style={{ textDecoration: 'none' }}>
          <ReceiptIcon size={15} /> {t('seller.professionalBill')}
        </Link>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => onCopyLink(entry)}>
          <CopyIcon size={15} /> {t('tables.done.copyLink')}
        </button>
        <span className="settled-bill__printer"><PrinterStatusChip role="receipt" /></span>
      </div>

      <div className="receipt-result-layout">
        <div className="receipt-result-details">
          {Array.isArray(bill.items) && bill.items.length > 0 && (
            <div className="receipt-result-items">
              <table>
                <tbody>
                  {bill.items.map((item, i) => (
                    <tr key={`${item.name}-${i}`}>
                      <td>
                        {item.name}
                        <span className="settled-bill__qty">× {item.quantity}{item.unit && !COUNT_UNITS.has(String(item.unit).toLowerCase()) ? ` ${item.unit}` : ''}</span>
                      </td>
                      <td className="num">{formatRupees(item.lineTotal ?? (item.price || 0) * (item.quantity || 0), lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="settled-bill__sums">
            {/* A khata bill says what changed hands and what went on the tab — "Khata ₹1,200"
                alone read as all of it owed even when ₹500 was paid at the table. */}
            {bill.paymentMode === 'khata' && (
              <>
                <p className="settled-bill__line">
                  <span>{t('seller.paidNowGot')}</span>
                  <span>{formatRupees(Math.min(Number(bill.amountPaid) || 0, payable), lang)}</span>
                </p>
                <p className="settled-bill__line">
                  <span>{t('seller.paidNowOnKhata')}</span>
                  <strong>{formatRupees(Math.max(0, payable - (Number(bill.amountPaid) || 0)), lang)}</strong>
                </p>
              </>
            )}
            {Array.isArray(bill.payments) && bill.payments.length > 1 && (
              <p className="settled-bill__line">
                {bill.payments.map((p) => `${payModeLabel(p.mode, t)} ${formatRupees(p.amount, lang)}`).join(' · ')}
              </p>
            )}
            {discount > 0 && (
              <p className="settled-bill__line is-good">
                <span>{t('seller.discount')}</span>
                <span>−{formatRupees(discount, lang)}</span>
              </p>
            )}
            {Math.abs(bill.roundOff || 0) >= 0.005 && (
              <p className="settled-bill__line">
                <span>{t('seller.roundOff')}</span>
                <span>{bill.roundOff > 0 ? '+' : '−'}{formatRupees(Math.abs(bill.roundOff), lang)}</span>
              </p>
            )}
            {bill.gstAmount > 0 && (
              <p className="settled-bill__line">
                <span>{t('seller.taxable')} {formatRupees(bill.taxableAmount, lang)} · {t('seller.gst')}</span>
                <span>{formatRupees(bill.gstAmount, lang)}</span>
              </p>
            )}
            {bill.pointsEarned > 0 && (
              <p className="settled-bill__line">
                <span>{t('seller.pointsEarned')}</span>
                <span>{bill.pointsEarned}</span>
              </p>
            )}
          </div>
          <div className="settled-bill__total">
            <span>{t('common.total')}</span>
            <span className="settled-bill__mode">{payModeLabel(bill.paymentMode, t)}</span>
            <strong>{formatRupees(payable, lang)}</strong>
          </div>

          {entry.customer ? (
            <p className="bill-capture-done">
              <CheckCircleIcon size={15} /> {customerLine(entry.customer)}
            </p>
          ) : (
            // Settled as a walk-in (paid by UPI, say) and they want the bill after all: the
            // number goes on the bill here, and the WhatsApp button above appears.
            <form className="bill-capture" onSubmit={submitCapture} noValidate>
              <div className="bill-capture-head">
                <UsersIcon size={16} />
                <div>
                  <strong>{t('seller.captureTitle')}</strong>
                  <small>{t('seller.captureHint')}</small>
                </div>
              </div>
              <div className="bill-capture-fields">
                <PhoneField
                  className="phone-inline"
                  value={capture.phone}
                  onChange={(value) => setCapture((c) => ({ ...c, phone: value, error: '' }))}
                  autoComplete="off"
                  placeholder={t('seller.capturePhonePh')}
                  aria-label={t('seller.capturePhonePh')}
                />
                <input
                  type="text"
                  autoComplete="off"
                  maxLength={60}
                  value={capture.name}
                  onChange={(e) => setCapture((c) => ({ ...c, name: e.target.value }))}
                  placeholder={t('seller.captureNamePh')}
                  aria-label={t('seller.captureNamePh')}
                />
                <button type="submit" className="btn btn-primary btn-small" disabled={capture.busy || phoneDigits.length < 10}>
                  {capture.busy ? t('common.saving') : t('common.save')}
                </button>
              </div>
              {capture.error && <p className="bill-capture-error">{capture.error}</p>}
            </form>
          )}
        </div>

        {bill.paymentMode === 'upi' && (
          entry.upiLink ? (
            <div className="receipt-result-qr settled-bill__qr">
              <p className="settled-bill__qr-hint">{t('seller.scanToPay')}</p>
              <UpiQr key={`${bill._id}:${entry.upiLink}`} link={entry.upiLink} size={180} />
              <strong>{formatRupees(payable, lang)}</strong>
            </div>
          ) : entry.upiLink === null ? (
            <p className="empty-state settled-bill__noqr">{t('seller.upiNotSetHint')}</p>
          ) : null
        )}
      </div>
    </div>
  );
}

function SplitRow({ entry, t, lang, whatsappOn, onPrint, onSend, onCopyLink }) {
  const bill = entry.bill;
  const [printState, setPrintState] = usePrintState(bill._id);
  const label = String(bill.counter || '').split(' · ').slice(1).join(' · ') || bill.counter;
  return (
    <li className="split-bills__row">
      <span className="split-bills__who">
        <strong>{label} <em>#{bill.billNumber}</em></strong>
        <small>
          {payModeLabel(bill.paymentMode, t)}
          {entry.customer ? ` · ${customerLine(entry.customer)}` : ''}
        </small>
      </span>
      <strong className="split-bills__amount">{formatRupees(bill.payableTotal ?? bill.total, lang)}</strong>
      <span className="split-bills__actions">
        {whatsappOn && entry.customer?.phone && (
          <button type="button" className="icon-btn" data-tip={t('wa.sendBill')} aria-label={t('wa.sendBill')} onClick={() => onSend(entry)}>
            <WhatsappIcon size={17} />
          </button>
        )}
        <PrintButton compact state={printState} onClick={() => runPrint(setPrintState, onPrint, entry)} t={t} />
        <Link
          href={recordHref('/seller/invoice/[id]', bill._id)}
          className="icon-btn"
          data-tip={t('seller.professionalBill')}
          aria-label={t('seller.professionalBill')}
        >
          <ReceiptIcon size={17} />
        </Link>
        <button type="button" className="icon-btn" data-tip={t('seller.copyBillLink')} aria-label={t('seller.copyBillLink')} onClick={() => onCopyLink(entry)}>
          <CopyIcon size={17} />
        </button>
      </span>
    </li>
  );
}

export function SplitSettledBills({ entries, t, lang, whatsappOn, onPrint, onSend, onCopyLink, onClose }) {
  const ref = useRef(null);
  useScrollIntoView(ref, entries.map((e) => e.bill._id).join(','));
  const total = entries.reduce((sum, e) => sum + (e.bill.payableTotal ?? e.bill.total ?? 0), 0);
  return (
    <div ref={ref} className="panel moment-receipt settled-bill" style={{ scrollMarginTop: '1rem', position: 'relative' }}>
      <span className="moment-burst" aria-hidden="true" />
      <div className="settled-bill__head">
        <h2 className="settled-bill__title">
          <span className="settled-bill__tick"><CheckCircleIcon size={22} className="moment-tick" /></span>
          <span>
            {t('tables.splitSettled', { table: String(entries[0].bill.counter || '').split(' · ')[0], count: entries.length })}
            <small>{t('tables.done.splitTotal', { amount: formatRupees(total, lang) })}</small>
          </span>
        </h2>
        <button type="button" className="icon-btn settled-bill__close" onClick={onClose} data-tip={t('common.close')} aria-label={t('common.close')}>
          <XIcon size={17} />
        </button>
      </div>
      <ul className="split-bills">
            {entries.map((entry) => (
              <SplitRow
                key={entry.bill._id}
                entry={entry}
                t={t}
                lang={lang}
                whatsappOn={whatsappOn}
                onPrint={onPrint}
                onSend={onSend}
                onCopyLink={onCopyLink}
              />
            ))}
      </ul>
    </div>
  );
}
