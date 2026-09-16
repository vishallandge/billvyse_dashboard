'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { formatDate } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { SkeletonStats, SkeletonTable } from '../../components/Skeleton';
import Switch from '../../components/Switch';
import Dropdown from '../../components/Dropdown';
import ChipSelect from '../../components/ChipSelect';
import Modal from '../../components/Modal';
import AnimatedNumber from '../../components/AnimatedNumber';
import RowMenu from '../../components/RowMenu';
import SaveBar from '../../components/SaveBar';
import { Pagination, usePagination } from '../../components/Pagination';
import { useSort, SortHeader } from '../../components/DataTable';
import {
  TargetIcon,
  SparkleIcon,
  TagIcon,
  SlidersIcon,
  EyeIcon,
  EyeOffIcon,
  RupeeIcon,
  PlusIcon,
  EditIcon,
  CopyIcon,
  TrashIcon,
  AlertIcon,
  ZapIcon,
  SearchIcon,
  UsersIcon,
  InfoIcon,
  ShopIcon,
  ActivityIcon,
  ChevronRightIcon,
} from '../../components/Icons';
import { recordHref } from '../../../lib/routeId';

/**
 * Admin → Growth.
 *
 * Four things that all answer the same question — "what is this platform saying to its own
 * shops, and is it working":
 *
 *   Campaigns  the platform's own voice: upsells, feature nudges, notices
 *   Ads        somebody else's voice, paid for, in a clearly marked slot
 *   Codes      the discounts those campaigns are allowed to promise
 *   Rules      the ceilings every campaign obeys, whoever wrote it
 *
 * Tabs rather than four sidebar entries because they are one job. The one thing that does
 * NOT live here is the campaign editor — a form with forty fields does not belong inside a
 * list, so it gets its own route.
 *
 * The screen used to be four bare tables and it was not readable, for three reasons that
 * are all fixed here and are all the same reason: it never said what was actually true.
 *
 *   A row said "Live" when the campaign's end date had passed, when its start date had not
 *   arrived, when the ad's booked budget was fully delivered, and — worst — when the
 *   platform-wide kill switch in Rules had every campaign switched off. So "Live" now means
 *   live, and every other reason a switched-on campaign is not being shown has its own word
 *   and its own explanation on hover.
 *
 *   The numbers were counts with nothing to read them against. 4,000 impressions and 90
 *   clicks is a number and a number; "90 clicks — 2% of the times it was shown" is a fact
 *   about whether the words are working.
 *
 *   And a table with no search, no filter and no paging stops being a list at about thirty
 *   rows. All three are here now, over the filters the API already supported and nobody was
 *   sending.
 */

const TABS = ['nudge', 'ad', 'promos', 'rules'];
const TAB_ICONS = { nudge: TargetIcon, ad: ShopIcon, promos: TagIcon, rules: SlidersIcon };

function rupees(paise) {
  return Math.round((paise || 0) / 100).toLocaleString('en-IN');
}

function count(n) {
  return (n || 0).toLocaleString('en-IN');
}

/** A share, as a whole number. Returns null when there is no denominator — "0%" and
 *  "nothing has happened yet" are different facts and only one of them is discouraging. */
function share(part, whole) {
  if (!whole) return null;
  return Math.round(((part || 0) / whole) * 100);
}

/**
 * What is ACTUALLY happening to this campaign right now.
 *
 * `status` is what the operator asked for; this is what the engine will do about it. The
 * four extra answers are every way a campaign can be switched on and still show nobody
 * anything — and each of them used to render as a green "Live" badge, which is how a
 * campaign sits dead for a fortnight while somebody waits for its numbers to move.
 *
 * The conditions mirror utils/campaignEngine.js exactly (schedule window, then ad budget).
 * If that file's rules change, this one has to follow.
 */
function effectiveState(campaign, { campaignsEnabled = true, adsEnabled = true } = {}) {
  if (campaign.status === 'draft') return 'draft';
  if (campaign.status === 'paused') return 'paused';
  if (campaign.kind === 'ad' ? !adsEnabled || !campaignsEnabled : !campaignsEnabled) return 'muted';
  const now = Date.now();
  if (campaign.schedule?.startsAt && now < new Date(campaign.schedule.startsAt).getTime()) return 'scheduled';
  if (campaign.schedule?.endsAt && now > new Date(campaign.schedule.endsAt).getTime()) return 'ended';
  if (campaign.kind === 'ad' && campaign.ad?.budgetPaise > 0 && (campaign.ad.spentPaise || 0) >= campaign.ad.budgetPaise) {
    return 'budget';
  }
  return 'live';
}

const STATE_BADGE = {
  live: 'active',
  scheduled: 'pending',
  ended: 'inactive',
  budget: 'pending',
  muted: 'rejected',
  paused: 'pending',
  draft: 'inactive',
};

/** Where a discount code stands, for the same reason campaigns get one. */
function promoState(promo) {
  if (!promo.active) return 'off';
  const now = Date.now();
  if (promo.startsAt && now < new Date(promo.startsAt).getTime()) return 'scheduled';
  if (promo.endsAt && now > new Date(promo.endsAt).getTime()) return 'ended';
  if (promo.maxRedemptions > 0 && (promo.used || 0) >= promo.maxRedemptions) return 'usedup';
  return 'live';
}

const PROMO_BADGE = { live: 'active', scheduled: 'pending', ended: 'inactive', usedup: 'pending', off: 'inactive' };

/* ============================================================================ the screen */

export default function AdminGrowthPage() {
  const { t } = useLanguage();

  const [tab, setTab] = useState('nudge');
  const [rules, setRules] = useState(null);
  const [counts, setCounts] = useState(null);
  const [error, setError] = useState('');

  // Loaded on mount whichever tab is open, because the two master switches inside it decide
  // whether ANY row on the other tabs is really running. A screen that shows "Live" while
  // the kill switch is down is worse than a screen that shows nothing.
  const loadRules = useCallback(
    () =>
      apiFetch('/api/admin/growth/rules')
        .then(setRules)
        .catch((err) => setError(err.message)),
    []
  );

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const growth = rules?.growth;
  const campaignsEnabled = growth ? growth.campaignsEnabled : true;
  const adsEnabled = growth ? growth.adsEnabled : true;

  const setPromoCount = useCallback((n) => setCounts((prev) => ({ ...(prev || {}), promos: n })), []);

  const tabCount = (key) => {
    if (!counts) return null;
    if (key === 'promos') return counts.promos;
    if (key === 'rules') return null;
    return counts[key]?.total ?? null;
  };

  return (
    <>
      <div className="content-header">
        <h1>{t('admin.growthTitle')}</h1>
        <p>{t('admin.growthSubtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* The kill switch, said out loud where its effect is visible. It is two clicks away
          in Rules and it silences every row on this screen — leaving that fact on another
          tab is the difference between "nothing is working" and "we switched it off". */}
      {growth && !campaignsEnabled && (tab === 'nudge' || tab === 'ad') && (
        <MutedBanner text={t('admin.growthOffBanner')} onGo={() => setTab('rules')} />
      )}
      {growth && campaignsEnabled && !adsEnabled && tab === 'ad' && (
        <MutedBanner text={t('admin.growthAdsOffBanner')} onGo={() => setTab('rules')} />
      )}

      <div className="segmented segmented-sm growth-tabs">
        {TABS.map((key) => {
          const Icon = TAB_ICONS[key];
          const n = tabCount(key);
          return (
            <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
              <Icon size={14} />
              {t(`admin.growthTab_${key}`)}
              {n !== null && n !== undefined && <span className="count-pill">{count(n)}</span>}
            </button>
          );
        })}
      </div>

      {/* One sentence per tab, in the operator's own words. Four tabs that all show tables
          of "campaigns" are four tabs nobody can tell apart on the first visit. */}
      <p className="growth-tab-hint">
        <InfoIcon size={14} />
        {t(`admin.growthHint_${tab}`)}
      </p>

      {(tab === 'nudge' || tab === 'ad') && (
        <CampaignsTab
          kind={tab}
          campaignsEnabled={campaignsEnabled}
          adsEnabled={adsEnabled}
          onCounts={setCounts}
          onError={setError}
        />
      )}

      {tab === 'promos' && <PromosTab onCount={setPromoCount} onError={setError} />}

      {tab === 'rules' && <RulesTab rules={rules} setRules={setRules} onSaved={loadRules} />}
    </>
  );
}

/** The "everything below is switched off" strip. One element, one job. */
function MutedBanner({ text, onGo }) {
  const { t } = useLanguage();
  return (
    <div className="platform-banner warning growth-muted-banner">
      <AlertIcon size={16} />
      <span>{text}</span>
      <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={onGo}>
        {t('admin.growthGoToRules')}
      </button>
    </div>
  );
}

/* ====================================================================== campaigns / ads */

function CampaignsTab({ kind, campaignsEnabled, adsEnabled, onCounts, onError }) {
  const { t } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [busyId, setBusyId] = useState('');

  const isAd = kind === 'ad';

  const load = useCallback(() => {
    const params = new URLSearchParams({ kind });
    if (status) params.set('status', status);
    if (query.trim()) params.set('q', query.trim());
    return apiFetch(`/api/admin/growth/campaigns?${params.toString()}`)
      .then((res) => {
        setData(res);
        onCounts(res.counts);
      })
      .catch((err) => onError(err.message));
  }, [kind, status, query, onCounts, onError]);

  // A different list — show the skeleton. Typing in the search box is NOT a different
  // list, and blanking the panel on every keystroke made it strobe.
  useEffect(() => {
    setData(null);
  }, [kind, status]);

  // Debounced, because this fires on every keystroke and the endpoint aggregates over
  // every campaign to keep the tab counts honest.
  useEffect(() => {
    const timer = setTimeout(load, query ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  const campaigns = useMemo(() => data?.campaigns || [], [data]);
  const totals = data?.totals;

  const rows = useMemo(
    () =>
      campaigns.map((campaign) => ({
        ...campaign,
        state: effectiveState(campaign, { campaignsEnabled, adsEnabled }),
        ctr: share(campaign.stats?.clicks, campaign.stats?.impressions),
      })),
    [campaigns, campaignsEnabled, adsEnabled]
  );

  // The best click rate on this list, as the yardstick every row's bar is drawn against.
  const bestCtr = useMemo(() => rows.reduce((best, row) => Math.max(best, row.ctr || 0), 0), [rows]);

  const { sorted, sort, toggle } = useSort(
    rows,
    {
      name: (row) => row.name,
      state: (row) => row.state,
      shown: (row) => row.stats?.impressions || 0,
      clicks: (row) => row.stats?.clicks || 0,
      ctr: (row) => row.ctr ?? -1,
      conversions: (row) => row.stats?.conversions || 0,
      spent: (row) => row.ad?.spentPaise || 0,
      updated: (row) => new Date(row.updatedAt || 0).getTime(),
    },
    { key: 'updated', dir: 'desc' }
  );

  const paged = usePagination(sorted, { pageSize: 25, resetKey: `${kind}|${status}|${query}` });
  const filtersOn = Boolean(query || status);

  async function setCampaignStatus(campaign, next) {
    setBusyId(campaign._id);
    try {
      await apiFetch(`/api/admin/growth/campaigns/${campaign._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      toast.success(t(next === 'active' ? 'admin.growthLive' : 'admin.growthPaused'));
      await load();
    } catch (err) {
      // The activation rules answer with the first real problem ("write a title", "the
      // button has a label but nowhere to go"), so this is worth showing verbatim rather
      // than replacing with a generic failure.
      toast.error(err.message);
    } finally {
      setBusyId('');
    }
  }

  async function duplicate(campaign) {
    try {
      await apiFetch(`/api/admin/growth/campaigns/${campaign._id}/duplicate`, { method: 'POST' });
      toast.success(t('admin.growthDuplicated'));
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function remove(campaign) {
    const ok = await confirm({
      tone: 'danger',
      title: t('admin.growthDeleteTitle'),
      body: t('admin.growthDeleteBody', { name: campaign.name }),
      details: [
        { label: t('admin.growthShown'), value: count(campaign.stats?.impressions) },
        { label: t('admin.growthClicks'), value: count(campaign.stats?.clicks) },
        { label: t('admin.growthConversions'), value: count(campaign.stats?.conversions) },
      ],
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/admin/growth/campaigns/${campaign._id}`, { method: 'DELETE' });
      toast.success(t('admin.growthDeleted'));
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <>
      {/* Counted over every campaign of THIS kind and ignoring the search box, because
          "how are the ads doing" is not a question about whatever is currently typed. */}
      {!totals ? (
        <SkeletonStats count={4} />
      ) : (
        <GrowthFlow totals={totals} isAd={isAd} />
      )}

      <div className="data-panel">
        <div className="data-panel-head">
          <span className="data-panel-title">
            {t(isAd ? 'admin.growthTab_ad' : 'admin.growthTab_nudge')}
            <span className="count-pill">{count(paged.total)}</span>
          </span>
          <div className="panel-tools">
            <div className="search-box-inline">
              <SearchIcon size={15} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('admin.growthSearch')} />
            </div>
            <Link className="btn btn-primary btn-small btn-inline" href={`/admin/growth/new?kind=${kind}`}>
              <PlusIcon size={15} /> {t(isAd ? 'admin.growthNewAd' : 'admin.growthNew')}
            </Link>
          </div>
        </div>

        {/* The status filter as chips rather than a dropdown, because these four numbers are
            worth reading whether or not anybody wants to filter by them: "3 drafts" is the
            single most useful thing this screen can tell an operator who thought they had
            switched something on. A dropdown hides them behind a click.

            They filter on `status` — what was ASKED for — while the badge on each row shows
            what is actually happening to it. That is why the chip says "Switched on" and not
            "Live": six campaigns can be switched on with only four of them really showing. */}
        {totals && (
          <div className="growth-status-chips">
            <div className="chip-row">
              {[
                { value: '', label: t('admin.growthFilter_all'), n: totals.total },
                { value: 'active', label: t('admin.growthFilter_on'), n: totals.active },
                { value: 'paused', label: t('admin.growthFilter_paused'), n: totals.paused },
                { value: 'draft', label: t('admin.growthFilter_draft'), n: totals.draft },
              ].map((chip) => (
                <button
                  key={chip.value || 'all'}
                  type="button"
                  className={`chip${status === chip.value ? ' active' : ''}`}
                  onClick={() => setStatus(chip.value)}
                >
                  {chip.label} <b>{count(chip.n)}</b>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="data-panel-body">
          {!data ? (
            <SkeletonTable rows={5} cols={8} />
          ) : paged.total === 0 ? (
            <div className="empty-state-rich">
              <div className="empty-icon">{isAd ? <ShopIcon size={26} /> : <TargetIcon size={26} />}</div>
              <p>{filtersOn ? t('admin.growthNoResults') : t(isAd ? 'admin.growthNoAds' : 'admin.growthNone')}</p>
              {filtersOn ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-inline"
                  onClick={() => {
                    setQuery('');
                    setStatus('');
                  }}
                >
                  {t('admin.growthClearFilters')}
                </button>
              ) : (
                <Link className="btn btn-primary btn-small btn-inline" href={`/admin/growth/new?kind=${kind}`}>
                  <PlusIcon size={15} /> {t(isAd ? 'admin.growthNewAd' : 'admin.growthNew')}
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="table-wrap auto-height">
              <table className="data-table" style={{ minWidth: '940px' }}>
                <thead>
                  <tr>
                    <th className="sr">{t('common.srNo')}</th>
                    <SortHeader sortKey="name" label={t('admin.growthName')} sort={sort} onSort={toggle} />
                    <th>{t('admin.growthWhen')}</th>
                    <th>{t('admin.growthWhere')}</th>
                    <SortHeader sortKey="shown" label={t('admin.growthShown')} sort={sort} onSort={toggle} align="right" />
                    <SortHeader sortKey="ctr" label={t('admin.growthClicks')} sort={sort} onSort={toggle} align="right" />
                    {isAd ? (
                      <SortHeader sortKey="spent" label={t('admin.growthBudgetUsed')} sort={sort} onSort={toggle} align="right" />
                    ) : (
                      <SortHeader
                        sortKey="conversions"
                        label={t('admin.growthConversions')}
                        sort={sort}
                        onSort={toggle}
                        align="right"
                      />
                    )}
                    <SortHeader sortKey="state" label={t('admin.status')} sort={sort} onSort={toggle} />
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {paged.pageItems.map((campaign, index) => (
                    <CampaignRow
                      key={campaign._id}
                      campaign={campaign}
                      index={paged.from + index}
                      isAd={isAd}
                      bestCtr={bestCtr}
                      busy={busyId === campaign._id}
                      onStatus={setCampaignStatus}
                      onDuplicate={duplicate}
                      onDelete={remove}
                    />
                  ))}
                </tbody>
              </table>
              </div>

              <Pagination
                compact
                page={paged.page}
                pageCount={paged.pageCount}
                pageSize={paged.pageSize}
                total={paged.total}
                from={paged.from}
                to={paged.to}
                onPageChange={paged.setPage}
                onPageSizeChange={paged.setPageSize}
                label={t(isAd ? 'admin.growthTab_ad' : 'admin.growthTab_nudge')}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * The four numbers, drawn as the thing they actually are: a funnel.
 *
 * They used to be four stat cards side by side — 48,210 / 1,842 / 63 / ₹1,24,500 — and four
 * numbers in a row is a reading comprehension exercise. Nothing on the screen said that the
 * second is a fraction of the first, or that the whole point of the row is the drop between
 * them. An operator had to do the division in their head to learn the one fact that matters,
 * which is that 96% of the shops who saw this did nothing.
 *
 * So each step now carries the conversion FROM THE STEP BEFORE IT, as a sentence and as a
 * bar on a full-width track. The track is the population of the previous step; the fill is
 * how many of them came through. A 3% fill looks like 3%, which is the honest picture and
 * also, usually, the uncomfortable one.
 *
 * The money sits after a divider rather than inside the funnel, because it is an outcome and
 * not a stage — putting ₹1,24,500 in the same row of bars would invite reading it as a
 * fourth percentage of something.
 *
 * Ads get a shorter funnel (shown → clicked) and budget-delivered as their tail, since a
 * sponsored slot has no upgrade to convert to and its "did it work" question is really
 * "how much of what we sold has been delivered".
 */
function GrowthFlow({ totals, isAd }) {
  const { t } = useLanguage();

  const shown = totals.impressions || 0;
  const clicks = totals.clicks || 0;
  const conversions = totals.conversions || 0;
  const clickRate = share(clicks, shown);
  const convRate = share(conversions, clicks);

  const steps = [
    {
      key: 'shown',
      icon: EyeIcon,
      label: t('admin.growthShown'),
      value: shown,
      fill: shown > 0 ? 100 : 0,
      note: t('admin.growthFlowShownNote'),
    },
    {
      key: 'clicked',
      icon: SparkleIcon,
      label: t('admin.growthClicks'),
      value: clicks,
      fill: clickRate ?? 0,
      note: clickRate === null ? t('admin.growthNothingShownYet') : t('admin.growthFlowClickNote', { rate: clickRate }),
    },
  ];

  if (!isAd) {
    steps.push({
      key: 'upgraded',
      icon: TargetIcon,
      label: t('admin.growthConversions'),
      value: conversions,
      fill: convRate ?? 0,
      note: convRate === null ? t('admin.growthFlowNoClicksYet') : t('admin.growthFlowConvNote', { rate: convRate }),
    });
  }

  const budgetLeft = Math.max(0, (totals.budgetPaise || 0) - (totals.spentPaise || 0));
  const perUpgrade = conversions > 0 ? Math.round(totals.revenuePaise / conversions) : 0;

  const tail = isAd
    ? {
        label: t('admin.growthBudgetUsed'),
        money: rupees(totals.spentPaise),
        fill: share(totals.spentPaise, totals.budgetPaise) ?? 0,
        note:
          totals.budgetPaise > 0
            ? t('admin.growthBudgetNote', { booked: rupees(totals.budgetPaise), left: rupees(budgetLeft) })
            : t('admin.growthNoBudget'),
      }
    : {
        label: t('admin.growthRevenue'),
        money: rupees(totals.revenuePaise),
        fill: null,
        // Honest label: money from purchases that carried a campaign's attribution, not a
        // modelled "influenced revenue" number — which is how a growth dashboard starts
        // flattering itself.
        note: conversions > 0 ? t('admin.growthFlowPerUpgrade', { amount: rupees(perUpgrade) }) : t('admin.growthFlowNoMoneyYet'),
      };

  return (
    <div className="panel growth-flow-panel">
      <div className="section-title">
        <div className="icon-badge icon-brand"><ActivityIcon size={16} /></div>
        <h2>{t('admin.growthFlowTitle')}</h2>
      </div>

      <div className="growth-flow">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <div key={step.key} className="growth-flow-step">
              {index > 0 && <span className="growth-flow-arrow" aria-hidden="true"><ChevronRightIcon size={15} /></span>}
              <span className="growth-flow-label">
                <Icon size={13} /> {step.label}
              </span>
              <span className="growth-flow-value">
                <AnimatedNumber value={step.value} decimals={false} />
              </span>
              <FlowBar fill={step.fill} />
              <span className="growth-flow-note">{step.note}</span>
            </div>
          );
        })}

        <div className="growth-flow-step is-outcome">
          <span className="growth-flow-label">
            <RupeeIcon size={13} /> {tail.label}
          </span>
          <span className="growth-flow-value">₹{tail.money}</span>
          {tail.fill === null ? <span className="growth-flow-spacer" aria-hidden="true" /> : <FlowBar fill={tail.fill} tone="success" />}
          <span className="growth-flow-note">{tail.note}</span>
        </div>
      </div>
    </div>
  );
}

/** The track is the step before it; the fill is what came through. A non-zero fill never
 *  renders as nothing — a 0.4% click rate is a real number and an empty bar reads as a bug. */
function FlowBar({ fill, tone, tip }) {
  const width = Math.max(0, Math.min(100, fill || 0));
  return (
    <span className={`growth-flow-track${tone ? ` tone-${tone}` : ''}`} data-tip={tip}>
      <span className="growth-flow-fill" style={{ width: `${width}%`, minWidth: width > 0 ? '3px' : 0 }} />
    </span>
  );
}

function CampaignRow({ campaign, index, isAd, bestCtr, busy, onStatus, onDuplicate, onDelete }) {
  const { t } = useLanguage();
  const state = campaign.state;
  const running = campaign.status === 'active';
  const shown = campaign.stats?.impressions || 0;
  const budget = campaign.ad?.budgetPaise || 0;
  const spent = campaign.ad?.spentPaise || 0;
  const stateHint = ['scheduled', 'ended', 'budget', 'muted'].includes(state)
    ? t(`admin.growthStateHint_${state}`)
    : undefined;

  return (
    <tr>
      <td className="sr">{index}</td>
      <td>
        <div className="cell-stack">
          <Link href={recordHref('/admin/growth/[id]', campaign._id)} className="cell-strong">
            {campaign.name}
          </Link>
          <span className="cell-sub">
            {t(`admin.growthGoal_${campaign.goal}`)}
            {campaign.variant?.enabled ? ` · ${t('admin.growthAbOn')}` : ''}
            {campaign.offer?.promoCode ? ` · ${campaign.offer.promoCode}` : ''}
            {isAd && (campaign.ad?.advertiserShop?.shopName || campaign.ad?.advertiserName)
              ? ` · ${campaign.ad.advertiserShop?.shopName || campaign.ad.advertiserName}`
              : ''}
          </span>
        </div>
      </td>
      <td>{t(`admin.growthTrigger_${campaign.trigger?.type}`)}</td>
      <td>{t(`admin.growthPlacement_${campaign.placement}`)}</td>
      <td className="num">{count(shown)}</td>
      <td className="num">
        <div className="cell-stack">
          <span>{count(campaign.stats?.clicks)}</span>
          {/* The rate, not just the count. 90 clicks is meaningless until it is 90 out of
              how many — and that ratio is the only number on the row that says whether the
              words are any good. A bare .cell-sub in a <td> is inline and would print
              "3183% of shown"; the stack is what puts it on its own line. */}
          {campaign.ctr === null ? (
            <span className="cell-sub">—</span>
          ) : (
            <>
              <FlowBar
                fill={bestCtr > 0 ? (campaign.ctr / bestCtr) * 100 : 0}
                tip={t('admin.growthBestInList', { rate: bestCtr })}
              />
              <span className="cell-sub">{t('admin.growthOfShown', { rate: campaign.ctr })}</span>
            </>
          )}
        </div>
      </td>
      {isAd ? (
        <td className="num">
          <div className="cell-stack">
            <span>₹{rupees(spent)}</span>
            {budget > 0 && <FlowBar fill={share(spent, budget) ?? 0} tone="success" />}
            <span className="cell-sub">
              {budget > 0 ? t('admin.growthOfBooked', { booked: rupees(budget) }) : t('admin.growthNoBudgetShort')}
            </span>
          </div>
        </td>
      ) : (
        <td className="num">
          <div className="cell-stack">
            <span>{count(campaign.stats?.conversions)}</span>
            {campaign.stats?.revenuePaise > 0 && <span className="cell-sub">₹{rupees(campaign.stats.revenuePaise)}</span>}
          </div>
        </td>
      )}
      <td>
        <span className={`badge badge-${STATE_BADGE[state]}`} data-tip={stateHint}>
          {t(`admin.growthState_${state}`)}
        </span>
      </td>
      <td className="tight">
        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="icon-btn"
            disabled={busy}
            onClick={() => onStatus(campaign, running ? 'paused' : 'active')}
            data-tip={t(running ? 'admin.growthPause' : 'admin.growthGoLive')}
            aria-label={t(running ? 'admin.growthPause' : 'admin.growthGoLive')}
          >
            {running ? <EyeOffIcon size={17} /> : <ZapIcon size={17} />}
          </button>
          <Link
            href={recordHref('/admin/growth/[id]', campaign._id)}
            className="icon-btn"
            data-tip={t('common.edit')}
            aria-label={t('common.edit')}
          >
            <EditIcon size={17} />
          </Link>
          <RowMenu
            items={[
              { label: t('admin.growthDuplicate'), icon: CopyIcon, onClick: () => onDuplicate(campaign) },
              { label: t('common.delete'), icon: TrashIcon, danger: true, onClick: () => onDelete(campaign) },
            ]}
          />
        </div>
      </td>
    </tr>
  );
}

/* ========================================================================= promo codes */

const BLANK_PROMO = {
  code: '',
  description: '',
  type: 'percent',
  value: 10,
  plans: [],
  cycles: [],
  active: true,
  perShopLimit: 1,
  maxRedemptions: 0,
  maxDiscountRupees: 0,
  firstPurchaseOnly: false,
  startsAt: '',
  endsAt: '',
};

function PromosTab({ onCount, onError }) {
  const { t } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(null);
  const [redemptionsFor, setRedemptionsFor] = useState(null);

  const load = useCallback(
    () =>
      apiFetch('/api/admin/growth/promos')
        .then((res) => {
          setData(res);
          onCount(res.codes.length);
        })
        .catch((err) => onError(err.message)),
    [onCount, onError]
  );

  useEffect(() => {
    load();
  }, [load]);

  const codes = useMemo(() => {
    const all = (data?.codes || []).map((code) => ({ ...code, state: promoState(code) }));
    const needle = query.trim().toUpperCase();
    if (!needle) return all;
    return all.filter(
      (code) => code.code.includes(needle) || (code.description || '').toUpperCase().includes(needle)
    );
  }, [data, query]);

  const { sorted, sort, toggle } = useSort(
    codes,
    {
      code: (row) => row.code,
      used: (row) => row.used || 0,
      given: (row) => row.discountPaise || 0,
      earned: (row) => row.revenuePaise || 0,
      state: (row) => row.state,
    },
    { key: 'used', dir: 'desc' }
  );

  const paged = usePagination(sorted, { pageSize: 25, resetKey: query });
  const summary = data?.summary;

  async function save() {
    try {
      if (draft._id) {
        await apiFetch(`/api/admin/growth/promos/${draft._id}`, { method: 'PATCH', body: JSON.stringify(draft) });
      } else {
        await apiFetch('/api/admin/growth/promos', { method: 'POST', body: JSON.stringify(draft) });
      }
      toast.success(t('admin.growthCodeSaved'));
      setDraft(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  /** The row switch. Sends ONE key — the server merges it, so pausing a code can never
   *  quietly reset its cap or its plan limits. */
  async function setActive(promo, active) {
    try {
      await apiFetch(`/api/admin/growth/promos/${promo._id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
      toast.success(t(active ? 'admin.growthCodeOn' : 'admin.growthCodeOff'));
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function copy(promo) {
    try {
      await navigator.clipboard.writeText(promo.code);
      toast.success(t('admin.growthCodeCopied'));
    } catch {
      toast.error(t('admin.growthCopyFailed'));
    }
  }

  async function remove(promo) {
    const ok = await confirm({
      tone: 'danger',
      title: t('admin.growthCodeDeleteTitle'),
      body: t('admin.growthCodeDeleteBody', { code: promo.code }),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/admin/growth/promos/${promo._id}`, { method: 'DELETE' });
      toast.success(t('admin.growthCodeDeleted'));
      await load();
    } catch (err) {
      // A used code cannot be deleted, and the server says so. Rather than leaving that as
      // a dead end, offer the thing it is telling us to do — switching it off does the same
      // job for the operator and keeps the money rows readable.
      if (err.code === 'PROMO_IN_USE' || /switch it off/i.test(err.message || '')) {
        const off = await confirm({
          tone: 'warning',
          title: t('admin.growthCodeInUseTitle'),
          body: t('admin.growthCodeInUseBody', { code: promo.code, n: count(promo.used) }),
          confirmLabel: t('admin.growthCodeSwitchOff'),
        });
        if (off) await setActive(promo, false);
        return;
      }
      toast.error(err.message);
    }
  }

  // Given away vs collected, side by side. A discount programme that costs more than it
  // brings in is invisible one row at a time and obvious on these two cards — which is why
  // the "collected" card carries what it cost to collect it rather than standing alone.
  const cost = summary ? share(summary.discountPaise, (summary.revenuePaise || 0) + (summary.discountPaise || 0)) : null;

  return (
    <>
      {!summary ? (
        <SkeletonStats count={4} />
      ) : (
        <PromoSummary summary={summary} cost={cost} />
      )}

      {/* The editor REPLACES the list while it is open, so there is never a question about
          which row is being edited — and no two-panel scroll on a laptop. */}
      {draft ? (
        <PromoEditor
          draft={draft}
          plans={data?.plans || []}
          onChange={setDraft}
          onSave={save}
          onCancel={() => setDraft(null)}
        />
      ) : (
        <div className="data-panel">
          <div className="data-panel-head">
            <span className="data-panel-title">
              {t('admin.growthTab_promos')}
              <span className="count-pill">{count(paged.total)}</span>
            </span>
            <div className="panel-tools">
              <div className="search-box-inline">
                <SearchIcon size={15} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('admin.growthSearchCode')} />
              </div>
              <button
                type="button"
                className="btn btn-primary btn-small btn-inline"
                onClick={() => setDraft({ ...BLANK_PROMO })}
              >
                <PlusIcon size={15} /> {t('admin.growthNewCode')}
              </button>
            </div>
          </div>

          <div className="data-panel-body">
            <p className="section-note">{t('admin.growthCodesHint')}</p>

            {!data ? (
              <SkeletonTable rows={4} cols={7} />
            ) : paged.total === 0 ? (
              <div className="empty-state-rich">
                <div className="empty-icon"><TagIcon size={26} /></div>
                <p>{query ? t('admin.growthNoResults') : t('admin.growthNoCodes')}</p>
                {query ? (
                  <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => setQuery('')}>
                    {t('admin.growthClearFilters')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary btn-small btn-inline"
                    onClick={() => setDraft({ ...BLANK_PROMO })}
                  >
                    <PlusIcon size={15} /> {t('admin.growthNewCode')}
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="table-wrap auto-height">
                <table className="data-table" style={{ minWidth: '860px' }}>
                  <thead>
                    <tr>
                      <th className="sr">{t('common.srNo')}</th>
                      <SortHeader sortKey="code" label={t('admin.growthCode')} sort={sort} onSort={toggle} />
                      <th>{t('admin.growthDiscount')}</th>
                      <SortHeader sortKey="used" label={t('admin.growthUsed')} sort={sort} onSort={toggle} align="right" />
                      <SortHeader sortKey="given" label={t('admin.growthGiven')} sort={sort} onSort={toggle} align="right" />
                      <SortHeader sortKey="earned" label={t('admin.growthEarned')} sort={sort} onSort={toggle} align="right" />
                      <SortHeader sortKey="state" label={t('admin.status')} sort={sort} onSort={toggle} />
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {paged.pageItems.map((promo, index) => (
                      <PromoRow
                        key={promo._id}
                        promo={promo}
                        index={paged.from + index}
                        onEdit={() => setDraft(toPromoDraft(promo))}
                        onToggle={(v) => setActive(promo, v)}
                        onCopy={() => copy(promo)}
                        onWhoUsed={() => setRedemptionsFor(promo)}
                        onDelete={() => remove(promo)}
                      />
                    ))}
                  </tbody>
                </table>
                </div>

                <Pagination
                  compact
                  page={paged.page}
                  pageCount={paged.pageCount}
                  pageSize={paged.pageSize}
                  total={paged.total}
                  from={paged.from}
                  to={paged.to}
                  onPageChange={paged.setPage}
                  onPageSizeChange={paged.setPageSize}
                  label={t('admin.growthTab_promos')}
                />
              </>
            )}
          </div>
        </div>
      )}

      {redemptionsFor && <RedemptionsModal promo={redemptionsFor} onClose={() => setRedemptionsFor(null)} />}
    </>
  );
}

/**
 * What the discount programme cost, and what it brought back.
 *
 * Same shape as the campaign funnel next door, deliberately: an operator who has learned to
 * read one row of steps on the Campaigns tab should not have to learn a second grammar on
 * this one. The counts lead, the money sits after the divider — and the two money figures
 * are side by side because either one alone is a lie. ₹84,697 collected looks like a good
 * quarter until it is read against the ₹38,400 of list price handed over to collect it.
 */
function PromoSummary({ summary, cost }) {
  const { t } = useLanguage();

  return (
    <div className="panel growth-flow-panel">
      <div className="section-title">
        <div className="icon-badge icon-gold"><TagIcon size={16} /></div>
        <h2>{t('admin.growthCodesSummaryTitle')}</h2>
      </div>

      <div className="growth-flow">
        <div className="growth-flow-step">
          <span className="growth-flow-label">
            <TagIcon size={13} /> {t('admin.growthCodesActive')}
          </span>
          <span className="growth-flow-value">
            <AnimatedNumber value={summary.active} decimals={false} />
          </span>
          <FlowBar fill={share(summary.active, summary.total) ?? 0} />
          <span className="growth-flow-note">{t('admin.growthCodesTotalNote', { n: count(summary.total) })}</span>
        </div>

        <div className="growth-flow-step">
          <span className="growth-flow-arrow" aria-hidden="true"><ChevronRightIcon size={15} /></span>
          <span className="growth-flow-label">
            <UsersIcon size={13} /> {t('admin.growthCodesUsed')}
          </span>
          <span className="growth-flow-value">
            <AnimatedNumber value={summary.used} decimals={false} />
          </span>
          <span className="growth-flow-spacer" aria-hidden="true" />
          <span className="growth-flow-note">{t('admin.growthCodesUsedNote')}</span>
        </div>

        <div className="growth-flow-step is-outcome">
          <span className="growth-flow-label">
            <RupeeIcon size={13} /> {t('admin.growthGivenTotal')}
          </span>
          <span className="growth-flow-value">₹{rupees(summary.discountPaise)}</span>
          {/* The share of gross list price that was handed over. This is the number a
              discount programme quietly loses control of. */}
          <FlowBar fill={cost ?? 0} tone="warning" />
          <span className="growth-flow-note">
            {cost === null ? t('admin.growthGivenNote') : t('admin.growthEarnedCostNote', { cost })}
          </span>
        </div>

        <div className="growth-flow-step">
          <span className="growth-flow-label">
            <RupeeIcon size={13} /> {t('admin.growthEarnedTotal')}
          </span>
          <span className="growth-flow-value">₹{rupees(summary.revenuePaise)}</span>
          <span className="growth-flow-spacer" aria-hidden="true" />
          <span className="growth-flow-note">{t('admin.growthEarnedNote')}</span>
        </div>
      </div>
    </div>
  );
}

/** Server shape -> form shape. Dates become what <input type="date"> wants. */
function toPromoDraft(promo) {
  return {
    ...BLANK_PROMO,
    ...promo,
    plans: promo.plans || [],
    cycles: promo.cycles || [],
    startsAt: promo.startsAt ? String(promo.startsAt).slice(0, 10) : '',
    endsAt: promo.endsAt ? String(promo.endsAt).slice(0, 10) : '',
  };
}

function PromoRow({ promo, index, onEdit, onToggle, onCopy, onWhoUsed, onDelete }) {
  const { t } = useLanguage();
  const limits = [];
  if (promo.plans?.length) limits.push(promo.plans.join(', '));
  if (promo.cycles?.length) limits.push(promo.cycles.map((c) => t(`admin.growthCycle_${c}`)).join(', '));
  if (promo.firstPurchaseOnly) limits.push(t('admin.growthFirstOnlyShort'));

  return (
    <tr>
      <td className="sr">{index}</td>
      <td>
        <div className="cell-stack">
          <span className="cell-strong growth-code">{promo.code}</span>
          {(promo.description || limits.length > 0) && (
            <span className="cell-sub">{[promo.description, ...limits].filter(Boolean).join(' · ')}</span>
          )}
        </div>
      </td>
      <td>
        <div className="cell-stack">
          <span>{promo.type === 'percent' ? `${promo.value}%` : `₹${promo.value}`}</span>
          {promo.type === 'percent' && promo.maxDiscountRupees > 0 && (
            <span className="cell-sub">{t('admin.growthCapShort', { max: promo.maxDiscountRupees })}</span>
          )}
        </div>
      </td>
      <td className="num">
        <div className="cell-stack">
          <span>{(promo.used || 0).toLocaleString('en-IN')}</span>
          {promo.maxRedemptions > 0 && <span className="cell-sub">{t('admin.growthOfMax', { max: promo.maxRedemptions })}</span>}
        </div>
      </td>
      {/* What the discounts cost, beside what they brought in. One without the other is how
          a coupon that loses money looks successful. */}
      <td className="num">₹{rupees(promo.discountPaise)}</td>
      <td className="num">₹{rupees(promo.revenuePaise)}</td>
      <td>
        <span className={`badge badge-${PROMO_BADGE[promo.state]}`} data-tip={t(`admin.growthPromoHint_${promo.state}`)}>
          {t(`admin.growthPromoState_${promo.state}`)}
        </span>
      </td>
      <td className="tight">
        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
          <Switch
            id={`promo-${promo._id}`}
            checked={Boolean(promo.active)}
            onChange={onToggle}
            label={t(promo.active ? 'admin.growthCodeSwitchOff' : 'admin.growthCodeSwitchOn')}
          />
          <button type="button" className="icon-btn" onClick={onEdit} data-tip={t('common.edit')} aria-label={t('common.edit')}>
            <EditIcon size={17} />
          </button>
          <RowMenu
            items={[
              { label: t('admin.growthCopyCode'), icon: CopyIcon, onClick: onCopy },
              { label: t('admin.growthWhoUsed'), icon: UsersIcon, onClick: onWhoUsed },
              { label: t('common.delete'), icon: TrashIcon, danger: true, onClick: onDelete },
            ]}
          />
        </div>
      </td>
    </tr>
  );
}

/**
 * "Who actually used this code."
 *
 * The question that gets asked on the phone when a shop says the discount did not apply, and
 * until now the answer lived only in the payments collection. Read off Payment on the server,
 * so it is the money talking and not a counter that can drift.
 */
function RedemptionsModal({ promo, onClose }) {
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch(`/api/admin/growth/promos/${promo._id}/redemptions`)
      .then((res) => setRows(res.redemptions || []))
      .catch((err) => setError(err.message));
  }, [promo._id]);

  return (
    <Modal onClose={onClose} title={t('admin.growthRedemptionsTitle', { code: promo.code })} maxWidth="640px">
      {error && <div className="error-banner">{error}</div>}
      {!rows && !error ? (
        <SkeletonTable rows={4} cols={4} />
      ) : rows && rows.length === 0 ? (
        <div className="empty-state"><p>{t('admin.growthNoRedemptions')}</p></div>
      ) : (
        rows && (
          <div className="table-wrap auto-height">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('admin.growthRedemptionShop')}</th>
                <th>{t('admin.growthRedemptionPlan')}</th>
                <th className="num">{t('admin.growthRedemptionSaved')}</th>
                <th className="num">{t('admin.growthRedemptionPaid')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row._id}>
                  <td>
                    <div className="cell-stack">
                      <span className="cell-strong">{row.shopName || '—'}</span>
                      <span className="cell-sub">{formatDate(row.at, lang)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack">
                      <span>{row.plan}</span>
                      <span className="cell-sub">{t(`admin.growthCycle_${row.cycle}`)}</span>
                    </div>
                  </td>
                  <td className="num">₹{rupees(row.discountPaise)}</td>
                  <td className="num">₹{rupees(row.amountPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )
      )}
    </Modal>
  );
}

/**
 * The discount-code form.
 *
 * A panel rather than a modal: it has fourteen fields and a modal that tall on a laptop ends
 * up scrolling inside itself with the Save button below the fold. It replaces the table while
 * it is open, so there is never a question about which row is being edited.
 *
 * The sentence at the top is the part that matters. Fourteen fields can add up to a code that
 * does something quite different from what the operator meant — "20% off, but only the first
 * ₹200, only on Premium yearly, only for shops that have never paid, 100 uses in all" is four
 * screens' worth of switches and one line of English. Reading it back before saving is the
 * cheapest way to catch a mis-set cap.
 */
function PromoEditor({ draft, plans, onChange, onSave, onCancel }) {
  const { t } = useLanguage();
  const set = (key, value) => onChange({ ...draft, [key]: value });

  const problems = [];
  if (!draft._id && !/^[A-Z0-9-]{3,24}$/.test(draft.code || '')) problems.push(t('admin.growthCodeRule'));
  if (draft.type === 'percent' && (!(draft.value > 0) || draft.value > 100)) problems.push(t('admin.growthPercentRule'));
  if (draft.type === 'flat' && !(draft.value > 0)) problems.push(t('admin.growthFlatRule'));
  if (draft.startsAt && draft.endsAt && draft.endsAt <= draft.startsAt) problems.push(t('admin.growthDateRule'));

  const sentence = t('admin.growthCodeSentence', {
    off: draft.type === 'percent' ? `${draft.value || 0}%` : `₹${draft.value || 0}`,
    plans: draft.plans?.length ? draft.plans.join(', ') : t('admin.growthCodeAllPlans'),
    cycles: draft.cycles?.length
      ? draft.cycles.map((c) => t(`admin.growthCycle_${c}`)).join(' + ')
      : t('admin.growthCodeAllCycles'),
    uses: draft.maxRedemptions > 0 ? t('admin.growthUsesCapped', { n: draft.maxRedemptions }) : t('admin.growthUsesUnlimited'),
  });

  return (
    <div className="panel">
      <div className="section-title">
        <div className="icon-badge icon-gold"><TagIcon size={16} /></div>
        <h2>{draft._id ? t('admin.growthEditCode') : t('admin.growthNewCode')}</h2>
      </div>

      <p className="growth-code-sentence">
        <SparkleIcon size={14} />
        <span>
          {[
            sentence,
            draft.type === 'percent' && draft.maxDiscountRupees > 0
              ? t('admin.growthCapSentence', { max: draft.maxDiscountRupees })
              : '',
            draft.firstPurchaseOnly ? t('admin.growthFirstSentence') : '',
          ]
            .filter(Boolean)
            .join(' ')}
        </span>
      </p>

      <div className="form-grid cols-2">
        <div className="field">
          <label htmlFor="p-code">{t('admin.growthCode')}</label>
          <input
            id="p-code"
            value={draft.code}
            // Immutable once saved — it is already printed on a flyer or sitting inside a
            // campaign, and renaming it would break every place it was handed out.
            disabled={Boolean(draft._id)}
            onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
            placeholder="DIWALI30"
            maxLength={24}
          />
          <span className="field-hint">{draft._id ? t('admin.growthCodeLocked') : t('admin.growthCodeRule')}</span>
        </div>
        <div className="field">
          <label htmlFor="p-desc">{t('admin.growthCodeNote')}</label>
          <input id="p-desc" value={draft.description || ''} onChange={(e) => set('description', e.target.value)} />
          <span className="field-hint">{t('admin.growthCodeNoteHint')}</span>
        </div>

        <div className="field">
          <label htmlFor="p-type">{t('admin.growthDiscountType')}</label>
          <Dropdown
            id="p-type"
            value={draft.type}
            onChange={(v) => set('type', v)}
            options={[
              { value: 'percent', label: t('admin.growthPercent') },
              { value: 'flat', label: t('admin.growthFlat') },
            ]}
          />
        </div>
        <div className="field">
          <label htmlFor="p-value">{draft.type === 'percent' ? t('admin.growthPercentOff') : t('admin.growthRupeesOff')}</label>
          <input id="p-value" type="number" min="1" value={draft.value} onChange={(e) => set('value', Number(e.target.value))} />
        </div>
        {draft.type === 'percent' && (
          <div className="field">
            <label htmlFor="p-cap">{t('admin.growthMaxDiscount')}</label>
            <input
              id="p-cap"
              type="number"
              min="0"
              value={draft.maxDiscountRupees || 0}
              onChange={(e) => set('maxDiscountRupees', Number(e.target.value))}
            />
            <span className="field-hint">{t('admin.growthMaxDiscountHint')}</span>
          </div>
        )}
        <div className="field">
          <label htmlFor="p-uses">{t('admin.growthMaxUses')}</label>
          <input
            id="p-uses"
            type="number"
            min="0"
            value={draft.maxRedemptions || 0}
            onChange={(e) => set('maxRedemptions', Number(e.target.value))}
          />
          <span className="field-hint">{t('admin.growthZeroUnlimited')}</span>
        </div>
        <div className="field">
          <label htmlFor="p-pershop">{t('admin.growthPerShop')}</label>
          <input
            id="p-pershop"
            type="number"
            min="0"
            value={draft.perShopLimit ?? 1}
            onChange={(e) => set('perShopLimit', Number(e.target.value))}
          />
          <span className="field-hint">{t('admin.growthPerShopHint')}</span>
        </div>
        <div className="field">
          <label htmlFor="p-start">{t('admin.growthStarts')}</label>
          <input id="p-start" type="date" value={draft.startsAt || ''} onChange={(e) => set('startsAt', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="p-end">{t('admin.growthEnds')}</label>
          <input id="p-end" type="date" value={draft.endsAt || ''} onChange={(e) => set('endsAt', e.target.value)} />
        </div>
      </div>

      {/* Both of these were in the database and on the checkout path from the day the code
          model was written, and neither had a control here — so every code the operator made
          was silently valid on every plan and every cycle, which is exactly the mistake a
          "30% off Premium yearly" campaign cannot afford. */}
      <div className="form-subhead">{t('admin.growthCodeOnPlans')}</div>
      <ChipSelect
        options={plans.map((plan) => ({ value: plan.id, label: plan.name }))}
        value={draft.plans}
        onChange={(v) => set('plans', v)}
        empty={t('admin.growthCodeAllPlans')}
      />

      <div className="form-subhead">{t('admin.growthCodeCycles')}</div>
      <ChipSelect
        options={[
          { value: 'monthly', label: t('admin.growthCycle_monthly') },
          { value: 'yearly', label: t('admin.growthCycle_yearly') },
        ]}
        value={draft.cycles}
        onChange={(v) => set('cycles', v)}
        empty={t('admin.growthCodeAllCycles')}
      />

      <div className="checkbox-row" style={{ marginTop: '1rem' }}>
        <Switch
          id="p-first"
          checked={Boolean(draft.firstPurchaseOnly)}
          onChange={(v) => set('firstPurchaseOnly', v)}
          label={t('admin.growthFirstOnly')}
        />
        <label htmlFor="p-first">{t('admin.growthFirstOnly')}</label>
      </div>
      <div className="checkbox-row">
        <Switch id="p-active" checked={draft.active !== false} onChange={(v) => set('active', v)} label={t('admin.growthCodeActive')} />
        <label htmlFor="p-active">{t('admin.growthCodeActive')}</label>
      </div>

      {problems.length > 0 && (
        <div className="platform-banner warning" style={{ marginTop: '0.9rem' }}>
          <AlertIcon size={15} />
          <span>{problems[0]}</span>
        </div>
      )}

      <div className="row-actions">
        <button type="button" className="btn btn-secondary btn-inline" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn-primary btn-inline" disabled={problems.length > 0} onClick={onSave}>
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

/* ============================================================================== rules */

/**
 * The ceilings, and the two switches that can silence the whole engine.
 *
 * On a floating save bar rather than a button at the bottom, for the same reason Settings is:
 * these are five toggles and two numbers spread over two panels, and the operator who flips
 * the first one has no reason to scroll to the end. The bar also names what changed, which on
 * this screen is the difference between "saved" and "I have just switched off every campaign
 * on the platform".
 */
function RulesTab({ rules, setRules, onSaved }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [baseline, setBaseline] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (rules?.growth && !baseline) setBaseline(rules.growth);
  }, [rules, baseline]);

  const growth = rules?.growth;

  const hourOptions = useMemo(
    () => Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` })),
    []
  );

  const changes = useMemo(() => {
    if (!baseline || !growth) return [];
    const onOff = (v) => (v ? t('seller.changeOn') : t('seller.changeOff'));
    const rows = [];
    const bool = (path, label) => {
      if (Boolean(baseline[path]) !== Boolean(growth[path])) {
        rows.push({ path, label: t(label), from: onOff(baseline[path]), to: onOff(growth[path]) });
      }
    };
    bool('campaignsEnabled', 'admin.growthOnOff');
    bool('adsEnabled', 'admin.growthAdsOnOff');
    bool('upsellOnLock', 'admin.growthUpsellOnLock');
    bool('showLockedNav', 'admin.growthShowLockedNav');
    if (baseline.maxNudgesPerDayPerShop !== growth.maxNudgesPerDayPerShop) {
      rows.push({
        path: 'maxNudgesPerDayPerShop',
        label: t('admin.growthMaxPerDay'),
        from: String(baseline.maxNudgesPerDayPerShop),
        to: String(growth.maxNudgesPerDayPerShop),
      });
    }
    const window = (q) => `${String(q.start).padStart(2, '0')}:00 – ${String(q.end).padStart(2, '0')}:00`;
    if (baseline.quietHours?.start !== growth.quietHours?.start || baseline.quietHours?.end !== growth.quietHours?.end) {
      rows.push({
        path: 'quietHours',
        label: t('admin.growthQuietHours'),
        from: window(baseline.quietHours || { start: 0, end: 0 }),
        to: window(growth.quietHours || { start: 0, end: 0 }),
      });
    }
    return rows;
  }, [baseline, growth, t]);

  function patch(key, value) {
    setRules((prev) => ({ ...prev, growth: { ...prev.growth, [key]: value } }));
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/api/admin/growth/rules', {
        method: 'PATCH',
        body: JSON.stringify({ growth }),
      });
      setRules((prev) => ({ ...prev, growth: res.growth }));
      setBaseline(res.growth);
      setSavedAt(Date.now());
      toast.success(t('admin.settingsSaved'));
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!growth) return <SkeletonStats count={2} />;

  return (
    <>
      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-brand"><SlidersIcon size={16} /></div>
          <h2>{t('admin.growthRulesTitle')}</h2>
        </div>
        <p className="section-note">{t('admin.growthRulesHint')}</p>

        {/* The two master switches, marked as such. They are not one toggle among five —
            either of them takes every campaign on the platform off the air. */}
        <div className="growth-rule">
          <div className="growth-rule-copy">
            <strong>{t('admin.growthOnOff')}</strong>
            <span>{t('admin.growthOnOffHint')}</span>
          </div>
          <Switch id="g-campaigns" checked={growth.campaignsEnabled} onChange={(v) => patch('campaignsEnabled', v)} label={t('admin.growthOnOff')} />
        </div>
        <div className="growth-rule">
          <div className="growth-rule-copy">
            <strong>{t('admin.growthAdsOnOff')}</strong>
            <span>{t('admin.growthAdsOnOffHint')}</span>
          </div>
          <Switch id="g-ads" checked={growth.adsEnabled} onChange={(v) => patch('adsEnabled', v)} label={t('admin.growthAdsOnOff')} />
        </div>
        <div className="growth-rule">
          <div className="growth-rule-copy">
            <strong>{t('admin.growthUpsellOnLock')}</strong>
            <span>{t('admin.growthUpsellOnLockHint')}</span>
          </div>
          <Switch id="g-upsell" checked={growth.upsellOnLock} onChange={(v) => patch('upsellOnLock', v)} label={t('admin.growthUpsellOnLock')} />
        </div>
        <div className="growth-rule">
          <div className="growth-rule-copy">
            <strong>{t('admin.growthShowLockedNav')}</strong>
            <span>{t('admin.growthShowLockedNavHint')}</span>
          </div>
          <Switch id="g-lockednav" checked={growth.showLockedNav} onChange={(v) => patch('showLockedNav', v)} label={t('admin.growthShowLockedNav')} />
        </div>
      </div>

      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-gold"><AlertIcon size={16} /></div>
          <h2>{t('admin.growthLimitsTitle')}</h2>
        </div>
        <p className="section-note">{t('admin.growthLimitsHint')}</p>
        <div className="form-grid cols-2">
          <div className="field">
            <label htmlFor="g-max">{t('admin.growthMaxPerDay')}</label>
            <input
              id="g-max"
              type="number"
              min="0"
              max="20"
              value={growth.maxNudgesPerDayPerShop}
              onChange={(e) => patch('maxNudgesPerDayPerShop', Number(e.target.value))}
            />
            <span className="field-hint">{t('admin.growthMaxPerDayHint')}</span>
          </div>
          <div className="field">
            <label>{t('admin.growthQuietHours')}</label>
            <div className="input-action">
              <Dropdown
                value={String(growth.quietHours.start)}
                onChange={(v) => patch('quietHours', { ...growth.quietHours, start: Number(v) })}
                options={hourOptions}
              />
              <Dropdown
                value={String(growth.quietHours.end)}
                onChange={(v) => patch('quietHours', { ...growth.quietHours, end: Number(v) })}
                options={hourOptions}
              />
            </div>
            <span className="field-hint">
              {growth.quietHours.start === growth.quietHours.end
                ? t('admin.growthQuietOff')
                : t('admin.growthQuietHoursHint')}
            </span>
          </div>
        </div>
      </div>

      <SaveBar
        rows={changes}
        saving={saving}
        error={error}
        savedAt={savedAt}
        onSave={save}
        onDiscard={() => setRules((prev) => ({ ...prev, growth: baseline }))}
      />
    </>
  );
}
