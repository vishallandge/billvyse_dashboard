'use client';

import { useEffect, useState } from 'react';
import { apiFetch, downloadFile } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { SkeletonTable } from './Skeleton';
import Dropdown from './Dropdown';
import { WalletIcon, RupeeIcon, TrashIcon, UsersIcon, InfoIcon, DownloadIcon, PlusIcon, MinusIcon, CheckCircleIcon } from './Icons';
import Modal from './Modal';
import RowMenu from './RowMenu';
import { formatDate } from '../../lib/format';

// The two on the left hand money over; the two on the right only change what is owed.
const KINDS = ['salary', 'advance', 'bonus', 'deduction'];
const MOVES_MONEY = ['salary', 'advance'];

const KIND_LABEL = {
  salary: 'staff.kindSalary',
  advance: 'staff.kindAdvance',
  bonus: 'staff.kindBonus',
  deduction: 'staff.kindDeduction',
};

function rupees(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/**
 * Month-end pagaar, and the record of what was actually handed over.
 *
 * The gap this fills: a staff account carried a commission percentage and nothing else,
 * so the app could not answer the one question a dukandar asks on the 1st — *is mahine
 * kitna banta hai, kitna de diya, kitna baaki*. Salary existed only as a free-text
 * kharcha with a name typed into it.
 *
 * The figures come from the server (see payrollSummary): commission is computed from the
 * bills credited to each person, never stored, so it can never drift from what the
 * Reports page says. Salary is never pro-rated automatically — see the absent-day cut
 * below, which is offered but always pressed by the owner.
 */
export default function StaffPayroll({ staff, month, onMonthChange }) {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();

  const [payroll, setPayroll] = useState({ rows: [], totals: { earned: 0, paid: 0, payable: 0 }, daysInMonth: 30 });
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [entry, setEntry] = useState(null);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      apiFetch(`/api/seller/staff/payroll?month=${month}`),
      apiFetch(`/api/seller/staff/payments?month=${month}`),
    ])
      .then(([payrollData, paymentData]) => {
        setPayroll(payrollData);
        setPayments(paymentData.payments);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [month]);

  // Opening the sheet pre-filled with what is left to pay is the whole point: the owner
  // presses "pay pagaar" and the amount is already the amount.
  function openEntry(row, kind) {
    setEntry({
      staffId: row.staffId,
      name: row.name,
      kind,
      amount: kind === 'salary' && row.payable > 0 ? String(row.payable) : '',
      paymentMode: 'cash',
      note: '',
    });
  }

  async function submitEntry(event) {
    event.preventDefault();
    const amount = Number(entry.amount);
    if (!amount || amount <= 0) {
      toast.error(t('staff.amount'));
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/seller/staff/payments', {
        method: 'POST',
        body: JSON.stringify({
          staffId: entry.staffId,
          kind: entry.kind,
          amount,
          period: month,
          paymentMode: entry.paymentMode,
          note: entry.note,
        }),
      });
      toast.success(t('staff.paymentSaved'));
      setEntry(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * The one place attendance touches money, and it is opt-in on purpose.
   *
   * The app never cuts anyone's pagaar on its own — how a shop treats an absent day is a
   * decision about a person, and every shop makes it differently. This works the figure
   * out at a plain per-day rate and enters it as a visible `deduction` row the owner can
   * see on the sheet and delete if they change their mind.
   */
  async function cutForAbsence(row) {
    const perDay = row.salary / (payroll.daysInMonth || 30);
    const amount = Math.round(perDay * row.absent);
    const ok = await confirm({
      title: t('staff.absentCut', { days: row.absent }),
      body: t('staff.absentCutHint', { amount: rupees(amount), rate: rupees(Math.round(perDay)) }),
      confirmLabel: t('staff.absentCutApply'),
    });
    if (!ok) return;
    try {
      await apiFetch('/api/seller/staff/payments', {
        method: 'POST',
        body: JSON.stringify({
          staffId: row.staffId,
          kind: 'deduction',
          amount,
          period: month,
          note: t('staff.absentCut', { days: row.absent }),
        }),
      });
      toast.success(t('staff.absentCutDone'));
      load();
    } catch (err) {
      toast.error(err.message);
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
      toast.error(err.message);
    } finally {
      setDownloading(false);
    }
  }

  async function removePayment(payment) {
    const ok = await confirm({
      tone: 'danger',
      title: t('common.delete'),
      body: t('staff.confirmDeletePayment', {
        kind: t(KIND_LABEL[payment.kind]),
        amount: Number(payment.amount).toLocaleString('en-IN'),
      }),
      // Only said when it is true — a bonus or a deduction never wrote a kharcha.
      details: payment.hasExpense ? t('staff.confirmDeletePaymentBooks') : undefined,
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/seller/staff/payments/${payment.id}`, { method: 'DELETE' });
      toast.success(t('staff.paymentRemoved'));
      load();
    } catch (err) {
      toast.error(err.message);
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

  return (
    <div className="staff-tab">
      <div className="data-panel">
        <div className="panel-head">
          <h2>{t('staff.payrollTitle')}</h2>
          <div className="panel-tools">
            <input type="month" value={month} onChange={(e) => onMonthChange(e.target.value)} />
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
                  <div className="stat-value">{rupees(payroll.totals.earned)}</div>
                  <div className="stat-label">{t('staff.totalEarned')}</div>
                </div>
                <div className="stat-card accent-success">
                  <div className="stat-icon"><CheckCircleIcon size={16} /></div>
                  <div className="stat-value">{rupees(payroll.totals.paid)}</div>
                  <div className="stat-label">{t('staff.totalPaid')}</div>
                </div>
                <div className="stat-card accent-danger">
                  <div className="stat-icon"><WalletIcon size={16} /></div>
                  <div className="stat-value amount-out">{rupees(payroll.totals.payable)}</div>
                  <div className="stat-label">{t('staff.totalPayable')}</div>
                </div>
              </div>

              <div className="table-wrap auto-height">
                <table className="data-table sticky-actions" style={{ minWidth: '860px' }}>
                  <thead>
                    <tr>
                      <th>{t('common.name')}</th>
                      <th className="num">{t('staff.salary')}</th>
                      <th className="num">{t('staff.commissionEarned')}</th>
                      <th className="num">{t('staff.earned')}</th>
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
                                row.absent ? `${row.absent} ${t('staff.absent').toLowerCase()}` : null,
                              ].filter(Boolean).join(' · ')}
                            </span>
                          </div>
                        </td>
                        <td className="num">{row.salary ? rupees(row.salary) : '—'}</td>
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
                        <td className="num">
                          <div className="cell-stack">
                            <span>{rupees(row.paid)}</span>
                            {row.advance > 0 && (
                              <span className="cell-sub">{rupees(row.advance)} {t('staff.kindAdvance').toLowerCase()}</span>
                            )}
                          </div>
                        </td>
                        <td className="num">
                          {row.payable > 0 ? (
                            <strong className="amount-out">{rupees(row.payable)}</strong>
                          ) : row.payable < 0 ? (
                            <span className="cell-sub">{t('staff.overpaid')} {rupees(-row.payable)}</span>
                          ) : (
                            <span className="cell-sub">{t('staff.settled')}</span>
                          )}
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
                                  /* Offered only where it can mean something: somebody on a
                                     salary who actually missed days. */
                                  label: t('staff.addDeduction'),
                                  icon: <MinusIcon size={15} />,
                                  hidden: !(row.absent > 0 && row.salary > 0),
                                  onClick: () => cutForAbsence(row),
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
            <table className="data-table sticky-actions" style={{ minWidth: '560px' }}>
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
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="cell-muted">{formatDate(payment.date, lang)}</td>
                    <td>
                      <div className="cell-stack">
                        <span className="cell-strong">{payment.staffName}</span>
                        {payment.note && <span className="cell-sub">{payment.note}</span>}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${payment.kind === 'deduction' ? 'badge-inactive' : 'badge-pending'}`}>
                        {t(KIND_LABEL[payment.kind])}
                      </span>
                    </td>
                    <td className="num">
                      {/* A deduction is not money coming IN — painting it green read as
                          earnings. It is an adjustment, so it stays neutral. */}
                      <span className={payment.kind === 'deduction' ? 'cell-muted' : 'amount-out'}>
                        {payment.kind === 'deduction' ? '−' : ''}{rupees(payment.amount)}
                      </span>
                    </td>
                    <td className="tight">
                      <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                        <button type="button" className="icon-btn danger" data-tip={t('common.delete')} onClick={() => removePayment(payment)}>
                          <TrashIcon size={17} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
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
          title={t('staff.paymentFor', { kind: t(KIND_LABEL[entry.kind]), name: entry.name })}
          hint={`${t('staff.period')}: ${month}`}
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

                <div className="field">
                  <label htmlFor="payAmount">{t('staff.amount')}</label>
                  <div className="field-affix">
                    <RupeeIcon size={15} />
                    <input
                      id="payAmount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={entry.amount}
                      onChange={(e) => setEntry((v) => ({ ...v, amount: e.target.value }))}
                      required
                      autoFocus
                    />
                  </div>
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
                    onChange={(e) => setEntry((v) => ({ ...v, note: e.target.value }))}
                  />
                </div>
              </div>

              {/* Says what pressing this will actually do to the books, before it does it. */}
              <p className="field-hint" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
                <InfoIcon size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                {MOVES_MONEY.includes(entry.kind) ? t('staff.writesToKharcha') : t('staff.adjustOnly')}
              </p>

        </Modal>
      )}
    </div>
  );
}
