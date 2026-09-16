'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { useToast } from './Toast';
import { PlusIcon } from './Icons';
import Modal from './Modal';
import { formatDate } from '../../lib/format';

// The lots one product is actually sitting in: 60 strips bought in March expiring in
// January, next to 40 bought in June expiring the year after. A medical store cannot work
// without this — but neither can a dairy that wants to know which crate goes first — so
// it is opt-in per product rather than a mode the whole shop switches into.
//
// Receiving the first lot is what turns tracking on (see addProductBatch on the server);
// whatever was already on the shelf becomes an explicit "OPENING" batch so the total never
// jumps at the moment tracking begins.

// Same buckets the inventory list uses for product-level expiry, so a red badge means the
// same thing on both screens.
function expiryTone(expiryDate) {
  if (!expiryDate) return { label: null, className: '' };
  const days = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) return { key: 'expired', days: -days, className: 'badge-expired' };
  if (days <= 30) return { key: 'expiring', days, className: 'badge-expiring' };
  return { key: 'safe', days, className: 'badge-safe' };
}

const emptyBatch = { batchNumber: '', expiryDate: '', quantity: '', costPrice: '', mrp: '' };

export default function BatchManager({ product, onClose, onChanged }) {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const [batches, setBatches] = useState([]);
  const [tracking, setTracking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyBatch);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!product) return;
    setLoading(true);
    apiFetch(`/api/seller/products/${product._id}/batches`)
      .then((data) => {
        setBatches(data.batches || []);
        setTracking(Boolean(data.trackBatches));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [product]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleAdd(event) {
    event.preventDefault();
    setError('');
    if (!form.batchNumber.trim()) {
      setError(t('seller.batchNumberRequired'));
      return;
    }
    if (!(Number(form.quantity) > 0)) {
      setError(t('seller.batchQuantityRequired'));
      return;
    }

    setSaving(true);
    try {
      await apiFetch(`/api/seller/products/${product._id}/batches`, {
        method: 'POST',
        body: JSON.stringify({
          batchNumber: form.batchNumber.trim(),
          expiryDate: form.expiryDate || undefined,
          quantity: Number(form.quantity),
          costPrice: form.costPrice === '' ? undefined : Number(form.costPrice),
          mrp: form.mrp === '' ? undefined : Number(form.mrp),
        }),
      });
      toast.success(t('seller.batchAdded'));
      setForm(emptyBatch);
      const data = await apiFetch(`/api/seller/products/${product._id}/batches`);
      setBatches(data.batches || []);
      setTracking(Boolean(data.trackBatches));
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // A write-off (broken, expired, miscounted) has to leave the lot it was actually in —
  // a blanket stock edit could never say which. `patch` also carries corrections to the
  // batch number and expiry; the endpoint always wants a quantity, so it rides along.
  async function handleAdjust(batch, patch) {
    try {
      await apiFetch(`/api/seller/products/${product._id}/batches/${batch._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity: batch.quantity, ...patch }),
      });
      const data = await apiFetch(`/api/seller/products/${product._id}/batches`);
      setBatches(data.batches || []);
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (!product) return null;

  const onShelf = batches.reduce((sum, b) => sum + b.quantity, 0);
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const expiredStock = batches.reduce((sum, batch) => (batch.expiryDate && new Date(batch.expiryDate) < startToday ? sum + batch.quantity : sum), 0);
  const sellableStock = onShelf - expiredStock;

  return (
    <Modal
      as="form"
      onSubmit={handleAdd}
      onClose={onClose}
      title={t('seller.batchesTitle')}
      hint={product.name}
      maxWidth={720}
      footer={
        <>
          <button type="submit" className="btn btn-primary btn-inline" disabled={saving}>
            <PlusIcon size={17} />
            {saving ? t('common.saving') : t('seller.receiveBatch')}
          </button>
          <button type="button" className="btn btn-secondary btn-inline" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </>
      }
    >

        {error && <div className="error-banner">{error}</div>}

        {!tracking && !loading && (
          <p className="field-hint" style={{ marginBottom: '0.8rem' }}>
            {t('seller.batchesNotTrackedHint')}
          </p>
        )}

        {loading ? (
          <p className="empty-state">{t('common.loading')}</p>
        ) : batches.length === 0 ? (
          <p className="empty-state">{t('seller.noBatchesYet')}</p>
        ) : (
          <>
            <div className="table-wrap auto-height" style={{ maxHeight: '300px' }}>
              <table className="data-table" style={{ minWidth: '560px' }}>
                <thead>
                  <tr>
                    <th>{t('seller.batchNumber')}</th>
                    <th>{t('seller.expiryDate')}</th>
                    <th style={{ textAlign: 'right' }}>{t('seller.stock')}</th>
                    <th style={{ textAlign: 'right' }}>{t('seller.costPrice')}</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch, index) => {
                    const tone = expiryTone(batch.expiryDate);
                    return (
                      <tr key={batch._id}>
                        <td>
                          <div className="cell-stack">
                            {/* Editable, and that is not a nicety: batch numbers now also
                                arrive from a photographed purchase bill, where an
                                alphanumeric code is the one thing on the page no
                                arithmetic can cross-check. A received purchase order is
                                frozen by design, so without this there was no way at all
                                to fix a lot number spotted wrong a day later.
                                Bills already sold under the old number keep it — that
                                snapshot is the recall trail. */}
                            <input
                              defaultValue={batch.batchNumber}
                              className="batch-number-input"
                              onBlur={(e) => {
                                const next = e.target.value.trim().toUpperCase();
                                if (!next) {
                                  e.target.value = batch.batchNumber;
                                  return;
                                }
                                if (next !== batch.batchNumber) handleAdjust(batch, { batchNumber: next });
                              }}
                            />
                            {/* The lot the next sale comes out of. Saying so beats making
                                the shopkeeper work out the expiry order themselves. */}
                            {index === 0 && <span className="cell-sub">{t('seller.sellsFirst')}</span>}
                          </div>
                        </td>
                        <td>
                          <div className="cell-stack">
                            <input
                              type="date"
                              defaultValue={batch.expiryDate ? new Date(batch.expiryDate).toISOString().slice(0, 10) : ''}
                              onBlur={(e) => {
                                const current = batch.expiryDate ? new Date(batch.expiryDate).toISOString().slice(0, 10) : '';
                                if (e.target.value !== current) handleAdjust(batch, { expiryDate: e.target.value || null });
                              }}
                              style={{ maxWidth: '150px' }}
                            />
                            {batch.expiryDate && tone.key !== 'safe' && (
                              <span className={`badge ${tone.className}`} style={{ width: 'fit-content' }}>
                                {formatDate(batch.expiryDate, lang)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            defaultValue={batch.quantity}
                            onBlur={(e) => {
                              if (Number(e.target.value) !== batch.quantity) handleAdjust(batch, { quantity: Number(e.target.value) });
                            }}
                            style={{ textAlign: 'right', maxWidth: '90px' }}
                          />
                        </td>
                        <td className="num cell-muted">{batch.costPrice ? `₹${batch.costPrice}` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="field-hint" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <span><strong>Available to sell:</strong> {sellableStock} {product.unit}</span>
              <span>On shelf: {onShelf} {product.unit}</span>
              {expiredStock > 0 && <span style={{ color: 'var(--danger)' }}>Expired: {expiredStock} {product.unit}</span>}
            </div>
          </>
        )}

        <div style={{ marginTop: '0.9rem' }}>
          <h3 style={{ fontSize: 'var(--fs-md)', marginBottom: '0.5rem' }}>{t('seller.receiveBatch')}</h3>
          <div className="form-grid">
            <div className="field">
              <label>{t('seller.batchNumber')}</label>
              <input value={form.batchNumber} onChange={update('batchNumber')} placeholder="J4821" />
            </div>
            <div className="field">
              <label>{t('seller.expiryDate')}</label>
              <input type="date" value={form.expiryDate} onChange={update('expiryDate')} />
            </div>
            <div className="field">
              <label>{t('seller.quantity')}</label>
              <input type="number" min="0" step="0.001" value={form.quantity} onChange={update('quantity')} placeholder="0" />
            </div>
            <div className="field">
              <label>{t('seller.costPrice')}</label>
              <input type="number" min="0" step="0.01" value={form.costPrice} onChange={update('costPrice')} placeholder="0" />
            </div>
          </div>
        </div>
    </Modal>
  );
}
