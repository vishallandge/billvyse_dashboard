'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { formatRupees, formatDate, toDateInput } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useHiddenNav, useDashboardStores } from '../../components/DashboardShell';
import { SkeletonStats, SkeletonTable } from '../../components/Skeleton';
import Dropdown from '../../components/Dropdown';
import Modal from '../../components/Modal';
import RowMenu from '../../components/RowMenu';
import CustomerQuickAdd from '../../components/CustomerQuickAdd';
import {
  PlusIcon, XIcon, EditIcon, TrashIcon, ClockIcon, AlertIcon, RupeeIcon, RefreshIcon,
  CheckCircleIcon, ReceiptIcon,
} from '../../components/Icons';
import { recordHref } from '../../../lib/routeId';

/**
 * Repeating bills — "har mahine wahi bill".
 *
 * The screen answers three questions and nothing else, in this order, because that is the
 * order a shopkeeper asks them:
 *
 *   1. What is about to land on my customers' khatas this week? (the rupee headline)
 *   2. What is waiting for my OK right now? (the queue, first panel, always above the list)
 *   3. What stopped, and why? (the paused/failed badge on the row that stopped)
 *
 * Everything about WHEN is previewed as real dates before anything is saved — the form asks
 * the server for the next five run dates rather than describing a frequency in words, because
 * "every month on the 31st" is a sentence a shopkeeper cannot check and "1 Oct, 31 Oct, 30
 * Nov" is one he can.
 */

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
const PAYMENT_MODES = ['khata', 'cash', 'upi', 'card', 'bank'];
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function emptyLine() {
  return { productId: '', name: '', unit: 'piece', price: '', quantity: '1', gstRate: '0' };
}

function emptyForm() {
  return {
    customerId: '',
    title: '',
    paymentMode: 'khata',
    frequency: 'monthly',
    interval: '1',
    weekday: String(new Date().getDay()),
    dayOfMonth: String(new Date().getDate()),
    monthOfYear: String(new Date().getMonth() + 1),
    startDate: toDateInput(),
    endMode: 'never',
    endDate: '',
    maxCycles: '',
    autoBill: true,
    notes: '',
    storeId: '',
    items: [emptyLine()],
  };
}

function lineAmount(line, products) {
  const quantity = Number(line.quantity) || 0;
  if (line.productId) {
    const product = products.find((p) => p._id === line.productId);
    return quantity * (Number(product?.price) || 0);
  }
  return quantity * (Number(line.price) || 0);
}

export default function RecurringBillsPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const hiddenNav = useHiddenNav();
  // A chain has to be able to say WHICH branch a repeating bill comes off. A single-store
  // shop never sees the field — there is nothing to choose.
  const { stores, activeStore } = useDashboardStores();
  // Khata is a paid feature and the customer list comes from it, so when it is locked this
  // screen's only required field could never fill. Reuse the sidebar's answer rather than
  // guessing from a request that failed.
  const khataLocked = hiddenNav.includes('khata');

  const [data, setData] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [preview, setPreview] = useState([]);
  const [detail, setDetail] = useState(null);
  // Adding a customer without losing the schedule already typed into this form.
  const [addingCustomer, setAddingCustomer] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params = statusFilter ? `?status=${statusFilter}` : '';
    apiFetch(`/api/seller/recurring${params}`)
      .then((result) => {
        setData(result);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(load, [load]);

  useEffect(() => {
    apiFetch('/api/seller/khata/customers')
      .then((result) => setCustomers(result.customers || []))
      .catch(() => {});
    apiFetch('/api/seller/products')
      .then((result) => setProducts(result.products || []))
      .catch(() => {});
  }, []);

  const rows = data?.recurring || [];
  const summary = data?.summary;
  // What the plan allows. `limit: null` is unlimited and draws nothing — a cap nobody can
  // reach is noise on a working screen.
  const cap = data?.plan;

  /**
   * The queue, lifted out of the list.
   *
   * An approve-first schedule that came due is the only thing on this screen with a deadline,
   * and leaving it as a badge on a row somewhere down a list of thirty is how a month's fees
   * go uncollected. It gets its own panel above everything.
   */
  const waiting = useMemo(
    () =>
      rows
        .filter((row) => (row.pending || []).length > 0)
        .flatMap((row) => row.pending.map((p) => ({ row, dueDate: p.dueDate })))
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)),
    [rows]
  );

  /* ------------------------------------------------------------- the form */

  function setField(field) {
    return (value) => setForm((f) => ({ ...f, [field]: value }));
  }

  function updateLine(index, patch) {
    setForm((f) => ({
      ...f,
      items: f.items.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  }

  function addLine(productLine) {
    setForm((f) => ({ ...f, items: [...f.items, productLine ? emptyLine() : { ...emptyLine(), productId: '' }] }));
  }

  function removeLine(index) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== index) }));
  }

  function openNew() {
    setForm({ ...emptyForm(), storeId: activeStore?._id || '' });
    setEditingId(null);
    setPreview([]);
    setFormOpen(true);
  }

  async function openEdit(row) {
    setBusyId(row._id);
    try {
      const { recurring } = await apiFetch(`/api/seller/recurring/${row._id}`);
      setForm({
        customerId: recurring.customer?.id || recurring.customer || '',
        title: recurring.title || '',
        paymentMode: recurring.paymentMode,
        frequency: recurring.frequency,
        interval: String(recurring.interval || 1),
        weekday: String(recurring.weekday ?? new Date().getDay()),
        dayOfMonth: String(recurring.dayOfMonth ?? 1),
        monthOfYear: String(recurring.monthOfYear ?? 1),
        startDate: toDateInput(recurring.startDate),
        endMode: recurring.endMode || 'never',
        endDate: recurring.endDate ? toDateInput(recurring.endDate) : '',
        maxCycles: recurring.maxCycles ? String(recurring.maxCycles) : '',
        autoBill: recurring.autoBill,
        notes: recurring.notes || '',
        storeId: recurring.store?.id || recurring.store || '',
        items: (recurring.items || []).map((line) => ({
          productId: line.product || '',
          name: line.name,
          unit: line.unit,
          price: String(line.price),
          quantity: String(line.quantity),
          gstRate: String(line.gstRate || 0),
        })),
      });
      setEditingId(row._id);
      setPreview([]);
      setFormOpen(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  /**
   * The dates, from the server that will actually run them.
   *
   * Deliberately not worked out in the browser. The month-end rule ("the 31st" means the 28th
   * in February and the 31st again in March) lives in one file on the server, and a second
   * copy of it here would eventually disagree with the cron — which is a preview that lies.
   */
  const scheduleKey = [
    form.frequency, form.interval, form.startDate, form.weekday, form.dayOfMonth,
    form.monthOfYear, form.endMode, form.endDate, form.maxCycles,
  ].join('|');

  useEffect(() => {
    if (!formOpen || !form.startDate) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      apiFetch('/api/seller/recurring/preview', {
        method: 'POST',
        body: JSON.stringify({
          frequency: form.frequency,
          interval: Number(form.interval) || 1,
          startDate: form.startDate,
          weekday: Number(form.weekday),
          dayOfMonth: Number(form.dayOfMonth),
          monthOfYear: Number(form.monthOfYear),
          endMode: form.endMode,
          endDate: form.endDate || undefined,
          maxCycles: form.maxCycles ? Number(form.maxCycles) : undefined,
        }),
      })
        .then((result) => {
          if (!cancelled) setPreview(result.dates || []);
        })
        .catch(() => {
          if (!cancelled) setPreview([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen, scheduleKey]);

  const formTotal = useMemo(
    () => form.items.reduce((sum, line) => sum + lineAmount(line, products), 0),
    [form.items, products]
  );

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        customerId: form.customerId,
        title: form.title || undefined,
        paymentMode: form.paymentMode,
        frequency: form.frequency,
        interval: Number(form.interval) || 1,
        weekday: Number(form.weekday),
        dayOfMonth: Number(form.dayOfMonth),
        monthOfYear: Number(form.monthOfYear),
        startDate: form.startDate,
        endMode: form.endMode,
        endDate: form.endMode === 'onDate' ? form.endDate : undefined,
        maxCycles: form.endMode === 'afterCount' ? Number(form.maxCycles) : undefined,
        autoBill: form.autoBill,
        notes: form.notes || undefined,
        storeId: form.storeId || undefined,
        items: form.items
          .filter((line) => (line.productId || line.name.trim()) && Number(line.quantity) > 0)
          .map((line) => ({
            productId: line.productId || undefined,
            name: line.productId ? undefined : line.name.trim(),
            unit: line.productId ? undefined : line.unit,
            price: line.productId ? undefined : Number(line.price),
            quantity: Number(line.quantity),
            gstRate: line.productId ? undefined : Number(line.gstRate) || 0,
          })),
      };
      if (editingId) {
        await apiFetch(`/api/seller/recurring/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success(t('recurring.saved'));
      } else {
        await apiFetch('/api/seller/recurring', { method: 'POST', body: JSON.stringify(payload) });
        toast.success(t('recurring.created'));
      }
      setFormOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------------------------------------------------------- row actions */

  /**
   * WHICH bill the green button is about to write.
   *
   * Three different things wear the same button, and the shopkeeper has to be told which one
   * he is pressing — they are not equally reversible:
   *
   *   queued — a due date sitting in the approve-first queue. Expected; he asked to be asked.
   *   due    — the schedule's own date has arrived. Also expected.
   *   extra  — nothing is due at all, so this writes an ADDITIONAL bill today and leaves the
   *            schedule where it was. That is a real charge on a customer's khata that the
   *            schedule was not going to make, and it is the one nobody expects.
   */
  function billNowPlan(row) {
    const queued = (row.pending || [])[0];
    if (queued) return { mode: 'queued', dueDate: queued.dueDate };
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (row.nextRunAt && new Date(row.nextRunAt) <= today) return { mode: 'due', dueDate: row.nextRunAt };
    return { mode: 'extra', dueDate: null };
  }

  /**
   * The confirm that explains itself.
   *
   * A bill is money on a customer's khata and there is no undo on this screen — the only way
   * back is to cancel the bill from the bills register. So the step before it does not ask
   * "are you sure", which tells a shopkeeper nothing; it lays out exactly what is about to
   * happen: who, how much, by which method, and — the line that matters — what their udhaari
   * becomes afterwards.
   */
  async function billNow(row, dueDate) {
    const plan = dueDate ? { mode: 'queued', dueDate } : billNowPlan(row);
    const balanceNow = Number(row.customer?.balance) || 0;
    const onKhata = row.paymentMode === 'khata';

    const details = [
      { label: t('recurring.customer'), value: row.customer?.name || '—' },
      { label: t('recurring.amountLabel'), value: formatRupees(row.amount, lang) },
      { label: t('recurring.paymentMode'), value: t(`recurring.mode.${row.paymentMode}`) },
    ];
    // Only for khata, and only because this is the consequence he cannot see anywhere else
    // on this screen. A cash bill changes no balance and a line saying so would be noise.
    if (onKhata) {
      details.push({
        label: t('recurring.balanceAfter', { name: row.customer?.name || '' }),
        value: `${formatRupees(balanceNow, lang)} → ${formatRupees(balanceNow + (Number(row.amount) || 0), lang)}`,
        tone: 'warn',
      });
    }
    if (plan.dueDate) details.push({ label: t('recurring.forDate'), value: formatDate(plan.dueDate, lang) });
    if (row.store?.name) details.push({ label: t('recurring.branchLabel'), value: row.store.name });

    const ok = await confirm({
      tone: plan.mode === 'extra' ? 'warning' : 'info',
      title: t('recurring.billNowTitle'),
      body: plan.mode === 'extra' ? t('recurring.billNowExtraBody') : t('recurring.billNowBody'),
      details,
      confirmLabel: t('recurring.billNowConfirm'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;

    setBusyId(row._id);
    try {
      const result = await apiFetch(`/api/seller/recurring/${row._id}/run`, {
        method: 'POST',
        body: JSON.stringify({ dueDate: plan.dueDate || undefined }),
      });
      if (result.bill) toast.success(t('recurring.billedToast', { number: result.bill.billNumber }));
      else toast.success(t('recurring.ranToast', { count: result.billed || 0 }));
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function skip(row, dueDate) {
    const ok = await confirm({
      tone: 'warning',
      title: t('recurring.skipTitle'),
      body: t('recurring.skipBody', { date: formatDate(dueDate, lang) }),
      confirmLabel: t('recurring.skipIt'),
    });
    if (!ok) return;
    setBusyId(row._id);
    try {
      await apiFetch(`/api/seller/recurring/${row._id}/skip`, {
        method: 'POST',
        body: JSON.stringify({ dueDate }),
      });
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(row, status) {
    if (status === 'ended') {
      const ok = await confirm({
        tone: 'danger',
        title: t('recurring.stopTitle'),
        body: t('recurring.stopBody'),
        confirmLabel: t('recurring.stopIt'),
      });
      if (!ok) return;
    }
    setBusyId(row._id);
    try {
      await apiFetch(`/api/seller/recurring/${row._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row) {
    const ok = await confirm({
      tone: 'danger',
      title: t('common.delete'),
      body: t('recurring.confirmDelete'),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    setBusyId(row._id);
    try {
      await apiFetch(`/api/seller/recurring/${row._id}`, { method: 'DELETE' });
      toast.success(t('recurring.deleted'));
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function openDetail(row) {
    setBusyId(row._id);
    try {
      const result = await apiFetch(`/api/seller/recurring/${row._id}`);
      setDetail(result);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  /* -------------------------------------------------------------- helpers */

  const customerOptions = useMemo(
    // `c.id`, not `c._id`. The khata API serialises a customer through toSafeObject(), which
    // returns `id` — every other screen that picks a customer reads it that way, and `_id`
    // here made every option's value `undefined`, so nobody could be selected at all.
    () => customers.map((c) => ({ value: c.id, label: c.phone ? `${c.name} — ${c.phone}` : c.name })),
    [customers]
  );
  const productOptions = useMemo(
    () => products.map((p) => ({ value: p._id, label: `${p.name} — ${formatRupees(p.price, lang, { decimals: false })}` })),
    [products, lang]
  );

  function repeatLabel(row) {
    const every = row.interval > 1 ? t('recurring.everyN', { n: row.interval }) : t('recurring.every');
    return `${every} ${t(`recurring.freq.${row.frequency}`)}`;
  }

  function statusBadge(row) {
    if (row.status === 'ended') return <span className="badge badge-inactive">{t('recurring.status.ended')}</span>;
    if (row.status === 'paused') {
      return <span className="badge badge-expired">{t('recurring.status.paused')}</span>;
    }
    if ((row.pending || []).length) {
      return <span className="badge badge-pending">{t('recurring.waitingN', { n: row.pending.length })}</span>;
    }
    return <span className="badge badge-active">{t('recurring.status.active')}</span>;
  }

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('recurring.title')}</h1>
          <p>{t('recurring.subtitle')}</p>
        </div>
        <button type="button" className="btn btn-primary btn-inline" onClick={openNew} disabled={khataLocked}>
          <PlusIcon size={17} />
          {t('recurring.newSchedule')}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {khataLocked && (
        <div className="info-banner">
          {t('recurring.needsKhata')} <Link href="/seller/plan">{t('recurring.seePlans')}</Link>
        </div>
      )}

      <div className="filter-bar">
        <Dropdown
          className="filter-select"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'active', label: t('recurring.status.active') },
            { value: 'paused', label: t('recurring.status.paused') },
            { value: 'ended', label: t('recurring.status.ended') },
            { value: '', label: t('recurring.allSchedules') },
          ]}
        />
      </div>

      {loading && !data ? (
        <SkeletonStats count={4} />
      ) : (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-icon"><RefreshIcon size={16} /></div>
            <div className="stat-value">
              {summary?.active || 0}
              {/* "3 of 10". The plan's cap belongs on the count it caps, where a shop can
                  see the wall while it still has room to plan around it — not saved up for
                  the refusal it gets on the click that hits it. */}
              {cap?.limit != null && <small className="stat-of">{t('recurring.ofLimit', { limit: cap.limit })}</small>}
            </div>
            <div className="stat-label">{t('recurring.status.active')}</div>
          </div>
          {/* The headline. Not "how many schedules" — how many rupees are about to land on
              customers' khatas in the next seven days, which is the only number on this
              screen a shopkeeper plans his week around. */}
          <div className="stat-card">
            <div className="stat-icon"><RupeeIcon size={16} /></div>
            <div className="stat-value">{formatRupees(summary?.dueThisWeek || 0, lang, { decimals: false })}</div>
            <div className="stat-label">{t('recurring.dueThisWeek')}</div>
          </div>
          <div className={`stat-card${summary?.waiting ? ' accent-danger' : ''}`}>
            <div className="stat-icon"><ClockIcon size={16} /></div>
            <div className="stat-value">{summary?.waiting || 0}</div>
            <div className="stat-label">{t('recurring.waitingLabel')}</div>
          </div>
          <div className={`stat-card${summary?.needsAttention ? ' accent-danger' : ''}`}>
            <div className="stat-icon"><AlertIcon size={16} /></div>
            <div className="stat-value">{summary?.needsAttention || 0}</div>
            <div className="stat-label">{t('recurring.needsAttention')}</div>
          </div>
        </div>
      )}

      {waiting.length > 0 && (
        <div className="panel">
          <h2>{t('recurring.waitingTitle')}</h2>
          <p className="cell-sub">{t('recurring.waitingHint')}</p>
          <ol className="booking-list">
            {waiting.map(({ row, dueDate }) => (
              <li key={`${row._id}-${dueDate}`} className="booking">
                <div className="booking-time">
                  <strong>{formatDate(dueDate, lang)}</strong>
                  <small>{repeatLabel(row)}</small>
                </div>
                <div className="booking-body">
                  <div className="booking-head">
                    <span className="booking-name">{row.title || row.customer?.name}</span>
                    <span className="badge badge-pending">{t(`recurring.mode.${row.paymentMode}`)}</span>
                  </div>
                  <p className="cell-sub">{row.customer?.name}{row.customer?.phone ? ` · ${row.customer.phone}` : ''}</p>
                </div>
                <div className="booking-side">
                  <strong>{formatRupees(row.amount, lang)}</strong>
                  <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="icon-btn primary"
                      data-tip={t('recurring.billNow')}
                      disabled={busyId === row._id}
                      onClick={() => billNow(row, dueDate)}
                    >
                      <ReceiptIcon size={17} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      data-tip={t('recurring.skipIt')}
                      disabled={busyId === row._id}
                      onClick={() => skip(row, dueDate)}
                    >
                      <XIcon size={17} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="panel">
        <h2>{t('recurring.listTitle')}</h2>
        {loading ? (
          <SkeletonTable rows={4} cols={4} />
        ) : rows.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="calendar" />
            <p>{t('recurring.empty')}</p>
            <button type="button" className="btn btn-primary btn-small btn-inline" onClick={openNew} disabled={khataLocked}>
              <PlusIcon size={15} />
              {t('recurring.newSchedule')}
            </button>
          </div>
        ) : (
          <ol className="booking-list">
            {rows.map((row) => (
              /* The whole card opens its history.
                 A row carrying a next date, a status, a customer and an amount is asking to
                 be tapped, and the only way in used to be a three-dot menu → "History". The
                 buttons inside it stop propagation, so the tap that means "bill this" is
                 never the tap that means "tell me about this". */
              <li
                key={row._id}
                className={`booking booking-${row.status} rb-row`}
                role="button"
                tabIndex={0}
                onClick={() => openDetail(row)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openDetail(row);
                  }
                }}
              >
                <div className="booking-time">
                  <strong>{row.nextRunAt ? formatDate(row.nextRunAt, lang) : '—'}</strong>
                  <small>{row.nextRunAt ? t('recurring.nextBill') : t('recurring.noNextDate')}</small>
                </div>

                <div className="booking-body">
                  <div className="booking-head">
                    <span className="booking-name">{row.title || row.customer?.name}</span>
                    {statusBadge(row)}
                    <span className="badge badge-inactive">{repeatLabel(row)}</span>
                    <span className="badge badge-inactive">{t(`recurring.mode.${row.paymentMode}`)}</span>
                    {!row.autoBill && <span className="badge badge-pending">{t('recurring.asksFirst')}</span>}
                  </div>
                  <p className="cell-sub">
                    {row.customer?.name}
                    {row.customer?.phone ? ` · ${row.customer.phone}` : ''}
                    {` · ${t('recurring.itemsN', { n: row.itemCount })}`}
                    {row.cyclesDone ? ` · ${t('recurring.billedN', { n: row.cyclesDone })}` : ''}
                    {row.store?.name ? ` · ${row.store.name}` : ''}
                  </p>
                  {/* Why it stopped, on the row that stopped. A schedule that quietly fails
                      every night and says so nowhere is worse than one that never existed. */}
                  {(row.status === 'paused' && row.pauseReason) || row.lastError ? (
                    <p className="field-hint-warn">{row.pauseReason || row.lastError}</p>
                  ) : null}
                </div>

                <div className="booking-side">
                  <strong>{formatRupees(row.amount, lang)}</strong>
                  {/* Anything that ACTS lives in here, and this is where the card's own
                      click stops. Without it, cancelling the RowMenu would open the history
                      the shopkeeper had just decided not to open. */}
                  <div
                    className="row-actions"
                    style={{ justifyContent: 'flex-end' }}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {row.status === 'active' && (
                      <button
                        type="button"
                        className="icon-btn primary"
                        data-tip={t('recurring.billNow')}
                        disabled={busyId === row._id}
                        onClick={() => billNow(row)}
                      >
                        <ReceiptIcon size={17} />
                      </button>
                    )}
                    <RowMenu
                      items={[
                        {
                          label: t('recurring.history'),
                          icon: <ClockIcon size={15} />,
                          onClick: () => openDetail(row),
                        },
                        {
                          label: t('common.edit'),
                          icon: <EditIcon size={15} />,
                          hidden: row.status === 'ended',
                          onClick: () => openEdit(row),
                        },
                        {
                          label: t('recurring.pauseIt'),
                          icon: <ClockIcon size={15} />,
                          hidden: row.status !== 'active',
                          onClick: () => setStatus(row, 'paused'),
                        },
                        {
                          label: t('recurring.resumeIt'),
                          icon: <CheckCircleIcon size={15} />,
                          hidden: row.status !== 'paused',
                          onClick: () => setStatus(row, 'active'),
                        },
                        {
                          label: t('recurring.stopIt'),
                          icon: <XIcon size={15} />,
                          danger: true,
                          hidden: row.status === 'ended',
                          onClick: () => setStatus(row, 'ended'),
                        },
                        {
                          label: t('common.delete'),
                          icon: <TrashIcon size={15} />,
                          danger: true,
                          // Only ever offered on a schedule that has never billed — the
                          // server refuses the rest, and an action that always fails is not
                          // an action.
                          hidden: (row.cyclesDone || 0) > 0,
                          onClick: () => remove(row),
                        },
                      ]}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {formOpen && (
        <Modal
          as="form"
          onSubmit={submit}
          onClose={() => setFormOpen(false)}
          className="modal-tall"
          maxWidth="720px"
          title={editingId ? t('recurring.editTitle') : t('recurring.newSchedule')}
          hint={t('recurring.formHint')}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setFormOpen(false)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting || !form.customerId}>
                {submitting ? t('common.saving') : t('common.save')}
              </button>
            </>
          }
        >
          <div className="form-grid cols-2">
            <div className="field field-span2">
              <label>{t('recurring.customer')}</label>
              {/* The dropdown and the way to fill it, side by side. This form's only required
                  field used to be a list that a brand-new shop had no way to put anything in
                  from here — an empty picker and a Save button that would not press. */}
              <div className="input-action">
                <Dropdown
                  value={form.customerId}
                  onChange={setField('customerId')}
                  options={customerOptions}
                  placeholder={t('recurring.pickCustomer')}
                  searchable
                  searchPlaceholder={t('recurring.searchHint')}
                />
                <button
                  type="button"
                  className="icon-btn"
                  data-tip={t('customerAdd.title')}
                  onClick={() => setAddingCustomer(true)}
                >
                  <PlusIcon size={17} />
                </button>
              </div>
            </div>

            <div className="field field-span2">
              <label>{t('recurring.name')}</label>
              <input
                value={form.title}
                onChange={(e) => setField('title')(e.target.value)}
                placeholder={t('recurring.namePlaceholder')}
                maxLength={120}
              />
            </div>

            <div className="field">
              <label>{t('recurring.repeats')}</label>
              <Dropdown
                value={form.frequency}
                onChange={setField('frequency')}
                options={FREQUENCIES.map((f) => ({ value: f, label: t(`recurring.freq.${f}`) }))}
              />
            </div>

            <div className="field">
              <label>{t('recurring.interval')}</label>
              <input
                type="number"
                min="1"
                max="52"
                value={form.interval}
                onChange={(e) => setField('interval')(e.target.value)}
              />
            </div>

            {form.frequency === 'weekly' && (
              <div className="field">
                <label>{t('recurring.onDay')}</label>
                <Dropdown
                  value={form.weekday}
                  onChange={setField('weekday')}
                  options={WEEKDAYS.map((d) => ({ value: String(d), label: t(`recurring.weekday.${d}`) }))}
                />
              </div>
            )}

            {['monthly', 'quarterly', 'yearly'].includes(form.frequency) && (
              <div className="field">
                <label>{t('recurring.onDate')}</label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={form.dayOfMonth}
                  onChange={(e) => setField('dayOfMonth')(e.target.value)}
                />
                {/* The one rule nobody guesses right, said where the choice is made. */}
                {Number(form.dayOfMonth) > 28 && (
                  <p className="field-hint">{t('recurring.monthEndHint')}</p>
                )}
              </div>
            )}

            {form.frequency === 'yearly' && (
              <div className="field">
                <label>{t('recurring.inMonth')}</label>
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={form.monthOfYear}
                  onChange={(e) => setField('monthOfYear')(e.target.value)}
                />
              </div>
            )}

            <div className="field">
              <label>{t('recurring.startDate')}</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setField('startDate')(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label>{t('recurring.until')}</label>
              <Dropdown
                value={form.endMode}
                onChange={setField('endMode')}
                options={[
                  { value: 'never', label: t('recurring.end.never') },
                  { value: 'onDate', label: t('recurring.end.onDate') },
                  { value: 'afterCount', label: t('recurring.end.afterCount') },
                ]}
              />
            </div>

            {form.endMode === 'onDate' && (
              <div className="field">
                <label>{t('recurring.lastDate')}</label>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setField('endDate')(e.target.value)}
                  required
                />
              </div>
            )}

            {form.endMode === 'afterCount' && (
              <div className="field">
                <label>{t('recurring.howManyBills')}</label>
                <input
                  type="number"
                  min="1"
                  value={form.maxCycles}
                  onChange={(e) => setField('maxCycles')(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="field">
              <label>{t('recurring.paymentMode')}</label>
              <Dropdown
                value={form.paymentMode}
                onChange={setField('paymentMode')}
                options={PAYMENT_MODES.map((m) => ({ value: m, label: t(`recurring.mode.${m}`) }))}
              />
            </div>

            {stores.length > 1 && (
              <div className="field">
                <label>{t('seller.branchList')}</label>
                <Dropdown
                  value={form.storeId}
                  onChange={setField('storeId')}
                  options={stores.map((s) => ({ value: s._id, label: s.name }))}
                  placeholder={t('seller.storesTitle')}
                />
              </div>
            )}

            <div className="field">
              <label>{t('recurring.autoOrAsk')}</label>
              <Dropdown
                value={form.autoBill ? 'auto' : 'ask'}
                onChange={(value) => setField('autoBill')(value === 'auto')}
                options={[
                  { value: 'auto', label: t('recurring.autoBill') },
                  { value: 'ask', label: t('recurring.askFirst') },
                ]}
              />
            </div>

            {/* Real dates, from the server that will run them. */}
            {preview.length > 0 && (
              <div className="field field-span2">
                <label>{t('recurring.nextDates')}</label>
                <div className="chip-row">
                  {preview.map((date) => (
                    <span key={date} className="badge badge-inactive">{formatDate(date, lang)}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <h3 className="section-title">{t('recurring.whatToBill')}</h3>
          {form.items.map((line, index) => (
            <div className="form-grid cols-2" key={index} style={{ marginBottom: '0.6rem' }}>
              <div className="field field-span2">
                <label>{t('recurring.lineItem', { n: index + 1 })}</label>
                <div className="input-action">
                  <Dropdown
                    value={line.productId}
                    onChange={(value) => updateLine(index, { productId: value })}
                    options={[{ value: '', label: t('recurring.customCharge') }, ...productOptions]}
                    placeholder={t('recurring.pickProduct')}
                    searchable
                    searchPlaceholder={t('recurring.searchHint')}
                  />
                  {form.items.length > 1 && (
                    <button
                      type="button"
                      className="icon-btn"
                      data-tip={t('recurring.remove')}
                      onClick={() => removeLine(index)}
                    >
                      <XIcon size={17} />
                    </button>
                  )}
                </div>
              </div>

              {!line.productId && (
                <>
                  <div className="field">
                    <label>{t('recurring.chargeName')}</label>
                    <input
                      value={line.name}
                      onChange={(e) => updateLine(index, { name: e.target.value })}
                      placeholder={t('recurring.chargeNamePlaceholder')}
                    />
                  </div>
                  <div className="field">
                    <label>{t('recurring.rate')}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.price}
                      onChange={(e) => updateLine(index, { price: e.target.value })}
                    />
                  </div>
                </>
              )}

              <div className="field">
                <label>{t('recurring.quantity')}</label>
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={line.quantity}
                  onChange={(e) => updateLine(index, { quantity: e.target.value })}
                />
              </div>
              <div className="field">
                <label>{t('recurring.lineTotal')}</label>
                <input value={formatRupees(lineAmount(line, products), lang)} readOnly />
              </div>
            </div>
          ))}

          <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => addLine(true)}>
            <PlusIcon size={15} />
            {t('recurring.addLine')}
          </button>

          <div className="field" style={{ marginTop: '0.8rem' }}>
            <label>{t('recurring.everyBillWillBe')}</label>
            <input value={formatRupees(formTotal, lang)} readOnly />
          </div>

          <div className="field">
            <label>{t('recurring.notesLabel')}</label>
            <input
              value={form.notes}
              onChange={(e) => setField('notes')(e.target.value)}
              maxLength={500}
            />
          </div>
        </Modal>
      )}

      {addingCustomer && (
        <CustomerQuickAdd
          onClose={() => setAddingCustomer(false)}
          onCreated={(customer) => {
            // Straight into the list AND selected. Making the shopkeeper find the person he
            // just typed in, in a dropdown he just watched fill, is the sort of small
            // rudeness that makes a feature feel unfinished.
            setCustomers((prev) => [customer, ...prev.filter((c) => c.id !== customer.id)]);
            setField('customerId')(customer.id);
          }}
        />
      )}

      {detail && (
        <Modal
          onClose={() => setDetail(null)}
          className="rb-sheet"
          maxWidth={640}
          title={detail.recurring.title || detail.recurring.customer?.name}
          hint={`${repeatLabel(detail.recurring)} · ${t(`recurring.mode.${detail.recurring.paymentMode}`)}`}
          footer={
            <>
              {detail.recurring.status !== 'ended' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-inline"
                  onClick={() => {
                    const row = rows.find((r) => r._id === detail.recurring._id) || detail.recurring;
                    setDetail(null);
                    openEdit(row);
                  }}
                >
                  <EditIcon size={17} /> {t('common.edit')}
                </button>
              )}
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setDetail(null)}>
                {t('common.close')}
              </button>
            </>
          }
        >
          {/* The three facts, before anything else: what it is worth, when it goes next, and
              whether it is running at all. A history sheet that opens on a list of line items
              makes the shopkeeper read before he knows what he is looking at. */}
          <div className="rb-head">
            <div className="rb-head-money">
              <span className="rb-head-label">{t('recurring.everyBillWillBe')}</span>
              <strong>{formatRupees(detail.recurring.amount, lang)}</strong>
            </div>
            <div className="rb-head-side">
              {statusBadge(detail.recurring)}
              {detail.recurring.nextRunAt && (
                <span className="rb-head-next">
                  {t('recurring.nextBill')} · <strong>{formatDate(detail.recurring.nextRunAt, lang)}</strong>
                </span>
              )}
            </div>
          </div>

          <div className="rb-stats">
            <div className="rb-stat">
              <span>{formatRupees(detail.billedTotal, lang, { decimals: false })}</span>
              <small>{t('recurring.billedSoFar')}</small>
            </div>
            <div className="rb-stat">
              <span>{detail.recurring.cyclesDone || 0}</span>
              <small>{t('recurring.billsMade')}</small>
            </div>
            <div className="rb-stat">
              <span>{detail.recurring.customer?.name || '—'}</span>
              <small>{t('recurring.customer')}</small>
            </div>
          </div>

          {(detail.recurring.pauseReason || detail.recurring.lastError) && (
            <p className="rb-alert">
              <AlertIcon size={15} />
              <span>{detail.recurring.pauseReason || detail.recurring.lastError}</span>
            </p>
          )}

          <h3 className="rb-title">{t('recurring.whatToBill')}</h3>
          <div className="rb-items">
            {(detail.recurring.items || []).map((line, i) => (
              <div className="rb-item" key={i}>
                <span className="rb-item-name">{line.name}</span>
                <span className="rb-item-qty">
                  {line.quantity} {line.unit}
                </span>
                <span className="rb-item-amt">{formatRupees(line.lineTotal, lang)}</span>
              </div>
            ))}
            <div className="rb-item rb-item-total">
              <span className="rb-item-name">{t('common.total')}</span>
              <span className="rb-item-qty" />
              <span className="rb-item-amt">{formatRupees(detail.recurring.amount, lang)}</span>
            </div>
          </div>

          {detail.recurring.upcoming?.length > 0 && (
            <>
              <h3 className="rb-title">{t('recurring.nextDates')}</h3>
              <div className="rb-chips">
                {detail.recurring.upcoming.map((date) => (
                  <span key={date} className="rb-chip">{formatDate(date, lang)}</span>
                ))}
              </div>
            </>
          )}

          {/* One chronological story instead of two lists side by side. Every run is a dot
              coloured by what happened, and a run that produced a bill carries the bill
              number as a link — so "which bills did this write" is answered inside the
              sequence rather than in a second list the reader has to cross-reference. */}
          <h3 className="rb-title">{t('recurring.runLog')}</h3>
          {(detail.recurring.runs || []).length === 0 ? (
            <p className="rb-empty">{t('recurring.noRunsYet')}</p>
          ) : (
            <ol className="rb-timeline">
              {detail.recurring.runs.map((run, i) => (
                <li key={i} className={`rb-run is-${run.status}`}>
                  <span className="rb-run-dot" />
                  <div className="rb-run-body">
                    <div className="rb-run-top">
                      <strong>{formatDate(run.dueDate, lang)}</strong>
                      <span className="rb-run-tag">{t(`recurring.run.${run.status}`)}</span>
                      {run.amount != null && (
                        <span className="rb-run-amt">{formatRupees(run.amount, lang)}</span>
                      )}
                    </div>
                    {(run.message || run.bill) && (
                      <p className="rb-run-note">
                        {run.bill && (
                          <Link href={recordHref('/seller/invoice/[id]', run.bill)} onClick={() => setDetail(null)}>
                            #{run.billNumber}
                          </Link>
                        )}
                        {run.bill && run.message ? ' · ' : ''}
                        {run.message}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {detail.bills.length > 0 && (
            <>
              <h3 className="rb-title">{t('recurring.billsWritten')}</h3>
              <div className="rb-chips">
                {detail.bills.map((bill) => (
                  <Link
                    key={bill._id}
                    href={recordHref('/seller/invoice/[id]', bill._id)}
                    className={`rb-chip rb-chip-link${bill.status === 'cancelled' ? ' is-void' : ''}`}
                    onClick={() => setDetail(null)}
                  >
                    #{bill.billNumber} · {formatRupees(bill.total, lang, { decimals: false })}
                  </Link>
                ))}
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
