'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch, downloadFile } from '../../../lib/api';
import { formatRupees, formatCompactRupees, formatMoney, formatDate, formatRelativeTime } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { SkeletonStats, SkeletonTable } from '../../components/Skeleton';
import Dropdown from '../../components/Dropdown';
import DateRangeFilter from '../../components/DateRangeFilter';
import { Pagination } from '../../components/Pagination';
import {
  ChartCard,
  ColumnChart,
  DonutChart,
  LineChart,
  Legend,
  ProgressRing,
  RankedBars,
  SplitBar,
  StackedColumnChart,
  StatTile,
} from '../../components/Charts';
import {
  RupeeIcon,
  TrendUpIcon,
  TrendDownIcon,
  CreditCardIcon,
  AlertIcon,
  ClockIcon,
  ShopIcon,
  InfoIcon,
  ZapIcon,
  TagIcon,
  RefreshIcon,
  ExcelIcon,
  RepeatIcon,
  StarIcon,
  BarChartIcon,
  ReceiptIcon,
  UsersIcon,
  SearchIcon,
} from '../../components/Icons';
import { recordHref } from '../../../lib/routeId';

/**
 * The platform's money, for any stretch of time — this month, a year back, a financial
 * year, or two dates picked by hand.
 *
 * Four tabs, one question each:
 *   Overview  — how much came in during the period, from where, and how it compares.
 *   VIP       — which shops the platform's money actually depends on, and which of them
 *               are about to stop paying.
 *   Growth    — MRR month by month (new, upgrades, churn) and whether shops stay.
 *   Payments  — every payment behind every number, searchable and exportable.
 *
 * Period figures follow the picker. "Now" figures (MRR, renewals due, VIP status) cannot —
 * picking 2025 does not change who is paying today — and every one of them says so.
 * The period and tab live in the URL, so a view can be reopened or shared as it was.
 */

const PRESETS = ['month', 'lastMonth', 'quarter', 'fy', 'year', 'all'];
const TABS = ['overview', 'vip', 'growth', 'payments'];
const TAB_ICONS = { overview: BarChartIcon, vip: StarIcon, growth: TrendUpIcon, payments: ReceiptIcon };
const PLAN_COLORS = { pro: 'var(--viz-1)', premium: 'var(--viz-2)', enterprise: 'var(--viz-7)' };
const KIND_COLORS = { new: 'var(--viz-3)', renewal: 'var(--viz-1)', upgrade: 'var(--viz-7)' };
const TIER_COLORS = { vip: 'var(--viz-4)', loyal: 'var(--viz-1)', regular: 'var(--text-faint)' };
const INSIGHT_ICONS = { urgent: AlertIcon, warn: ClockIcon, good: TrendUpIcon, info: InfoIcon };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------ dates */

const pad = (n) => String(n).padStart(2, '0');
const monthEnd = (y, m) => `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`;
const yearRange = (y) => ({ preset: 'custom', from: `${y}-01-01`, to: `${y}-12-31` });
const fyRange = (y) => ({ preset: 'custom', from: `${y}-04-01`, to: `${y + 1}-03-31` });
const monthRange = (key) => {
  const [y, m] = key.split('-').map(Number);
  return { preset: 'custom', from: `${key}-01`, to: monthEnd(y, m) };
};
const sameRange = (a, b) => a.preset === b.preset && a.from === b.from && a.to === b.to;
const fyLabel = (y) => `FY ${y}-${pad((y + 1) % 100)}`;

function rangeQuery(range) {
  const params = new URLSearchParams({ preset: range.preset });
  if (range.preset === 'custom') {
    params.set('from', range.from);
    params.set('to', range.to);
  }
  return params.toString();
}

function monthLabel(key, long = false) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', long ? { month: 'long', year: 'numeric' } : { month: 'short', year: '2-digit' });
}

function dayLabel(key, withYear = false) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

// The shortest honest name for a window: "2025", "FY 2025-26", "August 2026", or the dates.
function describeWindow(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const wholeMonths = fd === 1 && to === monthEnd(ty, tm);
  if (wholeMonths && fm === 1 && tm === 12 && fy === ty) return String(fy);
  if (wholeMonths && fm === 4 && tm === 3 && ty === fy + 1) return fyLabel(fy);
  if (wholeMonths && fy === ty && fm === tm) return monthLabel(from.slice(0, 7), true);
  return `${dayLabel(from, true)} – ${dayLabel(to, true)}`;
}

const planName = (plan) => (plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : '—');

function deltaPct(current, previous) {
  if (!previous || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/* ------------------------------------------------------------------ page */

export default function AdminRevenuePage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const [ready, setReady] = useState(false);
  const [range, setRange] = useState({ preset: 'month', from: '', to: '' });
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [payFilter, setPayFilter] = useState({ status: '', kind: '', q: '' });
  const seq = useRef(0);

  // The period and tab are read from the URL once, before the first fetch, so a reopened
  // or shared link lands on exactly the view it was copied from.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const preset = params.get('preset');
    if (preset === 'custom' && DATE_RE.test(params.get('from') || '') && DATE_RE.test(params.get('to') || '')) {
      setRange({ preset, from: params.get('from'), to: params.get('to') });
    } else if (PRESETS.includes(preset)) {
      setRange({ preset, from: '', to: '' });
    }
    if (TABS.includes(params.get('tab'))) setTab(params.get('tab'));
    setReady(true);
  }, []);

  const query = rangeQuery(range);

  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(query);
    if (tab !== 'overview') params.set('tab', tab);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, [ready, query, tab]);

  const load = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    apiFetch(`/api/admin/revenue?${query}`)
      .then((res) => {
        // A slower answer for a period the admin has already moved off must not overwrite
        // the one they are looking at.
        if (mine !== seq.current) return;
        setData(res);
        setError('');
      })
      .catch((err) => mine === seq.current && setError(err.message))
      .finally(() => mine === seq.current && setLoading(false));
  }, [query]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  async function exportXlsx() {
    setExporting(true);
    try {
      const params = new URLSearchParams(query);
      if (tab === 'payments') {
        if (payFilter.status) params.set('status', payFilter.status);
        if (payFilter.kind) params.set('kind', payFilter.kind);
        if (payFilter.q) params.set('q', payFilter.q);
      }
      params.set('format', 'xlsx');
      const name = data ? `payments-${data.window.from}-to-${data.window.to}.xlsx` : 'payments.xlsx';
      await downloadFile(`/api/admin/revenue/payments?${params.toString()}`, name);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(false);
    }
  }

  const f = {
    rupees: (value) => formatRupees(value, lang, { decimals: false }),
    money: (value) => formatCompactRupees(value, lang),
    num: (value) => formatMoney(value, lang, { decimals: false }),
  };

  const periods = data?.periods || { years: [], fys: [], months: [] };
  const yearValue = periods.years.find((y) => sameRange(range, yearRange(y)));
  const fyValue = periods.fys.find((y) => sameRange(range, fyRange(y)));
  const monthValue = periods.months.find((m) => sameRange(range, monthRange(m)));
  const win = data?.window;

  return (
    <>
      <div className="content-header">
        <h1>{t('admin.revenueTitle')}</h1>
        <p>{t('admin.revenueSubtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Everything that scopes the board, in one place: quick presets, then any year, any
          financial year or any month on record, then two dates by hand. */}
      <section className="rev-period">
        <DateRangeFilter value={range} onChange={setRange} presets={PRESETS} />
        <div className="rev-period-row">
          <Dropdown
            className="filter-select"
            value={yearValue ? String(yearValue) : ''}
            onChange={(y) => setRange(yearRange(Number(y)))}
            options={periods.years.map((y) => ({ value: String(y), label: String(y) }))}
            placeholder={t('admin.rev.pickYear')}
            disabled={!periods.years.length}
          />
          <Dropdown
            className="filter-select"
            value={fyValue ? String(fyValue) : ''}
            onChange={(y) => setRange(fyRange(Number(y)))}
            options={periods.fys.map((y) => ({ value: String(y), label: fyLabel(y) }))}
            placeholder={t('admin.rev.pickFy')}
            disabled={!periods.fys.length}
          />
          <Dropdown
            className="filter-select"
            value={monthValue || ''}
            onChange={(m) => setRange(monthRange(m))}
            options={periods.months.map((m) => ({ value: m, label: monthLabel(m, true) }))}
            placeholder={t('admin.rev.pickMonth')}
            searchable={periods.months.length > 12}
            disabled={!periods.months.length}
          />
          <div className="rev-period-tools">
            {data?.generatedAt && <span className="rev-updated">{t('admin.rev.updated', { time: formatRelativeTime(data.generatedAt, lang) })}</span>}
            <button type="button" className="icon-btn" onClick={load} disabled={loading} aria-label={t('common.refresh')} data-tip={t('common.refresh')}>
              <RefreshIcon size={17} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={exportXlsx}
              disabled={exporting || !data}
              aria-label={t('admin.rev.exportXlsx')}
              data-tip={t('admin.rev.exportXlsx')}
            >
              <ExcelIcon size={17} />
            </button>
          </div>
        </div>
        {win && (
          <p className="rev-period-label">
            <strong>{describeWindow(win.from, win.to)}</strong>
            {win.preset !== 'all' && (
              <span>{t('admin.rev.comparedWith', { range: `${dayLabel(win.previousFrom, true)} – ${dayLabel(win.previousTo, true)}` })}</span>
            )}
          </p>
        )}
      </section>

      <div className="segmented rev-tabs" role="tablist">
        {TABS.map((key) => {
          const Icon = TAB_ICONS[key];
          return (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
              <Icon size={15} />
              <span>{t(`admin.rev.tab.${key}`)}</span>
              {key === 'vip' && data?.vip.summary.atRisk > 0 && <span className="rev-tab-alert">{f.num(data.vip.summary.atRisk)}</span>}
            </button>
          );
        })}
      </div>

      {!data ? (
        !error && <SkeletonStats count={6} />
      ) : (
        <div className={`viz-board${loading ? ' is-refreshing' : ''}`}>
          {tab === 'overview' && <OverviewTab data={data} f={f} />}
          {tab === 'vip' && <VipTab data={data} f={f} />}
          {tab === 'growth' && <GrowthTab data={data} f={f} />}
          {tab === 'payments' && <PaymentsTab query={query} filter={payFilter} onFilter={setPayFilter} f={f} />}
        </div>
      )}
    </>
  );
}

/* ================================================================== overview */

function OverviewTab({ data, f }) {
  return (
    <>
      <Insights data={data} f={f} />
      <Hero data={data} f={f} />
      <PeriodTiles data={data} f={f} />
      <OverviewCharts data={data} f={f} />
      <RenewalsPanel data={data} f={f} />
      <div className="two-col">
        <GrantedLapsed data={data} f={f} kind="granted" />
        <GrantedLapsed data={data} f={f} kind="lapsed" />
      </div>
    </>
  );
}

// The sentences an operator would say out loud after a minute with the board — each one a
// comparison of two numbers already on screen, so they can never disagree with it.
function Insights({ data, f }) {
  const { t } = useLanguage();
  const { collected, mrr, renewals, checkout, discounts, vip, window: win } = data;
  const items = [];

  if (vip.summary.atRisk > 0) {
    items.push({ key: 'vipRisk', tone: 'urgent', text: t('admin.rev.ins.vipRisk', { n: f.num(vip.summary.atRisk), amount: f.rupees(vip.summary.atRiskMonthly) }) });
  }
  if (mrr.churned.shops > 0) {
    items.push({ key: 'churn', tone: 'urgent', text: t('admin.rev.ins.churn', { n: f.num(mrr.churned.shops), amount: f.rupees(mrr.churned.amount), days: f.num(mrr.churned.days) }) });
  }
  if (checkout.successRate !== null && checkout.successRate < 70 && checkout.paid + checkout.failed + checkout.abandoned >= 5) {
    items.push({ key: 'checkout', tone: 'urgent', text: t('admin.rev.ins.checkoutPeriod', { pct: f.num(checkout.successRate) }) });
  }
  if (renewals.dueThisWeek > 0) {
    items.push({ key: 'renewals', tone: 'warn', text: t('admin.rev.ins.renewals', { n: f.num(renewals.dueThisWeek) }) });
  }
  if (win.preset !== 'all') {
    const delta = deltaPct(collected.period, collected.previous);
    if (delta !== null && delta !== 0) {
      items.push({ key: 'pace', tone: delta > 0 ? 'good' : 'warn', text: t(delta > 0 ? 'admin.rev.ins.periodAhead' : 'admin.rev.ins.periodBehind', { pct: f.num(Math.abs(delta)) }) });
    } else if (collected.period > 0 && collected.previous === 0) {
      items.push({ key: 'pace', tone: 'good', text: t('admin.rev.ins.periodFirst', { amount: f.rupees(collected.period) }) });
    }
  }
  if (vip.summary.vip > 0 && vip.summary.payingEver >= 3) {
    items.push({ key: 'vip', tone: 'info', text: t('admin.rev.ins.vipShare', { n: f.num(vip.summary.vip), pct: f.num(vip.summary.vipSharePct) }) });
  }
  const discountShare = discounts.gross > 0 ? Math.round(((discounts.promo + discounts.points) / discounts.gross) * 100) : 0;
  if (discountShare >= 15) items.push({ key: 'discount', tone: 'warn', text: t('admin.rev.ins.discount', { pct: f.num(discountShare) }) });
  if (mrr.grantedShops > 0 && mrr.grantedValue > 0) {
    items.push({ key: 'granted', tone: 'info', text: t('admin.rev.ins.granted', { n: f.num(mrr.grantedShops), amount: f.rupees(mrr.grantedValue) }) });
  }

  if (items.length === 0) return null;

  return (
    <section className="viz-insights">
      <div className="viz-insights-head">
        <span className="stat-card-icon icon-brand"><ZapIcon size={15} /></span>
        <h2>{t('admin.rev.ins.title')}</h2>
      </div>
      <div className="viz-insights-list">
        {items.slice(0, 4).map((item) => {
          const Icon = INSIGHT_ICONS[item.tone];
          return (
            <div key={item.key} className={`viz-insight viz-insight-${item.tone} rev-insight`}>
              <span className="viz-insight-icon"><Icon size={16} /></span>
              <span className="viz-insight-text">{item.text}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Hero({ data, f }) {
  const { t } = useLanguage();
  const { collected, mrr, renewals, window: win } = data;
  const delta = win.preset === 'all' ? null : deltaPct(collected.period, collected.previous);

  return (
    <section className="viz-hero">
      <div className="viz-hero-main">
        <span className="viz-hero-label">
          <span className="stat-card-icon icon-success"><RupeeIcon size={16} /></span>
          {t('admin.rev.collectedIn', { period: describeWindow(win.from, win.to) })}
        </span>
        <strong className="viz-hero-value">{f.rupees(collected.period)}</strong>
        <div className="viz-hero-meta">
          {delta !== null && (
            <span className={`viz-delta${delta >= 0 ? ' is-good' : ' is-bad'}`}>
              {delta >= 0 ? '▲' : '▼'} {f.num(Math.abs(delta))}%
              <em>{t('admin.rev.vsPrevious')}</em>
            </span>
          )}
          <span>{t('admin.rev.heroPeriodSub', { n: f.num(collected.periodCount), avg: f.rupees(collected.avgPayment) })}</span>
        </div>
        {win.live && win.days > 1 && (
          <div className="rev-month-track" aria-hidden="true">
            <span style={{ width: `${Math.round((win.elapsedDays / win.days) * 100)}%` }} />
          </div>
        )}
        <div className="viz-hero-run">
          {collected.projected !== null && (
            <>
              {t('admin.rev.projectedEnd', { amount: f.rupees(collected.projected) })}
              {' · '}
            </>
          )}
          {win.preset !== 'all' && (
            <>
              {t('admin.rev.previousTotal', { amount: f.rupees(collected.previous) })}
              {' · '}
            </>
          )}
          {t('admin.rev.perDay', { amount: f.rupees(collected.perDay) })}
        </div>
      </div>

      <div className="viz-hero-side">
        <div className="viz-hero-figure">
          <span>{t('admin.rev.mrrNow')}</span>
          <strong>{f.rupees(mrr.runRate)}</strong>
          <em>{t('admin.rev.mrrNote', { arr: f.rupees(data.arr), n: f.num(mrr.payingShops) })}</em>
        </div>
        <div className="viz-hero-figure">
          <span>{t('admin.rev.arpu')}</span>
          <strong>{f.rupees(mrr.arpu)}</strong>
          <em>{t('admin.rev.conversionNote', { pct: f.num(mrr.conversionPct), n: f.num(mrr.totalShops) })}</em>
        </div>
        <div className="viz-hero-figure">
          <span>{t('admin.rev.renewalsDue', { days: f.num(renewals.days) })}</span>
          <strong>{f.rupees(renewals.amount)}</strong>
          <em>{t('admin.rev.renewalsNote', { n: f.num(renewals.count), week: f.num(renewals.dueThisWeek) })}</em>
        </div>
      </div>
    </section>
  );
}

function PeriodTiles({ data, f }) {
  const { t } = useLanguage();
  const { collected, kinds, discounts, checkout, mrr, signups, series, window: win } = data;
  const discountTotal = discounts.promo + discounts.points;
  const returning = kinds.renewal + kinds.upgrade + kinds.downgrade;

  return (
    <div className="viz-tiles">
      <StatTile
        label={t('admin.rev.newPayingShops')}
        value={f.num(collected.newShops)}
        delta={win.preset === 'all' ? null : deltaPct(collected.newShops, collected.previousNewShops)}
        deltaLabel={t('admin.rev.vsPrevious')}
        note={signups.conversionPct === null ? t('admin.rev.noSignups') : t('admin.rev.signupsNote', { n: f.num(signups.count), pct: f.num(signups.conversionPct) })}
        spark={series.map((row) => row.newShops)}
        sparkColor="var(--viz-3)"
        icon={<UsersIcon size={16} />}
        tone="success"
      />
      <StatTile
        label={t('admin.rev.returningMoney')}
        value={f.rupees(returning)}
        note={t('admin.rev.upgradeNote', { amount: f.rupees(kinds.upgrade) })}
        spark={series.map((row) => row.renewal + row.upgrade)}
        sparkColor="var(--viz-1)"
        icon={<RepeatIcon size={16} />}
        tone="brand"
      />
      <StatTile
        label={t('admin.rev.discountsGiven')}
        value={f.rupees(discountTotal)}
        note={discounts.gross > 0 ? t('admin.rev.discountShare', { pct: f.num(Math.round((discountTotal / discounts.gross) * 100)) }) : t('admin.rev.noDiscounts')}
        icon={<TagIcon size={16} />}
        tone="gold"
      />
      <StatTile
        label={t('admin.rev.checkoutSuccess')}
        value={checkout.successRate === null ? '—' : `${f.num(checkout.successRate)}%`}
        note={t('admin.rev.checkoutPeriodNote', { n: f.num(checkout.paid), failed: f.num(checkout.failed + checkout.abandoned) })}
        icon={<ZapIcon size={16} />}
        tone={checkout.successRate !== null && checkout.successRate < 70 ? 'danger' : 'success'}
      />
      <StatTile
        label={t('admin.rev.lostMrr', { days: f.num(mrr.churned.days) })}
        value={f.rupees(mrr.churned.amount)}
        note={t('admin.rev.lostMrrNote', { n: f.num(mrr.churned.shops) })}
        icon={<TrendDownIcon size={16} />}
        tone={mrr.churned.amount > 0 ? 'danger' : 'muted'}
        href="/admin/sellers?planState=lapsed"
      />
      <StatTile
        label={t('admin.rev.allTime')}
        value={f.rupees(collected.allTime)}
        note={t('admin.rev.paymentsCount', { n: f.num(collected.allTimeCount) })}
        icon={<CreditCardIcon size={16} />}
        tone="muted"
      />
    </div>
  );
}

function OverviewCharts({ data, f }) {
  const { t } = useLanguage();
  const { compare, series, byPlan, byCycle, byBusinessType, discounts, kinds, mrr, checkout, promos, campaigns, window: win } = data;
  const byMonth = win.granularity === 'month';
  const spansYears = win.from.slice(0, 4) !== win.to.slice(0, 4);
  const seriesLabel = (key) => (byMonth ? monthLabel(key) : dayLabel(key));

  const planTotals = Object.values(
    byPlan.reduce((acc, row) => {
      acc[row.plan] = acc[row.plan] || { key: row.plan, label: planName(row.plan), value: 0, color: PLAN_COLORS[row.plan] || 'var(--viz-4)' };
      acc[row.plan].value += row.amount;
      return acc;
    }, {})
  ).sort((a, b) => b.value - a.value);
  const discountShare = discounts.gross > 0 ? Math.round(((discounts.promo + discounts.points) / discounts.gross) * 100) : 0;

  return (
    <div className="viz-grid rev-grid">
      {win.preset !== 'all' && (
        <ChartCard
          span="wide"
          title={t('admin.rev.compareTitle')}
          hint={t('admin.rev.compareHint', { range: `${dayLabel(win.previousFrom, true)} – ${dayLabel(win.previousTo, true)}` })}
          table={{
            columns: [
              { key: 'date', label: t('admin.rev.day') },
              { key: 'current', label: t('admin.rev.thisPeriod'), numeric: true },
              { key: 'prevDate', label: t('admin.rev.previousDay') },
              { key: 'previous', label: t('admin.rev.previousPeriod'), numeric: true },
            ],
            rows: compare.map((row) => ({ date: dayLabel(row.date, spansYears), current: f.rupees(row.current), prevDate: dayLabel(row.prevDate, true), previous: f.rupees(row.previous) })),
          }}
        >
          <Legend
            items={[
              { label: t('admin.rev.thisPeriod'), color: 'var(--viz-3)' },
              { label: t('admin.rev.previousPeriod'), color: 'var(--text-faint)' },
            ]}
          />
          <LineChart
            data={compare}
            series={[
              { key: 'previous', label: t('admin.rev.previousPeriod'), color: 'var(--text-faint)', ghost: true },
              { key: 'current', label: t('admin.rev.thisPeriod'), color: 'var(--viz-3)' },
            ]}
            formatValue={f.money}
            formatX={(row) => dayLabel(row.date, spansYears)}
            height={170}
            emptyLabel={t('admin.rev.noPaymentsPeriod')}
          />
        </ChartCard>
      )}

      <ChartCard
        span="wide"
        title={t(byMonth ? 'admin.rev.seriesMonthTitle' : 'admin.rev.seriesDayTitle')}
        hint={t('admin.rev.seriesHint')}
        table={{
          columns: [
            { key: 'x', label: byMonth ? t('admin.rev.month') : t('admin.rev.day') },
            { key: 'gross', label: t('admin.rev.listPrice'), numeric: true },
            { key: 'discount', label: t('admin.rev.discount'), numeric: true },
            { key: 'amount', label: t('admin.rev.collected'), numeric: true },
            { key: 'new', label: t('admin.rev.kind.new'), numeric: true },
            { key: 'renewal', label: t('admin.rev.kind.renewal'), numeric: true },
            { key: 'upgrade', label: t('admin.rev.kind.upgrade'), numeric: true },
            { key: 'newShops', label: t('admin.rev.newShops'), numeric: true },
            { key: 'count', label: t('admin.rev.payments'), numeric: true },
          ],
          rows: series.map((row) => ({
            x: seriesLabel(row.key),
            gross: f.rupees(row.gross),
            discount: f.rupees(row.promo + row.points),
            amount: f.rupees(row.amount),
            new: f.rupees(row.new),
            renewal: f.rupees(row.renewal),
            upgrade: f.rupees(row.upgrade),
            newShops: f.num(row.newShops),
            count: f.num(row.count),
          })),
        }}
        footer={t('admin.rev.seriesFoot', {
          newAmount: f.rupees(kinds.new),
          n: f.num(data.collected.newShops),
          renewalAmount: f.rupees(kinds.renewal + kinds.downgrade),
          upgradeAmount: f.rupees(kinds.upgrade),
        })}
      >
        <StackedColumnChart
          data={series}
          series={[
            { key: 'new', label: t('admin.rev.kind.new'), color: KIND_COLORS.new },
            { key: 'renewal', label: t('admin.rev.kind.renewal'), color: KIND_COLORS.renewal },
            { key: 'upgrade', label: t('admin.rev.kind.upgrade'), color: KIND_COLORS.upgrade },
          ]}
          formatValue={f.money}
          formatX={(row) => seriesLabel(row.key)}
          height={180}
          emptyLabel={t('admin.rev.noPaymentsPeriod')}
        />
      </ChartCard>

      <ChartCard
        title={t('admin.rev.byPlanTitle')}
        hint={t('admin.rev.byPlanHint')}
        table={{
          columns: [
            { key: 'plan', label: t('admin.plan') },
            { key: 'amount', label: t('admin.rev.collected'), numeric: true },
            { key: 'count', label: t('admin.rev.payments'), numeric: true },
          ],
          rows: byPlan.map((row) => ({ plan: `${planName(row.plan)} · ${t(`admin.rev.cycle.${row.cycle}`)}`, amount: f.rupees(row.amount), count: f.num(row.count) })),
        }}
      >
        <DonutChart segments={planTotals} totalLabel={t('admin.rev.collected')} formatValue={f.money} emptyLabel={t('admin.rev.noPaymentsPeriod')} />
      </ChartCard>

      <ChartCard title={t('admin.rev.businessTitle')} hint={t('admin.rev.businessHint')}>
        <RankedBars
          rows={byBusinessType.map((row) => ({
            key: row.key,
            label: t(`businessType.${row.key}`) === `businessType.${row.key}` ? row.label : t(`businessType.${row.key}`),
            value: row.amount,
            color: 'var(--viz-2)',
            note: t('admin.rev.shopsCount', { n: f.num(row.shops) }),
          }))}
          formatValue={f.money}
          emptyLabel={t('admin.rev.noPaymentsPeriod')}
        />
      </ChartCard>

      <ChartCard title={t('admin.rev.bridgeTitle')} hint={t('admin.rev.bridgeHint')}>
        <SplitBar
          segments={[
            { key: 'net', label: t('admin.rev.collected'), value: discounts.net, color: 'var(--viz-3)' },
            { key: 'promo', label: t('admin.rev.promoDiscount'), value: discounts.promo, color: 'var(--viz-4)' },
            { key: 'points', label: t('admin.rev.pointsDiscount'), value: discounts.points, color: 'var(--viz-7)' },
          ]}
          formatValue={f.rupees}
          emptyLabel={t('admin.rev.noPaymentsPeriod')}
        />
        {discounts.gross > 0 && (
          <ul className="viz-facts">
            <li>
              <span>{t('admin.rev.listPrice')}</span>
              <strong>{f.rupees(discounts.gross)}</strong>
            </li>
            <li className={discountShare >= 15 ? 'is-warn' : undefined}>
              <span>{t('admin.rev.keptOfList')}</span>
              <strong>{f.num(100 - discountShare)}%</strong>
            </li>
          </ul>
        )}
      </ChartCard>

      <ChartCard title={t('admin.rev.baseTitle')} hint={t('admin.rev.baseHintNow')} href="/admin/sellers" hrefLabel={t('admin.rev.openShops')}>
        <SplitBar
          segments={[
            { key: 'paying', label: t('admin.rev.base.paying'), value: mrr.payingShops, color: 'var(--viz-3)' },
            { key: 'granted', label: t('admin.rev.base.granted'), value: mrr.grantedShops, color: 'var(--viz-4)' },
            { key: 'trial', label: t('admin.rev.base.trial'), value: mrr.trialShops, color: 'var(--viz-1)' },
            { key: 'lapsed', label: t('admin.rev.base.lapsed'), value: mrr.lapsedShops, color: 'var(--viz-8)' },
            { key: 'free', label: t('admin.rev.base.free'), value: mrr.freeShops, color: 'var(--text-faint)' },
          ]}
          formatValue={f.num}
          emptyLabel={t('admin.rev.noShops')}
        />
        <ul className="viz-facts">
          <li>
            <span>{t('admin.rev.conversion')}</span>
            <strong>{f.num(mrr.conversionPct)}%</strong>
          </li>
          {mrr.listRunRate > mrr.runRate && (
            <li>
              <span>{t('admin.rev.atListPrice')}</span>
              <strong>{f.rupees(mrr.listRunRate)}</strong>
              <em>{t('admin.rev.atListPriceNote', { amount: f.rupees(mrr.listRunRate - mrr.runRate) })}</em>
            </li>
          )}
          {mrr.suspendedPaying > 0 && (
            <li className="is-warn">
              <span>{t('admin.rev.suspendedPaying')}</span>
              <strong>{f.num(mrr.suspendedPaying)}</strong>
            </li>
          )}
        </ul>
      </ChartCard>

      <ChartCard title={t('admin.rev.cycleTitle')} hint={t('admin.rev.cycleHint')}>
        <SplitBar
          segments={[
            { key: 'monthly', label: t('admin.rev.cycleLabel.monthly'), value: byCycle.monthly, color: 'var(--viz-1)' },
            { key: 'yearly', label: t('admin.rev.cycleLabel.yearly'), value: byCycle.yearly, color: 'var(--viz-7)' },
          ]}
          formatValue={f.rupees}
          emptyLabel={t('admin.rev.noPaymentsPeriod')}
        />
        <div className="rev-split-gap" />
        <SplitBar
          segments={[
            { key: 'new', label: t('admin.rev.kind.new'), value: kinds.new, color: KIND_COLORS.new },
            { key: 'renewal', label: t('admin.rev.kind.renewal'), value: kinds.renewal + kinds.downgrade, color: KIND_COLORS.renewal },
            { key: 'upgrade', label: t('admin.rev.kind.upgrade'), value: kinds.upgrade, color: KIND_COLORS.upgrade },
          ]}
          formatValue={f.rupees}
          emptyLabel={t('admin.rev.noPaymentsPeriod')}
        />
      </ChartCard>

      <ChartCard title={t('admin.rev.checkoutTitle')} hint={t('admin.rev.checkoutPeriodHint')}>
        <div className="rev-ring-row">
          <ProgressRing
            value={checkout.successRate ?? 0}
            max={100}
            label={t('admin.rev.success')}
            formatValue={() => (checkout.successRate === null ? '—' : `${f.num(checkout.successRate)}%`)}
            tone={checkout.successRate !== null && checkout.successRate >= 70 ? 'good' : undefined}
          />
          <ul className="viz-facts rev-ring-facts">
            <li>
              <span>{t('admin.rev.status.paid')}</span>
              <strong>{f.num(checkout.paid)}</strong>
            </li>
            <li className={checkout.failed > 0 ? 'is-warn' : undefined}>
              <span>{t('admin.rev.failed')}</span>
              <strong>{f.num(checkout.failed)}</strong>
            </li>
            <li className={checkout.abandoned > 0 ? 'is-warn' : undefined}>
              <span>{t('admin.rev.abandoned')}</span>
              <strong>{f.num(checkout.abandoned)}</strong>
            </li>
          </ul>
        </div>
      </ChartCard>

      <ChartCard title={t('admin.rev.promosTitle')} hint={t('admin.rev.promosHint')}>
        <RankedBars
          rows={promos.map((row) => ({
            key: row.code,
            label: row.code,
            value: row.amount,
            color: 'var(--viz-4)',
            note: t('admin.rev.promoNote', { n: f.num(row.uses), amount: f.rupees(row.discount) }),
          }))}
          formatValue={f.money}
          emptyLabel={t('admin.rev.noPromos')}
        />
      </ChartCard>

      <ChartCard title={t('admin.rev.campaignsTitle')} hint={t('admin.rev.campaignsHint')} href="/admin/growth" hrefLabel={t('admin.rev.openGrowth')}>
        <RankedBars
          rows={campaigns.map((row) => ({
            key: row.id,
            label: row.name || t('admin.rev.deletedCampaign'),
            value: row.amount,
            color: 'var(--viz-5)',
            href: row.name ? recordHref('/admin/growth/[id]', row.id) : undefined,
            note: t('admin.rev.conversions', { n: f.num(row.conversions) }),
          }))}
          formatValue={f.money}
          emptyLabel={t('admin.rev.noCampaigns')}
        />
      </ChartCard>
    </div>
  );
}

function RenewalsPanel({ data, f }) {
  const { t, lang } = useLanguage();
  const { renewals } = data;

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="section-title">
          <div className="icon-badge icon-brand"><RepeatIcon size={16} /></div>
          <h2>{t('admin.rev.renewalsTitle', { days: f.num(renewals.days) })}</h2>
        </div>
        {renewals.count > 0 && <span className="rev-panel-total">{t('admin.rev.renewalsTotal', { amount: f.rupees(renewals.amount), n: f.num(renewals.count) })}</span>}
      </div>
      <p className="empty-state rev-hint">{t('admin.rev.renewalsHint')}</p>
      {renewals.rows.length === 0 ? (
        <p className="empty-state">{t('admin.rev.noRenewals')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('admin.shop')}</th>
                <th>{t('admin.plan')}</th>
                <th>{t('admin.rev.dueOn')}</th>
                <th className="num">{t('admin.rev.expected')}</th>
              </tr>
            </thead>
            <tbody>
              {renewals.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link className="link-btn name" href={recordHref('/admin/sellers/[id]', row.id)}>{row.shopName}</Link>
                    <div className="cell-sub">{row.phone ? <a href={`tel:${row.phone}`}>{row.phone}</a> : row.email}</div>
                  </td>
                  <td>
                    <span className="badge badge-safe">{planName(row.plan)}</span>
                    <div className="cell-sub">{t(`admin.rev.cycle.${row.cycle}`)}</div>
                  </td>
                  <td>
                    {formatDate(row.dueAt, lang)}
                    <div>
                      <span className={`badge ${row.daysLeft <= 7 ? 'badge-expiring' : 'badge-inactive'}`}>
                        {row.daysLeft === 0 ? t('admin.rev.dueToday') : t('admin.rev.daysLeft', { n: f.num(row.daysLeft) })}
                      </span>
                    </div>
                  </td>
                  <td className="num tabular">{f.rupees(row.expected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GrantedLapsed({ data, f, kind }) {
  const { t, lang } = useLanguage();
  const granted = kind === 'granted';
  const rows = granted ? data.granted : data.lapsed;

  return (
    <div className="panel">
      <div className="section-title">
        <div className={`icon-badge icon-${granted ? 'gold' : 'danger'}`}><ShopIcon size={16} /></div>
        <h2>{t(granted ? 'admin.rev.grantedTitle' : 'admin.rev.lapsedTitle')}</h2>
      </div>
      <p className="empty-state rev-hint">{t(granted ? 'admin.rev.grantedHint' : 'admin.rev.lapsedHint')}</p>
      {rows.length === 0 ? (
        <p className="empty-state">{t(granted ? 'admin.rev.noGranted' : 'admin.rev.noLapsed')}</p>
      ) : (
        <div className="activity-feed">
          {rows.map((row) => (
            <div className="activity-row" key={row.id}>
              <div className="activity-body">
                <div className="activity-title">
                  <Link className="link-btn name" href={recordHref('/admin/sellers/[id]', row.id)}>{row.shopName}</Link>
                </div>
                <div className="activity-meta">{row.email}</div>
              </div>
              <div className="activity-time">
                <span className="badge badge-safe">{planName(row.plan)}</span>{' '}
                {granted
                  ? t('admin.rev.worthPerMonth', { amount: f.rupees(row.worth) })
                  : `${row.expiredAt ? formatDate(row.expiredAt, lang) : '—'}${row.lostMonthly > 0 ? ` · ${t('admin.rev.lostPerMonth', { amount: f.rupees(row.lostMonthly) })}` : ''}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================================================================== VIP */

const TIER_FILTERS = ['all', 'vip', 'loyal', 'regular', 'atRisk'];

function VipTab({ data, f }) {
  const { t, lang } = useLanguage();
  const [tier, setTier] = useState('all');
  const [search, setSearch] = useState('');
  const { summary, rows, atRiskDays } = data.vip;
  const max = Math.max(1, ...rows.map((row) => row.lifetime));

  const tierRevenue = rows.reduce((acc, row) => ({ ...acc, [row.tier]: acc[row.tier] + row.lifetime }), { vip: 0, loyal: 0, regular: 0 });
  const counts = { all: rows.length, vip: summary.vip, loyal: summary.loyal, regular: summary.regular, atRisk: summary.atRisk };
  const needle = search.trim().toLowerCase();
  const shown = rows.filter((row) => {
    if (tier === 'atRisk' ? !row.atRisk : tier !== 'all' && row.tier !== tier) return false;
    if (!needle) return true;
    return [row.shopName, row.email, row.phone].some((value) => value && value.toLowerCase().includes(needle));
  });

  if (rows.length === 0) {
    return (
      <div className="panel">
        <p className="empty-state">{t('admin.rev.noVip')}</p>
      </div>
    );
  }

  return (
    <>
      <div className="info-banner rev-explain">
        <StarIcon size={15} /> {t('admin.rev.vipExplain', { days: f.num(atRiskDays) })}
      </div>

      <div className="viz-tiles">
        <StatTile
          label={t('admin.rev.vipShops')}
          value={f.num(summary.vip)}
          note={t('admin.rev.vipShareNote', { pct: f.num(summary.vipSharePct) })}
          icon={<StarIcon size={16} />}
          tone="gold"
        />
        <StatTile label={t('admin.rev.loyalShops')} value={f.num(summary.loyal)} note={t('admin.rev.loyalNote')} icon={<RepeatIcon size={16} />} tone="brand" />
        <StatTile label={t('admin.rev.regularShops')} value={f.num(summary.regular)} note={t('admin.rev.regularNote')} icon={<ShopIcon size={16} />} tone="muted" />
        <StatTile
          label={t('admin.rev.atRiskShops')}
          value={f.num(summary.atRisk)}
          note={t('admin.rev.atRiskNote', { amount: f.rupees(summary.atRiskMonthly) })}
          icon={<AlertIcon size={16} />}
          tone={summary.atRisk > 0 ? 'danger' : 'success'}
        />
        <StatTile
          label={t('admin.rev.top10Share')}
          value={`${f.num(summary.top10SharePct)}%`}
          note={t('admin.rev.top10Note', { n: f.num(summary.payingEver) })}
          icon={<BarChartIcon size={16} />}
          tone={summary.top10SharePct >= 80 && summary.payingEver > 10 ? 'danger' : 'brand'}
        />
      </div>

      <div className="viz-grid rev-grid">
        <ChartCard span="wide" title={t('admin.rev.tierSplitTitle')} hint={t('admin.rev.tierSplitHint')}>
          <SplitBar
            segments={[
              { key: 'vip', label: t('admin.rev.tier.vip'), value: tierRevenue.vip, color: TIER_COLORS.vip },
              { key: 'loyal', label: t('admin.rev.tier.loyal'), value: tierRevenue.loyal, color: TIER_COLORS.loyal },
              { key: 'regular', label: t('admin.rev.tier.regular'), value: tierRevenue.regular, color: TIER_COLORS.regular },
            ]}
            formatValue={f.rupees}
            emptyLabel={t('admin.rev.noVip')}
          />
        </ChartCard>
      </div>

      <div className="panel">
        <div className="panel-head rev-payments-head">
          <div className="segmented segmented-sm" role="group" aria-label={t('admin.rev.tab.vip')}>
            {TIER_FILTERS.map((key) => (
              <button key={key} type="button" className={tier === key ? 'active' : ''} onClick={() => setTier(key)}>
                {key === 'all' ? t('admin.all') : key === 'atRisk' ? t('admin.rev.atRisk') : t(`admin.rev.tier.${key}`)}
                <span className="rev-count">{f.num(counts[key])}</span>
              </button>
            ))}
          </div>
          <div className="search-box-inline">
            <SearchIcon size={15} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('admin.rev.searchShop')} />
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="empty-state">{t('admin.rev.noMatch')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('admin.shop')}</th>
                  <th>{t('admin.rev.tierHead')}</th>
                  <th>{t('admin.rev.lifetime')}</th>
                  <th className="num">{t('admin.rev.inPeriod')}</th>
                  <th className="num">{t('admin.rev.payments')}</th>
                  <th>{t('admin.rev.customerSince')}</th>
                  <th className="num">{t('admin.rev.avgPerMonth')}</th>
                  <th>{t('admin.rev.planNow')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id} className={row.atRisk ? 'rev-row-risk' : undefined}>
                    <td className="cell-sub tabular">{f.num(row.rank)}</td>
                    <td>
                      {row.shopName ? (
                        <Link className="link-btn name" href={recordHref('/admin/sellers/[id]', row.id)}>{row.shopName}</Link>
                      ) : (
                        <span className="cell-sub">{t('admin.rev.deletedShop')}</span>
                      )}
                      <div className="cell-sub">{t(`businessType.${row.businessType}`)}</div>
                      {(row.phone || row.email) && (
                        <div className="cell-sub">{row.phone ? <a href={`tel:${row.phone}`}>{row.phone}</a> : row.email}</div>
                      )}
                    </td>
                    <td>
                      <span className={`rev-tier rev-tier-${row.tier}`}>
                        {row.tier === 'vip' && <StarIcon size={12} />} {t(`admin.rev.tier.${row.tier}`)}
                      </span>
                      {row.atRisk && (
                        <div>
                          <span className="badge badge-rejected">{t('admin.rev.atRisk')}</span>
                        </div>
                      )}
                    </td>
                    <td className="rev-bar-cell">
                      <strong className="tabular">{f.rupees(row.lifetime)}</strong>
                      <span className="breakdown-track">
                        <span className="breakdown-fill" style={{ width: `${Math.max(3, (row.lifetime / max) * 100)}%` }} />
                      </span>
                      <span className="cell-sub">{t('admin.rev.shareOfAll', { pct: f.num(row.sharePct) })}</span>
                    </td>
                    <td className="num tabular">{row.periodPaid > 0 ? f.rupees(row.periodPaid) : '—'}</td>
                    <td className="num tabular">{f.num(row.payments)}</td>
                    <td>
                      {formatDate(row.firstPaidAt, lang)}
                      <div className="cell-sub">{t('admin.rev.tenure', { n: f.num(row.tenureMonths) })}</div>
                    </td>
                    <td className="num tabular">{f.rupees(row.perMonth)}</td>
                    <td>
                      <span className="badge badge-safe">{planName(row.plan)}</span>{' '}
                      <span className="cell-sub">{t(`admin.rev.cycle.${row.cycle}`)}</span>
                      <div>
                        <StatusBadge row={row} f={f} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function StatusBadge({ row, f }) {
  const { t, lang } = useLanguage();
  switch (row.status) {
    case 'active':
      return <span className="badge badge-approved">{row.expiresAt ? t('admin.rev.st.activeUntil', { date: formatDate(row.expiresAt, lang) }) : t('admin.rev.st.active')}</span>;
    case 'expiring':
      return <span className="badge badge-expiring">{row.daysLeft === 0 ? t('admin.rev.dueToday') : t('admin.rev.daysLeft', { n: f.num(row.daysLeft) })}</span>;
    case 'lapsed':
      return <span className="badge badge-expired">{t('admin.rev.st.lapsed')}</span>;
    case 'suspended':
      return <span className="badge badge-rejected">{t('admin.rev.st.suspended')}</span>;
    case 'granted':
      return <span className="badge badge-inactive">{t('admin.rev.st.granted')}</span>;
    case 'deleted':
      return <span className="badge badge-inactive">{t('admin.rev.st.deleted')}</span>;
    default:
      return <span className="badge badge-inactive">{t('admin.rev.st.free')}</span>;
  }
}

/* ================================================================== growth */

function GrowthTab({ data, f }) {
  const { t } = useLanguage();
  const { mrrHistory, cohorts, signups } = data;
  const partialNote = mrrHistory.some((row) => row.partial) ? t('admin.rev.partialMonth') : '';

  return (
    <>
      <div className="viz-grid rev-grid">
        <ChartCard
          span="wide"
          title={t('admin.rev.mrrHistoryTitle')}
          hint={t('admin.rev.mrrHistoryHint')}
          footer={partialNote || undefined}
          table={{
            columns: [
              { key: 'x', label: t('admin.rev.month') },
              { key: 'mrr', label: 'MRR', numeric: true },
              { key: 'shops', label: t('admin.rev.base.paying'), numeric: true },
              { key: 'new', label: t('admin.rev.move.new'), numeric: true },
              { key: 'expansion', label: t('admin.rev.move.expansion'), numeric: true },
              { key: 'reactivation', label: t('admin.rev.move.reactivation'), numeric: true },
              { key: 'contraction', label: t('admin.rev.move.contraction'), numeric: true },
              { key: 'churn', label: t('admin.rev.move.churn'), numeric: true },
            ],
            rows: mrrHistory.map((row) => ({
              x: monthLabel(row.period),
              mrr: f.rupees(row.mrr),
              shops: f.num(row.shops),
              new: f.rupees(row.new),
              expansion: f.rupees(row.expansion),
              reactivation: f.rupees(row.reactivation),
              contraction: row.contraction ? `−${f.rupees(row.contraction)}` : f.rupees(0),
              churn: row.churn ? `−${f.rupees(row.churn)}` : f.rupees(0),
            })),
          }}
        >
          <LineChart
            data={mrrHistory}
            series={[{ key: 'mrr', label: 'MRR', color: 'var(--viz-3)' }]}
            formatValue={f.money}
            formatX={(row) => monthLabel(row.period)}
            height={170}
            emptyLabel={t('admin.rev.noPayments')}
          />
        </ChartCard>

        <ChartCard title={t('admin.rev.gainsTitle')} hint={t('admin.rev.gainsHint')}>
          <StackedColumnChart
            data={mrrHistory}
            series={[
              { key: 'new', label: t('admin.rev.move.new'), color: 'var(--viz-3)' },
              { key: 'expansion', label: t('admin.rev.move.expansion'), color: 'var(--viz-7)' },
              { key: 'reactivation', label: t('admin.rev.move.reactivation'), color: 'var(--viz-1)' },
            ]}
            formatValue={f.money}
            formatX={(row) => monthLabel(row.period)}
            emptyLabel={t('admin.rev.noGains')}
          />
        </ChartCard>

        <ChartCard title={t('admin.rev.lossesTitle')} hint={t('admin.rev.lossesHint')}>
          <StackedColumnChart
            data={mrrHistory}
            series={[
              { key: 'churn', label: t('admin.rev.move.churn'), color: 'var(--viz-8)' },
              { key: 'contraction', label: t('admin.rev.move.contraction'), color: 'var(--viz-4)' },
            ]}
            formatValue={f.money}
            formatX={(row) => monthLabel(row.period)}
            emptyLabel={t('admin.rev.noLosses')}
          />
        </ChartCard>

        <ChartCard title={t('admin.rev.payingShopsTitle')} hint={t('admin.rev.payingShopsHint')}>
          <ColumnChart
            data={mrrHistory.map((row) => ({ x: row.period, y: row.shops, sub: t('admin.rev.shopsCount', { n: f.num(row.shops) }) }))}
            formatValue={(value) => f.num(Math.round(value))}
            formatX={(row) => monthLabel(row.x)}
            color="var(--viz-1)"
            emptyLabel={t('admin.rev.noPayments')}
          />
        </ChartCard>

        <ChartCard title={t('admin.rev.signupsTitle')} hint={t('admin.rev.signupsHint')}>
          <ul className="viz-facts rev-facts-top">
            <li>
              <span>{t('admin.rev.signedUp')}</span>
              <strong>{f.num(signups.count)}</strong>
            </li>
            <li>
              <span>{t('admin.rev.signedUpPaid')}</span>
              <strong>{f.num(signups.paid)}</strong>
              {signups.conversionPct !== null && <em>{t('admin.rev.signedUpPct', { pct: f.num(signups.conversionPct) })}</em>}
            </li>
            <li>
              <span>{t('admin.rev.medianDays')}</span>
              <strong>{signups.medianDaysToPay === null ? '—' : t('admin.rev.daysN', { n: f.num(signups.medianDaysToPay) })}</strong>
              <em>{t('admin.rev.medianDaysNote')}</em>
            </li>
          </ul>
        </ChartCard>
      </div>

      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-brand"><UsersIcon size={16} /></div>
          <h2>{t('admin.rev.cohortTitle')}</h2>
        </div>
        <p className="empty-state rev-hint">{t('admin.rev.cohortHint')}</p>
        {cohorts.length === 0 ? (
          <p className="empty-state">{t('admin.rev.noPayments')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table rev-cohort">
              <thead>
                <tr>
                  <th>{t('admin.rev.firstPaidMonth')}</th>
                  <th className="num">{t('admin.rev.shopsHead')}</th>
                  {[1, 3, 6, 12].map((n) => (
                    <th key={n} className="num">{t('admin.rev.afterMonths', { n: f.num(n) })}</th>
                  ))}
                  <th className="num">{t('admin.rev.payingNow')}</th>
                  <th className="num">{t('admin.rev.cohortRevenue')}</th>
                  <th className="num">{t('admin.rev.avgLifetime')}</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.map((row) => (
                  <tr key={row.period}>
                    <td>{monthLabel(row.period, true)}</td>
                    <td className="num tabular">{f.num(row.shops)}</td>
                    {row.retained.map((pct, index) => (
                      <td key={index} className="num tabular">
                        {pct === null ? (
                          <span className="cell-sub">—</span>
                        ) : (
                          <span className="rev-heat" style={{ '--heat-i': 0.12 + (pct / 100) * 0.75 }}>
                            {f.num(pct)}%
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="num tabular">
                      {f.num(row.activeNow)} <span className="cell-sub">({f.num(row.activeNowPct)}%)</span>
                    </td>
                    <td className="num tabular">{f.rupees(row.revenue)}</td>
                    <td className="num tabular">{f.rupees(row.avgLifetime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ================================================================== payments */

const PAY_STATUSES = ['', 'paid', 'failed', 'created'];
const PAY_KINDS = ['', 'new', 'renewal', 'upgrade', 'downgrade'];

function PaymentsTab({ query, filter, onFilter, f }) {
  const { t, lang } = useLanguage();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [searchInput, setSearchInput] = useState(filter.q);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);

  // Typing is debounced — a search per keystroke over a year of payments is wasted work.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput.trim() !== filter.q) onFilter({ ...filter, q: searchInput.trim() });
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, filter, onFilter]);

  // A new filter with an old page number would ask for page 6 of a 2-page result.
  useEffect(() => {
    setPage(1);
  }, [query, filter.status, filter.kind, filter.q, pageSize]);

  useEffect(() => {
    const mine = ++seq.current;
    const params = new URLSearchParams(query);
    if (filter.status) params.set('status', filter.status);
    if (filter.kind) params.set('kind', filter.kind);
    if (filter.q) params.set('q', filter.q);
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    setLoading(true);
    apiFetch(`/api/admin/revenue/payments?${params.toString()}`)
      .then((res) => {
        if (mine !== seq.current) return;
        setResult(res);
        setError('');
      })
      .catch((err) => mine === seq.current && setError(err.message))
      .finally(() => mine === seq.current && setLoading(false));
  }, [query, filter.status, filter.kind, filter.q, page, pageSize]);

  const byStatus = result?.byStatus;
  const allCount = byStatus ? byStatus.paid.count + byStatus.failed.count + byStatus.created.count : 0;

  return (
    <div className="panel">
      <div className="panel-head rev-payments-head">
        <div className="segmented segmented-sm" role="group" aria-label={t('common.status')}>
          {PAY_STATUSES.map((key) => (
            <button key={key || 'all'} type="button" className={filter.status === key ? 'active' : ''} onClick={() => onFilter({ ...filter, status: key })}>
              {key ? t(`admin.rev.status.${key}`) : t('admin.all')}
              {byStatus && <span className="rev-count">{f.num(key ? byStatus[key].count : allCount)}</span>}
            </button>
          ))}
        </div>
        <div className="rev-pay-tools">
          <Dropdown
            className="filter-select"
            value={filter.kind}
            onChange={(kind) => onFilter({ ...filter, kind })}
            options={PAY_KINDS.map((key) => ({ value: key, label: key ? t(`admin.rev.kind.${key}`) : t('admin.rev.allKinds') }))}
          />
          <div className="search-box-inline">
            <SearchIcon size={15} />
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder={t('admin.rev.searchPayments')} />
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {byStatus && (
        <p className="rev-pay-summary">
          {t('admin.rev.paySummary', { n: f.num(result.total), amount: f.rupees(byStatus.paid.amount), paid: f.num(byStatus.paid.count) })}
          {byStatus.created.count > 0 && ` · ${t('admin.rev.payNotCompleted', { n: f.num(byStatus.created.count), amount: f.rupees(byStatus.created.amount) })}`}
        </p>
      )}

      {!result ? (
        <SkeletonTable rows={8} cols={8} />
      ) : result.rows.length === 0 ? (
        <p className="empty-state">{t('admin.rev.noPaymentsPeriod')}</p>
      ) : (
        <div style={{ overflowX: 'auto', opacity: loading ? 0.55 : 1 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('admin.rev.dateHead')}</th>
                <th>{t('admin.shop')}</th>
                <th>{t('admin.plan')}</th>
                <th className="num">{t('admin.rev.listPrice')}</th>
                <th className="num">{t('admin.rev.discount')}</th>
                <th className="num">{t('admin.rev.amount')}</th>
                <th>{t('common.status')}</th>
                <th>{t('admin.rev.reference')}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((p) => {
                const discount = p.promo + p.points;
                return (
                  <tr key={p.id}>
                    <td>
                      {formatDate(p.createdAt, lang)}
                      <div className="cell-sub">{new Date(p.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                    <td>
                      {p.shopId && p.shopName ? (
                        <Link className="link-btn name" href={recordHref('/admin/sellers/[id]', p.shopId)}>{p.shopName}</Link>
                      ) : (
                        <span className="cell-sub">{t('admin.rev.deletedShop')}</span>
                      )}
                      {p.kind && (
                        <div>
                          <span className={`rev-kind rev-kind-${p.kind}`}>{t(`admin.rev.kind.${p.kind}`)}</span>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-safe">{planName(p.plan)}</span>
                      <div className="cell-sub">{t(`admin.rev.cycle.${p.cycle}`)}</div>
                    </td>
                    <td className="num tabular cell-sub">{f.rupees(p.gross)}</td>
                    <td className="num tabular">
                      {discount > 0 ? `−${f.rupees(discount)}` : '—'}
                      {p.promoCode && <div className="cell-sub">{p.promoCode}</div>}
                      {p.points > 0 && <div className="cell-sub">{t('admin.rev.pointsShort')}</div>}
                    </td>
                    <td className="num tabular">
                      <strong>{f.rupees(p.amount)}</strong>
                    </td>
                    <td>
                      <span className={`badge badge-${p.status === 'paid' ? 'approved' : p.status === 'failed' ? 'rejected' : 'pending'}`}>
                        {t(`admin.rev.status.${p.status}`)}
                      </span>
                    </td>
                    <td className="cell-sub">{p.razorpayPaymentId || p.razorpayOrderId || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {result && result.total > 0 && (
        <Pagination
          page={page}
          pageCount={result.pages}
          pageSize={pageSize}
          total={result.total}
          from={(page - 1) * pageSize + 1}
          to={Math.min(page * pageSize, result.total)}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}
    </div>
  );
}
