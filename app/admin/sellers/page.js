'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, downloadFile } from '../../../lib/api';
import { formatRelativeTime, formatMoney } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { SkeletonTable } from '../../components/Skeleton';
import { SearchIcon, ShopIcon, ExcelIcon, SlidersIcon, CheckCircleIcon, FilterClearIcon } from '../../components/Icons';
import RowMenu from '../../components/RowMenu';
import { Pagination } from '../../components/Pagination';
import Dropdown from '../../components/Dropdown';
import { recordHref } from '../../../lib/routeId';

function initials(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

const PLAN_OPTIONS = [
  { value: 'free', label: 'Free' },
  { value: 'pro', label: 'Pro' },
  { value: 'premium', label: 'Premium' },
  { value: 'enterprise', label: 'Enterprise' },
];

/**
 * The plan questions that are about time rather than tier.
 *
 * "Who is on Pro" was the only cut this list offered, and it is the least useful one. What
 * an operator opens this screen to find is who is about to run out, who already has, and
 * who is sitting on a paid tier with no end date because somebody granted it by hand — the
 * last of which had no way to be found at all. See planStateFilter in adminController.
 */
const PLAN_STATE_OPTIONS = [
  { value: 'trial', label: 'On trial' },
  { value: 'trial-ending', label: 'Trial ending this week' },
  { value: 'expiring', label: 'Expiring this week' },
  { value: 'lapsed', label: 'Lapsed' },
  { value: 'paid', label: 'Paid plan, live' },
  { value: 'perpetual', label: 'Granted, no end date' },
];

// Anything past this without a bill is a shop that has stopped using the product, not a
// shop having a quiet week. Same threshold the attention queue uses on the overview.
const DORMANT_DAYS = 30;

function daysSince(value) {
  if (!value) return null;
  return Math.floor((Date.now() - new Date(value).getTime()) / (24 * 60 * 60 * 1000));
}

export default function AdminDukaansPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const [sellers, setSellers] = useState([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState('');
  const [planState, setPlanState] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // The overview's attention cards deep-link here with ?status=pending. Read off the raw
  // URL rather than useSearchParams so this page doesn't need a Suspense boundary for one
  // optional filter — the same call made on /seller for its ?onboarding banner.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const search = new URLSearchParams(window.location.search);
    const incoming = search.get('status');
    if (incoming) setStatus(incoming);
    // The attention queue's lapsed / expiring cards land here the same way.
    const incomingState = search.get('planState');
    if (incomingState) setPlanState(incomingState);
  }, []);

  const params = useCallback(
    (extra = {}) => {
      const search = new URLSearchParams({ role: 'seller', ...extra });
      if (query.trim()) search.set('q', query.trim());
      if (status) search.set('status', status);
      if (plan) search.set('plan', plan);
      if (planState) search.set('planState', planState);
      return search;
    },
    [query, status, plan, planState]
  );

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/admin/users?${params({ page: String(page), pageSize: String(pageSize) }).toString()}`)
      .then((data) => {
        setSellers(data.users);
        setTotal(data.total ?? data.users.length);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [params, page, pageSize]);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  // A filter change with the old page number still set would ask for page 6 of a 2-page
  // result and land the admin on a blank table.
  useEffect(() => {
    setPage(1);
  }, [query, status, plan, planState, pageSize]);

  async function run(request, successMessage) {
    try {
      await request();
      if (successMessage) toast.success(successMessage);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  // Exports the whole filtered set, not the page on screen — see listUsers.
  async function exportXlsx() {
    setExporting(true);
    try {
      await downloadFile(
        `/api/admin/users?${params({ format: 'xlsx' }).toString()}`,
        `shops-${new Date().toISOString().slice(0, 10)}.xlsx`
      );
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(false);
    }
  }

  const updateStatus = (id, shopStatus) =>
    run(
      () => apiFetch(`/api/admin/shops/${id}/status`, { method: 'PATCH', body: JSON.stringify({ shopStatus }) }),
      shopStatus === 'approved' ? t('admin.approve') : t('admin.reject')
    );

  const toggleActive = (id, isActive) =>
    run(() => apiFetch(`/api/admin/users/${id}/active`, { method: 'PATCH', body: JSON.stringify({ isActive: !isActive }) }));

  const updatePlan = (id, nextPlan) =>
    run(
      () => apiFetch(`/api/admin/shops/${id}/plan`, { method: 'PATCH', body: JSON.stringify({ plan: nextPlan }) }),
      t('admin.planUpdated')
    );

  const filtersActive = Boolean(query || status || plan || planState);

  return (
    <>
      <div className="content-header">
        <h1>{t('admin.dukaansTitle')}</h1>
        <p>{t('admin.dukaansSubtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel">
        <div className="panel-head">
          <h2>{t('admin.dukaansTitle')} ({total})</h2>
          <div className="panel-tools">
            <div className="search-box-inline">
              <SearchIcon size={15} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('admin.search')} />
            </div>
            <Dropdown
              className="filter-select"
              value={status}
              onChange={setStatus}
              options={[
                { value: '', label: `${t('admin.filterStatus')}: ${t('admin.all')}` },
                { value: 'pending', label: 'pending' },
                { value: 'approved', label: 'approved' },
                { value: 'rejected', label: 'rejected' },
                { value: 'suspended', label: t('admin.suspended') },
              ]}
            />
            <Dropdown
              className="filter-select"
              value={plan}
              onChange={setPlan}
              options={[{ value: '', label: `${t('admin.filterPlan')}: ${t('admin.all')}` }, ...PLAN_OPTIONS]}
            />
            <Dropdown
              className="filter-select"
              value={planState}
              onChange={setPlanState}
              options={[{ value: '', label: `Plan state: ${t('admin.all')}` }, ...PLAN_STATE_OPTIONS]}
            />
            <button
              type="button"
              className="btn btn-secondary btn-small"
              disabled={exporting || total === 0}
              onClick={exportXlsx}
            >
              <ExcelIcon size={17} /> {exporting ? t('common.loading') : t('admin.exportXlsx')}
            </button>
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={6} cols={8} />
        ) : sellers.length === 0 ? (
          <div className="empty-state-rich">
            <div className="empty-icon"><ShopIcon size={26} /></div>
            <p>{filtersActive ? t('admin.noResults') : t('admin.noDukaans')}</p>
            {filtersActive && (
              <button
                type="button"
                className="btn btn-secondary btn-small btn-inline"
                onClick={() => {
                  setQuery('');
                  setStatus('');
                  setPlan('');
                  setPlanState('');
                }}
              >
                <FilterClearIcon size={15} /> {t('admin.clearFilters')}
              </button>
            )}
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>{t('admin.shop')}</th>
                    <th>{t('admin.contact')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('admin.account')}</th>
                    <th>{t('admin.lastBill')}</th>
                    <th>{t('admin.plan')}</th>
                    <th>Paid</th>
                    <th>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sellers.map((seller) => {
                    const overrideCount = Object.keys(seller.moduleOverrides || {}).length;
                    const quietDays = daysSince(seller.lastBillAt);
                    return (
                      <tr key={seller.id}>
                        <td>
                          <div className="product-name-cell">
                            <div className="avatar-initials" style={{ width: 32, height: 32, fontSize: 'var(--fs-xs)' }}>
                              {initials(seller.shopName || seller.name)}
                            </div>
                            <div className="product-name-meta">
                              <Link className="link-btn name" href={recordHref('/admin/sellers/[id]', seller.id)}>
                                {seller.shopName || '—'}
                              </Link>
                              {overrideCount > 0 && (
                                <span className="cell-sub">{overrideCount} module override{overrideCount > 1 ? 's' : ''}</span>
                              )}
                            </div>
                          </div>
                        </td>
                        {/* The phone is on this column now, and the search box above finds
                            shops by it — the two go together. A support call arrives as a
                            ringing number and nothing else, and until this landed an
                            operator holding one had to ask the caller to spell his shop's
                            name before he could find him at all. */}
                        <td>
                          {seller.name}
                          <div className="cell-sub">{seller.email}</div>
                          {seller.shopPhone && <div className="cell-sub tabular">{seller.shopPhone}</div>}
                        </td>
                        <td><span className={`badge badge-${seller.shopStatus}`}>{seller.shopStatus}</span></td>
                        <td>
                          <span className={`badge badge-${seller.isActive ? 'active' : 'inactive'}`}>
                            {seller.isActive ? 'active' : 'inactive'}
                          </span>
                          {seller.suspendedReason && <div className="cell-sub">{seller.suspendedReason}</div>}
                        </td>
                        {/* The column that separates a shop using the product from a shop
                            that signed up and walked away — invisible until now, and the
                            thing an operator most needs to know before a renewal call. */}
                        <td>
                          {!seller.lastBillAt ? (
                            <span className="badge badge-inactive">{t('admin.neverBilled')}</span>
                          ) : quietDays >= DORMANT_DAYS ? (
                            <span className="badge badge-rejected">{t('admin.quietDays', { n: quietDays })}</span>
                          ) : (
                            <span className="cell-sub">{formatRelativeTime(seller.lastBillAt, lang)}</span>
                          )}
                        </td>
                        <td>
                          <Dropdown
                            className="filter-select"
                            value={seller.plan || 'free'}
                            onChange={(v) => updatePlan(seller.id, v)}
                            options={PLAN_OPTIONS}
                          />
                          {seller.trialEndsAt && new Date(seller.trialEndsAt) > new Date() && (
                            <div className="cell-sub">
                              {t('admin.trialUntil')} {new Date(seller.trialEndsAt).toLocaleDateString()}
                            </div>
                          )}
                          {seller.planExpiresAt && new Date(seller.planExpiresAt) < new Date() && (
                            <div className="cell-sub">{t('admin.planLapsed')}</div>
                          )}
                          {seller.plan !== 'free' && !seller.planExpiresAt && (
                            <div className="cell-sub">no end date</div>
                          )}
                        </td>
                        {/* Whether this shop is a customer or a favour. A tier on its own
                            never said which, and most upgrades on this platform so far have
                            been granted rather than bought. */}
                        <td>
                          {seller.paidTerms > 0 ? (
                            <>
                              <span className="badge badge-approved">
                                {seller.paidTerms}× · ₹{formatMoney(seller.lifetimeValue, lang, { decimals: false })}
                              </span>
                              <div className="cell-sub">
                                last {formatRelativeTime(seller.lastPaidAt, lang)}
                              </div>
                            </>
                          ) : (
                            <span className="badge badge-inactive">never paid</span>
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            <Link className="icon-btn primary" data-tip={t('admin.manage')} href={recordHref('/admin/sellers/[id]', seller.id)}>
                              <SlidersIcon size={17} />
                            </Link>
                            <RowMenu
                              items={[
                                {
                                  label: t('admin.approve'),
                                  icon: <CheckCircleIcon size={15} />,
                                  hidden: seller.shopStatus === 'approved',
                                  onClick: () => updateStatus(seller.id, 'approved'),
                                },
                                {
                                  /* Switching a live shop off is not something to sit one
                                     pixel from Manage on a list of five hundred rows. */
                                  label: seller.isActive ? t('admin.deactivate') : t('admin.activate'),
                                  icon: <CheckCircleIcon size={15} />,
                                  danger: seller.isActive,
                                  onClick: () => toggleActive(seller.id, seller.isActive),
                                },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              pageCount={Math.max(1, Math.ceil(total / pageSize))}
              pageSize={pageSize}
              total={total}
              from={total === 0 ? 0 : (page - 1) * pageSize + 1}
              to={Math.min(page * pageSize, total)}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              label={t('admin.dukaansTitle').toLowerCase()}
            />
          </>
        )}
      </div>
    </>
  );
}
