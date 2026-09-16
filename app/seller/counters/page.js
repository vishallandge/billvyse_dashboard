'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { getShopSocket } from '../../../lib/socket';
import { useLanguage } from '../../components/LanguageProvider';
import { useDashboardUser } from '../../components/DashboardShell';
import { SkeletonTable } from '../../components/Skeleton';
import { Pagination, usePagination } from '../../components/Pagination';
import { SortHeader, useSort } from '../../components/DataTable';
import { CheckCircleIcon, XIcon, PlusIcon } from '../../components/Icons';
import Illustration from '../../components/Illustration';

// Module scope so useSort's memo dependency stays stable across renders.
const COUNTER_REPORT_SORT_ACCESSORS = {
  counter: (r) => (r.counter || '').toLowerCase(),
  billCount: (r) => Number(r.billCount) || 0,
  sales: (r) => Number(r.sales) || 0,
};

export default function CountersPage() {
  const { t } = useLanguage();
  const user = useDashboardUser();
  const [tokens, setTokens] = useState([]);
  const [counterReport, setCounterReport] = useState([]);
  // The counters this shop is already running, and what the plan allows. Both come off the
  // queue call — see backend listQueue.
  const [counters, setCounters] = useState([]);
  const [cap, setCap] = useState(null);
  const [counter, setCounter] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    Promise.all([
      apiFetch('/api/seller/queue'),
      apiFetch('/api/seller/reports/counter-wise-sales').catch(() => ({ rows: [] })),
    ])
      .then(([queueData, reportData]) => {
        setTokens(queueData.tokens);
        setCounters(queueData.counters || []);
        setCap(queueData.plan || null);
        setCounterReport(reportData.rows || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  useEffect(() => {
    if (user?.counterName) setCounter(user.counterName);
  }, [user]);

  useEffect(() => {
    const socket = getShopSocket();
    if (!socket) return;
    const onQueueUpdate = () => load();
    const onBillCreated = () => load();
    socket.on('queue:updated', onQueueUpdate);
    socket.on('bill:created', onBillCreated);
    return () => {
      socket.off('queue:updated', onQueueUpdate);
      socket.off('bill:created', onBillCreated);
    };
  }, []);

  async function handleCreateToken(event) {
    event.preventDefault();
    setError('');
    try {
      await apiFetch('/api/seller/queue', {
        method: 'POST',
        body: JSON.stringify({ counter: counter || undefined, customerName: customerName || undefined }),
      });
      setCustomerName('');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCallNext() {
    setError('');
    try {
      await apiFetch(`/api/seller/queue/call-next${counter ? `?counter=${encodeURIComponent(counter)}` : ''}`, {
        method: 'POST',
      });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateStatus(id, status) {
    try {
      await apiFetch(`/api/seller/queue/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const waiting = tokens.filter((tk) => tk.status === 'waiting');
  const serving = tokens.filter((tk) => tk.status === 'serving');

  // The counter-wise sales report is a static summary, safe to sort/paginate — unlike the
  // live queue tables above, which keep their natural first-come-first-served order.
  const counterReportSort = useSort(counterReport, COUNTER_REPORT_SORT_ACCESSORS);
  const counterReportPage = usePagination(counterReportSort.sorted, { pageSize: 25 });

  return (
    <>
      <div className="content-header">
        <h1>{t('seller.countersTitle')}</h1>
        <p>{t('seller.countersSubtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel">
        <h2>{t('seller.addToken')}</h2>
        <form onSubmit={handleCreateToken}>
          <div className="form-grid">
            <div className="field">
              <label>
                {t('seller.staffCounter')}
                {/* "2 of 4" — the plan's cap, on the box that spends it. A new name typed
                    here opens a new counter, so the shopkeeper should see the wall before he
                    walks into it, not in the refusal afterwards. Unlimited draws nothing. */}
                {cap?.limit != null && (
                  <span className="field-cap">{t('seller.countersOfLimit', { used: cap.used, limit: cap.limit })}</span>
                )}
              </label>
              {/* The counters he already has, offered rather than remembered. Typing an
                  existing name is always allowed; only a brand-new one can be refused. */}
              <input
                value={counter}
                onChange={(e) => setCounter(e.target.value)}
                placeholder={counters[0] || 'Counter 1'}
                list="counters-in-use"
              />
              <datalist id="counters-in-use">
                {counters.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label>{t('common.name')}</label>
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder={t('seller.optionalCustomerName')} />
            </div>
          </div>
          <div className="row-actions" style={{ marginTop: '0.5rem' }}>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}><PlusIcon size={17} /> {t('seller.newToken')}</button>
            <button type="button" className="btn btn-secondary" style={{ width: 'auto' }} onClick={handleCallNext}>
              {t('seller.callNext')}
            </button>
          </div>
        </form>
      </div>

      <div className="panel">
        <h2>{t('seller.nowServing')}</h2>
        {serving.length === 0 ? (
          <p className="empty-state">{t('seller.noneServing')}</p>
        ) : (
          <div className="table-wrap auto-height">
          <table className="data-table" style={{ minWidth: '460px' }}>
            <thead>
              <tr>
                <th>{t('seller.token')}</th>
                <th>{t('seller.staffCounter')}</th>
                <th>{t('common.name')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {serving.map((tk) => (
                <tr key={tk._id}>
                  <td><span className="token-number">#{tk.tokenNumber}</span></td>
                  <td>{tk.counter}</td>
                  <td>{tk.customerName || '-'}</td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="icon-btn primary"
                      data-tip={t('seller.markDone')}
                      onClick={() => updateStatus(tk._id, 'done')}
                    >
                      <CheckCircleIcon size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>{t('seller.waitingQueue')} ({waiting.length})</h2>
        {loading ? (
          <SkeletonTable rows={4} cols={4} />
        ) : waiting.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="people" />
            <p>{t('seller.queueEmpty')}</p>
          </div>
        ) : (
          <div className="table-wrap auto-height">
          <table className="data-table" style={{ minWidth: '460px' }}>
            <thead>
              <tr>
                <th>{t('seller.token')}</th>
                <th>{t('seller.staffCounter')}</th>
                <th>{t('common.name')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {waiting.map((tk) => (
                <tr key={tk._id}>
                  <td><span className="token-number">#{tk.tokenNumber}</span></td>
                  <td>{tk.counter}</td>
                  <td>{tk.customerName || '-'}</td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="icon-btn danger"
                      data-tip={t('common.cancel')}
                      onClick={() => updateStatus(tk._id, 'cancelled')}
                    >
                      <XIcon size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>{t('seller.counterWiseSales')}</h2>
        {counterReport.length === 0 ? (
          <p className="empty-state">{t('seller.noSalesYet')}</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <SortHeader sortKey="counter" label={t('seller.staffCounter')} sort={counterReportSort.sort} onSort={counterReportSort.toggle} />
                    <SortHeader sortKey="billCount" label={t('seller.billCount')} sort={counterReportSort.sort} onSort={counterReportSort.toggle} align="right" />
                    <SortHeader sortKey="sales" label={t('seller.revenue')} sort={counterReportSort.sort} onSort={counterReportSort.toggle} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {counterReportPage.pageItems.map((row) => (
                    <tr key={row.counter}>
                      <td>{row.counter}</td>
                      <td className="num">{row.billCount}</td>
                      <td className="num">₹{row.sales}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={counterReportPage.page}
              pageCount={counterReportPage.pageCount}
              pageSize={counterReportPage.pageSize}
              total={counterReportPage.total}
              from={counterReportPage.from}
              to={counterReportPage.to}
              onPageChange={counterReportPage.setPage}
              onPageSizeChange={counterReportPage.setPageSize}
              label={t('seller.counterWiseSales')}
            />
          </>
        )}
      </div>
    </>
  );
}
