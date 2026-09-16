'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { useLanguage } from '../../components/LanguageProvider';
import { formatRupees } from '../../../lib/format';
import { formatNumber } from '../../../lib/hindiNumerals';
import { SkeletonCards } from '../../components/Skeleton';
import Illustration from '../../components/Illustration';
import { ClockIcon, BoxIcon, TrendUpIcon, ChevronRightIcon } from '../../components/Icons';

/**
 * "Paisa Bachao" — the money standing on the shelf.
 *
 * This is the screen a shopkeeper is meant to open on the day he installs the app, before
 * he has billed anything, and immediately see a number about HIS shop that no software he
 * has used before ever showed him. So the whole page is built around one rule: the rupee
 * figure at the top is the point, and everything under it exists only to prove that figure
 * and to give him something to press about it.
 *
 * Three sections, in the order the money is most urgently movable — a date that is coming
 * beats cash asleep in a carton, and both beat a margin quietly thinning. Each one carries
 * its own rupee subtotal and its own action, because a section that only informs is a
 * section he reads once and never opens again.
 *
 * The words matter more than the layout here, and they are deliberately not our words. "Maal
 * pada hai, bik nahi raha" is how a dukaandaar says it; "dead stock" and "idle inventory"
 * are how software says it, and the second one is why nobody reads these screens. Every
 * string on this page is in backend-free i18n (`shelf.*`) precisely so it can be argued
 * about in ten languages without touching this file.
 */
export default function ShelfMoneyPage() {
  const { t, lang } = useLanguage();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/api/seller/savings/shelf')
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const money = (value) => formatRupees(value, lang, { decimals: false });
  const count = (value) => formatNumber(value, lang);
  // "18 bottle bacha hai". Products always carry a unit, but a batch row populated from a
  // deleted product would leave a hole in the middle of the sentence rather than fail
  // loudly, so the gap is closed here instead of being left to show on a customer's screen.
  const qtyLeft = (qty, unit) => t('shelf.left', { qty: count(qty), unit: unit || '' }).replace(/\s{2,}/g, ' ').trim();

  /**
   * The three sections, already filtered down to the ones this shop actually has.
   *
   * Built as data rather than as three copies of the same JSX because the *order* is what
   * carries the meaning and an empty section must vanish completely — a "₹0, nothing here"
   * card between two real ones is how a screen stops looking like it knows the shop.
   */
  function buildSections() {
    if (!data) return [];
    const sections = [];

    if (data.expiry?.shown && data.expiry.total > 0) {
      sections.push({
        key: 'expiry',
        icon: <ClockIcon size={18} />,
        tone: 'urgent',
        title: t('shelf.expiry.title'),
        // A chemist's rows are lots of one strip, a kirana's are whole products. Saying
        // "8 items" to the chemist would be telling him something untrue about his own
        // shelf, and he is the shopkeeper this section was built for.
        meta:
          data.expiry.lots > 0
            ? t('shelf.expiry.metaLots', { count: count(data.expiry.count), days: count(data.expiry.windowDays) })
            : t('shelf.expiry.metaItems', { count: count(data.expiry.count), days: count(data.expiry.windowDays) }),
        note: t('shelf.expiry.note'),
        total: data.expiry.total,
        shownCount: data.expiry.items.length,
        totalCount: data.expiry.count,
        actions: [
          { label: t('shelf.expiry.action'), href: '/seller/purchase-returns' },
          { label: t('shelf.expiry.actionAlt'), href: '/seller/offers' },
        ],
        rows: data.expiry.items.map((item) => ({
          key: `${item.productId}-${item.batchNumber || 'plain'}`,
          href: `/seller/products?edit=${item.productId}`,
          name: item.name,
          meta: [
            t('shelf.expiry.days', { days: count(item.daysLeft) }),
            qtyLeft(item.quantity, item.unit),
            item.batchNumber || null,
          ]
            .filter(Boolean)
            .join(' · '),
          value: item.value,
        })),
      });
    }

    if (data.idle?.total > 0) {
      sections.push({
        key: 'idle',
        icon: <BoxIcon size={18} />,
        tone: 'warn',
        title: t('shelf.idle.title'),
        meta: t('shelf.idle.meta', { count: count(data.idle.count), days: count(data.idle.days) }),
        note: t('shelf.idle.note'),
        total: data.idle.total,
        shownCount: data.idle.items.length,
        totalCount: data.idle.count,
        actions: [{ label: t('shelf.idle.action'), href: '/seller/offers' }],
        rows: data.idle.items.map((item) => ({
          key: item.productId,
          href: `/seller/products?edit=${item.productId}`,
          name: item.name,
          meta: [
            qtyLeft(item.stock, item.unit),
            t('shelf.idle.standing', { days: count(item.standingSinceDays) }),
          ].join(' · '),
          value: item.value,
        })),
      });
    }

    if (data.rate?.total > 0) {
      sections.push({
        key: 'rate',
        icon: <TrendUpIcon size={18} />,
        tone: 'warn',
        title: t('shelf.rate.title'),
        meta: t('shelf.rate.meta', { count: count(data.rate.count) }),
        note: t('shelf.rate.note'),
        total: data.rate.total,
        shownCount: data.rate.items.length,
        totalCount: data.rate.count,
        actions: [{ label: t('shelf.rate.action'), href: '/seller/products' }],
        rows: data.rate.items.map((item) => ({
          key: item.productId,
          href: `/seller/products?edit=${item.productId}`,
          name: item.name,
          // Two cost prices with an arrow between them is the whole argument, in a form he
          // can check against the bill in his hand without reading a word.
          meta: [
            `${money(item.previousCost)} → ${money(item.currentCost)}`,
            qtyLeft(item.stock, item.unit),
          ].join(' · '),
          value: item.value,
          badge: item.belowCost ? t('shelf.rate.belowCost') : null,
        })),
      });
    }

    return sections;
  }

  const sections = buildSections();

  return (
    <>
      <div className="content-header">
        <h1>{t('shelf.title')}</h1>
        <p>{t('shelf.subtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <SkeletonCards count={3} height={120} />
      ) : !data?.hasAnything ? (
        <div className="empty-state-rich">
          <Illustration scene="shelf" />
          <p>{t('shelf.empty')}</p>
          <span className="shelf-empty-note">{t('shelf.emptyNote')}</span>
        </div>
      ) : (
        <>
          <div className="shelf-hero">
            <strong className="shelf-hero-value">{money(data.total)}</strong>
            <span className="shelf-hero-label">{t('shelf.savableLabel')}</span>
            <span className="shelf-hero-note">{t('shelf.savableNote', { count: count(sections.length) })}</span>
          </div>

          {sections.map((section, index) => (
            <section key={section.key} className={`shelf-section shelf-tone-${section.tone}`}>
              <div className="shelf-section-head">
                <span className="shelf-section-icon">{section.icon}</span>
                <span className="shelf-section-text">
                  <strong>{section.title}</strong>
                  <small>{section.meta}</small>
                </span>
                <strong className="shelf-section-value">{money(section.total)}</strong>
              </div>

              <p className="shelf-section-note">{section.note}</p>

              <div className="shelf-rows">
                {section.rows.map((row) => (
                  <Link key={row.key} href={row.href} className="shelf-row">
                    <span className="shelf-row-text">
                      <strong>
                        {row.name}
                        {row.badge && <em className="shelf-row-badge">{row.badge}</em>}
                      </strong>
                      <small>{row.meta}</small>
                    </span>
                    <span className="shelf-row-value">{money(row.value)}</span>
                    <ChevronRightIcon size={14} />
                  </Link>
                ))}
              </div>

              {section.totalCount > section.shownCount && (
                <p className="shelf-more">
                  {t('shelf.more', { count: count(section.totalCount - section.shownCount) })}
                </p>
              )}

              <div className="shelf-actions">
                {section.actions.map((action, actionIndex) => (
                  <Link
                    key={action.href}
                    href={action.href}
                    // Exactly one loud button on the page, and it belongs to whichever
                    // section came first — which is the most urgent one this shop has.
                    // Three primaries side by side is three shops' worth of shouting and
                    // tells him nothing about what to do first.
                    className={`btn btn-small ${index === 0 && actionIndex === 0 ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    {action.label}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </>
  );
}
