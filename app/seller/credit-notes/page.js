'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, downloadFile } from '../../../lib/api';
import { formatRupees, formatDate } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { useToast } from '../../components/Toast';
import AnimatedNumber from '../../components/AnimatedNumber';
import { SkeletonStats, SkeletonTable } from '../../components/Skeleton';
import { Pagination, usePagination } from '../../components/Pagination';
import DateRangeFilter, { DEFAULT_RANGE, rangeToQuery } from '../../components/DateRangeFilter';
import Dropdown from '../../components/Dropdown';
import { SearchIcon, PrinterIcon, RupeeIcon, UndoIcon, ReceiptIcon, ExcelIcon, PdfIcon } from '../../components/Icons';
import { recordHref } from '../../../lib/routeId';

/**
 * The credit note register — every return the shop has issued, on one page.
 *
 * Credit notes have been correct documents in this app since returns existed, and they
 * existed nowhere as a list: to open one you had to already know which bill it was written
 * against. That is backwards from how anyone actually looks for a credit note. A customer
 * rings quoting a note number. A CA asks for "September ke credit notes". The shopkeeper
 * wants to know how much went back out this month and how much of it left the drawer in
 * cash. All three start from the note, not from the bill.
 *
 * The GST figure on this page is computed by the same arithmetic GSTR-1 uses, and is shown
 * deliberately: a shop should be able to hold this screen beside its return and see the two
 * agree, rather than take our word for it.
 */

const REFUND_MODES = ['', 'cash', 'upi', 'card', 'bank', 'khata'];

export default function CreditNotesPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const router = useRouter();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // A month, not a day. Nobody opens this screen for today's returns — those are still on
  // the counter — they open it to reconcile a period.
  const [range, setRange] = useState({ ...DEFAULT_RANGE, preset: 'month' });
  const [refundMode, setRefundMode] = useState('');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams(rangeToQuery(range));
    if (refundMode) params.set('refundMode', refundMode);
    if (term) params.set('search', term);
    return params.toString();
  }, [range, refundMode, term]);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/seller/bills/credit-notes?${query}`)
      .then((result) => {
        setData(result);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(load, [load]);

  const rows = data?.creditNotes || [];
  const summary = data?.summary;
  const page = usePagination(rows, { pageSize: 25, resetKey: query });

  async function handleExport(format) {
    try {
      await downloadFile(`/api/seller/bills/credit-notes?${query}&format=${format}`, `credit-notes.${format}`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('creditNotes.title')}</h1>
          <p>{t('creditNotes.subtitle')}</p>
          <div className="head-links">
            {/* The other half of the same idea. A credit note is money going back to a
                customer; a debit note is money coming back from a wholesaler, and a
                shopkeeper reconciling one month wants both within a tap of each other. */}
            <Link href="/seller/purchase-returns" className="nav-link">{t('nav.purchaseReturns')} →</Link>
            <Link href="/seller/reports" className="nav-link">{t('nav.reports')} →</Link>
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="filter-bar">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {loading && !data ? (
        <SkeletonStats count={4} />
      ) : (
        <div className="stat-grid">
          <div className="stat-card accent-danger">
            <div className="stat-icon"><UndoIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={summary?.amount || 0} /></div>
            <div className="stat-label">{t('creditNotes.totalCredited')}</div>
          </div>
          {/* Money that physically left the drawer, as against a khata note where the
              udhaar just shrank. Two very different things to a shopkeeper counting cash. */}
          <div className="stat-card">
            <div className="stat-icon"><RupeeIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={summary?.cashOut || 0} /></div>
            <div className="stat-label">{t('creditNotes.refundedOut')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><ReceiptIcon size={16} /></div>
            <div className="stat-value"><AnimatedNumber value={summary?.count || 0} decimals={false} /></div>
            <div className="stat-label">{t('creditNotes.noteCount')}</div>
          </div>
          {/* The figure that has to match "Less: credit notes issued (tax)" on the same
              month's GSTR-1. On the screen so the shop can check that it does. */}
          <div className="stat-card">
            <div className="stat-value">₹<AnimatedNumber value={summary?.gstAmount || 0} /></div>
            <div className="stat-label">{t('creditNotes.gstReversed')}</div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>{t('creditNotes.register')}</h2>
          <div className="panel-tools">
            <form
              className="input-action"
              onSubmit={(e) => {
                e.preventDefault();
                setTerm(search.trim());
              }}
            >
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('creditNotes.searchHint')}
                aria-label={t('creditNotes.searchHint')}
              />
              <button type="submit" className="icon-btn" data-tip={t('creditNotes.searchHint')}>
                <SearchIcon size={17} />
              </button>
            </form>
            <Dropdown
              className="filter-select"
              value={refundMode}
              onChange={setRefundMode}
              options={REFUND_MODES.map((mode) => ({
                value: mode,
                label: mode ? t(`creditNotes.mode.${mode}`) : t('creditNotes.allModes'),
              }))}
            />
            <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => handleExport('xlsx')}>
              <ExcelIcon size={17} /> Excel
            </button>
            <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => handleExport('pdf')}>
              <PdfIcon size={17} /> PDF
            </button>
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={4} cols={6} />
        ) : rows.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="ledger" />
            <p>{term || refundMode ? t('creditNotes.noneMatch') : t('creditNotes.emptyState')}</p>
            <span className="cell-sub">{t('creditNotes.emptyHint')}</span>
          </div>
        ) : (
          <>
            <div className="table-wrap auto-height">
              <table className="data-table" style={{ minWidth: '860px' }}>
                <thead>
                  <tr>
                    <th>{t('creditNotes.noteNo')}</th>
                    <th>{t('seller.customer')}</th>
                    <th>{t('creditNotes.againstBill')}</th>
                    <th className="num">{t('creditNotes.taxable')}</th>
                    <th className="num">{t('creditNotes.gst')}</th>
                    <th className="num">{t('seller.total')}</th>
                    <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.pageItems.map((row) => (
                    <tr key={row.id} className="row-enter">
                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{row.number}</span>
                          <span className="cell-sub">{formatDate(row.date, lang)}</span>
                        </div>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{row.customer || t('creditNotes.cashCustomer')}</span>
                          {row.reason && <span className="cell-sub">{row.reason}</span>}
                        </div>
                      </td>
                      <td>
                        {/* Straight to the bill this note reverses. The question after
                            "which credit note" is always "against what", and it was two
                            screens and a search away. */}
                        <div className="cell-stack">
                          <Link href={recordHref('/seller/invoice/[id]', row.billId)} className="nav-link">
                            #{row.billNumber}
                          </Link>
                          <span className="cell-sub">{formatDate(row.billDate, lang)}</span>
                        </div>
                      </td>
                      <td className="num">{formatRupees(row.taxableValue, lang)}</td>
                      <td className="num">{row.gstAmount > 0 ? formatRupees(row.gstAmount, lang) : <span className="cell-muted">—</span>}</td>
                      <td className="num">
                        <div className="cell-stack">
                          <span className="cell-strong amount-out">{formatRupees(row.amount, lang)}</span>
                          <span className="cell-sub">{t(`creditNotes.mode.${row.refundMode}`)}</span>
                        </div>
                      </td>
                      <td className="tight">
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="icon-btn"
                            data-tip={t('creditNotes.printNote')}
                            onClick={() =>
                              router.push(recordHref('/seller/invoice/[id]', row.billId, { doc: `creditnote:${row.returnIndex}` }))
                            }
                          >
                            <PrinterIcon size={17} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              compact
              page={page.page}
              pageCount={page.pageCount}
              pageSize={page.pageSize}
              total={page.total}
              from={page.from}
              to={page.to}
              onPageChange={page.setPage}
              onPageSizeChange={page.setPageSize}
              label={t('creditNotes.title')}
            />
          </>
        )}
      </div>
    </>
  );
}
