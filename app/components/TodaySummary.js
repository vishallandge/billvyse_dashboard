'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { getShopSocket } from '../../lib/socket';
import { formatNumber } from '../../lib/hindiNumerals';
import { formatRupees } from '../../lib/format';
import { useLanguage } from './LanguageProvider';
import AnimatedNumber from './AnimatedNumber';
import { SkeletonStats } from './Skeleton';
import { BookIcon, RefreshIcon, WhatsappIcon, AlertIcon, ClockIcon, ReceiptIcon, CreditCardIcon, RupeeIcon } from './Icons';

/**
 * Today's Summary — the Overview's live read of the day's money.
 *
 * Three questions, in the order a shopkeeper asks them walking up to the counter:
 *
 *   1. How much actually ARRIVED?      The ring. Its centre is collected money; the
 *                                      ring itself is everything billed, so the amber
 *                                      arc is visibly the part that did NOT arrive.
 *   2. How did it come in?             The mode rows beside it, each with its share.
 *   3. When did the day happen?        The hour strip — the rush, the lull, and where
 *                                      "now" sits in it.
 *
 * Then up to four sentences the panel works out for itself (udhaar running heavy, old
 * udhaar recovered, the busiest hour, the average bill), because a figure the shopkeeper
 * has to interpret is a figure he skips.
 *
 * Live: every bill rung anywhere in the shop reaches the shop's socket room, so the panel
 * re-reads itself a moment later instead of waiting for a refresh tap. The live dot pulses
 * once per arrival — never on a loop, or it is just a blinking light nobody reads.
 *
 * Renders one box. The WhatsApp sheet belongs to the page (onShare), not to this panel.
 */


const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;
// Arc units left blank between two modes, so four touching colours read as four parts.
const RING_GAP = 2.2;

const MODES = [
  { key: 'cash', labelKey: 'seller.cash' },
  { key: 'upi', labelKey: 'seller.upi' },
  { key: 'card', labelKey: 'seller.card' },
  { key: 'khata', labelKey: 'seller.khataMode' },
];

const LOCALES = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };

export default function TodaySummary({ onShare }) {
  const { t, lang } = useLanguage();
  const [hisaab, setHisaab] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  // Bumped on every live arrival; used as a `key` so the one-shot pulse replays.
  const [beat, setBeat] = useState(0);
  const refetchTimer = useRef(null);

  const load = useCallback(() => {
    setError('');
    setLoading(true);
    return apiFetch('/api/seller/hisaab/today')
      .then((data) => {
        setHisaab(data);
        setUpdatedAt(new Date());
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Debounced: a busy counter rings several bills a minute, and each one would otherwise
  // be a full re-read of the day.
  useEffect(() => {
    const socket = getShopSocket();
    if (!socket) return undefined;
    function onBill() {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => {
        load().then(() => setBeat((b) => b + 1));
      }, 1200);
    }
    // Everything that moves today's money, not only a new bill: a return or cancel changes
    // the takings, and udhaar received (khata:changed, from utils/khataBalance.js) changes
    // what was collected. One debounced re-read covers a bill that fires two of these.
    const events = ['bill:created', 'table:settled', 'bill:returned', 'bill:cancelled', 'khata:changed'];
    events.forEach((event) => socket.on(event, onBill));
    return () => {
      events.forEach((event) => socket.off(event, onBill));
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
  }, [load]);

  // A tab left open over lunch comes back to the day as it is now, not as it was.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && updatedAt && Date.now() - updatedAt.getTime() > 60_000) load();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load, updatedAt]);

  const rupees = useCallback((value) => formatRupees(value, lang, { decimals: false }), [lang]);
  const n = useCallback((value) => formatNumber(value ?? 0, lang), [lang]);
  const locale = LOCALES[lang] || 'en-IN';
  const hourLabel = useCallback(
    (hour) => new Intl.DateTimeFormat(locale, { hour: 'numeric' }).format(new Date(2000, 0, 1, hour)),
    [locale]
  );

  const view = useMemo(() => {
    if (!hisaab?.summary) return null;
    const summary = hisaab.summary;
    const modes = summary.paymentBreakdown || {};
    const rows = MODES.map((mode) => ({ ...mode, value: Math.max(0, Number(modes[mode.key]) || 0) }));
    const collected = rows.filter((row) => row.key !== 'khata').reduce((sum, row) => sum + row.value, 0);
    const onKhata = rows.find((row) => row.key === 'khata').value;
    const billed = collected + onKhata;
    const share = (value) => (billed > 0 ? (value / billed) * 100 : 0);
    /**
     * What actually ARRIVED today — the ring's centre. The mode rows are what each bill was
     * rung in, and a khata bill is rung entirely as khata: whatever the customer paid on it
     * (₹150 down at the table, or the whole ₹220 at the khata page an hour later) is booked
     * as udhaar recovered, never as cash on the bill. Leaving that out had the centre say
     * ₹460 on a day the drawer held ₹680, and the Day Book — which does count it — disagree.
     * Refunds that went back as money come off; a khata refund only shrank a balance.
     */
    const recovered = Math.max(0, Number(summary.udhaarRecoveredToday) || 0);
    const refunds = summary.refunds || {};
    const moneyRefunded = Math.max(0, (Number(refunds.total) || 0) - (Number(refunds.khata) || 0));
    const arrived = Math.max(0, collected + recovered - moneyRefunded);

    // Ring arcs, laid end to end from twelve o'clock.
    const live = rows.filter((row) => row.value > 0);
    const gap = live.length > 1 ? RING_GAP : 0;
    let offset = 0;
    const arcs = live.map((row, i) => {
      const full = (row.value / billed) * RING_C;
      const length = Math.max(0.8, full - gap);
      const arc = { key: row.key, length, offset, delay: i };
      offset += full;
      return arc;
    });


    // The day by hour, bucketed in the shopkeeper's own clock (see the controller).
    const timeline = Array.isArray(summary.timeline) ? summary.timeline : [];
    const hours = Array.from({ length: 24 }, () => ({ amount: 0, count: 0 }));
    for (const [at, amount] of timeline) {
      const hour = new Date(at).getHours();
      hours[hour].amount += Number(amount) || 0;
      hours[hour].count += 1;
    }
    const nowHour = new Date().getHours();
    const active = hours.map((h, i) => (h.count ? i : -1)).filter((i) => i >= 0);
    // A normal trading day, widened to whatever this shop actually did — a dhaba that
    // bills at 6 AM or a chemist open till midnight gets its own day, not a 9-to-9 one.
    const startHour = Math.min(9, active[0] ?? 9, nowHour);
    const endHour = Math.max(21, active[active.length - 1] ?? 21, nowHour);
    const span = [];
    for (let h = startHour; h <= endHour; h += 1) span.push({ hour: h, ...hours[h] });
    const peakAmount = Math.max(0, ...span.map((h) => h.amount));
    const peak = peakAmount > 0 ? span.find((h) => h.amount === peakAmount) : null;

    const billCount = summary.billCount || 0;
    const insights = [];
    const khataShare = Math.round(share(onKhata));
    if (onKhata > 0 && khataShare >= 25) {
      insights.push({ key: 'khata', tone: 'warn', icon: <AlertIcon size={15} />, text: t('seller.hisaabInsightKhataHeavy', { percent: n(khataShare) }) });
    }
    // Udhaar recovered is its own row in the money list now (and part of the centre), so no
    // sentence repeats it here.
    if (peak && billCount >= 3) {
      insights.push({ key: 'peak', tone: 'plain', icon: <ClockIcon size={15} />, text: t('seller.hisaabInsightPeak', { hour: hourLabel(peak.hour), amount: rupees(peak.amount) }) });
    }
    if (billCount > 0) {
      insights.push({ key: 'avg', tone: 'plain', icon: <ReceiptIcon size={15} />, text: t('seller.hisaabInsightAvgBill', { amount: rupees(billed / billCount), count: n(billCount) }) });
    }
    if (collected > 0) {
      const digital = Math.round(((rows[1].value + rows[2].value) / collected) * 100);
      insights.push(
        digital >= 50
          ? { key: 'mix', tone: 'plain', icon: <CreditCardIcon size={15} />, text: t('seller.hisaabInsightDigital', { percent: n(digital) }) }
          : { key: 'mix', tone: 'plain', icon: <RupeeIcon size={15} />, text: t('seller.hisaabInsightCash', { percent: n(100 - digital) }) }
      );
    }

    return { summary, rows, collected, arrived, recovered, onKhata, billed, share, arcs, span, peak, peakAmount, nowHour, billCount, insights: insights.slice(0, 4) };
  }, [hisaab, t, n, rupees, hourLabel]);

  return (
    <div className="panel ov-hisaab tsum">
      <div className="panel-topline">
        <h2>
          <span className="section-title-icon mod-tone-8"><BookIcon size={16} /></span>
          {t('seller.hisaabTitle')}
        </h2>
        {updatedAt && (
          <span className="tsum-live" data-tip={t('seller.hisaabUpdatedAt', { time: updatedAt.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }) })}>
            <span className="tsum-live-dot" key={beat} aria-hidden="true" />
            {t('seller.hisaabLive')}
          </span>
        )}
        <button
          type="button"
          className={`icon-btn tsum-refresh${loading ? ' is-busy' : ''}`}
          onClick={load}
          disabled={loading}
          aria-label={t('common.refresh')}
          data-tip={t('common.refresh')}
        >
          <RefreshIcon size={17} />
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading && !view ? (
        <SkeletonStats count={4} />
      ) : view && (
        <>
          <div className="tsum-hero">
            <div className="tsum-ring" role="img" aria-label={`${t('seller.hisaabCollected')} ${rupees(view.arrived)}`}>
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle className="tsum-ring-track" cx="60" cy="60" r={RING_R} />
                <g transform="rotate(-90 60 60)">
                  {view.arcs.map((arc) => (
                    <circle
                      key={arc.key}
                      className={`tsum-arc tsum-arc-${arc.key}`}
                      cx="60"
                      cy="60"
                      r={RING_R}
                      data-tip={`${t(MODES.find((m) => m.key === arc.key).labelKey)} · ${rupees(view.rows.find((r) => r.key === arc.key).value)}`}
                      style={{
                        strokeDasharray: `${arc.length} ${RING_C}`,
                        strokeDashoffset: -arc.offset,
                        '--i': arc.delay,
                      }}
                    />
                  ))}
                </g>
              </svg>
              <div className="tsum-ring-centre">
                <span className="tsum-ring-label">{t('seller.hisaabCollected')}</span>
                <strong className={`tsum-ring-value${rupees(view.arrived).length > 8 ? ' is-long' : ''}`}>
                  <AnimatedNumber value={view.arrived} prefix="₹" decimals={false} />
                </strong>
                <span className="tsum-ring-sub">{t('seller.hisaabBillsCount', { count: n(view.billCount) })}</span>
              </div>
            </div>

            <div className="tsum-modes">
              {view.onKhata > 0 && (
                <p className="tsum-billed">{t('seller.hisaabOfBilled', { amount: rupees(view.billed) })}</p>
              )}
              <ul className="tsum-mode-list">
                {view.rows.map((row) => (
                  <li key={row.key} className={`tsum-mode${row.key === 'khata' ? ' is-khata' : ''}${row.value === 0 ? ' is-zero' : ''}`}>
                    <span className="tsum-mode-name">
                      <span className={`hisaab-dot hisaab-seg-${row.key}`} aria-hidden="true" />
                      {t(row.labelKey)}
                    </span>
                    <span className="tsum-mode-track" aria-hidden="true">
                      <i className={`hisaab-seg-${row.key}`} style={{ width: `${row.value > 0 ? Math.max(2, view.share(row.value)) : 0}%` }} />
                    </span>
                    <strong className="tsum-mode-value">{rupees(row.value)}</strong>
                    <span className="tsum-mode-share">{view.billed > 0 ? `${n(Math.round(view.share(row.value)))}%` : ''}</span>
                  </li>
                ))}
                {/* Money that came in against udhaar today — down-payments on today's khata
                    bills and old balances alike. Part of the centre figure, so it is named. */}
                {view.recovered > 0 && (
                  <li className="tsum-mode is-recovered">
                    <span className="tsum-mode-name">{t('seller.hisaabRecoveredRow')}</span>
                    <span className="tsum-mode-track" aria-hidden="true" />
                    <strong className="tsum-mode-value">+{rupees(view.recovered)}</strong>
                    <span className="tsum-mode-share" />
                  </li>
                )}
                {view.summary.refunds?.total > 0 && (
                  <li className="tsum-mode is-refund">
                    <span className="tsum-mode-name">{t('seller.hisaabRefunds')}</span>
                    <span className="tsum-mode-track" aria-hidden="true" />
                    <strong className="tsum-mode-value">−{rupees(view.summary.refunds.total)}</strong>
                    <span className="tsum-mode-share" />
                  </li>
                )}
              </ul>
              <p className="tsum-note">{t('seller.hisaabSubtitle')}</p>
            </div>
          </div>

          {view.billCount === 0 ? (
            <p className="tsum-empty">{t('seller.hisaabEmpty')}</p>
          ) : (
            <>
              <div className="tsum-pulse">
                <div className="tsum-pulse-head">
                  <span className="tsum-kicker">{t('seller.hisaabByHour')}</span>
                  {view.peak && <span className="tsum-pulse-peak">{t('seller.hisaabPeakAt', { hour: hourLabel(view.peak.hour) })}</span>}
                </div>
                <div className="tsum-bars" style={{ '--cols': view.span.length }}>
                  {view.span.map((slot, i) => {
                    const state = slot.hour > view.nowHour ? ' is-future' : slot.hour === view.nowHour ? ' is-now' : '';
                    const isPeak = view.peak && slot.hour === view.peak.hour;
                    const height = view.peakAmount > 0 ? (slot.amount / view.peakAmount) * 100 : 0;
                    return (
                      <span
                        key={slot.hour}
                        className={`tsum-bar${state}${isPeak ? ' is-peak' : ''}`}
                        style={{ '--i': i }}
                        data-tip={slot.hour > view.nowHour ? hourLabel(slot.hour) : t('seller.hisaabHourTip', { hour: hourLabel(slot.hour), amount: rupees(slot.amount), count: n(slot.count) })}
                      >
                        <i style={{ height: `${slot.amount > 0 ? Math.max(6, height) : 0}%` }} />
                      </span>
                    );
                  })}
                </div>
                <div className="tsum-axis" style={{ '--cols': view.span.length }} aria-hidden="true">
                  {view.span.map((slot) => (
                    <span key={slot.hour} className={slot.hour === view.nowHour ? 'is-now' : ''}>
                      {slot.hour === view.nowHour
                        ? t('seller.hisaabNow')
                        : (slot.hour - view.span[0].hour) % 3 === 0 && Math.abs(slot.hour - view.nowHour) > 1
                          ? hourLabel(slot.hour)
                          : ''}
                    </span>
                  ))}
                </div>
              </div>

              {view.insights.length > 0 && (
                <ul className="tsum-insights" aria-label={t('seller.hisaabInsightsTitle')}>
                  {view.insights.map((item) => (
                    <li key={item.key} className={`tsum-insight is-${item.tone}`}>
                      <span className="tsum-insight-icon" aria-hidden="true">{item.icon}</span>
                      <span>{item.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {hisaab.whatsappLink && onShare && (
            <div className="tsum-foot">
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => onShare({ message: hisaab.whatsappText, link: hisaab.whatsappLink })}
              >
                <WhatsappIcon size={17} /> {t('seller.shareWhatsapp')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
