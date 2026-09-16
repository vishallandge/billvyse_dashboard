'use client';

import { formatRupees, formatDate } from '../../lib/format';
import { useLanguage } from './LanguageProvider';

/**
 * What this shop last paid for this item, under the rate box on a purchase line.
 *
 * The single most useful thing the app can put in front of a shopkeeper entering a bill, and
 * until now it had nowhere to come from. A buying rate is never invented — it is checked
 * against last time. Without the anchor the only way to do that was to remember, and what a
 * shopkeeper actually does instead is type whatever the salesman says.
 *
 * Three states, one element (never a fragment — see the shared-component rule):
 *
 *   nothing typed, history exists   the anchor, tappable, fills the box
 *   typed and close to last time    the anchor, quiet
 *   typed and far from last time    the warning, with the direction and the old rate
 *
 * The threshold comes from the server with the rates (`rateAlertPercent`) because it depends
 * on the trade: 5% is an event for a chemist and a Tuesday for a vegetable shop.
 */
/**
 * ₹13 typed as ₹31.
 *
 * Mirrors `looksTransposed` in backend/utils/purchasePrice.js — the same rule has to run
 * here because the warning appears as the shopkeeper types, and a round trip per keystroke
 * is not a thing to build. The backend copy is the source of truth; if these two ever
 * disagree, this one is the bug. (Same arrangement as lib/purchaseTotals.js.)
 *
 * A pure magnitude test misses most real mis-keys: 31 is only 2.4× 13, well under any "that
 * cannot be a price" rule, yet it is obviously the same two digits reversed.
 */
function looksTransposed(typed, last) {
  if (!Number.isInteger(typed) || !Number.isInteger(last)) return false;
  const a = String(typed);
  const b = String(last);
  if (a.length !== b.length || a.length < 2 || a === b) return false;
  return a.split('').reverse().join('') === b || [...a].sort().join('') === [...b].sort().join('');
}

export default function PurchaseRateAnchor({ anchor, typedRate, thresholdPercent = 15, onUse, onOpenHistory }) {
  const { t, lang } = useLanguage();

  if (!anchor || !(anchor.costPrice > 0)) {
    // No history is worth saying once, quietly: it tells the shopkeeper the blank is the
    // app's ignorance rather than his mistake.
    return <span className="rate-anchor is-quiet">{t('purchase.firstBuy')}</span>;
  }

  const typed = Number(typedRate);
  const last = Number(anchor.costPrice);
  const hasTyped = typedRate !== '' && typedRate !== null && Number.isFinite(typed) && typed > 0;
  const changePercent = hasTyped && last > 0 ? ((typed - last) / last) * 100 : 0;
  const beyond = hasTyped && Math.abs(changePercent) >= thresholdPercent;
  // Two ways a number stops being a plausible price: a different order of magnitude, or the
  // same digits in the wrong order. Said differently from a price rise so the shopkeeper
  // checks his typing rather than the market.
  const looksLikeTypo =
    hasTyped && last > 0 && (typed >= last * 3 || typed <= last / 3 || looksTransposed(typed, last));

  if (beyond) {
    return (
      <span className={`rate-anchor ${looksLikeTypo ? 'is-typo' : changePercent > 0 ? 'is-up' : 'is-down'}`}>
        {looksLikeTypo
          ? t('purchase.rateTypoWarn', { last: formatRupees(last, lang) })
          : changePercent > 0
            ? t('purchase.rateUpWarn', { pct: Math.round(changePercent), last: formatRupees(last, lang) })
            : t('purchase.rateDownWarn', { pct: Math.round(Math.abs(changePercent)), last: formatRupees(last, lang) })}
        {onOpenHistory && (
          <button type="button" className="rate-anchor-link" onClick={onOpenHistory}>
            {t('purchase.seeHistory')}
          </button>
        )}
      </span>
    );
  }

  return (
    <span className="rate-anchor">
      <button
        type="button"
        className="rate-anchor-fill"
        // Only fills an empty box. Overwriting a rate the shopkeeper has just read off the
        // paper in his hand would be the app arguing with the bill.
        disabled={hasTyped}
        onClick={() => onUse?.(anchor.costPrice)}
        data-tip={hasTyped ? undefined : t('purchase.useLastRate')}
      >
        {t('purchase.lastRate', { rate: formatRupees(last, lang) })}
      </button>
      <span className="rate-anchor-meta">
        {anchor.date ? formatDate(anchor.date, lang) : ''}
        {anchor.supplierName ? ` · ${anchor.supplierName}` : ''}
        {/* A scheme is the real discount and it is what a rate comparison hides. Shown
            beside the rate so "₹100" and "₹100 with 10+2" are never mistaken for each
            other. */}
        {anchor.scheme ? ` · ${anchor.scheme}` : ''}
      </span>
      {onOpenHistory && anchor.buyCount > 1 && (
        <button type="button" className="rate-anchor-link" onClick={onOpenHistory}>
          {t('purchase.seeHistory')}
        </button>
      )}
    </span>
  );
}
