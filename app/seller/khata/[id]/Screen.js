'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouteId } from '../../../../lib/routeId';
import Link from 'next/link';
import { apiFetch, downloadFile } from '../../../../lib/api';
import { recordKhataEntry, openReceipt, spanLabel, paybackTone } from '../../../../lib/khata';
import { useLanguage } from '../../../components/LanguageProvider';
import Illustration from '../../../components/Illustration';
import { useConfirm } from '../../../components/ConfirmDialog';
import { SkeletonCards, SkeletonTable } from '../../../components/Skeleton';
import {
  PlusIcon,
  TrashIcon,
  EditIcon,
  XIcon,
  DownloadIcon,
  ChatIcon,
  CheckIcon,
  WhatsappIcon,
  ExcelIcon,
  PdfIcon,
  HandCoinsIcon,
  LedgerIcon,
  ChevronRightIcon,
} from '../../../components/Icons';
import { useDashboardStores } from '../../../components/DashboardShell';
import Dropdown from '../../../components/Dropdown';
import Modal from '../../../components/Modal';
import AnimatedAmount from '../../../components/AnimatedAmount';
import CustomerFormModal from '../../../components/CustomerFormModal';
import WhatsappSheet from '../../../components/WhatsappSheet';
import { recordHref } from '../../../../lib/routeId';

const REMINDER_TONES = ['friendly', 'gentle', 'firm'];
const TONE_KEY = { friendly: 'seller.toneFriendly', gentle: 'seller.toneGentle', firm: 'seller.toneFirm' };
const PAY_MODES = ['cash', 'upi', 'card', 'bank'];

function initials(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Rupees with Indian grouping — "₹1,20,000", never "₹120000".
function inr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

export default function CustomerLedgerPage() {
  const id = useRouteId();
  const { t } = useLanguage();
  // Branch names on ledger rows are only worth printing for a shop that HAS branches.
  const { stores } = useDashboardStores();
  const multiBranch = (stores?.length || 0) > 1;
  const confirm = useConfirm();
  const [customer, setCustomer] = useState(null);
  // Bumped on each successful payment; used as a remount key so the balance replays its
  // "money landed" animation every time rather than only on the first one.
  const [paidPulse, setPaidPulse] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [aging, setAging] = useState(null);
  // Who this customer IS to the shop — since when, how much they have ever bought, how fast
  // they clear. See the `profile` block in backend/controllers/customerController.js.
  const [profile, setProfile] = useState(null);
  const [pageInfo, setPageInfo] = useState({ page: 1, pageCount: 1, total: 0 });
  const [ledgerFilter, setLedgerFilter] = useState({ type: 'all', from: '', to: '', page: 1 });
  const [form, setForm] = useState({ type: 'payment', amount: '', note: '', paymentMode: 'cash' });
  // The payment/credit form lives in a popup now, not a panel that sat open on every visit.
  const [entryOpen, setEntryOpen] = useState(false);
  // Shown inside the popup — the page banner sits behind the overlay where nobody would see it.
  const [entryError, setEntryError] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [promiseDate, setPromiseDate] = useState('');
  const [promiseNote, setPromiseNote] = useState('');
  const [savingPromise, setSavingPromise] = useState(false);
  // A tailor's chest/waist/length, a salon's preferred hair colour — whatever this shop
  // needs to remember about this one customer. Freeform label/value rows, not a fixed
  // set of fields, since no single garment or trade fits every shop that uses this.
  const [measurements, setMeasurements] = useState([]);
  const [savingMeasurements, setSavingMeasurements] = useState(false);
  const [recovery, setRecovery] = useState(null);
  const [reminderTone, setReminderTone] = useState('gentle');
  const [sendingReminder, setSendingReminder] = useState('');
  // The open WhatsApp send sheet, or null. See components/WhatsappSheet.js.
  const [waSheet, setWaSheet] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingLimit, setSavingLimit] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  // The full ledger opens in a popup; the page only carries a one-line bar for it.
  const [historyOpen, setHistoryOpen] = useState(false);
  // Totals for whatever the history popup is filtered to, across all pages (server-computed).
  const [rangeSummary, setRangeSummary] = useState(null);
  // Bumped on every reload so the per-bill list (a child component) refetches
  // whenever a payment here changes bill settlement via FIFO allocation.
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setReloadKey((k) => k + 1);
    const params = new URLSearchParams({ page: String(ledgerFilter.page), limit: '50' });
    if (ledgerFilter.type !== 'all') params.set('type', ledgerFilter.type);
    if (ledgerFilter.from) params.set('from', ledgerFilter.from);
    if (ledgerFilter.to) params.set('to', ledgerFilter.to);

    apiFetch(`/api/seller/khata/customers/${id}?${params.toString()}`)
      .then((data) => {
        setCustomer(data.customer);
        setTransactions(data.transactions);
        setSummary(data.summary || null);
        setAging(data.aging || null);
        setProfile(data.profile || null);
        setPageInfo(data.page || { page: 1, pageCount: 1, total: 0 });
        setRangeSummary(data.rangeSummary || null);
        setCreditLimit(String(data.customer.creditLimit || 0));
        setPromiseDate(data.customer.promiseToPayDate ? data.customer.promiseToPayDate.slice(0, 10) : '');
        setPromiseNote(data.customer.promiseNote || '');
        setMeasurements(data.customer.measurements?.length ? data.customer.measurements : []);
        setRecovery(data.recovery || null);
        if (data.recovery?.suggestedTone) setReminderTone(data.recovery.suggestedTone);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, ledgerFilter]);

  useEffect(() => {
    load();
  }, [load]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  // Dropdown hands back a value directly instead of an event.
  function setField(field) {
    return (value) => setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setEntryError('');
    setNotice('');
    setSubmitting(true);

    try {
      const data = await recordKhataEntry({
        customerId: id,
        type: form.type,
        amount: Number(form.amount),
        note: form.note,
        paymentMode: form.paymentMode,
        confirm,
        t,
      });
      // null means the shopkeeper said "no" to the over-limit or advance question. Nothing
      // was recorded and nothing is wrong — leave the form exactly as he typed it.
      if (!data) return;
      // Moment 2 — money arriving is the good news on this screen, so only a payment
      // gets the flourish. Recording fresh credit is the balance going the wrong way;
      // celebrating that would read as sarcasm.
      if (form.type === 'payment') setPaidPulse((n) => n + 1);
      setForm({ type: 'payment', amount: '', note: '', paymentMode: 'cash' });
      setEntryOpen(false);
      load();

      if (data.receipt) {
        const share = await confirm({
          tone: 'success',
          title: t('seller.receiptTitle'),
          body: t('seller.receiptBody', { name: data.customer.name }),
          confirmLabel: t('seller.sendReceipt'),
          cancelLabel: t('common.close'),
        });
        if (share) openReceipt(data.receipt);
      }
    } catch (err) {
      setEntryError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function openEntry(type) {
    setForm((f) => ({ ...f, type }));
    setEntryError('');
    setEntryOpen(true);
  }

  /**
   * Removing an entry that should never have been there.
   *
   * Asks for a reason, and keeps it: the whole value of allowing a correction is that the
   * correction itself is written down. A khata where money can quietly disappear is worse
   * than one that cannot be corrected at all.
   */
  async function handleDeleteEntry(txn) {
    const answer = await confirm({
      tone: 'danger',
      title: t('seller.deleteEntryTitle'),
      body: t('seller.deleteEntryBody'),
      details: [
        { label: t('common.date'), value: new Date(txn.createdAt).toLocaleDateString('en-IN') },
        {
          label: txn.type === 'credit' ? t('seller.recordCredit') : t('seller.recordPayment'),
          value: `₹${txn.amount}`,
          tone: 'danger',
        },
      ],
      input: { label: t('seller.deleteEntryReason'), placeholder: t('seller.deleteEntryReasonHint') },
      confirmLabel: t('common.delete'),
    });
    if (!answer) return;
    setError('');
    try {
      await apiFetch(`/api/seller/khata/customers/${id}/transactions/${txn._id}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason: answer.value || '' }),
      });
      setNotice(t('seller.entryDeleted'));
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveLimit() {
    setSavingLimit(true);
    setError('');
    try {
      const data = await apiFetch(`/api/seller/khata/customers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ creditLimit: Number(creditLimit) || 0 }),
      });
      setCustomer(data.customer);
      setNotice(t('seller.saved'));
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingLimit(false);
    }
  }

  async function handleSavePromise() {
    if (!promiseDate) return;
    setSavingPromise(true);
    setError('');
    try {
      const data = await apiFetch(`/api/seller/khata/customers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ promiseToPayDate: promiseDate, promiseNote }),
      });
      setCustomer(data.customer);
      setNotice(t('seller.saved'));
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingPromise(false);
    }
  }

  function addMeasurementRow() {
    setMeasurements((rows) => [...rows, { label: '', value: '' }]);
  }

  function updateMeasurementRow(index, field, val) {
    setMeasurements((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: val } : row)));
  }

  function removeMeasurementRow(index) {
    setMeasurements((rows) => rows.filter((_, i) => i !== index));
  }

  async function handleSaveMeasurements() {
    setSavingMeasurements(true);
    setError('');
    try {
      const data = await apiFetch(`/api/seller/khata/customers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ measurements: measurements.filter((row) => row.label.trim()) }),
      });
      setCustomer(data.customer);
      setMeasurements(data.customer.measurements || []);
      setNotice(t('seller.saved'));
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingMeasurements(false);
    }
  }

  /**
   * On-demand reminder for THIS customer — works any time, no 7-day wait.
   *
   * SMS only now. WhatsApp used to come through here as well and it should not have: it
   * fired the send route and *then* opened WhatsApp, so the ReminderLog said a reminder had
   * gone out a full beat before the shopkeeper had even seen the sentence, let alone
   * pressed send. WhatsApp goes through the sheet below, which shows the message first.
   */
  async function handleSendReminder(channel) {
    setSendingReminder(channel);
    setError('');
    try {
      await apiFetch(`/api/seller/khata/customers/${id}/remind`, {
        method: 'POST',
        body: JSON.stringify({ channel, tone: reminderTone }),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingReminder('');
    }
  }

  /**
   * Opens the send sheet for the tone the shopkeeper picked.
   *
   * Both paths end at the same route. Where the shop has a Business API account the sheet
   * POSTs it and the message goes; where it does not, that same route still answers 200
   * having written the ReminderLog row, reports `sent: false`, and the sheet falls through
   * to the link — which is why `onOpened` fires it on the manual path too. One route, one
   * log row, whichever way the message ended up travelling.
   */
  function openReminderSheet() {
    if (!recovery) return;
    setWaSheet({
      title: t('wa.sendReminder'),
      to: { name: customer?.name, phone: customer?.phone },
      message: recovery.messages?.[reminderTone],
      link: recovery.whatsapp?.[reminderTone],
      auto: recovery.whatsappAuto,
      appLink: recovery.appLink,
      endpoint: {
        url: `/api/seller/khata/customers/${id}/remind`,
        body: { channel: 'whatsapp', tone: reminderTone },
      },
      onOpened: () => handleSendReminder('whatsapp'),
      onSent: () => load(),
    });
  }

  async function handleClearPromise() {
    setSavingPromise(true);
    setError('');
    try {
      const data = await apiFetch(`/api/seller/khata/customers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ promiseToPayDate: '' }),
      });
      setCustomer(data.customer);
      setPromiseDate('');
      setPromiseNote('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingPromise(false);
    }
  }

  if (loading && !customer) {
    return (
      <>
        <SkeletonCards count={1} height={150} />
        <SkeletonTable rows={5} cols={3} />
      </>
    );
  }

  const filtersOn = ledgerFilter.type !== 'all' || ledgerFilter.from || ledgerFilter.to;

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="info-banner">{notice}</div>}

      <div className="panel customer-hero">
        <div className="customer-hero-left">
          {customer?.photoUrl ? (
            <img src={customer.photoUrl} alt="" className="customer-hero-avatar" />
          ) : (
            <div className="avatar-initials customer-hero-avatar">{initials(customer?.name)}</div>
          )}
          <div>
            <h1 style={{ margin: '0 0 0.2rem', fontSize: 'var(--fs-xl)' }}>
              {customer?.name}
              {customer?.isActive === false && (
                <span className="badge badge-inactive" style={{ marginLeft: '0.5rem' }}>{t('seller.khataClosed')}</span>
              )}
            </h1>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>
              {customer?.phone}
              {customer?.gstin ? ` · ${customer.gstin}` : ''}
            </p>
            <div className="row-actions" style={{ marginTop: '0.45rem' }}>
              <button type="button" className="icon-btn" data-tip={t('common.edit')} onClick={() => setShowProfile(true)}>
                <EditIcon size={17} />
              </button>
              <button
                type="button"
                className="icon-btn"
                data-tip={t('seller.downloadStatement')}
                onClick={() =>
                  downloadFile(
                    `/api/seller/khata/customers/${id}/statement?format=xlsx`,
                    `khata-${customer?.name || 'customer'}.xlsx`
                  ).catch((err) => setError(err.message))
                }
              >
                <DownloadIcon size={17} />
              </button>
              <button type="button" className="btn btn-primary btn-small" style={{ width: 'auto' }} onClick={() => openEntry('payment')}>
                <HandCoinsIcon size={15} /> {t('seller.recordPayment')}
              </button>
              <button type="button" className="btn btn-secondary btn-small" style={{ width: 'auto' }} onClick={() => openEntry('credit')}>
                <PlusIcon size={15} /> {t('seller.recordCredit')}
              </button>
            </div>
          </div>
        </div>
        <div
          key={paidPulse}
          className={`customer-hero-balance${paidPulse > 0 ? ' moment-money moment-money-glow' : ''}`}
          style={{ position: 'relative' }}
        >
          <div className="stat-label">{t('seller.balance')}</div>
          <div className={`customer-hero-amount ${customer?.balance > 0 ? 'owed' : 'clear'}`}>
            <AnimatedAmount value={customer?.balance ?? 0} />
          </div>
          {/* How old that money is. The balance alone never said whether this was last
              week's shopping or a debt from Diwali, which is the only part that decides
              what the shopkeeper does about it. */}
          {aging?.outstanding > 0 && (
            <span
              className={`badge ${aging.oldestDays > 90 ? 'badge-expired' : aging.oldestDays > 30 ? 'badge-expiring' : 'badge-inactive'}`}
              style={{ marginTop: '0.4rem', display: 'inline-block' }}
            >
              {t('seller.oldestDues', { days: aging.oldestDays })}
            </span>
          )}
          {customer?.promiseToPayDate && (
            <span
              className={`badge ${new Date(customer.promiseToPayDate) <= new Date(new Date().setHours(23, 59, 59, 999)) ? 'badge-expired' : 'badge-expiring'}`}
              style={{ marginTop: '0.4rem', display: 'inline-block' }}
            >
              {t('seller.promiseChip', { date: new Date(customer.promiseToPayDate).toLocaleDateString() })}
              {customer.promiseSetBy === 'customer' ? ` · ${t('seller.promiseByCustomer')}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Who this customer is to the shop, not just what they owe.
          The balance above answers "kitna baaki hai". This answers the question the
          shopkeeper is actually deciding at the counter — "isko phir se udhaar doon?" — and
          it is the half he was previously doing from memory: kabse aata hai, kitna kharida
          hai, aakhri baar kab aaya, paise kitne din mein deta hai.
          Rendered for a brand-new customer too, with dashes where there is no history yet:
          a panel that appears only once somebody has taken udhaar is a panel nobody
          discovers on the day they open the khata. */}
      {profile && (
        <div className="panel khata-summary">
          <h2 className="khata-summary-head">{t('seller.customerProfile')}</h2>
          <div className="khata-summary-grid">
            <div>
              <span className="stat-label">{t('seller.customerSince')}</span>
              <strong className="khata-summary-value">
                {new Date(profile.since).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
              </strong>
              <span className="khata-summary-hint">{spanLabel(profile.daysKnown, t)}</span>
            </div>
            <div>
              <span className="stat-label">{t('seller.totalBusiness')}</span>
              <strong className="khata-summary-value">₹{profile.business.toLocaleString('en-IN')}</strong>
              <span className="khata-summary-hint">
                {profile.bills
                  ? t('seller.billsAvg', { bills: profile.bills, amount: Math.round(profile.avgBill).toLocaleString('en-IN') })
                  : t('seller.noBillsYet')}
              </span>
            </div>
            <div>
              <span className="stat-label">{t('seller.lastVisit')}</span>
              <strong className="khata-summary-value">
                {profile.lastBillAt ? new Date(profile.lastBillAt).toLocaleDateString('en-IN') : '—'}
              </strong>
              <span className="khata-summary-hint">
                {profile.khataBills
                  ? t('seller.onUdhaarCount', { count: profile.khataBills })
                  : t('seller.alwaysPaidUpfront')}
              </span>
            </div>
            {/* The one number that decides whether the balance above is a working capital
                cycle or money the shop has quietly lost. */}
            <div>
              <span className="stat-label">{t('seller.paybackSpeed')}</span>
              {profile.payback ? (
                <>
                  <strong className={`khata-summary-value payback-${paybackTone(profile.payback)}`}>
                    {t('seller.inDays', { count: profile.payback.avgDays })}
                  </strong>
                  <span className="khata-summary-hint">
                    {t('seller.clearedLots', { count: profile.payback.cleared })}
                    {profile.payback.slowestDays > profile.payback.avgDays
                      ? ` · ${t('seller.slowestDays', { count: profile.payback.slowestDays })}`
                      : ''}
                  </span>
                </>
              ) : (
                <>
                  <strong className="khata-summary-value">—</strong>
                  <span className="khata-summary-hint">{t('seller.nothingClearedYet')}</span>
                </>
              )}
            </div>
          </div>

          {/* The khata half, kept as its own row: "₹84,000 liya, ₹71,500 diya" separates a
              good customer having a bad month from a bad customer. */}
          {summary && summary.entryCount > 0 && (
            <div className="khata-summary-grid khata-summary-second">
              <div>
                <span className="stat-label">{t('seller.lifetimeCredit')}</span>
                <strong className="khata-summary-value">₹{summary.totalCredit.toLocaleString('en-IN')}</strong>
              </div>
              <div>
                <span className="stat-label">{t('seller.lifetimePaid')}</span>
                <strong className="khata-summary-value is-good">₹{summary.totalPaid.toLocaleString('en-IN')}</strong>
                {summary.totalCredit > 0 && (
                  <span className="khata-summary-hint">
                    {t('seller.recoveredPct', { pct: Math.min(100, Math.round((summary.totalPaid / summary.totalCredit) * 100)) })}
                  </span>
                )}
              </div>
              <div>
                <span className="stat-label">{t('seller.entriesCount')}</span>
                <strong className="khata-summary-value">{summary.entryCount}</strong>
                <span className="khata-summary-hint">
                  {t('seller.firstEntryOn', { date: new Date(summary.firstAt).toLocaleDateString('en-IN') })}
                </span>
              </div>
              <div>
                <span className="stat-label">{t('seller.lastPaidOn')}</span>
                <strong className="khata-summary-value">
                  {summary.lastPaymentAt ? new Date(summary.lastPaymentAt).toLocaleDateString('en-IN') : '—'}
                </strong>
              </div>
            </div>
          )}
        </div>
      )}

      {entryOpen && (
        <Modal
          as="form"
          onSubmit={handleSubmit}
          onClose={() => setEntryOpen(false)}
          title={form.type === 'credit' ? t('seller.recordCredit') : t('seller.recordPayment')}
          hint={customer?.name}
          maxWidth={520}
          footer={
            <>
              <button type="submit" className="btn btn-primary btn-inline" disabled={submitting}>
                {t('common.save')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setEntryOpen(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
          {entryError && <div className="error-banner">{entryError}</div>}
          <div className="form-grid cols-2">
            <div className="field">
              <label htmlFor="type">{t('seller.entryType')}</label>
              <Dropdown
                id="type"
                value={form.type}
                onChange={setField('type')}
                options={[
                  { value: 'payment', label: t('seller.recordPayment') },
                  { value: 'credit', label: t('seller.recordCredit') },
                ]}
              />
            </div>
            <div className="field">
              <label htmlFor="amount">{t('seller.amount')}</label>
              <input id="amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={update('amount')} required autoFocus />
            </div>
            {/* Only on money coming IN. Credit given has no tender — that is the point of it —
                and asking for one used to put every manual udhaar entry into the day book as
                cash the shop never took. */}
            {form.type === 'payment' && (
              <div className="field">
                <label htmlFor="entry-mode">{t('seller.payMode')}</label>
                <Dropdown
                  id="entry-mode"
                  value={form.paymentMode}
                  onChange={setField('paymentMode')}
                  options={PAY_MODES.map((m) => ({ value: m, label: t(`payMode.${m}`) }))}
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="note">{t('seller.note')}</label>
              <input id="note" value={form.note} onChange={update('note')} maxLength={200} />
            </div>
          </div>
        </Modal>
      )}

      {/* The ledger at a glance: the last three entries on the page, the whole thing one tap
          away. Sits above the reminder so "what happened last" is read before "what to send". */}
      <div className="panel ledger-history-card">
        <div className="lh-head">
          <span className="lh-icon">
            <LedgerIcon size={20} />
          </span>
          <div className="lh-title">
            <h2>{t('seller.transactionHistory')}</h2>
            <span>
              {!filtersOn && pageInfo.total > 0 ? `${t('seller.kbEntries', { count: pageInfo.total })} · ` : ''}
              {t('seller.kbHistoryHint')}
            </span>
          </div>
          <button type="button" className="btn btn-secondary btn-small btn-inline lh-open" onClick={() => setHistoryOpen(true)}>
            {t('seller.kbViewHistory')} <ChevronRightIcon size={15} />
          </button>
        </div>

        {!filtersOn && transactions.length > 0 && (
          <>
            <div className="lh-recent-label">{t('seller.kbRecent')}</div>
            <ul className="lh-recent">
              {transactions.slice(0, 3).map((txn) => (
                <li key={txn._id}>
                  <button type="button" className="lh-row" onClick={() => setHistoryOpen(true)}>
                    <span className={`lh-dot${txn.type === 'credit' ? ' is-credit' : ''}`} />
                    <span className="lh-what">
                      <strong>{txn.type === 'credit' ? t('seller.recordCredit') : t('seller.recordPayment')}</strong>
                      <span>
                        {new Date(txn.createdAt).toLocaleDateString('en-IN')}
                        {txn.type === 'payment' && txn.paymentMode ? ` · ${t(`payMode.${txn.paymentMode}`)}` : ''}
                        {txn.relatedBill ? ` · ${t('seller.fromBill')}` : ''}
                        {txn.note ? ` · ${txn.note}` : ''}
                      </span>
                    </span>
                    <span className="lh-amt">
                      <strong className={txn.type === 'credit' ? 'is-credit' : 'is-payment'}>
                        {txn.type === 'credit' ? '+' : '−'}{inr(txn.amount)}
                      </strong>
                      <span>{t('seller.runningBalance')}: {inr(txn.balanceAfter)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {recovery && (
        <div className="panel">
          <div className="section-toolbar" style={{ marginBottom: '0.4rem' }}>
            <h2>{t('seller.remindNowTitle')}</h2>
            <span className="badge badge-expiring">{recovery.daysSince}d</span>
          </div>
          <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: '0.8rem', fontSize: 'var(--fs-base)' }}>
            {t('seller.remindNowHint')}
          </p>

          <div className="reminder-tones">
            <span className="reminder-tones-label">{t('seller.recoveryTone')}:</span>
            {REMINDER_TONES.map((tn) => (
              <button
                key={tn}
                type="button"
                className={`chip${reminderTone === tn ? ' active' : ''}`}
                onClick={() => setReminderTone(tn)}
              >
                {t(TONE_KEY[tn])}
                {recovery.suggestedTone === tn ? ` · ${t('seller.toneSuggested')}` : ''}
              </button>
            ))}
          </div>

          <div className="reminder-preview">
            <div className="reminder-preview-label">{t('seller.messagePreview')}</div>
            <p>{recovery.messages?.[reminderTone]}</p>
          </div>

          <div className="row-actions">
            <button className="btn btn-primary btn-small" style={{ width: 'auto' }} onClick={openReminderSheet}>
              <WhatsappIcon size={17} /> {t('seller.sendWhatsapp')}
            </button>
            <button className="btn btn-secondary btn-small" style={{ width: 'auto' }} disabled={sendingReminder === 'sms'} onClick={() => handleSendReminder('sms')}>
              <ChatIcon size={15} /> {t('seller.sendSms')}
            </button>
          </div>
        </div>
      )}

      <KhataBills customerId={id} t={t} onChanged={load} reloadKey={reloadKey} confirm={confirm} />
      <KhataCorrections customerId={id} t={t} reloadKey={reloadKey} />

      {historyOpen && (
        <LedgerHistoryModal
          t={t}
          customer={customer}
          transactions={transactions}
          pageInfo={pageInfo}
          rangeSummary={rangeSummary}
          filter={ledgerFilter}
          setFilter={setLedgerFilter}
          loading={loading}
          multiBranch={multiBranch}
          onEdit={setEditingEntry}
          onDelete={handleDeleteEntry}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      <StatementPanel customerId={id} customerName={customer?.name} t={t} onError={setError} />

      {/* Credit limit, pay-by date and the shop's own notes about this person. Three settings
          that used to be three full-width panels the shopkeeper scrolled past every single
          time to reach the ledger, for something he changes once a year. */}
      <div className="panel">
        <div className="section-toolbar" style={{ marginBottom: 0 }}>
          <h2 style={{ margin: 0 }}>{t('seller.customerSettings')}</h2>
        </div>

        <div className="form-subhead">{t('seller.creditLimit')}</div>
        <div className="form-grid cols-2">
          <div className="field">
            <label htmlFor="limit">{t('seller.creditLimit')}</label>
            <div className="input-action">
              <input id="limit" type="number" min="0" step="0.01" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
              <button type="button" className="btn btn-secondary btn-small" style={{ width: 'auto' }} onClick={handleSaveLimit} disabled={savingLimit}>
                {t('common.save')}
              </button>
            </div>
            <span className="field-hint">{t('seller.creditLimitHint')}</span>
          </div>
        </div>

        <div className="form-subhead">{t('seller.promiseTitle')}</div>
        <div className="form-grid cols-2">
          <div className="field">
            <label htmlFor="promiseDate">{t('seller.promiseDate')}</label>
            <input
              id="promiseDate"
              type="date"
              min={today()}
              value={promiseDate}
              onChange={(e) => setPromiseDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="promiseNote">{t('seller.promiseNoteLabel')}</label>
            <input id="promiseNote" value={promiseNote} onChange={(e) => setPromiseNote(e.target.value)} maxLength={200} />
          </div>
        </div>
        <div className="row-actions" style={{ marginTop: '0.4rem' }}>
          <button className="btn btn-secondary btn-small" style={{ width: 'auto' }} onClick={handleSavePromise} disabled={savingPromise || !promiseDate}>
            {t('seller.savePromise')}
          </button>
          {customer?.promiseToPayDate && (
            <button className="btn btn-secondary btn-small" style={{ width: 'auto' }} onClick={handleClearPromise} disabled={savingPromise}>
              {t('seller.clearPromise')}
            </button>
          )}
        </div>

        <div className="form-subhead">{t('seller.measurementsTitle')}</div>
        <p className="field-hint" style={{ marginTop: 0, marginBottom: '0.6rem' }}>{t('seller.measurementsHint')}</p>
        {measurements.map((row, i) => (
          <div key={i} className="row-actions" style={{ marginBottom: '0.5rem', alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, minWidth: '120px', marginBottom: 0 }}>
              <label>{t('seller.measurementLabel')}</label>
              <input value={row.label} onChange={(e) => updateMeasurementRow(i, 'label', e.target.value)} placeholder={t('seller.measurementLabelPlaceholder')} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '100px', marginBottom: 0 }}>
              <label>{t('seller.measurementValue')}</label>
              <input value={row.value} onChange={(e) => updateMeasurementRow(i, 'value', e.target.value)} />
            </div>
            <button type="button" className="icon-btn danger" data-tip={t('common.delete')} onClick={() => removeMeasurementRow(i)}>
              <TrashIcon size={17} />
            </button>
          </div>
        ))}
        <div className="row-actions" style={{ marginTop: '0.4rem' }}>
          <button type="button" className="btn btn-secondary btn-small" style={{ width: 'auto' }} onClick={addMeasurementRow}>
            <PlusIcon size={15} /> {t('seller.addMeasurement')}
          </button>
          <button type="button" className="btn btn-secondary btn-small" style={{ width: 'auto' }} onClick={handleSaveMeasurements} disabled={savingMeasurements}>
            {t('common.save')}
          </button>
        </div>
      </div>

      {showProfile && customer && (
        <CustomerFormModal
          customer={customer}
          onClose={() => setShowProfile(false)}
          onSaved={(saved) => {
            setCustomer(saved);
            load();
          }}
        />
      )}

      {editingEntry && (
        <EditEntryModal
          customerId={id}
          txn={editingEntry}
          t={t}
          onClose={() => setEditingEntry(null)}
          onSaved={() => {
            setEditingEntry(null);
            setNotice(t('seller.entryUpdated'));
            load();
          }}
        />
      )}

      {waSheet && <WhatsappSheet {...waSheet} onClose={() => setWaSheet(null)} />}
    </>
  );
}

/**
 * Correcting one entry — amount, mode, note.
 *
 * Deliberately a small box with three fields and no date. Moving an entry to a different day
 * would silently move money between two days' takings that have already been counted and
 * reported, which is a different and much larger promise than fixing a mistyped figure.
 */
/**
 * Entries taken off (or changed on) this khata — struck through in red, with the amount, who
 * did it, when and why.
 *
 * The server always kept this record (and recounts the balance from what survives), but no
 * screen showed it to the shop, so a deleted ₹2,000 udhaar simply vanished from the page. A
 * customer who says "maine to diya tha" and an owner who asks "ye entry kisne hatai" both
 * get their answer here.
 */
function KhataCorrections({ customerId, t, reloadKey }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let alive = true;
    apiFetch(`/api/seller/khata/customers/${customerId}/corrections`)
      .then((data) => alive && setRows(data.corrections || []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [customerId, reloadKey]);
  if (!rows.length) return null;
  return (
    <div className="panel khata-corrections">
      <h3 className="khata-corrections-title">{t('seller.khataCorrectionsTitle')}</h3>
      <ul className="khata-corrections-list">
        {rows.map((row) => {
          const m = row.meta || {};
          const deleted = row.action === 'khata.entry.deleted';
          const kind = (m.type || m.before?.type) === 'credit' ? t('seller.recordCredit') : t('seller.recordPayment');
          const amount = m.amount ?? m.before?.amount;
          return (
            <li key={row.id} className={deleted ? 'is-deleted' : 'is-edited'}>
              <span className="khata-corrections-what">
                {kind} {amount != null ? inr(amount) : ''}
                {deleted ? '' : m.after?.amount != null ? ` → ${inr(m.after.amount)}` : ''}
              </span>
              <span className="khata-corrections-who">
                {t(deleted ? 'seller.khataEntryDeletedBy' : 'seller.khataEntryEditedBy', {
                  name: row.by || '—',
                  time: new Date(row.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
                })}
                {m.reason ? ` · ${m.reason}` : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EditEntryModal({ customerId, txn, t, onClose, onSaved }) {
  const [amount, setAmount] = useState(String(txn.amount));
  const [note, setNote] = useState(txn.note || '');
  const [mode, setMode] = useState(txn.paymentMode || 'cash');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/api/seller/khata/customers/${customerId}/transactions/${txn._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ amount: Number(amount), note, paymentMode: mode }),
      });
      onSaved();
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
      title={t('seller.editEntry')}
      maxWidth={420}
      footer={
        <>
          <button type="submit" className="btn btn-primary btn-inline" disabled={saving}>
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
            {new Date(txn.createdAt).toLocaleDateString('en-IN')} ·{' '}
            {txn.type === 'credit' ? t('seller.recordCredit') : t('seller.recordPayment')}
          </p>
          <div className="form-grid cols-2">
            <div className="field">
              <label htmlFor="edit-amount">{t('seller.amount')}</label>
              <input
                id="edit-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                autoFocus
              />
            </div>
            {txn.type === 'payment' && (
              <div className="field">
                <label htmlFor="edit-mode">{t('seller.payMode')}</label>
                <Dropdown
                  id="edit-mode"
                  value={mode}
                  onChange={setMode}
                  options={PAY_MODES.map((m) => ({ value: m, label: t(`payMode.${m}`) }))}
                />
              </div>
            )}
            <div className="field field-span2">
              <label htmlFor="edit-note">{t('seller.note')}</label>
              <input id="edit-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
            </div>
          </div>
    </Modal>
  );
}

/**
 * The passbook for a date range — what a customer asks for when he does not believe the
 * number. Opening balance, every line with the running total beside it, closing balance, and
 * three ways out: on screen, on his phone, in the shop's own file.
 *
 * The opening balance is the reason this cannot just be the ledger table with dates on it. A
 * statement that starts at zero on 1st April and shows ₹4,000 of purchases reads as "you owe
 * ₹4,000" when he actually owes ₹19,000.
 */
function StatementPanel({ customerId, customerName, t, onError }) {
  const [range, setRange] = useState({ from: monthsAgo(3), to: today() });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [waSheet, setWaSheet] = useState(null);

  async function loadStatement() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      setData(await apiFetch(`/api/seller/khata/customers/${customerId}/statement?${params.toString()}`));
    } catch (err) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function download(format) {
    setDownloading(true);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, format });
      await downloadFile(
        `/api/seller/khata/customers/${customerId}/statement?${params.toString()}`,
        `khata-${customerName || 'customer'}.${format === 'pdf' ? 'pdf' : 'xlsx'}`
      );
    } catch (err) {
      onError(err.message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="panel">
      <div className="section-toolbar" style={{ marginBottom: '0.4rem' }}>
        <h2>{t('seller.statementTitle')}</h2>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: '0.8rem', fontSize: 'var(--fs-base)' }}>
        {t('seller.statementHint')}
      </p>

      <div className="form-grid cols-2">
        <div className="field">
          <label htmlFor="stmt-from">{t('common.from')}</label>
          <input id="stmt-from" type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor="stmt-to">{t('common.to')}</label>
          <input id="stmt-to" type="date" value={range.to} min={range.from} max={today()} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </div>
      </div>

      <div className="row-actions stmt-actions">
        <button type="button" className="btn btn-secondary btn-small" style={{ width: 'auto' }} onClick={loadStatement} disabled={loading}>
          {t('seller.viewStatement')}
        </button>
        <button type="button" className="btn btn-secondary btn-small" style={{ width: 'auto' }} onClick={() => download('xlsx')} disabled={downloading}>
          <ExcelIcon size={17} /> Excel
        </button>
        <button type="button" className="btn btn-secondary btn-small" style={{ width: 'auto' }} onClick={() => download('pdf')} disabled={downloading}>
          <PdfIcon size={17} /> PDF
        </button>
        {data?.share?.whatsappLink && (
          <button
            type="button"
            className="btn btn-primary btn-small"
            style={{ width: 'auto' }}
            onClick={() =>
              setWaSheet({
                title: t('wa.sendStatement'),
                to: { name: customerName, phone: data.customer?.phone },
                message: data.share.text,
                link: data.share.whatsappLink,
                // A statement is one row per entry, so it can never ride a WhatsApp
                // template — this one is always the shopkeeper's own thumb. See the note
                // beside `share` in backend/controllers/customerController.js.
                auto: false,
                appLink: data.share.appLink,
              })
            }
          >
            <WhatsappIcon size={17} /> {t('seller.sendWhatsapp')}
          </button>
        )}
      </div>
      {waSheet && <WhatsappSheet {...waSheet} onClose={() => setWaSheet(null)} />}

      {data && (
        <div className="table-wrap mobile-cards" style={{ marginTop: '0.8rem' }}>
          <table className="data-table" style={{ minWidth: '520px' }}>
            <thead>
              <tr>
                <th style={{ width: '9rem' }}>{t('common.date')}</th>
                <th>{t('seller.note')}</th>
                <th className="num">{t('seller.amount')}</th>
                <th className="num">{t('seller.runningBalance')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={3}><strong>{t('seller.openingBalanceRow')}</strong></td>
                <td className="num"><strong>₹{data.opening.toLocaleString('en-IN')}</strong></td>
              </tr>
              {data.rows.map((row, i) => (
                <tr key={i}>
                  <td>{new Date(row.at).toLocaleDateString('en-IN')}</td>
                  <td className="cell-muted">
                    {row.note || (row.type === 'credit' ? t('seller.recordCredit') : t('seller.recordPayment'))}
                  </td>
                  <td className="num">{row.type === 'credit' ? '+' : '−'}{inr(row.amount)}</td>
                  <td className="num">{inr(row.balance)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3}><strong>{t('seller.closingBalanceRow')}</strong></td>
                <td className="num"><strong>₹{data.closing.toLocaleString('en-IN')}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Phones: the passbook as cards — opening line, one card per entry, closing line. */}
      {data && (
        <div className="record-cards mobile-only stmt-cards">
          <div className="stmt-total">
            <span>{t('seller.openingBalanceRow')}</span>
            <strong>{inr(data.opening)}</strong>
          </div>
          {data.rows.map((row, i) => (
            <div key={i} className="record-card ledger-card">
              <div className="record-card-main">
                <span className="ledger-card-note">
                  {row.note || (row.type === 'credit' ? t('seller.recordCredit') : t('seller.recordPayment'))}
                </span>
                <div className="record-card-meta">
                  <span>{new Date(row.at).toLocaleDateString('en-IN')}</span>
                </div>
              </div>
              <div className="record-card-side">
                <span className={`record-card-price ${row.type === 'credit' ? 'is-credit' : 'is-payment'}`}>
                  {row.type === 'credit' ? '+' : '−'}{inr(row.amount)}
                </span>
                <span className="ledger-card-balance">
                  {t('seller.runningBalance')}: {inr(row.balance)}
                </span>
              </div>
            </div>
          ))}
          <div className="stmt-total">
            <span>{t('seller.closingBalanceRow')}</span>
            <strong>{inr(data.closing)}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

// Per-bill udhaar tracker: every khata bill for this customer, split into the ones still
// owed and the ones already cleared. The two used to sit interleaved in one list, newest
// first — so a cleared ₹200 bill sat between two live ₹5,000 ones and the oldest debt,
// the one worth chasing, was always at the bottom. Fetches its own data so the parent page
// stays focused on the running-balance ledger.
function KhataBills({ customerId, t, onChanged, reloadKey, confirm }) {
  const [bills, setBills] = useState([]);
  const [totalPending, setTotalPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');
  const [expanded, setExpanded] = useState(null);
  const [payingId, setPayingId] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState('cash');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    apiFetch(`/api/seller/khata/customers/${customerId}/bills`)
      .then((data) => {
        setBills(data.bills || []);
        setTotalPending(data.totalPending || 0);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [customerId, reloadKey]);

  function openPay(bill) {
    setPayingId(bill.id);
    setPayAmount(String(bill.pending));
    setPayMode('cash');
    setError('');
  }

  async function submitPay(bill, fullAmount) {
    const amount = fullAmount != null ? fullAmount : Number(payAmount);
    if (!amount || amount <= 0) return;
    setSaving(true);
    setError('');
    try {
      const data = await apiFetch(`/api/seller/khata/bills/${bill.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ amount, paymentMode: payMode }),
      });
      setPayingId(null);
      setPayAmount('');
      load();
      onChanged?.();
      if (data.receipt) {
        const share = await confirm({
          tone: 'success',
          title: t('seller.receiptTitle'),
          body: t('seller.receiptBody', { name: data.customer?.name || '' }),
          confirmLabel: t('seller.sendReceipt'),
          cancelLabel: t('common.close'),
        });
        if (share) openReceipt(data.receipt);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Oldest first: the bill that has waited longest is the one to ask about today.
  const pending = bills.filter((b) => !b.settled).sort((a, b) => new Date(a.date) - new Date(b.date));
  const settled = bills.filter((b) => b.settled);
  const settledTotal = settled.reduce((sum, b) => sum + (b.total || 0), 0);
  const oldestDays = pending.length ? daysSince(pending[0].date) : 0;

  return (
    <div className="panel">
      <div className="section-toolbar" style={{ marginBottom: '0.4rem' }}>
        <h2>{t('seller.billsTitle')}</h2>
      </div>
      <p className="kb-sub">{t('seller.billsSubtitle')}</p>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <p className="empty-state">{t('common.loading')}</p>
      ) : bills.length === 0 ? (
        // `seller.noBills` belongs to the billing screen ("no bills yet today"). This page
        // wants the khata sentence, which has its own key.
        <p className="empty-state">{t('seller.noKhataBills')}</p>
      ) : (
        <>
          <div className="kb-summary">
            <div className={`kb-tile${totalPending > 0 ? ' is-due' : ' is-good'}`}>
              <span className="stat-label">{t('seller.billPending')}</span>
              <strong>{inr(totalPending)}</strong>
              <span className="kb-tile-hint">
                {pending.length ? t('seller.kbOnBills', { count: pending.length }) : t('seller.allSettled')}
              </span>
            </div>
            <div className="kb-tile is-good">
              <span className="stat-label">{t('seller.kbCleared')}</span>
              <strong>{settled.length}</strong>
              <span className="kb-tile-hint">{t('seller.kbClearedHint', { amount: inr(settledTotal) })}</span>
            </div>
            <div className={`kb-tile${oldestDays > 90 ? ' is-due' : oldestDays > 30 ? ' is-warn' : ''}`}>
              <span className="stat-label">{t('seller.kbOldest')}</span>
              <strong>{pending.length ? t('seller.kbDays', { days: oldestDays }) : '—'}</strong>
              {pending.length > 0 && (
                <span className="kb-tile-hint">
                  {t('seller.billNo')} #{pending[0].billNumber}
                </span>
              )}
            </div>
          </div>

          <div className="segmented kb-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'pending'}
              className={tab === 'pending' ? 'active' : ''}
              onClick={() => setTab('pending')}
            >
              {t('seller.kbTabPending')} <span className="loy-tab-count">{pending.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'settled'}
              className={tab === 'settled' ? 'active' : ''}
              onClick={() => setTab('settled')}
            >
              {t('seller.kbTabSettled')} <span className="loy-tab-count">{settled.length}</span>
            </button>
          </div>

          {tab === 'pending' ? (
            pending.length === 0 ? (
              <div className="kb-empty">
                <CheckIcon size={20} />
                <p>{t('seller.allSettled')}</p>
                {settled.length > 0 && (
                  <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => setTab('settled')}>
                    {t('seller.kbSeeCleared')}
                  </button>
                )}
              </div>
            ) : (
              <div className="bill-card-list">
                {pending.map((bill) => (
                  <PendingBillCard
                    key={bill.id}
                    bill={bill}
                    t={t}
                    open={expanded === bill.id}
                    onToggle={() => setExpanded(expanded === bill.id ? null : bill.id)}
                    paying={payingId === bill.id}
                    openPay={openPay}
                    closePay={() => setPayingId(null)}
                    payAmount={payAmount}
                    setPayAmount={setPayAmount}
                    payMode={payMode}
                    setPayMode={setPayMode}
                    saving={saving}
                    submitPay={submitPay}
                  />
                ))}
              </div>
            )
          ) : settled.length === 0 ? (
            <p className="empty-state">{t('seller.kbNoSettled')}</p>
          ) : (
            <div className="kb-settled-list">
              {settled.map((bill) => (
                <SettledBillRow
                  key={bill.id}
                  bill={bill}
                  t={t}
                  open={expanded === bill.id}
                  onToggle={() => setExpanded(expanded === bill.id ? null : bill.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function daysSince(date) {
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000));
}

function BillItems({ items }) {
  return (
    <ul className="bill-items">
      {items.map((it, i) => (
        <li key={i}>
          <span className="bill-item-name">
            {it.name}
            {it.returnedQuantity > 0 ? ` (−${it.returnedQuantity} returned)` : ''}
          </span>
          <span className="bill-item-qty">{it.quantity} {it.unit} × {inr(it.price)}</span>
          <span className="bill-item-total">{inr(it.lineTotal)}</span>
        </li>
      ))}
    </ul>
  );
}

function PendingBillCard({ bill, t, open, onToggle, paying, openPay, closePay, payAmount, setPayAmount, payMode, setPayMode, saving, submitPay }) {
  const age = daysSince(bill.date);
  const pct = bill.total > 0 ? Math.min(100, Math.round((bill.paid / bill.total) * 100)) : 0;
  const typed = Number(payAmount) || 0;
  const remaining = Math.max(0, Number((bill.pending - typed).toFixed(2)));

  return (
    <div className={`bill-card kb-card${age > 90 ? ' is-old' : age > 30 ? ' is-aging' : ''}`}>
      <div className="kb-card-top">
        <div className="bill-card-id">
          <strong>{t('seller.billNo')} #{bill.billNumber}</strong>
          <span className="bill-card-date">{new Date(bill.date).toLocaleDateString('en-IN')}</span>
          <span className={`badge ${age > 90 ? 'badge-expired' : age > 30 ? 'badge-expiring' : 'badge-inactive'}`}>
            {t('seller.kbDaysOld', { days: age })}
          </span>
        </div>
        <div className="kb-due">
          <span className="kb-due-amount">{inr(bill.pending)}</span>
          <span className="kb-due-label">{t('seller.billPending')}</span>
        </div>
      </div>

      <div className="kb-progress-row">
        <div className="bill-progress">
          <div className="bill-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="kb-progress-text">{t('seller.kbPaidOf', { paid: inr(bill.paid), total: inr(bill.total) })}</span>
      </div>

      {!paying && (
        <div className="bill-card-actions">
          <button type="button" className="btn btn-primary btn-small" style={{ width: 'auto' }} onClick={() => openPay(bill)}>
            <HandCoinsIcon size={15} /> {t('seller.settleBill')}
          </button>
          <button type="button" className="btn btn-secondary btn-small" style={{ width: 'auto' }} aria-expanded={open} onClick={onToggle}>
            {t('seller.billItemsLabel')} ({bill.items.length})
          </button>
          {/* A khata customer asking "iska pakka bill dena" gets the same professional
              invoice as a cash customer — with the pending balance printed on it. */}
          <Link
            href={recordHref('/seller/invoice/[id]', bill.id)}
            className="btn btn-secondary btn-small"
            style={{ width: 'auto', textDecoration: 'none' }}
          >
            {t('seller.invoiceAction')}
          </Link>
        </div>
      )}

      {open && <BillItems items={bill.items} />}

      {paying && (
        <div className="bill-settle-form">
          <div className="field bill-settle-amount">
            <label>{t('seller.payAmount')}</label>
            <input type="number" min="0.01" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus />
          </div>
          <div className="field bill-settle-mode">
            <label>{t('seller.payMode')}</label>
            <Dropdown value={payMode} onChange={setPayMode} options={PAY_MODES.map((m) => ({ value: m, label: t(`payMode.${m}`) }))} />
          </div>
          {/* What this payment leaves behind, said before Save rather than discovered after. */}
          {typed > 0 && (
            <p className={`kb-settle-hint${remaining <= 0 ? ' is-clear' : ''}`}>
              {remaining <= 0 ? t('seller.kbWillClear') : t('seller.kbWillRemain', { amount: inr(remaining) })}
            </p>
          )}
          <div className="bill-settle-buttons">
            <button type="button" className="btn btn-primary btn-small" style={{ width: 'auto' }} disabled={saving || typed <= 0} onClick={() => submitPay(bill)}>
              {t('common.save')}
            </button>
            <button type="button" className="btn btn-secondary btn-small" style={{ width: 'auto' }} disabled={saving} onClick={() => submitPay(bill, bill.pending)}>
              {t('seller.settleFull')}
            </button>
            <button type="button" className="btn btn-secondary btn-small" style={{ width: 'auto' }} disabled={saving} onClick={closePay}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SettledBillRow({ bill, t, open, onToggle }) {
  return (
    <div className="kb-settled">
      <div className="kb-settled-row">
        <span className="kb-settled-check">
          <CheckIcon size={16} />
        </span>
        <div className="kb-settled-main">
          <strong>{t('seller.billNo')} #{bill.billNumber}</strong>
          <span className="bill-card-date">{new Date(bill.date).toLocaleDateString('en-IN')}</span>
        </div>
        <span className="kb-settled-amount">{inr(bill.total)}</span>
        <div className="kb-settled-actions">
          <button type="button" className="btn btn-secondary btn-small" style={{ width: 'auto' }} aria-expanded={open} onClick={onToggle}>
            {t('seller.billItemsLabel')} ({bill.items.length})
          </button>
          <Link
            href={recordHref('/seller/invoice/[id]', bill.id)}
            className="btn btn-secondary btn-small"
            style={{ width: 'auto', textDecoration: 'none' }}
          >
            {t('seller.invoiceAction')}
          </Link>
        </div>
      </div>
      {open && <BillItems items={bill.items} />}
    </div>
  );
}

const HISTORY_RANGES = ['all', 'month', 'lastMonth', 'last30'];

// Shop-local YYYY-MM-DD. toISOString() would hand back yesterday's date for the first five
// and a half hours of every IST day.
function localYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rangeDates(key) {
  const now = new Date();
  if (key === 'month') return { from: localYmd(new Date(now.getFullYear(), now.getMonth(), 1)), to: localYmd(now) };
  if (key === 'lastMonth') {
    return {
      from: localYmd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: localYmd(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  if (key === 'last30') {
    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    return { from: localYmd(start), to: localYmd(now) };
  }
  return { from: '', to: '' };
}

function dayLabel(date, t) {
  const d = new Date(date);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return t('range.today');
  if (d.toDateString() === yesterday.toDateString()) return t('range.yesterday');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeLabel(date) {
  return new Date(date).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

// Rows arrive newest-first; consecutive rows on the same calendar day share one heading.
function groupByDay(rows) {
  const groups = [];
  for (const row of rows) {
    const key = new Date(row.createdAt).toDateString();
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else groups.push({ key, date: row.createdAt, rows: [row] });
  }
  return groups;
}

/**
 * The whole khata, in a popup — built to be read, not decoded.
 *
 * What the first version got wrong, looking at it with a customer standing at the counter:
 *   - the badges said "Record payment" / "Add credit" — button labels, i.e. what YOU could do,
 *     not what HAPPENED. Now: "Payment received" / "Credit given".
 *   - one Amount column with a +/− sign meant reading every digit to tell money in from money
 *     out. Credit and payment now have their own columns, in their own colours, like a passbook.
 *   - the same date printed on eight rows in a row. Rows now sit under a day heading
 *     ("Today", "3 Sep 2026") and show the time instead.
 *   - no totals, so "is mahine kitna diya, kitna mila?" meant adding it up by eye. A strip
 *     above the rows answers it for exactly the range and type filtered to, across all pages.
 *   - a dropdown and two bare date boxes for the filters. Type is one tap, and the ranges a
 *     shopkeeper actually asks about are chips; "Custom" opens the dates only when wanted.
 *   - a table scroller nested inside the dialog's own scroll — two scrollbars side by side.
 */
function LedgerHistoryModal({ t, customer, transactions, pageInfo, rangeSummary, filter, setFilter, loading, multiBranch, onEdit, onDelete, onClose }) {
  const [customOpen, setCustomOpen] = useState(false);
  const matchedRange = HISTORY_RANGES.find((key) => {
    const r = rangeDates(key);
    return r.from === filter.from && r.to === filter.to;
  });
  const activeRange = customOpen || !matchedRange ? 'custom' : matchedRange;
  const filtersOn = filter.type !== 'all' || filter.from || filter.to;
  const groups = groupByDay(transactions);

  function pickRange(key) {
    setCustomOpen(false);
    setFilter((f) => ({ ...f, ...rangeDates(key), page: 1 }));
  }

  function clearAll() {
    setCustomOpen(false);
    setFilter({ type: 'all', from: '', to: '', page: 1 });
  }

  const typeLabel = (txn) => (txn.type === 'credit' ? t('seller.kbTypeCredit') : t('seller.kbTypePayment'));

  const meta = (txn) =>
    [
      txn.type === 'payment' && txn.paymentMode ? t(`payMode.${txn.paymentMode}`) : '',
      // Branch only for a shop that HAS branches; on a single shop it would repeat forever.
      multiBranch && txn.store?.name ? txn.store.name : '',
    ]
      .filter(Boolean)
      .join(' · ');

  const actions = (txn) =>
    txn.relatedBill ? (
      // Bill-made entries are corrected on the bill, not here — so the row offers the bill.
      <Link href={recordHref('/seller/invoice/[id]', txn.relatedBill)} className="lhm-bill-link">
        {t('seller.kbViewBill')}
      </Link>
    ) : (
      <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="icon-btn" data-tip={t('common.edit')} aria-label={t('common.edit')} onClick={() => onEdit(txn)}>
          <EditIcon size={17} />
        </button>
        <button type="button" className="icon-btn danger" data-tip={t('common.delete')} aria-label={t('common.delete')} onClick={() => onDelete(txn)}>
          <TrashIcon size={17} />
        </button>
      </div>
    );

  return (
    <Modal
      onClose={onClose}
      title={t('seller.transactionHistory')}
      hint={customer ? t('seller.kbBalanceHint', { name: customer.name, amount: inr(customer.balance) }) : undefined}
      maxWidth={1000}
      className="modal-tall ledger-history-modal"
    >
      <div className="lhm-toolbar">
        <div className="segmented-mini" role="tablist">
          {[
            ['all', t('seller.kbFilterAll')],
            ['credit', t('seller.kbTypeCredit')],
            ['payment', t('seller.kbTypePayment')],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter.type === value}
              className={filter.type === value ? 'active' : ''}
              onClick={() => setFilter((f) => ({ ...f, type: value, page: 1 }))}
            >
              {value !== 'all' && <span className={`lh-dot${value === 'credit' ? ' is-credit' : ''}`} />}
              {label}
            </button>
          ))}
        </div>

        <div className="lhm-ranges">
          {HISTORY_RANGES.map((key) => (
            <button key={key} type="button" className={`chip${activeRange === key ? ' active' : ''}`} onClick={() => pickRange(key)}>
              {t(`range.${key}`)}
            </button>
          ))}
          <button type="button" className={`chip${activeRange === 'custom' ? ' active' : ''}`} onClick={() => setCustomOpen(true)}>
            {t('range.custom')}
          </button>
        </div>

        {filtersOn && (
          <button type="button" className="filter-clear" onClick={clearAll}>
            <XIcon size={13} />
            {t('table.clearFilters')}
          </button>
        )}

        {activeRange === 'custom' && (
          <div className="lhm-dates">
            <label className="ledger-date">
              <span>{t('common.from')}</span>
              <input
                type="date"
                className="filter-date"
                value={filter.from}
                max={filter.to || localYmd(new Date())}
                onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value, page: 1 }))}
              />
            </label>
            <label className="ledger-date">
              <span>{t('common.to')}</span>
              <input
                type="date"
                className="filter-date"
                value={filter.to}
                min={filter.from || undefined}
                max={localYmd(new Date())}
                onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value, page: 1 }))}
              />
            </label>
          </div>
        )}
      </div>

      {rangeSummary && rangeSummary.count > 0 && (
        <div className="lhm-summary">
          {filter.type !== 'payment' && (
            <div className="lhm-stat is-credit">
              <span>{t('seller.kbTypeCredit')}</span>
              <strong>+{inr(rangeSummary.credit)}</strong>
            </div>
          )}
          {filter.type !== 'credit' && (
            <div className="lhm-stat is-payment">
              <span>{t('seller.kbTypePayment')}</span>
              <strong>−{inr(rangeSummary.paid)}</strong>
            </div>
          )}
          {filter.type === 'all' && rangeSummary.opening != null && (
            <div className="lhm-stat">
              <span>{t('seller.kbSumBalance')}</span>
              <strong>
                {inr(rangeSummary.opening)} → {inr(rangeSummary.closing)}
              </strong>
            </div>
          )}
          <div className="lhm-stat">
            <span>{t('seller.kbSumEntries')}</span>
            <strong>{rangeSummary.count}</strong>
          </div>
        </div>
      )}

      {transactions.length === 0 ? (
        <div className="empty-state-rich">
          <Illustration scene={filtersOn ? 'search' : 'ledger'} />
          <p>{filtersOn ? t('table.noResults') : t('seller.noTransactions')}</p>
        </div>
      ) : (
        <>
          <div className={`table-wrap mobile-cards lhm-table${loading ? ' is-loading' : ''}`}>
            <table className="data-table" style={{ minWidth: '720px' }}>
              <thead>
                <tr>
                  <th style={{ width: '6.5rem' }}>{t('seller.kbColTime')}</th>
                  <th>{t('seller.kbColEntry')}</th>
                  <th>{t('seller.kbColNote')}</th>
                  <th className="num" style={{ width: '8rem' }}>{t('seller.kbTypeCredit')}</th>
                  <th className="num" style={{ width: '8rem' }}>{t('seller.kbTypePayment')}</th>
                  {/* The column a customer actually argues about: what the total stood at
                      the moment this line was written. */}
                  <th className="num" style={{ width: '8rem' }}>{t('seller.runningBalance')}</th>
                  <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                </tr>
              </thead>
              {groups.map((group) => (
                <tbody key={group.key}>
                  <tr className="lhm-day">
                    <td colSpan={7}>{dayLabel(group.date, t)}</td>
                  </tr>
                  {group.rows.map((txn) => (
                    <tr key={txn._id}>
                      <td className="cell-muted">{timeLabel(txn.createdAt)}</td>
                      <td>
                        <div className="lhm-entry">
                          <span className={`lh-dot${txn.type === 'credit' ? ' is-credit' : ''}`} />
                          <span className="lhm-entry-text">
                            <strong>{typeLabel(txn)}</strong>
                            {meta(txn) && <span className="lhm-entry-meta">{meta(txn)}</span>}
                          </span>
                        </div>
                      </td>
                      <td className="cell-muted lhm-note">
                        {txn.note}
                        {/* Said on the line itself, not only in the audit trail — a customer
                            disputing a figure is owed the fact that it was changed. */}
                        {txn.editedAt && <span className="badge badge-inactive">{t('seller.entryEdited')}</span>}
                      </td>
                      <td className="num lhm-credit">{txn.type === 'credit' ? `+${inr(txn.amount)}` : ''}</td>
                      <td className="num lhm-paid">{txn.type === 'payment' ? `−${inr(txn.amount)}` : ''}</td>
                      <td className="num lhm-bal">{inr(txn.balanceAfter)}</td>
                      <td className="tight" style={{ textAlign: 'right' }}>
                        {actions(txn)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>

          {/* Phones: the same day groups, one card per entry. */}
          <div className={`record-cards mobile-only lhm-cards${loading ? ' is-loading' : ''}`}>
            {groups.map((group) => (
              <div key={group.key} className="lhm-card-group">
                <div className="lhm-day-head">{dayLabel(group.date, t)}</div>
                {group.rows.map((txn) => (
                  <div key={txn._id} className="record-card ledger-card">
                    <div className="record-card-main">
                      <div className="lhm-entry">
                        <span className={`lh-dot${txn.type === 'credit' ? ' is-credit' : ''}`} />
                        <strong>{typeLabel(txn)}</strong>
                        {txn.editedAt && <span className="badge badge-inactive">{t('seller.entryEdited')}</span>}
                      </div>
                      <div className="record-card-meta">
                        <span>{timeLabel(txn.createdAt)}</span>
                        {meta(txn) && <span className="dot-sep">{meta(txn)}</span>}
                      </div>
                      {txn.note && <div className="ledger-card-note">{txn.note}</div>}
                      {/* In the main column, not the side: `.record-card-side:has(.row-actions)`
                          dissolves the side on phones and squeezes the card into a sliver. */}
                      <div className="ledger-card-actions">{actions(txn)}</div>
                    </div>
                    <div className="record-card-side">
                      <span className={`record-card-price ${txn.type === 'credit' ? 'is-credit' : 'is-payment'}`}>
                        {txn.type === 'credit' ? '+' : '−'}
                        {inr(txn.amount)}
                      </span>
                      <span className="ledger-card-balance">
                        {t('seller.runningBalance')}: {inr(txn.balanceAfter)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {pageInfo.pageCount > 1 && (
            <div className="row-actions ledger-pager">
              <button
                type="button"
                className="btn btn-secondary btn-small"
                style={{ width: 'auto' }}
                disabled={pageInfo.page <= 1}
                onClick={() => setFilter((f) => ({ ...f, page: f.page - 1 }))}
              >
                {t('pagination.previous')}
              </button>
              <span className="cell-muted" style={{ alignSelf: 'center' }}>
                {pageInfo.page} / {pageInfo.pageCount}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                style={{ width: 'auto' }}
                disabled={pageInfo.page >= pageInfo.pageCount}
                onClick={() => setFilter((f) => ({ ...f, page: f.page + 1 }))}
              >
                {t('pagination.next')}
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
