'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { useToast } from '../../components/Toast';
import { SkeletonTable } from '../../components/Skeleton';
import { CalendarIcon, WalletIcon, RupeeIcon, CheckCircleIcon } from '../../components/Icons';
import { formatDate } from '../../../lib/format';

const STATUS_BADGE = {
  present: 'badge-active',
  half_day: 'badge-pending',
  absent: 'badge-danger',
  leave: 'badge-inactive',
};

const KIND_LABEL = {
  salary: 'staff.kindSalary',
  advance: 'staff.kindAdvance',
  bonus: 'staff.kindBonus',
  deduction: 'staff.kindDeduction',
};

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function rupees(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

/**
 * The one screen in the app that belongs to the staff member rather than to the shop.
 *
 * Everything the last round added — attendance marked by the owner, pagaar, advances,
 * deductions — is a record kept ABOUT this person, and until now they could not see any
 * of it. Their entire presence in the app was a check-in button in the topbar. An employee
 * who has to ask the owner to read their own attendance back to them does not have a
 * record, they have a rumour, and the argument that follows on the 1st is the thing this
 * screen exists to prevent.
 *
 * The figures come from the same `buildPayroll` the owner's payroll tab uses, on purpose:
 * two calculations of one person's pay is how the app manufactures that argument instead.
 * Nothing here is editable — it is a statement, not a form.
 */
export default function MyWorkPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();

  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/api/seller/staff/me/summary?month=${month}`)
      .then(setData)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const me = data?.me;

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('staff.myWorkTitle')}</h1>
          <p>{t('staff.myWorkSubtitle')}</p>
        </div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>

      {loading ? (
        <div className="panel"><SkeletonTable rows={4} cols={3} /></div>
      ) : !me ? (
        <div className="empty-state-rich">
          <Illustration scene="calendar" />
          <p>{t('staff.myNothingYet')}</p>
        </div>
      ) : (
        <>
          <div className="mywork-grid">
            {/* Only ever the one figure. A screen that opens with six numbers has not
                answered anything. */}
            <div className="mywork-hero">
              <div className="mywork-hero-value">{rupees(Math.max(me.payable, 0))}</div>
              <div className="mywork-hero-label">
                {me.payable > 0 ? t('staff.myPayableNote') : t('staff.settled')}
              </div>
            </div>

            {/* The `.stat-icon` corner mark every other seller screen's stat cards carry
                (appointments, jobs, stores, suppliers…). These three were bare, which on
                a phone made a staff member's own month read as three loose numbers.
                Each glyph says what KIND of number it is, so the row can be read without
                the labels: days attended, days not, money already in hand. */}
            <div className="stat-card accent-success">
              <div className="stat-icon"><CheckCircleIcon size={16} /></div>
              <div className="stat-value">{me.present}</div>
              <div className="stat-label">{t('staff.present')}</div>
            </div>
            <div className="stat-card">
              {/* A calendar, not a warning triangle: days off are a fact of a month, not
                  a problem with it, and this screen belongs to the person who took them. */}
              <div className="stat-icon"><CalendarIcon size={16} /></div>
              <div className="stat-value">{me.absent + me.leave}</div>
              <div className="stat-label">{t('staff.absent')} + {t('staff.leave')}</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon"><WalletIcon size={16} /></div>
              <div className="stat-value">{rupees(me.paid)}</div>
              <div className="stat-label">{t('staff.paidSoFar')}</div>
            </div>
          </div>

          <div className="panel">
            <div className="section-title">
              <div className="icon-badge icon-brand"><WalletIcon size={16} /></div>
              <h2>{t('staff.myPayTitle')}</h2>
            </div>

            {me.salary > 0 && (
              <div className="mywork-line">
                <span className="mywork-line-label">{t('staff.salary')}</span>
                <span className="mywork-line-value">{rupees(me.salary)}</span>
              </div>
            )}
            {me.commissionRate > 0 && (
              <div className="mywork-line">
                <span className="mywork-line-label">
                  {t('staff.commissionEarned')} · {me.commissionRate}% · {me.billCount} {t('seller.billCount').toLowerCase()}
                </span>
                <span className="mywork-line-value">{rupees(me.commission)}</span>
              </div>
            )}
            {me.bonus > 0 && (
              <div className="mywork-line">
                <span className="mywork-line-label">{t('staff.bonus')}</span>
                <span className="mywork-line-value amount-in">+{rupees(me.bonus)}</span>
              </div>
            )}
            {me.deduction > 0 && (
              <div className="mywork-line">
                <span className="mywork-line-label">{t('staff.deduction')}</span>
                <span className="mywork-line-value">−{rupees(me.deduction)}</span>
              </div>
            )}
            <div className="mywork-line">
              <span className="mywork-line-label"><strong>{t('staff.earned')}</strong></span>
              <span className="mywork-line-value">{rupees(me.earned)}</span>
            </div>
            {me.advance > 0 && (
              <div className="mywork-line">
                <span className="mywork-line-label">{t('staff.myAdvanceNote')}</span>
                <span className="mywork-line-value">−{rupees(me.advance)}</span>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="section-title">
              <div className="icon-badge icon-brand"><RupeeIcon size={16} /></div>
              <h2>{t('staff.myPaymentsTitle')}</h2>
            </div>
            {data.payments.length === 0 ? (
              <p className="empty-state">{t('staff.noPayments')}</p>
            ) : (
              <div className="table-wrap auto-height">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('expenses.date')}</th>
                      <th>{t('staff.entryKind')}</th>
                      <th className="num">{t('staff.amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td className="cell-muted">{formatDate(payment.date, lang)}</td>
                        <td>
                          <div className="cell-stack">
                            <span className="badge badge-pending">{t(KIND_LABEL[payment.kind])}</span>
                            {payment.note && <span className="cell-sub">{payment.note}</span>}
                          </div>
                        </td>
                        <td className="num">{rupees(payment.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="section-title">
              <div className="icon-badge icon-brand"><CalendarIcon size={16} /></div>
              <h2>{t('staff.myDaysTitle')}</h2>
            </div>
            {data.attendance.length === 0 ? (
              <p className="empty-state">{t('seller.noAttendanceYet')}</p>
            ) : (
              <div className="table-wrap auto-height">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('expenses.date')}</th>
                      <th>{t('seller.checkIn')}</th>
                      <th>{t('seller.checkOut')}</th>
                      <th>{t('common.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.attendance.map((record) => (
                      <tr key={record.id}>
                        <td className="cell-muted">{formatDate(record.date, lang)}</td>
                        <td>{formatTime(record.checkIn)}</td>
                        <td>{formatTime(record.checkOut)}</td>
                        <td>
                          <div className="cell-stack">
                            <span className={`badge ${STATUS_BADGE[record.status] || 'badge-inactive'}`}>
                              {t(`seller.attendanceStatus.${record.status}`)}
                            </span>
                            {/* Said plainly, because a row the owner wrote is the row an
                                employee is most likely to want to talk about. A different
                                key from the owner's screen on purpose: "marked by you" is
                                true over there and exactly backwards over here. */}
                            {record.markedByOwner && <span className="cell-sub">{t('staff.markedByShop')}</span>}
                            {record.note && <span className="cell-sub">{record.note}</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
