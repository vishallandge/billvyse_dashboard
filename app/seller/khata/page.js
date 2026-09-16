'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch, downloadFile } from '../../../lib/api';
import { recordKhataEntry, openReceipt, spanLabel, AGING_KEYS, AGING_LABEL } from '../../../lib/khata';
import { useDashboardUser } from '../../components/DashboardShell';
import { useLanguage } from '../../components/LanguageProvider';
import { useConfirm } from '../../components/ConfirmDialog';
import Illustration from '../../components/Illustration';
import {
  PlusIcon,
  XIcon,
  SearchIcon,
  LedgerIcon,
  UsersIcon,
  AlertIcon,
  RupeeIcon,
  EditIcon,
  DownloadIcon,
  TrashIcon,
  FilterClearIcon,
} from '../../components/Icons';
import { SkeletonStats, SkeletonTable } from '../../components/Skeleton';
import DataLoadNotice from '../../components/DataLoadNotice';
import { Pagination, usePagination } from '../../components/Pagination';
import { SortHeader, useSort } from '../../components/DataTable';
import Dropdown from '../../components/Dropdown';
import Modal from '../../components/Modal';
import RowMenu from '../../components/RowMenu';
import DuplicateCustomers from '../../components/DuplicateCustomers';
import HandoverNotice from '../../components/HandoverNotice';
import CustomerFormModal from '../../components/CustomerFormModal';
import { recordHref } from '../../../lib/routeId';

// Module scope so useSort's memo dependency stays stable across renders.
const SORT_ACCESSORS = {
  name: (c) => (c.name || '').toLowerCase(),
  phone: (c) => c.phone || '',
  balance: (c) => Number(c.balance) || 0,
  creditLimit: (c) => Number(c.creditLimit) || 0,
  // "Kaun bhool gaya" — the column that separates ₹2,000 from a man who paid on Tuesday
  // from ₹2,000 from a man who has not paid since Holi.
  age: (c) => Number(c.oldestDays) || 0,
};

const BALANCE_FILTERS = ['all', 'owing', 'overLimit', 'clear', 'closed'];
const AGE_FILTERS = ['all', ...AGING_KEYS];

function balanceBucket(customer) {
  if (customer.isActive === false) return 'closed';
  if (customer.creditLimit > 0 && customer.balance > customer.creditLimit) return 'overLimit';
  if (Number(customer.balance) > 0) return 'owing';
  return 'clear';
}

const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';

function initials(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function rupees(value) {
  return `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
}

export default function SellerKhataPage() {
  const user = useDashboardUser();
  const { t } = useLanguage();
  const confirm = useConfirm();
  const [customers, setCustomers] = useState([]);
  const [aging, setAging] = useState(null);
  const [claims, setClaims] = useState([]);
  const [search, setSearch] = useState('');
  const [balanceFilter, setBalanceFilter] = useState('all');
  const [ageFilter, setAgeFilter] = useState('all');
  const [formFor, setFormFor] = useState(null); // 'new' | customer object
  const [payFor, setPayFor] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [newLink, setNewLink] = useState('');
  const [resolvingClaim, setResolvingClaim] = useState(null);
  const [duplicates, setDuplicates] = useState(null);

  const loadAging = useCallback(() => {
    // Silent on failure like the dedupe banner below: the aging strip is the best thing on
    // this screen but it is not the reason the screen exists, and a shop whose ledger is too
    // big for it must still get its customer list.
    apiFetch('/api/seller/khata/aging')
      .then(setAging)
      .catch(() => setAging(null));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    apiFetch('/api/seller/khata/customers')
      .then((data) => setCustomers(data.customers))
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
    apiFetch('/api/seller/khata/claims')
      .then((data) => setClaims(data.claims))
      .catch(() => {});
    apiFetch('/api/seller/khata/customers/duplicates')
      .then(setDuplicates)
      .catch(() => {});
    loadAging();
  }, [loadAging]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleConfirmClaim(claim) {
    setResolvingClaim(claim._id);
    try {
      await apiFetch(`/api/seller/khata/claims/${claim._id}/confirm`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setResolvingClaim(null);
    }
  }

  async function handleRejectClaim(claim) {
    setResolvingClaim(claim._id);
    try {
      await apiFetch(`/api/seller/khata/claims/${claim._id}/reject`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setResolvingClaim(null);
    }
  }

  async function handleExport() {
    setExporting(true);
    setError('');
    try {
      await downloadFile('/api/seller/reports/customer-udhaar?format=xlsx', 'khata-udhaar.xlsx');
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete(customer) {
    const ok = await confirm({
      tone: 'danger',
      title: t('seller.deleteCustomerTitle'),
      body: t('seller.deleteCustomerBody', { name: customer.name }),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/seller/khata/customers/${customer.id}`, { method: 'DELETE' });
      setNotice(t('seller.customerDeleted'));
      load();
    } catch (err) {
      // KHATA_HAS_BALANCE / KHATA_HAS_HISTORY both come back with the sentence that says
      // what to do instead ("khata band kar dijiye"), so the server's message is the fix.
      setError(err.message);
    }
  }

  // Aging, keyed by customer, so the row badge and the age filter read the same numbers the
  // strip at the top does.
  const agingById = useMemo(() => {
    const map = new Map();
    for (const row of aging?.customers || []) map.set(row.id, row);
    return map;
  }, [aging]);

  const rows = useMemo(
    () =>
      customers.map((c) => {
        const a = agingById.get(String(c.id));
        return {
          ...c,
          buckets: a?.buckets || null,
          // Age of the OLDEST rupee still standing, not of the customer record. Falls back to
          // days-since-last-payment while the aging call is still in flight.
          oldestDays: a?.oldestDays ?? (c.balance > 0 ? c.daysSincePayment || 0 : 0),
          atRisk: a?.atRisk || 0,
        };
      }),
    [customers, agingById]
  );

  const stats = useMemo(() => {
    const outstanding = customers.reduce((sum, c) => sum + Math.max(0, Number(c.balance) || 0), 0);
    const overLimit = customers.filter((c) => c.creditLimit > 0 && c.balance > c.creditLimit).length;
    return { outstanding, overLimit, count: customers.length };
  }, [customers]);

  const visibleCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (balanceFilter !== 'all' && balanceBucket(c) !== balanceFilter) return false;
      if (ageFilter !== 'all' && !(c.buckets?.[ageFilter] > 0)) return false;
      if (!q) return true;
      return c.name?.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q);
    });
  }, [rows, search, balanceFilter, ageFilter]);

  const balanceCounts = useMemo(() => {
    const result = { all: rows.length, owing: 0, overLimit: 0, clear: 0, closed: 0 };
    for (const c of rows) result[balanceBucket(c)] += 1;
    return result;
  }, [rows]);

  const { sorted, sort, toggle } = useSort(visibleCustomers, SORT_ACCESSORS, { key: 'balance', dir: 'desc' });
  const page = usePagination(sorted, { pageSize: 25, resetKey: `${search}|${balanceFilter}|${ageFilter}` });
  const filtersActive = Boolean(search.trim()) || balanceFilter !== 'all' || ageFilter !== 'all';

  function clearFilters() {
    setSearch('');
    setBalanceFilter('all');
    setAgeFilter('all');
  }

  function handleSaved(customer, wasNew) {
    if (wasNew && user?.shopSlug) setNewLink(`${FRONTEND_URL}/c/${user.shopSlug}/login`);
    load();
  }

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <h1>{t('seller.khataTitle')}</h1>
          <p className="page-head-sub">{t('seller.khataSubtitle')}</p>
          <Link href="/seller/khata/reminders" className="link-quiet">{t('seller.viewReminders')} →</Link>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-primary btn-inline" onClick={() => setFormFor('new')}>
            <PlusIcon size={17} />
            {t('seller.newCustomer')}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      <DataLoadNotice loading={loading} error={loadError} onRetry={load} />
      {notice && <div className="info-banner">{notice}</div>}

      {/* Above everything, because it changes what every number below it MEANS. On a shop that
          has changed hands, "Ramesh owes ₹4,200" may be a debt owed to the previous owner and
          already settled with him — and going to collect it is the one mistake this screen can
          lead somebody into. Renders nothing at all for the other 99% of shops. */}
      <HandoverNotice />

      {/* Sits above the claims panel: money split across two records is wrong in a way
          the shopkeeper can't see anywhere else, and every other number on this page
          (outstanding, per-customer balance) is understating it until this is fixed. */}
      <DuplicateCustomers
        groups={duplicates?.groups}
        totalSplitBalance={duplicates?.totalSplitBalance}
        onMerged={load}
      />

      {claims.length > 0 && (
        <div className="panel" style={{ border: '1.5px solid var(--brand)' }}>
          <h2 style={{ marginBottom: '0.3rem' }}>{t('seller.pendingClaimsTitle')}</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: '0.75rem' }}>
            {t('seller.pendingClaimsSubtitle')}
          </p>
          {claims.map((claim) => (
            <div key={claim._id} className="claim-row">
              <div className="claim-row-main">
                <strong>{claim.customer?.name || t('seller.unknownCustomer')}</strong>{' '}
                <span style={{ color: 'var(--text-muted)' }}>
                  ₹{claim.amount} · {new Date(claim.createdAt).toLocaleString('en-IN')}
                </span>
                {/* The reference is the whole point: confirming a claim moves real money
                    off this customer's khata, so the shopkeeper needs something they can
                    actually look up rather than a bare "confirm" button. */}
                {claim.utr && (
                  <div className="claim-evidence">
                    <span className="claim-evidence-label">{t('seller.claimUtr')}</span>
                    <code>{claim.utr}</code>
                    {claim.reference && <span className="claim-evidence-ref">({claim.reference})</span>}
                  </div>
                )}
                <p className="claim-verify-hint">{t('seller.claimVerifyHint')}</p>
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  style={{ width: 'auto' }}
                  disabled={resolvingClaim === claim._id}
                  onClick={() => handleConfirmClaim(claim)}
                >
                  {t('seller.confirmClaim')}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  style={{ width: 'auto' }}
                  disabled={resolvingClaim === claim._id}
                  onClick={() => handleRejectClaim(claim)}
                >
                  {t('seller.rejectClaim')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {newLink && (
        <div className="info-banner">
          {t('seller.shareLink')}: <br />
          <input readOnly value={newLink} onFocus={(e) => e.target.select()} style={{ marginTop: '0.4rem' }} />
        </div>
      )}

      {loading ? (
        <SkeletonStats count={3} />
      ) : (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-danger"><RupeeIcon size={17} /></div></div>
            <div className="stat-value">₹{stats.outstanding.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
            <div className="stat-label">{t('seller.totalOutstanding')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-brand"><UsersIcon size={17} /></div></div>
            <div className="stat-value">{stats.count}</div>
            <div className="stat-label">{t('seller.customerCount')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-gold"><AlertIcon size={17} /></div></div>
            <div className="stat-value">{stats.overLimit}</div>
            <div className="stat-label">{t('seller.overCreditLimit')}</div>
          </div>
        </div>
      )}

      <KhataOverview overview={aging?.overview} t={t} />

      <AgingStrip aging={aging} active={ageFilter} onPick={setAgeFilter} t={t} />

      <div className="data-panel">
        <div className="data-filters">
          <div className="search-box">
            <SearchIcon size={16} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('seller.searchCustomers')} />
          </div>

          <Dropdown
            className={`select-control${balanceFilter !== 'all' ? ' filtered' : ''}`}
            value={balanceFilter}
            onChange={setBalanceFilter}
            options={BALANCE_FILTERS.map((key) => ({
              value: key,
              label:
                key === 'all'
                  ? t('seller.balanceAll')
                  : `${t(
                      key === 'owing'
                        ? 'seller.balanceOwing'
                        : key === 'overLimit'
                          ? 'seller.overCreditLimit'
                          : key === 'closed'
                            ? 'seller.balanceClosed'
                            : 'seller.balanceClear'
                    )} (${balanceCounts[key]})`,
            }))}
          />

          <Dropdown
            className={`select-control${ageFilter !== 'all' ? ' filtered' : ''}`}
            value={ageFilter}
            onChange={setAgeFilter}
            options={AGE_FILTERS.map((key) => ({
              value: key,
              label: key === 'all' ? t('seller.ageAll') : t(AGING_LABEL[key]),
            }))}
          />

          {filtersActive && (
            <button type="button" className="filter-clear" onClick={clearFilters}>
              <XIcon size={13} />
              {t('table.clearFilters')}
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary btn-small btn-inline"
            style={{ width: 'auto', marginLeft: 'auto' }}
            onClick={handleExport}
            disabled={exporting}
          >
            <DownloadIcon size={15} />
            {t('common.export')}
          </button>
        </div>

        {loading ? (
          <div className="data-panel-body"><SkeletonTable rows={6} cols={5} /></div>
        ) : customers.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="ledger" />
            <p>{t('seller.noCustomersYet')}</p>
            <button type="button" className="btn btn-primary btn-small btn-inline" onClick={() => setFormFor('new')}>
              <PlusIcon size={15} />
              {t('seller.addYourFirstCustomer')}
            </button>
          </div>
        ) : sorted.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="search" />
            <p>{t('table.noResults')}</p>
            <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={clearFilters}>
              <FilterClearIcon size={15} /> {t('table.clearFilters')}
            </button>
          </div>
        ) : (
          <>
            <div className="table-wrap mobile-cards">
              <table className="data-table" style={{ minWidth: '720px' }}>
                <thead>
                  <tr>
                    <SortHeader sortKey="name" label={t('common.name')} sort={sort} onSort={toggle} />
                    <SortHeader sortKey="phone" label={t('common.phone')} sort={sort} onSort={toggle} />
                    <SortHeader sortKey="balance" label={t('seller.balance')} sort={sort} onSort={toggle} align="right" />
                    <SortHeader sortKey="age" label={t('seller.udhaarAge')} sort={sort} onSort={toggle} align="right" />
                    <SortHeader sortKey="creditLimit" label={t('seller.creditLimit')} sort={sort} onSort={toggle} align="right" />
                    <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.pageItems.map((customer) => (
                    <tr key={customer.id}>
                      <td>
                        <div className="product-name-cell">
                          {customer.photoUrl ? (
                            <img src={customer.photoUrl} alt="" className="product-thumb" />
                          ) : (
                            <div className="avatar-initials">{initials(customer.name)}</div>
                          )}
                          <span className="name" style={{ fontWeight: 600 }}>{customer.name}</span>
                          {customer.isActive === false && (
                            <span className="badge badge-inactive">{t('seller.khataClosed')}</span>
                          )}
                        </div>
                      </td>
                      <td className="cell-muted">{customer.phone}</td>
                      <td className="num">
                        <CustomerBalance customer={customer} t={t} />
                      </td>
                      <td className="num cell-muted">
                        <UdhaarAge customer={customer} t={t} />
                      </td>
                      <td className="num cell-muted">{customer.creditLimit > 0 ? `₹${customer.creditLimit}` : '—'}</td>
                      <td className="tight" style={{ textAlign: 'right' }}>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          {/* The one action this screen exists for. Taking a payment used to
                              mean opening the customer, scrolling past four panels and
                              filling a form — for the thing a shopkeeper does forty times a
                              day with the customer standing in front of him. */}
                          {customer.balance > 0 && (
                            <button
                              type="button"
                              className="icon-btn"
                              data-tip={t('seller.recordPayment')}
                              onClick={() => setPayFor(customer)}
                            >
                              <RupeeIcon size={17} />
                            </button>
                          )}
                          <Link href={recordHref('/seller/khata/[id]', customer.id)} className="icon-btn" data-tip={t('seller.viewLedger')}>
                            <LedgerIcon size={17} />
                          </Link>
                          <button
                            type="button"
                            className="icon-btn"
                            data-tip={t('common.edit')}
                            onClick={() => setFormFor(customer)}
                          >
                            <EditIcon size={17} />
                          </button>
                          <RowMenu
                            items={[
                              {
                                label: t('seller.downloadStatement'),
                                icon: <DownloadIcon size={15} />,
                                onClick: () =>
                                  downloadFile(
                                    `/api/seller/khata/customers/${customer.id}/statement?format=xlsx`,
                                    `khata-${customer.name}.xlsx`
                                  ).catch((err) => setError(err.message)),
                              },
                              {
                                label: t('common.delete'),
                                icon: <TrashIcon size={15} />,
                                danger: true,
                                onClick: () => handleDelete(customer),
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="record-cards mobile-only">
              {page.pageItems.map((customer) => (
                <Link href={recordHref('/seller/khata/[id]', customer.id)} className="record-card record-card-link" key={customer.id}>
                  {customer.photoUrl ? (
                    <img src={customer.photoUrl} alt="" className="product-thumb" />
                  ) : (
                    <div className="avatar-initials">{initials(customer.name)}</div>
                  )}
                  <div className="record-card-main">
                    <span className="record-card-title">{customer.name}</span>
                    <div className="record-card-meta">
                      <span>{customer.phone}</span>
                      {customer.oldestDays > 0 && (
                        <span className="dot-sep">{t('seller.daysOld', { days: customer.oldestDays })}</span>
                      )}
                    </div>
                  </div>
                  <div className="record-card-side">
                    <CustomerBalance customer={customer} t={t} />
                  </div>
                </Link>
              ))}
            </div>

            <Pagination
              page={page.page}
              pageCount={page.pageCount}
              pageSize={page.pageSize}
              total={page.total}
              from={page.from}
              to={page.to}
              onPageChange={page.setPage}
              onPageSizeChange={page.setPageSize}
              label={t('seller.customerCount')}
            />
          </>
        )}
      </div>

      {formFor && (
        <CustomerFormModal
          customer={formFor === 'new' ? null : formFor}
          onClose={() => setFormFor(null)}
          onSaved={(customer) => handleSaved(customer, formFor === 'new')}
        />
      )}

      {payFor && (
        <QuickPayModal
          customer={payFor}
          t={t}
          confirm={confirm}
          onClose={() => setPayFor(null)}
          onDone={(message) => {
            setNotice(message);
            load();
          }}
        />
      )}
    </>
  );
}

/**
 * How old the shop's money is — the number that turns a khata screen into a morning's work.
 *
 * "₹1,84,000 baaki" tells a shopkeeper nothing he can act on; he already knows it is a lot.
 * "₹1,42,000 is more than three months old" tells him which calls to make today, and it is
 * the only line on this page that names money that is quietly on its way to becoming a
 * write-off. Each bar is also the filter for its own bucket, so reading it and acting on it
 * are the same tap.
 */
/**
 * The shop's khata, not today's photograph of it.
 *
 * The three cards above answer "kitna baaki hai, kitne log, kitne limit ke bahar" — all
 * true, all about this morning. None of them tells the shopkeeper whether his khata is
 * actually working, and that is a different question with a different answer: two years of
 * it, ₹6.2 lakh lent, ₹6.05 lakh back. A 97% recovery rate means the outstanding figure is
 * a working capital cycle. The same outstanding figure at 71% is a habit eating the shop.
 *
 * `neverPaid` is called out separately because those customers are invisible in every total
 * on this screen — somebody who owes money and has never once paid a rupee is not a slow
 * payer, he is a different problem, and he is the one worth a phone call today.
 */
function KhataOverview({ overview, t }) {
  if (!overview || !overview.customers) return null;

  return (
    <div className="panel khata-summary">
      <h2 className="khata-summary-head">{t('seller.khataOverview')}</h2>
      <div className="khata-summary-grid">
        <div>
          <span className="stat-label">{t('seller.khataRunningSince')}</span>
          <strong className="khata-summary-value">
            {overview.since
              ? new Date(overview.since).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
              : '—'}
          </strong>
          <span className="khata-summary-hint">{spanLabel(overview.days, t)}</span>
        </div>
        <div>
          <span className="stat-label">{t('seller.customerCount')}</span>
          <strong className="khata-summary-value">{overview.customers}</strong>
          <span className="khata-summary-hint">
            {t('seller.owingClearSplit', { owing: overview.owing, clear: overview.clear })}
            {overview.newThisMonth ? ` · ${t('seller.newThisMonth', { count: overview.newThisMonth })}` : ''}
          </span>
        </div>
        <div>
          <span className="stat-label">{t('seller.lifetimeCredit')}</span>
          <strong className="khata-summary-value">₹{overview.lifetimeCredit.toLocaleString('en-IN')}</strong>
          <span className="khata-summary-hint">{t('seller.lifetimeCreditHint')}</span>
        </div>
        <div>
          <span className="stat-label">{t('seller.lifetimePaid')}</span>
          <strong className="khata-summary-value is-good">₹{overview.lifetimePaid.toLocaleString('en-IN')}</strong>
          {overview.recoveryRate !== null && (
            <span className="khata-summary-hint">{t('seller.recoveredPct', { pct: overview.recoveryRate })}</span>
          )}
        </div>
      </div>

      {/* Only drawn when there is somebody to draw it about — an empty "0 logon ne kabhi
          paisa nahi diya" is a row that teaches the shopkeeper to stop reading this block. */}
      {overview.neverPaid > 0 && (
        <p className="khata-summary-note">{t('seller.neverPaidNote', { count: overview.neverPaid })}</p>
      )}
    </div>
  );
}

function AgingStrip({ aging, active, onPick, t }) {
  if (!aging || !(aging.outstanding > 0)) return null;
  const total = aging.outstanding;
  const risk = aging.buckets.d90plus;

  return (
    <div className="panel khata-aging">
      <div className="section-toolbar" style={{ marginBottom: '0.5rem' }}>
        <h2>{t('seller.agingTitle')}</h2>
        {risk > 0 && (
          <span className="badge badge-expired aging-risk">{t('seller.agingRisk', { amount: rupees(risk) })}</span>
        )}
      </div>
      <div className="aging-bars">
        {AGING_KEYS.map((key) => {
          const value = aging.buckets[key] || 0;
          const share = total > 0 ? Math.round((value / total) * 100) : 0;
          return (
            <button
              key={key}
              type="button"
              className={`aging-bar${active === key ? ' active' : ''}${key === 'd90plus' && value > 0 ? ' danger' : ''}`}
              onClick={() => onPick(active === key ? 'all' : key)}
              disabled={value <= 0}
            >
              <span className="aging-bar-label">{t(AGING_LABEL[key])}</span>
              <span className="aging-bar-value">{rupees(value)}</span>
              <span className="aging-bar-track">
                <span className="aging-bar-fill" style={{ width: `${share}%` }} />
              </span>
              <span className="aging-bar-share">{share}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Days since the OLDEST unpaid rupee, with the tone that says how worried to be. */
function UdhaarAge({ customer, t }) {
  if (!(customer.balance > 0)) return <span>—</span>;
  const days = customer.oldestDays || 0;
  const tone = days > 90 ? 'badge-expired' : days > 30 ? 'badge-expiring' : 'badge-inactive';
  return <span className={`badge ${tone}`}>{t('seller.daysOld', { days })}</span>;
}

const QUICK_MODES = ['cash', 'upi', 'card', 'bank'];

/**
 * Taking money at the counter, from the list, in three taps.
 *
 * Opens with the full balance already filled in, because that is what is handed over most of
 * the time — and a shopkeeper who has to type ₹1,240 while the customer waits will settle for
 * "₹1,200, baaki chhodo" instead.
 */
function QuickPayModal({ customer, t, confirm, onClose, onDone }) {
  const [amount, setAmount] = useState(String(customer.balance));
  const [mode, setMode] = useState('cash');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const data = await recordKhataEntry({
        customerId: customer.id,
        type: 'payment',
        amount: Number(amount),
        note,
        paymentMode: mode,
        confirm,
        t,
      });
      // null means the shopkeeper answered "no" to the advance question — not an error, and
      // not a reason to close the box he is still typing in.
      if (!data) return;
      const left = Number(data.customer.balance) || 0;
      onDone(
        left > 0
          ? t('seller.paymentTakenLeft', { amount: `₹${amount}`, left: `₹${left}` })
          : t('seller.paymentTakenClear', { amount: `₹${amount}` })
      );
      if (data.receipt) {
        const share = await confirm({
          tone: 'success',
          title: t('seller.receiptTitle'),
          body: t('seller.receiptBody', { name: customer.name }),
          confirmLabel: t('seller.sendReceipt'),
          cancelLabel: t('common.close'),
        });
        if (share) openReceipt(data.receipt);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      as="form"
      onSubmit={submit}
      onClose={onClose}
      title={`${t('seller.recordPayment')} — ${customer.name}`}
      maxWidth={440}
      footer={
        <>
          <button type="submit" className="btn btn-primary btn-inline" disabled={saving}>
            <RupeeIcon size={17} />
            {t('common.save')}
          </button>
          <button type="button" className="btn btn-secondary btn-inline" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
          {error && <div className="error-banner">{error}</div>}
          <p className="field-hint" style={{ marginTop: 0 }}>
            {t('seller.currentBalance')}: <strong>₹{customer.balance}</strong>
          </p>
          <div className="form-grid cols-2">
            <div className="field">
              <label htmlFor="qp-amount">{t('seller.amount')}</label>
              <input
                id="qp-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="qp-mode">{t('seller.payMode')}</label>
              <Dropdown
                id="qp-mode"
                value={mode}
                onChange={setMode}
                options={QUICK_MODES.map((m) => ({ value: m, label: t(`payMode.${m}`) }))}
              />
            </div>
            <div className="field field-span2">
              <label htmlFor="qp-note">{t('seller.note')}</label>
              <input id="qp-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
    </Modal>
  );
}

// The balance cell carries three separate signals (amount, over-limit, promise-to-pay)
// and both the table and the phone card render it — one component keeps them identical.
function CustomerBalance({ customer, t }) {
  const overLimit = customer.creditLimit > 0 && customer.balance > customer.creditLimit;
  const promiseDue =
    customer.promiseToPayDate &&
    new Date(customer.promiseToPayDate) <= new Date(new Date().setHours(23, 59, 59, 999));

  return (
    <span className="balance-cell">
      <span className={`balance-pill ${customer.balance > 0 ? 'owed' : 'clear'}`}>
        ₹{customer.balance}
      </span>
      {overLimit && <span className="badge badge-expired">{t('seller.overCreditLimit')}</span>}
      {customer.promiseToPayDate && (
        <span className={`badge ${promiseDue ? 'badge-expired' : 'badge-expiring'}`}>
          {t('seller.promiseChip', { date: new Date(customer.promiseToPayDate).toLocaleDateString('en-IN') })}
        </span>
      )}
    </span>
  );
}
