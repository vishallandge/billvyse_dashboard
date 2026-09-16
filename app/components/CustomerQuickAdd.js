'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { formatRupees } from '../../lib/format';
import Modal from './Modal';
import PhoneField from './PhoneField';

/**
 * Adding a customer without leaving the screen that needs one.
 *
 * The sibling of SupplierQuickAdd, and it exists for the same reason spelled out there: a
 * form that refuses to save without a customer, and no way to get one except a link that
 * unmounts the form. On a repeating bill or a standing order that is not an inconvenience,
 * it is a dead end — a brand-new shop has no customers at all, so its very first attempt at
 * "har mahine ka bill" meets an empty dropdown and a Save button that will not press.
 *
 * This project already wrote that rule down after an audit: never gate a create screen on
 * the thing it creates.
 *
 * TWO FIELDS, deliberately. A customer needs a name to be findable and a number to be
 * reachable, and that is all this moment requires — the counter has somebody standing in
 * front of it. Address, GSTIN, credit limit and opening balance live on the full form on the
 * khata screen, where the shopkeeper is thinking about the customer rather than about the
 * bill in his hand.
 *
 * It posts to the KHATA API, never to a second endpoint of its own. That is the whole point
 * of a shared component here: one code path means one set of duplicate-phone rules. Two
 * paths would eventually disagree, and the shape that failure takes is two Ramesh Sharmas
 * with half the udhaar on each — which this app has already had to build a merge tool for.
 */
export default function CustomerQuickAdd({ prefill = null, onClose, onCreated }) {
  const { t, lang } = useLanguage();
  const [form, setForm] = useState({
    name: prefill?.name || '',
    phone: prefill?.phone || '',
  });
  const [error, setError] = useState('');
  const [badField, setBadField] = useState('');
  const [saving, setSaving] = useState(false);
  /**
   * The customer already on this number.
   *
   * Held rather than thrown, because the honest answer is a question. The overwhelmingly
   * common case is that it IS them — the shopkeeper simply did not know they were already in
   * the book — and the right move is to use that record, not to make a twin. Unlike a
   * supplier there is no "save separately" here: two rows for one person split their khata
   * into two balances and neither one is what they owe.
   */
  const [duplicate, setDuplicate] = useState(null);

  function update(field) {
    return (e) => {
      setForm((f) => ({ ...f, [field]: e.target.value }));
      if (badField === field) setBadField('');
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      setBadField('name');
      setError(t('customerAdd.nameNeeded'));
      return;
    }
    setError('');
    setBadField('');
    setSaving(true);
    try {
      const { customer } = await apiFetch('/api/seller/khata/customers', {
        method: 'POST',
        body: JSON.stringify({ name: form.name.trim(), phone: form.phone.trim() }),
      });
      onCreated?.(customer);
      onClose?.();
    } catch (err) {
      // The server answers 409 with the customer that already holds the number, by name —
      // "already exists" without a name leaves the shopkeeper hunting a list to find out
      // whose number it is.
      if (err.data?.existingCustomer) {
        setDuplicate(err.data.existingCustomer);
      } else {
        setBadField(err.data?.field || '');
        setError(err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  if (duplicate) {
    return (
      <Modal
        onClose={onClose}
        title={t('customerAdd.duplicateTitle')}
        hint={t('customerAdd.duplicateHint', { phone: duplicate.phone || form.phone })}
        maxWidth={480}
        footer={
          <>
            <button
              type="button"
              className="btn btn-primary btn-inline"
              onClick={() => {
                onCreated?.(duplicate);
                onClose?.();
              }}
            >
              {t('customerAdd.useExisting', { name: duplicate.name })}
            </button>
            <button type="button" className="btn btn-secondary btn-inline" onClick={() => setDuplicate(null)}>
              {t('customerAdd.changeNumber')}
            </button>
          </>
        }
      >
        <div className="quick-add-dupe">
          <strong>{duplicate.name}</strong>
          <span className="cell-sub">
            {t('customerAdd.duplicateBalance', { amount: formatRupees(duplicate.balance || 0, lang) })}
          </span>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      as="form"
      onSubmit={handleSubmit}
      onClose={onClose}
      title={t('customerAdd.title')}
      hint={t('customerAdd.hint')}
      maxWidth={440}
      footer={
        <>
          <button type="submit" className="btn btn-primary btn-inline" disabled={saving}>
            {saving ? t('common.saving') : t('customerAdd.save')}
          </button>
          <button type="button" className="btn btn-secondary btn-inline" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
      {error && <div className="error-banner">{error}</div>}
      <div className="form-grid">
        <div className={`field${badField === 'name' ? ' has-error' : ''}`}>
          <label htmlFor="cqa-name">{t('customerAdd.name')}</label>
          <input id="cqa-name" value={form.name} onChange={update('name')} required autoFocus maxLength={80} />
        </div>
        {/* Required by the server, and said here rather than discovered on Save: a khata
            customer with no number cannot be sent a reminder, which is most of what a khata
            is for. */}
        <PhoneField
          id="cqa-phone"
          label={t('common.phone')}
          value={form.phone}
          onChange={(value) => {
            setForm((f) => ({ ...f, phone: value }));
            if (badField === 'phone') setBadField('');
          }}
          hint={t('customerAdd.phoneHint')}
          className={badField === 'phone' ? 'has-error' : ''}
        />
      </div>
      <p className="field-hint">{t('customerAdd.moreHint')}</p>
    </Modal>
  );
}
