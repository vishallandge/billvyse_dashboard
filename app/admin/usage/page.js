'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch, downloadFile } from '../../../lib/api';
import { formatRupees, formatCompactRupees, formatMoney, formatRelativeTime } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { SkeletonStats, SkeletonTable } from '../../components/Skeleton';
import Dropdown from '../../components/Dropdown';
import Modal from '../../components/Modal';
import {
  ChartCard,
  ColumnChart,
  DonutChart,
  StackedColumnChart,
  StatTile,
  SplitBar,
  RankedBars,
} from '../../components/Charts';
import {
  ZapIcon,
  AlertIcon,
  SlidersIcon,
  TrendUpIcon,
  RupeeIcon,
  ShopIcon,
  ExcelIcon,
  RefreshIcon,
  SearchIcon,
  InfoIcon,
  ClockIcon,
  TagIcon,
  BarChartIcon,
  LayersIcon,
  GridIcon,
} from '../../components/Icons';
import { recordHref } from '../../../lib/routeId';

/**
 * The platform's cost side: what it pays to serve the shops on it, and what those shops do
 * with the modules it built for them.
 *
 * This screen used to count units. Units are not a number anyone can act on — "41,000 SMS"
 * only becomes a decision once it says "₹10,250, landing at ₹14,900 by the 31st, against
 * ₹2.4L collected". So everything here is priced, at rates the operator owns (the ₹ button
 * in the period bar) rather than rates buried in a deploy.
 *
 * Four tabs, one question each:
 *   Overview — what the month costs, where it lands, and what share of income it eats.
 *   Shops    — who spends it, and whether each one pays for itself.
 *   Quotas   — whether a tier is priced for what its own limits ALLOW a shop to spend.
 *              This is the tab the module existed to justify and never had: a plan's
 *              price and a plan's worst-case exposure have never been on screen together.
 *   Adoption — which modules shops open, counted against the shops that can reach them.
 */

const TABS = ['overview', 'shops', 'quotas', 'adoption'];
const TAB_ICONS = { overview: BarChartIcon, shops: ShopIcon, quotas: SlidersIcon, adoption: GridIcon };
const METER_TONE = { aiScans: 'brand', sms: 'gold', whatsapp: 'success' };
const METER_COLOR = { aiScans: 'var(--viz-1)', sms: 'var(--viz-2)', whatsapp: 'var(--viz-3)' };
const METER_KEYS = ['aiScans', 'sms', 'whatsapp'];
const INSIGHT_ICONS = { urgent: AlertIcon, warn: ClockIcon, good: TrendUpIcon, info: InfoIcon };
const STATUS_TONE = { dead: 'danger', niche: 'warn', fading: 'warn', healthy: 'good', off: 'muted' };
const SHOP_VIEWS = ['all', 'walls', 'drains'];

function monthLabel(period, long = false) {
  const [year, month] = period.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', long ? { month: 'long', year: 'numeric' } : { month: 'short', year: '2-digit' });
}

function deltaPct(current, previous) {
  if (!previous || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/* ================================================================== page */

export default function AdminUsagePage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const [period, setPeriod] = useState('');
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [adoption, setAdoption] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Money formatters take paise, because the whole payload is paise — one conversion, in
  // one place, instead of a division scattered across forty call sites to get wrong once.
  const f = useMemo(
    () => ({
      rupees: (p) => formatRupees(Math.round((p || 0) / 100), lang, { decimals: false }),
      exact: (p) => formatRupees((p || 0) / 100, lang),
      money: (p) => formatCompactRupees((p || 0) / 100, lang),
      num: (n) => formatMoney(n || 0, lang, { decimals: false }),
    }),
    [lang]
  );

  const load = useCallback(() => {
    setLoading(true);
    const query = period ? `?period=${encodeURIComponent(period)}` : '';
    apiFetch(`/api/admin/usage${query}`)
      .then((res) => {
        setData(res);
        if (!period) setPeriod(res.period);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [period]);

  useEffect(load, [load, nonce]);

  useEffect(() => {
    apiFetch('/api/admin/module-adoption').then(setAdoption).catch(() => {});
  }, []);

  async function exportXlsx() {
    setExporting(true);
    try {
      await downloadFile(`/api/admin/usage?period=${encodeURIComponent(data.period)}&format=xlsx`, `usage-${data.period}.xlsx`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(false);
    }
  }

  if (error && !data) return <div className="error-banner">{error}</div>;

  return (
    <>
      <div className="content-header">
        <h1>{t('admin.usageTitle2')}</h1>
        <p>{t('admin.usageSubtitle2')}</p>
      </div>

      {data && (
        <section className="rev-period usg-period">
          <div className="rev-period-row">
            <Dropdown
              className="filter-select"
              value={data.period}
              onChange={setPeriod}
              options={[...data.periods].reverse().map((p) => ({ value: p, label: monthLabel(p) }))}
            />
            {/* The rates are the multiplier behind every figure on the screen, so they are
                stated on the screen — not hidden behind a settings page the operator would
                have to trust from memory. */}
            <button type="button" className="usg-rate-chip" onClick={() => setRatesOpen(true)}>
              <RupeeIcon size={14} />
              <span>
                {METER_KEYS.map((key) => `${f.exact(data.rates[key])}`).join(' · ')}
              </span>
              <em>{t('admin.usg.editRates')}</em>
            </button>
            <div className="rev-period-tools">
              <button
                type="button"
                className="icon-btn"
                onClick={() => setNonce((n) => n + 1)}
                disabled={loading}
                aria-label={t('common.refresh')}
                data-tip={t('common.refresh')}
              >
                <RefreshIcon size={17} />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={exportXlsx}
                disabled={exporting}
                aria-label={t('admin.usg.exportXlsx')}
                data-tip={t('admin.usg.exportXlsx')}
              >
                <ExcelIcon size={17} />
              </button>
            </div>
          </div>
          <p className="rev-period-label">
            <strong>{monthLabel(data.period, true)}</strong>
            <span>
              {data.live
                ? t('admin.usg.periodLive', { done: f.num(data.elapsedDays), days: f.num(data.days) })
                : t('admin.usg.periodClosed')}
            </span>
          </p>
        </section>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="segmented rev-tabs" role="tablist">
        {TABS.map((key) => {
          const Icon = TAB_ICONS[key];
          const alert =
            (key === 'shops' && data?.walls?.length) ||
            (key === 'adoption' && adoption?.summary?.dead) ||
            0;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'active' : ''}
              onClick={() => setTab(key)}
            >
              <Icon size={15} />
              <span>{t(`admin.usg.tab.${key}`)}</span>
              {alert > 0 && <span className="rev-tab-alert">{f.num(alert)}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'adoption' ? (
        <AdoptionTab adoption={adoption} f={f} lang={lang} />
      ) : !data ? (
        <SkeletonStats count={4} />
      ) : (
        <div className={`viz-board${loading ? ' is-refreshing' : ''}`}>
          {tab === 'overview' && <OverviewTab data={data} adoption={adoption} f={f} />}
          {tab === 'shops' && <ShopsTab data={data} f={f} lang={lang} />}
          {tab === 'quotas' && <QuotasTab data={data} f={f} />}
        </div>
      )}

      {ratesOpen && (
        <RatesModal
          rates={data.rates}
          f={f}
          onClose={() => setRatesOpen(false)}
          onSaved={() => {
            setRatesOpen(false);
            setNonce((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

/* ================================================================== overview */

function OverviewTab({ data, adoption, f }) {
  return (
    <>
      <Insights data={data} adoption={adoption} f={f} />
      <Hero data={data} f={f} />
      <MeterTiles data={data} f={f} />
      <SpendCharts data={data} f={f} />
      {data.walls.length > 0 && <WallsPanel data={data} f={f} preview />}
    </>
  );
}

/**
 * The sentences an operator would say out loud after a minute with the board.
 *
 * Every one is a comparison of two numbers already drawn somewhere on the screen, so the
 * strip can never disagree with the tiles underneath it — the failure mode of a summary
 * band is that it becomes its own source of truth and quietly goes stale.
 */
function Insights({ data, adoption, f }) {
  const { t } = useLanguage();
  const { spend, margin, plans, walls, drains } = data;
  const items = [];

  const worstPlan = [...plans]
    .filter((plan) => plan.exposureRatio !== null && plan.shops > 0)
    .sort((a, b) => b.exposureRatio - a.exposureRatio)[0];
  if (worstPlan && worstPlan.exposureRatio >= 1.5) {
    items.push({
      key: 'exposure',
      tone: 'urgent',
      text: t('admin.usg.ins.exposure', {
        plan: worstPlan.name,
        price: f.rupees(worstPlan.pricePaise),
        ceiling: f.rupees(worstPlan.exposurePaise),
        times: worstPlan.exposureRatio,
      }),
    });
  }
  if (margin.burnPercent !== null && margin.burnPercent >= 20) {
    items.push({
      key: 'burn',
      tone: margin.burnPercent >= 40 ? 'urgent' : 'warn',
      text: t('admin.usg.ins.burn', { pct: f.num(margin.burnPercent), collected: f.rupees(margin.collectedPaise) }),
    });
  }
  if (drains.length > 0) {
    const net = drains.reduce((sum, shop) => sum + shop.marginPaise, 0);
    items.push({ key: 'drains', tone: 'warn', text: t('admin.usg.ins.drains', { n: f.num(drains.length), amount: f.rupees(Math.abs(net)) }) });
  }
  if (spend.blocked > 0) {
    items.push({ key: 'walls', tone: 'warn', text: t('admin.usg.ins.walls', { n: f.num(spend.blockedShops), units: f.num(spend.blocked) }) });
  }
  if (data.live && spend.projectedPaise !== null && spend.previousCostPaise > 0) {
    const delta = deltaPct(spend.projectedPaise, spend.previousCostPaise);
    if (delta !== null && Math.abs(delta) >= 10) {
      items.push({
        key: 'pace',
        tone: delta > 0 ? 'warn' : 'good',
        text: t(delta > 0 ? 'admin.usg.ins.paceUp' : 'admin.usg.ins.paceDown', {
          amount: f.rupees(spend.projectedPaise),
          pct: f.num(Math.abs(delta)),
        }),
      });
    }
  }
  if (adoption?.summary.dead > 0) {
    items.push({ key: 'dead', tone: 'info', text: t('admin.usg.ins.dead', { n: f.num(adoption.summary.dead) }) });
  }

  if (items.length === 0) return null;

  return (
    <section className="viz-insights">
      <div className="viz-insights-head">
        <span className="stat-card-icon icon-brand"><ZapIcon size={15} /></span>
        <h2>{t('admin.usg.ins.title')}</h2>
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
  const { spend, margin } = data;
  const delta = deltaPct(spend.costPaise, spend.previousCostPaise);

  return (
    <section className="viz-hero">
      <div className="viz-hero-main">
        <span className="viz-hero-label">
          <span className="stat-card-icon icon-danger"><RupeeIcon size={16} /></span>
          {t('admin.usg.heroLabel', { period: monthLabel(data.period, true) })}
        </span>
        <strong className="viz-hero-value">{f.rupees(spend.costPaise)}</strong>
        <div className="viz-hero-meta">
          {delta !== null && (
            // A rise in what the platform spends is not a rise to celebrate, so the arrow
            // and the colour part ways here: up is red.
            <span className={`viz-delta${delta > 0 ? ' is-bad' : ' is-good'}`}>
              {delta >= 0 ? '▲' : '▼'} {f.num(Math.abs(delta))}%
              <em>{t('admin.usg.vsPrevious')}</em>
            </span>
          )}
          <span>{t('admin.usg.heroSub', { units: f.num(spend.units), shops: f.num(spend.shops) })}</span>
        </div>
        {data.live && (
          <div className="rev-month-track" aria-hidden="true">
            <span style={{ width: `${Math.round((data.elapsedDays / data.days) * 100)}%` }} />
          </div>
        )}
        <div className="viz-hero-run">
          {spend.projectedPaise !== null && (
            <>
              {t('admin.usg.projectedEnd', { amount: f.rupees(spend.projectedPaise) })}
              {' · '}
            </>
          )}
          {t('admin.usg.previousTotal', { amount: f.rupees(spend.previousCostPaise) })}
          {' · '}
          {t('admin.usg.perDay', { amount: f.exact(spend.perDayPaise) })}
        </div>
      </div>

      <div className="viz-hero-side">
        <div className="viz-hero-figure">
          <span>{t('admin.usg.collected')}</span>
          <strong>{f.rupees(margin.collectedPaise)}</strong>
          <em>
            {margin.burnPercent === null
              ? t('admin.usg.noCollected')
              : t('admin.usg.burnNote', { pct: f.num(margin.burnPercent) })}
          </em>
        </div>
        <div className="viz-hero-figure">
          <span>{t('admin.usg.netAfterCost')}</span>
          <strong className={margin.netPaise < 0 ? 'usg-neg' : undefined}>{f.rupees(margin.netPaise)}</strong>
          <em>{t('admin.usg.netNote', { n: f.num(margin.payments) })}</em>
        </div>
        <div className="viz-hero-figure">
          <span>{t('admin.usg.costPerShop')}</span>
          <strong>{f.exact(spend.costPerActiveShopPaise)}</strong>
          <em>{t('admin.usg.costPerShopNote', { active: f.num(spend.shops), total: f.num(spend.totalShops) })}</em>
        </div>
      </div>
    </section>
  );
}

function MeterTiles({ data, f }) {
  const { t } = useLanguage();
  return (
    <div className="viz-tiles usg-tiles">
      {data.metrics.map((metric) => (
        <StatTile
          key={metric.metric}
          label={t('admin.usg.meterTileLabel', { name: metric.label, rate: f.exact(metric.ratePaise) })}
          value={f.rupees(metric.costPaise)}
          delta={deltaPct(metric.costPaise, metric.previousCostPaise)}
          deltaLabel={t('admin.usg.vsPrevious')}
          upIsGood={false}
          spark={metric.history.map((row) => row.costPaise)}
          sparkColor={METER_COLOR[metric.metric]}
          icon={<ZapIcon size={16} />}
          tone={metric.blocked > 0 ? 'danger' : METER_TONE[metric.metric] || 'brand'}
          note={t('admin.usg.tileNote', { units: f.num(metric.used), shops: f.num(metric.shops) })}
        />
      ))}
      <StatTile
        label={t('admin.usg.blockedTile')}
        value={f.num(data.spend.blocked)}
        note={t('admin.usg.blockedNote', { shops: f.num(data.spend.blockedShops) })}
        icon={<AlertIcon size={16} />}
        tone={data.spend.blocked > 0 ? 'danger' : 'success'}
      />
    </div>
  );
}

function SpendCharts({ data, f }) {
  const { t } = useLanguage();
  const series = data.metrics.map((metric) => ({
    key: metric.metric,
    label: metric.label,
    color: METER_COLOR[metric.metric],
  }));

  // Paise on the axis would print six-digit ticks for a ₹9,000 month; the chart works in
  // whole rupees and says so in its hint.
  const rows = data.periods.map((p) => {
    const row = { x: p };
    for (const metric of data.metrics) {
      row[metric.metric] = Math.round((metric.history.find((h) => h.period === p)?.costPaise || 0) / 100);
    }
    return row;
  });

  return (
    <div className="viz-board">
      <ChartCard title={t('admin.usg.trendTitle')} hint={t('admin.usg.trendHint')} span={2}>
        <StackedColumnChart
          data={rows}
          series={series}
          formatValue={(value) => formatCompactRupees(value, 'en')}
          formatX={(row) => monthLabel(row.x)}
          emptyLabel={t('admin.usg.noUsage')}
        />
      </ChartCard>

      <ChartCard title={t('admin.usg.splitTitle')} hint={t('admin.usg.splitHint')}>
        <DonutChart
          segments={data.metrics.map((metric) => ({
            key: metric.metric,
            label: metric.label,
            value: metric.costPaise,
            color: METER_COLOR[metric.metric],
          }))}
          total={data.spend.costPaise}
          totalLabel={t('admin.usg.thisMonth')}
          formatValue={(value) => f.rupees(value)}
          emptyLabel={t('admin.usg.noUsage')}
        />
      </ChartCard>

      <ChartCard title={t('admin.usg.byPlanTitle')} hint={t('admin.usg.byPlanHint')}>
        <RankedBars
          rows={data.plans
            .filter((plan) => plan.shops > 0)
            .map((plan) => ({
              key: plan.plan,
              label: plan.name,
              value: plan.costPaise,
              note: t('admin.usg.perShopShort', { amount: f.exact(plan.costPerShopPaise) }),
              color: 'var(--viz-1)',
            }))}
          formatValue={(value) => f.rupees(value)}
          emptyLabel={t('admin.usg.noUsage')}
        />
      </ChartCard>

      {data.metrics.map((metric) => (
        <ChartCard
          key={metric.metric}
          title={metric.label}
          hint={t('admin.usg.historyHint', { rate: f.exact(metric.ratePaise) })}
          table={{
            columns: [
              { key: 'x', label: t('admin.rev.month') },
              { key: 'used', label: t('admin.usg.used'), numeric: true },
              { key: 'blocked', label: t('admin.usg.blocked'), numeric: true },
              { key: 'cost', label: t('admin.usg.cost'), numeric: true },
            ],
            rows: metric.history.map((row) => ({
              x: monthLabel(row.period),
              used: String(row.used),
              blocked: String(row.blocked),
              cost: f.rupees(row.costPaise),
            })),
          }}
        >
          <ColumnChart
            data={metric.history.map((row) => ({ x: row.period, y: row.used }))}
            formatValue={(value) => String(Math.round(value))}
            formatX={(row) => monthLabel(row.x)}
            color={METER_COLOR[metric.metric]}
            emptyLabel={t('admin.usg.noUsage')}
          />
        </ChartCard>
      ))}
    </div>
  );
}

/* ================================================================== shops */

function ShopsTab({ data, f, lang }) {
  const { t } = useLanguage();
  const [view, setView] = useState('all');
  const [search, setSearch] = useState('');

  const source = view === 'walls' ? data.walls : view === 'drains' ? data.drains : data.topShops;
  const term = search.trim().toLowerCase();
  const rows = term
    ? source.filter((shop) => `${shop.shopName} ${shop.email}`.toLowerCase().includes(term))
    : source;

  return (
    <>
      {view === 'walls' && data.walls.length > 0 && <WallsPanel data={data} f={f} />}

      <div className="panel">
        <div className="panel-head rev-payments-head">
          <h2>{t(`admin.usg.view.${view}`)}</h2>
          <div className="rev-pay-tools">
            <div className="segmented segmented-mini" role="tablist">
              {SHOP_VIEWS.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={view === key}
                  className={view === key ? 'active' : ''}
                  onClick={() => setView(key)}
                >
                  {t(`admin.usg.view.${key}`)}
                  <span className="rev-count">
                    {f.num(key === 'walls' ? data.walls.length : key === 'drains' ? data.drains.length : data.topShops.length)}
                  </span>
                </button>
              ))}
            </div>
            <div className="search-box-inline">
              <SearchIcon size={15} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('admin.usg.searchShop')} />
            </div>
          </div>
        </div>

        <p className="empty-state rev-hint">{t(`admin.usg.viewHint.${view}`)}</p>

        {rows.length === 0 ? (
          <p className="empty-state">{t('admin.usg.noMatch')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('admin.shop')}</th>
                  <th>{t('admin.plan')}</th>
                  <th className="usg-meters-col">{t('admin.usg.breakdown')}</th>
                  <th className="num">{t('admin.usg.cost')}</th>
                  <th className="num">{t('admin.usg.pays')}</th>
                  <th className="num">{t('admin.usg.margin')}</th>
                  <th>{t('admin.usg.lastUsed')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((shop) => (
                  <tr key={shop.id} className={shop.blocked > 0 ? 'rev-row-risk' : undefined}>
                    <td>
                      <Link className="link-btn name" href={recordHref('/admin/sellers/[id]', shop.id)}>{shop.shopName}</Link>
                      <div className="cell-sub">{shop.email}</div>
                    </td>
                    <td>
                      <span className="badge badge-safe">{shop.planName}</span>
                      {shop.granted && <div className="cell-sub">{t('admin.usg.granted')}</div>}
                      {shop.onTrial && <div className="cell-sub">{t('admin.usg.onTrial')}</div>}
                    </td>
                    <td className="usg-meters-col">
                      <MeterBars meters={shop.meters} f={f} />
                    </td>
                    <td className="num tabular">{f.exact(shop.costPaise)}</td>
                    <td className="num tabular">{shop.worthPaise > 0 ? f.rupees(shop.worthPaise) : '—'}</td>
                    <td className={`num tabular${shop.marginPaise < 0 ? ' usg-neg' : ''}`}>
                      {f.exact(shop.marginPaise)}
                    </td>
                    <td className="cell-sub">{formatRelativeTime(shop.lastUsedAt, lang)}</td>
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

/**
 * One shop's three quotas as three bars.
 *
 * "37 / 50" reads instantly and "37" does not; the bar on top of it is what makes a row of
 * thirty shops scannable without reading a single number. Over the ceiling the bar turns
 * red rather than clipping silently — a shop past its quota is the whole point of looking.
 */
function MeterBars({ meters, f }) {
  const { t } = useLanguage();
  return (
    <div className="usg-meters">
      {meters
        .filter((meter) => meter.used > 0 || meter.blocked > 0)
        .map((meter) => {
          const pct = meter.usedPercent;
          const over = pct !== null && pct >= 100;
          return (
            <div key={meter.metric} className="usg-meter">
              <span className="usg-meter-top">
                <span className="usg-meter-name">{meter.label}</span>
                <span className="usg-meter-value tabular">
                  {meter.ceiling === null ? f.num(meter.used) : `${f.num(meter.used)} / ${f.num(meter.ceiling)}`}
                  {meter.bonus > 0 && <em>{t('admin.usg.withBonus', { n: f.num(meter.bonus) })}</em>}
                  {meter.blocked > 0 && <em className="usg-neg">{t('admin.usg.blockedShort', { n: f.num(meter.blocked) })}</em>}
                </span>
              </span>
              <span className="breakdown-track usg-meter-track">
                <span
                  className="breakdown-fill"
                  style={{ width: `${Math.min(100, pct ?? 100)}%`, background: over ? 'var(--danger)' : METER_COLOR[meter.metric] }}
                />
              </span>
            </div>
          );
        })}
    </div>
  );
}

/**
 * A shop turned away at a quota is the platform's clearest upgrade signal — and equally,
 * evidence the tier's limit is wrong. Either way it needs a name and somewhere to go.
 */
function WallsPanel({ data, f, preview = false }) {
  const { t } = useLanguage();
  const rows = preview ? data.walls.slice(0, 5) : data.walls;

  return (
    <div className="panel">
      <div className="section-title">
        <div className="icon-badge icon-danger"><AlertIcon size={16} /></div>
        <h2>{t('admin.usg.wallsTitle')}</h2>
      </div>
      <p className="empty-state rev-hint">{t('admin.usg.wallsHint')}</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('admin.shop')}</th>
              <th>{t('admin.plan')}</th>
              <th>{t('admin.usg.hitWall')}</th>
              <th className="num">{t('admin.usg.blocked')}</th>
              <th className="num">{t('admin.usg.cost')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((shop) => (
              <tr key={shop.id}>
                <td>
                  <Link className="link-btn name" href={recordHref('/admin/sellers/[id]', shop.id)}>{shop.shopName}</Link>
                  <div className="cell-sub">{shop.email}</div>
                </td>
                <td><span className="badge badge-safe">{shop.planName}</span></td>
                <td>
                  {shop.meters
                    .filter((meter) => meter.blocked > 0)
                    .map((meter) => (
                      <div key={meter.metric} className="cell-sub">
                        {meter.label}: {meter.ceiling === null ? f.num(meter.used) : `${f.num(meter.used)} / ${f.num(meter.ceiling)}`}
                      </div>
                    ))}
                </td>
                <td className="num tabular">{f.num(shop.blocked)}</td>
                <td className="num tabular">{f.exact(shop.costPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview && data.walls.length > rows.length && (
        <p className="empty-state rev-hint">{t('admin.usg.wallsMore', { n: data.walls.length - rows.length })}</p>
      )}
    </div>
  );
}

/* ================================================================== quotas */

/**
 * The tab this module was missing.
 *
 * A quota is two decisions at once — how much a shop may have, and how much the platform
 * is willing to spend to give it to them — and until now the admin could only ever see the
 * first. Each card sets a tier's price against the worst month one shop on it could
 * legitimately have, then shows how close anyone actually gets. A tier where nobody
 * reaches 10% of a limit is a limit doing no work; a tier with shops at the wall and a
 * ratio over 1 is a tier losing money on its best customers.
 */
function QuotasTab({ data, f }) {
  const { t } = useLanguage();

  return (
    <>
      <div className="rev-explain">
        <InfoIcon size={15} />
        <p className="empty-state rev-hint" style={{ padding: 0 }}>{t('admin.usg.quotaExplain')}</p>
      </div>

      {data.plans.map((plan) => {
        const risky = plan.exposureRatio !== null && plan.exposureRatio >= 1;
        return (
          <div className="panel usg-plan" key={plan.plan}>
            <div className="panel-head usg-plan-head">
              <div>
                <h2>
                  {plan.name}
                  {plan.pricePaise > 0 && <span className="usg-plan-price">{t('admin.usg.perMonth', { amount: f.rupees(plan.pricePaise) })}</span>}
                </h2>
                <p className="cell-sub">
                  {t('admin.usg.planShops', {
                    shops: f.num(plan.shops),
                    using: f.num(plan.usingShops),
                    paying: f.num(plan.payingShops),
                  })}
                </p>
              </div>
              <Link className="btn btn-secondary btn-inline" href="/admin/plans">
                <SlidersIcon size={17} /> {t('admin.usg.editQuotas')}
              </Link>
            </div>

            <div className="usg-plan-figures">
              <div className="usg-figure">
                <span>{t('admin.usg.planCost')}</span>
                <strong>{f.rupees(plan.costPaise)}</strong>
                <em>{t('admin.usg.perShopShort', { amount: f.exact(plan.costPerShopPaise) })}</em>
              </div>
              <div className={`usg-figure${risky ? ' is-risky' : ''}`}>
                <span>{t('admin.usg.exposure')}</span>
                <strong>{plan.exposureUncapped ? t('admin.usg.uncapped') : f.rupees(plan.exposurePaise)}</strong>
                <em>
                  {plan.exposureUncapped
                    ? t('admin.usg.uncappedNote')
                    : plan.exposureRatio === null
                      ? t('admin.usg.exposureFree')
                      : t('admin.usg.exposureNote', { times: plan.exposureRatio })}
                </em>
              </div>
              <div className={`usg-figure${plan.blockedShops > 0 ? ' is-risky' : ''}`}>
                <span>{t('admin.usg.atWall')}</span>
                <strong>{f.num(plan.blockedShops)}</strong>
                <em>{t('admin.usg.atWallNote')}</em>
              </div>
            </div>

            {plan.pricePaise > 0 && !plan.exposureUncapped && plan.exposurePaise > 0 && (
              <SplitBar
                segments={[
                  { key: 'price', label: t('admin.usg.tierPrice'), value: plan.pricePaise, color: 'var(--viz-3)' },
                  {
                    key: 'gap',
                    label: t('admin.usg.aboveTierPrice'),
                    value: Math.max(0, plan.exposurePaise - plan.pricePaise),
                    color: 'var(--danger)',
                  },
                ]}
                formatValue={(value) => f.rupees(value)}
              />
            )}

            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('admin.usg.meter')}</th>
                    <th className="num">{t('admin.usg.quota')}</th>
                    <th className="num">{t('admin.usg.avgUsed')}</th>
                    <th>{t('admin.usg.utilisation')}</th>
                    <th className="num">{t('admin.usg.busiest')}</th>
                    <th className="num">{t('admin.usg.atWallShort')}</th>
                    <th className="num">{t('admin.usg.cost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.meters.map((meter) => (
                    <tr key={meter.metric}>
                      <td>{meter.label}</td>
                      <td className="num tabular">{meter.limit === null ? t('admin.usg.uncapped') : f.num(meter.limit)}</td>
                      <td className="num tabular">{f.num(meter.avgUsed)}</td>
                      <td>
                        {meter.utilisationPercent === null ? (
                          '—'
                        ) : (
                          <div className="breakdown-row usg-bar" style={{ padding: 0 }}>
                            <div className="breakdown-track">
                              <div
                                className="breakdown-fill"
                                style={{
                                  width: `${Math.min(100, meter.utilisationPercent)}%`,
                                  background: meter.utilisationPercent < 10 ? 'var(--text-faint)' : METER_COLOR[meter.metric],
                                }}
                              />
                            </div>
                            <span className="breakdown-share">{meter.utilisationPercent}%</span>
                          </div>
                        )}
                      </td>
                      <td className="num tabular">
                        {f.num(meter.maxUsed)}
                        {meter.headroomPercent !== null && (
                          <div className="cell-sub">{t('admin.usg.headroom', { pct: meter.headroomPercent })}</div>
                        )}
                      </td>
                      <td className={`num tabular${meter.atWall > 0 ? ' usg-neg' : ''}`}>{meter.atWall || '—'}</td>
                      <td className="num tabular">{f.exact(meter.costPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}

/* ================================================================== adoption */

/**
 * Which modules shops actually open — counted against the shops that CAN open them.
 *
 * Adoption used to divide by every seller on the platform, which made a feature sold on
 * Enterprise look like a failure when it was working exactly as priced. Here a module is
 * measured against its own reachable population, and one the admin has switched off says
 * so rather than being ranked bottom of a list of failures.
 */
function AdoptionTab({ adoption, f, lang }) {
  const { t } = useLanguage();
  const [group, setGroup] = useState('');
  const [hideOff, setHideOff] = useState(true);

  // `summary` and `groups` shipped with this screen; a tab left open across the deploy that
  // added them would otherwise take the whole page down over a count.
  if (!adoption?.summary) return <SkeletonTable rows={8} cols={7} />;

  const rows = adoption.modules.filter(
    (row) => (!group || row.group === group) && (!hideOff || !row.platformOff)
  );

  return (
    <>
      <div className="viz-tiles usg-tiles">
        <StatTile
          label={t('admin.usg.st.dead')}
          value={f.num(adoption.summary.dead)}
          note={t('admin.usg.st.deadNote')}
          icon={<AlertIcon size={16} />}
          tone={adoption.summary.dead > 0 ? 'danger' : 'success'}
        />
        <StatTile
          label={t('admin.usg.st.niche')}
          value={f.num(adoption.summary.niche)}
          note={t('admin.usg.st.nicheNote')}
          icon={<TagIcon size={16} />}
          tone="gold"
        />
        <StatTile
          label={t('admin.usg.st.fading')}
          value={f.num(adoption.summary.fading)}
          note={t('admin.usg.st.fadingNote', { days: f.num(adoption.staleAfterDays) })}
          icon={<ClockIcon size={16} />}
          tone="gold"
        />
        <StatTile
          label={t('admin.usg.st.average')}
          value={`${f.num(adoption.summary.averageAdoption)}%`}
          note={t('admin.usg.st.averageNote', { n: f.num(adoption.totalShops) })}
          icon={<LayersIcon size={16} />}
          tone="brand"
        />
      </div>

      <div className="panel">
        <div className="panel-head rev-payments-head">
          <h2>{t('admin.usg.adoptionTitle')}</h2>
          <div className="rev-pay-tools">
            <Dropdown
              className="filter-select"
              value={group}
              onChange={setGroup}
              options={[
                { value: '', label: t('admin.usg.allGroups') },
                ...(adoption.groups || []).map((g) => ({ value: g.key, label: g.label })),
              ]}
            />
            <button
              type="button"
              className={`chip${hideOff ? '' : ' active'}`}
              onClick={() => setHideOff((v) => !v)}
            >
              {t('admin.usg.showOff', { n: f.num(adoption.summary.off) })}
            </button>
            <Link className="btn btn-secondary btn-inline" href="/admin/modules">
              <SlidersIcon size={17} /> {t('admin.usg.manageModules')}
            </Link>
          </div>
        </div>

        <p className="empty-state rev-hint">
          {t('admin.usg.adoptionHint', { days: f.num(adoption.staleAfterDays) })}
        </p>

        {adoption.summary.dead > 0 && (
          <div className="platform-banner warning" style={{ marginBottom: '0.8rem' }}>
            {t('admin.usg.neverUsed', { n: f.num(adoption.summary.dead) })}
          </div>
        )}

        {rows.length === 0 ? (
          <p className="empty-state">{t('admin.usg.noMatch')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('admin.usg.module')}</th>
                  <th>{t('admin.usg.state')}</th>
                  <th>{t('admin.usg.reach')}</th>
                  <th className="num">{t('admin.usg.shopsEver')}</th>
                  <th className="num">{t('admin.usg.shopsActive')}</th>
                  <th className="num">{t('admin.usg.wentQuiet')}</th>
                  <th className="num">{t('admin.usg.depth')}</th>
                  <th>{t('admin.usg.lastUsed')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.module}>
                    <td>
                      <strong>{row.label}</strong>
                      <div className="cell-sub">
                        {row.core
                          ? t('admin.usg.coreModule')
                          : row.planFeature
                            ? t('admin.usg.gatedBy', { feature: row.planFeature })
                            : t('admin.usg.openToAll')}
                      </div>
                    </td>
                    <td>
                      <span className={`usg-state usg-state-${STATUS_TONE[row.status]}`}>
                        {t(`admin.usg.status.${row.status}`)}
                      </span>
                    </td>
                    <td className="rev-bar-cell">
                      {row.adoptionPercent === null ? (
                        '—'
                      ) : (
                        <>
                          <div className="breakdown-row usg-bar" style={{ padding: 0 }}>
                            <div className="breakdown-track">
                              <div
                                className="breakdown-fill"
                                style={{
                                  width: `${Math.min(100, row.adoptionPercent)}%`,
                                  background: row.adoptionPercent < 20 ? 'var(--danger)' : 'var(--viz-1)',
                                }}
                              />
                            </div>
                            <span className="breakdown-share">{row.adoptionPercent}%</span>
                          </div>
                          <span className="cell-sub">{t('admin.usg.ofEligible', { n: f.num(row.eligibleShops) })}</span>
                        </>
                      )}
                    </td>
                    <td className="num tabular">{f.num(row.shopsEverUsed)}</td>
                    <td className="num tabular">{f.num(row.shopsActive)}</td>
                    <td className="num tabular">{row.shopsWentQuiet > 0 ? f.num(row.shopsWentQuiet) : '—'}</td>
                    <td className="num tabular">{row.hitsPerShop || '—'}</td>
                    <td className="cell-sub">
                      {row.lastUsedAt ? formatRelativeTime(row.lastUsedAt, lang) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="empty-state rev-hint" style={{ paddingTop: '0.6rem' }}>
          <TrendUpIcon size={13} /> {t('admin.usg.adoptionFoot', { n: f.num(adoption.totalShops) })}
        </p>
      </div>
    </>
  );
}

/* ================================================================== rates */

/**
 * What one unit costs, in the operator's own hands.
 *
 * Typed in rupees because that is what a vendor's invoice says, stored in paise because an
 * SMS costs a fraction of one and rounding it to a rupee would be a 4x error on the
 * platform's largest line item.
 */
function RatesModal({ rates, f, onClose, onSaved }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [form, setForm] = useState(() =>
    Object.fromEntries(METER_KEYS.map((key) => [key, ((rates[key] || 0) / 100).toFixed(2)]))
  );
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const unitCosts = {};
    for (const key of METER_KEYS) {
      const rupees = Number(form[key]);
      if (!Number.isFinite(rupees) || rupees < 0) {
        toast.error(t('admin.usg.rateInvalid'));
        return;
      }
      unitCosts[key] = Math.round(rupees * 100);
    }
    setSaving(true);
    try {
      await apiFetch('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ unitCosts }) });
      toast.success(t('admin.usg.ratesSaved'));
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      as="form"
      onSubmit={submit}
      onClose={onClose}
      title={t('admin.usg.ratesTitle')}
      hint={t('admin.usg.ratesHint')}
      maxWidth={480}
      footer={
        <>
          <button type="submit" className="btn btn-primary btn-inline" disabled={saving}>
            {t('common.save')}
          </button>
          <button type="button" className="btn btn-secondary btn-inline" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
      {METER_KEYS.map((key) => (
        <div className="field" key={key}>
          <label htmlFor={`rate-${key}`}>{t(`admin.usg.rate.${key}`)}</label>
          <input
            id={`rate-${key}`}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={form[key]}
            onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
          />
          <p className="field-hint">{t(`admin.usg.rateHint.${key}`)}</p>
        </div>
      ))}
      <p className="field-hint">{t('admin.usg.ratesFoot', { example: f.exact(rates.sms * 1000) })}</p>
    </Modal>
  );
}
