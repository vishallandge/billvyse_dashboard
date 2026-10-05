'use client';

import Link from 'next/link';
import { useLanguage } from './LanguageProvider';
import { formatRupees } from '../../lib/format';
import { formatNumber } from '../../lib/hindiNumerals';
import AnimatedNumber from './AnimatedNumber';
import { TrendUpIcon, TrendDownIcon, ZapIcon, ChevronRightIcon, LockIcon } from './Icons';

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
function DayProgress({ today, yesterday, t, money }) {
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
            ? t('seller.dayAhead', { amount: money(gap) })
            : t('seller.dayBehind', { amount: money(gap) })}
        </span>
        <span className="day-progress-ref">{t('seller.dayVsYesterday', { amount: money(yesterday) })}</span>
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

  const earning = showFigure && Number(stats.profitToday) > 0;
  // Sold today, but nothing sold carried a cost price: profit is unknowable, sales are not.
  const locked = state === 'none';
  const sales = Number(stats.todaysSales) || 0;
  // The split: of everything sold, how much went back into the goods and how much stayed.
  // Only when the profit is real and sits inside the sales — a loss or a figure larger
  // than the till has no honest picture as two parts of one bar.
  const split = earning && state === 'ok' && sales > 0 && stats.profitToday <= sales
    ? { profit: Number(stats.profitToday), cost: sales - Number(stats.profitToday), pct: (Number(stats.profitToday) / sales) * 100 }
    : null;

  // A quiet morning has no split of its own, and an empty card at 9 AM looks like a
  // card that never changed. So until today's first bill it shows YESTERDAY's split,
  // labelled as yesterday and drawn muted — a real figure, not a placeholder — and when
  // there is no yesterday either, a dashed outline of the bar that is coming.
  const ySales = Number(stats.yesterdaysSales) || 0;
  const yProfit = Number(stats.profitYesterday) || 0;
  const yTrusted = Number(stats.profitCoverageYesterday) >= COVERAGE_TRUSTED_AT;
  const ySplit = state === 'noSales' && yTrusted && ySales > 0 && yProfit > 0 && yProfit <= ySales
    ? { profit: yProfit, cost: ySales - yProfit, pct: (yProfit / ySales) * 100 }
    : null;

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

  const race = buildRace(stats.salesTimeline);
  const locale = LOCALES[lang] || 'en-IN';
  const hourLabel = (minutes) => new Intl.DateTimeFormat(locale, { hour: 'numeric' }).format(new Date(2000, 0, 1, Math.floor(minutes / 60)));

  return (
    // The one card on the Overview that is a different KIND of object from the panels
    // below it: a deep surface tinted with the shop's own accent, in both light and dark
    // mode. It is the first thing a shopkeeper reads every morning, and it was a white
    // form with a green edge — the same material as the low-stock count.
    <div className={`munafa-card munafa-hero${race ? ' has-race' : ''}`}>
      <div className="mh-main">
        <div className="munafa-head">
          <span className="munafa-label">{locked ? t('seller.munafa.salesHero') : t('seller.munafa.title')}</span>
          {streakLabel && (
            <span className={`munafa-streak${streak.billedToday ? '' : ' at-risk'}`}>
              <ZapIcon size={13} />
              {streakLabel}
            </span>
          )}
        </div>

        {/* Sales happened but no rupee of it has a cost price behind it. The hero used to
            be a lone em dash — the biggest thing on the first screen of the day, saying
            nothing. Now it states what IS known, at hero size, and says plainly what is
            missing for the profit to appear. */}
        {locked && (
          <>
            <div className="munafa-figure">
              <strong className="munafa-value">
                <AnimatedNumber value={sales} from={0} prefix="₹" decimals={false} duration={1100} />
              </strong>
              <span className="mh-locked">
                <LockIcon size={13} />
                {t('seller.munafa.profitLocked')}
              </span>
            </div>
            <Link href="/seller/products?cost=missing" className="mh-unlock">
              <span>{t('seller.munafa.unlockText')}</span>
              <span className="mh-unlock-cta">
                {t('seller.munafa.unlockCta')}
                <ChevronRightIcon size={14} />
              </span>
            </Link>
          </>
        )}

        {!locked && (
        <div className="munafa-figure">
          {/* Moment: the day's profit lands. A handful of coins rise once behind the
              figure as it counts up — only when there is a real, positive profit. */}
          {earning && (
            <span className="munafa-coins" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((i) => <i key={i} style={{ '--c': i }} />)}
            </span>
          )}
          <strong className={`munafa-value${showFigure || showZero ? '' : ' is-unknown'}${earning ? ' is-earning' : ''}`}>
            {showZero ? (
              money(0)
            ) : showFigure && Number(stats.profitToday) >= 0 ? (
              <AnimatedNumber value={stats.profitToday} from={0} prefix="₹" decimals={false} duration={1100} />
            ) : showFigure ? (
              money(stats.profitToday)
            ) : (
              '—'
            )}
          </strong>
          {delta && (
            <span className={`munafa-delta munafa-delta-${delta.dir}`}>
              {delta.dir === 'up' ? <TrendUpIcon size={13} /> : <TrendDownIcon size={13} />}
              {delta.label}
            </span>
          )}
        </div>
        )}

        {/* The one answer sentence, then the picture of it: the day's sales as one bar,
            split into what went back into the goods and what stayed in the shop. */}
        {split && (
          <div className="munafa-split">
            <p className="munafa-answer">{t('seller.munafa.answer', { amount: count(Math.round(split.pct)) })}</p>
            <div className="munafa-split-bar" style={{ '--profit': `${Math.max(3, split.pct).toFixed(1)}%` }} aria-hidden="true">
              <span className="munafa-split-cost" />
              <span className="munafa-split-profit" />
            </div>
            <div className="munafa-split-legend">
              <span><i className="is-cost" />{t('seller.munafa.costLabel')} <strong>{money(split.cost)}</strong></span>
              <span><i className="is-profit" />{t('seller.munafa.profitLabel')} <strong>{money(split.profit)}</strong></span>
            </div>
          </div>
        )}

        {ySplit && (
          <div className="munafa-split is-yesterday">
            <p className="munafa-answer">
              <span className="munafa-tag">{t('seller.munafa.yesterdayTag')}</span>
              {t('seller.munafa.yesterdayAnswer', { amount: count(Math.round(ySplit.pct)) })}
            </p>
            <div className="munafa-split-bar" style={{ '--profit': `${Math.max(3, ySplit.pct).toFixed(1)}%` }} aria-hidden="true">
              <span className="munafa-split-cost" />
              <span className="munafa-split-profit" />
            </div>
            <div className="munafa-split-legend">
              <span><i className="is-cost" />{t('seller.munafa.costLabel')} <strong>{money(ySplit.cost)}</strong></span>
              <span><i className="is-profit" />{t('seller.munafa.profitLabel')} <strong>{money(ySplit.profit)}</strong></span>
            </div>
          </div>
        )}
        {state === 'noSales' && !ySplit && (
          <div className="munafa-split is-preview">
            <div className="munafa-split-bar" aria-hidden="true" />
            <p className="munafa-answer">{t('seller.munafa.emptyPreview')}</p>
          </div>
        )}

        {/* One sentence under the figure, and which one it is IS the honesty of this card. */}
        {locked ? null : state === 'none' ? (
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

        {/* Sales, margin and the bill count: the day's supporting cast, as three small
            tiles under the story rather than a box competing with the figure. */}
        <div className="mh-stats">
          {locked ? (
            <>
              <div className="mh-stat">
                <span>{t('seller.stats.dailyBillCount')}</span>
                <strong>{count(stats.dailyBillCount || 0)}</strong>
              </div>
              <div className="mh-stat">
                <span>{t('seller.munafa.avgBill')}</span>
                <strong>{stats.dailyBillCount > 0 ? money(sales / stats.dailyBillCount) : '—'}</strong>
              </div>
              <div className="mh-stat">
                <span>{t('seller.munafa.ySales')}</span>
                <strong>{money(stats.yesterdaysSales || 0)}</strong>
              </div>
            </>
          ) : (
            <>
              <div className="mh-stat">
                <span>{t('seller.munafa.sales')}</span>
                <strong>{money(stats.todaysSales)}</strong>
              </div>
              <div className="mh-stat">
                <span>{t('seller.munafa.margin')}</span>
                <strong>
                  {showFigure && stats.marginToday !== null
                    ? `${state === 'partial' ? '≤' : ''}${count(Math.round(stats.marginToday))}%`
                    : '—'}
                </strong>
              </div>
              <div className="mh-stat">
                <span>{t('seller.stats.dailyBillCount')}</span>
                <strong>{count(stats.dailyBillCount || 0)}</strong>
              </div>
            </>
          )}
        </div>

        {/* Only for a server that predates salesTimeline — the race below replaces it. */}
        {!race && (
          <div className="munafa-progress">
            <DayProgress today={stats.todaysSales} yesterday={stats.yesterdaysSales} t={t} money={money} />
          </div>
        )}
      </div>

      {race && <DayRace race={race} t={t} money={money} hourLabel={hourLabel} />}
    </div>
  );
}

const LOCALES = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };

// Chart space. The SVG stretches to its box; strokes keep their width (non-scaling).
const RACE_W = 600;
const RACE_H = 200;
const RACE_TOP = 16;

/**
 * Today's sales against yesterday's, hour by hour, on the shopkeeper's own clock.
 *
 * The comparison that matters at 11 AM is not "today vs the whole of yesterday" — that
 * one says "₹4,805 to match yesterday" every single morning and means nothing. It is
 * "where was I yesterday at THIS time". So both days are laid out as running totals, and
 * the card reads the gap at the current minute.
 */
function buildRace(timeline) {
  if (!timeline) return null;
  const toMin = (ms) => {
    const d = new Date(ms);
    return d.getHours() * 60 + d.getMinutes();
  };
  const clean = (rows) => (Array.isArray(rows) ? rows : []).map(([ms, amount]) => [toMin(ms), Number(amount) || 0]).sort((a, b) => a[0] - b[0]);
  const today = clean(timeline.today);
  const yesterday = clean(timeline.yesterday);
  if (!today.length && !yesterday.length) return null;

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const marks = [...today, ...yesterday].map((row) => row[0]);
  const start = Math.floor(Math.min(9 * 60, nowMin, ...marks) / 60) * 60;
  const end = Math.min(24 * 60, Math.ceil(Math.max(21 * 60, nowMin + 1, ...marks) / 60) * 60);

  const total = (rows, until = Infinity) => rows.reduce((sum, [m, v]) => (m <= until ? sum + v : sum), 0);
  const todayTotal = total(today);
  const yesterdayTotal = total(yesterday);
  const yesterdayByNow = total(yesterday, nowMin);
  const yMax = Math.max(todayTotal, yesterdayTotal, 1) * 1.08;

  const x = (m) => ((Math.min(Math.max(m, start), end) - start) / (end - start)) * RACE_W;
  const y = (v) => RACE_H - (v / yMax) * (RACE_H - RACE_TOP);
  const line = (rows, until) => {
    let cum = 0;
    const pts = [[x(start), y(0)]];
    for (const [m, v] of rows) {
      if (m > until) break;
      // A ramp, not a staircase: forty steps read as noise, one rising line reads as a day.
      cum += v;
      pts.push([x(m), y(cum)]);
    }
    pts.push([x(until), y(cum)]);
    return pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  };

  const todayLine = line(today, nowMin);
  const todayArea = `${todayLine} L${x(nowMin).toFixed(1)} ${RACE_H} L${x(start).toFixed(1)} ${RACE_H} Z`;
  const yesterdayLine = yesterday.length ? line(yesterday, end) : null;

  const ticks = [];
  const step = (end - start) / 60 > 12 ? 4 : 3;
  for (let m = start; m <= end; m += step * 60) ticks.push(m);

  return {
    todayLine,
    todayArea,
    yesterdayLine,
    todayTotal,
    yesterdayByNow,
    hasToday: today.length > 0,
    now: { left: (x(nowMin) / RACE_W) * 100, top: (y(todayTotal) / RACE_H) * 100 },
    then: { left: (x(nowMin) / RACE_W) * 100, top: (y(yesterdayByNow) / RACE_H) * 100 },
    ticks: ticks.map((m) => ({ m, left: (x(m) / RACE_W) * 100 })),
  };
}

function DayRace({ race, t, money, hourLabel }) {
  const diff = race.todayTotal - race.yesterdayByNow;
  let verdict = null;
  if (race.hasToday && race.yesterdayByNow > 0) {
    verdict = {
      tone: diff >= 0 ? 'ahead' : 'behind',
      text: t(diff >= 0 ? 'seller.munafa.raceAhead' : 'seller.munafa.raceBehind', { then: money(race.yesterdayByNow), diff: money(Math.abs(diff)) }),
    };
  } else if (race.hasToday) {
    verdict = { tone: 'ahead', text: t('seller.munafa.raceFirst') };
  } else if (race.yesterdayByNow > 0) {
    verdict = { tone: 'quiet', text: t('seller.munafa.raceNoneYet', { then: money(race.yesterdayByNow) }) };
  }

  return (
    <div className="mh-race">
      <div className="mh-race-head">
        <span className="mh-kicker">{t('seller.munafa.raceTitle')}</span>
        <span className="mh-race-legend" aria-hidden="true">
          <span className="is-today">{t('seller.munafa.raceToday')}</span>
          {race.yesterdayLine && <span className="is-yesterday">{t('seller.munafa.raceYesterday')}</span>}
        </span>
      </div>
      {verdict && <p className={`mh-verdict is-${verdict.tone}`}>{verdict.text}</p>}

      <div className="mh-chart" role="img" aria-label={verdict?.text || t('seller.munafa.raceTitle')}>
        <svg viewBox={`0 0 ${RACE_W} ${RACE_H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="mh-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--h-mint)" stopOpacity="0.38" />
              <stop offset="100%" stopColor="var(--h-mint)" stopOpacity="0" />
            </linearGradient>
            <clipPath id="mh-reveal">
              <rect className="mh-reveal" x="0" y="0" width={RACE_W} height={RACE_H} />
            </clipPath>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} className="mh-grid" x1="0" x2={RACE_W} y1={RACE_H * f} y2={RACE_H * f} />
          ))}
          {race.yesterdayLine && <path className="mh-yesterday" d={race.yesterdayLine} />}
          <g clipPath="url(#mh-reveal)">
            <path className="mh-area" d={race.todayArea} fill="url(#mh-area)" />
            <path className="mh-today" d={race.todayLine} />
          </g>
        </svg>
        <span className="mh-now-line" style={{ left: `${race.now.left}%` }} aria-hidden="true" />
        {race.yesterdayLine && race.yesterdayByNow > 0 && (
          <span className="mh-dot is-then" style={{ left: `${race.then.left}%`, top: `${race.then.top}%` }} data-tip={money(race.yesterdayByNow)} />
        )}
        <span className="mh-dot is-now" style={{ left: `${race.now.left}%`, top: `${race.now.top}%` }} data-tip={money(race.todayTotal)} />
      </div>
      <div className="mh-axis" aria-hidden="true">
        {race.ticks.map((tick) => (
          <span key={tick.m} style={{ left: `${tick.left}%` }}>{hourLabel(tick.m)}</span>
        ))}
      </div>
    </div>
  );
}
