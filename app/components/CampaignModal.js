'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useLanguage } from './LanguageProvider';
import { XIcon, SparkleIcon } from './Icons';

/**
 * The interrupting surface — a campaign that stops the shopkeeper and asks for an answer.
 *
 * The most expensive thing the platform can do to its own users, which is why the engine
 * charges it against a daily budget and refuses it during quiet hours (see
 * config/growth.js). Nothing about that policy lives here; this component's only job is to
 * draw the thing well and get out of the way cleanly.
 *
 * Deliberately NOT a `.panel` child and deliberately portalled: `.panel` runs a fadeInUp
 * whose leftover transform makes it a containing block, and a fixed-position overlay
 * rendered inside one is trapped behind its edges.
 */
export default function CampaignModal({ item, onSeen, onClick, onDismiss }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Counted when it is actually on screen, not when it was matched — a popup that lost a
  // race with a navigation never spends the shop's once-a-day budget.
  useEffect(() => {
    if (mounted) onSeen?.();
  }, [mounted, onSeen]);

  useEffect(() => {
    function onKey(event) {
      // An undismissable campaign still closes on Escape. A popup with genuinely no way out
      // is not a nudge, it is a hostage situation, and the frequency rules already stop this
      // from appearing often enough to need one.
      if (event.key === 'Escape') onDismiss?.();
    }
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onDismiss]);

  if (!mounted || !item) return null;

  const isAd = item.kind === 'ad';
  const external = /^https?:\/\//i.test(item.ctaHref || '');

  function act() {
    onClick?.();
    if (!item.ctaHref) return onDismiss?.();
    if (external) window.open(item.ctaHref, '_blank', 'noopener,noreferrer');
    else router.push(item.ctaHref);
    onDismiss?.();
  }

  return createPortal(
    <div
      className="growth-modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onDismiss?.()}
    >
      <div className={`growth-modal tone-${item.tone}`} role="dialog" aria-modal="true" aria-labelledby="growth-modal-title">
        <button type="button" className="growth-modal-close" onClick={onDismiss} aria-label={t('growth.dismiss')}>
          <XIcon size={16} />
        </button>

        {item.imageUrl && <img className="growth-modal-image" src={item.imageUrl} alt="" />}

        {(item.badge || isAd) && (
          <span className={`growth-badge${isAd ? ' is-ad' : ''}`}>
            {!isAd && <SparkleIcon size={11} />}
            {isAd ? item.badge || t('growth.sponsored') : item.badge}
          </span>
        )}

        {item.title && <h2 id="growth-modal-title">{item.title}</h2>}
        {item.body && <p className="growth-modal-body">{item.body}</p>}

        {isAd && item.advertiser?.name && (
          <span className="growth-advertiser">{t('growth.byAdvertiser', { name: item.advertiser.name })}</span>
        )}

        <div className="growth-modal-actions">
          <button type="button" className="growth-secondary" onClick={onDismiss}>
            {item.secondaryLabel || t('growth.later')}
          </button>
          {item.ctaLabel && (
            <button type="button" className="btn btn-primary btn-inline" onClick={act}>
              {item.ctaLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
