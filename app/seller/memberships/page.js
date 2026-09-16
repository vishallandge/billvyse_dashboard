'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { formatRupees, toDateInput } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useHiddenNav } from '../../components/DashboardShell';
import { SkeletonStats, SkeletonTable } from '../../components/Skeleton';
import Dropdown from '../../components/Dropdown';
import PhoneField from '../../components/PhoneField';
import Modal from '../../components/Modal';
import {
  PlusIcon, XIcon, EditIcon, TrashIcon, ClockIcon, AlertIcon, RupeeIcon, StarIcon, RefreshIcon, CheckCircleIcon,
} from '../../components/Icons';
import RowMenu from '../../components/RowMenu';
import CustomerQuickAdd from '../../components/CustomerQuickAdd';
import { recordHref } from '../../../lib/routeId';

const PAYMENT_MODES = ['cash', 'upi', 'card', 'khata'];

function inNDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toDateInput(d);
}

function emptyForm() {
  return {
    customerId: '',
    staffId: '',
    planName: '',
    startDate: toDateInput(),
    endDate: inNDays(30),
    amount: '',
    totalSessions: '',
    notes: '',
    familyMembers: [],
    useInstallments: false,
    installments: [],
  };
}

export default function MembershipsPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();

  const [statusFilter, setStatusFilter] = useState('active');
  const [data, setData] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [renewing, setRenewing] = useState(null);
  const [renewForm, setRenewForm] = useState({ endDate: '', amount: '' });
  // { membership, installmentIndex: null (whole plan) | number (one instalment) }
  const [billing, setBilling] = useState(null);
  const [billMode, setBillMode] = useState('cash');
  /**
   * Adding the member here, on the form that needs one.
   *
   * A membership must point at a real Customer — a plan with an end date and instalments is
   * worthless attached to a name typed once and forgotten. But a gym on its first day has no
   * customers, and this form's only required field was a dropdown with nothing in it and a
   * refusal ("customer choose karein") that named no way to get one. Two fields fix it.
   *
   * The customer is created through the khata API, deliberately — one code path, one set of
   * duplicate-phone rules, and the paid-plan gate on writing khata stays exactly where it is
   * rather than getting a second door. When that gate is what's in the way, this says so and
   * points at the plan page instead of failing quietly (see khataLocked).
   */
  const [addingCustomer, setAddingCustomer] = useState(false);
  const hiddenNav = useHiddenNav();
  // Khata is a paid feature; when the plan doesn't carry it, /api/seller/khata/* answers 403
  // and the dropdown above can never fill. The sidebar already knows — reuse its answer
  // rather than guessing from a failed request.
  const khataLocked = hiddenNav.includes('khata');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    return params.toString();
  }, [statusFilter]);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/seller/memberships?${query}`)
      .then((result) => {
        setData(result);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(load, [load]);

  useEffect(() => {
    apiFetch('/api/seller/khata/customers')
      .then((result) => setCustomers(result.customers || []))
      .catch(() => {});
    apiFetch('/api/seller/staff')
      .then((result) => setStaff(result.staff || []))
      .catch(() => {});
  }, []);

  const memberships = data?.memberships || [];
  const summary = data?.summary;

  const installmentsTotal = form.installments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const installmentsMismatch =
    form.useInstallments && form.installments.length > 0 && Math.abs(installmentsTotal - (Number(form.amount) || 0)) > 0.01;

  function openAdd() {
    setForm(emptyForm());
    setEditingId(null);
    // Not pre-opened: the quick-add is a modal, and stacking it over the form the shopkeeper
    // just asked for hides that form. An empty book already says so in the picker — a hint
    // plus a "New member" button — and trying to save without one opens this anyway.
    setAddingCustomer(false);
    setFormOpen(true);
  }


  function openEdit(m) {
    setAddingCustomer(false);
    setForm({
      customerId: m.customer?.id || '',
      staffId: m.staff || '',
      planName: m.planName,
      startDate: toDateInput(m.startDate),
      endDate: toDateInput(m.endDate),
      amount: m.amount ?? '',
      totalSessions: m.totalSessions ?? '',
      notes: m.notes || '',
      familyMembers: m.familyMembers || [],
      useInstallments: false,
      installments: [],
    });
    setEditingId(m._id);
    setFormOpen(true);
  }

  function addFamilyMember() {
    setForm((f) => ({ ...f, familyMembers: [...f.familyMembers, { name: '', phone: '', relation: '' }] }));
  }
  function updateFamilyMember(index, key, value) {
    setForm((f) => ({ ...f, familyMembers: f.familyMembers.map((row, i) => (i === index ? { ...row, [key]: value } : row)) }));
  }
  function removeFamilyMember(index) {
    setForm((f) => ({ ...f, familyMembers: f.familyMembers.filter((_, i) => i !== index) }));
  }

  function addInstallment() {
    setForm((f) => ({ ...f, installments: [...f.installments, { amount: '', dueDate: '' }] }));
  }
  function updateInstallment(index, key, value) {
    setForm((f) => ({ ...f, installments: f.installments.map((row, i) => (i === index ? { ...row, [key]: value } : row)) }));
  }
  function removeInstallment(index) {
    setForm((f) => ({ ...f, installments: f.installments.filter((_, i) => i !== index) }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.planName.trim()) {
      toast.error(t('memberships.needPlan'));
      return;
    }
    if (!editingId && !form.customerId) {
      // Same rule as the appointment book: a refusal opens the thing that satisfies it.
      if (customers.length === 0 && !khataLocked && !addingCustomer) setAddingCustomer(true);
      toast.error(t('memberships.needCustomer'));
      return;
    }
    if (installmentsMismatch) {
      toast.error(t('memberships.installmentsMismatchError'));
      return;
    }

    setSubmitting(true);
    try {
      const body = JSON.stringify({
        customerId: form.customerId || undefined,
        // '' rather than undefined for editingId — updateMembership only clears an
        // already-assigned trainer when the field is present at all in the body.
        staffId: editingId ? form.staffId || '' : form.staffId || undefined,
        planName: form.planName,
        startDate: form.startDate,
        endDate: form.endDate,
        amount: Number(form.amount) || 0,
        totalSessions: form.totalSessions === '' ? undefined : Number(form.totalSessions),
        notes: form.notes || undefined,
        familyMembers: form.familyMembers.filter((row) => row.name.trim()),
        installments:
          !editingId && form.useInstallments && form.installments.length > 0
            ? form.installments.map((row) => ({ amount: Number(row.amount) || 0, dueDate: row.dueDate }))
            : undefined,
      });
      if (editingId) {
        await apiFetch(`/api/seller/memberships/${editingId}`, { method: 'PATCH', body });
        toast.success(t('memberships.updated'));
      } else {
        await apiFetch('/api/seller/memberships', { method: 'POST', body });
        toast.success(t('memberships.created'));
      }
      setFormOpen(false);
      setEditingId(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function markSessionUsed(m) {
    setBusyId(m._id);
    try {
      await apiFetch(`/api/seller/memberships/${m._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ usedSessions: (m.usedSessions || 0) + 1 }),
      });
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function cancelMembership(m) {
    if (!(await confirm({ tone: 'danger', title: t('memberships.cancelTitle'), cancelLabel: t('common.goBack'), body: t('memberships.confirmCancel'), confirmLabel: t('memberships.cancelTitle') }))) return;
    setBusyId(m._id);
    try {
      await apiFetch(`/api/seller/memberships/${m._id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(m) {
    if (!(await confirm({ tone: 'danger', title: t('common.delete'), body: t('memberships.confirmDelete'), confirmLabel: t('common.delete') }))) return;
    setBusyId(m._id);
    try {
      await apiFetch(`/api/seller/memberships/${m._id}`, { method: 'DELETE' });
      toast.success(t('memberships.deleted'));
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function freezeMembership(m) {
    setBusyId(m._id);
    try {
      await apiFetch(`/api/seller/memberships/${m._id}/freeze`, { method: 'POST' });
      toast.success(t('memberships.frozen'));
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function resumeMembership(m) {
    setBusyId(m._id);
    try {
      const result = await apiFetch(`/api/seller/memberships/${m._id}/resume`, { method: 'POST' });
      toast.success(t('memberships.resumed', { days: result.frozenDays }));
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function openRenew(m) {
    setRenewing(m);
    setRenewForm({ endDate: '', amount: String(m.amount || '') });
  }

  async function submitRenew(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch(`/api/seller/memberships/${renewing._id}/renew`, {
        method: 'POST',
        body: JSON.stringify({
          endDate: renewForm.endDate || undefined,
          amount: renewForm.amount === '' ? undefined : Number(renewForm.amount),
        }),
      });
      toast.success(t('memberships.renewed'));
      setRenewing(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitBill(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const { membership, installmentIndex } = billing;
      const url =
        installmentIndex === null
          ? `/api/seller/memberships/${membership._id}/bill`
          : `/api/seller/memberships/${membership._id}/installments/${installmentIndex}/bill`;
      const result = await apiFetch(url, { method: 'POST', body: JSON.stringify({ paymentMode: billMode }) });
      toast.success(t('memberships.billedToast', { number: result.bill.billNumber }));
      setBilling(null);
      setBillMode('cash');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const billingAmount = billing
    ? billing.installmentIndex === null
      ? billing.membership.amount
      : billing.membership.installments[billing.installmentIndex].amount
    : 0;

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('memberships.title')}</h1>
          <p>{t('memberships.subtitle')}</p>
        </div>
        <button type="button" className="btn btn-primary btn-inline" onClick={openAdd}>
          <PlusIcon size={17} />
          {t('memberships.newMembership')}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="filter-bar">
        <Dropdown
          className="filter-select"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'active', label: t('memberships.status.active') },
            { value: 'frozen', label: t('memberships.status.frozen') },
            { value: 'expired', label: t('memberships.status.expired') },
            { value: 'cancelled', label: t('memberships.status.cancelled') },
            { value: '', label: t('jobs.allStatuses') },
          ]}
        />
      </div>

      {loading && !data ? (
        <SkeletonStats count={3} />
      ) : (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-icon"><StarIcon size={16} /></div>
            <div className="stat-value">{summary?.active || 0}</div>
            <div className="stat-label">{t('memberships.status.active')}</div>
          </div>
          <div className="stat-card accent-danger">
            <div className="stat-icon"><AlertIcon size={16} /></div>
            <div className="stat-value">{summary?.expiringSoon || 0}</div>
            <div className="stat-label">{t('memberships.expiringSoon')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><ClockIcon size={16} /></div>
            <div className="stat-value">{summary?.expired || 0}</div>
            <div className="stat-label">{t('memberships.status.expired')}</div>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>{t('memberships.list')}</h2>
        {loading ? (
          <SkeletonTable rows={5} cols={4} />
        ) : memberships.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="calendar" />
            <p>{t('memberships.empty')}</p>
            <button type="button" className="btn btn-primary btn-small btn-inline" onClick={openAdd}>
              <PlusIcon size={15} />
              {t('memberships.newMembership')}
            </button>
          </div>
        ) : (
          <ol className="booking-list">
            {memberships.map((m) => (
              <li key={m._id} className={`booking booking-${m.status}`}>
                <div className="booking-time">
                  <strong>{m.customer?.name || t('seller.unknownCustomer')}</strong>
                  <small>{m.customer?.phone}</small>
                </div>

                <div className="booking-body">
                  <div className="booking-head">
                    <span className="booking-name">{m.planName}</span>
                    <span
                      className={`badge ${
                        m.status === 'active'
                          ? m.daysLeft <= 7
                            ? 'badge-expiring'
                            : 'badge-active'
                          : m.status === 'expired'
                            ? 'badge-expired'
                            : m.status === 'frozen'
                              ? 'badge-pending'
                              : 'badge-inactive'
                      }`}
                    >
                      {m.status === 'active' ? t('memberships.daysLeft', { days: m.daysLeft }) : t(`memberships.status.${m.status}`)}
                    </span>
                    {m.staffName && <span className="badge badge-inactive">{m.staffName}</span>}
                    {m.bill && <span className="badge badge-active">{t('memberships.billed')}</span>}
                    {m.bill && (
                      <Link href={recordHref('/seller/invoice/[id]', m.bill)} className="badge badge-pending">
                        {t('seller.invoiceAction')}
                      </Link>
                    )}
                  </div>
                  <p className="cell-sub">
                    {new Date(m.startDate).toLocaleDateString()} – {new Date(m.endDate).toLocaleDateString()}
                    {m.totalSessions ? ` · ${t('memberships.sessionsUsed', { used: m.usedSessions || 0, total: m.totalSessions })}` : ''}
                    {m.notes ? ` · ${m.notes}` : ''}
                  </p>
                  {m.status === 'frozen' && m.frozenAt && (
                    <p className="cell-sub">{t('memberships.frozenSince', { date: new Date(m.frozenAt).toLocaleDateString() })}</p>
                  )}
                  {m.familyMembers?.length > 0 && (
                    <p className="cell-sub">
                      {t('memberships.familyLabel')}: {m.familyMembers.map((fm) => (fm.relation ? `${fm.name} (${fm.relation})` : fm.name)).join(', ')}
                    </p>
                  )}
                  {m.installmentsSummary && (
                    <div className="chip-row" style={{ marginTop: '0.4rem' }}>
                      {m.installments.map((inst) => (
                        <span
                          key={inst.index}
                          className={`badge ${inst.paid ? 'badge-active' : 'badge-pending'}`}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                        >
                          {formatRupees(inst.amount, lang, { decimals: false })} · {new Date(inst.dueDate).toLocaleDateString()}
                          {inst.paid ? (
                            <Link href={recordHref('/seller/invoice/[id]', inst.bill)} style={{ textDecoration: 'underline', color: 'inherit' }}>
                              {t('seller.invoiceAction')}
                            </Link>
                          ) : (
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => { setBilling({ membership: m, installmentIndex: inst.index }); setBillMode('cash'); }}
                            >
                              {t('memberships.billIt')}
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="booking-side">
                  <strong>{formatRupees(m.amount, lang)}</strong>
                  <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                    {/* A membership row had eight controls on it, six of them spelled out —
                        wider than the plan, the customer and the money put together. The
                        two a gym counter actually touches during opening hours are taking
                        the money and marking a session off; those are the squares. Freeze,
                        resume, renew and cancel are month-boundary paperwork and they read
                        better as words in the menu than as four more glyphs. */}
                    {!m.bill && !m.installmentsSummary && (
                      <button
                        type="button"
                        className="icon-btn primary"
                        data-tip={t('memberships.billIt')}
                        onClick={() => { setBilling({ membership: m, installmentIndex: null }); setBillMode('cash'); }}
                      >
                        <RupeeIcon size={17} />
                      </button>
                    )}
                    {m.status === 'active' && m.totalSessions > 0 && m.usedSessions < m.totalSessions && (
                      <button
                        type="button"
                        className="icon-btn"
                        data-tip={t('memberships.useSession')}
                        disabled={busyId === m._id}
                        onClick={() => markSessionUsed(m)}
                      >
                        <CheckCircleIcon size={17} />
                      </button>
                    )}
                    {(m.status === 'active' || m.status === 'frozen') && (
                      <button type="button" className="icon-btn" data-tip={t('common.edit')} onClick={() => openEdit(m)}>
                        <EditIcon size={17} />
                      </button>
                    )}
                    <RowMenu
                      items={[
                        {
                          label: t('memberships.renew'),
                          icon: <RefreshIcon size={15} />,
                          hidden: m.status === 'cancelled',
                          onClick: () => openRenew(m),
                        },
                        {
                          label: t('memberships.resume'),
                          icon: <RefreshIcon size={15} />,
                          hidden: m.status !== 'frozen',
                          disabled: busyId === m._id,
                          onClick: () => resumeMembership(m),
                        },
                        {
                          label: t('memberships.freeze'),
                          icon: <ClockIcon size={15} />,
                          hidden: m.status !== 'active',
                          disabled: busyId === m._id,
                          onClick: () => freezeMembership(m),
                        },
                        {
                          label: t('memberships.cancel'),
                          icon: <XIcon size={15} />,
                          hidden: m.status !== 'active',
                          onClick: () => cancelMembership(m),
                        },
                        {
                          label: t('common.delete'),
                          icon: <TrashIcon size={15} />,
                          danger: true,
                          hidden: Boolean(m.bill),
                          onClick: () => handleDelete(m),
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
          onSubmit={handleSubmit}
          onClose={() => setFormOpen(false)}
          title={editingId ? t('memberships.editMembership') : t('memberships.newMembership')}
          hint={t('memberships.formHint')}
          maxWidth={640}
          footer={
            <>
              <button type="submit" className="btn btn-primary btn-inline" disabled={submitting}>
                {submitting ? t('common.saving') : editingId ? t('common.saveChanges') : t('memberships.newMembership')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setFormOpen(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >

            <div className="form-grid">
              {!editingId && (
                <div className="field field-span2">
                  <label>{t('seller.selectCustomer')} <span className="field-required">*</span></label>
                  {customers.length > 0 && (
                    <Dropdown
                      value={form.customerId}
                      onChange={(value) => setForm((f) => ({ ...f, customerId: value }))}
                      placeholder={t('memberships.pickCustomer')}
                      options={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.phone})` }))}
                    />
                  )}
                  {/* The plan, not the shop, is what's empty here — say which, and where the
                      answer is. A dropdown with nothing in it explains nothing. */}
                  {khataLocked ? (
                    <p className="field-hint">
                      {t('memberships.membersNeedKhata')}{' '}
                      <Link href="/seller/plan" className="nav-link">{t('memberships.seePlans')} →</Link>
                    </p>
                  ) : (
                    <>
                      {customers.length === 0 && (
                        <p className="field-hint">{t('memberships.noMembersYet')}</p>
                      )}
                      {/* The shared quick-add, not a second hand-rolled form. The one this
                          screen used to carry could not answer the case that actually comes
                          up — the number already belongs to somebody — so it toasted an error
                          and left the gym owner retyping. The shared one offers "that's him"
                          and selects the existing member instead. */}
                      <button
                        type="button"
                        className="btn btn-secondary btn-small btn-inline"
                        style={{ marginTop: '0.4rem' }}
                        onClick={() => setAddingCustomer(true)}
                      >
                        <PlusIcon size={15} /> {t('memberships.newMember')}
                      </button>
                    </>
                  )}
                </div>
              )}
              {staff.length > 0 && (
                <div className="field">
                  <label>{t('memberships.staff')}</label>
                  <Dropdown
                    value={form.staffId}
                    onChange={(value) => setForm((f) => ({ ...f, staffId: value }))}
                    options={[
                      { value: '', label: t('appointments.anyone') },
                      ...staff.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name })),
                    ]}
                  />
                </div>
              )}
              <div className="field">
                <label>{t('memberships.planName')} <span className="field-required">*</span></label>
                <input
                  value={form.planName}
                  onChange={(e) => setForm((f) => ({ ...f, planName: e.target.value }))}
                  placeholder={t('memberships.planNamePlaceholder')}
                  required
                />
              </div>
              <div className="field">
                <label>{t('memberships.startDate')}</label>
                <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} required />
              </div>
              <div className="field">
                <label>{t('memberships.endDate')} <span className="field-required">*</span></label>
                <input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} required />
              </div>
              <div className="field">
                <label>{t('seller.price')}</label>
                <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="field">
                <label>{t('memberships.totalSessions')}</label>
                <input type="number" min="0" value={form.totalSessions} onChange={(e) => setForm((f) => ({ ...f, totalSessions: e.target.value }))} />
                <p className="field-hint">{t('memberships.totalSessionsHint')}</p>
              </div>
              <div className="field">
                <label>{t('expenses.note')}</label>
                <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>

            <div className="field" style={{ marginTop: '0.6rem' }}>
              <label>{t('memberships.familyMembers')}</label>
              <p className="field-hint">{t('memberships.familyMembersHint')}</p>
              {form.familyMembers.map((row, index) => (
                <div key={index} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                  <input placeholder={t('common.name')} value={row.name} onChange={(e) => updateFamilyMember(index, 'name', e.target.value)} style={{ flex: '2 1 140px' }} />
                  <PhoneField className="phone-inline" value={row.phone} onChange={(value) => updateFamilyMember(index, 'phone', value)} style={{ flex: '2 1 170px' }} />
                  <input placeholder={t('memberships.relation')} value={row.relation} onChange={(e) => updateFamilyMember(index, 'relation', e.target.value)} style={{ flex: '1 1 100px' }} />
                  <button type="button" className="icon-btn danger" onClick={() => removeFamilyMember(index)}>
                    <XIcon size={17} />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={addFamilyMember}>
                <PlusIcon size={15} /> {t('memberships.addFamilyMember')}
              </button>
            </div>

            {!editingId && (
              <div className="field" style={{ marginTop: '0.6rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 500 }}>
                  <input
                    type="checkbox"
                    checked={form.useInstallments}
                    onChange={(e) => setForm((f) => ({ ...f, useInstallments: e.target.checked, installments: e.target.checked ? f.installments : [] }))}
                  />
                  {t('memberships.splitInstallments')}
                </label>
                {form.useInstallments && (
                  <>
                    <p className="field-hint">{t('memberships.installmentsHint')}</p>
                    {form.installments.map((row, index) => (
                      <div key={index} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder={t('seller.price')}
                          value={row.amount}
                          onChange={(e) => updateInstallment(index, 'amount', e.target.value)}
                          style={{ flex: 1 }}
                        />
                        <input type="date" value={row.dueDate} onChange={(e) => updateInstallment(index, 'dueDate', e.target.value)} style={{ flex: 1 }} />
                        <button type="button" className="icon-btn danger" onClick={() => removeInstallment(index)}>
                          <XIcon size={17} />
                        </button>
                      </div>
                    ))}
                    <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={addInstallment}>
                      <PlusIcon size={15} /> {t('memberships.addInstallment')}
                    </button>
                    {form.installments.length > 0 && (
                      <p className="field-hint" style={installmentsMismatch ? { color: 'var(--danger)' } : undefined}>
                        {t('memberships.installmentsTotal', { total: installmentsTotal.toFixed(2), amount: (Number(form.amount) || 0).toFixed(2) })}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

        </Modal>
      )}

      {renewing && (
        <Modal
          as="form"
          onSubmit={submitRenew}
          onClose={() => setRenewing(null)}
          title={t('memberships.renew')}
          hint={`${renewing.customer?.name || ''} · ${renewing.planName}`}
          maxWidth={400}
          footer={
            <button type="submit" className="btn btn-primary btn-inline" disabled={submitting}>
              {submitting ? t('common.saving') : t('memberships.renew')}
            </button>
          }
        >
            <div className="field">
              <label>{t('memberships.endDate')} <span className="field-required">*</span></label>
              <input type="date" value={renewForm.endDate} onChange={(e) => setRenewForm((f) => ({ ...f, endDate: e.target.value }))} required />
            </div>
            <div className="field">
              <label>{t('seller.price')}</label>
              <input type="number" min="0" step="0.01" value={renewForm.amount} onChange={(e) => setRenewForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
        </Modal>
      )}

      {billing && (
        <Modal
          as="form"
          onSubmit={submitBill}
          onClose={() => setBilling(null)}
          title={t('memberships.billIt')}
          hint={`${billing.membership.customer?.name || ''} · ${billing.membership.planName}`}
          maxWidth={400}
          footer={
            <button type="submit" className="btn btn-primary btn-inline" disabled={submitting}>
              <RupeeIcon size={17} /> {submitting ? t('common.saving') : t('appointments.createBill')}
            </button>
          }
        >
            <div className="order-totals" style={{ marginBottom: '0.8rem' }}>
              <div className="grand">
                <span>{t('seller.total')}</span>
                <strong>{formatRupees(billingAmount, lang)}</strong>
              </div>
            </div>
            <div className="field">
              <label>{t('seller.paymentMode')}</label>
              <Dropdown
                value={billMode}
                onChange={setBillMode}
                options={PAYMENT_MODES.map((mode) => ({ value: mode, label: mode === 'khata' ? t('nav.khata') : t(`expenses.mode.${mode}`) }))}
              />
            </div>
            <p className="field-hint">{t('appointments.billHint')}</p>
        </Modal>
      )}
      {addingCustomer && (
        <CustomerQuickAdd
          onClose={() => setAddingCustomer(false)}
          onCreated={(customer) => {
            setCustomers((list) => (list.some((c) => c.id === customer.id) ? list : [customer, ...list]));
            setForm((f) => ({ ...f, customerId: customer.id }));
          }}
        />
      )}

    </>
  );
}
