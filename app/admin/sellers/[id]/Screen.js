'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRouteId } from '../../../../lib/routeId';
import { apiFetch, downloadFile } from '../../../../lib/api';
import { formatDate, formatMoney } from '../../../../lib/format';
import { groupIcon } from '../../../../lib/moduleGroups';
import { useLanguage } from '../../../components/LanguageProvider';
import { useToast } from '../../../components/Toast';
import { TriToggle } from '../../../components/Switch';
import AnimatedNumber from '../../../components/AnimatedNumber';
import { SkeletonStats } from '../../../components/Skeleton';
import Dropdown from '../../../components/Dropdown';
import AuditTimeline from '../../../components/AuditTimeline';
import {
  AlertIcon,
  CopyIcon,
  ReceiptIcon,
  PackageIcon,
  LedgerIcon,
  OrdersIcon,
  UsersIcon,
  RupeeIcon,
  TrendUpIcon,
  ZapIcon,
  CheckIcon,
  KeyIcon,
  MailIcon,
  TrashIcon,
  LogOutIcon,
  XIcon,
  ClockIcon,
  CalendarIcon,
  CreditCardIcon,
  ExcelIcon,
  StoreIcon,
  TruckIcon,
  HeadsetIcon,
} from '../../../components/Icons';

const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';

const PLAN_OPTIONS = [
  { value: 'free', label: 'Free' },
  { value: 'pro', label: 'Pro' },
  { value: 'premium', label: 'Premium' },
  { value: 'enterprise', label: 'Enterprise' },
];

const PROFILE_FIELDS = ['shopName', 'name', 'email', 'shopAddress'];

/**
 * How each kind of term reads on the timeline.
 *
 * Money and favours are deliberately coloured apart — a purchase is green, a grant is the
 * neutral "pending" amber — because the single most misleading thing this screen could do
 * is let four free upgrades look like four sales at a glance. Same rule the revenue screen
 * follows.
 */
const TERM_SOURCES = {
  'signup-trial': { label: 'Signup trial', cls: 'badge-inactive' },
  'admin-trial': { label: 'Trial extended', cls: 'badge-inactive' },
  purchase: { label: 'Bought', cls: 'badge-approved' },
  renewal: { label: 'Renewed', cls: 'badge-approved' },
  'admin-grant': { label: 'Granted free', cls: 'badge-pending' },
  'admin-downgrade': { label: 'Downgraded', cls: 'badge-rejected' },
  import: { label: 'Older record', cls: 'badge-inactive' },
};

const TERM_STATUS = {
  active: { label: 'Running', cls: 'badge-approved' },
  lapsed: { label: 'Expired', cls: 'badge-rejected' },
  ended: { label: 'Ended', cls: 'badge-inactive' },
};

const END_REASONS = {
  upgraded: 'upgraded',
  downgraded: 'downgraded',
  renewed: 'renewed',
  replaced: 'changed',
  'account-closed': 'account closed',
};

// Maps the backend's module state to the badge shown next to each row.
function stateBadge(state, t) {
  switch (state.state) {
    case 'off_platform':
      return { cls: 'badge-rejected', text: t('admin.moduleOffPlatform') };
    case 'off_shop':
      return { cls: 'badge-rejected', text: t('admin.moduleOffShop') };
    case 'locked_plan':
      return { cls: 'badge-pending', text: t('admin.moduleLockedPlan') };
    default:
      return state.forced
        ? { cls: 'badge-active', text: t('admin.moduleForcedOn') }
        : { cls: 'badge-approved', text: t('admin.moduleOn') };
  }
}

export default function AdminShopDetailPage() {
  const id = useRouteId();
  const router = useRouter();
  const { t, lang } = useLanguage();
  const toast = useToast();

  const [data, setData] = useState(null);
  const [subs, setSubs] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [profile, setProfile] = useState({});
  const [planDraft, setPlanDraft] = useState('free');
  const [trialDays, setTrialDays] = useState('');
  const [planDays, setPlanDays] = useState('');
  const [planNote, setPlanNote] = useState('');
  const [password, setPassword] = useState('');
  const [suspendReason, setSuspendReason] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [copied, setCopied] = useState(false);
  // One free-text "custom quantity" box per meter row, keyed by metric — see grantUsage().
  const [customUsage, setCustomUsage] = useState({});

  function load() {
    apiFetch(`/api/admin/shops/${id}`)
      .then((res) => {
        setData(res);
        setProfile(
          PROFILE_FIELDS.concat('adminNote').reduce(
            (acc, field) => ({ ...acc, [field]: res.shop[field] || '' }),
            {}
          )
        );
        setPlanDraft(res.shop.plan || 'free');
        setSuspendReason(res.shop.suspendedReason || '');
      })
      .catch((err) => setError(err.message));

    // Its own request rather than more fields on the detail payload: the timeline is
    // hundreds of rows for a long-lived shop and every other panel on this page would wait
    // behind it. A failure here leaves the rest of the screen working — a history panel
    // that did not load must never be the reason support cannot reset a password.
    apiFetch(`/api/admin/shops/${id}/subscription`)
      .then(setSubs)
      .catch(() => setSubs(null));
  }

  useEffect(load, [id]);

  const grouped = useMemo(() => {
    if (!data) return [];
    return data.groups
      .map((group) => ({
        ...group,
        modules: Object.values(data.registry).filter((mod) => mod.group === group.key),
      }))
      .filter((group) => group.modules.length > 0);
  }, [data]);

  async function act(key, request, successMessage) {
    setBusy(key);
    try {
      const result = await request();
      if (successMessage) toast.success(successMessage);
      return result;
    } catch (err) {
      toast.error(err.message);
      return null;
    } finally {
      setBusy('');
    }
  }

  async function setModule(moduleKey, value) {
    const result = await act(
      `mod-${moduleKey}`,
      () =>
        apiFetch(`/api/admin/shops/${id}/modules`, {
          method: 'PATCH',
          body: JSON.stringify({ modules: { [moduleKey]: value } }),
        }),
      t('admin.modulesSaved')
    );
    if (result) setData((prev) => ({ ...prev, shop: result.user, modules: result.modules }));
  }

  async function clearOverrides() {
    const result = await act(
      'clear',
      () => apiFetch(`/api/admin/shops/${id}/modules`, { method: 'DELETE' }),
      t('admin.overridesCleared')
    );
    if (result) setData((prev) => ({ ...prev, shop: result.user, modules: result.modules }));
  }

  // Extra AI scans/SMS/WhatsApp for THIS period only — see grantUsageBonus() in
  // adminController.js. `amount` is a preset (10/50/100) or whatever the operator typed
  // into the custom box next to it.
  async function grantUsage(metric, amount) {
    const units = Number(amount);
    if (!Number.isFinite(units) || units <= 0) return;
    const result = await act(
      `usage-${metric}`,
      () =>
        apiFetch(`/api/admin/shops/${id}/usage/grant`, {
          method: 'POST',
          body: JSON.stringify({ metric, amount: units }),
        }),
      t('admin.usageGranted', { n: units })
    );
    if (result) {
      setData((prev) => ({
        ...prev,
        meters: prev.meters.map((m) => (m.metric === metric ? { ...m, bonus: result.bonus, limit: (m.limit ?? 0) - (m.bonus || 0) + result.bonus } : m)),
      }));
    }
  }

  async function saveProfile() {
    const result = await act(
      'profile',
      () => apiFetch(`/api/admin/shops/${id}`, { method: 'PATCH', body: JSON.stringify(profile) }),
      t('admin.profileSaved')
    );
    if (result) setData((prev) => ({ ...prev, shop: result.user }));
  }

  async function applyPlan() {
    const result = await act(
      'plan',
      () =>
        apiFetch(`/api/admin/shops/${id}/plan`, {
          method: 'PATCH',
          body: JSON.stringify({
            plan: planDraft,
            trialDays: trialDays === '' ? undefined : Number(trialDays),
            planDays: planDays === '' ? undefined : Number(planDays),
            note: planNote || undefined,
          }),
        }),
      t('admin.planUpdated')
    );
    if (result) {
      // Said out loud rather than done quietly. The shop was carrying an expiry date that
      // had already passed, which would have made this grant do nothing at all — the
      // operator needs to know their action was repaired, not just that it "worked".
      if (result.clearedStaleExpiry) {
        toast.success('Removed an expiry date that had already passed, so the plan actually applies.');
      }
      setTrialDays('');
      setPlanDays('');
      setPlanNote('');
      load();
    }
  }

  async function exportHistory() {
    await act('history', () =>
      downloadFile(
        `/api/admin/shops/${id}/subscription?format=xlsx`,
        `subscription-${data?.shop?.shopSlug || id}.xlsx`
      )
    );
  }

  async function setActive(isActive) {
    const result = await act(
      'active',
      () =>
        apiFetch(`/api/admin/users/${id}/active`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive, reason: suspendReason }),
        }),
      isActive ? t('admin.activate') : t('admin.deactivate')
    );
    if (result) setData((prev) => ({ ...prev, shop: result.user }));
  }

  /**
   * What support should try first for a shopkeeper who cannot get in.
   *
   * The token goes to his mailbox and he picks his own password there, so nobody at this
   * end ever holds a working credential for his shop — which matters because a seller
   * session plus a known password is enough to move his payout UPI ID. The manual reset
   * below stays for the case this cannot fix: he no longer has the mailbox at all.
   *
   * If the address on file is the wrong one, the fix is the Email field in the profile
   * panel above — correct it, save, then send from here.
   */
  async function sendResetLink() {
    const result = await act(
      'resetLink',
      () => apiFetch(`/api/admin/shops/${id}/reset-link`, { method: 'POST' }),
      null
    );
    if (result) toast.success(t('admin.resetLinkSent', { email: result.email }));
  }

  async function resetPassword() {
    const result = await act(
      'password',
      () => apiFetch(`/api/admin/users/${id}/password`, { method: 'POST', body: JSON.stringify({ password }) }),
      t('admin.passwordReset')
    );
    if (result) setPassword('');
  }

  async function impersonate() {
    const result = await act('impersonate', () =>
      apiFetch(`/api/admin/shops/${id}/impersonate`, { method: 'POST' })
    );
    if (result) {
      // No tokens change hands here any more. The server parks the admin's own session in
      // a second httpOnly cookie and swaps the main one for the shop's — the browser is
      // simply the shop from the next request onward. Previously both tokens were handed
      // to this page and kept in localStorage, which put a superadmin credential in
      // script-readable storage for the whole support session.
      router.push('/seller');
      router.refresh();
    }
  }

  function copyLink() {
    if (!shop.shopSlug) return;
    navigator.clipboard.writeText(`${FRONTEND_URL}/c/${shop.shopSlug}/catalog`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function removeShop() {
    const result = await act(
      'delete',
      () => apiFetch(`/api/admin/shops/${id}`, { method: 'DELETE', body: JSON.stringify({ confirm: deleteConfirm }) }),
      t('admin.deleted')
    );
    if (result) router.push('/admin/sellers');
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!data) {
    return (
      <>
        <SkeletonStats count={6} />
      </>
    );
  }

  const { shop, usage } = data;

  return (
    <>
      <div className="content-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0 }}>{shop.shopName || shop.name}</h1>
          {shop.shopSlug && (
            <button type="button" className={`copy-btn${copied ? ' copied' : ''}`} onClick={copyLink}>
              <CopyIcon size={17} /> {copied ? t('admin.linkCopied') : t('admin.copyLink')}
            </button>
          )}
          {/* This page holds every LEVER; the support view holds the diagnosis that says
              which one to pull. Somebody who arrives here mid-call and cannot see what is
              actually broken is one click from the screen that says so. */}
          <Link href={`/admin/support?shop=${shop.id}`} className="btn btn-secondary btn-small">
            <HeadsetIcon size={15} /> Support view
          </Link>
        </div>
        <p>
          {shop.email} · <span className={`badge badge-${shop.shopStatus}`}>{shop.shopStatus}</span>{' '}
          <span className={`badge badge-${shop.isActive ? 'active' : 'inactive'}`}>
            {shop.isActive ? 'active' : t('admin.suspended')}
          </span>{' '}
          <span className="badge badge-safe">{data.plan}</span>
        </p>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-card-top"><div className="stat-card-icon icon-brand"><ReceiptIcon size={17} /></div></div>
          <div className="stat-value"><AnimatedNumber value={usage.bills} decimals={false} /></div>
          <div className="stat-label">{t('admin.stats.billCount')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top"><div className="stat-card-icon icon-muted"><PackageIcon size={17} /></div></div>
          <div className="stat-value"><AnimatedNumber value={usage.products} decimals={false} /></div>
          <div className="stat-label">{t('admin.stats.productCount')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top"><div className="stat-card-icon icon-gold"><LedgerIcon size={17} /></div></div>
          <div className="stat-value"><AnimatedNumber value={usage.customers} decimals={false} /></div>
          <div className="stat-label">{t('admin.stats.customerCount')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top"><div className="stat-card-icon icon-brand"><OrdersIcon size={17} /></div></div>
          <div className="stat-value"><AnimatedNumber value={usage.orders} decimals={false} /></div>
          <div className="stat-label">{t('admin.stats.orderCount')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top"><div className="stat-card-icon icon-muted"><UsersIcon size={17} /></div></div>
          <div className="stat-value"><AnimatedNumber value={usage.staff} decimals={false} /></div>
          <div className="stat-label">{t('admin.stats.staffCount')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top"><div className="stat-card-icon icon-success"><RupeeIcon size={17} /></div></div>
          <div className="stat-value">₹<AnimatedNumber value={usage.gmv} /></div>
          <div className="stat-label">{t('admin.stats.gmv')}</div>
        </div>
      </div>

      {/* "Ab tak kitni baar plan liya, konsa tha, kab khatam hua." Three questions this
          screen could not answer at all, because the plan fields on the shop document are
          overwritten in place every time anything changes them. See models/PlanTerm.js. */}
      <section className="panel" aria-labelledby="subscription-title">
        <div className="panel-head">
          <div className="section-title">
            <div className="icon-badge icon-brand"><ClockIcon size={16} /></div>
            <h2 id="subscription-title">Plan history</h2>
          </div>
          <div className="panel-tools">
            <button
              type="button"
              className="btn btn-secondary btn-small"
              disabled={busy === 'history' || !subs?.terms?.length}
              onClick={exportHistory}
            >
              <ExcelIcon size={17} /> {t('admin.exportXlsx')}
            </button>
          </div>
        </div>

        {!subs ? (
          <SkeletonStats count={4} />
        ) : (
          <>
            <div className="stat-grid" style={{ marginTop: '0.4rem' }}>
              <div className="stat-card">
                <div className="stat-card-top"><div className="stat-card-icon icon-success"><CreditCardIcon size={17} /></div></div>
                <div className="stat-value"><AnimatedNumber value={subs.summary.paidTerms} decimals={false} /></div>
                <div className="stat-label">Times they paid</div>
                {/* Granted plans counted apart and never folded in. A shop an admin put on
                    Premium four times has not bought anything. */}
                {subs.summary.grantedTerms > 0 && (
                  <div className="stat-note">+ {subs.summary.grantedTerms} granted free</div>
                )}
              </div>
              <div className="stat-card">
                <div className="stat-card-top"><div className="stat-card-icon icon-gold"><RupeeIcon size={17} /></div></div>
                <div className="stat-value">₹<AnimatedNumber value={subs.summary.lifetimeValue} /></div>
                <div className="stat-label">Lifetime value</div>
                {subs.summary.lifetimeDiscount > 0 && (
                  <div className="stat-note">₹{formatMoney(subs.summary.lifetimeDiscount, lang, { decimals: false })} given as discount</div>
                )}
              </div>
              <div className="stat-card">
                <div className="stat-card-top"><div className="stat-card-icon icon-brand"><CalendarIcon size={17} /></div></div>
                <div className="stat-value"><AnimatedNumber value={subs.summary.daysOnPaid} decimals={false} /></div>
                <div className="stat-label">Days on a paid plan</div>
                {subs.summary.lapses > 0 && (
                  <div className="stat-note">Lapsed {subs.summary.lapses} time{subs.summary.lapses > 1 ? 's' : ''}</div>
                )}
              </div>
              <div className="stat-card">
                <div className="stat-card-top"><div className="stat-card-icon icon-muted"><ReceiptIcon size={17} /></div></div>
                <div className="stat-value"><AnimatedNumber value={subs.summary.attempts} decimals={false} /></div>
                <div className="stat-label">Checkout attempts</div>
                {/* The other half of "paisa kat gaya" — orders that opened and never
                    completed. Silent until there are some. */}
                {subs.summary.attempts > subs.summary.paidCount && (
                  <div className="stat-note">
                    {subs.summary.failedCount} failed · {subs.summary.abandonedCount} not finished
                  </div>
                )}
              </div>
            </div>

            {/* Where the shop stands today, in one sentence, so nobody has to read a
                timeline to answer the question the phone call actually opened with. */}
            <div className="breakdown-list" style={{ marginTop: '1rem' }}>
              <div className="breakdown-row">
                <span className="breakdown-name">Right now</span>
                <span className={`badge badge-${data.plan === 'free' ? 'inactive' : 'approved'}`}>{data.plan}</span>
                {shop.planExpiresAt ? (
                  <span className="cell-sub">
                    {new Date(shop.planExpiresAt) < new Date()
                      ? `Expired on ${formatDate(shop.planExpiresAt, lang)}`
                      : `Runs till ${formatDate(shop.planExpiresAt, lang)}`}
                  </span>
                ) : shop.plan !== 'free' ? (
                  <span className="cell-sub">No end date — granted, not bought</span>
                ) : shop.trialEndsAt && new Date(shop.trialEndsAt) > new Date() ? (
                  <span className="cell-sub">Trial till {formatDate(shop.trialEndsAt, lang)}</span>
                ) : (
                  <span className="cell-sub">Free plan</span>
                )}
              </div>
              {subs.summary.lastPaidAt && (
                <div className="breakdown-row">
                  <span className="breakdown-name">Last payment</span>
                  <span className="cell-sub">
                    {formatDate(subs.summary.lastPaidAt, lang)} · {subs.summary.daysSinceLastPayment} days ago
                  </span>
                </div>
              )}
              {!subs.summary.hasEverPaid && (
                <div className="breakdown-row">
                  <span className="breakdown-name">Never paid</span>
                  <span className="badge badge-pending">No completed payment on record</span>
                </div>
              )}
            </div>

            {subs.terms.length === 0 ? (
              <p className="empty-state">
                No plan history recorded for this dukaan yet. Shops that predate this ledger need
                <code> npm run backfill:planhistory</code> run once.
              </p>
            ) : (
              <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>From</th>
                      <th>Till</th>
                      <th>Plan</th>
                      <th>How</th>
                      <th className="num">Days</th>
                      <th className="num">Paid</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subs.terms.map((term) => {
                      const source = TERM_SOURCES[term.source] || { label: term.source, cls: 'badge-inactive' };
                      const status = TERM_STATUS[term.status] || TERM_STATUS.ended;
                      return (
                        <tr key={term.id}>
                          <td className="cell-sub">{formatDate(term.startedAt, lang)}</td>
                          <td className="cell-sub">
                            {term.endsAt ? formatDate(term.endsAt, lang) : '—'}
                            {term.endedAt && (
                              <div className="cell-sub">
                                {END_REASONS[term.endedReason] || 'changed'} {formatDate(term.endedAt, lang)}
                              </div>
                            )}
                          </td>
                          <td>
                            {term.plan}
                            {term.previousPlan && term.previousPlan !== term.plan && (
                              <div className="cell-sub">from {term.previousPlan}</div>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${source.cls}`}>{source.label}</span>
                            {term.actorName && <div className="cell-sub">by {term.actorName}</div>}
                            {term.note && <div className="cell-sub">{term.note}</div>}
                          </td>
                          <td className="num tabular">{term.days}</td>
                          <td className="num tabular">
                            {term.amount > 0 ? `₹${term.amount}` : '—'}
                            {term.discount > 0 && <div className="cell-sub">−₹{term.discount}</div>}
                          </td>
                          <td><span className={`badge ${status.cls}`}>{status.label}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* "Iske paas kitne log hain." The size of the business behind the account, which is
          what makes a suspension, a grant or an outage read as small or serious. */}
      <section className="panel" aria-labelledby="people-title">
        <div className="section-title">
          <div className="icon-badge icon-gold"><UsersIcon size={16} /></div>
          <h2 id="people-title">Who this dukaan carries</h2>
        </div>
        <p className="section-note">
          Customers on its books, people behind its counter, and how much of it is actually live.
        </p>
        <div className="stat-grid" style={{ marginTop: '1rem' }}>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-gold"><LedgerIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={data.people?.customers || 0} decimals={false} /></div>
            <div className="stat-label">Customers on the books</div>
            {data.people?.customersWithDue > 0 && (
              <div className="stat-note">{data.people.customersWithDue} owe money</div>
            )}
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-success"><ReceiptIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={data.people?.customersServed90d || 0} decimals={false} /></div>
            <div className="stat-label">Served in 90 days</div>
            {/* The number that separates a live shop from a long list of old names. */}
            <div className="stat-note">Billed at least once</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-brand"><OrdersIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={data.people?.customersSelfRegistered || 0} decimals={false} /></div>
            <div className="stat-label">Signed up themselves</div>
            <div className="stat-note">Came in through the storefront link</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-muted"><UsersIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={data.people?.staffActive || 0} decimals={false} /></div>
            <div className="stat-label">Counter staff</div>
            {data.people?.staff > data.people?.staffActive && (
              <div className="stat-note">{data.people.staff - data.people.staffActive} suspended</div>
            )}
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-brand"><StoreIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={data.people?.stores || 0} decimals={false} /></div>
            <div className="stat-label">Stores</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-muted"><TruckIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={data.people?.suppliers || 0} decimals={false} /></div>
            <div className="stat-label">Suppliers</div>
          </div>
        </div>
      </section>

      {/* The two things a support call is actually about — "mera plan kyun nahi chala" and
          "AI scan band kyun ho gaya" — neither of which this screen could answer before.
          Both are hidden when there is nothing to show, so a plain free shop's page stays
          as short as it was. */}
      <section className="panel" aria-labelledby="accounting-snapshot-title">
        <div className="section-title">
          <div className="icon-badge icon-success"><RupeeIcon size={16} /></div>
          <h2 id="accounting-snapshot-title">Accounting snapshot</h2>
        </div>
        <p className="section-note">Current month at a glance. Sales and other income are separate from business expenses.</p>
        <div className="stat-grid" style={{ marginTop: '1rem' }}>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-success"><ReceiptIcon size={17} /></div></div>
            <div className="stat-value">₹<AnimatedNumber value={data.financial?.salesThisMonth || 0} /></div>
            <div className="stat-label">Sales this month</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-danger"><RupeeIcon size={17} /></div></div>
            <div className="stat-value">₹<AnimatedNumber value={data.financial?.expensesThisMonth || 0} /></div>
            <div className="stat-label">Expenses this month</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-brand"><TrendUpIcon size={17} /></div></div>
            <div className="stat-value">₹<AnimatedNumber value={data.financial?.incomeThisMonth || 0} /></div>
            <div className="stat-label">Other income this month</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-gold"><LedgerIcon size={17} /></div></div>
            <div className="stat-value">₹<AnimatedNumber value={data.financial?.receivables || 0} /></div>
            <div className="stat-label">Khata pending · {data.financial?.customersWithDue || 0} customers</div>
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="data-protection-title">
        <div className="section-title">
          <div className="icon-badge icon-brand"><AlertIcon size={16} /></div>
          <h2 id="data-protection-title">Data protection</h2>
        </div>
        <p className="section-note">Backup health for this seller’s books. Use a support session only when attention is needed.</p>
        <div className="breakdown-list data-protection-list">
          <div className="breakdown-row">
            <span className="breakdown-name">Latest backup</span>
            <span className={`badge badge-${data.backup?.lastBackupAt ? 'approved' : 'rejected'}`}>
              {data.backup?.lastBackupAt
                ? new Date(data.backup.lastBackupAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                : 'No backup recorded'}
            </span>
          </div>
          <div className="breakdown-row">
            <span className="breakdown-name">Automatic backup</span>
            <span className={`badge badge-${data.backup?.autoBackupEnabled ? 'approved' : 'inactive'}`}>
              {data.backup?.autoBackupEnabled ? 'Enabled' : 'Turned off'}
            </span>
            {data.backup?.autoBackupLastRunAt && (
              <span className="cell-sub">Last run {new Date(data.backup.autoBackupLastRunAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            )}
          </div>
          <div className="breakdown-row">
            <span className="breakdown-name">Google Drive</span>
            <span className={`badge badge-${data.backup?.googleDriveConnected ? 'approved' : 'inactive'}`}>
              {data.backup?.googleDriveConnected ? 'Connected' : 'Not connected'}
            </span>
            {data.backup?.googleDriveEmail && <span className="cell-sub">{data.backup.googleDriveEmail}</span>}
          </div>
          {data.backup?.autoBackupLastError && (
            <div className="breakdown-row">
              <span className="breakdown-name">Backup issue</span>
              <span className="badge badge-rejected">Needs attention</span>
              <span className="cell-sub">{data.backup.autoBackupLastError}</span>
            </div>
          )}
        </div>
      </section>

      {/* "Is dukaan mein kisne kya badla" — this shop's own log, without leaving the screen
          that holds every lever to fix what it finds. */}
      <AuditTimeline lockedShop={{ id: shop.id, name: shop.shopName || shop.name }} note={t('admin.auditShopSectionNote')} />

      {(data.payments?.length > 0 || data.meters?.some((meter) => meter.used > 0 || meter.blocked > 0)) && (
        <div className="two-col">
          {data.payments?.length > 0 && (
            <div className="panel">
              <div className="section-title">
                <div className="icon-badge icon-success"><RupeeIcon size={16} /></div>
                <h2>{t('admin.shopPayments')}</h2>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('admin.when')}</th>
                    <th>{t('admin.plan')}</th>
                    <th className="num">{t('admin.rev.amount')}</th>
                    <th>{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="cell-sub">{new Date(payment.createdAt).toLocaleDateString('en-IN')}</td>
                      <td>
                        {payment.plan}
                        <div className="cell-sub">{t(`admin.rev.cycle.${payment.cycle}`)}</div>
                      </td>
                      <td className="num tabular">₹{payment.amount}</td>
                      <td>
                        <span
                          className={`badge badge-${
                            payment.status === 'paid' ? 'approved' : payment.status === 'failed' ? 'rejected' : 'pending'
                          }`}
                        >
                          {t(`admin.rev.status.${payment.status}`)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.meters?.length > 0 && (
            <div className="panel">
              <div className="section-title">
                <div className="icon-badge icon-brand"><ZapIcon size={16} /></div>
                <h2>{t('admin.shopMeters')}</h2>
              </div>
              <p className="empty-state" style={{ textAlign: 'left', padding: '0 0 0.6rem' }}>
                {t('admin.shopMetersHint')}
                {data.meters[0]?.resetsAt && (
                  <> {t('admin.shopMetersResetsAt', { date: new Date(data.meters[0].resetsAt).toLocaleDateString('en-IN') })}</>
                )}
              </p>
              <div className="breakdown-list">
                {data.meters.map((meter) => {
                  const share = meter.limit ? Math.min(100, Math.round((meter.used / meter.limit) * 100)) : 0;
                  return (
                    <div className="breakdown-row" key={meter.metric} style={{ flexWrap: 'wrap' }}>
                      <span className="breakdown-name">{meter.label}</span>
                      <div className="breakdown-track">
                        <div className="breakdown-fill" style={{ width: `${share}%` }} />
                      </div>
                      <span className="breakdown-value">
                        {meter.limit === null ? meter.used : `${meter.used}/${meter.limit}`}
                      </span>
                      {meter.bonus > 0 && (
                        <span className="badge badge-approved">+{meter.bonus} {t('admin.usageBonusBadge')}</span>
                      )}
                      {meter.blocked > 0 && (
                        <span className="badge badge-rejected">{t('admin.blockedCount', { n: meter.blocked })}</span>
                      )}
                      <span className="row-actions" style={{ gap: '0.3rem' }}>
                        {[10, 50, 100].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            className="btn-inline btn-small"
                            disabled={busy === `usage-${meter.metric}`}
                            onClick={() => grantUsage(meter.metric, preset)}
                          >
                            +{preset}
                          </button>
                        ))}
                        <input
                          type="number"
                          min="1"
                          style={{ width: '64px' }}
                          placeholder={t('admin.usageCustomAmount')}
                          value={customUsage[meter.metric] || ''}
                          onChange={(e) => setCustomUsage((prev) => ({ ...prev, [meter.metric]: e.target.value }))}
                        />
                        <button
                          type="button"
                          className="btn-inline btn-small"
                          disabled={busy === `usage-${meter.metric}` || !customUsage[meter.metric]}
                          onClick={() => {
                            grantUsage(meter.metric, customUsage[meter.metric]);
                            setCustomUsage((prev) => ({ ...prev, [meter.metric]: '' }));
                          }}
                        >
                          {t('admin.usageAdd')}
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="two-col">
        <div className="panel">
          <h2>{t('admin.profile')}</h2>
          <div className="form-grid">
            {PROFILE_FIELDS.map((field) => (
              <div className="field" key={field}>
                <label htmlFor={`f-${field}`}>{field}</label>
                <input
                  id={`f-${field}`}
                  value={profile[field] || ''}
                  onChange={(e) => setProfile((prev) => ({ ...prev, [field]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div className="field">
            <label htmlFor="f-note">{t('admin.adminNote')}</label>
            <input
              id="f-note"
              value={profile.adminNote || ''}
              placeholder={t('admin.adminNoteHint')}
              onChange={(e) => setProfile((prev) => ({ ...prev, adminNote: e.target.value }))}
            />
          </div>
          <button className="btn btn-primary" disabled={busy === 'profile'} onClick={saveProfile}>
            <CheckIcon size={17} /> {busy === 'profile' ? t('common.saving') : t('admin.saveProfile')}
          </button>
        </div>

        <div className="panel">
          <h2>{t('admin.planAndTrial')}</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="f-plan">{t('admin.plan')}</label>
              <Dropdown id="f-plan" value={planDraft} onChange={setPlanDraft} options={PLAN_OPTIONS} />
            </div>
            <div className="field">
              <label htmlFor="f-trial">{t('admin.trialDays')}</label>
              <input
                id="f-trial"
                type="number"
                min="0"
                max="365"
                value={trialDays}
                placeholder={shop.trialEndsAt ? new Date(shop.trialEndsAt).toLocaleDateString() : '—'}
                onChange={(e) => setTrialDays(e.target.value)}
              />
            </div>
            {/* A grant used to be forever or nothing — there was no way to say "teen mahine
                ke liye". Blank keeps whatever end date the shop already has; 0 is the
                deliberate open-ended grant. */}
            <div className="field">
              <label htmlFor="f-plandays">Paid plan days from today</label>
              <input
                id="f-plandays"
                type="number"
                min="0"
                max="3650"
                value={planDays}
                placeholder={shop.planExpiresAt ? new Date(shop.planExpiresAt).toLocaleDateString() : 'no end date'}
                onChange={(e) => setPlanDays(e.target.value)}
              />
              <span className="field-hint">Blank = leave the current end date. 0 = never expires.</span>
            </div>
            <div className="field">
              <label htmlFor="f-plannote">Why (kept in the history)</label>
              <input
                id="f-plannote"
                value={planNote}
                placeholder="Support unblock, Diwali promo, deal closed by…"
                onChange={(e) => setPlanNote(e.target.value)}
              />
            </div>
          </div>
          {/* The grant that would have done nothing, said before it is made rather than
              after. See updateShopPlan — a paid plan with an expiry already in the past is
              demoted straight back to free by getEffectivePlan. */}
          {planDraft !== 'free' && shop.planExpiresAt && new Date(shop.planExpiresAt) < new Date() && planDays === '' && (
            <p className="section-note">
              This dukaan’s plan expired on {formatDate(shop.planExpiresAt, lang)}. Applying will clear that
              old date so the plan actually takes effect — set days above to give it a new one.
            </p>
          )}
          <button className="btn btn-primary" disabled={busy === 'plan'} onClick={applyPlan}>
            <CheckIcon size={17} /> {t('admin.applyPlan')}
          </button>

          <h2 style={{ marginTop: '1.4rem' }}>{t('admin.loginAsShop')}</h2>
          <p className="empty-state" style={{ textAlign: 'left', padding: '0 0 0.6rem' }}>
            {t('admin.loginAsShopHint')}
          </p>
          <button className="btn btn-secondary" disabled={busy === 'impersonate'} onClick={impersonate}>
            <LogOutIcon size={17} /> {t('admin.loginAsShop')}
          </button>

          {/* The first move for a locked-out shopkeeper, and deliberately the one placed
              above the manual reset: it ends with HIM choosing a password, so support never
              holds a credential that could move his payout UPI. */}
          <h2 style={{ marginTop: '1.4rem' }}>{t('admin.sendResetLink')}</h2>
          <p className="empty-state" style={{ textAlign: 'left', padding: '0 0 0.6rem' }}>
            {t('admin.sendResetLinkHint', { email: shop.email || '—' })}
          </p>
          <button className="btn btn-secondary" disabled={busy === 'resetLink' || !shop.email} onClick={sendResetLink}>
            <MailIcon size={17} /> {t('admin.sendResetLink')}
          </button>

          <h2 style={{ marginTop: '1.4rem' }}>{t('admin.resetPassword')}</h2>
          {/* Last resort, and labelled as one. This is the only action on the screen where
              somebody other than the owner learns a working password for the shop. */}
          <p className="empty-state" style={{ textAlign: 'left', padding: '0 0 0.6rem' }}>
            {t('admin.resetPasswordHint')}
          </p>
          <div className="field">
            <label htmlFor="f-pass">{t('admin.newPassword')}</label>
            <input
              id="f-pass"
              type="text"
              value={password}
              autoComplete="off"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn btn-secondary" disabled={busy === 'password' || password.length < 6} onClick={resetPassword}>
            <KeyIcon size={17} /> {t('admin.resetPassword')}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{t('admin.moduleAccess')}</h2>
          <div className="panel-tools">
            <button className="btn btn-secondary btn-small" disabled={busy === 'clear'} onClick={clearOverrides}>
              {t('admin.resetOverrides')}
            </button>
          </div>
        </div>

        {grouped.map((group) => {
          const GroupIcon = groupIcon(group.key);
          return (
          <div key={group.key} style={{ marginBottom: '0.9rem' }}>
            <div className="module-group-head">
              <div className="icon-badge icon-muted"><GroupIcon size={15} /></div>
              {group.label}
            </div>
            <div className="module-list">
              {group.modules.map((mod) => {
                const state = data.modules[mod.key] || {};
                const badge = stateBadge(state, t);
                const override = shop.moduleOverrides?.[mod.key];
                return (
                  <div className={`module-row${state.enabled ? '' : ' is-off'}`} key={mod.key}>
                    <div className="module-main">
                      <div className="module-title">
                        <strong>{mod.label}</strong>
                        <span className={`badge ${badge.cls}`}>{badge.text}</span>
                        {mod.planFeature && <span className="badge badge-inactive">{mod.planFeature}</span>}
                      </div>
                      <p>{mod.description}</p>
                    </div>
                    <TriToggle
                      value={mod.core ? true : override === undefined ? null : override}
                      disabled={mod.core || busy === `mod-${mod.key}`}
                      labels={{ on: t('admin.moduleOn'), default: t('admin.moduleDefault'), off: t('admin.moduleOff') }}
                      onChange={(value) => setModule(mod.key, value)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          );
        })}
      </div>

      <div className="panel danger-panel">
        <h2>{t('admin.dangerZone')}</h2>

        <div className="field">
          <label htmlFor="f-reason">{t('admin.suspendReason')}</label>
          <input id="f-reason" value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} />
        </div>
        <div className="row-actions" style={{ marginBottom: '1.2rem' }}>
          {shop.isActive ? (
            <button className="btn btn-danger" disabled={busy === 'active'} onClick={() => setActive(false)}>
              <XIcon size={17} /> {t('admin.deactivate')}
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy === 'active'} onClick={() => setActive(true)}>
              <CheckIcon size={17} /> {t('admin.activate')}
            </button>
          )}
        </div>

        <div className="danger-block">
          <p style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
            <AlertIcon size={16} /> {t('admin.deleteShopHint')}
          </p>
          <div className="field">
            <label htmlFor="f-confirm">{t('admin.deleteConfirmLabel')}</label>
            <input
              id="f-confirm"
              value={deleteConfirm}
              placeholder={shop.shopName}
              onChange={(e) => setDeleteConfirm(e.target.value)}
            />
          </div>
          <button
            className="btn btn-danger"
            disabled={busy === 'delete' || deleteConfirm !== shop.shopName}
            onClick={removeShop}
          >
            <TrashIcon size={17} /> {t('admin.deleteShop')}
          </button>
        </div>
      </div>
    </>
  );
}
