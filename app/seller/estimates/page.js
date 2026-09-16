'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { formatRupees, formatDate } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import AnimatedNumber from '../../components/AnimatedNumber';
import { SkeletonStats, SkeletonTable } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import Dropdown from '../../components/Dropdown';
import {
  PlusIcon,
  ClipboardIcon,
  RupeeIcon,
  CheckCircleIcon,
  AlertIcon,
  ReceiptIcon,
  TrashIcon,
  EditIcon,
  PrinterIcon,
  XIcon,
} from '../../components/Icons';
import RowMenu from '../../components/RowMenu';
import { recordHref } from '../../../lib/routeId';

/**
 * Quotations — "bhaav bata do".
 *
 * The screen exists for one question a shop could not previously ask itself: what have I
 * quoted, and who has not answered? A quotation used to be a bill reprinted with a different
 * heading, which meant every enquiry became a sale in the day's figures and nothing was
 * followed up because nothing was on a list.
 *
 * So the headline here is deliberately the *pending* value, not the total quoted. Money
 * sitting in un-answered quotes is the closest thing a small shop has to a sales pipeline,
 * and a fortnight-old quote nobody chased is the cheapest lost order in the business.
 *
 * Everything on a quote's lines is built and revised at the counter (the billing screen), so
 * this page never edits lines itself: it lists, filters, prints, shares, marks accepted or
 * rejected, and hands a quote back to the counter to bill or re-rate.
 */

const STATUS_FILTERS = ['pending', '', 'open', 'accepted', 'converted', 'rejected'];
// The same handoff key the billing screen reads on arrival. Kept in both files rather than a
// shared module because it is a two-line contract between exactly these two screens.
const ESTIMATE_CART_KEY = 'dukaan_estimate_to_cart';

function statusBadgeClass(row) {
  if (row.status === 'converted') return 'badge badge-active';
  if (row.status === 'rejected') return 'badge badge-inactive';
  if (row.expired) return 'badge badge-inactive';
  return 'badge badge-pending';
}

export default function SellerEstimatesPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('pending');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    params.set('page', String(page));
    return params.toString();
  }, [status, search, page]);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/seller/estimates?${query}`)
      .then((result) => {
        setData(result);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(load, [load]);

  const rows = data?.estimates || [];
  const pending = data?.pending;

  // How many of the quotes this shop gives actually turn into sales. One number, and the one
  // a shopkeeper can act on: a 20% strike rate is a pricing problem, not a follow-up problem.
  const wonRate = useMemo(() => {
    const won = rows.filter((row) => row.status === 'converted').length;
    const decided = rows.filter((row) => row.status === 'converted' || row.status === 'rejected').length;
    return decided > 0 ? Math.round((won / decided) * 100) : null;
  }, [rows]);

  function setFilter(next) {
    setStatus(next);
    setPage(1);
  }

  /**
   * Hands a quotation back to the counter.
   *
   * `bill` loads the lines into the cart to be sold — the bill is written by the ordinary
   * billing flow (payment mode, stock, khata, credit limit and all), and the quote is stamped
   * as converted once that bill exists. `edit` loads the same lines to be re-rated, and
   * saving there revises this same document instead of issuing a second one.
   */
  async function sendToCounter(row, mode) {
    setBusyId(row._id);
    try {
      const { estimate } = await apiFetch(`/api/seller/estimates/${row._id}`);
      sessionStorage.setItem(
        ESTIMATE_CART_KEY,
        JSON.stringify({
          estimateId: estimate._id,
          number: estimate.number,
          mode,
          items: estimate.items || [],
          customerId: estimate.customer?._id || estimate.customer || undefined,
          contactName: estimate.contactName || '',
          contactPhone: estimate.contactPhone || '',
          billDiscountPercent: estimate.billDiscountPercent || 0,
          billDiscount: estimate.billDiscount || 0,
          validUntil: estimate.validUntil || '',
          notes: estimate.notes || '',
        })
      );
      router.push('/seller/billing');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function changeStatus(row, next) {
    setBusyId(row._id);
    try {
      await apiFetch(`/api/seller/estimates/${row._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      toast.success(t(`estimates.marked_${next}`));
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function removeEstimate(row) {
    const ok = await confirm({
      tone: 'danger',
      title: t('common.delete'),
      body: t('estimates.confirmDelete', { number: row.number }),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    setBusyId(row._id);
    try {
      await apiFetch(`/api/seller/estimates/${row._id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('estimates.title')}</h1>
          <p>{t('estimates.subtitle')}</p>
          <div className="head-links">
            <Link href="/seller/billing" className="nav-link">
              {t('nav.billing')} →
            </Link>
          </div>
        </div>
        {/* There is deliberately no "new quotation" form here. A quote is the counter's cart
            saved a different way, so this sends them to the one screen that already knows how
            to search stock, apply pack sizes, quote loose units and total a bill. */}
        <Link href="/seller/billing" className="btn btn-primary btn-inline" style={{ textDecoration: 'none' }}>
          <PlusIcon size={17} />
          {t('estimates.create')}
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* What is left on this plan this month, said BEFORE he writes one and gets turned away.
          A cap you only meet at the moment of refusal feels like the app breaking; the same cap
          with a number on the screen is just how the plan works. Drawn only when there IS a cap
          — a permanent "unlimited" badge on a paid shop's screen is noise. */}
      {data?.quota && (
        <div className={`quota-strip${data.quota.remaining === 0 ? ' is-spent' : ''}`}>
          <span>
            {data.quota.remaining === 0
              ? t('estimates.quotaSpent', { limit: data.quota.limit })
              : t('estimates.quotaLeft', { remaining: data.quota.remaining, limit: data.quota.limit })}
          </span>
          <Link href="/seller/plan" className="link-btn">
            {t('estimates.quotaUpgrade')}
          </Link>
        </div>
      )}

      {loading && !data ? (
        <SkeletonStats count={3} />
      ) : (
        <div className="stat-grid">
          {/* Money on the table. Not "total quoted this month" — that number flatters and
              cannot be acted on; this one is a follow-up list with a rupee figure on it. */}
          <div className="stat-card accent-warning">
            <div className="stat-icon">
              <RupeeIcon size={16} />
            </div>
            <div className="stat-value">
              ₹<AnimatedNumber value={pending?.value || 0} />
            </div>
            <div className="stat-label">
              {t('estimates.pendingValue')}
              <span className="cell-sub">{t('estimates.pendingCount', { count: pending?.count || 0 })}</span>
            </div>
          </div>
          <div className="stat-card accent-success">
            <div className="stat-icon">
              <CheckCircleIcon size={16} />
            </div>
            <div className="stat-value">{wonRate === null ? '—' : `${wonRate}%`}</div>
            <div className="stat-label">
              {t('estimates.winRate')}
              <span className="cell-sub">{t('estimates.winRateHint')}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">
              <ClipboardIcon size={16} />
            </div>
            <div className="stat-value">
              <AnimatedNumber value={data?.total || 0} />
            </div>
            <div className="stat-label">{t('estimates.inView')}</div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>{t('estimates.register')}</h2>
          <div className="panel-tools">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(searchDraft.trim());
                setPage(1);
              }}
            >
              <input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder={t('estimates.searchPlaceholder')}
                aria-label={t('estimates.searchPlaceholder')}
              />
            </form>
            <Dropdown
              className="filter-select"
              value={status}
              onChange={setFilter}
              options={STATUS_FILTERS.map((value) => ({
                value,
                label: value ? t(`estimates.filter_${value}`) : t('estimates.filter_all'),
              }))}
            />
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={4} cols={5} />
        ) : rows.length === 0 ? (
          <div className="empty-state-rich">
            {/* Two different emptinesses behind one <p>, so two different pictures:
                a filter that matched nothing is not the same news as never having
                written a quotation. */}
            <Illustration scene={status || search ? 'search' : 'coins'} />
            <p>{status || search ? t('estimates.noneMatch') : t('estimates.emptyState')}</p>
            {!status && !search && (
              <Link href="/seller/billing" className="btn btn-primary btn-small btn-inline" style={{ textDecoration: 'none' }}>
                <PlusIcon size={15} />
                {t('estimates.create')}
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="table-wrap auto-height">
              <table className="data-table" style={{ minWidth: '900px' }}>
                <thead>
                  <tr>
                    <th>{t('estimates.number')}</th>
                    <th>{t('estimates.party')}</th>
                    <th className="num">{t('seller.total')}</th>
                    <th>{t('estimates.validity')}</th>
                    <th>{t('common.status')}</th>
                    <th className="tight" style={{ textAlign: 'right' }}>
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row._id} className="row-enter">
                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{row.number}</span>
                          <span className="cell-sub">
                            {formatDate(row.createdAt, lang)} · {t('purchase.itemCount', { count: row.itemCount })}
                            {row.revision > 0 && ` · ${t('estimates.revisionCount', { count: row.revision })}`}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{row.partyName || t('estimates.walkIn')}</span>
                          {row.partyPhone && <span className="cell-sub">{row.partyPhone}</span>}
                        </div>
                      </td>
                      <td className="num cell-strong">{formatRupees(row.total, lang)}</td>
                      <td>
                        {row.validUntil ? (
                          <div className="cell-stack">
                            <span className={row.expired ? 'cell-strong amount-out' : 'cell-strong'}>
                              {formatDate(row.validUntil, lang)}
                            </span>
                            {/* An expired quote is the one row on this screen that needs an
                                instruction rather than a status: the rate has to be re-given
                                before anything can be billed off it. */}
                            {row.expired && <span className="cell-sub amount-out">{t('estimates.expiredHint')}</span>}
                          </div>
                        ) : (
                          <span className="cell-muted">—</span>
                        )}
                      </td>
                      <td>
                        <span className={statusBadgeClass(row)} style={{ width: 'fit-content' }}>
                          {row.expired && row.status === 'open'
                            ? t('estimates.status_expired')
                            : t(`estimates.status_${row.status}`)}
                        </span>
                      </td>
                      <td className="tight">
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          {/* Three squares and a menu, in the same order on every row: the
                              quotation's yes, the paper, the pencil. What a quote is FOR is
                              turning into a bill, so that is the tinted one — the two
                              "mark it" bookkeeping actions are real but occasional, and
                              they are what goes behind the dots. */}
                          {row.status === 'converted' ? (
                            row.convertedBill && (
                              <Link
                                href={recordHref('/seller/invoice/[id]', row.convertedBill)}
                                className="icon-btn"
                                data-tip={t('estimates.openBill')}
                              >
                                <ReceiptIcon size={17} />
                              </Link>
                            )
                          ) : (
                            <button
                              type="button"
                              className="icon-btn primary"
                              data-tip={t('estimates.makeBill')}
                              disabled={busyId === row._id}
                              onClick={() => sendToCounter(row, 'convert')}
                            >
                              <RupeeIcon size={17} />
                            </button>
                          )}
                          <Link
                            href={recordHref('/seller/invoice/[id]', row._id, { src: 'estimate' })}
                            className="icon-btn"
                            data-tip={t('estimates.print')}
                          >
                            <PrinterIcon size={17} />
                          </Link>
                          {row.status !== 'converted' && (
                            <button
                              type="button"
                              className="icon-btn"
                              disabled={busyId === row._id}
                              onClick={() => sendToCounter(row, 'edit')}
                              data-tip={t('estimates.reviseHint')}
                              aria-label={t('estimates.revise')}
                            >
                              <EditIcon size={17} />
                            </button>
                          )}
                          {row.status !== 'converted' && (
                            <RowMenu
                              items={[
                                {
                                  label: t('estimates.markAccepted'),
                                  icon: <CheckCircleIcon size={15} />,
                                  hidden: row.status === 'accepted',
                                  disabled: busyId === row._id,
                                  onClick: () => changeStatus(row, 'accepted'),
                                },
                                {
                                  label: t('estimates.markRejected'),
                                  icon: <XIcon size={15} />,
                                  hidden: row.status === 'rejected',
                                  disabled: busyId === row._id,
                                  onClick: () => changeStatus(row, 'rejected'),
                                },
                                {
                                  label: t('common.delete'),
                                  icon: <TrashIcon size={15} />,
                                  danger: true,
                                  disabled: busyId === row._id,
                                  onClick: () => removeEstimate(row),
                                },
                              ]}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={data?.page || 1}
              pageCount={data?.pages || 1}
              total={data?.total || 0}
              from={rows.length === 0 ? 0 : ((data?.page || 1) - 1) * 25 + 1}
              to={((data?.page || 1) - 1) * 25 + rows.length}
              onPageChange={setPage}
              label={t('estimates.rowsLabel')}
            />
          </>
        )}

        <p className="field-hint" style={{ marginTop: '0.8rem', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <AlertIcon size={14} /> {t('estimates.footerNote')}
        </p>
      </div>
    </>
  );
}
