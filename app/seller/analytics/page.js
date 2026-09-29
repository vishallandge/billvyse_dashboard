'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { getShopSocket } from '../../../lib/socket';
import { useHiddenNav, useDashboardStores, useDashboardUser } from '../../components/DashboardShell';
import { useLanguage } from '../../components/LanguageProvider';
import { formatRupees, formatCompactRupees } from '../../../lib/format';
import { formatNumber } from '../../../lib/hindiNumerals';
import DateRangeFilter, { rangeToQuery } from '../../components/DateRangeFilter';
import Dropdown from '../../components/Dropdown';
import {
  ChartCard, ChartToggle, LineChart, ColumnChart, DonutChart, RankedBars, HeatMap,
  ProgressRing, SplitBar, StatTile, Legend,
} from '../../components/Charts';
import { SkeletonStats } from '../../components/Skeleton';
import ClearedWins from '../../components/ClearedWins';
import {
  RupeeIcon, ReceiptIcon, LedgerIcon, PackageIcon, WalletIcon, TrendUpIcon, ActivityIcon,
  RefreshIcon, ZapIcon, ChevronRightIcon, UsersIcon, ClockIcon, AlertIcon, SparkleIcon,
  InfoIcon, DownloadIcon, TargetIcon, EditIcon, CheckIcon, XIcon, ChevronDownIcon,
} from '../../components/Icons';
import { recordHref } from '../../../lib/routeId';

// This screen opens on the last 30 days, not on today: a single day is a reading, a month
// is a shape, and the shape is what a dashboard exists to show. "Today" is one tap away and
// is what the overview page already leads with.
const ANALYTICS_RANGE = { preset: 'last30', from: '', to: '' };

const RANGE_PRESETS = ['today', 'yesterday', 'last7', 'last30', 'month', 'lastMonth', 'quarter', 'fy'];

// Payment modes in a FIXED order with FIXED colour slots. Never sorted by amount: a shop
// whose UPI overtakes cash this month must not see the two swap colours — the reader
// learned "cash is blue" and that has to stay true. The order is also what keeps the
// touching arcs on the palette's validated adjacent pairs.
const PAYMENT_MODES = [
  { mode: 'cash', color: 'var(--viz-1)' },
  { mode: 'upi', color: 'var(--viz-2)' },
  { mode: 'card', color: 'var(--viz-3)' },
  { mode: 'khata', color: 'var(--viz-4)' },
  { mode: 'bank', color: 'var(--viz-5)' },
];

// Udhaar aging is ordered, not categorical — the whole point is that the right-hand end is
// older and worse — so it takes a single-hue ramp that darkens (light mode) / brightens
// (dark mode) with age, handled by the CSS variables below.
const AGING_COLORS = ['var(--viz-ramp-1)', 'var(--viz-ramp-2)', 'var(--viz-ramp-3)', 'var(--viz-ramp-4)'];

// Which module screen each card drills into. The dashboard answers "what is happening";
// these answer "show me the rows behind it".
const DRILL = {
  reports: '/seller/reports',
  billing: '/seller/billing',
  khata: '/seller/khata',
  inventory: '/seller/products',
  expenses: '/seller/expenses',
  daybook: '/seller/daybook',
  staff: '/seller/staff',
  orders: '/seller/orders',
  loyalty: '/seller/loyalty',
  purchaseOrders: '/seller/purchase-orders',
};

// An insight's tone is the same thing its icon says, so a shopkeeper who reads slowly can
// still sort "paisa nikal raha hai" from "acha chal raha hai" at a glance.
const INSIGHT_ICONS = { urgent: AlertIcon, warn: ClockIcon, good: TrendUpIcon, info: InfoIcon };

// A rise in sales is good news; a rise in udhaar given is not. Only meaningful when the
// previous period had something in it to compare against.
function deltaPct(current, previous) {
  if (!previous || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Is this margin worth showing as a number?
 *
 * The server sends `marginCoverage` beside every margin: the share of that margin's own
 * revenue that came from items whose cost price the shop has actually entered (see
 * lineHasCost in analyticsController.js). Without it the arithmetic still produces a
 * percentage — a very flattering one — and this page was printing it.
 *
 * A real restaurant's screen showed every dish at exactly 95.24% margin, which is not a
 * margin at all but `1 / 1.05`: the GST-exclusive share of a price with no cost behind
 * it. Its bottled drinks, which did have cost prices, read 19% and 30% in the same list.
 * A shopkeeper reading that would conclude the kitchen prints money and the fridge is
 * dead weight, and would be exactly wrong.
 *
 * Three states, because "we don't know" and "we half know" are different answers:
 *   'ok'      — 80%+ costed. Show the number.
 *   'partial' — some costed. Show it, flagged, because a partial margin still ranks
 *               items usefully even though its absolute value is too high.
 *   'unknown' — nothing costed. Show no percentage at all. This is the case that was
 *               producing the lie, and the only honest output is to say so and point at
 *               the fix.
 */
const MARGIN_TRUSTED_AT = 0.8;

function marginConfidence(coverage) {
  if (coverage === null || coverage === undefined) return 'unknown';
  if (coverage >= MARGIN_TRUSTED_AT) return 'ok';
  if (coverage > 0) return 'partial';
  return 'unknown';
}

// CSV, not the app's own formatting. A shop exporting this is taking it to a CA or into
// Excel, where "₹1,24,500" and Devanagari digits are text that no formula can add up —
// so every number leaves here as a plain number and every label as its translated name.
function toCsv(rows) {
  return rows
    .map((cols) =>
      cols
        .map((cell) => {
          const value = cell === null || cell === undefined ? '' : String(cell);
          return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(',')
    )
    .join('\r\n');
}

// A counter tablet runs this as an installed PWA — a cached bundle talking to a server
// that may be a version ahead of it or behind it (and during a deploy, both within a
// minute). A payload missing a block the bundle knows about must degrade to an empty card,
// never take the whole screen down: the shopkeeper is looking at their day's sales, and a
// blank error page is far worse than a chart that says "—".
const EMPTY_MIX = { newCustomers: 0, repeatCustomers: 0, newSales: 0, repeatSales: 0, walkInBills: 0, walkInSales: 0 };

function withDefaults(payload) {
  return {
    ...payload,
    kpi: payload.kpi || {},
    trend: payload.trend || [],
    paymentMix: payload.paymentMix || [],
    topItems: payload.topItems || [],
    topCustomers: payload.topCustomers || [],
    atRiskCustomers: payload.atRiskCustomers || [],
    insights: payload.insights || [],
    customerMix: { ...EMPTY_MIX, ...payload.customerMix },
    inventory: payload.inventory || null,
    moneyDistribution: payload.moneyDistribution || null,
    // Null for every shop that does not run tables — the panel renders nothing rather
    // than a grid of zeroes.
    tables: payload.tables || null,
    target: payload.target || null,
    lens: payload.lens || {},
    range: payload.range || {},
  };
}

function downloadCsv(name, rows) {
  // The BOM is what makes Excel on Windows read this as UTF-8 instead of mangling every
  // Devanagari product name into mojibake.
  const blob = new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function AnalyticsPage() {
  const hiddenNav = useHiddenNav();
  const { stores } = useDashboardStores();
  // A staff login on this screen is a branch manager — nobody else on the counter can
  // reach it — and everything below is pinned to their own branch by the server.
  const currentUser = useDashboardUser();
  const branchManager = currentUser?.role === 'staff';
  const { t, lang } = useLanguage();

  const [range, setRange] = useState(ANALYTICS_RANGE);
  const [storeId, setStoreId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [liveAt, setLiveAt] = useState(null);
  const [metric, setMetric] = useState('money');
  const [compare, setCompare] = useState(true);
  const refetchTimer = useRef(null);
  const loadedOnce = useRef(false);

  // A nav key that this shop cannot reach (module off, plan, or wrong trade) must not get a
  // drill-down link — the card would be offering a door onto a 403.
  const drill = useCallback((key) => (hiddenNav?.includes(key) ? undefined : DRILL[key]), [hiddenNav]);

  // Only the very first load gets skeletons. A range change or a live event re-renders in
  // place, holding the previous board at reduced opacity — a dashboard that collapses back
  // to grey boxes every time a bill is written is unreadable at a busy counter.
  const load = useCallback(
    (mode = 'quiet') => {
      if (mode === 'full') setLoading(true);
      else setRefreshing(true);
      setError('');
      const storeQuery = storeId ? `&storeId=${storeId}` : '';
      return apiFetch(`/api/seller/analytics?${rangeToQuery(range)}${storeQuery}`)
        .then((payload) => {
          setData(withDefaults(payload));
          setLiveAt(new Date());
        })
        .catch((err) => setError(err.message))
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [range, storeId]
  );

  useEffect(() => {
    load(loadedOnce.current ? 'quiet' : 'full');
    loadedOnce.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, storeId]);

  // Live. Every event that can change a number on this screen already reaches the shop room
  // (see backend/realtime.js), so the dashboard listens instead of polling. Debounced,
  // because a busy counter fires bill:created several times a minute and each one would
  // otherwise be a full recompute of the month.
  //
  // Only while the selected range still includes now — refetching "last month" because a
  // bill was just written today would re-render an identical payload for nothing.
  const rangeIsLive = useMemo(() => {
    if (!data?.range?.to) return true;
    return new Date(data.range.to).getTime() >= Date.now();
  }, [data?.range?.to]);

  useEffect(() => {
    const socket = getShopSocket();
    if (!socket) return undefined;

    function scheduleRefetch() {
      if (!rangeIsLive) return;
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => load('quiet'), 1500);
    }

    const events = ['bill:created', 'order:created', 'order:updated', 'appointment:created', 'table:settled', 'paymentClaim:new'];
    events.forEach((event) => socket.on(event, scheduleRefetch));
    return () => {
      events.forEach((event) => socket.off(event, scheduleRefetch));
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
  }, [load, rangeIsLive]);

  const money = useCallback((value, options) => (options?.axis ? formatCompactRupees(value, lang) : formatRupees(value, lang, { decimals: false })), [lang]);
  const rupees = useCallback((value) => formatRupees(value, lang, { decimals: false }), [lang]);
  // `?? 0` for the same reason as withDefaults(): formatNumber prints the string
  // "undefined" for a missing value, and a tile reading "undefined items per bill" is a
  // worse failure than a zero, because it looks like the shop's data is broken.
  const count = useCallback((value) => formatNumber(value ?? 0, lang), [lang]);
  const hourLabel = useCallback((hour) => `${String(hour).padStart(2, '0')}:00`, []);

  // A bucket key is an ISO date (or YYYY-MM) — turned into a label here rather than on the
  // server so it follows the shop's chosen language and Devanagari numerals.
  const formatBucket = useCallback(
    (row) => {
      const key = typeof row === 'string' ? row : row?.key;
      if (!key) return '';
      if (data?.range?.bucket === 'month') {
        const [year, month] = key.split('-');
        return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      }
      const [year, month, day] = key.split('-');
      return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    },
    [data?.range?.bucket]
  );

  const kpi = data?.kpi;
  const advanced = data?.advanced;
  const inventory = data?.inventory;

  // The trend's own last 14 buckets, reused as the sparkline under the headline figures.
  const salesSpark = useMemo(() => (data?.trend || []).slice(-14).map((row) => row.sales), [data?.trend]);
  const profitSpark = useMemo(() => (data?.trend || []).slice(-14).map((row) => row.profit), [data?.trend]);

  const paymentSegments = useMemo(() => {
    if (!data?.paymentMix) return [];
    const byMode = new Map(data.paymentMix.map((row) => [row.mode, row.amount]));
    return PAYMENT_MODES.filter((slot) => (byMode.get(slot.mode) || 0) > 0).map((slot) => ({
      key: slot.mode,
      label: t(`analytics.mode.${slot.mode}`),
      value: byMode.get(slot.mode),
      color: slot.color,
    }));
  }, [data?.paymentMix, t]);

  // The trend card's two lines, or one, depending on what it's been switched to. The
  // comparison period is the same measure drawn as a ghost behind it — never a second
  // scale, never a second axis.
  // A long range buckets by month, and the window before it doesn't always split into the
  // same number of months — so a bucket can have no counterpart to compare against. Rather
  // than draw those as zero (which reads as "we sold nothing that month"), the comparison
  // is simply not offered when the two windows don't line up.
  const canCompare = useMemo(
    () => (data?.trend || []).length > 0 && data.trend.every((row) => row.prev !== null),
    [data?.trend]
  );

  const trendSeries = useMemo(() => {
    if (metric === 'bills') return [{ key: 'bills', label: t('analytics.col.bills'), color: 'var(--viz-1)' }];
    const series = [
      { key: 'sales', label: t('analytics.col.sales'), color: 'var(--viz-1)' },
      { key: 'profit', label: t('analytics.col.profit'), color: 'var(--viz-2)' },
    ];
    if (compare && canCompare) series.push({ key: 'prev', label: t('analytics.prevPeriod'), color: 'var(--viz-7)', ghost: true });
    return series;
  }, [metric, compare, canCompare, t]);

  function expenseCategoryLabel(key) {
    const label = t(`expenses.category.${key}`);
    // Shopkeepers can type their own category; `translate` hands the path back when there
    // is no string for it, which would otherwise print "expenses.category.chai-wala".
    return label.startsWith('expenses.category.') ? key : label;
  }

  // An insight arrives as a key plus raw numbers. Rupee params go through the shop's own
  // formatter, weekday and hour params through its translations — so a Marathi shop with
  // Devanagari digits reads "शनिवार" and "₹४,३००", not "5" and "4300".
  const insightText = useCallback(
    (insight) => {
      const params = { ...insight.params };
      (insight.money || []).forEach((name) => {
        params[name] = formatRupees(params[name], lang, { decimals: false });
      });
      ['best', 'worst'].forEach((name) => {
        if (params[name] !== undefined) params[name] = t(`analytics.weekday.${params[name]}`);
      });
      ['hour', 'nextHour'].forEach((name) => {
        if (params[name] !== undefined) params[name] = hourLabel(params[name]);
      });
      ['count', 'bills', 'days', 'pct', 'margin', 'per100', 'times'].forEach((name) => {
        if (params[name] !== undefined) params[name] = formatNumber(params[name], lang);
      });
      return t(`analytics.insight.${insight.key}`, params);
    },
    [lang, t, hourLabel]
  );

  const salesDelta = kpi ? deltaPct(kpi.sales, kpi.salesPrev) : null;

  // Everything on the screen, as rows. Sections are stacked into one file rather than one
  // download per card: the shopkeeper wants "the month", not eight files to reconcile.
  function exportCsv() {
    if (!data) return;
    const rows = [];
    const section = (title, header, body) => {
      if (rows.length) rows.push([]);
      rows.push([title]);
      rows.push(header);
      body.forEach((row) => rows.push(row));
    };

    rows.push([t('analytics.title'), data.range.from.slice(0, 10), data.range.to.slice(0, 10)]);
    section(t('analytics.export.summary'), [t('analytics.col.period'), t('analytics.col.amount')], [
      [t('analytics.col.sales'), kpi.sales],
      [t('analytics.tile.grossProfit'), kpi.grossProfit],
      [t('analytics.netProfit'), kpi.netProfit],
      [t('analytics.margin'), kpi.margin ?? ''],
      [t('analytics.tile.bills'), kpi.billCount],
      [t('analytics.tile.avgBill'), kpi.avgBill],
      [t('analytics.tile.expenses'), kpi.expenses],
      [t('analytics.tile.udhaarGiven'), kpi.udhaarGiven],
      [t('analytics.tile.udhaarRecovered'), kpi.udhaarRecovered],
      [t('analytics.tile.khataOutstanding'), kpi.khataOutstanding],
      [t('analytics.tile.stockValue'), kpi.stockCostValue],
    ]);
    section(
      t('analytics.chart.trend'),
      [t('analytics.col.period'), t('analytics.col.sales'), t('analytics.col.profit'), t('analytics.col.bills'), t('analytics.prevPeriod')],
      data.trend.map((row) => [formatBucket(row), row.sales, row.profit, row.bills, row.prev ?? ''])
    );
    section(
      t('analytics.chart.payments'),
      [t('analytics.col.mode'), t('analytics.col.amount')],
      data.paymentMix.map((row) => [t(`analytics.mode.${row.mode}`), row.amount])
    );
    if (data.moneyDistribution?.segments?.length) {
      section(
        t('analytics.chart.moneyDistribution'),
        [t('analytics.col.category'), t('analytics.col.amount')],
        data.moneyDistribution.segments.map((row) => [t(`analytics.money.${row.key}`), row.value])
      );
    }
    section(
      t('analytics.chart.topItems'),
      [t('analytics.col.item'), t('analytics.col.qty'), t('analytics.col.revenue'), t('analytics.col.profit'), t('analytics.col.margin')],
      data.topItems.map((row) => [row.name, row.qty, row.revenue, row.profit, row.margin ?? ''])
    );
    section(
      t('analytics.chart.topCustomers'),
      [t('analytics.col.customer'), t('analytics.col.bills'), t('analytics.col.spent'), t('analytics.col.balance')],
      data.topCustomers.map((row) => [row.name, row.bills, row.spent, row.balance])
    );
    if (data.atRiskCustomers?.length) {
      section(
        t('analytics.chart.atRisk'),
        [t('analytics.col.customer'), t('analytics.col.quietDays'), t('analytics.col.spent')],
        data.atRiskCustomers.map((row) => [row.name, row.quietDays, row.spent])
      );
    }
    if (inventory?.deadItems?.length) {
      section(
        t('analytics.chart.deadStock'),
        [t('analytics.col.item'), t('analytics.col.qty'), t('analytics.col.value')],
        inventory.deadItems.map((row) => [row.name, row.stock, row.value])
      );
    }
    if (data.categoryProfit?.length) {
      section(
        t('analytics.chart.category'),
        [t('analytics.col.category'), t('analytics.col.revenue'), t('analytics.col.profit'), t('analytics.col.margin')],
        data.categoryProfit.map((row) => [row.category, row.revenue, row.profit, row.margin ?? ''])
      );
    }
    if (data.expenseSplit?.length) {
      section(
        t('analytics.chart.expenses'),
        [t('analytics.col.category'), t('analytics.col.amount')],
        data.expenseSplit.map((row) => [expenseCategoryLabel(row.category), row.amount])
      );
    }
    if (data.staff?.length) {
      section(
        t('analytics.chart.staff'),
        [t('analytics.col.staff'), t('analytics.col.bills'), t('analytics.col.sales')],
        data.staff.map((row) => [row.name, row.bills, row.sales])
      );
    }

    downloadCsv(`insights-${data.range.from.slice(0, 10)}-${data.range.to.slice(0, 10)}.csv`, rows);
  }

  return (
    <>
      <div className="content-header">
        <h1>{t('analytics.title')}</h1>
        <p>{t('analytics.subtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {branchManager && <div className="info-banner">{t('seller.branchOnlyNotice')}</div>}

      {/* One filter row, above everything it scopes — every card below re-renders against
          this same slice, so no two numbers on the screen can be from different periods. */}
      <div className="filter-bar viz-filter-bar">
        <DateRangeFilter value={range} onChange={setRange} presets={RANGE_PRESETS} />
        {stores.length > 1 && (
          <Dropdown
            value={storeId}
            onChange={setStoreId}
            options={[{ value: '', label: t('seller.reportAllStores') }, ...stores.map((s) => ({ value: s._id, label: s.name }))]}
            className="filter-select"
          />
        )}
        <div className="viz-live">
          <span className={`viz-live-dot${rangeIsLive ? ' is-live' : ''}`} />
          {rangeIsLive ? t('analytics.live') : t('analytics.notLive')}
          {liveAt && <em>{liveAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</em>}
          <button
            type="button"
            className="icon-btn"
            onClick={() => load('quiet')}
            disabled={refreshing}
            aria-label={t('common.refresh')}
            data-tip={t('common.refresh')}
          >
            <RefreshIcon size={17} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={exportCsv}
            disabled={!data}
            aria-label={t('analytics.export.csv')}
            data-tip={t('analytics.export.csv')}
          >
            <DownloadIcon size={17} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <SkeletonStats count={6} />
      ) : (
        data && (
          // While a live refetch is in flight the whole board holds its previous render at
          // reduced opacity. No skeleton, no layout jump — the numbers just settle.
          <div className={`viz-board${refreshing || loading ? ' is-refreshing' : ''}`}>
            {/* ---- the good news, if there is any ---- */}
            {/* Above the insight strip on purpose: this board is otherwise a page of
                deltas and diagnoses, and a lot that cleared at a profit is the one thing
                on it that needs no interpreting. Renders nothing when there is nothing. */}
            <ClearedWins />

            {/* ---- what the numbers mean, before the numbers ---- */}
            <InsightStrip items={data.insights} render={insightText} drill={drill} />

            {/* ---- the one hero figure on this screen ---- */}
            <section className="viz-hero">
              <div className="viz-hero-main">
                <span className="viz-hero-label">
                  <span className="stat-card-icon icon-brand"><RupeeIcon size={16} /></span>
                  {t('analytics.heroLabel', { period: t(`range.${data.range.preset}`) })}
                </span>
                <strong className="viz-hero-value">{rupees(kpi.sales)}</strong>
                <div className="viz-hero-meta">
                  {salesDelta !== null && (
                    <span className={`viz-delta${salesDelta >= 0 ? ' is-good' : ' is-bad'}`}>
                      {salesDelta >= 0 ? '▲' : '▼'} {Math.abs(salesDelta)}%
                      <em>{t('analytics.vsPrev')}</em>
                    </span>
                  )}
                  <span className="viz-hero-sub">
                    {t('analytics.heroSub', { bills: count(kpi.billCount), avg: rupees(kpi.avgBill) })}
                  </span>
                </div>
                <div className="viz-hero-run">
                  {t('analytics.perDay', { amount: rupees(kpi.salesPerDay) })}
                  {kpi.bestBucket && (
                    <>
                      {' · '}
                      {t('analytics.bestDay', { day: formatBucket(kpi.bestBucket.key), amount: rupees(kpi.bestBucket.sales) })}
                    </>
                  )}
                </div>
              </div>

              {/* The one sentence this whole page is for. Margin and expenses are the two
                  numbers a dukandar almost never has, and "kitna kamaya" is not sales. */}
              <div className="viz-hero-side">
                <div className="viz-hero-figure">
                  <span>{t('analytics.netProfit')}</span>
                  <strong className={kpi.netProfit >= 0 ? 'is-good' : 'is-bad'}>{rupees(kpi.netProfit)}</strong>
                  <em>
                    {t('analytics.netProfitFormula', {
                      gross: rupees(kpi.grossProfit),
                      expenses: rupees(kpi.expenses),
                    })}
                  </em>
                </div>
                {/* The margin figure only appears when there is a cost price behind it.
                    With none, this used to read "87.29% — out of every ₹100 of sales",
                    which is the most confident sentence on the page and was built on a
                    cost of zero. It now says what is missing and links to the fix. */}
                <div className="viz-hero-figure">
                  <span>{t('analytics.margin')}</span>
                  {marginConfidence(kpi.marginCoverage) === 'unknown' ? (
                    <>
                      <strong className="is-unknown">—</strong>
                      <em>
                        <Link href="/seller/products?cost=missing" className="viz-drill">
                          {t('analytics.marginNoCost')}
                        </Link>
                      </em>
                    </>
                  ) : (
                    <>
                      <strong>{kpi.margin === null ? '—' : `${count(kpi.margin)}%`}</strong>
                      <em>
                        {marginConfidence(kpi.marginCoverage) === 'partial'
                          ? t('analytics.marginPartial', { pct: count(Math.round(kpi.marginCoverage * 100)) })
                          : t('analytics.marginHint')}
                      </em>
                    </>
                  )}
                </div>
              </div>

              <TargetBlock target={data.target} onSaved={(next) => setData((prev) => ({ ...prev, target: next }))} />
            </section>

            {/* ---- the numbers, each one a door into its module ---- */}
            <div className="viz-tiles">
              <StatTile
                label={t('analytics.tile.grossProfit')}
                value={rupees(kpi.grossProfit)}
                delta={deltaPct(kpi.grossProfit, kpi.grossProfitPrev)}
                deltaLabel={t('analytics.vsPrev')}
                spark={profitSpark}
                sparkColor="var(--viz-2)"
                icon={<TrendUpIcon size={16} />}
                tone="success"
                href={drill('reports')}
              />
              <StatTile
                label={t('analytics.tile.bills')}
                value={count(kpi.billCount)}
                delta={deltaPct(kpi.billCount, kpi.billCountPrev)}
                deltaLabel={t('analytics.vsPrev')}
                spark={salesSpark}
                icon={<ReceiptIcon size={16} />}
                href={drill('billing')}
              />
              <StatTile
                label={t('analytics.tile.avgBill')}
                value={rupees(kpi.avgBill)}
                note={t('analytics.itemsPerBill', { items: count(kpi.avgItemsPerBill) })}
                icon={<ReceiptIcon size={16} />}
                tone="brand"
                href={drill('billing')}
              />
              <StatTile
                label={t('analytics.tile.khataOutstanding')}
                value={rupees(kpi.khataOutstanding)}
                note={t('analytics.customersNote', { customers: count(kpi.khataCustomers) })}
                icon={<LedgerIcon size={16} />}
                tone="gold"
                href={drill('khata')}
              />
              <StatTile
                label={t('analytics.tile.udhaarGiven')}
                value={rupees(kpi.udhaarGiven)}
                icon={<LedgerIcon size={16} />}
                tone="danger"
                href={drill('khata')}
              />
              <StatTile
                label={t('analytics.tile.udhaarRecovered')}
                value={rupees(kpi.udhaarRecovered)}
                icon={<WalletIcon size={16} />}
                tone="success"
                href={drill('khata')}
              />
              <StatTile
                label={t('analytics.tile.expenses')}
                value={rupees(kpi.expenses)}
                icon={<WalletIcon size={16} />}
                tone="danger"
                href={drill('expenses')}
              />
              <StatTile
                label={t('analytics.tile.newCustomers')}
                value={count(kpi.newCustomers)}
                note={t('analytics.repeatNote', { customers: count(kpi.repeatCustomers) })}
                icon={<UsersIcon size={16} />}
                tone="brand"
                href={drill('khata')}
              />
              {data.lens?.showStock && (
                <StatTile
                  label={t('analytics.tile.stockValue')}
                  value={rupees(kpi.stockCostValue)}
                  note={
                    inventory?.coverDays === null || inventory?.coverDays === undefined
                      ? undefined
                      : t('analytics.coverDays', { days: count(inventory.coverDays) })
                  }
                  icon={<PackageIcon size={16} />}
                  tone="brand"
                  href={drill('inventory')}
                />
              )}
              <StatTile
                label={t('analytics.tile.itemsSold')}
                value={count(kpi.itemsSold)}
                icon={<ActivityIcon size={16} />}
                href={drill('reports')}
              />
            </div>

            {/* ---- the charts ---- */}
            <div className="viz-grid">
              <ChartCard
                span="wide"
                title={t('analytics.chart.trend')}
                hint={t('analytics.chart.trendHint')}
                href={drill('reports')}
                actions={
                  <>
                    <ChartToggle
                      ariaLabel={t('analytics.chart.trend')}
                      value={metric}
                      onChange={setMetric}
                      options={[
                        { value: 'money', label: t('analytics.metric.money') },
                        { value: 'bills', label: t('analytics.metric.bills') },
                      ]}
                    />
                    {metric === 'money' && canCompare && (
                      <button
                        type="button"
                        className={`viz-tool-btn${compare ? ' is-on' : ''}`}
                        aria-pressed={compare}
                        onClick={() => setCompare((on) => !on)}
                      >
                        <ActivityIcon size={17} />
                        <span>{t('analytics.compare')}</span>
                      </button>
                    )}
                  </>
                }
                table={{
                  columns: [
                    { key: 'x', label: t('analytics.col.period') },
                    { key: 'sales', label: t('analytics.col.sales'), numeric: true },
                    { key: 'prev', label: t('analytics.prevPeriod'), numeric: true },
                    { key: 'profit', label: t('analytics.col.profit'), numeric: true },
                    { key: 'bills', label: t('analytics.col.bills'), numeric: true },
                  ],
                  rows: data.trend.map((row) => ({
                    x: formatBucket(row),
                    sales: rupees(row.sales),
                    prev: row.prev === null ? '—' : rupees(row.prev),
                    profit: rupees(row.profit),
                    bills: count(row.bills),
                  })),
                }}
              >
                <Legend items={trendSeries.map((s) => ({ label: s.label, color: s.color }))} />
                <LineChart
                  data={data.trend}
                  series={trendSeries}
                  formatValue={metric === 'bills' ? (value) => count(Math.round(value)) : money}
                  formatX={formatBucket}
                  emptyLabel={t('analytics.empty.sales')}
                />
              </ChartCard>

              <ChartCard
                title={t('analytics.chart.payments')}
                hint={t('analytics.chart.paymentsHint')}
                href={drill('daybook')}
                table={{
                  columns: [
                    { key: 'mode', label: t('analytics.col.mode') },
                    { key: 'amount', label: t('analytics.col.amount'), numeric: true },
                  ],
                  rows: paymentSegments.map((seg) => ({ mode: seg.label, amount: rupees(seg.value) })),
                }}
              >
                <DonutChart
                  segments={paymentSegments}
                  totalLabel={t('analytics.collected')}
                  formatValue={rupees}
                  emptyLabel={t('analytics.empty.sales')}
                />
              </ChartCard>

              <ChartCard
                title={t('analytics.chart.moneyDistribution')}
                hint={t('analytics.chart.moneyDistributionHint')}
                href={drill('reports')}
                table={{
                  columns: [
                    { key: 'part', label: t('analytics.col.category') },
                    { key: 'amount', label: t('analytics.col.amount'), numeric: true },
                  ],
                  rows: (data.moneyDistribution?.segments || []).map((segment) => ({
                    part: t(`analytics.money.${segment.key}`),
                    amount: rupees(segment.value),
                  })),
                }}
              >
                <DonutChart
                  segments={(data.moneyDistribution?.segments || []).map((segment, index) => ({
                    ...segment,
                    label: t(`analytics.money.${segment.key}`),
                    color: ['var(--viz-1)', 'var(--viz-3)', 'var(--viz-2)'][index] || 'var(--viz-7)',
                  }))}
                  total={data.moneyDistribution?.total || 0}
                  totalLabel={t('analytics.money.totalSales')}
                  formatValue={rupees}
                  emptyLabel={t('analytics.empty.sales')}
                />
                {data.moneyDistribution && (
                  <div className={`viz-chart-note${Math.abs(data.moneyDistribution.total - data.moneyDistribution.tally) > 0.01 ? ' is-warning' : ''}`}>
                    <strong>
                      {Math.abs(data.moneyDistribution.total - data.moneyDistribution.tally) > 0.01
                        ? t('analytics.money.tallyProblem')
                        : t('analytics.money.tallyOk')}
                    </strong>
                    <span>
                      {t('analytics.money.tallyLine', {
                        total: rupees(data.moneyDistribution.total),
                        tally: rupees(data.moneyDistribution.tally),
                      })}
                      {data.moneyDistribution.operatingLoss > 0 && ` · ${t('analytics.money.operatingLoss')}: ${rupees(data.moneyDistribution.operatingLoss)}`}
                      {data.moneyDistribution.otherIncome > 0 && ` · ${t('analytics.money.otherIncome', { amount: rupees(data.moneyDistribution.otherIncome) })}`}
                    </span>
                  </div>
                )}
              </ChartCard>

              {/* Best-seller and best-earner are routinely two different lines, and only one
                  of them pays the rent — so the margin rides along on every row. */}
              <ChartCard
                title={data.lens?.showAppointments ? t('analytics.chart.topServices') : t('analytics.chart.topItems')}
                hint={t('analytics.chart.topItemsHint')}
                href={drill('inventory')}
                table={{
                  columns: [
                    { key: 'name', label: t('analytics.col.item') },
                    { key: 'qty', label: t('analytics.col.qty'), numeric: true },
                    { key: 'revenue', label: t('analytics.col.revenue'), numeric: true },
                    { key: 'profit', label: t('analytics.col.profit'), numeric: true },
                    { key: 'margin', label: t('analytics.col.margin'), numeric: true },
                  ],
                  rows: data.topItems.map((row) => ({
                    name: row.name,
                    qty: count(row.qty),
                    revenue: rupees(row.revenue),
                    profit: rupees(row.profit),
                    margin:
                      marginConfidence(row.marginCoverage) === 'unknown' || row.margin === null
                        ? '—'
                        : `${count(row.margin)}%`,
                  })),
                }}
              >
                <RankedBars
                  rows={data.topItems.map((row) => ({
                    key: row.name,
                    label: row.name,
                    value: row.revenue,
                    // A margin with no cost price behind it is not a weaker number, it
                    // is a different number — so the row falls back to what we do know
                    // (how many moved) rather than printing a percentage we invented.
                    note:
                      row.margin === null || marginConfidence(row.marginCoverage) === 'unknown'
                        ? t('analytics.qtyNote', { qty: count(row.qty) })
                        : t('analytics.qtyMarginNote', { qty: count(row.qty), margin: count(row.margin) }),
                  }))}
                  color="var(--viz-1)"
                  formatValue={rupees}
                  emptyLabel={t('analytics.empty.sales')}
                />
              </ChartCard>

              {/* A bill says a table paid ₹840. It does not say the table was held for
                  ninety minutes to earn it — and that is the number that decides whether a
                  Saturday queue is a staffing problem or a seating one. Only rendered for
                  a shop that actually settled tables in the window. */}
              {data.tables && (
                <ChartCard
                  title={t('analytics.chart.tableUse')}
                  hint={t('analytics.chart.tableUseHint', {
                    turnaround: data.tables.avgTurnaround ?? '—',
                    covers: count(data.tables.covers),
                  })}
                  href="/seller/tables"
                  table={{
                    columns: [
                      { key: 'name', label: t('tables.tableName') },
                      { key: 'turns', label: t('analytics.col.turns'), numeric: true },
                      { key: 'revenue', label: t('analytics.col.revenue'), numeric: true },
                      { key: 'mins', label: t('analytics.col.avgMins'), numeric: true },
                      { key: 'perHour', label: t('analytics.col.perHour'), numeric: true },
                    ],
                    rows: data.tables.topTables.map((row) => ({
                      name: row.name,
                      turns: count(row.turns),
                      revenue: rupees(row.revenue),
                      mins: row.avgTurnaround === null ? '—' : `${count(row.avgTurnaround)}m`,
                      perHour: row.perHour === null ? '—' : rupees(row.perHour),
                    })),
                  }}
                >
                  <RankedBars
                    rows={data.tables.topTables.map((row) => ({
                      key: row.name,
                      label: row.name,
                      value: row.revenue,
                      note: t('analytics.tableNote', {
                        turns: count(row.turns),
                        mins: row.avgTurnaround === null ? '—' : count(row.avgTurnaround),
                      }),
                    }))}
                    color="var(--viz-1)"
                    formatValue={rupees}
                    emptyLabel={t('analytics.empty.sales')}
                  />
                  {/* What cancellations after the kitchen started actually cost — a count
                      of voids says nothing; "₹640 of food binned" is something to act on. */}
                  {data.tables.wasted && (
                    <p className="analytics-waste">
                      {t('analytics.tableWasted', {
                        value: rupees(data.tables.wasted.value),
                        count: count(data.tables.wasted.count),
                        names: data.tables.wasted.top.map((w) => w.name).join(', '),
                      })}
                    </p>
                  )}
                </ChartCard>
              )}

              <ChartCard
                title={t('analytics.chart.topCustomers')}
                hint={t('analytics.chart.topCustomersHint')}
                href={drill('khata')}
                table={{
                  columns: [
                    { key: 'name', label: t('analytics.col.customer') },
                    { key: 'bills', label: t('analytics.col.bills'), numeric: true },
                    { key: 'spent', label: t('analytics.col.spent'), numeric: true },
                    { key: 'balance', label: t('analytics.col.balance'), numeric: true },
                  ],
                  rows: data.topCustomers.map((row) => ({
                    name: row.name,
                    bills: count(row.bills),
                    spent: rupees(row.spent),
                    balance: rupees(row.balance),
                  })),
                }}
              >
                <RankedBars
                  rows={data.topCustomers.map((row) => ({
                    key: row.id,
                    label: row.name,
                    value: row.spent,
                    note: t('analytics.billsNote', { bills: count(row.bills) }),
                    href: drill('khata') ? recordHref('/seller/khata/[id]', row.id) : undefined,
                  }))}
                  color="var(--viz-1)"
                  formatValue={rupees}
                  emptyLabel={t('analytics.empty.customers')}
                />
              </ChartCard>

              {/* New vs repeat. A shop living on first-time walk-ins and a shop living on
                  regulars are two different businesses with the same sales figure — and
                  only one of them survives a new competitor opening down the lane. */}
              <ChartCard
                title={t('analytics.chart.customerMix')}
                hint={t('analytics.chart.customerMixHint')}
                href={drill('khata')}
                table={{
                  columns: [
                    { key: 'kind', label: t('analytics.col.customer') },
                    { key: 'customers', label: t('analytics.col.customers'), numeric: true },
                    { key: 'sales', label: t('analytics.col.sales'), numeric: true },
                  ],
                  rows: [
                    { kind: t('analytics.mix.repeat'), customers: count(data.customerMix.repeatCustomers), sales: rupees(data.customerMix.repeatSales) },
                    { kind: t('analytics.mix.new'), customers: count(data.customerMix.newCustomers), sales: rupees(data.customerMix.newSales) },
                    { kind: t('analytics.mix.walkIn'), customers: '—', sales: rupees(data.customerMix.walkInSales) },
                  ],
                }}
              >
                <SplitBar
                  segments={[
                    { key: 'repeat', label: t('analytics.mix.repeat'), value: data.customerMix.repeatSales, color: 'var(--viz-1)' },
                    { key: 'new', label: t('analytics.mix.new'), value: data.customerMix.newSales, color: 'var(--viz-3)' },
                    { key: 'walkIn', label: t('analytics.mix.walkIn'), value: Math.max(0, data.customerMix.walkInSales), color: 'var(--viz-7)' },
                  ]}
                  formatValue={rupees}
                  emptyLabel={t('analytics.empty.sales')}
                />
                <p className="viz-note">
                  {t('analytics.mixNote', {
                    newCount: count(data.customerMix.newCustomers),
                    repeatCount: count(data.customerMix.repeatCustomers),
                  })}
                </p>
              </ChartCard>

              {/* The loss nothing else in the app reports: a customer who stops coming makes
                  no entry anywhere, so it stays invisible until the month is down. */}
              <ChartCard
                title={t('analytics.chart.atRisk')}
                hint={t('analytics.chart.atRiskHint')}
                href={drill('khata')}
                table={{
                  columns: [
                    { key: 'name', label: t('analytics.col.customer') },
                    { key: 'quiet', label: t('analytics.col.quietDays'), numeric: true },
                    { key: 'spent', label: t('analytics.col.spent'), numeric: true },
                  ],
                  rows: (data.atRiskCustomers || []).map((row) => ({
                    name: row.name,
                    quiet: count(row.quietDays),
                    spent: rupees(row.spent),
                  })),
                }}
              >
                <RankedBars
                  rows={(data.atRiskCustomers || []).map((row) => ({
                    key: row.id,
                    label: row.name,
                    value: row.spent,
                    note: t('analytics.quietNote', { days: count(row.quietDays) }),
                    href: drill('khata') ? recordHref('/seller/khata/[id]', row.id) : undefined,
                  }))}
                  color="var(--viz-8)"
                  formatValue={rupees}
                  emptyLabel={t('analytics.empty.atRisk')}
                />
              </ChartCard>

              {/* The shelf read as money rather than as a list of products. */}
              {inventory && (
                <ChartCard
                  title={t('analytics.chart.stockHealth')}
                  hint={t('analytics.chart.stockHealthHint')}
                  href={drill('inventory')}
                  table={{
                    columns: [
                      { key: 'state', label: t('analytics.col.state') },
                      { key: 'items', label: t('analytics.col.items'), numeric: true },
                    ],
                    rows: [
                      { state: t('analytics.stock.out'), items: count(inventory.outOfStock) },
                      { state: t('analytics.stock.low'), items: count(inventory.lowStock) },
                      { state: t('analytics.stock.dead'), items: count(inventory.deadStockCount) },
                      { state: t('analytics.stock.healthy'), items: count(inventory.healthy) },
                    ],
                  }}
                >
                  <SplitBar
                    segments={[
                      { key: 'healthy', label: t('analytics.stock.healthy'), value: inventory.healthy, color: 'var(--viz-3)' },
                      { key: 'low', label: t('analytics.stock.low'), value: inventory.lowStock, color: 'var(--viz-4)' },
                      { key: 'out', label: t('analytics.stock.out'), value: inventory.outOfStock, color: 'var(--viz-8)' },
                    ]}
                    formatValue={(value) => count(value)}
                    emptyLabel={t('analytics.empty.stock')}
                  />
                  <ul className="viz-facts">
                    <li>
                      <span>{t('analytics.stock.blocked')}</span>
                      <strong>{rupees(inventory.deadStockValue)}</strong>
                      <em>{t('analytics.stock.blockedNote', { count: count(inventory.deadStockCount) })}</em>
                    </li>
                    <li>
                      <span>{t('analytics.stock.retail')}</span>
                      <strong>{rupees(inventory.stockRetailValue)}</strong>
                      <em>{t('analytics.stock.retailNote', { amount: rupees(inventory.stockCostValue) })}</em>
                    </li>
                    {inventory.noCostPrice > 0 && (
                      <li className="is-warn">
                        <span>{t('analytics.stock.noCost')}</span>
                        <strong>{count(inventory.noCostPrice)}</strong>
                        <em>{t('analytics.stock.noCostNote')}</em>
                      </li>
                    )}
                  </ul>
                </ChartCard>
              )}

              {/* Money that was spent once and has not moved since. Ranked by rupees, not
                  by quantity — 200 unsold matchboxes are not the problem, one unsold mixer
                  grinder is. */}
              {inventory && inventory.deadItems.length > 0 && (
                <ChartCard
                  title={t('analytics.chart.deadStock')}
                  hint={t('analytics.chart.deadStockHint', { days: count(data.range.days) })}
                  href={drill('inventory')}
                  table={{
                    columns: [
                      { key: 'name', label: t('analytics.col.item') },
                      { key: 'stock', label: t('analytics.col.qty'), numeric: true },
                      { key: 'value', label: t('analytics.col.value'), numeric: true },
                    ],
                    rows: inventory.deadItems.map((row) => ({
                      name: row.name,
                      stock: count(row.stock),
                      value: rupees(row.value),
                    })),
                  }}
                >
                  <RankedBars
                    rows={inventory.deadItems.map((row) => ({
                      key: row.id,
                      label: row.name,
                      value: row.value,
                      note: t('analytics.stockNote', { stock: count(row.stock) }),
                    }))}
                    color="var(--viz-4)"
                    formatValue={rupees}
                    emptyLabel={t('analytics.empty.stock')}
                  />
                </ChartCard>
              )}

              {/* ---- advanced tier ---- */}
              {advanced ? (
                <>
                  <ChartCard
                    title={t('analytics.chart.category')}
                    hint={t('analytics.chart.categoryHint')}
                    href={drill('reports')}
                    badge={t('analytics.proBadge')}
                    table={{
                      columns: [
                        { key: 'category', label: t('analytics.col.category') },
                        { key: 'revenue', label: t('analytics.col.revenue'), numeric: true },
                        { key: 'profit', label: t('analytics.col.profit'), numeric: true },
                        { key: 'margin', label: t('analytics.col.margin'), numeric: true },
                      ],
                      rows: (data.categoryProfit || []).map((row) => ({
                        category: row.category,
                        revenue: rupees(row.revenue),
                        profit: rupees(row.profit),
                        margin:
                          marginConfidence(row.marginCoverage) === 'unknown' || row.margin === null
                            ? '—'
                            : `${count(row.margin)}%`,
                      })),
                    }}
                  >
                    <RankedBars
                      rows={(data.categoryProfit || []).map((row) => ({
                        key: row.category,
                        label: row.category,
                        value: row.profit,
                        // "Services · 95.24% margin" was the loudest instance of the
                        // no-cost-price lie, because a kitchen's whole menu lands in one
                        // category and every dish in it carried the same invented figure.
                        note:
                          row.margin === null || marginConfidence(row.marginCoverage) === 'unknown'
                            ? t('analytics.marginNoCostShort')
                            : t('analytics.marginNote', { margin: count(row.margin) }),
                      }))}
                      color="var(--viz-1)"
                      formatValue={rupees}
                      emptyLabel={t('analytics.empty.sales')}
                    />
                  </ChartCard>

                  {/* Day AND hour together. "Saturday" and "evening" are each a guess; the
                      grid is the only place a shop can see that its Saturday evening is
                      worth three of its Tuesday mornings. */}
                  <ChartCard
                    span="wide"
                    title={t('analytics.chart.heatmap')}
                    hint={t('analytics.chart.heatmapHint')}
                    href={drill('staff')}
                    badge={t('analytics.proBadge')}
                    table={{
                      columns: [
                        { key: 'day', label: t('analytics.col.weekday') },
                        { key: 'hour', label: t('analytics.col.hour') },
                        { key: 'sales', label: t('analytics.col.sales'), numeric: true },
                      ],
                      rows: (data.hourHeatmap || []).flatMap((row, weekday) =>
                        row
                          .map((value, hour) => ({ value, hour }))
                          .filter((cell) => cell.value > 0)
                          .map((cell) => ({
                            day: t(`analytics.weekdayShort.${weekday}`),
                            hour: hourLabel(cell.hour),
                            sales: rupees(cell.value),
                          }))
                      ),
                    }}
                  >
                    <HeatMap
                      rows={Array.from({ length: 7 }, (unused, weekday) => ({
                        key: weekday,
                        label: t(`analytics.weekdayShort.${weekday}`),
                      }))}
                      cols={Array.from({ length: 24 }, (unused, hour) => ({
                        key: hour,
                        label: hourLabel(hour),
                        axis: String(hour).padStart(2, '0'),
                      }))}
                      values={data.hourHeatmap || []}
                      formatValue={rupees}
                      emptyLabel={t('analytics.empty.sales')}
                    />
                  </ChartCard>

                  <ChartCard
                    title={t('analytics.chart.peak')}
                    hint={t('analytics.chart.peakHint')}
                    href={drill('billing')}
                    badge={t('analytics.proBadge')}
                    table={{
                      columns: [
                        { key: 'hour', label: t('analytics.col.hour') },
                        { key: 'bills', label: t('analytics.col.bills'), numeric: true },
                        { key: 'sales', label: t('analytics.col.sales'), numeric: true },
                      ],
                      rows: (data.peakHours || [])
                        .filter((row) => row.bills > 0)
                        .map((row) => ({ hour: hourLabel(row.hour), bills: count(row.bills), sales: rupees(row.sales) })),
                    }}
                  >
                    <ColumnChart
                      data={(data.peakHours || []).map((row) => ({
                        key: row.hour,
                        y: row.bills,
                        label: hourLabel(row.hour),
                        sub: rupees(row.sales),
                      }))}
                      color="var(--viz-1)"
                      formatValue={(value) => count(Math.round(value))}
                      formatX={(row) => row.label}
                      emptyLabel={t('analytics.empty.sales')}
                    />
                  </ChartCard>

                  <ChartCard
                    title={t('analytics.chart.weekday')}
                    hint={t('analytics.chart.weekdayHint')}
                    href={drill('reports')}
                    badge={t('analytics.proBadge')}
                    table={{
                      columns: [
                        { key: 'day', label: t('analytics.col.weekday') },
                        { key: 'sales', label: t('analytics.col.sales'), numeric: true },
                        { key: 'bills', label: t('analytics.col.bills'), numeric: true },
                      ],
                      rows: (data.weekday || []).map((row) => ({
                        day: t(`analytics.weekday.${row.weekday}`),
                        sales: rupees(row.sales),
                        bills: count(row.bills),
                      })),
                    }}
                  >
                    <ColumnChart
                      data={(data.weekday || []).map((row) => ({
                        key: row.weekday,
                        y: row.sales,
                        label: t(`analytics.weekdayShort.${row.weekday}`),
                        sub: t('analytics.billsNote', { bills: count(row.bills) }),
                      }))}
                      color="var(--viz-1)"
                      formatValue={money}
                      formatX={(row) => row.label}
                      emptyLabel={t('analytics.empty.sales')}
                    />
                  </ChartCard>

                  <ChartCard
                    title={t('analytics.chart.aging')}
                    hint={t('analytics.chart.agingHint')}
                    href={drill('khata')}
                    badge={t('analytics.proBadge')}
                    table={{
                      columns: [
                        { key: 'bucket', label: t('analytics.col.age') },
                        { key: 'amount', label: t('analytics.col.amount'), numeric: true },
                        { key: 'customers', label: t('analytics.col.customers'), numeric: true },
                      ],
                      rows: (data.khataAging || []).map((row) => ({
                        bucket: t(`analytics.aging.${row.bucket}`),
                        amount: rupees(row.amount),
                        customers: count(row.customers),
                      })),
                    }}
                  >
                    <RankedBars
                      rows={(data.khataAging || []).map((row, index) => ({
                        key: row.bucket,
                        label: t(`analytics.aging.${row.bucket}`),
                        value: row.amount,
                        color: AGING_COLORS[index],
                        note: t('analytics.customersNote', { customers: count(row.customers) }),
                      }))}
                      formatValue={rupees}
                      emptyLabel={t('analytics.empty.khata')}
                    />
                  </ChartCard>

                  <ChartCard
                    title={t('analytics.chart.expenses')}
                    hint={t('analytics.chart.expensesHint')}
                    href={drill('expenses')}
                    badge={t('analytics.proBadge')}
                    table={{
                      columns: [
                        { key: 'category', label: t('analytics.col.category') },
                        { key: 'amount', label: t('analytics.col.amount'), numeric: true },
                      ],
                      rows: (data.expenseSplit || []).map((row) => ({
                        category: expenseCategoryLabel(row.category),
                        amount: rupees(row.amount),
                      })),
                    }}
                  >
                    <RankedBars
                      rows={(data.expenseSplit || []).map((row) => ({
                        key: row.category,
                        label: expenseCategoryLabel(row.category),
                        value: row.amount,
                      }))}
                      color="var(--viz-8)"
                      formatValue={rupees}
                      emptyLabel={t('analytics.empty.expenses')}
                    />
                  </ChartCard>

                  <ChartCard
                    title={t('analytics.chart.staff')}
                    hint={t('analytics.chart.staffHint')}
                    href={drill('staff')}
                    badge={t('analytics.proBadge')}
                    table={{
                      columns: [
                        { key: 'name', label: t('analytics.col.staff') },
                        { key: 'bills', label: t('analytics.col.bills'), numeric: true },
                        { key: 'sales', label: t('analytics.col.sales'), numeric: true },
                      ],
                      rows: (data.staff || []).map((row) => ({
                        name: row.name,
                        bills: count(row.bills),
                        sales: rupees(row.sales),
                      })),
                    }}
                  >
                    <RankedBars
                      rows={(data.staff || []).map((row) => ({
                        key: row.name,
                        label: row.name,
                        value: row.sales,
                        note: t('analytics.billsNote', { bills: count(row.bills) }),
                      }))}
                      color="var(--viz-1)"
                      formatValue={rupees}
                      emptyLabel={t('analytics.empty.staff')}
                    />
                  </ChartCard>
                </>
              ) : (
                <LockedPanel plan={data.plan} blocks={data.locked} />
              )}
            </div>
          </div>
        )
      )}
    </>
  );
}

/**
 * The sentences, above every chart on the page.
 *
 * This is the part that makes the screen worth opening. A donut showing a 6% margin is a
 * fact; "har ₹100 ki bikri pe sirf ₹6 bach rahe hain — 11 products ka cost price bhara hi
 * nahi hai" is a job, with the door to do it right there. Built on the server (see
 * backend/utils/analyticsInsights.js) so the rules live in one place; this only lays them
 * out and formats the numbers into the shop's own language.
 */
/**
 * "What this means" — and, when the shopkeeper asks for it, why it happened and what to
 * do about it.
 *
 * The strip used to be eighteen one-line verdicts that were each a LINK: tapping "your
 * margin is thin" jumped to the products screen, which is a fine destination and a
 * terrible answer. It left the two questions a number actually raises — *aisa kyun hua*
 * and *ab main karun kya* — to be answered somewhere else, or nowhere.
 *
 * So the row opens instead of navigating. The reason and the step appear UNDER the
 * sentence they belong to, which is the whole point: an explanation on another screen is
 * not an explanation, it is a second errand. The screen link is still there — it moved
 * into the opened panel, where it is the last step rather than the only one.
 *
 * Only one row is open at a time. Six open explanations is a document, and nobody reads a
 * document off a dashboard.
 */
function InsightStrip({ items, render, drill }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(null);
  if (!items?.length) return null;

  return (
    <section className="viz-insights">
      <div className="viz-insights-head">
        <span className="stat-card-icon icon-brand"><ZapIcon size={15} /></span>
        <h2>{t('analytics.insights.title')}</h2>
      </div>
      <div className="viz-insights-list">
        {items.map((item, index) => {
          const Icon = INSIGHT_ICONS[item.tone] || InfoIcon;
          // An insight whose module this shop can't reach still deserves to be said — it
          // just doesn't become a link onto a 403.
          const reachable = item.href ? drillableHref(item.href, drill) : null;
          const isOpen = open === item.key;
          // `translate` falls back to the key path when a string is missing, so a rule
          // that has no written reason yet renders no panel rather than a dotted path.
          const why = t(`analytics.insightWhy.${item.key}`, item.params);
          const doIt = t(`analytics.insightDo.${item.key}`, item.params);
          const hasWhy = why !== `analytics.insightWhy.${item.key}`;
          const hasDo = doIt !== `analytics.insightDo.${item.key}`;

          return (
            <div
              key={item.key}
              className={`viz-insight-wrap viz-tone-${item.tone}${isOpen ? ' is-open' : ''}`}
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <button
                type="button"
                className={`viz-insight viz-insight-${item.tone}`}
                onClick={() => setOpen(isOpen ? null : item.key)}
                aria-expanded={isOpen}
              >
                <span className="viz-insight-icon"><Icon size={16} /></span>
                <span className="viz-insight-text">{render(item)}</span>
                <span className="viz-insight-arrow"><ChevronDownIcon size={15} /></span>
              </button>

              {isOpen && (hasWhy || hasDo || reachable) && (
                <div className="viz-insight-more">
                  {hasWhy && (
                    <p className="viz-insight-why">
                      <b>{t('analytics.insights.why')}</b> {why}
                    </p>
                  )}
                  {hasDo && (
                    <p className="viz-insight-do">
                      <b>{t('analytics.insights.do')}</b> {doIt}
                    </p>
                  )}
                  {reachable && (
                    <Link href={reachable} className="btn btn-secondary btn-small btn-inline">
                      {t('analytics.insights.openScreen')} <ChevronRightIcon size={15} />
                    </Link>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// The insight's href arrives as a path; `drill` speaks in nav keys. This maps back so a
// hidden module drops the link rather than the whole sentence — matching sub-paths too,
// since an insight can point at /seller/khata/reminders, which is behind the same door as
// /seller/khata itself.
function drillableHref(href, drill) {
  const key = Object.keys(DRILL).find((navKey) => href === DRILL[navKey] || href.startsWith(`${DRILL[navKey]}/`));
  if (!key) return href;
  return drill(key) ? href : null;
}

/**
 * "Is mahine ka target" — the only block on this page that is deliberately NOT scoped by
 * the date filter.
 *
 * A goal that changed every time someone tapped "last 7 days" would not be a goal, so this
 * always reads the calendar month the shop is actually living in and says so on its face.
 * The number that makes it useful is not the percentage — it is `requiredPerDay`: "ab roz
 * ₹9,400 karna padega, 11 din bache hain" is something a shopkeeper can act on this
 * afternoon.
 */
function TargetBlock({ target, onSaved }) {
  const { t, lang } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!target) return null;
  const rupees = (amount) => formatRupees(amount, lang, { decimals: false });

  function startEdit() {
    setValue(target.monthly ? String(target.monthly) : '');
    setError('');
    setEditing(true);
  }

  function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    apiFetch('/api/seller/analytics/target', {
      method: 'PUT',
      body: JSON.stringify({ monthlyTarget: Number(value) || 0 }),
    })
      .then((res) => {
        onSaved(res.target);
        setEditing(false);
      })
      .catch((err) => setError(err.message))
      .finally(() => setSaving(false));
  }

  if (editing) {
    return (
      <form className="viz-target is-editing" onSubmit={save}>
        <label htmlFor="viz-target-input">{t('analytics.target.label')}</label>
        <input
          id="viz-target-input"
          type="number"
          min="0"
          step="100"
          inputMode="numeric"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('analytics.target.placeholder')}
          autoFocus
        />
        {error && <span className="viz-target-error">{error}</span>}
        <div className="viz-target-actions">
          <button type="submit" className="btn btn-primary btn-small" disabled={saving}>
            <CheckIcon size={15} />
            {t('common.save')}
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing(false)}>
            <XIcon size={15} />
            {t('common.cancel')}
          </button>
        </div>
      </form>
    );
  }

  if (!target.monthly) {
    return (
      <div className="viz-target is-empty">
        <span className="stat-card-icon icon-gold"><TargetIcon size={16} /></span>
        <strong>{t('analytics.target.emptyTitle')}</strong>
        <p>{t('analytics.target.emptyBody')}</p>
        <button type="button" className="btn btn-primary btn-small" onClick={startEdit}>
          {t('analytics.target.set')}
        </button>
      </div>
    );
  }

  const ahead = target.projected >= target.monthly;

  return (
    <div className="viz-target">
      <ProgressRing
        value={target.monthToDate}
        max={target.monthly}
        label={t('analytics.target.ofTarget', { target: rupees(target.monthly) })}
        sub={`${formatNumber(Math.round(target.progress || 0), lang)}%`}
        formatValue={rupees}
        tone={ahead ? 'good' : 'warn'}
      />
      <div className="viz-target-meta">
        <span className={ahead ? 'is-good' : 'is-warn'}>
          {ahead
            ? t('analytics.target.onTrack', { amount: rupees(target.projected) })
            : t('analytics.target.behind', { amount: rupees(target.projected) })}
        </span>
        {target.daysLeft > 0 && target.requiredPerDay > 0 && (
          <em>{t('analytics.target.perDay', { amount: rupees(target.requiredPerDay), days: formatNumber(target.daysLeft, lang) })}</em>
        )}
        <button type="button" className="viz-target-edit" onClick={startEdit}>
          <EditIcon size={12} />
          {t('analytics.target.change')}
        </button>
      </div>
    </div>
  );
}

/**
 * What the lower plans see where the deeper cuts would be.
 *
 * Shown, not hidden: a shopkeeper who cannot see that "which category actually makes me
 * money" exists has no reason to upgrade, and a silently shorter page reads as a bug. The
 * blocks are named individually so the pitch is concrete rather than "unlock more".
 */
function LockedPanel({ plan, blocks }) {
  const { t } = useLanguage();
  const ICONS = {
    categoryProfit: <TrendUpIcon size={16} />,
    peakHours: <ClockIcon size={16} />,
    weekday: <ActivityIcon size={16} />,
    hourHeatmap: <ActivityIcon size={16} />,
    staff: <UsersIcon size={16} />,
    khataAging: <AlertIcon size={16} />,
    expenseSplit: <WalletIcon size={16} />,
  };

  return (
    <section className="viz-card viz-card-wide viz-locked">
      <div className="viz-locked-head">
        <span className="stat-card-icon icon-gold"><SparkleIcon size={18} /></span>
        <div>
          <h3>{t('analytics.locked.title')}</h3>
          <p>{t('analytics.locked.body', { plan: t(`analytics.planName.${plan}`) || plan })}</p>
        </div>
      </div>
      <ul className="viz-locked-list">
        {(blocks || []).map((block) => (
          <li key={block}>
            <span className="viz-locked-icon">{ICONS[block] || <ZapIcon size={16} />}</span>
            <div>
              <strong>{t(`analytics.locked.${block}`)}</strong>
              <span>{t(`analytics.lockedWhy.${block}`)}</span>
            </div>
          </li>
        ))}
      </ul>
      <Link href="/seller/plan" className="btn btn-primary btn-small viz-locked-cta">
        {t('analytics.locked.cta')}
        <ChevronRightIcon size={15} />
      </Link>
    </section>
  );
}
