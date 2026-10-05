'use client';

import { useEffect, useState } from 'react';
import { apiFetch, downloadFile } from '../../lib/api';
import { apiErrorMessage } from '../../lib/apiErrors';
import { useLanguage } from './LanguageProvider';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { SkeletonTable } from './Skeleton';
import Dropdown from './Dropdown';
import {
  WalletIcon, RupeeIcon, TrashIcon, UsersIcon, InfoIcon, DownloadIcon, PlusIcon, MinusIcon,
  CheckCircleIcon, EditIcon, CalendarIcon, UndoIcon,
} from './Icons';
import Modal from './Modal';
import RowMenu from './RowMenu';
import { formatDate } from '../../lib/format';

// The two on the left hand money over; the two on the right only change what is owed.
const KINDS = ['salary', 'advance', 'bonus', 'deduction'];
const MOVES_MONEY = ['salary', 'advance'];
// Written in pairs by "carry forward"; removed together, never edited.
const CARRY = ['carryIn', 'carryOut'];

const KIND_LABEL = {
  salary: 'staff.kindSalary',
  advance: 'staff.kindAdvance',
  bonus: 'staff.kindBonus',
  deduction: 'staff.kindDeduction',
  carryIn: 'staff.kindCarryIn',
  carryOut: 'staff.kindCarryOut',
};

const KIND_BADGE = {
  salary: 'badge-active',
  advance: 'badge-pending',
  bonus: 'badge-pending',
  deduction: 'badge-inactive',
  carryIn: 'badge-inactive',
  carryOut: 'badge-inactive',
};

function rupees(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

// A signed figure that reads the right way round: "−₹500", never "₹-500".
function signedRupees(n) {
  const value = Number(n) || 0;
  return value < 0 ? `−${rupees(-value)}` : rupees(value);
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function monthLabel(period) {
  const [year, month] = String(period || '').split('-').map(Number);
  if (!year || !month) return period || '';
  return new Date(year, month - 1, 15).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

// The date input wants the shop's calendar day, not the UTC one toISOString gives.
function dayKeyOf(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return todayKey();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Month-end pagaar, and the record of what was actually handed over.
 *
 * Every figure comes from the server's payroll sheet (see buildPayroll) and every row adds
 * up on screen: pichla baaki + banta hai − diya − aage gaya = baaki. Commission is computed
 * from the bills credited to each person, never stored. Salary is only ever pro-rated by
 * the days somebody was on the books (joined / left), never by attendance on its own — the
 * absence cut is offered, worked out on the server, and pressed by the owner.
 */
export default function StaffPayroll({ staff, month, onMonthChange }) {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();

  const [payroll, setPayroll] = useState({ rows: [], totals: { earned: 0, paid: 0, payable: 0, previous: 0, carriedForward: 0 }, daysInMonth: 30 });
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [entry, setEntry] = useState(null);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [carrying, setCarrying] = useState(false);

  const fail = (err) => toast.error(apiErrorMessage(lang, err));

  function load() {
    setLoading(true);
    Promise.all([
      apiFetch(`/api/seller/staff/payroll?month=${month}`),
      apiFetch(`/api/seller/staff/payments?month=${month}`),
    ])
      .then(([payrollData, paymentData]) => {
        setPayroll({
          ...payrollData,
          rows: payrollData?.rows || [],
          totals: { previous: 0, carriedForward: 0, ...(payrollData?.totals || {}) },
        });
        setPayments(paymentData?.payments || []);
      })
      .catch(fail)
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [month]);

  // Opening the sheet pre-filled with what is left to pay is the whole point: the owner
  // presses "pay pagaar" and the amount is already the amount.
  function openEntry(row, kind) {
    setEntry({
      id: null,
      staffId: row.staffId,
      name: row.name,
      kind,
      amount: kind === 'salary' && row.payable > 0 ? String(row.payable) : '',
      paymentMode: 'cash',
      date: todayKey(),
      note: '',
    });
  }

  function openEdit(payment) {
    setEntry({
      id: payment.id,
      staffId: payment.staffId,
      name: payment.staffName,
      kind: payment.kind,
      amount: String(payment.amount),
      paymentMode: payment.paymentMode || 'cash',
      date: dayKeyOf(payment.date),
      note: payment.note || '',
    });
  }

  async function submitEntry(event) {
    event.preventDefault();
    const amount = Number(entry.amount);
    if (!amount || amount <= 0) {
      toast.error(t('staff.amountRequired'));
      return;
    }
    if (entry.date && entry.date > todayKey()) {
      toast.error(t('staff.noFutureDate'));
      return;
    }
    setSaving(true);
    try {
      if (entry.id) {
        await apiFetch(`/api/seller/staff/payments/${entry.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            amount,
            paymentMode: entry.paymentMode,
            note: entry.note,
            date: entry.date,
          }),
        });
      } else {
        await apiFetch('/api/seller/staff/payments', {
          method: 'POST',
          body: JSON.stringify({
            staffId: entry.staffId,
            kind: entry.kind,
            amount,
            period: month,
            paymentMode: entry.paymentMode,
            date: entry.date,
            note: entry.note,
          }),
        });
      }
      toast.success(t('staff.paymentSaved'));
      setEntry(null);
      load();
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  }

  /**
   * The one place attendance touches money, and it is opt-in on purpose.
   *
   * The figure is the server's (full pagaar ÷ days in month × (absent + half of half days)),
   * less whatever was already cut for these days — so a second press can never take the
   * same days twice. It lands as a visible deduction the owner can edit or remove.
   */
  async function cutForAbsence(row) {
    const perDay = row.monthlySalary / (payroll.daysInMonth || 30);
    const ok = await confirm({
      title: t('staff.absentCut', { days: row.absent + (row.halfDay ? row.halfDay / 2 : 0) }),
      body: t('staff.absentCutHint', { amount: rupees(row.absenceCutDue), rate: rupees(Math.round(perDay)) }),
      details: [
        { label: t('staff.absent'), value: String(row.absent) },
        ...(row.halfDay ? [{ label: t('staff.halfDay'), value: String(row.halfDay) }] : []),
        { label: t('staff.deduction'), value: `−${rupees(row.absenceCutDue)}`, tone: 'danger' },
      ],
      confirmLabel: t('staff.absentCutApply'),
    });
    if (!ok) return;
    try {
      await apiFetch('/api/seller/staff/payments/absence-cut', {
        method: 'POST',
        body: JSON.stringify({ staffId: row.staffId, period: month }),
      });
      toast.success(t('staff.absentCutDone'));
      load();
    } catch (err) {
      fail(err);
    }
  }

  /**
   * Close a month's balance into the next one — one person, or everyone left open.
   *
   * Without this each month was an island: an advance bigger than the pagaar sat on its
   * month as "paid ahead" and the next month asked for the full pagaar again, and money left
   * unpaid simply fell off the sheet when the month changed.
   */
  async function carryForward({ period, row = null, amount, count }) {
    const next = (() => {
      const [y, m] = period.split('-').map(Number);
      const d = new Date(y, m, 15);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();
    const ok = await confirm({
      tone: 'info',
      title: t('staff.carryTitle', { from: monthLabel(period), to: monthLabel(next) }),
      body: row ? t('staff.carryBodyOne', { name: row.name }) : t('staff.carryBodyAll', { count }),
      details: row
        ? [{
          label: row.payable > 0 ? t('staff.carryOwed') : t('staff.carryAhead'),
          value: rupees(Math.abs(row.payable)),
          tone: row.payable > 0 ? 'danger' : undefined,
        }]
        : amount,
      confirmLabel: t('staff.carryApply'),
    });
    if (!ok) return;
    setCarrying(true);
    try {
      await apiFetch('/api/seller/staff/payments/carry', {
        method: 'POST',
        body: JSON.stringify({ period, staffId: row ? row.staffId : undefined }),
      });
      toast.success(t('staff.carryDone'));
      load();
    } catch (err) {
      fail(err);
    } finally {
      setCarrying(false);
    }
  }

  // A shop pays wages against a printed sheet, not a browser tab, and the CA asks for
  // the same file at year end. Never an <a href> — the route needs the session cookie and
  // the CSRF header, which a plain link does not send.
  async function exportSheet() {
    setDownloading(true);
    try {
      await downloadFile(`/api/seller/staff/payroll?month=${month}&format=xlsx`, `payroll-${month}.xlsx`);
    } catch (err) {
      fail(err);
    } finally {
      setDownloading(false);
    }
  }

  async function removePayment(payment) {
    const isCarry = CARRY.includes(payment.kind);
    const details = [];
    // Only said when it is true — a bonus or a deduction never wrote a kharcha.
    if (payment.hasExpense) details.push(t('staff.confirmDeletePaymentBooks'));
    if (isCarry) details.push(t('staff.confirmDeleteCarry'));
    const ok = await confirm({
      tone: 'danger',
      title: t('common.delete'),
      body: t('staff.confirmDeletePayment', {
        kind: t(KIND_LABEL[payment.kind] || 'staff.entryKind'),
        amount: Math.abs(Number(payment.amount) || 0).toLocaleString('en-IN'),
      }),
      details,
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/seller/staff/payments/${payment.id}`, { method: 'DELETE' });
      toast.success(t('staff.paymentRemoved'));
      load();
    } catch (err) {
      fail(err);
    }
  }

  if (staff.length === 0) {
    return (
      <div className="empty-state-rich">
        <div className="empty-icon"><UsersIcon size={26} /></div>
        <p>{t('staff.noStaffYet')}</p>
      </div>
    );
  }

  const { totals } = payroll;
  const showPrevious = payroll.rows.some((row) => row.previous);
  const open = payroll.previousOpen;
  const isEditing = Boolean(entry?.id);

  return (
    <div className="staff-tab">
      <div className="data-panel">
        <div className="panel-head">
          <h2>{t('staff.payrollTitle')}</h2>
          <div className="panel-tools">
            <input type="month" value={month} onChange={(e) => e.target.value && onMonthChange(e.target.value)} />
            <button
              type="button"
              className="btn btn-secondary btn-small btn-inline"
              onClick={exportSheet}
              disabled={downloading || payroll.rows.length === 0}
            >
              <DownloadIcon size={15} />
              {downloading ? t('common.saving') : t('staff.exportSheet')}
            </button>
          </div>
        </div>

        <div className="data-panel-body">
          <p className="field-hint" style={{ marginTop: 0 }}>{t('staff.payrollHint')}</p>

          {/* Last month left open is money that stops being on any screen the moment the
              month changes. Said here, with the one press that brings it across. */}
          {!loading && open && (
            <div className="info-banner banner-with-action">
              <span>
                <InfoIcon size={15} />
                {t('staff.previousOpen', { month: monthLabel(open.month), count: open.count })}
                {open.owed > 0 && ` ${t('staff.previousOpenOwed', { amount: rupees(open.owed) })}`}
                {open.ahead > 0 && ` ${t('staff.previousOpenAhead', { amount: rupees(open.ahead) })}`}
              </span>
              <span style={{ display: 'inline-flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button type="button" className="banner-action" onClick={() => onMonthChange(open.month)}>
                  {t('staff.previousOpenView')}
                </button>
                <button
                  type="button"
                  className="banner-action"
                  disabled={carrying}
                  onClick={() => carryForward({
                    period: open.month,
                    count: open.count,
                    amount: [
                      ...(open.owed > 0 ? [{ label: t('staff.carryOwed'), value: rupees(open.owed), tone: 'danger' }] : []),
                      ...(open.ahead > 0 ? [{ label: t('staff.carryAhead'), value: rupees(open.ahead) }] : []),
                    ],
                  })}
                >
                  {t('staff.previousOpenBring')}
                </button>
              </span>
            </div>
          )}

          {loading ? (
            <SkeletonTable rows={4} cols={6} />
          ) : (
            <>
              <div className="stat-grid" style={{ marginBottom: '0.9rem' }}>
                {/* Three amounts that are easy to read as one number three times. The
                    glyphs are what separate them at a glance: what the month EARNED, what
                    has already LEFT the counter, and what is still owed — the last one
                    carrying the danger accent, because it is the only one of the three
                    that is a debt the shop still has to settle. */}
                <div className="stat-card">
                  <div className="stat-icon"><RupeeIcon size={16} /></div>
                  <div className="stat-value">{rupees(totals.earned)}</div>
                  <div className="stat-label">{t('staff.totalEarned')}</div>
                  {totals.previous ? (
                    <div className="stat-sub">{t('staff.plusPrevious', { amount: signedRupees(totals.previous) })}</div>
                  ) : null}
                </div>
                <div className="stat-card accent-success">
                  <div className="stat-icon"><CheckCircleIcon size={16} /></div>
                  <div className="stat-value">{rupees(totals.paid)}</div>
                  <div className="stat-label">{t('staff.totalPaid')}</div>
                </div>
                <div className="stat-card accent-danger">
                  <div className="stat-icon"><WalletIcon size={16} /></div>
                  <div className="stat-value amount-out">{signedRupees(totals.payable)}</div>
                  <div className="stat-label">{t('staff.totalPayable')}</div>
                  {totals.carriedForward ? (
                    <div className="stat-sub">{t('staff.carriedOutSub', { amount: signedRupees(totals.carriedForward) })}</div>
                  ) : null}
                </div>
              </div>

              {payroll.rows.length === 0 ? (
                <p className="empty-state">{t('staff.noOneThisMonth')}</p>
              ) : (
              <div className="table-wrap auto-height">
                <table className="data-table sticky-actions" style={{ minWidth: showPrevious ? '960px' : '860px' }}>
                  <thead>
                    <tr>
                      <th>{t('common.name')}</th>
                      <th className="num">{t('staff.salary')}</th>
                      <th className="num">{t('staff.commissionEarned')}</th>
                      <th className="num">{t('staff.earned')}</th>
                      {showPrevious && <th className="num">{t('staff.previousBalance')}</th>}
                      <th className="num">{t('staff.paidSoFar')}</th>
                      <th className="num">{t('staff.payable')}</th>
                      <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payroll.rows.map((row) => (
                      <tr key={row.staffId}>
                        <td>
                          <div className="cell-stack">
                            <span className="cell-strong">{row.name}</span>
                            <span className="cell-sub">
                              {[
                                row.jobTitle,
                                `${row.present} ${t('staff.present').toLowerCase()}`,
                                row.halfDay ? `${row.halfDay} ${t('staff.halfDay').toLowerCase()}` : null,
                                row.absent ? `${row.absent} ${t('staff.absent').toLowerCase()}` : null,
                              ].filter(Boolean).join(' · ')}
                            </span>
                            {row.leftOn && (
                              <span className="cell-sub">{t('staff.leftOnShort', { date: formatDate(row.leftOn, lang) })}</span>
                            )}
                          </div>
                        </td>
                        <td className="num">
                          <div className="cell-stack">
                            <span>{row.monthlySalary ? rupees(row.salary) : '—'}</span>
                            {/* Joining or leaving mid-month — the only thing that ever
                                changes the pagaar on its own, so it always says why. */}
                            {row.salaryProrated && (
                              <span className="cell-sub">
                                {t('staff.proratedDays', { days: row.employedDays, total: payroll.daysInMonth, full: rupees(row.monthlySalary) })}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="num">
                          <div className="cell-stack">
                            <span>{row.commission ? rupees(row.commission) : '—'}</span>
                            {row.commissionRate > 0 && (
                              <span className="cell-sub">{row.commissionRate}% · {row.billCount} {t('seller.billCount').toLowerCase()}</span>
                            )}
                          </div>
                        </td>
                        <td className="num">
                          <div className="cell-stack">
                            <span className="cell-strong">{rupees(row.earned)}</span>
                            {(row.bonus > 0 || row.deduction > 0) && (
                              <span className="cell-sub">
                                {[
                                  row.bonus > 0 ? `+${rupees(row.bonus)} ${t('staff.bonus').toLowerCase()}` : null,
                                  row.deduction > 0 ? `−${rupees(row.deduction)} ${t('staff.deduction').toLowerCase()}` : null,
                                ].filter(Boolean).join(' · ')}
                              </span>
                            )}
                          </div>
                        </td>
                        {showPrevious && (
                          <td className="num">{row.previous ? signedRupees(row.previous) : '—'}</td>
                        )}
                        <td className="num">
                          <div className="cell-stack">
                            <span>{rupees(row.paid)}</span>
                            {row.advance > 0 && (
                              <span className="cell-sub">{rupees(row.advance)} {t('staff.kindAdvance').toLowerCase()}</span>
                            )}
                          </div>
                        </td>
                        <td className="num">
                          <div className="cell-stack">
                            {row.payable >= 0.5 ? (
                              <strong className="amount-out">{rupees(row.payable)}</strong>
                            ) : row.payable <= -0.5 ? (
                              <span className="cell-sub">{t('staff.overpaid')} {rupees(-row.payable)}</span>
                            ) : (
                              <span className="cell-sub">{t('staff.settled')}</span>
                            )}
                            {row.carriedForward ? (
                              <span className="cell-sub">{t('staff.carriedOutSub', { amount: signedRupees(row.carriedForward) })}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="tight">
                          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                            {/* Advance, bonus and deduction are three kinds of money moving
                                in three different directions, and the word is the only
                                thing that says which — they stay words, in the menu. Paying
                                the salary is the one this table is opened for. */}
                            <button
                              type="button"
                              className="icon-btn primary"
                              data-tip={t('staff.payNow')}
                              onClick={() => openEntry(row, 'salary')}
                            >
                              <RupeeIcon size={17} />
                            </button>
                            <RowMenu
                              items={[
                                {
                                  label: t('staff.giveAdvance'),
                                  icon: <WalletIcon size={15} />,
                                  onClick: () => openEntry(row, 'advance'),
                                },
                                {
                                  label: t('staff.addBonus'),
                                  icon: <PlusIcon size={15} />,
                                  onClick: () => openEntry(row, 'bonus'),
                                },
                                {
                                  label: t('staff.addDeduction'),
                                  icon: <MinusIcon size={15} />,
                                  onClick: () => openEntry(row, 'deduction'),
                                },
                                {
                                  /* Offered only while there is something left to cut —
                                     once pressed, it disappears until another absence. */
                                  label: t('staff.absentCutMenu', { amount: rupees(row.absenceCutDue) }),
                                  icon: <CalendarIcon size={15} />,
                                  hidden: !(row.absenceCutDue >= 1),
                                  onClick: () => cutForAbsence(row),
                                },
                                {
                                  label: t('staff.carryMenu'),
                                  icon: <UndoIcon size={15} />,
                                  hidden: !(Math.abs(row.payable) >= 1) || month > todayKey().slice(0, 7),
                                  onClick: () => carryForward({ period: month, row }),
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
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-brand"><WalletIcon size={16} /></div>
          <h2>{t('staff.paymentsTitle')}</h2>
        </div>

        {loading ? (
          <SkeletonTable rows={3} cols={5} />
        ) : payments.length === 0 ? (
          <p className="empty-state">{t('staff.noPayments')}</p>
        ) : (
          <div className="table-wrap auto-height">
            <table className="data-table sticky-actions" style={{ minWidth: '620px' }}>
              <thead>
                <tr>
                  <th>{t('expenses.date')}</th>
                  <th>{t('common.name')}</th>
                  <th>{t('staff.entryKind')}</th>
                  <th className="num">{t('staff.amount')}</th>
                  <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => {
                  const isCarry = CARRY.includes(payment.kind);
                  return (
                    <tr key={payment.id}>
                      <td className="cell-muted">{formatDate(payment.date, lang)}</td>
                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{payment.staffName || '—'}</span>
                          {payment.note && <span className="cell-sub">{payment.note}</span>}
                        </div>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span className={`badge ${KIND_BADGE[payment.kind] || 'badge-inactive'}`}>
                            {t(KIND_LABEL[payment.kind] || 'staff.entryKind')}
                          </span>
                          {MOVES_MONEY.includes(payment.kind) && payment.paymentMode && (
                            <span className="cell-sub">{t(`expenses.mode.${payment.paymentMode}`)}</span>
                          )}
                        </div>
                      </td>
                      <td className="num">
                        {/* A deduction is not money coming IN — painting it green read as
                            earnings. It is an adjustment, so it stays neutral. */}
                        <span className={payment.kind === 'deduction' || isCarry ? 'cell-muted' : 'amount-out'}>
                          {payment.kind === 'deduction' ? `−${rupees(payment.amount)}` : signedRupees(payment.amount)}
                        </span>
                      </td>
                      <td className="tight">
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          {!isCarry && (
                            <button type="button" className="icon-btn" data-tip={t('common.edit')} onClick={() => openEdit(payment)}>
                              <EditIcon size={17} />
                            </button>
                          )}
                          <button type="button" className="icon-btn danger" data-tip={t('common.delete')} onClick={() => removePayment(payment)}>
                            <TrashIcon size={17} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {entry && (
        <Modal
          as="form"
          onSubmit={submitEntry}
          onClose={() => setEntry(null)}
          title={t(isEditing ? 'staff.paymentEditFor' : 'staff.paymentFor', { kind: t(KIND_LABEL[entry.kind]), name: entry.name })}
          hint={`${t('staff.period')}: ${monthLabel(month)}`}
          maxWidth={460}
          footer={
            <>
              <button type="submit" className="btn btn-primary btn-inline" disabled={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setEntry(null)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
              <div className="form-grid cols-2">
                {/* The kind is the one thing an edit cannot change: a pagaar turned into a
                    bonus is a different fact, and is a delete and a new entry. */}
                {!isEditing && (
                  <div className="field field-span2">
                    <label>{t('staff.entryKind')}</label>
                    <div className="segmented" role="group">
                      {KINDS.map((kind) => (
                        <button
                          type="button"
                          key={kind}
                          className={entry.kind === kind ? 'active' : undefined}
                          onClick={() => setEntry((e) => ({ ...e, kind }))}
                        >
                          {t(KIND_LABEL[kind])}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="field">
                  <label htmlFor="payAmount">{t('staff.amount')}</label>
                  <div className="field-affix">
                    <RupeeIcon size={15} />
                    <input
                      id="payAmount"
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      value={entry.amount}
                      onChange={(e) => setEntry((v) => ({ ...v, amount: e.target.value }))}
                      required
                      autoFocus
                    />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="payDate">{MOVES_MONEY.includes(entry.kind) ? t('staff.paidOn') : t('expenses.date')}</label>
                  <input
                    id="payDate"
                    type="date"
                    value={entry.date}
                    max={todayKey()}
                    onChange={(e) => setEntry((v) => ({ ...v, date: e.target.value }))}
                    required
                  />
                </div>

                {MOVES_MONEY.includes(entry.kind) && (
                  <div className="field">
                    <label>{t('staff.mode')}</label>
                    <Dropdown
                      value={entry.paymentMode}
                      onChange={(value) => setEntry((v) => ({ ...v, paymentMode: value }))}
                      options={[
                        { value: 'cash', label: t('expenses.mode.cash') },
                        { value: 'upi', label: t('expenses.mode.upi') },
                        { value: 'bank', label: t('expenses.mode.bank') },
                        { value: 'card', label: t('expenses.mode.card') },
                      ]}
                    />
                  </div>
                )}

                <div className="field field-span2">
                  <label htmlFor="payNote">{t('staff.note')}</label>
                  <input
                    id="payNote"
                    value={entry.note}
                    maxLength={300}
                    onChange={(e) => setEntry((v) => ({ ...v, note: e.target.value }))}
                  />
                </div>
              </div>

              {/* Says what pressing this will actually do to the books, before it does it. */}
              <p className="field-hint" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
                <InfoIcon size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                {MOVES_MONEY.includes(entry.kind)
                  ? (isEditing ? t('staff.editMovesKharcha') : t('staff.writesToKharcha'))
                  : t('staff.adjustOnly')}
              </p>
        </Modal>
      )}
    </div>
  );
}
