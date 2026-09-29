'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { apiErrorMessage } from '../../../lib/apiErrors';
import { formatRupees, formatDate, formatDateTime, toDateInput } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import AnimatedNumber from '../../components/AnimatedNumber';
import Dropdown from '../../components/Dropdown';
import { SkeletonStats, SkeletonCards } from '../../components/Skeleton';
import { BookIcon, CheckCircleIcon, AlertIcon, WalletIcon, PlusIcon, TrashIcon, LockIcon } from '../../components/Icons';

// Notes that move in or out of the golak without being trade. The sign is the server's
// (models/CashMovement.js); here it only decides the colour of the row.
const MOVEMENT_KINDS = [
  { kind: 'bankDeposit', dir: 'out' },
  { kind: 'ownerTook', dir: 'out' },
  { kind: 'ownerAdded', dir: 'in' },
  { kind: 'bankWithdrawal', dir: 'in' },
];
const MOVEMENT_DIR = Object.fromEntries(MOVEMENT_KINDS.map((m) => [m.kind, m.dir]));

const EMPTY_MOVEMENT = { kind: 'bankDeposit', amount: '', note: '' };

function shiftDay(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateInput(date);
}

// The typed figure, or null for an empty box.
function readRupees(text) {
  if (text === '' || text == null) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export default function DayBookPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();

  const today = toDateInput();
  const [date, setDate] = useState(today);
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cashForm, setCashForm] = useState({ openingCash: '', closingCounted: '', note: '' });
  const [saving, setSaving] = useState(false);
  const [movementForm, setMovementForm] = useState(EMPTY_MOVEMENT);
  const [addingMovement, setAddingMovement] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/seller/expenses/daybook?date=${date}`)
      .then((result) => {
        setBook(result);
        setCashForm({
          openingCash: String(result.cash.opening ?? ''),
          closingCounted: result.cash.counted == null ? '' : String(result.cash.counted),
          note: result.cash.note || '',
        });
        setError('');
      })
      .catch((err) => setError(apiErrorMessage(lang, err)))
      .finally(() => setLoading(false));
  }, [date, lang]);

  useEffect(load, [load]);

  async function saveCash(event) {
    event.preventDefault();
    // Once an earlier day has been counted the opening is that count, full stop — the box is
    // read-only and nothing is sent for it. Only the first day takes a typed opening.
    const openingCash = book.cash.openingLocked ? undefined : readRupees(cashForm.openingCash);

    setSaving(true);
    try {
      await apiFetch('/api/seller/expenses/daybook/cash', {
        method: 'POST',
        body: JSON.stringify({ date, openingCash, closingCounted: cashForm.closingCounted, note: cashForm.note }),
      });
      toast.success(t('daybook.saved'));
      load();
    } catch (err) {
      toast.error(apiErrorMessage(lang, err));
    } finally {
      setSaving(false);
    }
  }

  async function addMovement(event) {
    event.preventDefault();
    const amount = readRupees(movementForm.amount);
    if (!amount || amount <= 0) {
      toast.error(t('daybook.movementAmountNeeded'));
      return;
    }
    setAddingMovement(true);
    try {
      await apiFetch('/api/seller/expenses/daybook/movements', {
        method: 'POST',
        body: JSON.stringify({ date, kind: movementForm.kind, amount, note: movementForm.note }),
      });
      toast.success(t('daybook.movementAdded'));
      setMovementForm(EMPTY_MOVEMENT);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(lang, err));
    } finally {
      setAddingMovement(false);
    }
  }

  async function removeMovement(entry) {
    const ok = await confirm({
      tone: 'danger',
      title: t('daybook.movementDeleteTitle'),
      body: t('daybook.movementDeleteBody', {
        kind: t(`daybook.movementKind.${entry.kind}`),
        amount: formatRupees(entry.amount, lang),
      }),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/seller/expenses/daybook/movements/${entry.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      toast.error(apiErrorMessage(lang, err));
    }
  }

  // The owner's undo for a day closed by mistake. Staff never see it — a closed day is
  // locked for them (the server refuses it too).
  async function reopenDay() {
    const ok = await confirm({
      tone: 'warning',
      title: t('daybook.reopenTitle'),
      body: t('daybook.reopenBody', { amount: formatRupees(book.cash.counted, lang) }),
      confirmLabel: t('daybook.reopen'),
    });
    if (!ok) return;
    try {
      await apiFetch('/api/seller/expenses/daybook/cash', { method: 'POST', body: JSON.stringify({ date, reopen: true }) });
      toast.success(t('daybook.reopened'));
      load();
    } catch (err) {
      toast.error(apiErrorMessage(lang, err));
    }
  }

  const cash = book?.cash;
  const difference = cash?.difference;
  const matched = difference != null && Math.abs(difference) < 0.5;
  const locked = cash ? !cash.canEdit : false;

  // Where the opening came from, in words, under the figure.
  let openingHint = null;
  if (cash?.manualOpening) {
    openingHint = t('daybook.openingTyped');
  } else if (cash?.carried) {
    const yesterday = shiftDay(date, -1);
    const fromYesterday = cash.carried.kind === 'count' && toDateInput(cash.carried.from) === yesterday;
    openingHint = fromYesterday
      ? t('daybook.carriedForward')
      : t(cash.carried.kind === 'count' ? 'daybook.carriedFromCount' : 'daybook.carriedFromOpening', {
          date: formatDate(cash.carried.from, lang),
        });
    if (cash.carried.uncountedDays > 0 && cash.carried.kind === 'count' && !fromYesterday) {
      openingHint += ` ${t('daybook.carriedGap', { count: cash.carried.uncountedDays })}`;
    }
  }

  const hasRefunds = book && (book.refunds.cash > 0 || book.refunds.other > 0 || book.refunds.khata > 0);

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('daybook.title')}</h1>
          <p>{t('daybook.subtitle')}</p>
          <Link href="/seller/expenses" className="nav-link">{t('daybook.openExpenses')} →</Link>
        </div>
        <div className="day-stepper">
          <button type="button" className="icon-btn" onClick={() => setDate((d) => shiftDay(d, -1))} aria-label={t('daybook.prevDay')}>
            ‹
          </button>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
          <button
            type="button"
            className="icon-btn"
            onClick={() => setDate((d) => (d >= today ? d : shiftDay(d, 1)))}
            disabled={date >= today}
            aria-label={t('daybook.nextDay')}
          >
            ›
          </button>
          {date !== today && (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setDate(today)}>
              {t('daybook.today')}
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading && !book ? (
        <>
          <SkeletonStats count={4} />
          <SkeletonCards count={2} height={150} />
        </>
      ) : (
        book && (
          <>
            {/* The golak walkthrough: opening → in → out → what should be left. Reading it
                left to right is the same order the shopkeeper counts in at night. */}
            <div className="cash-flow">
              <div className="cash-step">
                <span className="cash-step-label">{t('daybook.opening')}</span>
                <span className="cash-step-value">₹<AnimatedNumber value={cash.opening} decimals={false} /></span>
                {openingHint && <span className="cash-step-hint">{openingHint}</span>}
              </div>
              <span className="cash-op">+</span>
              <div className="cash-step in">
                <span className="cash-step-label">{t('daybook.cashIn')}</span>
                <span className="cash-step-value">₹<AnimatedNumber value={cash.in} decimals={false} /></span>
              </div>
              <span className="cash-op">−</span>
              <div className="cash-step out">
                <span className="cash-step-label">{t('daybook.cashOut')}</span>
                <span className="cash-step-value">₹<AnimatedNumber value={cash.out} decimals={false} /></span>
              </div>
              <span className="cash-op">=</span>
              <div className="cash-step result">
                <span className="cash-step-label">{t('daybook.expectedClosing')}</span>
                <span className="cash-step-value">₹<AnimatedNumber value={cash.expectedClosing} decimals={false} /></span>
              </div>
            </div>

            <div className="two-col">
              <div className="panel">
                <h2>{t('daybook.sales')}</h2>
                <ul className="ledger-list">
                  <li>
                    <span>{t('daybook.billCount')}</span>
                    <strong>{book.sales.billCount}</strong>
                  </li>
                  <li className="in">
                    <span>{t('daybook.cashSales')}</span>
                    <strong>{formatRupees(book.sales.cash, lang)}</strong>
                  </li>
                  <li>
                    <span>{t('daybook.upiSales')}</span>
                    <strong>{formatRupees(book.sales.upi, lang)}</strong>
                  </li>
                  <li>
                    <span>{t('daybook.cardSales')}</span>
                    <strong>{formatRupees(book.sales.card, lang)}</strong>
                  </li>
                  <li>
                    <span>{t('daybook.khataSales')}</span>
                    <strong>{formatRupees(book.sales.khata, lang)}</strong>
                  </li>
                  <li className="total">
                    <span>{t('daybook.totalSales')}</span>
                    <strong>{formatRupees(book.sales.total, lang)}</strong>
                  </li>
                  {hasRefunds && (
                    <>
                      {book.refunds.cash > 0 && (
                        <li className="out">
                          <span>{t('daybook.refundedCash')}</span>
                          <strong>{formatRupees(book.refunds.cash, lang)}</strong>
                        </li>
                      )}
                      {book.refunds.other > 0 && (
                        <li>
                          <span>{t('daybook.refundedOther')}</span>
                          <strong>{formatRupees(book.refunds.other, lang)}</strong>
                        </li>
                      )}
                      {book.refunds.khata > 0 && (
                        <li>
                          <span>{t('daybook.refundedKhata')}</span>
                          <strong>{formatRupees(book.refunds.khata, lang)}</strong>
                        </li>
                      )}
                    </>
                  )}
                </ul>
                {hasRefunds && <p className="field-hint">{t('daybook.refundsHint')}</p>}
              </div>

              <div className="panel">
                <h2>{t('daybook.khataMovement')}</h2>
                <ul className="ledger-list">
                  <li className="out">
                    <span>{t('daybook.khataGiven')}</span>
                    <strong>{formatRupees(book.khata.given, lang)}</strong>
                  </li>
                  <li className="in">
                    <span>{t('daybook.khataRecoveredCash')}</span>
                    <strong>{formatRupees(book.khata.recoveredCash, lang)}</strong>
                  </li>
                  <li>
                    <span>{t('daybook.khataRecoveredOther')}</span>
                    <strong>{formatRupees(book.khata.recoveredOther, lang)}</strong>
                  </li>
                  <li className="in">
                    <span>{t('daybook.otherIncome')}</span>
                    <strong>{formatRupees(book.otherIncome.cash, lang)}</strong>
                  </li>
                </ul>
              </div>
            </div>

            <div className="two-col">
              <div className="panel">
                <h2>{t('daybook.expensesToday')}</h2>
                {book.expenses.entries.length === 0 ? (
                  <div className="empty-state-rich compact">
                    <div className="empty-icon"><WalletIcon size={22} /></div>
                    <p>{t('daybook.noExpenses')}</p>
                    <Link href="/seller/expenses" className="btn btn-secondary btn-small btn-inline">
                      <PlusIcon size={15} />
                      {t('expenses.add')}
                    </Link>
                  </div>
                ) : (
                  <ul className="ledger-list">
                    {book.expenses.entries.map((entry) => (
                      <li key={entry.id} className={entry.type === 'income' ? 'in' : 'out'}>
                        <span>
                          {t(`expenses.category.${entry.category}`)}
                          {entry.paidTo ? ` · ${entry.paidTo}` : ''}
                          <em className="ledger-mode">{t(`expenses.mode.${entry.paymentMode}`)}</em>
                        </span>
                        <strong>{formatRupees(entry.amount, lang)}</strong>
                      </li>
                    ))}
                    <li className="total">
                      <span>{t('daybook.totalExpenses')}</span>
                      <strong>{formatRupees(book.expenses.total, lang)}</strong>
                    </li>
                  </ul>
                )}
              </div>

              <div className="panel">
                <h2>{t('daybook.supplierPayments')}</h2>
                {book.supplierPayments.entries.length === 0 ? (
                  <p className="empty-state">{t('daybook.noSupplierPayments')}</p>
                ) : (
                  <ul className="ledger-list">
                    {book.supplierPayments.entries.map((payment, index) => (
                      <li key={index} className="out">
                        <span>
                          {payment.supplier}
                          <em className="ledger-mode">{t(`expenses.mode.${payment.mode}`)}</em>
                        </span>
                        <strong>{formatRupees(payment.amount, lang)}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Bank deposits and the owner's own cash. Not kharcha — booking them as kharcha
                would show a ₹20,000 deposit as ₹20,000 spent — but the drawer still has to
                know the notes left, or the day reads ₹20,000 short. */}
            <div className="panel">
              <h2>{t('daybook.movementsTitle')}</h2>
              <p className="field-hint">{t('daybook.movementsHint')}</p>
              {book.movements.entries.length > 0 && (
                <ul className="ledger-list">
                  {book.movements.entries.map((entry) => (
                    <li key={entry.id} className={MOVEMENT_DIR[entry.kind]}>
                      <span>
                        {t(`daybook.movementKind.${entry.kind}`)}
                        {entry.note ? ` · ${entry.note}` : ''}
                        {entry.byName && <em className="ledger-mode">{entry.byName}</em>}
                      </span>
                      <span className="ledger-amount-actions">
                        <strong>
                          {MOVEMENT_DIR[entry.kind] === 'out' ? '−' : '+'}
                          {formatRupees(entry.amount, lang)}
                        </strong>
                        {!locked && (
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => removeMovement(entry)}
                            aria-label={t('common.delete')}
                          >
                            <TrashIcon size={17} />
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {!locked && (
                <form onSubmit={addMovement} className="movement-form">
                  <div className="field">
                    <label>{t('daybook.movementKindLabel')}</label>
                    <Dropdown
                      value={movementForm.kind}
                      onChange={(kind) => setMovementForm((f) => ({ ...f, kind }))}
                      options={MOVEMENT_KINDS.map(({ kind }) => ({ value: kind, label: t(`daybook.movementKind.${kind}`) }))}
                    />
                  </div>
                  <div className="field">
                    <label>{t('daybook.movementAmount')}</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={movementForm.amount}
                      onChange={(e) => setMovementForm((f) => ({ ...f, amount: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>{t('daybook.note')}</label>
                    <input value={movementForm.note} onChange={(e) => setMovementForm((f) => ({ ...f, note: e.target.value }))} />
                  </div>
                  <button type="submit" className="btn btn-secondary btn-small btn-inline" disabled={addingMovement}>
                    <PlusIcon size={15} />
                    {addingMovement ? t('common.saving') : t('daybook.movementAdd')}
                  </button>
                </form>
              )}
            </div>

            <div className="panel">
              <h2>{t('daybook.closeDay')}</h2>

              {cash.closed && (
                <p className="field-hint daybook-closed-by">
                  {locked && <LockIcon size={14} />}
                  {t('daybook.closedBy', { name: cash.closedByName || '—', when: formatDateTime(cash.closedAt, lang) })}
                  {locked ? ` ${t('daybook.lockedForStaff')}` : ''}
                  {!locked && (
                    <button type="button" className="link-btn" onClick={reopenDay}>
                      {t('daybook.reopen')}
                    </button>
                  )}
                </p>
              )}

              {cash.changedSinceClose && (
                <div className="reconcile-banner over">
                  <AlertIcon size={18} />
                  <div>
                    <strong>{t('daybook.changedSinceClose')}</strong>
                    <span>{t('daybook.changedSinceCloseDetail', {
                      before: formatRupees(cash.expectedAtClose, lang),
                      after: formatRupees(cash.expectedClosing, lang),
                    })}</span>
                  </div>
                </div>
              )}

              <form onSubmit={saveCash}>
                <fieldset disabled={locked} className="plain-fieldset">
                  <div className="form-grid">
                    <div className="field">
                      <label>{t('daybook.openingCash')}</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={cashForm.openingCash}
                        readOnly={cash.openingLocked}
                        onChange={(e) => setCashForm((f) => ({ ...f, openingCash: e.target.value }))}
                      />
                      <p className="field-hint">
                        {cash.openingLocked ? t('daybook.openingLockedHint') : t('daybook.openingFirstDayHint')}
                      </p>
                    </div>
                    <div className="field">
                      <label>{t('daybook.countedCash')}</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={cashForm.closingCounted}
                        onChange={(e) => setCashForm((f) => ({ ...f, closingCounted: e.target.value }))}
                        placeholder={t('daybook.countedPlaceholder')}
                      />
                    </div>
                    <div className="field" style={{ gridColumn: '1 / -1' }}>
                      <label>{t('daybook.note')}</label>
                      <input value={cashForm.note} onChange={(e) => setCashForm((f) => ({ ...f, note: e.target.value }))} />
                    </div>
                  </div>
                </fieldset>

                {difference != null && (
                  <div className={`reconcile-banner ${matched ? 'ok' : difference > 0 ? 'over' : 'short'}`}>
                    {matched ? <CheckCircleIcon size={18} /> : <AlertIcon size={18} />}
                    <div>
                      <strong>
                        {matched
                          ? t('daybook.matched')
                          : difference > 0
                          ? t('daybook.over', { amount: formatRupees(Math.abs(difference), lang) })
                          : t('daybook.short', { amount: formatRupees(Math.abs(difference), lang) })}
                      </strong>
                      <span>{t('daybook.expectedVsCounted', {
                        expected: formatRupees(cash.expectedClosing, lang),
                        counted: formatRupees(cash.counted ?? 0, lang),
                      })}</span>
                    </div>
                  </div>
                )}

                {!locked && (
                  <div className="row-actions" style={{ marginTop: '0.9rem' }}>
                    <button type="submit" className="btn btn-primary btn-inline" disabled={saving}>
                      <BookIcon size={17} />
                      {saving ? t('common.saving') : t('daybook.saveDay')}
                    </button>
                  </div>
                )}
              </form>

              {(cash.history.length > 1 || cash.history.some((entry) => entry.action)) && (
                <details className="daybook-history">
                  <summary>{t('daybook.historyTitle', { count: cash.history.length })}</summary>
                  <ul className="ledger-list">
                    {[...cash.history].reverse().map((entry, index) => (
                      <li key={index}>
                        <span>
                          {formatDateTime(entry.at, lang)}
                          {entry.byName && <em className="ledger-mode">{entry.byName}</em>}
                        </span>
                        <strong>
                          {entry.action === 'reopened'
                            ? t('daybook.historyReopened', { amount: formatRupees(entry.amount, lang) })
                            : entry.action === 'movementDeleted'
                            ? t('daybook.historyMovementDeleted', {
                                kind: t(`daybook.movementKind.${entry.kind}`),
                                amount: formatRupees(entry.amount, lang),
                              })
                            : entry.closingCounted != null
                            ? t('daybook.historyCounted', {
                                counted: formatRupees(entry.closingCounted, lang),
                                expected: formatRupees(entry.expected ?? 0, lang),
                              })
                            : t('daybook.historyNotCounted')}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </>
        )
      )}
    </>
  );
}
