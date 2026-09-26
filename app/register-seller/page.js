'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, authFetch } from '../../lib/api';
import { apiErrorMessage } from '../../lib/apiErrors';
import { useLanguage, LANG_STORAGE_KEY } from '../components/LanguageProvider';
import { LANGUAGE_CODES } from '../../lib/i18n/meta';
import { businessTypeOptions, businessType } from '../../lib/businessTypes';
import { CheckIcon, MailIcon, LockIcon, UsersIcon, ShopIcon, SpinnerIcon, ShieldIcon, GiftIcon } from '../components/Icons';
import GoogleSignInButton, { GOOGLE_ENABLED } from '../components/GoogleSignInButton';
import AuthLayout from '../components/AuthLayout';
import AuthField from '../components/AuthField';
import AddressField from '../components/AddressField';
import PhoneField from '../components/PhoneField';
import { addressErrorText } from '../../lib/addressRules';
import { isIndianMobile } from '../../lib/shopProfileRules';

// The public site, where the policy pages live. Absolute rather than a Next <Link>: the
// legal pages belong to the storefront app, not the dashboard, and they have to be readable
// by somebody who has no account yet. Same variable every other cross-app link on this
// dashboard uses, so there is one address to change at deploy time.
const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';

/**
 * The invite headline, in the three languages this app writes marketing copy in — the other
 * seven fall back to English exactly as lib/i18n.js does.
 *
 * Local rather than an i18n key because it is one sentence that takes a name, and it belongs
 * beside the banner that draws it.
 */
const INVITE_HEADLINE = {
  en: (name) => `${name} invited you to BillVyse`,
  hi: (name) => `${name} ने आपको BillVyse पर बुलाया है`,
  mr: (name) => `${name} ने तुम्हाला BillVyse वर बोलावलं आहे`,
};

const STEP_KEYS = ['account', 'business', 'shop'];
const RESEND_SECONDS = 30;
// Google already supplied the name and email, and the account has no password at all,
// so the first step has nothing left to ask.
const GOOGLE_STEP_KEYS = ['business', 'shop'];

export default function RegisterSellerPage() {
  const router = useRouter();
  const { t, lang, setLang } = useLanguage();
  const [step, setStep] = useState(0);

  // First screen a first-time visitor ever sees, so it's also the one place worth
  // guessing their language from the browser — only when they haven't already picked
  // one (an existing shopkeeper revisiting this page keeps whatever they last chose).
  useEffect(() => {
    let hasChoice = false;
    try {
      hasChoice = Boolean(localStorage.getItem(LANG_STORAGE_KEY));
    } catch {
      hasChoice = false;
    }
    if (hasChoice) return;
    const browserLangs = typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : [];
    const match = browserLangs.map((l) => l.split('-')[0].toLowerCase()).find((code) => LANGUAGE_CODES.includes(code));
    if (match) setLang(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [form, setForm] = useState({ name: '', email: '', password: '', shopName: '', shopAddress: '', shopPhone: '', businessType: '' });
  const [error, setError] = useState('');
  /**
   * The terms tick. Deliberately its own state and deliberately NOT pre-checked.
   *
   * It lives on the last step, next to the button that creates the shop, because that is
   * the moment it refers to. The server refuses the sign-up without it
   * (backend/controllers/authController.js) and records which dated version was accepted —
   * a box that defaulted to ticked would record an agreement nobody was offered the chance
   * to decline, which is worth less than not asking at all.
   */
  const [acceptTerms, setAcceptTerms] = useState(false);
  // What the address box says about itself; `showAddrErrors` turns its own inline sentences
  // on once a step has actually been refused.
  const [addrProblem, setAddrProblem] = useState(null);
  const [showAddrErrors, setShowAddrErrors] = useState(false);
  /**
   * The mobile number's own sentence, held back until a step has actually been refused.
   *
   * Same rule the address box follows: a red line under a field somebody has not finished
   * typing into is the form arguing with them. Once they press Next, it stays on.
   */
  const [showPhoneError, setShowPhoneError] = useState(false);
  const [loading, setLoading] = useState(false);
  // Shown only when the shop comes back already approved (auto-approve on) — a pending
  // shop can't create products yet (backend 403s), so it skips straight to the dashboard
  // instead of offering a step that would just fail.
  const [showProductStep, setShowProductStep] = useState(false);
  // Set once the account exists but nobody has proved they can read its inbox. Holds the
  // address so the code screen can name it, and — only on a server with no mail provider —
  // the code itself, so a fresh clone is still usable without SMTP keys.
  const [verify, setVerify] = useState(null);
  const [otp, setOtp] = useState('');
  const [resending, setResending] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);
  const [productForm, setProductForm] = useState({ name: '', price: '' });
  const [productSubmitting, setProductSubmitting] = useState(false);
  // Set when the shopkeeper arrived here from the Google button (either on this page or
  // on the login page, which parks the credential in sessionStorage and redirects).
  const [google, setGoogle] = useState(null);
  /**
   * The invite this signup arrived on.
   *
   * `code` is whatever was in `?ref=`; `invite` is what the server said about it — who sent
   * it and what the offer is. They are separate because the code is carried into the signup
   * regardless, while the banner is only drawn once the server has confirmed the code is
   * real. A banner drawn off an unchecked query parameter would let anybody put any shop's
   * name on our signup page by editing a URL.
   */
  const [referralCode, setReferralCode] = useState('');
  const [invite, setInvite] = useState(null);

  const steps = google ? GOOGLE_STEP_KEYS : STEP_KEYS;
  const lastStep = steps.length - 1;

  // Picks up the profile handed over by the login page. The Google token is NOT here and
  // must not be: the server parked it in an httpOnly cookie, and this page simply posts the
  // finished form — the cookie rides along by itself. All that travels through the browser
  // is a name and an email to prefill the first screen with.
  useEffect(() => {
    let parked;
    try {
      parked = sessionStorage.getItem('dukaan_google_signup');
      sessionStorage.removeItem('dukaan_google_signup');
    } catch {
      return;
    }
    if (!parked) return;
    try {
      const { profile } = JSON.parse(parked);
      if (profile?.email) applyGoogleProfile(null, profile);
    } catch {
      // Malformed hand-off — fall through to the normal form.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Someone whose password was right but whose email was never confirmed, sent here by the
   * login page. They already have an account, so the wizard is skipped entirely and only
   * the code screen is shown.
   *
   * A fresh code is requested rather than assuming the one from days ago still lives — it
   * almost certainly does not, and a screen that silently demands an expired code is a
   * screen nobody gets past. Read straight off `window.location` rather than through
   * `useSearchParams`, which would force this whole page into a Suspense boundary for one
   * optional parameter.
   */
  /**
   * "Ramesh Kirana ne aapko bulaya hai."
   *
   * Read straight off `window.location` rather than through `useSearchParams`, for the same
   * reason the verify parameter below is — that hook would force this whole page into a
   * Suspense boundary for one optional query string.
   *
   * The code is kept even when the lookup fails: a programme switched off between the link
   * being shared and being clicked should not silently drop the attribution, and the server
   * ignores a code it cannot use anyway.
   */
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (!ref) return;
    setReferralCode(ref);
    apiFetch(`/api/auth/referral/${encodeURIComponent(ref)}`)
      .then((data) => data?.valid && setInvite(data))
      .catch(() => {
        // An unknown or expired code lands on an ordinary signup form, which is exactly
        // what should happen to a link forwarded around a WhatsApp group two years ago.
      });
  }, []);

  useEffect(() => {
    const email = new URLSearchParams(window.location.search).get('verify');
    if (!email) return;
    setVerify({ email, delivered: true });
    authFetch('/api/auth/resend-verification', { body: JSON.stringify({ email }) })
      .then((data) => setVerify((current) => ({ ...current, devOtp: data.devOtp, delivered: data.delivered })))
      .catch(() => {
        // The resend limiter refusing is fine — a code they already have still works.
      });
    setResendIn(RESEND_SECONDS);
  }, []);

  function applyGoogleProfile(credential, profile = {}) {
    setGoogle({ credential, profile });
    setForm((f) => ({ ...f, name: profile.name || f.name, email: profile.email || f.email, password: '' }));
    setStep(0);
    setError('');
  }

  // Google button pressed on this page. An address that already has an account just
  // logs straight in — no reason to make an existing shopkeeper finish a signup wizard.
  async function handleGoogleCredential(credential) {
    setError('');
    setLoading(true);
    try {
      const data = await authFetch('/api/auth/google', { body: JSON.stringify({ credential }) });

      if (data.needsSignup) {
        applyGoogleProfile(credential, data.profile);
        setLoading(false);
        return;
      }

      router.replace(data.user.role === 'superadmin' ? '/admin' : '/seller');
    } catch (err) {
      setError(apiErrorMessage(lang, err));
      setLoading(false);
    }
  }

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  // What is wrong with the number right now, or '' when nothing is. Written once and read
  // twice — by the step guard, which refuses to move on, and by the box itself.
  const phoneProblem = !form.shopPhone.trim()
    ? t('phone.required')
    : !isIndianMobile(form.shopPhone)
      ? t('phone.invalid')
      : '';

  // Each step only blocks on what it collects — business type stays fully skippable, and
  // going back never wipes what was already typed on a later step.
  // Validation follows the step's *name*, not its index — the Google flow drops the
  // account step, so index 0 means "business" there and "account" otherwise.
  function stepError(index) {
    const key = steps[index];
    if (key === 'account') {
      if (!form.name.trim()) return t('register.needName');
      if (!form.email.trim()) return t('register.needEmail');
      if (form.password.length < 6) return t('register.needPassword');
    }
    if (key === 'shop') {
      if (!form.shopName.trim()) return t('register.needShopName');
      /* Required, unlike the address — this number is the shop's second login (the Mobile
         tab on the sign-in screen sends a code to it), so a shop created without one has
         only its password and its Google account to get back in with. The server refuses
         the sign-up over it too, and a refusal at that point loses the whole form. */
      if (phoneProblem) return phoneProblem;
      /* The address stays optional here — a wizard that stops on a pincode is a wizard that
         does not finish — but whatever HAS been typed has to be an address, because the
         server refuses the sign-up over it and a refusal at that point loses the whole form.
         Same rule file the API enforces: lib/addressRules.js. */
      if (addrProblem) return addressErrorText(addrProblem.code, t);
      if (!acceptTerms) return t('register.needTerms');
    }
    return '';
  }

  function goNext() {
    const err = stepError(step);
    if (err) {
      setError(err);
      if (addrProblem) setShowAddrErrors(true);
      if (phoneProblem) setShowPhoneError(true);
      return;
    }
    setError('');
    setStep((s) => Math.min(s + 1, lastStep));
  }

  function goBack() {
    setError('');
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const err = stepError(lastStep);
    if (err) {
      setError(err);
      if (addrProblem) setShowAddrErrors(true);
      if (phoneProblem) setShowPhoneError(true);
      return;
    }
    setError('');
    setLoading(true);

    try {
      // Same wizard, two endpoints. On the Google path the credential is sent only when
      // this page obtained it itself (the Google button pressed right here); when the
      // hand-off came from the login screen there is nothing to send, and the server reads
      // the token it parked in its own httpOnly cookie instead.
      const endpoint = google ? '/api/auth/google' : '/api/auth/register';
      const payload = google
        ? {
            ...(google.credential ? { credential: google.credential } : {}),
            shopName: form.shopName,
            shopAddress: form.shopAddress,
            // Carried on the Google path too. Google proves an email address and nothing
            // else, so this is the only mobile number that account will ever have.
            shopPhone: form.shopPhone,
            businessType: form.businessType,
            acceptTerms,
            referralCode,
            referralChannel: 'link',
          }
        : { ...form, acceptTerms, referralCode, referralChannel: 'link' };

      const data = await authFetch(endpoint, { body: JSON.stringify(payload) });

      // The email path now stops here and asks for the code that was just mailed. Nothing
      // has been signed in — there is no session to carry forward — so the wizard simply
      // swaps to the code screen and picks up again once it comes back with a user.
      //
      // The Google path never lands here: Google has already proved the address, so that
      // response still carries a user and a session.
      if (data.verificationRequired) {
        setVerify({ email: data.email, devOtp: data.devOtp, delivered: data.delivered });
        setLoading(false);
        return;
      }

      finishSignup(data);
    } catch (err) {
      setError(apiErrorMessage(lang, err));
      setLoading(false);
    }
  }

  /**
   * Everything that used to happen the instant `register` returned, now that it happens one
   * step later. Shared by the Google path (which is signed in immediately) and by the code
   * screen below.
   */
  function finishSignup(data) {
    // Tells DashboardShell to run the one-time sidebar tour on first load — read and
    // cleared there, so it can never fire again for this shop after today.
    try {
      localStorage.setItem(`dukaan_sidebar_tour_pending_${data.user.id}`, '1');
    } catch {
      // localStorage unavailable — the tour just won't run, nothing else depends on it
    }

    if (data.user.shopStatus === 'approved') {
      setLoading(false);
      setVerify(null);
      setShowProductStep(true);
    } else {
      router.replace('/seller?onboarding=1');
    }
  }

  async function submitOtp(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await authFetch('/api/auth/verify-email', {
        body: JSON.stringify({ email: verify.email, otp }),
      });
      finishSignup(data);
    } catch (err) {
      setError(apiErrorMessage(lang, err));
      setOtp('');
      setLoading(false);
    }
  }

  async function resendOtp() {
    setError('');
    setResending(true);
    try {
      const data = await authFetch('/api/auth/resend-verification', {
        body: JSON.stringify({ email: verify.email }),
      });
      setVerify((current) => ({ ...current, devOtp: data.devOtp, delivered: data.delivered }));
      setResendIn(RESEND_SECONDS);
    } catch (err) {
      setError(apiErrorMessage(lang, err));
    } finally {
      setResending(false);
    }
  }

  function goToDashboard() {
    router.replace('/seller?onboarding=1');
  }

  async function submitFirstProduct(event) {
    event.preventDefault();
    if (!productForm.name.trim() || !productForm.price) {
      goToDashboard();
      return;
    }
    setProductSubmitting(true);
    try {
      const biz = businessType(form.businessType);
      await apiFetch('/api/seller/products', {
        method: 'POST',
        body: JSON.stringify({
          name: productForm.name.trim(),
          price: Number(productForm.price),
          unit: biz.defaultUnit,
          gstRate: biz.defaultGstRate,
          kind: biz.sellsServices ? 'service' : 'goods',
        }),
      });
      goToDashboard();
    } catch {
      // Best-effort only — a failed first product should never trap a brand-new shop
      // on this screen. They can always add it properly from the Products page.
      goToDashboard();
    }
  }

  // One <h1> per screen, chosen here rather than three times in the JSX below, because the
  // shell that draws it is shared with login and reset.
  const sellsServices = businessType(form.businessType).sellsServices;
  let title = t('auth.signUpTitle');
  let subtitle = t('auth.signUpSub');
  if (verify) {
    title = t('register.verifyTitle');
    subtitle = t('register.verifySubtitle', { email: verify.email });
  } else if (showProductStep) {
    title = t('register.productStepTitle');
    subtitle = sellsServices ? t('register.productStepBodyService') : t('register.productStepBody');
  }

  return (
    <AuthLayout variant="signup" title={title} subtitle={subtitle}>
      {/* The offer, stated before anything is asked for.
          "Mujhe kya milega?" is the first question the person who received the forward has,
          and a signup form that answers it after the form is a form they close. Drawn only
          from what the SERVER said about the code — see the lookup above. */}
      {invite && !showProductStep && (
        <div className="invite-banner">
          <span className="invite-banner-icon"><GiftIcon size={17} /></span>
          <div>
            <strong>{INVITE_HEADLINE[lang]?.(invite.referrerName) || INVITE_HEADLINE.en(invite.referrerName)}</strong>
            <p>
              {invite.bonusPoints > 0 && `${invite.bonusPoints} points (₹${invite.bonusRupees})`}
              {invite.bonusPoints > 0 && invite.bonusTrialDays > 0 && ' + '}
              {invite.bonusTrialDays > 0 && `${invite.bonusTrialDays} extra free days`}
            </p>
          </div>
        </div>
      )}
      {verify ? (
        <form onSubmit={submitOtp}>
          {/* The code box is the whole screen here, so it gets to be big: six digits at
              display size, spaced, tabular. Somebody reading a code off a second device
              needs to be able to check it at a glance without leaning in. */}
          <div className="auth-field">
            <div className="auth-input-wrap">
              <input
                id="signupOtp"
                className="auth-input otp-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder=" "
                autoFocus
              />
              <label htmlFor="signupOtp" className="auth-input-label">{t('register.verifyCode')}</label>
            </div>
            {/* Only ever present on a server with no mail provider — production
                refuses to register at all in that state. */}
            {verify.devOtp && (
              <span className="field-hint">{t('register.verifyDevCode', { code: verify.devOtp })}</span>
            )}
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="wizard-actions">
            <button type="submit" className="btn btn-primary auth-cta" disabled={loading || otp.length < 6}>
              {loading && <SpinnerIcon size={17} />}
              {loading ? t('common.saving') : t('register.verifySubmit')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={resending || resendIn > 0}
              onClick={resendOtp}
            >
              {resendIn > 0 ? t('register.verifyResendIn', { seconds: resendIn }) : t('register.verifyResend')}
            </button>
          </div>
          {/* A wrong address is unrecoverable from this screen, so the way back to the
              form is offered rather than left to the browser's back button — which
              would drop the wizard's state entirely. */}
          <button
            type="button"
            className="link-btn"
            onClick={() => { setVerify(null); setOtp(''); setError(''); setStep(0); }}
          >
            {t('register.verifyWrongEmail')}
          </button>
        </form>
      ) : showProductStep ? (
        <form onSubmit={submitFirstProduct}>
          {error && <div className="error-banner">{error}</div>}

          <AuthField
            id="productName"
            label={sellsServices ? t('register.serviceName') : t('register.productName')}
            value={productForm.name}
            onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))}
            hint={sellsServices ? t('register.serviceNamePlaceholder') : t('register.productNamePlaceholder')}
            autoFocus
          />
          <AuthField
            id="productPrice"
            type="number"
            min="0"
            step="0.01"
            label={t('register.productPrice')}
            value={productForm.price}
            onChange={(e) => setProductForm((f) => ({ ...f, price: e.target.value }))}
          />
          <div className="wizard-actions">
            <button type="button" className="btn btn-secondary" onClick={goToDashboard} disabled={productSubmitting}>
              {t('register.skipForNow')}
            </button>
            <button type="submit" className="btn btn-primary auth-cta" disabled={productSubmitting}>
              {productSubmitting && <SpinnerIcon size={17} />}
              {productSubmitting ? t('register.submitting') : t('register.addAndFinish')}
            </button>
          </div>
        </form>
      ) : (
        <>
          <ol className="wizard-steps">
            {steps.map((key, index) => (
              <li
                key={key}
                className={`wizard-step${index === step ? ' active' : ''}${index < step ? ' done' : ''}`}
              >
                <span className="wizard-step-dot">{index < step ? <CheckIcon size={13} /> : index + 1}</span>
                <span className="wizard-step-label">{t(`register.step.${key}`)}</span>
              </li>
            ))}
          </ol>

          {error && <div className="error-banner">{error}</div>}

          {/* Offered only on the very first step, and only before a Google account has
              been picked — once it has, the identity is settled and showing the button
              again would just invite a confusing account switch mid-wizard. */}
          {!google && step === 0 && GOOGLE_ENABLED && (
            <>
              <GoogleSignInButton onCredential={handleGoogleCredential} text="signup_with" disabled={loading} />
              <div className="auth-divider"><span>{t('login.or')}</span></div>
            </>
          )}

          {google && (
            <div className="reconcile-banner neutral" style={{ marginTop: 0, marginBottom: '1rem' }}>
              <CheckIcon size={16} />
              <div>
                <strong>{t('register.googleLinked')}</strong>
                <span>{google.profile?.email || form.email}</span>
              </div>
            </div>
          )}

          <form onSubmit={step === lastStep ? handleSubmit : (e) => e.preventDefault()}>
            {steps[step] === 'account' && (
              <>
                <AuthField
                  id="name"
                  label={t('register.ownerName')}
                  icon={<UsersIcon size={17} />}
                  value={form.name}
                  onChange={update('name')}
                  autoComplete="name"
                  required
                  autoFocus
                />
                <AuthField
                  id="email"
                  type="email"
                  label={t('register.email')}
                  icon={<MailIcon size={17} />}
                  value={form.email}
                  onChange={update('email')}
                  autoComplete="email"
                  required
                />
                <AuthField
                  id="password"
                  type="password"
                  label={t('register.password')}
                  icon={<LockIcon size={17} />}
                  value={form.password}
                  onChange={update('password')}
                  autoComplete="new-password"
                  minLength={6}
                  required
                  strength
                />
              </>
            )}

            {steps[step] === 'business' && (
              <div className="field">
                <label>{t('register.businessType')}</label>
                <p className="field-hint">{t('register.businessTypeHint')}</p>
                <div className="biz-type-grid">
                  {businessTypeOptions(t).map((option) => (
                    <button
                      type="button"
                      key={option.key}
                      className={`biz-type${form.businessType === option.key ? ' active' : ''}`}
                      onClick={() =>
                        setForm((f) => ({ ...f, businessType: f.businessType === option.key ? '' : option.key }))
                      }
                    >
                      <span className="biz-type-icon" aria-hidden="true">{option.icon}</span>
                      <span className="biz-type-label">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {steps[step] === 'shop' && (
              <>
                <AuthField
                  id="shopName"
                  label={t('register.shopName')}
                  icon={<ShopIcon size={17} />}
                  value={form.shopName}
                  onChange={update('shopName')}
                  required
                  autoFocus
                />
                {/* Asked for here rather than left to Settings, because it is the second
                    door into this account: the login screen's Mobile tab sends a code to
                    this number and knows an account by nothing else. A shop that skipped it
                    was told, on its own login screen, that no shop is registered with its
                    own number. The hint says so out loud — a mobile box on a signup form
                    otherwise reads as one more thing being collected about you. */}
                <PhoneField
                  id="shopPhone"
                  variant="auth"
                  label={t('register.mobile')}
                  hint={t('register.mobileHint')}
                  value={form.shopPhone}
                  onChange={(next) => setForm((f) => ({ ...f, shopPhone: next }))}
                  error={showPhoneError ? phoneProblem : ''}
                  autoComplete="tel"
                  required
                />
                {/* Optional here, as it always was — a signup that stops on a pincode is a
                    signup that does not finish. But the shopkeeper is standing in the shop
                    while they fill this, so one tap on the location button writes down more
                    than most of them would ever have typed. */}
                <AddressField
                  id="shopAddress"
                  label={t('register.shopAddress')}
                  value={form.shopAddress}
                  onChange={(v) => setForm((f) => ({ ...f, shopAddress: v }))}
                  onValidity={setAddrProblem}
                  showErrors={showAddrErrors}
                  maxLength={200}
                />
                {/* Opens in a new tab on purpose: a half-filled wizard must survive somebody
                    actually reading what they are agreeing to. */}
                <label className="auth-terms">
                  <input
                    type="checkbox"
                    checked={acceptTerms}
                    onChange={(e) => setAcceptTerms(e.target.checked)}
                  />
                  <span>
                    {t('register.termsPrefix')}{' '}
                    <a href={`${FRONTEND_URL}/legal#terms`} target="_blank" rel="noreferrer">
                      {t('register.termsLink')}
                    </a>{' '}
                    {t('register.termsAnd')}{' '}
                    <a href={`${FRONTEND_URL}/privacy`} target="_blank" rel="noreferrer">
                      {t('register.privacyLink')}
                    </a>
                    {t('register.termsSuffix')}
                  </span>
                </label>
                {/* Outside the label, on purpose.
                    Inside it, a tap anywhere on these two lines would toggle the tick — so a
                    shopkeeper reading what is being collected would find himself agreeing to
                    it by reading, which is the opposite of what a notice is for. It sits
                    under the tick rather than above because the tick is what the eye lands on
                    and this is what it should then explain. */}
                <p className="auth-consent-note">{t('register.consentNote')}</p>
              </>
            )}

            <div className="wizard-actions">
              {step > 0 && (
                <button type="button" className="btn btn-secondary" onClick={goBack} disabled={loading}>
                  {t('register.back')}
                </button>
              )}
              {step < lastStep ? (
                <button type="button" className="btn btn-primary auth-cta" onClick={goNext}>
                  {t('register.next')}
                </button>
              ) : (
                <button type="submit" className="btn btn-primary auth-cta" disabled={loading}>
                  {loading && <SpinnerIcon size={17} />}
                  {loading ? t('register.submitting') : t('register.submit')}
                </button>
              )}
            </div>
          </form>
        </>
      )}

      <p className="auth-foot">
        {t('register.haveAccount')} <Link href="/login">{t('register.signIn')}</Link>
      </p>
      <p className="auth-note"><ShieldIcon size={13} />{t('auth.trust')}</p>
    </AuthLayout>
  );
}
