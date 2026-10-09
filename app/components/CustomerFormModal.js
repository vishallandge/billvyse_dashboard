'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { apiErrorMessage, errorField } from '../../lib/apiErrors';
import { jumpToField } from '../../lib/focusField';
import { useLanguage } from './LanguageProvider';
import Modal from './Modal';
import PhoneField from './PhoneField';
import AddressField from './AddressField';
import { compressPhoto } from '../../lib/imageCompress';
import {
  addressErrorText,
  cleanAddressText,
  partyNameProblem,
  PARTY_NAME_MAX,
} from '../../lib/addressRules';

/**
 * One box for adding a khata customer and for editing one.
 *
 * They were never the same form before because there was no edit form at all: a name typed
 * wrong at the counter, a phone number one digit short, a firm's GSTIN that arrived after
 * the first bill — none of it could be changed from anywhere in the app, even though the
 * API had accepted a PATCH the whole time. So a shop's khata slowly filled with records it
 * could not correct.
 *
 * Kept as one component rather than two because the two forms differ in exactly two rows
 * (opening balance on the way in, "khata band" on the way out) and letting them drift apart
 * is how a field ends up saveable on one screen and not the other.
 */

const EMPTY = {
  name: '',
  phone: '',
  creditLimit: '',
  openingBalance: '',
  photoUrl: '',
  legalName: '',
  address: '',
  gstin: '',
  birthday: '',
  anniversary: '',
};

// A stored Date comes back as a full ISO string; <input type="date"> only ever wants the
// first ten characters of it.
function toDateInput(value) {
  if (!value) return '';
  const iso = typeof value === 'string' ? value : new Date(value).toISOString();
  return iso.slice(0, 10);
}

export default function CustomerFormModal({ customer, onClose, onSaved }) {
  const { t, lang } = useLanguage();
  const editing = Boolean(customer);
  const [form, setForm] = useState(
    editing
      ? {
          name: customer.name || '',
          phone: customer.phone || '',
          creditLimit: customer.creditLimit ? String(customer.creditLimit) : '',
          openingBalance: '',
          photoUrl: customer.photoUrl || '',
          legalName: customer.legalName || '',
          address: customer.address || '',
          gstin: customer.gstin || '',
          birthday: toDateInput(customer.birthday),
          anniversary: toDateInput(customer.anniversary),
        }
      : EMPTY
  );
  const [isActive, setIsActive] = useState(customer ? customer.isActive !== false : true);
  /**
   * "Mujhe aise message mat bhejo" — recorded the moment the customer says it at the
   * counter, rather than the shopkeeper having to remember to skip them by hand.
   *
   * Marketing only. Udhaari reminders are not advertising and are deliberately not
   * switched off by this tick: a shop that could lose the right to chase its own money
   * by ticking a marketing box would have a setting nobody dares use.
   */
  const [marketingOptOut, setMarketingOptOut] = useState(Boolean(customer?.marketingOptOut));
  const [error, setError] = useState('');
  // Which field the server pointed at, so the message lands beside the box that caused it
  // rather than as a sentence at the top the shopkeeper has to map back onto the form.
  const [badField, setBadField] = useState('');
  // The sentence that goes with `badField`, rendered under that box rather than above the form.
  const [serverFieldError, setServerFieldError] = useState('');
  // What the address box says about itself, and whether the person has been shown it.
  const [addrProblem, setAddrProblem] = useState(null);
  const [showAddrErrors, setShowAddrErrors] = useState(false);
  const [legalTouched, setLegalTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  /* PhoneField hands back the digits, not an event — it has already stripped the +91 and
     the punctuation a pasted number carries. */
  function updateValue(field) {
    return (value) => {
      setForm((f) => ({ ...f, [field]: value }));
      if (badField === field) setBadField('');
    };
  }

  async function handlePhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    // Shrunk first, like a product photo — see lib/imageCompress.js.
    try {
      const dataUrl = await compressPhoto(file);
      setForm((f) => ({ ...f, photoUrl: dataUrl }));
    } catch (err) {
      setError(t(err?.message === 'TOO_BIG' ? 'common.photoTooBig' : 'common.photoUnreadable'));
    }
  }

  // Caught here as well as on the server: a ten-digit rule is worth saying before the
  // shopkeeper presses save, not after.
  const digits = form.phone.replace(/\D/g, '').slice(-10);
  const phoneShort = form.phone.trim().length > 0 && digits.length < 10;
  // Same rule file the server refuses with. Shown once the box has been left, or once a
  // save has already been refused.
  const nameCode = partyNameProblem(form.legalName);
  const nameError = nameCode && (legalTouched || showAddrErrors) ? addressErrorText(nameCode, t) : '';

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setBadField('');
    setServerFieldError('');
    if (phoneShort) {
      setBadField('phone');
      setError(t('seller.phoneIncomplete'));
      return;
    }
    if (nameCode) {
      setLegalTouched(true);
      setError(addressErrorText(nameCode, t));
      return;
    }
    if (addrProblem) {
      setShowAddrErrors(true);
      setError(addressErrorText(addrProblem.code, t));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        phone: form.phone,
        creditLimit: form.creditLimit ? Number(form.creditLimit) : 0,
        photoUrl: form.photoUrl || undefined,
        legalName: form.legalName || undefined,
        address: form.address || undefined,
        gstin: form.gstin || undefined,
        birthday: form.birthday || '',
        anniversary: form.anniversary || '',
      };
      let data;
      if (editing) {
        data = await apiFetch(`/api/seller/khata/customers/${customer.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...payload, isActive, marketingOptOut }),
        });
      } else {
        data = await apiFetch('/api/seller/khata/customers', {
          method: 'POST',
          body: JSON.stringify({
            ...payload,
            openingBalance: form.openingBalance ? Number(form.openingBalance) : 0,
          }),
        });
      }
      onSaved?.(data.customer);
      onClose?.();
    } catch (err) {
      /* A refusal about one box goes UNDER that box, and the box scrolls into view and
         flashes. The server names the field on the ones that matter here — a number
         already on another customer's record is the common one — and until now the border
         went red while the sentence explaining it sat at the top of the dialog. Anything
         it does not attribute still goes to the banner. */
      const message = apiErrorMessage(lang, err);
      const field = errorField(err);
      setBadField(field || '');
      // The server's names for these boxes are the ids they carry here, minus the prefix.
      const domId = { phone: 'cust-phone', name: 'cust-name', legalName: 'cust-legal-name' }[field];
      if (domId && document.getElementById(domId)) {
        setServerFieldError(message);
        setError('');
        jumpToField(domId);
      } else {
        setServerFieldError('');
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      as="form"
      onSubmit={handleSubmit}
      onClose={onClose}
      title={editing ? t('seller.editCustomer') : t('seller.addCustomer')}
      maxWidth={580}
      footer={
        <>
          <button type="submit" className="btn btn-primary btn-inline" disabled={saving}>
            {t('common.save')}
          </button>
          <button type="button" className="btn btn-secondary btn-inline" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
          {error && <div className="error-banner">{error}</div>}
          <div className="form-grid cols-2">
            <div className={`field${badField === 'name' ? ' has-error' : ''}`}>
              <label htmlFor="cust-name">{t('common.name')}</label>
              <input id="cust-name" value={form.name} onChange={update('name')} required autoFocus />
              {badField === 'name' && serverFieldError && (
                <span className="field-error-text">{serverFieldError}</span>
              )}
            </div>
            <PhoneField
              id="cust-phone"
              label={t('common.phone')}
              value={form.phone}
              onChange={updateValue('phone')}
              error={phoneShort ? t('seller.phoneIncomplete') : badField === 'phone' ? serverFieldError : ''}
              className={badField === 'phone' ? 'has-error' : ''}
              required
            />
            <div className={`field${badField === 'creditLimit' ? ' has-error' : ''}`}>
              <label htmlFor="cust-limit">{t('seller.creditLimit')}</label>
              <input id="cust-limit" type="number" min="0" step="0.01" value={form.creditLimit} onChange={update('creditLimit')} />
              <span className="field-hint">{t('seller.creditLimitHint')}</span>
            </div>
            {!editing && (
              <div className={`field${badField === 'openingBalance' ? ' has-error' : ''}`}>
                <label htmlFor="cust-opening">{t('seller.openingBalance')}</label>
                <input
                  id="cust-opening"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.openingBalance}
                  onChange={update('openingBalance')}
                  placeholder="0"
                />
                {/* The one line that decides whether the paper register ever gets closed. */}
                <span className="field-hint">{t('seller.openingBalanceHint')}</span>
              </div>
            )}
            {/* Only needed when this customer wants a proper invoice in their firm's name —
                a walk-in khata customer can leave all three blank.

                The firm sits directly above the address and the GSTIN because the three of
                them are one block on the printed bill, and because a GSTIN with no firm
                name beside it is what this form used to allow: a registration number over
                an individual's name, on a document the buyer's CA has to accept. */}
            <div className={`field field-span2${nameError ? ' has-error' : ''}`}>
              <label htmlFor="cust-legal">{t('seller.customerLegalName')}</label>
              <input
                id="cust-legal"
                value={form.legalName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, legalName: cleanAddressText(e.target.value, PARTY_NAME_MAX) }))
                }
                onBlur={() => setLegalTouched(true)}
                placeholder="M/s Patil Traders"
              />
              {nameError ? (
                <span className="field-error-text">{nameError}</span>
              ) : (
                <span className="field-hint">{t('seller.customerLegalNameHint')}</span>
              )}
            </div>
            <AddressField
              id="cust-address"
              label={t('seller.customerAddress')}
              value={form.address}
              onChange={(v) => setForm((f) => ({ ...f, address: v }))}
              onValidity={setAddrProblem}
              showErrors={showAddrErrors}
              className="field-span2"
            />
            <div className={`field${badField === 'gstin' ? ' has-error' : ''}`}>
              <label htmlFor="cust-gstin">{t('seller.customerGstin')}</label>
              <input
                id="cust-gstin"
                value={form.gstin}
                onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase() }))}
                maxLength={15}
                placeholder="27ABCDE1234F1Z5"
              />
            </div>
            <div className="field">
              <label htmlFor="cust-birthday">{t('seller.customerBirthday')}</label>
              <input
                id="cust-birthday"
                type="date"
                value={form.birthday}
                onChange={update('birthday')}
              />
            </div>
            <div className="field">
              <label htmlFor="cust-anniversary">{t('seller.customerAnniversary')}</label>
              <input
                id="cust-anniversary"
                type="date"
                value={form.anniversary}
                onChange={update('anniversary')}
              />
              <span className="field-hint">{t('seller.customerAnniversaryHint')}</span>
            </div>
            <div className="field">
              <label htmlFor="cust-photo">{t('seller.customerPhoto')}</label>
              <input id="cust-photo" type="file" accept="image/*" onChange={handlePhoto} />
              {form.photoUrl && (
                <img
                  src={form.photoUrl}
                  alt=""
                  style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '8px', marginTop: '0.4rem' }}
                />
              )}
            </div>
          </div>

          {editing && (
            <label className="checkbox-row" style={{ marginTop: '0.6rem', alignItems: 'flex-start' }}>
              <input type="checkbox" checked={!isActive} onChange={(e) => setIsActive(!e.target.checked)} style={{ marginTop: '0.15rem' }} />
              <span>
                {t('seller.closeKhata')}
                <span className="field-hint" style={{ display: 'block' }}>{t('seller.closeKhataHint')}</span>
              </span>
            </label>
          )}

          {editing && (
            <label className="checkbox-row" style={{ marginTop: '0.6rem', alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={marketingOptOut}
                onChange={(e) => setMarketingOptOut(e.target.checked)}
                style={{ marginTop: '0.15rem' }}
              />
              <span>
                {t('seller.noOfferMessages')}
                <span className="field-hint" style={{ display: 'block' }}>{t('seller.noOfferMessagesHint')}</span>
              </span>
            </label>
          )}

    </Modal>
  );
}
