'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { formatRupees, toDateInput } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import Dropdown from '../../components/Dropdown';
import PhoneField from '../../components/PhoneField';
import Modal from '../../components/Modal';
import { SkeletonStats, SkeletonTable } from '../../components/Skeleton';
import { gstRateOptions } from '../../../lib/catalog';
import {
  PlusIcon, XIcon, EditIcon, TrashIcon, ClockIcon, CheckCircleIcon, RupeeIcon, AlertIcon, PackageIcon,
} from '../../components/Icons';
import RowMenu from '../../components/RowMenu';
import { recordHref } from '../../../lib/routeId';
import { customerOptionLabel } from '../../../lib/customerLabel';

// Mirrors the enum in backend/models/Job.js.
const STATUSES = ['received', 'in_progress', 'ready', 'delivered', 'cancelled'];
// The one move that takes the job FORWARD, as opposed to cancelling it. It is always the
// first entry, and naming it here is what lets the row show one square instead of two
// buttons whose difference you have to read.
function forwardStatus(job) {
  return (NEXT_STATUS[job.status] || []).find((next) => next !== 'cancelled') || '';
}

// What a job can move to from where it is — one-directional, so a delivered order can't
// quietly drift back to "received".
const NEXT_STATUS = {
  received: ['in_progress', 'cancelled'],
  in_progress: ['ready', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

const PAYMENT_MODES = ['cash', 'upi', 'card', 'khata'];

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function emptyForm() {
  return {
    customerId: '',
    customerName: '',
    customerPhone: '',
    title: '',
    itemCount: '',
    items: [],
    urgent: false,
    dueDate: '',
    amount: '',
    gstRate: '0',
    notes: '',
  };
}

export default function JobsPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();

  const [statusFilter, setStatusFilter] = useState('');
  const [data, setData] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [billing, setBilling] = useState(null);
  const [billMode, setBillMode] = useState('cash');
  const [customerMeasurements, setCustomerMeasurements] = useState([]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    return params.toString();
  }, [statusFilter]);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/seller/jobs?${query}`)
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
  }, []);

  // A tailor taking in a garment needs the chest/waist/length the shop already saved
  // against this customer, right here on the job form — not on a different tab.
  useEffect(() => {
    if (!formOpen || !form.customerId) {
      setCustomerMeasurements([]);
      return;
    }
    apiFetch(`/api/seller/khata/customers/${form.customerId}`)
      .then((result) => setCustomerMeasurements(result.customer?.measurements || []))
      .catch(() => setCustomerMeasurements([]));
  }, [formOpen, form.customerId]);

  const jobs = data?.jobs || [];
  const summary = data?.summary;

  function openAdd() {
    setForm(emptyForm());
    setEditingId(null);
    setFormOpen(true);
  }

  function openEdit(job) {
    setForm({
      customerId: job.customer?.id || '',
      customerName: job.customer ? '' : job.customerName || '',
      customerPhone: job.customer ? '' : job.customerPhone || '',
      title: job.title,
      itemCount: job.itemCount ?? '',
      items: job.items || [],
      urgent: job.urgent || false,
      dueDate: job.dueDate ? toDateInput(job.dueDate) : '',
      amount: job.amount ?? '',
      gstRate: String(job.gstRate ?? '0'),
      notes: job.notes || '',
    });
    setEditingId(job._id);
    setFormOpen(true);
  }

  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, { name: '', photoUrl: '' }] }));
  }
  function updateItemName(index, value) {
    setForm((f) => ({ ...f, items: f.items.map((row, i) => (i === index ? { ...row, name: value } : row)) }));
  }
  async function handleItemPhoto(index, event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setForm((f) => ({ ...f, items: f.items.map((row, i) => (i === index ? { ...row, photoUrl: dataUrl } : row)) }));
  }
  function removeItem(index) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== index) }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.title.trim()) {
      toast.error(t('jobs.needTitle'));
      return;
    }
    if (!form.customerId && !form.customerName.trim()) {
      toast.error(t('jobs.needCustomer'));
      return;
    }

    setSubmitting(true);
    try {
      const body = JSON.stringify({
        customerId: form.customerId || undefined,
        customerName: form.customerId ? undefined : form.customerName,
        customerPhone: form.customerId ? undefined : form.customerPhone,
        title: form.title,
        itemCount: form.itemCount === '' ? undefined : Number(form.itemCount),
        items: form.items.filter((row) => row.name.trim()).map((row) => ({ name: row.name, photoUrl: row.photoUrl || undefined })),
        urgent: form.urgent,
        dueDate: form.dueDate || undefined,
        amount: Number(form.amount) || 0,
        gstRate: Number(form.gstRate) || 0,
        notes: form.notes || undefined,
      });
      if (editingId) {
        await apiFetch(`/api/seller/jobs/${editingId}`, { method: 'PATCH', body });
        toast.success(t('jobs.updated'));
      } else {
        await apiFetch('/api/seller/jobs', { method: 'POST', body });
        toast.success(t('jobs.created'));
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

  async function changeStatus(job, status) {
    if (status === 'cancelled' && !(await confirm({ tone: 'danger', title: t('jobs.cancelTitle'), cancelLabel: t('common.goBack'), body: t('jobs.confirmCancel'), confirmLabel: t('jobs.cancelTitle') }))) return;
    setBusyId(job._id);
    try {
      await apiFetch(`/api/seller/jobs/${job._id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(job) {
    if (!(await confirm({ tone: 'danger', title: t('common.delete'), body: t('jobs.confirmDelete'), confirmLabel: t('common.delete') }))) return;
    setBusyId(job._id);
    try {
      await apiFetch(`/api/seller/jobs/${job._id}`, { method: 'DELETE' });
      toast.success(t('jobs.deleted'));
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function submitBill(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const result = await apiFetch(`/api/seller/jobs/${billing._id}/bill`, {
        method: 'POST',
        body: JSON.stringify({ paymentMode: billMode }),
      });
      toast.success(t('jobs.billedToast', { number: result.bill.billNumber }));
      setBilling(null);
      setBillMode('cash');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function statusBadgeClass(status) {
    if (status === 'delivered') return 'badge-active';
    if (status === 'cancelled') return 'badge-inactive';
    return 'badge-pending';
  }

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('jobs.title')}</h1>
          <p>{t('jobs.subtitle')}</p>
        </div>
        <button type="button" className="btn btn-primary btn-inline" onClick={openAdd}>
          <PlusIcon size={17} />
          {t('jobs.newJob')}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="filter-bar">
        <Dropdown
          className="filter-select"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[{ value: '', label: t('jobs.allStatuses') }, ...STATUSES.map((status) => ({ value: status, label: t(`jobs.status.${status}`) }))]}
        />
      </div>

      {loading && !data ? (
        <SkeletonStats count={4} />
      ) : (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-icon"><PackageIcon size={16} /></div>
            <div className="stat-value">{summary?.total || 0}</div>
            <div className="stat-label">{t('jobs.totalOrders')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><ClockIcon size={16} /></div>
            <div className="stat-value">{summary?.inProgress || 0}</div>
            <div className="stat-label">{t('jobs.status.in_progress')}</div>
          </div>
          <div className="stat-card accent-success">
            <div className="stat-icon"><CheckCircleIcon size={16} /></div>
            <div className="stat-value">{summary?.ready || 0}</div>
            <div className="stat-label">{t('jobs.status.ready')}</div>
          </div>
          <div className="stat-card accent-danger">
            <div className="stat-icon"><AlertIcon size={16} /></div>
            <div className="stat-value">{summary?.overdue || 0}</div>
            <div className="stat-label">
              {t('jobs.overdue')}
              {summary?.unbilled > 0 && (
                <span className="badge badge-pending" style={{ marginLeft: '0.35rem' }}>
                  {t('jobs.unbilledCount', { count: summary.unbilled })}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>{t('jobs.board')}</h2>
        {loading ? (
          <SkeletonTable rows={5} cols={4} />
        ) : jobs.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="board" />
            <p>{t('jobs.empty')}</p>
            <button type="button" className="btn btn-primary btn-small btn-inline" onClick={openAdd}>
              <PlusIcon size={15} />
              {t('jobs.newJob')}
            </button>
          </div>
        ) : (
          <ol className="booking-list">
            {jobs.map((job) => {
              const overdue = job.dueDate && new Date(job.dueDate) < new Date() && !['delivered', 'cancelled'].includes(job.status);
              return (
                <li key={job._id} className={`booking booking-${job.status}`}>
                  <div className="booking-time">
                    <strong>{job.label}</strong>
                    {job.dueDate && (
                      <small style={overdue ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>
                        {new Date(job.dueDate).toLocaleDateString()}
                      </small>
                    )}
                  </div>

                  <div className="booking-body">
                    <div className="booking-head">
                      <span className="booking-name">{job.title}</span>
                      <span className={`badge ${statusBadgeClass(job.status)}`}>{t(`jobs.status.${job.status}`)}</span>
                      {job.bill && <span className="badge badge-active">{t('jobs.billed')}</span>}
                      {job.bill && (
                        <Link href={recordHref('/seller/invoice/[id]', job.bill)} className="badge badge-pending">
                          {t('seller.invoiceAction')}
                        </Link>
                      )}
                      {overdue && <span className="badge badge-expired">{t('jobs.overdueTag')}</span>}
                      {job.urgent && <span className="badge badge-expired">{t('jobs.urgent')}</span>}
                    </div>
                    <p className="cell-sub">
                      {job.customerName || t('seller.unknownCustomer')}
                      {job.items?.length
                        ? ` · ${job.items.map((item) => item.name).join(', ')}`
                        : job.itemCount
                          ? ` · ${job.itemCount} ${t('jobs.items')}`
                          : ''}
                      {job.notes ? ` · ${job.notes}` : ''}
                    </p>
                    {job.items?.some((item) => item.photoUrl) && (
                      <div className="chip-row" style={{ marginTop: '0.3rem' }}>
                        {job.items.filter((item) => item.photoUrl).map((item, index) => (
                          <img
                            key={index}
                            src={item.photoUrl}
                            alt={item.name}
                            data-tip={item.name}
                            style={{ width: '32px', height: '32px', objectFit: 'cover', borderRadius: '6px' }}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="booking-side">
                    <strong>{formatRupees(job.amount, lang)}</strong>
                    <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                      {/* NEXT_STATUS lists the forward move first and 'cancelled' second.
                          Only the forward one is a square — pushing the job along is what
                          this board is for, and it is in the same place on every row so it
                          can be tapped down a column without reading. Cancelling shares the
                          menu with delete, where both keep their words. */}
                      {job.status === 'delivered' && !job.bill ? (
                        <button
                          type="button"
                          className="icon-btn primary"
                          data-tip={t('jobs.billIt')}
                          onClick={() => { setBilling(job); setBillMode('cash'); }}
                        >
                          <RupeeIcon size={17} />
                        </button>
                      ) : (
                        forwardStatus(job) && (
                          <button
                            type="button"
                            className="icon-btn primary"
                            data-tip={t(`jobs.status.${forwardStatus(job)}`)}
                            disabled={busyId === job._id}
                            onClick={() => changeStatus(job, forwardStatus(job))}
                          >
                            <CheckCircleIcon size={17} />
                          </button>
                        )
                      )}
                      {!job.bill && (
                        <button type="button" className="icon-btn" data-tip={t('common.edit')} onClick={() => openEdit(job)}>
                          <EditIcon size={17} />
                        </button>
                      )}
                      <RowMenu
                        items={[
                          {
                            label: t('jobs.status.cancelled'),
                            icon: <XIcon size={15} />,
                            hidden: !NEXT_STATUS[job.status]?.includes('cancelled'),
                            disabled: busyId === job._id,
                            onClick: () => changeStatus(job, 'cancelled'),
                          },
                          {
                            label: t('common.delete'),
                            icon: <TrashIcon size={15} />,
                            danger: true,
                            hidden: Boolean(job.bill),
                            onClick: () => handleDelete(job),
                          },
                        ]}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {formOpen && (
        <Modal
          as="form"
          onSubmit={handleSubmit}
          onClose={() => setFormOpen(false)}
          title={editingId ? t('jobs.editJob') : t('jobs.newJob')}
          hint={t('jobs.formHint')}
          maxWidth={620}
          footer={
            <>
              <button type="submit" className="btn btn-primary btn-inline" disabled={submitting}>
                {submitting ? t('common.saving') : editingId ? t('common.saveChanges') : t('jobs.newJob')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setFormOpen(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >

            <div className="form-grid">
              <div className="field">
                <label>{t('seller.selectCustomer')}</label>
                <Dropdown
                  value={form.customerId}
                  onChange={(v) => setForm((f) => ({ ...f, customerId: v }))}
                  options={[{ value: '', label: t('appointments.walkIn') }, ...customers.map((c) => ({ value: c.id, label: customerOptionLabel(c) }))]}
                />
              </div>
              {!form.customerId && (
                <>
                  <div className="field">
                    <label>{t('common.name')}</label>
                    <input value={form.customerName} onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))} required />
                  </div>
                  <PhoneField
                    label={t('common.phone')}
                    value={form.customerPhone}
                    onChange={(value) => setForm((f) => ({ ...f, customerPhone: value }))}
                  />
                </>
              )}
              {form.customerId && customerMeasurements.length > 0 && (
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label>{t('jobs.measurements')}</label>
                  <p className="field-hint">
                    {customerMeasurements.map((m) => `${m.label}: ${m.value}`).join(' · ')}
                    {' — '}
                    <Link href={recordHref('/seller/khata/[id]', form.customerId)} className="nav-link">{t('jobs.editMeasurements')}</Link>
                  </p>
                </div>
              )}
              <div className="field">
                <label>{t('jobs.jobTitle')} <span className="field-required">*</span></label>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder={t('jobs.jobTitlePlaceholder')}
                  required
                />
              </div>
              <div className="field">
                <label>{t('jobs.itemCount')}</label>
                <input type="number" min="0" value={form.itemCount} onChange={(e) => setForm((f) => ({ ...f, itemCount: e.target.value }))} />
              </div>
              <div className="field">
                <label>{t('jobs.dueDate')}</label>
                <input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
              </div>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input type="checkbox" checked={form.urgent} onChange={(e) => setForm((f) => ({ ...f, urgent: e.target.checked }))} />
                  {t('jobs.urgent')}
                </label>
              </div>
              <div className="field">
                <label>{t('seller.price')}</label>
                <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="field">
                <label>{t('seller.gstRate')}</label>
                <Dropdown
                  id="jobGstRate"
                  value={form.gstRate}
                  onChange={(value) => setForm((f) => ({ ...f, gstRate: value }))}
                  options={gstRateOptions(form.gstRate)}
                />
              </div>
              <div className="field">
                <label>{t('expenses.note')}</label>
                <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>

            <div className="field" style={{ marginTop: '0.6rem' }}>
              <label>{t('jobs.itemiseLabel')}</label>
              <p className="field-hint">{t('jobs.itemiseHint')}</p>
              {form.items.map((row, index) => (
                <div key={index} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    placeholder={t('jobs.itemName')}
                    value={row.name}
                    onChange={(e) => updateItemName(index, e.target.value)}
                    style={{ flex: '2 1 160px' }}
                  />
                  <input type="file" accept="image/*" onChange={(e) => handleItemPhoto(index, e)} style={{ flex: '1 1 160px' }} />
                  {row.photoUrl && (
                    <img src={row.photoUrl} alt="" style={{ width: '32px', height: '32px', objectFit: 'cover', borderRadius: '6px' }} />
                  )}
                  <button type="button" className="icon-btn danger" onClick={() => removeItem(index)}>
                    <XIcon size={17} />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={addItem}>
                <PlusIcon size={15} /> {t('jobs.addItem')}
              </button>
            </div>

        </Modal>
      )}

      {billing && (
        <Modal
          as="form"
          onSubmit={submitBill}
          onClose={() => setBilling(null)}
          title={t('jobs.billIt')}
          hint={`${billing.customerName} · ${billing.title}`}
          maxWidth={400}
          footer={
            <button
              type="submit"
              className="btn btn-primary btn-inline"
              disabled={submitting || (billMode === 'khata' && !billing.customer)}
            >
              <RupeeIcon size={17} /> {submitting ? t('common.saving') : t('appointments.createBill')}
            </button>
          }
        >
            <div className="order-totals" style={{ marginBottom: '0.8rem' }}>
              <div className="grand">
                <span>{t('seller.total')}</span>
                <strong>{formatRupees(billing.amount, lang)}</strong>
              </div>
            </div>
            <div className="field">
              <label>{t('seller.paymentMode')}</label>
              <Dropdown
                value={billMode}
                onChange={setBillMode}
                options={PAYMENT_MODES.map((mode) => ({ value: mode, label: mode === 'khata' ? t('nav.khata') : t(`expenses.mode.${mode}`) }))}
              />
              {billMode === 'khata' && !billing.customer && (
                <p className="field-hint">{t('appointments.khataNeedsCustomer')}</p>
              )}
            </div>
        </Modal>
      )}
    </>
  );
}
