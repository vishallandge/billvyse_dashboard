'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '../../../../lib/api';
import { useLanguage } from '../../../components/LanguageProvider';
import { useToast } from '../../../components/Toast';
import { SkeletonStats } from '../../../components/Skeleton';

/**
 * A wholesaler's invite link, opened by a shop that buys from him.
 *
 * "Mujhe apna supplier banao" — he sent the link, so his consent is already given; this screen
 * is the shop's half: see who is asking, and add him in one tap. Nothing is written until the
 * button is pressed, and the server re-checks everything the preview showed (link valid and
 * unexpired, not the shop's own link, his Sell to Shops still switched on, this shop's plan
 * includes suppliers).
 *
 * Lives under /seller/suppliers because that is this shop's module — the buyer does not need
 * Sell to Shops switched on to add a supplier.
 */
const ERRORS = {
  SUPPLY_INVITE_INVALID: 'supply.errInviteInvalid',
  SUPPLY_INVITE_SELF: 'supply.errInviteSelf',
  SUPPLY_INVITE_OFF: 'supply.errInviteOff',
  SUPPLY_INVITE_NO_SUPPLIERS: 'supply.errInviteNoSuppliers',
};

// A JWT is three base64url parts; anything else is not worth a request.
const TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export default function SupplierInvitePage() {
  return (
    <Suspense fallback={<SkeletonStats />}>
      <InviteScreen />
    </Suspense>
  );
}

function InviteScreen() {
  const { t } = useLanguage();
  const toast = useToast();
  const router = useRouter();
  const token = useSearchParams().get('t') || '';
  const validShape = TOKEN_RE.test(token) && token.length < 2000;

  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(validShape ? '' : t('supply.errInviteInvalid'));
  const [loading, setLoading] = useState(validShape);
  const [busy, setBusy] = useState(false);

  const say = (err) => (ERRORS[err?.code] ? t(ERRORS[err.code]) : err?.message || t('supply.errInviteInvalid'));

  useEffect(() => {
    if (!validShape) return;
    apiFetch(`/api/seller/supply/invite/${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch((err) => setError(say(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, validShape]);

  async function add() {
    setBusy(true);
    try {
      const data = await apiFetch(`/api/seller/supply/invite/${encodeURIComponent(token)}/accept`, { method: 'POST' });
      toast.success(t('supply.inviteJoinDone', { name: data.name || invite?.name || '' }));
      router.push('/seller/suppliers');
    } catch (err) {
      toast.error(say(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <SkeletonStats />;

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('supply.inviteJoinTitle')}</h1>
        </div>
      </div>
      <div className="panel">
        {error ? (
          <p className="empty-state">{error}</p>
        ) : invite?.alreadyAdded ? (
          <>
            <p>{t('supply.inviteJoinAlready', { name: invite.name })}</p>
            <button className="btn btn-secondary btn-small btn-inline" onClick={() => router.push('/seller/suppliers')}>
              {t('supply.inviteJoinGoSuppliers')}
            </button>
          </>
        ) : (
          <>
            {/* Who is asking, before anything is written — the details a shop needs to tell
                the real wholesaler from somebody who opened a shop under the same name. */}
            <div className="record-card" style={{ marginBottom: '0.9rem' }}>
              <div className="record-card-main">
                <span className="record-card-title">
                  {invite?.name}{' '}
                  {invite?.verified ? (
                    <span className="badge badge-approved">{t('supply.verifiedBadge')}</span>
                  ) : (
                    <span className="badge badge-pending">{t('supply.notVerifiedBadge')}</span>
                  )}
                </span>
                <div className="record-card-meta">
                  {invite?.phone && <span>{invite.phone}</span>}
                  {invite?.area && <span>{invite.area}</span>}
                  {invite?.gstin && <span>GSTIN {invite.gstin}</span>}
                  {invite?.since && <span>{t('supply.inviteJoinSince', { year: invite.since })}</span>}
                </div>
              </div>
            </div>
            {invite?.lookalike && (
              <p className="error-text" role="alert" style={{ marginBottom: '0.9rem' }}>
                {t('supply.inviteJoinLookalike', { name: invite.lookalike.name, phone: invite.lookalike.phone || '—' })}
              </p>
            )}
            {!invite?.verified && <p className="field-hint" style={{ marginBottom: '0.9rem' }}>{t('supply.inviteJoinUnverifiedHint')}</p>}
            <p style={{ marginBottom: '0.9rem' }}>{t('supply.inviteJoinBodyShort')}</p>
            <button className="btn btn-primary" disabled={busy} onClick={add}>
              {busy ? t('common.saving') : t('supply.inviteJoinAdd')}
            </button>
          </>
        )}
      </div>
    </>
  );
}
