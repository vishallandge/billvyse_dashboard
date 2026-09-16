'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { apiErrorMessage, errorField } from '../../lib/apiErrors';
import { jumpToField } from '../../lib/focusField';
import { useLanguage } from './LanguageProvider';
import Modal from './Modal';
import AuthField from './AuthField';
import AddressField from './AddressField';
import PhoneField from './PhoneField';
import { StoreIcon, MailIcon, SpinnerIcon, LogOutIcon } from './Icons';
import { SHOP_NAME_MIN, isIndianMobile, isLikelyEmail, TEXT_LIMITS } from '../../lib/shopProfileRules';
import { addressErrorText } from '../../lib/addressRules';

// The owner may close this reminder. DashboardShell schedules it again on a
// fresh login or a new business day until the saved shop identity is complete.
export default function ShopIdentityGate({ user, onSaved, onLogout, onClose }) {
  const { t, lang } = useLanguage();
  const [shopName, setShopName] = useState(user.shopName || '');
  const [shopAddress, setShopAddress] = useState(user.shopAddress || '');
  const [shopPhone, setShopPhone] = useState(user.shopPhone || '');
  // Fetched straight from the login itself the moment there is nothing else to go on — a
  // shopkeeper who signed up with email has already typed this once and should never be
  // asked again. Still just a starting value: the box stays editable, and whatever they
  // save here (even unchanged) is what backfills shopEmail for accounts old enough to
  // predate this default.
  const [shopEmail, setShopEmail] = useState(user.shopEmail || user.email || '');
  const [error, setError] = useState('');
  /**
   * The address box's own verdict, and whether to show it.
   *
   * This is the one screen in the app that asks for the shop's address `required`: it
   * is the wall a brand-new shop meets before its first bill, the address is printed
   * on every one of those bills, and a pincode is what puts the right state next to it.
   * Nowhere else demands one — thousands of addresses predate the box that asks.
   */
  const [addrProblem, setAddrProblem] = useState(null);
  const [showAddrErrors, setShowAddrErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  /**
   * Per-field refusals, shown under the box they are about.
   *
   * `error` above is still there for what the SERVER says — one sentence about the request
   * as a whole. But "that does not look like a 10-digit mobile number" is about one of four
   * boxes, and printed at the top of the card it made the reader check all four. Cleared
   * per field as soon as that field is touched, so a corrected box stops shouting before
   * the shopkeeper has to press Save again to find out.
   */
  const [fieldErrors, setFieldErrors] = useState({});
  const clearField = (name) =>
    setFieldErrors((current) => (current[name] ? { ...current, [name]: '' } : current));

  /**
   * A refusal from the SERVER, put on the box it is about.
   *
   * "This mobile number is already linked to another shop" is the one that made this
   * necessary: it is about one field, it arrives after the form already passed every local
   * check, and printed at the top of the card it left the shopkeeper reading all four boxes
   * to work out which one to change. Now it lands under the phone box, and the box scrolls
   * itself into view and flashes.
   *
   * Anything the server does not attribute to a field still goes to the banner — a refusal
   * that cannot be placed must never be swallowed.
   */
  function showRefusal(err) {
    const message = apiErrorMessage(lang, err);
    // The server's names for these boxes, mapped to the ids they carry on THIS screen.
    const domId = errorField(err, {
      shopName: 'gateShopName',
      shopAddress: 'gateShopAddress',
      shopPhone: 'gateShopPhone',
      shopEmail: 'gateShopEmail',
    });
    const key = { gateShopName: 'shopName', gateShopAddress: 'shopAddress', gateShopPhone: 'shopPhone', gateShopEmail: 'shopEmail' }[domId];
    if (key) {
      setFieldErrors({ [key]: message });
      setError('');
      jumpToField(domId);
      return;
    }
    setError(message);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    /* Every problem at once, not the first one. A shopkeeper who fixes the name, presses
       Save, and is then told about the phone has been made to do the work twice — the same
       reasoning validateShopProfile() already follows on the Settings screen. */
    const problems = {};
    if (String(shopName).trim().length < SHOP_NAME_MIN) problems.shopName = t('seller.errShopName');
    if (!String(shopPhone).trim()) problems.shopPhone = t('phone.required');
    else if (!isIndianMobile(shopPhone)) problems.shopPhone = t('phone.invalid');
    if (shopEmail.trim() && !isLikelyEmail(shopEmail)) problems.shopEmail = t('seller.errEmail');

    if (addrProblem) {
      setShowAddrErrors(true);
      problems.shopAddress = addressErrorText(addrProblem.code, t, t('shopIdentityGate.errAddress'));
    }

    if (Object.keys(problems).length > 0) {
      setFieldErrors(problems);
      // The banner is left empty on purpose: each message is now sitting under the box it
      // belongs to, and repeating one of them at the top would only ask "which one?".
      setError('');
      // Land on the FIRST one, in the order the boxes are actually laid out — not in
      // whatever order the checks happened to run.
      const order = ['shopName', 'shopAddress', 'shopPhone', 'shopEmail'];
      const first = order.find((name) => problems[name]);
      if (first) jumpToField(`gate${first[0].toUpperCase()}${first.slice(1)}`);
      return;
    }

    setFieldErrors({});
    setError('');
    setSaving(true);
    try {
      const { profile } = await apiFetch('/api/seller/profile', {
        method: 'PUT',
        body: JSON.stringify({
          shopName: shopName.trim(),
          shopAddress: shopAddress.trim(),
          shopPhone: shopPhone.trim(),
          shopEmail: shopEmail.trim(),
        }),
      });
      onSaved(profile);
    } catch (err) {
      showRefusal(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      as="form"
      onSubmit={handleSubmit}
      title={t('shopIdentityGate.title')}
      hint={t('shopIdentityGate.reminderBody')}
      onClose={saving ? undefined : onClose}
      closeOnBackdrop={false}
      closeOnEscape={!saving}
      footer={
        <>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving && <SpinnerIcon size={17} />}
            {saving ? t('shopIdentityGate.saving') : t('shopIdentityGate.save')}
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={onClose} disabled={saving}>
            {t('shopIdentityGate.later')}
          </button>
          {/* Deliberately quiet, and on its own row under the primary: this is the one
              loud action on the screen, and an escape hatch that looks like a peer of it
              would read as a choice between two ways forward. Same wording and icon as the
              account menu's Log out, because it is the same act. */}
          {onLogout && (
            <button
              type="button"
              className="btn btn-secondary btn-small btn-inline gate-logout"
              onClick={onLogout}
              disabled={saving}
            >
              <LogOutIcon size={15} />
              {t('common.logout')}
            </button>
          )}
        </>
      }
    >
      {error && <div className="error-banner">{error}</div>}
      <AuthField
        id="gateShopName"
        label={t('seller.shopName')}
        icon={<StoreIcon size={17} />}
        value={shopName}
        onChange={(e) => { setShopName(e.target.value); clearField('shopName'); }}
        error={fieldErrors.shopName}
        autoFocus
        required
      />
      {/* The only field on this wall that is not one line of typing. A shopkeeper filling
          this in is standing in the shop it is about, so the location button usually
          finishes it in one tap — and what it writes down is a pincode the invoice can
          print a state next to. */}
      <AddressField
        id="gateShopAddress"
        label={t('seller.shopAddress')}
        value={shopAddress}
        onChange={setShopAddress}
        onValidity={(problem) => { setAddrProblem(problem); if (!problem) clearField('shopAddress'); }}
        showErrors={showAddrErrors}
        error={fieldErrors.shopAddress}
        maxLength={TEXT_LIMITS.shopAddress}
        required
      />
      {/* The +91 is stated rather than assumed. A shopkeeper reading their own visiting
          card types the country code too, and the old box ate it silently. */}
      <PhoneField
        id="gateShopPhone"
        variant="auth"
        label={t('seller.shopPhone')}
        value={shopPhone}
        onChange={(next) => { setShopPhone(next); clearField('shopPhone'); }}
        error={fieldErrors.shopPhone}
        required
      />
      <AuthField
        id="gateShopEmail"
        type="email"
        label={t('seller.shopEmail')}
        icon={<MailIcon size={17} />}
        value={shopEmail}
        onChange={(e) => { setShopEmail(e.target.value); clearField('shopEmail'); }}
        error={fieldErrors.shopEmail}
        hint={t('shopIdentityGate.emailNote')}
      />
    </Modal>
  );
}
