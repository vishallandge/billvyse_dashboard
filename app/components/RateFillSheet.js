'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { formatRupees } from '../../lib/format';
import { useLanguage } from './LanguageProvider';
import Modal from './Modal';

/**
 * The rates, entered at the counter with the delivery van still outside.
 *
 * An order is placed with quantities and no rates — that is the normal shape of one (see
 * buildItems). Receiving needs them, because the rate goes into the product's cost, the
 * batch ledger and the shop's udhaar, and a zero there quietly reports 100% margin forever.
 * So the server refuses to receive while any line is still blank, and this is where the
 * shopkeeper fills them in.
 *
 * Deliberately not the full edit form. At this moment he is holding a bill and a crate and
 * has one job: copy across the numbers on the paper. Every other field on the order would be
 * something else to scroll past.
 */
export default function RateFillSheet({ order, onClose, onFilled }) {
  const { t, lang } = useLanguage();

  // Only the lines actually waiting. A twenty-line order where three rates are missing shows
  // three rows, not twenty.
  const pending = (order.items || []).filter((item) => item.rateUnknown);
  const [rates, setRates] = useState(() => Object.fromEntries(pending.map((_, i) => [i, ''])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const allFilled = pending.every((_, i) => rates[i] !== '' && Number(rates[i]) >= 0);

  async function save() {
    setSaving(true);
    setError('');
    try {
      // The whole item list is sent back, because that is what the edit endpoint takes — the
      // untouched lines carry their existing rates and come back unchanged.
      let pendingIndex = 0;
      const items = (order.items || []).map((item) => {
        const base = {
          productId: item.product || undefined,
          name: item.name,
          unit: item.unit,
          quantity: item.quantity,
          freeQuantity: item.freeQuantity || undefined,
          discountPercent: item.discountPercent || undefined,
          gstRate: item.gstRate,
          hsnCode: item.hsnCode || undefined,
          mrp: item.mrp || undefined,
          batchNumber: item.batchNumber || undefined,
          expiryDate: item.expiryDate || undefined,
          packLabel: item.packLabel || undefined,
        };
        if (!item.rateUnknown) return { ...base, costPrice: item.costPrice };
        const typed = rates[pendingIndex];
        pendingIndex += 1;
        return { ...base, costPrice: typed === '' ? null : Number(typed) };
      });

      await apiFetch(`/api/seller/suppliers/purchase-orders/${order._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ items }),
      });
      // Handed back so the caller can retry the receive it was in the middle of, rather than
      // making the shopkeeper find the button again.
      onFilled();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      title={t('purchase.fillRatesTitle')}
      hint={t('purchase.fillRatesHint', { label: order.label })}
      maxWidth={540}
      footer={
        <>
          <button type="button" className="btn btn-primary btn-inline" disabled={saving || !allFilled} onClick={save}>
            {saving ? t('common.saving') : t('purchase.saveRatesAndReceive')}
          </button>
          <button type="button" className="btn btn-secondary btn-inline" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </>
      }
    >

        <div className="table-wrap auto-height">
          <table className="data-table" style={{ minWidth: '440px' }}>
            <thead>
              <tr>
                <th>{t('seller.productName')}</th>
                <th className="num">{t('seller.quantity')}</th>
                <th className="num">{t('purchase.rate')}</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((item, index) => (
                <tr key={`${item.name}-${index}`}>
                  <td className="cell-strong">{item.name}</td>
                  <td className="num">
                    {item.quantity} {item.unit}
                    {item.freeQuantity > 0 && <span className="cell-sub">+{item.freeQuantity} free</span>}
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={rates[index]}
                      onChange={(e) => setRates((r) => ({ ...r, [index]: e.target.value }))}
                      style={{ maxWidth: '7rem' }}
                      autoFocus={index === 0}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Said plainly, because the alternative — leaving them blank to "fix later" — is
            the thing that silently destroys the shop's margin reporting. */}
        <p className="field-hint">{t('purchase.fillRatesWhy')}</p>

        {error && <div className="error-banner">{error}</div>}

        {!allFilled && <p className="field-hint">{t('purchase.fillAllRates', { count: pending.length })}</p>}
    </Modal>
  );
}
