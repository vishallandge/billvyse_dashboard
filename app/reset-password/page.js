'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '../../lib/api';
import { apiErrorMessage } from '../../lib/apiErrors';
import { useLanguage } from '../components/LanguageProvider';
import AuthLayout from '../components/AuthLayout';
import AuthField from '../components/AuthField';
import { LockIcon, SpinnerIcon, CheckCircleIcon } from '../components/Icons';

// Step 2 of self-service password reset — the page the emailed link opens. Deliberately
// unauthenticated and outside the dashboard shell: whoever lands here is, by definition,
// locked out.
export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary under Next's App Router, matching the
  // login page pattern.
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') || '';
  const email = params.get('email') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (password !== confirm) {
      setError(t('seller.passwordsDoNotMatch'));
      return;
    }
    setSaving(true);
    try {
      await authFetch('/api/auth/reset-password', {
        body: JSON.stringify({ token, email, password }),
      });
      setDone(true);
      setTimeout(() => router.push('/login'), 2500);
    } catch (err) {
      setError(apiErrorMessage(lang, err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthLayout variant="signin" title={t('seller.resetPasswordTitle')}>
      {error && <div className="error-banner">{error}</div>}

      {done ? (
        <>
          <div className="info-banner"><CheckCircleIcon size={16} /> {t('seller.resetPasswordCta')} — {t('seller.backToLogin')}…</div>
          <Link href="/login" className="btn btn-primary auth-cta-secondary">
            {t('seller.backToLogin')}
          </Link>
        </>
      ) : !token || !email ? (
        <>
          <p className="auth-sub">{t('seller.forgotPasswordHint')}</p>
          <Link href="/login" className="btn btn-secondary auth-cta-secondary">
            {t('seller.backToLogin')}
          </Link>
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          <AuthField
            id="password"
            type="password"
            label={t('seller.newPassword')}
            icon={<LockIcon size={17} />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
            autoFocus
            strength
          />
          <AuthField
            id="confirm"
            type="password"
            label={t('seller.confirmPassword')}
            icon={<LockIcon size={17} />}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
          <button type="submit" className="btn btn-primary auth-cta" disabled={saving}>
            {saving && <SpinnerIcon size={17} />}
            {saving ? t('common.saving') : t('seller.resetPasswordCta')}
          </button>
        </form>
      )}

      <p className="auth-foot">
        <Link href="/login">{t('seller.backToLogin')}</Link>
      </p>
    </AuthLayout>
  );
}
