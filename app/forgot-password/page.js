'use client';

import { useState } from 'react';
import Link from 'next/link';
import { authFetch } from '../../lib/api';
import { apiErrorMessage } from '../../lib/apiErrors';
import { useLanguage } from '../components/LanguageProvider';
import AuthLayout from '../components/AuthLayout';
import AuthField from '../components/AuthField';
import { MailIcon, SpinnerIcon } from '../components/Icons';

// Step 1 of self-service password reset. Before this, a shopkeeper who forgot their
// password had to reach a platform admin to get back into their own shop.
export default function ForgotPasswordPage() {
  const { t, lang } = useLanguage();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const data = await authFetch('/api/auth/forgot-password', {
        body: JSON.stringify({ email }),
      });
      setSent(true);
      // Only ever present in development, where no mail provider is configured — keeps
      // the flow testable without silently swallowing the link.
      if (data.devResetUrl) setDevLink(data.devResetUrl);
    } catch (err) {
      setError(apiErrorMessage(lang, err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthLayout
      variant="signin"
      title={t('seller.forgotPasswordTitle')}
      subtitle={sent ? undefined : t('seller.forgotPasswordHint')}
    >
      {error && <div className="error-banner">{error}</div>}

      {sent ? (
        <>
          <div className="info-banner">{t('seller.forgotPasswordHint')}</div>
          {devLink && (
            <p style={{ wordBreak: 'break-all', fontSize: 'var(--fs-sm)' }}>
              <a href={devLink} className="nav-link">{devLink}</a>
            </p>
          )}
          <Link href="/login" className="btn btn-secondary auth-cta-secondary">
            {t('seller.backToLogin')}
          </Link>
        </>
      ) : (
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
            autoFocus
          />
          <button type="submit" className="btn btn-primary auth-cta" disabled={saving}>
            {saving && <SpinnerIcon size={17} />}
            {saving ? t('common.saving') : t('seller.sendResetLink')}
          </button>
        </form>
      )}

      <p className="auth-foot">
        <Link href="/login">{t('seller.backToLogin')}</Link>
      </p>
    </AuthLayout>
  );
}
