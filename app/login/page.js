'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
// Nothing to save: the server sets an httpOnly session cookie on the login response and
// the browser attaches it from then on. There is no token in the body to store.
import { authFetch } from '../../lib/api';
import { markJustSignedIn } from '../../lib/session';
import { apiErrorMessage } from '../../lib/apiErrors';
import { useLanguage } from '../components/LanguageProvider';
import GoogleSignInButton, { GOOGLE_ENABLED } from '../components/GoogleSignInButton';
import AuthLayout from '../components/AuthLayout';
import AuthField from '../components/AuthField';
import PhoneField from '../components/PhoneField';
import { MailIcon, LockIcon, PhoneIcon, ShieldIcon, SpinnerIcon } from '../components/Icons';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, lang } = useLanguage();
  const [mode, setMode] = useState('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // The mobile door — a second, independent form from the email/password one above.
  // Kept in its own little state group rather than reusing `email`/`password`/`error`
  // so switching tabs never leaves half of a typed form behind on the wrong screen.
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [devOtp, setDevOtp] = useState('');

  // Shared by both paths so a Google login lands in exactly the same place a password
  // login would, including an honoured ?next=.
  function goAfterLogin(user) {
    // Read by DashboardShell on the other side of this redirect, once and only once.
    markJustSignedIn();
    const next = searchParams.get('next');
    if (next) router.replace(next);
    else if (user.role === 'superadmin') router.replace('/admin');
    else router.replace('/seller');
  }

  async function handleGoogleCredential(credential) {
    setError('');
    setLoading(true);
    try {
      // authFetch already sends credentials and the CSRF header; the cookie the server
      // sets on the response is what the session is.
      const data = await authFetch('/api/auth/google', { body: JSON.stringify({ credential }) });

      // No account for this Google address yet. Rather than dead-ending on the login
      // screen, carry the same credential over to signup so the shopkeeper only ever
      // picks their Google account once.
      if (data.needsSignup) {
        try {
          /**
           * The PROFILE only — a name, an email and a picture url, which is what the wizard
           * prefills with and none of which proves anything.
           *
           * The Google token itself used to travel here too, and that was the problem: any
           * script on the page could read it out of sessionStorage and sign up as that
           * person. The server now parks it in an httpOnly cookie of its own and reads it
           * back when the wizard posts, so the browser never holds it across the hop.
           */
          sessionStorage.setItem('dukaan_google_signup', JSON.stringify({ profile: data.profile }));
        } catch {
          // Private-mode browsers block sessionStorage; signup just starts empty.
        }
        router.replace('/register-seller?google=1');
        return;
      }

      goAfterLogin(data.user);
    } catch (err) {
      setError(apiErrorMessage(lang, err));
      setLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await authFetch('/api/auth/login', {
        body: JSON.stringify({ email, password }),
      });
      goAfterLogin(data.user);
    } catch (err) {
      // The password was right; the mailbox was never confirmed. This is a dead end on a
      // login screen — there is no code box here — so it hands the person over to the
      // sign-up wizard's verify step with the address already in hand, rather than showing
      // a refusal they can do nothing about.
      if (err.code === 'AUTH_EMAIL_NOT_VERIFIED') {
        router.replace(`/register-seller?verify=${encodeURIComponent(err.data?.email || email)}`);
        return;
      }
      setError(apiErrorMessage(lang, err));
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setError('');
    setPhoneError('');
  }

  async function handleSendOtp(event) {
    event.preventDefault();
    setPhoneError('');
    setPhoneLoading(true);
    try {
      const data = await authFetch('/api/auth/phone/request-otp', { body: JSON.stringify({ phone }) });
      setOtpSent(true);
      // Only ever present when no SMS provider is configured — see isOtpEchoAllowed on
      // the server. Lets a fresh clone sign in over phone without SMS keys.
      setDevOtp(data.devOtp || '');
    } catch (err) {
      setPhoneError(apiErrorMessage(lang, err));
    } finally {
      setPhoneLoading(false);
    }
  }

  async function handleVerifyOtp(event) {
    event.preventDefault();
    setPhoneError('');
    setPhoneLoading(true);
    try {
      const data = await authFetch('/api/auth/phone/verify-otp', { body: JSON.stringify({ phone, otp }) });
      goAfterLogin(data.user);
    } catch (err) {
      setPhoneError(apiErrorMessage(lang, err));
      setPhoneLoading(false);
    }
  }

  function changeNumber() {
    setOtpSent(false);
    setOtp('');
    setPhoneError('');
    setDevOtp('');
  }

  return (
    <AuthLayout variant="signin" title={t('auth.signInTitle')} subtitle={t('auth.signInSub')}>
      {/* Above the form on purpose: for a shopkeeper on Android this is one tap and no
          typing, so it should be the first thing offered, not the fallback. Only in the
          email tab — Google is itself a "no password to remember" door, and putting it
          beside a mobile-OTP door that promises the same thing is one convenience too many. */}
      {GOOGLE_ENABLED && mode === 'email' && (
        <>
          <GoogleSignInButton onCredential={handleGoogleCredential} text="signin_with" disabled={loading} />
          <div className="auth-divider"><span>{t('login.or')}</span></div>
        </>
      )}

      <div className="segmented" role="group" style={{ marginBottom: '1rem' }}>
        <button type="button" className={mode === 'email' ? 'active' : ''} onClick={() => switchMode('email')}>
          <MailIcon size={14} /> {t('login.emailTab')}
        </button>
        <button type="button" className={mode === 'phone' ? 'active' : ''} onClick={() => switchMode('phone')}>
          <PhoneIcon size={14} /> {t('login.mobileTab')}
        </button>
      </div>

      {mode === 'email' ? (
        <>
          {error && <div className="error-banner">{error}</div>}
          <form onSubmit={handleSubmit}>
            <AuthField
              id="email"
              type="email"
              label={t('login.email')}
              icon={<MailIcon size={17} />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <AuthField
              id="password"
              type="password"
              label={t('login.password')}
              icon={<LockIcon size={17} />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />

            {/* Sits with the password rather than in the footer: this is the moment somebody
                realises they have forgotten it, not after they have read the sign-up link. */}
            <p className="auth-inline-link">
              <Link href="/forgot-password">{t('seller.forgotPassword')}</Link>
            </p>

            <button type="submit" className="btn btn-primary auth-cta" disabled={loading}>
              {loading && <SpinnerIcon size={17} />}
              {loading ? t('login.submitting') : t('login.submit')}
            </button>
          </form>
        </>
      ) : (
        <>
          {/* The message goes under whichever box it is about — the number on the first
              step, the code on the second. A banner above the form made the reader look at
              two fields to work out which one had been refused. */}
          <form onSubmit={otpSent ? handleVerifyOtp : handleSendOtp}>
            {!otpSent ? (
              <PhoneField
                id="phone"
                variant="auth"
                label={t('login.mobile')}
                value={phone}
                onChange={setPhone}
                error={phoneError}
                autoComplete="tel"
                required
              />
            ) : (
              <>
                <p className="auth-inline-link">
                  {t('login.otpSentTo', { phone })}{' '}
                  <button type="button" className="link-btn" onClick={changeNumber}>
                    {t('login.changeNumber')}
                  </button>
                </p>
                <AuthField
                  id="otp"
                  type="text"
                  label={t('login.otp')}
                  icon={<ShieldIcon size={17} />}
                  error={phoneError}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  // Only rendered when there is genuinely no SMS provider on this server —
                  // never in a real deployment. Saves a fresh clone from needing SMS keys
                  // just to sign in.
                  hint={devOtp ? `Dev OTP: ${devOtp}` : undefined}
                />
              </>
            )}

            <button type="submit" className="btn btn-primary auth-cta" disabled={phoneLoading}>
              {phoneLoading && <SpinnerIcon size={17} />}
              {otpSent
                ? phoneLoading ? t('login.verifying') : t('login.verifyOtp')
                : phoneLoading ? t('login.sendingOtp') : t('login.sendOtp')}
            </button>

            {otpSent && (
              <p className="auth-inline-link">
                <button type="button" className="link-btn" onClick={handleSendOtp} disabled={phoneLoading}>
                  {t('login.resendOtp')}
                </button>
              </p>
            )}
          </form>
        </>
      )}

      <p className="auth-foot">
        {t('login.newSeller')} <Link href="/register-seller">{t('login.createAccount')}</Link>
      </p>
      <p className="auth-note"><ShieldIcon size={13} />{t('auth.trust')}</p>
    </AuthLayout>
  );
}
