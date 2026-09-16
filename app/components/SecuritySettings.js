'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';
import { apiErrorMessage } from '../../lib/apiErrors';
import { useLanguage } from './LanguageProvider';
import { useConfirm } from './ConfirmDialog';
import GoogleSignInButton from './GoogleSignInButton';
import { passwordStrength, PASSWORD_MIN } from '../../lib/passwordRules';
import Modal from './Modal';
import { formatDate } from '../../lib/format';
import { CheckCircleIcon, AlertIcon, EyeIcon, EyeOffIcon, LockIcon, SpinnerIcon, TrashIcon } from './Icons';

/**
 * The one part of Settings that was not there at all.
 *
 * A shopkeeper could not change his own password. There was no button, no field and no
 * route — the only way back was to log out, claim to have forgotten it, and wait for an
 * email, which does nothing for the Google accounts and does nothing on a counter PC with
 * no mail app. The account holds the shop's khata, its purchase history and the UPI id its
 * customers' money lands in, and it had no security screen.
 *
 * Three things live here, and each one is a question somebody has actually asked:
 *
 *   "Ye account kis email par hai?"          — what this login is, and whether it is proven.
 *   "Password badalna hai."                   — with the current one as proof, or Google.
 *   "Dukaan ka laptop logged in chhod aaya."  — end every other session, without changing
 *                                               the password at all.
 *
 * Saves itself, like the theme pickers — it is deliberately NOT part of the page's Save
 * button. A password change is not a preference that can sit unsaved next to a shop address,
 * and a floating bar reading "1 change pending" over a half-typed password is the app
 * offering to store it.
 */
export default function SecuritySettings() {
  const { t, lang } = useLanguage();
  const confirm = useConfirm();

  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  // Closing the account. Its own state and its own dialog, sharing nothing with the password
  // form above — a half-typed password must not be able to end up in the delete request, and
  // the two forms must never be open at once.
  const [delOpen, setDelOpen] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState(null);
  const [delName, setDelName] = useState('');
  const [delReason, setDelReason] = useState('');
  const [delPassword, setDelPassword] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  // "Has he typed anything yet." A red "too short" under an empty box is the app telling
  // somebody off for a password they have not written; the verdict waits for a keystroke.
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    apiFetch('/api/auth/security')
      .then((data) => setInfo(data.security))
      .catch((error) => setMessage({ tone: 'error', text: apiErrorMessage(lang, error) }))
      .finally(() => setLoading(false));
    // Loaded once. Re-running this on a language change would throw away a half-typed
    // password because the panel re-renders around it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setTouched(false);
    setReveal(false);
  }

  const strength = passwordStrength(newPassword, { email: info?.email, name: info?.name });
  const mismatch = touched && confirmPassword.length > 0 && newPassword !== confirmPassword;
  const settingFirst = info ? !info.hasPassword : false;
  const canSubmit =
    !busy &&
    !strength.problem &&
    newPassword.length >= PASSWORD_MIN &&
    newPassword === confirmPassword &&
    (settingFirst || currentPassword.length > 0);

  async function submit(extra = {}) {
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: settingFirst ? undefined : currentPassword,
          newPassword,
          ...extra,
        }),
      });
      // Re-read rather than patching state by hand: the server has just moved
      // passwordChangedAt, emailVerified and the sign-out stamp, and a panel that guesses
      // at those will disagree with the next reload.
      const data = await apiFetch('/api/auth/security').catch(() => null);
      if (data) setInfo(data.security);
      resetForm();
      setOpen(false);
      setMessage({
        tone: 'ok',
        text: settingFirst ? t('seller.secPasswordSetDone') : t('seller.secPasswordChangedDone'),
      });
    } catch (error) {
      setMessage({ tone: 'error', text: apiErrorMessage(lang, error) });
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    submit();
  }

  async function handleSignOutAll() {
    const ok = await confirm({
      tone: 'warning',
      title: t('seller.secSignOutAllTitle'),
      body: t('seller.secSignOutAllBody'),
      confirmLabel: t('seller.secSignOutAll'),
    });
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch('/api/auth/sign-out-everywhere', { method: 'POST' });
      const data = await apiFetch('/api/auth/security').catch(() => null);
      if (data) setInfo(data.security);
      setMessage({ tone: 'ok', text: t('seller.secSignOutAllDone') });
    } catch (error) {
      setMessage({ tone: 'error', text: apiErrorMessage(lang, error) });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Ask for the account to be closed.
   *
   * Nothing is destroyed by this call. The server writes a date a week out and answers with
   * it; the shop keeps working, a strip appears on every screen, and cron/accountDeletion.js
   * is what eventually deletes. See backend/controllers/accountController.js.
   *
   * `extra` carries the Google token for an account that has no password — the same shape the
   * password form above uses, because it is the same re-auth on the server.
   */
  async function submitDeletion(extra = {}) {
    setDelBusy(true);
    setDelError(null);
    try {
      await apiFetch('/api/auth/account/delete', {
        method: 'POST',
        body: JSON.stringify({
          confirmName: delName,
          reason: delReason || undefined,
          currentPassword: info.hasPassword ? delPassword : undefined,
          ...extra,
        }),
      });
      // Re-read rather than patching the date in by hand: the panel and the shell strip both
      // read this, and a screen that guesses at a deletion date will disagree with the one
      // the server actually promised.
      const fresh = await apiFetch('/api/auth/security').catch(() => null);
      if (fresh) setInfo(fresh.security);
      setDelOpen(false);
      resetDeletionForm();
      // A full reload rather than a banner on this panel. The warning strip belongs on every
      // screen — it is drawn by DashboardShell off the user object loaded once on mount, and
      // an owner who has just scheduled the end of his dukaan should see that strip
      // immediately, not the next time he happens to navigate. Same reasoning as the store
      // switcher: a client-side refresh does not re-run the fetch that matters.
      window.location.reload();
    } catch (error) {
      setDelError(apiErrorMessage(lang, error));
    } finally {
      setDelBusy(false);
    }
  }

  function resetDeletionForm() {
    setDelName('');
    setDelReason('');
    setDelPassword('');
    setDelError(null);
  }

  async function handleCancelDeletion() {
    const ok = await confirm({
      tone: 'default',
      title: t('seller.delCancelTitle'),
      body: t('seller.delCancelBody'),
      confirmLabel: t('seller.delCancelConfirm'),
    });
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch('/api/auth/account/cancel-deletion', { method: 'POST' });
      const fresh = await apiFetch('/api/auth/security').catch(() => null);
      if (fresh) setInfo(fresh.security);
      setMessage({ tone: 'ok', text: t('seller.delCancelledDone') });
    } catch (error) {
      setMessage({ tone: 'error', text: apiErrorMessage(lang, error) });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="section-note" style={{ marginBottom: 0 }}>{t('common.loading')}</p>;
  }
  if (!info) {
    return message?.text ? <div className="error-banner">{message.text}</div> : null;
  }

  const when = (value) =>
    value
      ? new Date(value).toLocaleString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : t('seller.secNever');

  return (
    <div className="security-panel">
      {/* What this login IS. Four plain facts before any control, because the first question
          anybody brings to a security screen is "which account am I even looking at". */}
      <dl className="security-facts">
        <div>
          <dt>{t('seller.secEmail')}</dt>
          <dd>
            <span className="security-value">{info.email}</span>
            {info.emailVerified ? (
              <span className="security-pill is-ok">
                <CheckCircleIcon size={13} aria-hidden="true" />
                {t('seller.secVerified')}
              </span>
            ) : (
              <span className="security-pill is-warn">
                <AlertIcon size={13} aria-hidden="true" />
                {t('seller.secUnverified')}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>{t('seller.secSignInMethod')}</dt>
          <dd>
            <span className="security-value">
              {info.hasPassword && info.hasGoogle
                ? t('seller.secMethodBoth')
                : info.hasGoogle
                  ? t('seller.secMethodGoogle')
                  : t('seller.secMethodPassword')}
            </span>
          </dd>
        </div>
        <div>
          <dt>{t('seller.secPasswordChanged')}</dt>
          <dd>
            <span className="security-value">{info.hasPassword ? when(info.passwordChangedAt) : t('seller.secNoPassword')}</span>
          </dd>
        </div>
        <div>
          <dt>{t('seller.secLastLogin')}</dt>
          <dd><span className="security-value">{when(info.lastLoginAt)}</span></dd>
        </div>
      </dl>

      {message?.text && (
        <div className={message.tone === 'ok' ? 'info-banner' : 'error-banner'}>{message.text}</div>
      )}

      {/* Collapsed until asked for. A password form standing open on a settings page is an
          invitation to a browser's autofill to quietly put the old password in it, and it
          takes the same amount of room as the four facts above it. */}
      {!open ? (
        <div className="row-actions">
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setOpen(true)}>
            <LockIcon size={15} aria-hidden="true" />
            {settingFirst ? t('seller.secSetPassword') : t('seller.secChangePassword')}
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={handleSignOutAll} disabled={busy}>
            {t('seller.secSignOutAll')}
          </button>
        </div>
      ) : (
        <form className="security-form" onSubmit={handleSubmit}>
          {settingFirst ? (
            <p className="field-hint" style={{ marginTop: 0 }}>{t('seller.secSetPasswordHint')}</p>
          ) : (
            <div className="field">
              <label htmlFor="secCurrentPassword">{t('seller.secCurrentPassword')}</label>
              <input
                id="secCurrentPassword"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
          )}

          <div className="form-grid cols-2">
            <div className={`field${touched && strength.problem ? ' has-error' : ''}`}>
              <label htmlFor="secNewPassword">{t('seller.secNewPassword')}</label>
              <div className="input-action">
                <input
                  id="secNewPassword"
                  type={reveal ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => {
                    setNewPassword(event.target.value);
                    setTouched(true);
                  }}
                />
                {/* An eye, not a checkbox. Typing a password you cannot see on a phone
                    keyboard is where most "wrong password" support calls come from. */}
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => setReveal((v) => !v)}
                  data-tip={reveal ? t('seller.secHidePassword') : t('seller.secShowPassword')}
                  aria-label={reveal ? t('seller.secHidePassword') : t('seller.secShowPassword')}
                >
                  {reveal ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                </button>
              </div>

              {/* Three steps, not five. Five invites somebody to chase the last bar by
                  adding "!!" to the end, which buys nothing; three says the only useful
                  thing — refused, fine, good. */}
              <div className={`pw-meter is-${newPassword ? strength.level : 'empty'}`} aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              {touched && strength.problem ? (
                <small className="field-error-text">{t(`seller.pw_${strength.problem}`)}</small>
              ) : (
                <small className="field-hint">
                  {newPassword ? t(`seller.pwLevel_${strength.level}`) : t('seller.secPasswordHint', { min: PASSWORD_MIN })}
                </small>
              )}
            </div>

            <div className={`field${mismatch ? ' has-error' : ''}`}>
              <label htmlFor="secConfirmPassword">{t('seller.secConfirmPassword')}</label>
              <input
                id="secConfirmPassword"
                type={reveal ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  setTouched(true);
                }}
              />
              {mismatch && <small className="field-error-text">{t('seller.secPasswordMismatch')}</small>}
            </div>
          </div>

          {/* Said before the button is pressed, not after. Every other login ending is the
              point of the feature, but it is also the thing that surprises a shopkeeper who
              has the app open on the counter tablet as well. */}
          <p className="field-hint">{t('seller.secOtherSessionsWarning')}</p>

          {settingFirst ? (
            <div className="upi-reauth">
              <label>{t('seller.secGoogleConfirm')}</label>
              {/* A Google-only account has no password to re-type, so it proves itself the
                  way it signed in. Pressing this submits immediately — the token is valid
                  for exactly this one confirmation. */}
              <GoogleSignInButton
                onCredential={(credential) => {
                  setTouched(true);
                  if (!canSubmit) return undefined;
                  return submit({ googleCredential: credential });
                }}
                text="continue_with"
                disabled={busy || !canSubmit}
              />
              <small>{t('seller.secGoogleConfirmHint')}</small>
            </div>
          ) : (
            <div className="row-actions">
              <button type="submit" className="btn btn-primary btn-small" disabled={!canSubmit}>
                {busy ? <SpinnerIcon size={15} /> : null}
                {busy ? t('seller.secSaving') : t('seller.secChangePassword')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => {
                  resetForm();
                  setOpen(false);
                }}
                disabled={busy}
              >
                {t('common.cancel')}
              </button>
            </div>
          )}
        </form>
      )}

      {/* The reassurance half of the sign-out button. Somebody who pressed it last month and
          has since forgotten wants to see that it happened, not wonder whether it did. */}
      {info.signedOutEverywhereAt && (
        <p className="field-hint">{t('seller.secSignedOutAt', { when: when(info.signedOutEverywhereAt) })}</p>
      )}

      <p className="field-hint">
        {t('seller.secForgotHint')}{' '}
        <Link href="/forgot-password">{t('seller.forgotPassword')}</Link>
      </p>

      {/*
        ── Closing the account ─────────────────────────────────────────────
        Last on the panel, behind its own rule, in the one colour this app uses for "this
        cannot be taken back". It is here at all because a shopkeeper who wants out is
        entitled to get out without writing to anybody — and because Google Play will not
        list an app that lets people create an account and gives them no way to destroy one.

        Owner only. A counter staff account holds a login to somebody else's business, so the
        whole block is hidden rather than drawn as a button that always refuses.
      */}
      {info.canDelete && (
        <div className="security-danger">
          <h3>{t('seller.delTitle')}</h3>

          {info.deletionDueAt ? (
            <>
              {/* Already asked for. The date first, then the way back — the date is the fact
                  and the button is the offer. */}
              <p className="security-danger-note">
                {t('seller.delPendingBody', { date: formatDate(info.deletionDueAt, lang) })}
              </p>
              <div className="row-actions">
                <button type="button" className="btn btn-primary btn-small" onClick={handleCancelDeletion} disabled={busy}>
                  {t('seller.delCancelConfirm')}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="security-danger-note">{t('seller.delHint', { days: info.graceDays })}</p>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn-danger btn-small"
                  onClick={() => { resetDeletionForm(); setDelOpen(true); }}
                >
                  <TrashIcon size={15} aria-hidden="true" />
                  {t('seller.delOpen')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {delOpen && (
        <Modal
          as="form"
          onSubmit={(event) => {
            event.preventDefault();
            // A Google-only account submits from the Google button instead — there is no
            // password field for Enter to mean anything against.
            if (info.hasPassword) submitDeletion();
          }}
          onClose={() => setDelOpen(false)}
          title={t('seller.delTitle')}
          hint={t('seller.delModalHint', { days: info.graceDays })}
          maxWidth={560}
          footer={
            info.hasPassword ? (
              <>
                <button type="submit" className="btn btn-danger btn-inline" disabled={delBusy || !delName}>
                  {delBusy ? <SpinnerIcon size={17} /> : null}
                  {delBusy ? t('seller.secSaving') : t('seller.delConfirmButton')}
                </button>
                <button type="button" className="btn btn-secondary btn-inline" onClick={() => setDelOpen(false)} disabled={delBusy}>
                  {t('common.cancel')}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setDelOpen(false)} disabled={delBusy}>
                {t('common.cancel')}
              </button>
            )
          }
        >
          {/* What actually goes, named one by one. "All your data" is an abstraction;
              "khata" is the money the street owes you. */}
          <div className="del-what">
            <strong>{t('seller.delWhatGoes')}</strong>
            <ul>
              <li>{t('seller.delGoesBills')}</li>
              <li>{t('seller.delGoesKhata')}</li>
              <li>{t('seller.delGoesStock')}</li>
              <li>{t('seller.delGoesCustomers')}</li>
              <li>{t('seller.delGoesStaff')}</li>
              <li>{t('seller.delGoesStorefront')}</li>
            </ul>
            <strong>{t('seller.delWhatStays')}</strong>
            <p className="field-hint" style={{ marginTop: 0 }}>{t('seller.delStaysPayments')}</p>
          </div>

          {/* The offer nobody makes on the way out, and the one that matters most here. A
              shop closing its account still owns its own books — this is the last chance to
              take them out, which is why it is a link and not a sentence. */}
          <div className="info-banner">
            {t('seller.delBackupFirst')}{' '}
            <Link href="/seller/backup">{t('seller.dataBackupLink')}</Link>
          </div>

          <div className="field">
            <label htmlFor="delReason">{t('seller.delReasonLabel')}</label>
            <textarea
              id="delReason"
              rows={2}
              value={delReason}
              onChange={(event) => setDelReason(event.target.value)}
              placeholder={t('seller.delReasonPlaceholder')}
            />
            <small className="field-hint">{t('seller.delReasonHint')}</small>
          </div>

          {/* Typed, not ticked. A checkbox is one tap and "type DELETE" is an English word to
              copy — neither is any obstacle to somebody who has stopped reading. The shop's
              own name is the one string that cannot be produced by accident. */}
          <div className="field">
            <label htmlFor="delName">{t('seller.delNameLabel')}</label>
            <input
              id="delName"
              type="text"
              autoComplete="off"
              value={delName}
              onChange={(event) => setDelName(event.target.value)}
            />
            <small className="field-hint">{t('seller.delNameHint', { name: info.shopName || '' })}</small>
          </div>

          {info.hasPassword ? (
            <div className="field">
              <label htmlFor="delPassword">{t('seller.secCurrentPassword')}</label>
              <input
                id="delPassword"
                type="password"
                autoComplete="current-password"
                value={delPassword}
                onChange={(event) => setDelPassword(event.target.value)}
              />
              <small className="field-hint">{t('seller.delPasswordHint')}</small>
            </div>
          ) : (
            <div className="upi-reauth">
              <label>{t('seller.secGoogleConfirm')}</label>
              {/* No password to re-type, so it proves itself the way it signs in. Pressing
                  this submits — the token is good for this one confirmation and nothing else. */}
              <GoogleSignInButton
                onCredential={(credential) => {
                  if (!delName || delBusy) return undefined;
                  return submitDeletion({ googleCredential: credential });
                }}
                text="continue_with"
                disabled={delBusy || !delName}
              />
              <small>{t('seller.delGoogleHint')}</small>
            </div>
          )}

          {delError && <div className="error-banner">{delError}</div>}
        </Modal>
      )}
    </div>
  );
}
