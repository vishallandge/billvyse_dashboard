'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import GoogleSignInButton from './GoogleSignInButton';
import { useLanguage } from './LanguageProvider';

export default function PaymentVerificationDialog({ action, method, password, onPassword, saving, error, onConfirm, onGoogle, onCancel, onReset }) {
  const ref = useRef(null);
  const { t } = useLanguage();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus?.(); };
  }, []);

  return createPortal(
    <dialog ref={ref} className="modal-card payment-verify-dialog" aria-labelledby="payment-verify-title"
      onCancel={(event) => { event.preventDefault(); if (!saving) onCancel(); }}>
      <form onSubmit={(event) => { event.preventDefault(); if (!saving) onConfirm(); }}>
        <div className="modal-header">
          <h2 id="payment-verify-title">{t(action === 'reveal' ? 'seller.paymentViewConfirm' : 'seller.paymentSaveConfirm')}</h2>
        </div>
        <p>{t('seller.paymentOwnerConfirmHint')}</p>
        {method === 'google' ? (
          <GoogleSignInButton onCredential={onGoogle} text="continue_with" disabled={saving} />
        ) : (
          <div className="field">
            <label htmlFor="paymentOwnerPassword">{t('seller.upiPasswordLabel')}</label>
            <input id="paymentOwnerPassword" type="password" autoComplete="current-password" value={password}
              onChange={(event) => onPassword(event.target.value)} disabled={saving} autoFocus required />
            <button type="button" className="link-btn" disabled={saving} onClick={onReset}>{t('seller.upiForgotPassword')}</button>
          </div>
        )}
        {error && <p role="alert" className="field-error">{error}</p>}
        <div className="row-actions" style={{ marginTop: '1rem' }}>
          <button type="button" className="btn btn-secondary btn-small" onClick={onCancel} disabled={saving}>{t('common.cancel')}</button>
          {method !== 'google' && <button type="submit" className="btn btn-primary btn-small" disabled={saving || !password}>
            {t(action === 'reveal' ? 'seller.paymentVerifyReveal' : 'seller.paymentVerifySave')}
          </button>}
        </div>
      </form>
    </dialog>, document.body,
  );
}
