'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { formatRupees, formatQty } from '../../lib/format';
import { formatNumber } from '../../lib/hindiNumerals';
import { AlertIcon, TrendDownIcon, ChevronRightIcon, TargetIcon } from './Icons';
import { recordHref } from '../../lib/routeId';

/**
 * "Munafa kam kyun hai?"
 *
 * The Munafa card put a profit figure at the top of the dashboard, and in doing so created
 * a question the app could not answer. This is the answer: the handful of lines quietly
 * eating the margin, each one named, priced, and costed out in rupees a month.
 *
 * It renders nothing at all for most shops most of the time, and that is the design. A
 * panel that is always on screen saying "everything is fine" is a panel that gets scrolled
 * past forever; this one appears when there is money on the table and disappears when the
 * shopkeeper has cleared it, which is what makes it worth reading the day it shows up.
 *
 * Two kinds of row, and they are not the same news:
 *   LOSS — sold below what it cost. A mistake, usually a supplier rate that went up and a
 *          sticker that never followed. Listed at any size, with no threshold to clear.
 *   THIN — a real margin, just a very small one. This may well have been deliberate (a
 *          loss-leader, a competitive line), so it is stated as an opportunity rather than
 *          an error, and only when it is worth real money in a month.
 *
 * See backend/utils/marginCoach.js for why the target margin is the shop's own median and
 * never an invented industry figure.
 */
export default function MarginCoach() {
  const { t, lang } = useLanguage();
  const [data, setData] = useState(null);

  useEffect(() => {
    // Silence on failure. This is an extra, and an error banner here would be about a panel
    // the shopkeeper never asked for.
    apiFetch('/api/seller/margin-coach').then(setData).catch(() => {});
  }, []);

  if (!data?.hasAnything) return null;

  const money = (value) => formatRupees(value, lang, { decimals: false });
  const count = (value) => formatNumber(value, lang);

  // Stated only when there is a benchmark behind it. With too few costed items the shop has
  // no median worth the name, so the losing lines are still named — they need no benchmark
  // to be wrong — and no rupee figure is claimed.
  const hasOpportunity = data.targetMargin !== null && data.monthlyOpportunity > 0;

  return (
    <div className="coach-panel">
      <div className="coach-head">
        {/* A target, and amber. This panel is about a price that has drifted off where it
            was aimed — the same amber the figure below already uses, now carried by the
            mark as well so the panel is identifiable before a word is read. */}
        <span className="mod-chip is-sm mod-tone-3">
          <TargetIcon size={15} />
        </span>
        <div className="coach-head-text">
          <span className="coach-head-label">{t('seller.coach.title')}</span>
          <strong className="coach-head-value">
            {hasOpportunity ? money(data.monthlyOpportunity) : count(data.totalFlagged)}
          </strong>
          <span className="coach-head-note">
            {hasOpportunity
              ? t('seller.coach.subtitle', { count: count(data.totalFlagged) })
              : t('seller.coach.subtitleNoTarget', { count: count(data.totalFlagged) })}
          </span>
        </div>
      </div>

      <div className="coach-rows">
        {data.items.map((item) => (
          <Link
            key={item.productId || item.name}
            href={item.productId ? recordHref('/seller/products/[id]', item.productId) : '/seller/products'}
            className={`coach-row coach-row-${item.severity}`}
          >
            <span className="coach-row-icon">
              {item.severity === 'loss' ? <TrendDownIcon size={15} /> : <AlertIcon size={15} />}
            </span>
            <span className="coach-row-text">
              <strong>{item.name}</strong>
              <small>
                {t('seller.coach.sold', {
                  qty: formatQty(item.quantitySold, lang),
                  unit: item.unit || '',
                })}
                {' · '}
                {t('seller.coach.margin', { pct: count(item.marginPercent) })}
              </small>
            </span>

            {/* The fix, in the only form that can be acted on without thinking: the price it
                is at now, and the price it should be at. A percentage would need arithmetic
                done at the counter; two rupee figures do not. */}
            {item.suggestedPrice ? (
              <span className="coach-row-fix">
                <span className="coach-from">{money(item.pricePerUnit)}</span>
                <span className="coach-arrow" aria-hidden="true">→</span>
                <strong>{money(item.suggestedPrice)}</strong>
              </span>
            ) : (
              <span className="coach-row-fix">
                <strong>{money(item.pricePerUnit)}</strong>
              </span>
            )}

            <span className="coach-row-gain">
              {item.monthlyGain ? `+${money(item.monthlyGain)}` : t('seller.coach.belowCost')}
            </span>
            <ChevronRightIcon size={14} />
          </Link>
        ))}
      </div>

      {/* How much of the shelf this panel could see at all. A shop at 20% coverage must not
          read an empty-ish list as "everything else is fine" — the rest was never examined,
          because an item with no cost price cannot be judged. */}
      {data.coverage !== null && data.coverage < 0.8 && (
        <Link href="/seller/products?cost=missing" className="coach-coverage">
          <span>{t('seller.coach.coverage', { pct: count(Math.round(data.coverage * 100)) })}</span>
          <ChevronRightIcon size={14} />
        </Link>
      )}
    </div>
  );
}
