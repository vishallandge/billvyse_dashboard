'use client';

import { useMemo, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatRupees, toDateInput } from '../../../lib/format';
import { purchaseTotals, hasAnyCharge } from '../../../lib/purchaseTotals';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { PlusIcon, TrashIcon, PrinterIcon } from '../../components/Icons';
import { recordHref } from '../../../lib/routeId';

/**
 * The wholesaler makes his own bill against the order — the reason this module exists.
 *
 * A supplier screen that shows an order and cannot answer it with a bill is a notice board.
 * This is the one thing he actually came to do, so it lives here rather than behind a link
 * to another app.
 *
 * Pre-filled from what the shop ordered, because that is what a bill against an order almost
 * always is: he corrects the two rows he could not fully supply, puts his own bill number on
 * it, and sends. A blank form gets filled once and never again.
 *
 * **The money is not computed here.** Every rupee comes from `lib/purchaseTotals`, the same
 * mirror the shop's own purchase form totals with, which in turn mirrors
 * backend/utils/purchaseTotals.js. That is deliberate to the point of being the rule: this
 * bill is settled across a table with the shopkeeper's screen open next to his, and a total
 * that differs by a rupee between the two is the worst thing this feature could do. The
 * server recomputes on save and its answer is the one stored — if the two ever disagree, the
 * server is right and this preview is the bug.
 */

const EMPTY_LINE = {
  name: '',
  unit: '',
  quantity: '',
  freeQuantity: '',
  costPrice: '',
  discountPercent: '',
  gstRate: '',
  mrp: '',
  batchNumber: '',
};

const EMPTY_CHARGES = {
  lineDiscount: '',
  cashDiscountPercent: '',
  freight: '',
  otherCharges: '',
  roundOff: '',
};

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * The rows he starts from: his own saved bill if he has already made one, otherwise the
 * shop's order lines.
 */
function linesFromOrder(order) {
  const source = order.bill?.lines?.length ? order.bill.lines : order.items || [];
  return source.map((item) => ({
    ...EMPTY_LINE,
    name: item.name || '',
    unit: item.unit || '',
    quantity: String(item.quantity ?? ''),
    freeQuantity: item.freeQuantity ? String(item.freeQuantity) : '',
    costPrice: String(item.costPrice ?? ''),
    discountPercent: item.discountPercent ? String(item.discountPercent) : '',
    gstRate: item.gstRate ? String(item.gstRate) : '',
    mrp: item.mrp ? String(item.mrp) : '',
    batchNumber: item.batchNumber || '',
  }));
}

export default function SupplyBillBuilder({ order, onSaved, onClose }) {
  const { t, lang } = useLanguage();
  const toast = useToast();

  const [lines, setLines] = useState(() => linesFromOrder(order));
  const [number, setNumber] = useState(order.bill?.number || '');
  const [date, setDate] = useState(toDateInput(order.bill?.date || new Date()));
  const [charges, setCharges] = useState(() => ({
    ...EMPTY_CHARGES,
    ...(order.bill?.charges
      ? {
          lineDiscount: order.bill.charges.lineDiscount || '',
          cashDiscountPercent: order.bill.charges.cashDiscountPercent || '',
          freight: order.bill.charges.freight || '',
          otherCharges: order.bill.charges.otherCharges || '',
          roundOff: order.bill.charges.roundOff || '',
        }
      : {}),
  }));
  const [note, setNote] = useState(order.bill?.note || '');
  const [showCharges, setShowCharges] = useState(() => hasAnyCharge(order.bill?.charges));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The GST split follows the order's own frozen place of supply, never anything typed here —
  // whether a purchase is inter-state was decided when the order was raised.
  const totals = useMemo(
    () => purchaseTotals(lines, charges, { interState: Boolean(order.isInterState) }),
    [lines, charges, order.isInterState]
  );
  // What the shopkeeper will see the moment this lands: the whole point of showing it here is
  // that a difference he did not intend gets caught before he sends it, not after.
  const difference = Number((totals.totalAmount - (order.total || 0)).toFixed(2));

  function updateLine(index, key, value) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  }

  async function save() {
    if (!number.trim()) {
      setError(t('supply.billNeedNumber'));
      return;
    }
    const payload = lines.filter((line) => line.name.trim() && num(line.quantity) > 0);
    if (payload.length === 0) {
      setError(t('supply.billNeedLines'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await apiFetch(`/api/seller/supply/orders/${order.id}/bill`, {
        method: 'PUT',
        body: JSON.stringify({
          number: number.trim(),
          date,
          note: note.trim() || undefined,
          charges: {
            lineDiscount: num(charges.lineDiscount),
            cashDiscountPercent: num(charges.cashDiscountPercent),
            freight: num(charges.freight),
            otherCharges: num(charges.otherCharges),
            roundOff: Number(charges.roundOff) || 0,
          },
          lines: payload.map((line) => ({
            name: line.name.trim(),
            unit: line.unit.trim(),
            quantity: num(line.quantity),
            freeQuantity: num(line.freeQuantity),
            costPrice: num(line.costPrice),
            discountPercent: num(line.discountPercent),
            gstRate: num(line.gstRate),
            mrp: num(line.mrp),
            batchNumber: line.batchNumber.trim() || undefined,
          })),
        }),
      });
      toast.success(t('supply.billSent'));
      onSaved(data.bill);
    } catch (err) {
      setError(err.code === 'BILL_LOCKED' ? t('supply.billLocked') : err.message);
    } finally {
      setBusy(false);
    }
  }


  return (
    <div className="supply-bill">
      <div className="form-grid cols-2">
        <label className="field">
          <span className="field-label">{t('supply.billNumber')}</span>
          <input className="input" value={number} maxLength={40} onChange={(e) => setNumber(e.target.value)} placeholder="INV-1042" />
          <span className="field-hint">{t('supply.billNumberHint')}</span>
        </label>
        <label className="field">
          <span className="field-label">{t('supply.billDate')}</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      <div className="data-panel">
            <div className="table-wrap auto-height">
        {/* Eight editable cells and none of them optional, so the honest minimum is stated
            and the wrapper scrolls. Below 900px the app freezes the first column, so the
            item name stays put while the rates scroll past it. */}
        <table className="data-table supply-bill-table" style={{ minWidth: '820px' }}>
          <thead>
            <tr>
              <th>{t('supply.item')}</th>
              <th className="num">{t('supply.qty')}</th>
              <th className="num">{t('supply.free')}</th>
              <th className="num">{t('supply.rate')}</th>
              <th className="num">{t('supply.discPc')}</th>
              <th className="num">{t('supply.gstPc')}</th>
              <th className="num">{t('seller.total')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index}>
                <td>
                  <input className="input" value={line.name} onChange={(e) => updateLine(index, 'name', e.target.value)} />
                  <div className="supply-bill-sub">
                    <input
                      className="input"
                      value={line.unit}
                      placeholder={t('supply.unit')}
                      onChange={(e) => updateLine(index, 'unit', e.target.value)}
                    />
                    <input
                      className="input"
                      value={line.batchNumber}
                      placeholder={t('supply.batch')}
                      onChange={(e) => updateLine(index, 'batchNumber', e.target.value)}
                    />
                  </div>
                </td>
                <td className="num"><NumCell value={line.quantity} onChange={(v) => updateLine(index, 'quantity', v)} /></td>
                {/* Free units are never folded into the charged quantity — the shop is
                    receiving them and not paying for them, and rolling the two together is
                    how a scheme silently becomes a price cut. */}
                <td className="num"><NumCell value={line.freeQuantity} onChange={(v) => updateLine(index, 'freeQuantity', v)} /></td>
                <td className="num"><NumCell value={line.costPrice} onChange={(v) => updateLine(index, 'costPrice', v)} /></td>
                <td className="num"><NumCell value={line.discountPercent} onChange={(v) => updateLine(index, 'discountPercent', v)} /></td>
                <td className="num"><NumCell value={line.gstRate} onChange={(v) => updateLine(index, 'gstRate', v)} /></td>
                <td className="num cell-strong">
                  {formatRupees(num(line.quantity) * num(line.costPrice) * (1 - Math.min(100, num(line.discountPercent)) / 100), lang)}
                </td>
                <td className="num">
                  <button
                    type="button"
                    className="icon-btn danger"
                    data-tip={t('common.delete')}
                    onClick={() => setLines((c) => c.filter((_, i) => i !== index))}
                  >
                    <TrashIcon size={17} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="row-actions">
        <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => setLines((c) => [...c, { ...EMPTY_LINE }])}>
          <PlusIcon size={15} /> {t('supply.addLine')}
        </button>
        <button type="button" className="link-btn" onClick={() => setShowCharges((v) => !v)}>
          {showCharges ? t('supply.hideCharges') : t('supply.showCharges')}
        </button>
      </div>

      {/* Bill-level charges are held apart from the rates rather than spread back across
          them, so every line still reads exactly as it does on his own paper. */}
      {showCharges && (
        <div className="form-grid cols-2">
          <ChargeField label={t('supply.lineDiscount')} value={charges.lineDiscount} onChange={(v) => setCharges((c) => ({ ...c, lineDiscount: v }))} />
          <ChargeField label={t('supply.cashDiscountPc')} value={charges.cashDiscountPercent} onChange={(v) => setCharges((c) => ({ ...c, cashDiscountPercent: v }))} />
          <ChargeField label={t('supply.freight')} value={charges.freight} onChange={(v) => setCharges((c) => ({ ...c, freight: v }))} />
          <ChargeField label={t('supply.otherCharges')} value={charges.otherCharges} onChange={(v) => setCharges((c) => ({ ...c, otherCharges: v }))} />
          <ChargeField label={t('supply.roundOff')} value={charges.roundOff} onChange={(v) => setCharges((c) => ({ ...c, roundOff: v }))} signed />
        </div>
      )}

      <label className="field">
        <span className="field-label">{t('supply.billNote')}</span>
        <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </label>

      <div className="supply-bill-totals">
        <Row label={t('supply.gross')} value={formatRupees(totals.grossAmount, lang)} />
        {totals.lessTotal > 0 && <Row label={t('supply.less')} value={`− ${formatRupees(totals.lessTotal, lang)}`} />}
        {totals.addTotal > 0 && <Row label={t('supply.add')} value={`+ ${formatRupees(totals.addTotal, lang)}`} />}
        <Row label={t('supply.taxable')} value={formatRupees(totals.taxableAmount, lang)} />
        {totals.isInterState ? (
          <Row label={t('supply.igst')} value={formatRupees(totals.igstAmount, lang)} />
        ) : (
          <>
            <Row label={t('supply.cgst')} value={formatRupees(totals.cgstAmount, lang)} />
            <Row label={t('supply.sgst')} value={formatRupees(totals.sgstAmount, lang)} />
          </>
        )}
        <Row label={t('supply.billTotal')} value={formatRupees(totals.totalAmount, lang)} strong />
        {/* Stated as a consequence, not a number: "he has billed ₹340 more than we ordered"
            is what the shopkeeper is about to say, and he should hear it from his own screen
            first. */}
        {Math.abs(difference) >= 0.01 && (
          <p className={`supply-bill-diff ${difference > 0 ? 'is-over' : 'is-under'}`}>
            {t(difference > 0 ? 'supply.billOver' : 'supply.billUnder', {
              amount: formatRupees(Math.abs(difference), lang),
            })}
          </p>
        )}
      </div>

      {error && <p className="field-error-text">{error}</p>}

      <div className="row-actions">
        <button type="button" className="btn btn-primary btn-small btn-inline" disabled={busy} onClick={save}>
          {busy ? t('common.saving') : order.bill?.submittedAt ? t('supply.billUpdate') : t('supply.billSend')}
        </button>
        {/* The bill as paper, on the app's own invoice sheet — `SupplierBillDocument`, the
            same document the shop already prints from its side of this order. It replaced a
            server-drawn PDF whose totals block printed the amounts on top of their own
            labels; the app had an invoice all along and this screen was not using it. */}
        {order.bill?.submittedAt && (
          <a
            className="btn btn-secondary btn-small btn-inline"
            href={recordHref('/seller/supply/[id]/bill', order.id)}
            target="_blank"
            rel="noopener"
          >
            <PrinterIcon size={15} /> {t('supply.billPdf')}
          </a>
        )}
        <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={onClose}>
          {t('common.goBack')}
        </button>
      </div>
    </div>
  );
}

function NumCell({ value, onChange }) {
  return (
    <input
      className="input supply-bill-num"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
    />
  );
}

function ChargeField({ label, value, onChange, signed = false }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className="input"
        inputMode="decimal"
        value={value}
        // Round-off is the one that goes both ways — a bill rounds up as often as down.
        onChange={(e) => onChange(e.target.value.replace(signed ? /[^\d.-]/g : /[^\d.]/g, ''))}
      />
    </label>
  );
}

function Row({ label, value, strong }) {
  return (
    <div className={`supply-bill-row${strong ? ' is-strong' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
