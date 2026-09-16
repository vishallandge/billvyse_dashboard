'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { formatRupees, formatDate, formatQty } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import AnimatedNumber from '../../components/AnimatedNumber';
import { SkeletonStats, SkeletonTable } from '../../components/Skeleton';
import { Pagination, usePagination } from '../../components/Pagination';
import Dropdown from '../../components/Dropdown';
import Modal from '../../components/Modal';
import {
  PlusIcon,
  XIcon,
  PrinterIcon,
  WhatsappIcon,
  TrashIcon,
  RupeeIcon,
  AlertIcon,
  CheckCircleIcon,
  UndoIcon,
  ClipboardIcon,
  TruckIcon,
  WalletIcon,
} from '../../components/Icons';
import RowMenu from '../../components/RowMenu';
import WhatsappSheet from '../../components/WhatsappSheet';
import { gstRateOptions } from '../../../lib/catalog';
import { recordHref } from '../../../lib/routeId';

/**
 * Debit notes — expired and damaged stock going back to the wholesaler, and the credit the
 * shop is claiming for it.
 *
 * The screen is built around one conviction: a chemist will never type out forty expired
 * lots. The app already knows exactly which lots died, what they cost and when they went,
 * so the whole flow is "tick what is in the crate" and the note builds itself. Typing is the
 * fallback, not the path.
 */

const STATUS_FILTERS = ['', 'draft', 'sent', 'settled', 'rejected'];
const REASONS = ['expiry', 'damage', 'wrong_item', 'short_supply', 'not_selling', 'other'];

/**
 * The claims where nothing goes back in the crate — the wholesaler just owes money.
 *
 * "Rate ₹98 tha, bill ₹105 ka bana hai" and "das dabbe ka charge, aath aaye" are the two
 * commonest things a shop debits a wholesaler for, and neither is a goods return. Before
 * this the only way to raise one was to tick a lot in the picker, which sent the claim AND
 * wrote the stock down — the shop lost the goods on paper as well as the money in the
 * argument. These lines are typed rather than picked, carry `affectsStock: false`, and
 * never touch a shelf.
 */
const MONEY_REASONS = ['rate_difference', 'overcharge'];

function lineTotal(line) {
  return (Number(line.quantity) || 0) * (Number(line.costPrice) || 0);
}

export default function PurchaseReturnsPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [busyId, setBusyId] = useState(null);

  // The builder. `picker` is the returnable-stock list the server works out for us.
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ supplierId: '', notes: '', items: [] });
  const [submitting, setSubmitting] = useState(false);
  const [picker, setPicker] = useState(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  // How far ahead to look. 0 = only what has already expired, which is the default because
  // that is the stock a shop has definitely lost. Widening it catches what is about to go,
  // which most wholesalers will still take back if it is sent early enough.
  const [pickerDays, setPickerDays] = useState(0);

  // Recording what the wholesaler actually credited, which is regularly less than claimed.
  const [settling, setSettling] = useState(null);
  const [settleAmount, setSettleAmount] = useState('');

  const router = useRouter();
  // The note on the wholesaler's WhatsApp. Same sheet every other send in the app goes
  // through, so the shopkeeper sees the message before it leaves.
  const [waSheet, setWaSheet] = useState(null);

  const query = useMemo(() => (statusFilter ? `?status=${statusFilter}` : ''), [statusFilter]);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/seller/suppliers/purchase-returns${query}`)
      .then((result) => {
        setData(result);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(load, [load]);

  useEffect(() => {
    apiFetch('/api/seller/suppliers?status=active')
      .then((result) => setSuppliers(result.suppliers || []))
      .catch(() => setSuppliers([]));
  }, []);

  const returns = data?.returns || [];
  const summary = data?.summary;
  const page = usePagination(returns, { pageSize: 25, resetKey: query });

  const formTotal = useMemo(() => form.items.reduce((sum, line) => sum + lineTotal(line), 0), [form.items]);

  async function openBuilder() {
    setForm({ supplierId: '', notes: '', items: [] });
    setFormOpen(true);
    await loadPicker(pickerDays);
  }

  async function loadPicker(days) {
    setPickerLoading(true);
    try {
      const result = await apiFetch(`/api/seller/suppliers/purchase-returns/returnable?days=${days}`);
      setPicker(result);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPickerLoading(false);
    }
  }

  // Ticking a lot puts the whole lot in the crate, because that is what a shopkeeper does —
  // the quantity stays editable for the case where half a lot is still good.
  function toggleLot(lot) {
    setForm((f) => {
      const key = lot.batchId || lot.productId;
      const already = f.items.some((line) => (line.batchId || line.productId) === key);
      if (already) {
        return { ...f, items: f.items.filter((line) => (line.batchId || line.productId) !== key) };
      }
      return {
        ...f,
        items: [
          ...f.items,
          {
            productId: lot.productId,
            name: lot.name,
            unit: lot.unit,
            batchId: lot.batchId,
            batchNumber: lot.batchNumber,
            expiryDate: lot.expiryDate,
            quantity: lot.quantity,
            costPrice: lot.costPrice,
            gstRate: lot.gstRate,
            hsnCode: lot.hsnCode,
            reason: lot.reason || 'expiry',
            // What is actually on the shelf, so the quantity box can refuse to claim for
            // stock the shop doesn't have.
            maxQuantity: lot.quantity,
          },
        ],
      };
    });
  }

  /**
   * A claim for money on goods the shop is keeping.
   *
   * Typed, not picked, because there is no lot to pick — the wholesaler's bill is wrong,
   * the shelf is fine. Quantity is fixed at 1 and the "rate" box becomes the amount being
   * claimed, which is how a shopkeeper thinks about it: "iska ₹340 wapas chahiye".
   */
  function addMoneyClaim() {
    setForm((f) => ({
      ...f,
      items: [
        ...f.items,
        {
          key: `claim-${Date.now()}`,
          name: '',
          unit: 'claim',
          quantity: 1,
          costPrice: '',
          gstRate: 0,
          reason: 'rate_difference',
          moneyOnly: true,
        },
      ],
    }));
  }

  async function openShare(row) {
    try {
      const data = await apiFetch(`/api/seller/suppliers/purchase-returns/${row._id}/share`);
      setWaSheet({
        title: t('returns.sendOnWhatsapp'),
        to: { name: row.supplier?.name, phone: data.supplierPhone },
        message: data.message,
        link: data.whatsappLink,
        auto: false,
      });
    } catch (err) {
      toast.error(err.message);
    }
  }

  function updateLine(index, patch) {
    setForm((f) => ({ ...f, items: f.items.map((line, i) => (i === index ? { ...line, ...patch } : line)) }));
  }

  function removeLine(index) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== index) }));
  }

  async function handleSubmit(event, status) {
    event.preventDefault();
    if (!form.supplierId) {
      toast.error(t('seller.selectSupplierFirst'));
      return;
    }
    if (form.items.length === 0) {
      toast.error(t('returns.needOneItem'));
      return;
    }
    // A typed money claim can be left half-filled in a way a ticked lot never can. Caught
    // here rather than by the server, because the row that needs fixing is on screen.
    const incomplete = form.items.find((line) => !String(line.name || '').trim() || !(Number(line.costPrice) > 0));
    if (incomplete) {
      toast.error(t('returns.claimNeedsDetail'));
      return;
    }
    // Sending is what takes the stock off the shelf and credits the supplier, so it gets a
    // confirmation the way receiving a purchase does.
    if (status === 'sent' && !(await confirm({ tone: 'warning', title: t('returns.send'), body: t('returns.confirmSend', { amount: formatRupees(formTotal, lang) }), confirmLabel: t('returns.send') }))) {
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/api/seller/suppliers/purchase-returns', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: form.supplierId,
          notes: form.notes || undefined,
          status,
          items: form.items.map((line) => ({
            productId: line.productId,
            name: line.name,
            unit: line.unit,
            quantity: Number(line.quantity),
            costPrice: Number(line.costPrice),
            gstRate: Number(line.gstRate) || 0,
            hsnCode: line.hsnCode || undefined,
            batchId: line.batchId || undefined,
            batchNumber: line.batchNumber || undefined,
            expiryDate: line.expiryDate || undefined,
            reason: line.reason,
            // The server pins this off the reason as well — see MONEY_ONLY_REASONS in
            // purchaseReturnController — so a stale client can never send a rate-difference
            // line that strips stock.
            affectsStock: line.moneyOnly ? false : undefined,
          })),
        }),
      });
      toast.success(status === 'sent' ? t('returns.sentToast') : t('returns.draftSaved'));
      setFormOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function changeStatus(row, status, extra = {}) {
    setBusyId(row._id);
    try {
      await apiFetch(`/api/seller/suppliers/purchase-returns/${row._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...extra }),
      });
      toast.success(t('returns.statusUpdated'));
      setSettling(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(row) {
    if (!(await confirm({ tone: 'danger', title: t('common.delete'), body: t('returns.confirmDelete'), confirmLabel: t('common.delete') }))) return;
    setBusyId(row._id);
    try {
      await apiFetch(`/api/seller/suppliers/purchase-returns/${row._id}`, { method: 'DELETE' });
      toast.success(t('returns.deleted'));
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const pickedKeys = new Set(form.items.map((line) => line.batchId || line.productId));

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('returns.title')}</h1>
          <p>{t('returns.subtitle')}</p>
          <div className="head-links">
            <Link href="/seller/purchase-orders" className="nav-link">{t('nav.purchaseOrders')} →</Link>
            <Link href="/seller/suppliers/ledger" className="nav-link">{t('seller.supplierLedgerTitle')} →</Link>
          </div>
        </div>
        <button type="button" className="btn btn-primary btn-inline" onClick={openBuilder}>
          <PlusIcon size={17} />
          {t('returns.create')}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading && !data ? (
        <SkeletonStats count={4} />
      ) : (
        <div className="stat-grid">
          {/* The number this screen exists for. Money the shop has physically handed back
              and not yet been credited for is the easiest money in the business to lose
              track of, and nothing else in the app was counting it. */}
          <div className="stat-card accent-danger">
            <div className="stat-icon"><RupeeIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={summary?.awaitingCredit || 0} /></div>
            <div className="stat-label">
              {t('returns.awaitingCredit')}
              {summary?.oldestWaitingDays > 0 && (
                <span className="cell-sub">{t('returns.oldestWaiting', { days: summary.oldestWaitingDays })}</span>
              )}
            </div>
          </div>
          <div className="stat-card accent-success">
            <div className="stat-icon"><CheckCircleIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={summary?.settled || 0} /></div>
            <div className="stat-label">{t('returns.creditReceived')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><UndoIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={summary?.totalClaimed || 0} /></div>
            <div className="stat-label">{t('returns.totalClaimed')}</div>
          </div>
          {/* What wholesalers refused to credit. Nobody adds this up over a year, and it is
              the strongest thing a shopkeeper can put in front of a distributor. */}
          <div className="stat-card">
            <div className="stat-icon"><AlertIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={summary?.shortfall || 0} /></div>
            <div className="stat-label">{t('returns.shortfall')}</div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>{t('returns.register')}</h2>
          <div className="panel-tools">
            <Dropdown
              className="filter-select"
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_FILTERS.map((s) => ({ value: s, label: s ? t(`returns.status.${s}`) : t('returns.allStatuses') }))}
            />
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={4} cols={5} />
        ) : returns.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="parcel" />
            <p>{statusFilter ? t('returns.noneMatch') : t('returns.emptyState')}</p>
            {!statusFilter && (
              <button type="button" className="btn btn-primary btn-small btn-inline" onClick={openBuilder}>
                <PlusIcon size={15} />
                {t('returns.create')}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="table-wrap auto-height">
              <table className="data-table" style={{ minWidth: '820px' }}>
                <thead>
                  <tr>
                    <th>{t('returns.noteNo')}</th>
                    <th>{t('seller.supplier')}</th>
                    <th className="num">{t('returns.claimed')}</th>
                    <th className="num">{t('returns.credited')}</th>
                    <th>{t('common.status')}</th>
                    <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.pageItems.map((row) => (
                    <tr key={row._id} className="row-enter">
                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{row.label}</span>
                          <span className="cell-sub">
                            {formatDate(row.createdAt, lang)} · {t('purchase.itemCount', { count: row.itemCount })}
                          </span>
                          {/* The formal series that goes on the paper and into the books.
                              `DN-14` is what gets said on the phone; this is what a CA
                              matches on, and it was on no screen in the app. */}
                          {row.documentNumber && <span className="cell-sub">{row.documentNumber}</span>}
                        </div>
                      </td>
                      <td className="cell-strong">{row.supplier?.name || '—'}</td>
                      <td className="num cell-strong">{formatRupees(row.totalAmount, lang)}</td>
                      <td className="num">
                        {row.status === 'settled' ? (
                          <div className="cell-stack">
                            <span className="cell-strong amount-in">{formatRupees(row.settledAmount, lang)}</span>
                            {/* The gap between what was claimed and what was allowed —
                                the number a shopkeeper argues about. */}
                            {row.shortfall > 0 && (
                              <span className="cell-sub amount-out">{t('returns.notAllowed', { amount: formatRupees(row.shortfall, lang) })}</span>
                            )}
                          </div>
                        ) : (
                          <span className="cell-muted">—</span>
                        )}
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span
                            className={`badge ${
                              row.status === 'settled' ? 'badge-active' : row.status === 'rejected' ? 'badge-inactive' : 'badge-pending'
                            }`}
                            style={{ width: 'fit-content' }}
                          >
                            {t(`returns.status.${row.status}`)}
                          </span>
                          {row.daysWaiting > 0 && (
                            <span className={`cell-sub${row.daysWaiting > 30 ? ' amount-out' : ''}`}>
                              {t('returns.waitingDays', { days: row.daysWaiting })}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="tight">
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          {/* Sending is irreversible, so the square opens the same confirm
                              the text button did — the tooltip names it and the dialog
                              states the amount before anything moves. */}
                          {row.status === 'draft' && (
                            <button
                              type="button"
                              className="icon-btn primary"
                              data-tip={t('returns.send')}
                              disabled={busyId === row._id}
                              onClick={async () => {
                                const ok = await confirm({
                                  tone: 'warning',
                                  title: t('returns.send'),
                                  body: t('returns.confirmSend', { amount: formatRupees(row.totalAmount, lang) }),
                                  confirmLabel: t('returns.send'),
                                });
                                if (ok) changeStatus(row, 'sent');
                              }}
                            >
                              <TruckIcon size={17} />
                            </button>
                          )}
                          {row.status === 'sent' && (
                            <button
                              type="button"
                              className="icon-btn primary"
                              data-tip={t('returns.recordCredit')}
                              disabled={busyId === row._id}
                              onClick={() => {
                                setSettling(row);
                                setSettleAmount(String(row.totalAmount));
                              }}
                            >
                              <WalletIcon size={17} />
                            </button>
                          )}
                          {/* The paper that goes back with the crate. Opens the same print
                              studio a bill does — the shop's own letterhead, template and
                              paper — because a claim on a wholesaler's godown clerk is only
                              as good as the document stapled to the box. */}
                          <button
                            type="button"
                            className="icon-btn"
                            data-tip={t('returns.printNote')}
                            onClick={() => router.push(recordHref('/seller/invoice/[id]', row._id, { src: 'debitnote' }))}
                          >
                            <PrinterIcon size={17} />
                          </button>
                          <RowMenu
                            items={[
                              {
                                label: t('returns.sendOnWhatsapp'),
                                icon: <WhatsappIcon size={15} />,
                                onClick: () => openShare(row),
                              },
                              {
                                label: t('common.delete'),
                                icon: <TrashIcon size={15} />,
                                danger: true,
                                hidden: row.status !== 'draft',
                                onClick: () => handleDelete(row),
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
              label={t('nav.purchaseReturns')}
            />
          </>
        )}
      </div>

      {/* ---- The builder ------------------------------------------------------------- */}
      {formOpen && (
        <Modal
          as="form"
          className="modal-wide"
          onSubmit={(e) => handleSubmit(e, 'sent')}
          onClose={() => setFormOpen(false)}
          title={t('returns.create')}
          hint={t('returns.buildHint')}
          footer={
            <>
              <button type="submit" className="btn btn-primary btn-inline" disabled={submitting || form.items.length === 0}>
                {submitting ? t('common.saving') : t('returns.sendNow')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-inline"
                disabled={submitting || form.items.length === 0}
                onClick={(e) => handleSubmit(e, 'draft')}
              >
                {t('returns.saveDraft')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setFormOpen(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >

              <div className="form-grid">
                <div className="field">
                  <label>{t('seller.supplier')}</label>
                  <Dropdown
                    value={form.supplierId}
                    onChange={(v) => setForm((f) => ({ ...f, supplierId: v }))}
                    options={[{ value: '', label: '—' }, ...suppliers.map((s) => ({ value: s._id, label: s.name }))]}
                  />
                </div>
                <div className="field">
                  <label>{t('returns.lookAhead')}</label>
                  <Dropdown
                    value={String(pickerDays)}
                    onChange={(v) => {
                      setPickerDays(Number(v));
                      loadPicker(Number(v));
                    }}
                    options={[
                      { value: '0', label: t('returns.alreadyExpired') },
                      { value: '30', label: t('returns.within30') },
                      { value: '90', label: t('returns.within90') },
                    ]}
                  />
                </div>
              </div>

              {/* The picker. This is the feature: the app already knows which lots died and
                  what they cost, so the shopkeeper ticks rather than types. */}
              <div className="panel-sub">
                <div className="line-items-head">
                  <span>{t('returns.pickStock')}</span>
                  {picker?.claimable > 0 && (
                    <span className="cell-sub">{t('returns.claimableTotal', { amount: formatRupees(picker.claimable, lang) })}</span>
                  )}
                </div>
                {pickerLoading ? (
                  <SkeletonTable rows={3} cols={3} />
                ) : !picker?.items?.length ? (
                  <p className="empty-state">{t('returns.nothingToReturn')}</p>
                ) : (
                  <div className="return-picker">
                    {picker.items.map((lot) => {
                      const key = lot.batchId || lot.productId;
                      const picked = pickedKeys.has(key);
                      return (
                        <button
                          type="button"
                          key={key}
                          className={`return-lot${picked ? ' picked' : ''}${lot.expired ? ' expired' : ''}`}
                          onClick={() => toggleLot(lot)}
                        >
                          <span className="return-lot-name">{lot.name}</span>
                          <span className="return-lot-meta">
                            {lot.batchNumber ? <code>{lot.batchNumber}</code> : null}
                            <span>{formatDate(lot.expiryDate, lang)}</span>
                            <span>{formatQty(lot.quantity, lang)} {lot.unit}</span>
                          </span>
                          <span className="return-lot-value">{formatRupees(lot.costPrice * lot.quantity, lang)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Not everything a wholesaler owes for is in the crate. This is the door for
                  the two claims that have no lot to tick — a rate that came through wrong,
                  or a bill charging for more than arrived. */}
              <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={addMoneyClaim}>
                <PlusIcon size={15} />
                {t('returns.addMoneyClaim')}
              </button>

              {form.items.length > 0 && (
                <div className="line-items">
                  <div className="line-items-head">
                    <span>{t('returns.inTheCrate', { count: form.items.length })}</span>
                  </div>
                  {form.items.map((line, index) => (
                    <div className="line-item return-line" key={line.key || line.batchId || line.productId}>
                      <div className="field line-name">
                        {line.moneyOnly ? (
                          <>
                            <label htmlFor={`claim-${index}`}>{t('returns.claimFor')}</label>
                            <input
                              id={`claim-${index}`}
                              value={line.name}
                              placeholder={t('returns.claimForHint')}
                              onChange={(e) => updateLine(index, { name: e.target.value })}
                            />
                          </>
                        ) : (
                          <>
                            <label>{line.name}</label>
                            <span className="cell-sub">
                              {line.batchNumber ? `${line.batchNumber} · ` : ''}
                              {line.expiryDate ? formatDate(line.expiryDate, lang) : ''}
                            </span>
                          </>
                        )}
                      </div>
                      {/* A money claim has no quantity to argue about — one claim, one
                          amount. A "1 piece" box beside it would invite the dabbe count, and
                          the line would then read as goods going back. */}
                      {!line.moneyOnly && (
                        <div className="field line-sm">
                          <label>{t('seller.quantity')}</label>
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            max={line.maxQuantity}
                            value={line.quantity}
                            onChange={(e) => updateLine(index, { quantity: e.target.value })}
                          />
                          {Number(line.quantity) > line.maxQuantity && (
                            <span className="field-warn">{t('returns.onlyOnShelf', { qty: line.maxQuantity })}</span>
                          )}
                        </div>
                      )}
                      <div className="field line-sm">
                        <label>{line.moneyOnly ? t('returns.claimAmount') : t('returns.rate')}</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.costPrice}
                          onChange={(e) => updateLine(index, { costPrice: e.target.value })}
                        />
                      </div>
                      {/* The slab the goods were bought at. A claim reverses input credit at
                          the rate the wholesaler charged, so a wrong slab here files the
                          reversal for the wrong amount. */}
                      {line.moneyOnly && (
                        <div className="field line-sm">
                          <label>{t('seller.gstRate')}</label>
                          <Dropdown
                            value={String(line.gstRate ?? 0)}
                            onChange={(v) => updateLine(index, { gstRate: Number(v) })}
                            options={gstRateOptions(line.gstRate).map((rate) => ({ value: String(rate), label: `${rate}%` }))}
                          />
                        </div>
                      )}
                      <div className="field line-sm">
                        <label>{t('returns.reasonLabel')}</label>
                        <Dropdown
                          value={line.reason}
                          onChange={(v) => updateLine(index, { reason: v })}
                          options={(line.moneyOnly ? MONEY_REASONS : REASONS).map((r) => ({
                            value: r,
                            label: t(`returns.reason.${r}`),
                          }))}
                        />
                      </div>
                      <div className="line-foot">
                        <div className="line-total">
                          <span className="cell-sub">{t('seller.total')}</span>
                          <strong>{formatRupees(lineTotal(line), lang)}</strong>
                        </div>
                        <button type="button" className="icon-btn danger line-remove" data-tip={t('common.delete')} onClick={() => removeLine(index)}>
                          <TrashIcon size={17} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="field">
                <label>{t('purchase.notes')}</label>
                <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>

              <div className="order-totals">
                <div className="grand">
                  <span>{t('returns.claiming')}</span>
                  <strong>{formatRupees(formTotal, lang)}</strong>
                </div>
              </div>

        </Modal>
      )}

      {/* Recording what actually came back. Pre-filled with the full claim, because most
          are settled in full — but editable, because the ones that aren't are exactly the
          ones worth recording. */}
      {waSheet && <WhatsappSheet {...waSheet} onClose={() => setWaSheet(null)} />}

      {settling && (
        <Modal
          onClose={() => setSettling(null)}
          title={t('returns.recordCredit')}
          hint={t('returns.creditHint', { label: settling.label, amount: formatRupees(settling.totalAmount, lang) })}
          footer={
            <>
              <button
                type="button"
                className="btn btn-primary btn-inline"
                disabled={busyId === settling._id}
                onClick={() => changeStatus(settling, 'settled', { settledAmount: Number(settleAmount) })}
              >
                <ClipboardIcon size={17} />
                {t('returns.saveCredit')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setSettling(null)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
            <div className="field">
              <label>{t('returns.creditAllowed')}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                max={settling.totalAmount}
                value={settleAmount}
                onChange={(e) => setSettleAmount(e.target.value)}
              />
              {Number(settleAmount) < settling.totalAmount && (
                <span className="field-hint">
                  {t('returns.shortfallHint', { amount: formatRupees(settling.totalAmount - Number(settleAmount || 0), lang) })}
                </span>
              )}
            </div>
        </Modal>
      )}
    </>
  );
}
