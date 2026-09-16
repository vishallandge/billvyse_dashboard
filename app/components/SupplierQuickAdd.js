'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { formatRupees } from '../../lib/format';
import Modal from './Modal';
import PhoneField from './PhoneField';
import AddressField from './AddressField';
import { addressErrorText, cleanAddressText, PARTY_NAME_MAX } from '../../lib/addressRules';

/**
 * Adding a wholesaler without leaving the screen that needs him.
 *
 * The purchase form refuses to save without a supplier, and until this existed the only
 * way to get one was a link to the suppliers page — which unmounts the form. On an order
 * typed by hand that costs a minute. On an order read off a photographed bill it throws
 * away twenty lines, six batch numbers and an AI scan the shop paid for, because the bill
 * came from a wholesaler who happened not to be in the list yet. That is the entire reason
 * this component exists: a new supplier must never cost the work already on screen.
 *
 * Deliberately the SHORT form — the six things a bill actually prints. Opening balance,
 * UPI ID, email and credit terms all live on the full form on the suppliers page, where
 * the shopkeeper is thinking about the wholesaler rather than about the load in front of
 * him.
 *
 * `prefill` is whatever the bill gave up. Every field stays editable: a name read off a
 * letterhead is a transcription, and this is the last point before it becomes a permanent
 * record that the rest of the shop's purchase history will hang off.
 */
export default function SupplierQuickAdd({ prefill = null, fromBill = false, onClose, onCreated }) {
  const { t, lang } = useLanguage();
  const [form, setForm] = useState({
    name: prefill?.name || prefill?.company || '',
    phone: prefill?.phone || '',
    company: prefill?.company || '',
    gstin: prefill?.gstin || '',
    address: prefill?.address || '',
    paymentTermDays: '',
  });
  const [error, setError] = useState('');
  const [badField, setBadField] = useState('');
  // The address box's own verdict. The server refuses the same thing (its addressRules
  // is the file dashboard/lib/addressRules.js mirrors) — this is so the sentence lands
  // next to the box instead of arriving as a banner after a round trip.
  const [addrProblem, setAddrProblem] = useState(null);
  const [showAddrErrors, setShowAddrErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  // The wholesaler already on this phone number. Held rather than thrown, because the
  // honest answer is a question: usually it is the same firm under a slightly different
  // name, and occasionally two branches really do share a number.
  const [duplicate, setDuplicate] = useState(null);

  function update(field) {
    return (e) => {
      const value = field === 'gstin' ? e.target.value.toUpperCase() : e.target.value;
      setForm((f) => ({ ...f, [field]: value }));
      if (badField === field) setBadField('');
    };
  }

  async function save(allowDuplicatePhone = false) {
    setError('');
    setBadField('');
    if (addrProblem) {
      setShowAddrErrors(true);
      setError(addressErrorText(addrProblem.code, t));
      return;
    }
    setSaving(true);
    try {
      const { supplier } = await apiFetch('/api/seller/suppliers', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim() || undefined,
          company: form.company.trim() || undefined,
          gstin: form.gstin.trim() || undefined,
          address: form.address.trim() || undefined,
          paymentTermDays: form.paymentTermDays ? Number(form.paymentTermDays) : undefined,
          allowDuplicatePhone: allowDuplicatePhone || undefined,
        }),
      });
      onCreated?.(supplier);
      onClose?.();
    } catch (err) {
      if (err.code === 'DUPLICATE_SUPPLIER_PHONE' && err.data?.duplicate) {
        setDuplicate(err.data.duplicate);
      } else {
        setBadField(err.data?.field || '');
        setError(err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      setBadField('name');
      setError(t('supplierAdd.nameNeeded'));
      return;
    }
    save(false);
  }

  // The number already belongs to somebody. Answering "that's him" is the right answer far
  // more often than making a second record, so it is the primary button — a wholesaler
  // split across two rows splits his udhaar across two balances and neither is true.
  if (duplicate) {
    return (
      <Modal
        onClose={onClose}
        title={t('supplierAdd.duplicateTitle')}
        hint={t('supplierAdd.duplicateHint', { phone: duplicate.phone || form.phone })}
        maxWidth={480}
        footer={
          <>
            <button
              type="button"
              className="btn btn-primary btn-inline"
              onClick={() => {
                onCreated?.({ _id: duplicate.id, name: duplicate.name, company: duplicate.company, phone: duplicate.phone });
                onClose?.();
              }}
            >
              {t('supplierAdd.useExisting', { name: duplicate.name })}
            </button>
            <button type="button" className="btn btn-secondary btn-inline" disabled={saving} onClick={() => save(true)}>
              {saving ? t('common.saving') : t('supplierAdd.saveSeparate')}
            </button>
          </>
        }
      >
        <div className="quick-add-dupe">
          <strong>{duplicate.name}</strong>
          {duplicate.company && <span className="cell-sub">{duplicate.company}</span>}
          <span className="cell-sub">
            {t('supplierAdd.duplicateBalance', { amount: formatRupees(duplicate.balance || 0, lang) })}
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
      title={t('supplierAdd.title')}
      hint={fromBill ? t('supplierAdd.fromBillHint') : t('supplierAdd.hint')}
      maxWidth={560}
      footer={
        <>
          <button type="submit" className="btn btn-primary btn-inline" disabled={saving}>
            {saving ? t('common.saving') : t('supplierAdd.save')}
          </button>
          <button type="button" className="btn btn-secondary btn-inline" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
      {error && <div className="error-banner">{error}</div>}
      <div className="form-grid cols-2">
        <div className={`field field-span2${badField === 'name' ? ' has-error' : ''}`}>
          <label htmlFor="sqa-name">{t('supplierAdd.name')}</label>
          <input id="sqa-name" value={form.name} onChange={update('name')} required autoFocus />
        </div>
        {/* Not required, and said so: half the bills a shop takes in are from a firm whose
            number nobody ever wrote down. A supplier with no phone still keeps a ledger. */}
        <PhoneField
          id="sqa-phone"
          label={t('common.phone')}
          value={form.phone}
          onChange={(value) => {
            setForm((f) => ({ ...f, phone: value }));
            if (badField === 'phone') setBadField('');
          }}
          hint={t('supplierAdd.phoneHint')}
          className={badField === 'phone' ? 'has-error' : ''}
        />
        <div className="field">
          <label htmlFor="sqa-company">{t('supplierAdd.company')}</label>
          {/* The firm name that heads a debit note raised against this wholesaler, so it
              is cleaned on the way in like every other name on a document. */}
          <input
            id="sqa-company"
            value={form.company}
            onChange={(e) => setForm((f) => ({ ...f, company: cleanAddressText(e.target.value, PARTY_NAME_MAX) }))}
          />
        </div>
        <div className={`field${badField === 'gstin' ? ' has-error' : ''}`}>
          <label htmlFor="sqa-gstin">{t('supplierAdd.gstin')}</label>
          <input id="sqa-gstin" value={form.gstin} onChange={update('gstin')} maxLength={15} placeholder="27ABCDE1234F1Z5" />
          {/* The one field worth chasing: without the wholesaler's GSTIN this shop cannot
              claim the input credit on anything he sells it. */}
          <span className="field-hint">{t('supplierAdd.gstinHint')}</span>
        </div>
        <div className="field">
          <label htmlFor="sqa-terms">{t('supplierAdd.paymentTermDays')}</label>
          <input
            id="sqa-terms"
            type="number"
            min="0"
            step="1"
            value={form.paymentTermDays}
            onChange={update('paymentTermDays')}
            placeholder="0"
          />
          <span className="field-hint">{t('supplierAdd.paymentTermHint')}</span>
        </div>
        <AddressField
          id="sqa-address"
          label={t('supplierAdd.address')}
          value={form.address}
          onChange={(v) => setForm((f) => ({ ...f, address: v }))}
          onValidity={setAddrProblem}
          showErrors={showAddrErrors}
          className="field-span2"
        />
      </div>
      <p className="field-hint">{t('supplierAdd.moreHint')}</p>
    </Modal>
  );
}
