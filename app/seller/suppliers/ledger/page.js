'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch, API_URL } from '../../../../lib/api';
import { useLanguage } from '../../../components/LanguageProvider';
import { formatRupees, formatDate } from '../../../../lib/format';
import { useToast } from '../../../components/Toast';
import AnimatedNumber from '../../../components/AnimatedNumber';
import DateRangeFilter, { rangeToQuery } from '../../../components/DateRangeFilter';
import { TruckIcon, RupeeIcon, XIcon, SearchIcon, ClipboardIcon, SlidersIcon, LedgerIcon, WhatsappIcon, ExcelIcon, PdfIcon } from '../../../components/Icons';
import RowMenu from '../../../components/RowMenu';
import { SkeletonStats, SkeletonTable } from '../../../components/Skeleton';
import Dropdown from '../../../components/Dropdown';
import Modal from '../../../components/Modal';
import { recordHref } from '../../../../lib/routeId';

const PAYMENT_MODES = ['cash', 'upi', 'card', 'bank'];

// "Kisko kitna dena hai" — the mirror of the customer khata. A kirana runs udhaar in both
// directions, but only the money coming in was ever tracked; what the shop owed its
// wholesalers lived in the owner's head and in the supplier's own diary.
export default function SupplierLedgerPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showSettled, setShowSettled] = useState(false);

  const [statementFor, setStatementFor] = useState(null);
  const [statement, setStatement] = useState(null);
  const [statementRange, setStatementRange] = useState({ preset: 'all', from: '', to: '' });
  const [statementLoading, setStatementLoading] = useState(false);

  const [payingSupplier, setPayingSupplier] = useState(null);
  const [payment, setPayment] = useState({ amount: '', mode: 'cash', note: '' });
  const [adjustFor, setAdjustFor] = useState(null);
  const [adjustment, setAdjustment] = useState({ amount: '', note: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/api/seller/suppliers/ledger')
      .then((result) => {
        setData(result);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const statementQuery = useMemo(() => rangeToQuery(statementRange), [statementRange]);

  const loadStatement = useCallback(() => {
    if (!statementFor) return;
    setStatementLoading(true);
    apiFetch(`/api/seller/suppliers/${statementFor.id}/statement?${statementQuery}`)
      .then(setStatement)
      .catch((err) => toast.error(err.message))
      .finally(() => setStatementLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statementFor, statementQuery]);

  useEffect(loadStatement, [loadStatement]);

  const suppliers = data?.suppliers || [];
  const visible = suppliers.filter((s) => {
    if (!showSettled && s.balance <= 0) return false;
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return [s.name, s.company, s.phone].some((value) => value && value.toLowerCase().includes(needle));
  });

  async function submitPayment(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await apiFetch(`/api/seller/suppliers/${payingSupplier.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(payment.amount), mode: payment.mode, note: payment.note || undefined }),
      });
      toast.success(
        result.allocatedToOrders > 0
          ? t('supplier.paymentAllocated', { amount: formatRupees(result.allocatedToOrders, lang) })
          : t('seller.recordSupplierPayment')
      );
      setPayingSupplier(null);
      setPayment({ amount: '', mode: 'cash', note: '' });
      load();
      if (statementFor) loadStatement();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitAdjustment(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch(`/api/seller/suppliers/${adjustFor.id}/adjustments`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(adjustment.amount), note: adjustment.note }),
      });
      toast.success(t('supplier.adjustmentSaved'));
      setAdjustFor(null);
      setAdjustment({ amount: '', note: '' });
      load();
      if (statementFor) loadStatement();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  function statementExportUrl(format) {
    return `${API_URL}/api/seller/suppliers/${statementFor.id}/statement?${statementQuery}&format=${format}`;
  }

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('seller.supplierLedgerTitle')}</h1>
          <p>{t('seller.supplierLedgerSubtitle')}</p>
          <div className="head-links">
            <Link href="/seller/suppliers" className="nav-link">{t('nav.suppliers')} →</Link>
            <Link href="/seller/purchase-orders" className="nav-link">{t('nav.purchaseOrders')} →</Link>
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <SkeletonStats count={3} />
      ) : (
        <div className="stat-grid">
          <div className="stat-card accent-danger">
            <div className="stat-icon"><RupeeIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={data?.totalPayable || 0} /></div>
            <div className="stat-label">{t('seller.totalPayable')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><ClipboardIcon size={16} /></div>
            <div className="stat-value">{data?.unpaidPurchaseOrders || 0}</div>
            <div className="stat-label">
              {t('supplier.unpaidOrders')}
              {data?.oldestUnpaidAt && (
                <span className="cell-sub"> · {t('supplier.oldestSince', { date: formatDate(data.oldestUnpaidAt, lang) })}</span>
              )}
            </div>
          </div>
          <div className="stat-card accent-success">
            <div className="stat-icon"><TruckIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={data?.totalAdvance || 0} /></div>
            <div className="stat-label">{t('supplier.advancePaid')}</div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <div className="section-title">
            <div className="icon-badge icon-brand"><TruckIcon size={16} /></div>
            <h2>{t('nav.suppliers')}</h2>
          </div>
          <div className="panel-tools">
            <div className="search-box-inline">
              <SearchIcon size={15} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('supplier.searchPlaceholder')} />
            </div>
            <label className="checkbox-row" style={{ margin: 0 }}>
              <input type="checkbox" checked={showSettled} onChange={(e) => setShowSettled(e.target.checked)} />
              <span>{t('supplier.showSettled')}</span>
            </label>
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={4} cols={3} />
        ) : visible.length === 0 ? (
          <div className="empty-state-rich compact">
            <div className="empty-icon"><TruckIcon size={22} /></div>
            <p>{t('seller.noSupplierDues')}</p>
          </div>
        ) : (
          <div className="table-wrap auto-height">
            <table className="data-table" style={{ minWidth: '680px' }}>
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th className="num">{t('seller.totalPayable')}</th>
                  <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>
                      <div className="cell-stack">
                        <span className="cell-strong">{supplier.name}</span>
                        {supplier.company && <span className="cell-sub">{supplier.company}</span>}
                        {supplier.gstin && <span className="cell-sub">{supplier.gstin}</span>}
                      </div>
                    </td>
                    <td className="num">
                      {supplier.balance > 0 ? (
                        <span className="cell-strong amount-out">{formatRupees(supplier.balance, lang)}</span>
                      ) : supplier.balance < 0 ? (
                        <span className="cell-strong amount-in">{t('supplier.advance', { amount: formatRupees(-supplier.balance, lang) })}</span>
                      ) : (
                        <span className="badge badge-active">{t('supplier.settled')}</span>
                      )}
                    </td>
                    <td className="tight">
                      <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                        {supplier.balance > 0 && (
                          <button
                            type="button"
                            className="icon-btn primary"
                            data-tip={t('seller.recordSupplierPayment')}
                            onClick={() => { setPayingSupplier(supplier); setPayment({ amount: String(supplier.balance), mode: 'cash', note: '' }); }}
                          >
                            <RupeeIcon size={17} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="icon-btn"
                          data-tip={t('seller.supplierStatement')}
                          onClick={() => { setStatementFor(supplier); setStatement(null); }}
                        >
                          <LedgerIcon size={17} />
                        </button>
                        {supplier.whatsappLink && (
                          <a
                            href={supplier.whatsappLink}
                            target="_blank"
                            rel="noreferrer"
                            className="icon-btn"
                            data-tip="WhatsApp"
                          >
                            <WhatsappIcon size={17} />
                          </a>
                        )}
                        <RowMenu
                          items={[
                            {
                              label: t('supplier.adjust'),
                              icon: <SlidersIcon size={15} />,
                              onClick: () => { setAdjustFor(supplier); setAdjustment({ amount: '', note: '' }); },
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
        )}
      </div>

      {payingSupplier && (
        <Modal
          as="form"
          onSubmit={submitPayment}
          onClose={() => setPayingSupplier(null)}
          title={payingSupplier.name}
          hint={`${t('seller.totalPayable')}: ${formatRupees(payingSupplier.balance, lang)}`}
          maxWidth={400}
          footer={
            <button type="submit" className="btn btn-primary btn-inline" disabled={saving}>
              <RupeeIcon size={17} /> {saving ? t('common.saving') : t('seller.recordSupplierPayment')}
            </button>
          }
        >
            <div className="field">
              <label htmlFor="amount">{t('seller.supplierPaymentAmount')}</label>
              <input
                id="amount"
                type="number"
                min="0.01"
                step="0.01"
                value={payment.amount}
                onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="mode">{t('seller.paymentMode')}</label>
              <Dropdown
                id="mode"
                value={payment.mode}
                onChange={(v) => setPayment((p) => ({ ...p, mode: v }))}
                options={PAYMENT_MODES.map((m) => ({ value: m, label: t(`expenses.mode.${m}`) }))}
              />
            </div>
            <div className="field">
              <label>{t('expenses.note')}</label>
              <input value={payment.note} onChange={(e) => setPayment((p) => ({ ...p, note: e.target.value }))} />
            </div>
            <p className="field-hint">{t('supplier.allocationHint')}</p>
        </Modal>
      )}

      {adjustFor && (
        <Modal
          as="form"
          onSubmit={submitAdjustment}
          onClose={() => setAdjustFor(null)}
          title={t('supplier.adjust')}
          hint={adjustFor.name}
          maxWidth={420}
          footer={
            <button type="submit" className="btn btn-primary btn-inline" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          }
        >
            <div className="field">
              <label>{t('seller.amount')}</label>
              <input
                type="number"
                step="0.01"
                value={adjustment.amount}
                onChange={(e) => setAdjustment((a) => ({ ...a, amount: e.target.value }))}
                required
                autoFocus
              />
              <p className="field-hint">{t('supplier.adjustHint')}</p>
            </div>
            <div className="field">
              <label>{t('supplier.adjustReason')}</label>
              <input
                value={adjustment.note}
                onChange={(e) => setAdjustment((a) => ({ ...a, note: e.target.value }))}
                placeholder={t('supplier.adjustReasonPlaceholder')}
                required
              />
            </div>
        </Modal>
      )}

      {statementFor && (
        <Modal
          className="modal-wide"
          onClose={() => setStatementFor(null)}
          title={statementFor.name}
          hint={t('seller.supplierStatement')}
        >

            <div className="panel-tools" style={{ marginBottom: '0.7rem' }}>
              <DateRangeFilter compact value={statementRange} onChange={setStatementRange} />
              <a className="btn btn-secondary btn-small btn-inline" href={statementExportUrl('xlsx')}>
                <ExcelIcon size={17} /> Excel
              </a>
              <a className="btn btn-secondary btn-small btn-inline" href={statementExportUrl('pdf')}>
                <PdfIcon size={17} /> PDF
              </a>
            </div>

            {statementLoading || !statement ? (
              <SkeletonTable rows={5} cols={4} />
            ) : (
              <>
                <div className="statement-totals">
                  <div>
                    <span>{t('supplier.opening')}</span>
                    <strong>{formatRupees(statement.totals?.opening || 0, lang)}</strong>
                  </div>
                  <div>
                    <span>{t('seller.supplierPurchases')}</span>
                    <strong className="amount-out">{formatRupees(statement.totals?.purchased || 0, lang)}</strong>
                  </div>
                  <div>
                    <span>{t('seller.supplierPayments')}</span>
                    <strong className="amount-in">{formatRupees(statement.totals?.paid || 0, lang)}</strong>
                  </div>
                  <div className="grand">
                    <span>{t('supplier.closing')}</span>
                    <strong>{formatRupees(statement.totals?.closing || 0, lang)}</strong>
                  </div>
                </div>

                {statement.transactions?.length === 0 ? (
                  <p className="empty-state">{t('supplier.noEntriesInRange')}</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table" style={{ minWidth: '520px' }}>
                      <thead>
                        <tr>
                          <th>{t('expenses.date')}</th>
                          <th>{t('common.status')}</th>
                          <th className="num">{t('seller.amount')}</th>
                          <th className="num">{t('seller.balance')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statement.transactions.map((txn) => (
                          <tr key={txn.id}>
                            <td className="cell-muted">{formatDate(txn.date, lang)}</td>
                            <td>
                              <div className="cell-stack">
                                <span
                                  className={`badge ${txn.type === 'payment' || txn.type === 'adjustment' ? 'badge-active' : 'badge-pending'}`}
                                  style={{ width: 'fit-content' }}
                                >
                                  {t(`supplier.txn.${txn.type}`)}
                                </span>
                                {txn.note && <span className="cell-sub">{txn.note}</span>}
                              </div>
                            </td>
                            <td className={`num cell-strong ${txn.type === 'purchase' || txn.type === 'opening' ? 'amount-out' : 'amount-in'}`}>
                              {txn.type === 'purchase' || txn.type === 'opening' ? '+' : '−'} {formatRupees(txn.amount, lang)}
                            </td>
                            <td className="num cell-muted">{formatRupees(txn.balanceAfter, lang)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {statement.purchaseOrders?.length > 0 && (
                  <>
                    <h3 style={{ marginTop: '1rem' }}>{t('nav.purchaseOrders')}</h3>
                    <div className="table-wrap">
                      <table className="data-table" style={{ minWidth: '480px' }}>
                        <thead>
                          <tr>
                            <th>{t('purchase.orderNo')}</th>
                            <th>{t('common.status')}</th>
                            <th className="num">{t('seller.total')}</th>
                            <th className="num">{t('purchase.pending')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statement.purchaseOrders.map((po) => (
                            <tr key={po.id}>
                              <td>
                                <Link href={recordHref('/seller/purchase-orders/[id]', po.id)} className="nav-link">{po.label}</Link>
                                <div className="cell-sub">{formatDate(po.date, lang)}</div>
                              </td>
                              <td>
                                <span className={`badge ${po.status === 'received' ? 'badge-active' : 'badge-pending'}`}>
                                  {t(`purchase.status.${po.status}`)}
                                </span>
                              </td>
                              <td className="num">{formatRupees(po.totalAmount, lang)}</td>
                              <td className="num cell-strong">{po.pending > 0 ? formatRupees(po.pending, lang) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
        </Modal>
      )}
    </>
  );
}
