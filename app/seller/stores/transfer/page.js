'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../lib/api';
import { useLanguage } from '../../../components/LanguageProvider';
import { SkeletonTable } from '../../../components/Skeleton';
import Dropdown from '../../../components/Dropdown';

const emptyForm = { productId: '', fromStoreId: '', toStoreId: '', quantity: '', note: '' };

export default function StockTransferPage() {
  const { t } = useLanguage();
  const [stores, setStores] = useState([]);
  const [products, setProducts] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // Per-store quantity for whichever product is picked — without this the form had no way
  // to say what's actually available to move, and a shortfall only surfaced after submit
  // as a generic "Insufficient stock" error.
  const [productStores, setProductStores] = useState(null);
  const [productStoresLoading, setProductStoresLoading] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      apiFetch('/api/seller/stores'),
      apiFetch('/api/seller/products'),
      apiFetch('/api/seller/stores/transfers'),
    ])
      .then(([storeData, productData, transferData]) => {
        setStores(storeData.stores);
        setProducts(productData.products);
        setTransfers(transferData.transfers);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  useEffect(() => {
    if (!form.productId) {
      setProductStores(null);
      return;
    }
    let active = true;
    setProductStoresLoading(true);
    apiFetch(`/api/seller/products/${form.productId}`)
      .then((data) => {
        if (active) setProductStores(data.stores || []);
      })
      .catch(() => {
        if (active) setProductStores(null);
      })
      .finally(() => {
        if (active) setProductStoresLoading(false);
      });
    return () => {
      active = false;
    };
  }, [form.productId]);

  function quantityAtStore(storeId) {
    if (!productStores || !storeId) return null;
    const row = productStores.find((s) => s.id === storeId);
    return row ? row.quantity : 0;
  }

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  // Dropdown hands back a value directly instead of an event.
  function setField(field) {
    return (value) => setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.productId || !form.fromStoreId || !form.toStoreId) {
      setError(t('seller.fillAllFields'));
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await apiFetch('/api/seller/stores/transfers', {
        method: 'POST',
        body: JSON.stringify({ ...form, quantity: Number(form.quantity) }),
      });
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="content-header">
        <h1>{t('seller.transferTitle')}</h1>
        <p>{t('seller.transferSubtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="field">
              <label>{t('seller.productName')}</label>
              <Dropdown
                value={form.productId}
                onChange={setField('productId')}
                options={[{ value: '', label: '—' }, ...products.map((p) => ({ value: p._id, label: p.name }))]}
              />
            </div>
            <div className="field">
              <label>{t('seller.fromStore')}</label>
              <Dropdown
                value={form.fromStoreId}
                onChange={setField('fromStoreId')}
                options={[
                  { value: '', label: '—' },
                  ...stores.map((s) => {
                    const qty = quantityAtStore(s._id);
                    const product = products.find((p) => p._id === form.productId);
                    return {
                      value: s._id,
                      label: form.productId && qty !== null ? `${s.name} (${qty} ${product?.unit || ''})` : s.name,
                    };
                  }),
                ]}
              />
              {form.productId && form.fromStoreId && !productStoresLoading && (
                <p className="field-hint">
                  {t('seller.available')}: {quantityAtStore(form.fromStoreId)}{' '}
                  {products.find((p) => p._id === form.productId)?.unit || ''}
                </p>
              )}
            </div>
            <div className="field">
              <label>{t('seller.toStore')}</label>
              <Dropdown
                value={form.toStoreId}
                onChange={setField('toStoreId')}
                options={[{ value: '', label: '—' }, ...stores.filter((s) => s._id !== form.fromStoreId).map((s) => ({ value: s._id, label: s.name }))]}
              />
            </div>
            <div className="field">
              <label>{t('seller.quantity')}</label>
              <input type="number" min="0.001" step="0.001" value={form.quantity} onChange={update('quantity')} required />
              {form.fromStoreId &&
                form.quantity &&
                quantityAtStore(form.fromStoreId) !== null &&
                Number(form.quantity) > quantityAtStore(form.fromStoreId) && (
                  <p className="field-hint field-hint-warn">{t('seller.exceedsAvailableStock')}</p>
                )}
            </div>
            <div className="field">
              <label>{t('seller.note')}</label>
              <input value={form.note} onChange={update('note')} />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: 'auto', marginTop: '0.5rem' }} disabled={submitting}>
            {t('seller.transfer')}
          </button>
        </form>
      </div>

      <div className="panel">
        <h2>{t('seller.transferHistory')}</h2>
        {loading ? (
          <SkeletonTable rows={4} cols={5} />
        ) : transfers.length === 0 ? (
          <p className="empty-state">{t('seller.noAdjustments')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('seller.productName')}</th>
                <th>{t('seller.fromStore')}</th>
                <th>{t('seller.toStore')}</th>
                <th className="num" style={{ width: '8rem' }}>{t('seller.quantity')}</th>
                <th>{t('seller.note')}</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((tr) => (
                <tr key={tr._id}>
                  <td>{tr.product?.name}</td>
                  <td>{tr.fromStore?.name}</td>
                  <td>{tr.toStore?.name}</td>
                  <td className="num">{tr.quantity} {tr.product?.unit}</td>
                  <td>{tr.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
