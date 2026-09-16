'use client';

import Link from 'next/link';
import { useLanguage } from './LanguageProvider';
import { formatRupees } from '../../lib/format';
import { formatNumber } from '../../lib/hindiNumerals';
import { TrendUpIcon, TrendDownIcon, ZapIcon, ChevronRightIcon } from './Icons';

/**
 * "Aaj ka munafa."
 *
 * The dashboard could already tell a shopkeeper what he SOLD today — so can his drawer,
 * and so can every competitor. What none of them tell him is what he EARNED. Profit was
 * buried as the second of ten identical stat tiles, in the same grey as the count of
 * products, which is not where you put the one number that decides whether the shop is
 * worth opening tomorrow.
 *
 * The hard part is not the arithmetic, it is refusing to print it.
 *
 * A bill line with no cost price entered is indistinguishable from one that genuinely cost
 * nothing, so its entire selling price reads as margin. A shop that has never filled in a
 * cost price would therefore be shown its whole day's takings as "profit" — the exact lie
 * the Insights page used to tell at a flat 95.24% on every dish in a restaurant. So the
 * server sends `profitCoverage` beside the figure: the share of today's sales that came
 * from lines with a real cost behind them. Below the trust threshold this card shows no
 * profit at all and shows the fix instead, which is the only honest output and, not by
 * coincidence, the thing that makes the number real from tomorrow onwards.
 */

/**
 * Moment 5 — today's takings against yesterday's, as a bar that fills on load.
 *
 * The bar is the point, not decoration: a bare "₹4,200" tells a shopkeeper nothing
 * without the number they are used to. Framed as the gap to close (or the lead held),
 * because that is the sentence they would actually say out loud.
 *
 * Hidden entirely on a shop's first day — with no yesterday to compare against, a bar
 * at 0% or 100% would be a lie either way.
 */
function DayProgress({ today, yesterday, t }) {
  if (!Number.isFinite(today) || !Number.isFinite(yesterday) || yesterday <= 0) return null;

  const ratio = today / yesterday;
  const pct = Math.max(0, Math.min(1, ratio));
  const ahead = today >= yesterday;
  const gap = Math.abs(today - yesterday);

  return (
    <div className="day-progress">
      <div className="day-progress-line">
        <span className={ahead ? 'day-progress-ahead' : ''}>
          {ahead
            ? t('seller.dayAhead', { amount: `₹${Math.round(gap)}` })
            : t('seller.dayBehind', { amount: `₹${Math.round(gap)}` })}
        </span>
        <span className="day-progress-ref">{t('seller.dayVsYesterday', { amount: `₹${Math.round(yesterday)}` })}</span>
      </div>
      <div className="day-progress-bar moment-fill" style={{ '--fill': `${(pct * 100).toFixed(1)}%` }}>
        <i />
      </div>
    </div>
  );
}

// 80%+ of sales costed before the figure is stated plainly. Same threshold and the same
// reasoning as marginConfidence() on the Insights page — the two screens must not disagree
// about whether a shop's margin is knowable.
const COVERAGE_TRUSTED_AT = 0.8;

/**
 * Which of the four things this card can say.
 *
 * The quiet-day case is decided by the TILL — sales and the bill count — and never by
 * whether a coverage figure arrived. It used to be read off `profitCoverage === null`,
 * on the reasoning that the server only sends null when there were no sales to measure.
 * True of the server, and still the wrong thing to key on: coverage is also absent when
 * the response simply didn't carry the field (an API older than this card, a partial
 * payload), and then the card announced "no bills yet today" directly above SALES ₹25,000.
 * A card that contradicts the number printed beside it is worse than one that says nothing.
 *
 * So the two questions are asked separately: has anything sold, and can the profit on it
 * be vouched for. A missing coverage answers the second question with "no", which is the
 * safe direction — it withholds a figure rather than inventing one.
 */
export function profitState(stats) {
  const sales = Number(stats.todaysSales) || 0;
  const bills = Number(stats.dailyBillCount) || 0;

  if (sales <= 0) return bills > 0 ? 'washedOut' : 'noSales';

  const coverage = stats.profitCoverage;
  if (coverage === null || coverage === undefined || coverage <= 0) return 'none';
  if (coverage < COVERAGE_TRUSTED_AT) return 'partial';
  return 'ok';
}

export default function MunafaCard({ stats }) {
  const { t, lang } = useLanguage();

  // Rendered only once the numbers are in. The page already shows a stat skeleton while
  // this loads, and a card that flashes ₹0 before flipping to ₹4,120 is worse than one
  // that arrives late — the first figure is the one that gets believed.
  if (!stats) return null;

  const money = (value) => formatRupees(value, lang, { decimals: false });
  const count = (value) => formatNumber(value, lang);

  const state = profitState(stats);
  const showFigure = state === 'ok' || state === 'partial';
  // A quiet day and a day that was billed and then all returned both honestly total ₹0.
  // Only "sales happened, we cannot vouch for the margin" gets the blank.
  const showZero = state === 'noSales' || state === 'washedOut';

  // Only against a real yesterday, and only when both days can actually be compared. A
  // "+100%" on a shop's first trading day is a lie it would be delighted to believe.
  const yesterdayProfit = Number(stats.profitYesterday) || 0;
  let delta = null;
  if (showFigure && yesterdayProfit > 0) {
    const change = ((stats.profitToday - yesterdayProfit) / yesterdayProfit) * 100;
    // Under a percent either way is noise, and an arrow on noise teaches people to stop
    // reading the arrows.
    if (Math.abs(change) >= 1) {
      delta = {
        dir: change > 0 ? 'up' : 'down',
        label: t(change > 0 ? 'seller.munafa.up' : 'seller.munafa.down', {
          percent: count(Math.abs(Math.round(change))),
        }),
      };
    }
  }

  const streak = stats.streak;
  let streakLabel = null;
  if (streak?.days >= 3) {
    streakLabel = streak.capped
      ? t('seller.munafa.streakCapped')
      // A streak that still has yesterday but not today is not broken — it is one bill away
      // from surviving, which is a far better thing to say at 11am than a bare count.
      : streak.billedToday
        ? t('seller.munafa.streak', { days: count(streak.days) })
        : t('seller.munafa.streakAtRisk', { days: count(streak.days) });
  }

  return (
    <div className="munafa-card">
      <div className="munafa-head">
        <span className="munafa-label">{t('seller.munafa.title')}</span>
        {streakLabel && (
          <span className={`munafa-streak${streak.billedToday ? '' : ' at-risk'}`}>
            <ZapIcon size={13} />
            {streakLabel}
          </span>
        )}
      </div>

      <div className="munafa-body">
        <div className="munafa-figure">
          <strong
            className={`munafa-value${showFigure || showZero ? '' : ' is-unknown'}${
              showFigure && Number(stats.profitToday) > 0 ? ' is-earning' : ''
            }`}
          >
            {showZero ? money(0) : showFigure ? money(stats.profitToday) : '—'}
          </strong>
          {delta && (
            <span className={`munafa-delta munafa-delta-${delta.dir}`}>
              {delta.dir === 'up' ? <TrendUpIcon size={13} /> : <TrendDownIcon size={13} />}
              {delta.label}
            </span>
          )}
        </div>

        {/* Sales, margin and the bill count sit beside the profit, not above it, and
            deliberately smaller. Sales is the number a shopkeeper already knows;
            putting it back at hero size is how profit got buried in the first place.

            They are one bordered group rather than three figures spread along the
            card's width — at full width the last of them was landing 900px from the
            profit it supports, so reading "₹2,486 on ₹8,240" meant crossing the whole
            card. The bill count joined them on 2026-09-03 and left the KPI grid below:
            these four are the day, and the day belongs in one place. */}
        <div className="munafa-side">
          <div className="munafa-side-item">
            <span>{t('seller.munafa.sales')}</span>
            <strong>{money(stats.todaysSales)}</strong>
          </div>
          <div className="munafa-side-item">
            <span>{t('seller.munafa.margin')}</span>
            <strong>
              {showFigure && stats.marginToday !== null
                ? `${state === 'partial' ? '≤' : ''}${count(Math.round(stats.marginToday))}%`
                : '—'}
            </strong>
          </div>
          <div className="munafa-side-item">
            <span>{t('seller.stats.dailyBillCount')}</span>
            <strong>{count(stats.dailyBillCount || 0)}</strong>
          </div>
        </div>
      </div>

      {/* One sentence under the figure, and which one it is IS the honesty of this card. */}
      {state === 'none' ? (
        <Link href="/seller/products?cost=missing" className="munafa-fix">
          <span>{t('seller.munafa.noCost')}</span>
          <ChevronRightIcon size={14} />
        </Link>
      ) : state === 'partial' ? (
        <Link href="/seller/products?cost=missing" className="munafa-fix">
          <span>{t('seller.munafa.partial', { pct: count(Math.round(stats.profitCoverage * 100)) })}</span>
          <ChevronRightIcon size={14} />
        </Link>
      ) : (
        <p className="munafa-note">
          {state === 'noSales'
            ? t('seller.munafa.noBills')
            : state === 'washedOut'
              // Bills were written and every one of them came back. Saying "no bills yet"
              // here would be flatly untrue, and the shopkeeper knows it better than we do.
              ? t('seller.munafa.washedOut', { bills: count(stats.dailyBillCount || 0) })
              : yesterdayProfit > 0
                ? t('seller.munafa.vsYesterday', { amount: money(yesterdayProfit) })
                : t('seller.munafa.firstDay')}
        </p>
      )}

      {/* The day against yesterday, at the foot of the card. It used to be a 200px
          sliver at the right edge of the page header — a statement about the day's
          takings parked in the furniture, where nothing around it gave it a scale.
          Under the profit figure it is read as what it is: how today is going. */}
      <div className="munafa-progress">
        <DayProgress today={stats.todaysSales} yesterday={stats.yesterdaysSales} t={t} />
      </div>
    </div>
  );
}
