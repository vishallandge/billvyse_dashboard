'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { formatRupees, toDateInput } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import AnimatedNumber from '../../components/AnimatedNumber';
import { SkeletonStats, SkeletonCards } from '../../components/Skeleton';
import { BookIcon, CheckCircleIcon, AlertIcon, WalletIcon, PlusIcon } from '../../components/Icons';

function shiftDay(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateInput(date);
}

export default function DayBookPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();

  const today = toDateInput();
  const [date, setDate] = useState(today);
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cashForm, setCashForm] = useState({ openingCash: '', closingCounted: '', note: '' });
  const [saving, setSaving] = useState(false);

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
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [date]);

  useEffect(load, [load]);

  async function saveCash(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/seller/expenses/daybook/cash', {
        method: 'POST',
        body: JSON.stringify({ date, ...cashForm }),
      });
      toast.success(t('daybook.saved'));
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const cash = book?.cash;
  const difference = cash?.difference;
  const matched = difference != null && Math.abs(difference) < 0.5;

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
                {cash.carriedForward && <span className="cash-step-hint">{t('daybook.carriedForward')}</span>}
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
                </ul>
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

            <div className="panel">
              <h2>{t('daybook.closeDay')}</h2>
              <form onSubmit={saveCash}>
                <div className="form-grid">
                  <div className="field">
                    <label>{t('daybook.openingCash')}</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={cashForm.openingCash}
                      onChange={(e) => setCashForm((f) => ({ ...f, openingCash: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>{t('daybook.countedCash')}</label>
                    <input
                      type="number"
                      step="1"
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

                <div className="row-actions" style={{ marginTop: '0.9rem' }}>
                  <button type="submit" className="btn btn-primary btn-inline" disabled={saving}>
                    <BookIcon size={17} />
                    {saving ? t('common.saving') : t('daybook.saveDay')}
                  </button>
                </div>
              </form>
            </div>
          </>
        )
      )}
    </>
  );
}
