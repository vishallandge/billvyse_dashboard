'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { useDashboardUser } from '../../components/DashboardShell';
import { tradeUses, DEFAULT_BUSINESS_TYPE } from '../../../lib/businessTypes';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { apiErrorMessage } from '../../../lib/apiErrors';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { SkeletonTable } from '../../components/Skeleton';
import {
  PlusIcon, XIcon, EditIcon, TrashIcon, UsersIcon, ShieldIcon, WalletIcon, CalendarIcon,
  CounterIcon, PackageIcon, TruckIcon, LedgerIcon, ClipboardIcon, CheckIcon, ChevronDownIcon, RupeeIcon, RefreshIcon,
  CheckCircleIcon, LogOutIcon,
} from '../../components/Icons';
import RowMenu from '../../components/RowMenu';
import StaffAttendance from '../../components/StaffAttendance';
import StaffPayroll from '../../components/StaffPayroll';
import StaffHandover from '../../components/StaffHandover';
import { suggestPassword } from '../../../lib/passwordSuggest';
import Dropdown from '../../components/Dropdown';
import PhoneField from '../../components/PhoneField';
import Modal from '../../components/Modal';
import { Pagination, usePagination } from '../../components/Pagination';
import { SortHeader, useSort } from '../../components/DataTable';

// A role is recognised by shape before it is read. Keyed to the preset keys the API
// sends (see STAFF_ROLE_PRESETS in the staff controller); anything new falls back to the
// shield, so adding a preset server-side cannot break this screen.
const ROLE_ICONS = {
  cashier: CounterIcon,
  receptionist: CalendarIcon,
  storeKeeper: PackageIcon,
  purchaseManager: TruckIcon,
  accountant: LedgerIcon,
  backOffice: ClipboardIcon,
  manager: ShieldIcon,
};

// Which ready-made role the ticked boxes currently amount to — set equality, not the
// preset that was last pressed. Tick one extra box and no card is highlighted any more,
// which is the honest answer: this is no longer that role.
function matchingPreset(presets, permissions) {
  const held = new Set(permissions);
  const found = presets.find((preset) =>
    preset.permissions.length === held.size && preset.permissions.every((p) => held.has(p)));
  return found ? found.key : '';
}

// Module scope so useSort's memo dependency stays stable across renders.
const STAFF_SORT_ACCESSORS = {
  name: (s) => (s.name || '').toLowerCase(),
  email: (s) => (s.email || '').toLowerCase(),
  status: (s) => (s.isActive ? 1 : 0),
};

const SALES_SORT_ACCESSORS = {
  name: (r) => (r.name || '').toLowerCase(),
  billCount: (r) => Number(r.billCount) || 0,
  totalSales: (r) => Number(r.totalSales) || 0,
};

const emptyForm = {
  name: '',
  email: '',
  password: '',
  phone: '',
  jobTitle: '',
  counterName: '',
  commissionRate: '',
  salary: '',
  permissions: [],
  storeId: '',
};

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Mirrors backend/controllers/staffController.js VALID_PERMISSIONS. The list from the API
// wins once it loads — this is only what the form shows on first paint.
// Mirrors VALID_PERMISSIONS in backend/controllers/staffController.js — only used when
// the API's own list hasn't loaded yet.
const FALLBACK_PERMISSIONS = [
  'billing', 'inventory', 'khata', 'orders', 'purchases', 'suppliers', 'expenses', 'appointments', 'exports',
];

export default function StaffPage() {
  const user = useDashboardUser();
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const [staff, setStaff] = useState([]);
  const [allPermissions, setAllPermissions] = useState(FALLBACK_PERMISSIONS);
  const [presets, setPresets] = useState([]);
  const [salesReport, setSalesReport] = useState([]);
  const [stores, setStores] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  // Two kinds of failure, two places to say so. `error` is the page failing to LOAD
  // (nothing on screen, banner at the top is the only thing to look at); `formError` is a
  // save being refused while a dialog is open, where the page behind it is not where
  // anybody is looking.
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [storeWasClosed, setStoreWasClosed] = useState(false);
  // Opened automatically when the ticked boxes match no ready-made role — somebody
  // editing a hand-built permission set should see it, not have to go looking.
  const [accessOpen, setAccessOpen] = useState(false);
  // Set the moment an account is created (or its password reset), and cleared when the
  // owner says they are done with it. Holds the plaintext password for exactly as long
  // as the dialog that is handing it over — it is never stored anywhere else.
  const [handover, setHandover] = useState(null);
  const [suggested, setSuggested] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Attendance and payroll moved into their own components — this page had grown into
  // three stacked panels that between them still could not answer "kitna baaki hai".
  const [tab, setTab] = useState('team');
  const [month, setMonth] = useState(currentMonth());


  /**
   * Only stores that can actually be assigned.
   *
   * `/stores` returns every store the shop has ever had, including closed ones — the
   * Stores screen needs those to reopen them. This picker did not filter, so it offered a
   * closed branch and the save then came back "Store not found", because createStaff
   * requires an ACTIVE store. That is the worst kind of error: the app offered the option
   * and then refused it, and there was nothing the shopkeeper could read to know why.
   */
  const assignableStores = stores.filter((store) => store.isActive !== false);
  const activePreset = matchingPreset(presets, form.permissions);

  const showCommission = tradeUses(
    user?.businessType || DEFAULT_BUSINESS_TYPE,
    'commission',
    staff.some((s) => Number(s.commissionRate) > 0)
  );

  const staffSort = useSort(staff, STAFF_SORT_ACCESSORS);
  const staffPage = usePagination(staffSort.sorted, { pageSize: 25 });
  const salesSort = useSort(salesReport, SALES_SORT_ACCESSORS);
  const salesPage = usePagination(salesSort.sorted, { pageSize: 25 });

  function load() {
    setLoading(true);
    Promise.all([
      apiFetch('/api/seller/staff'),
      apiFetch('/api/seller/staff/reports/sales'),
      apiFetch('/api/seller/stores'),
    ])
      .then(([staffData, reportData, storeData]) => {
        setStaff(staffData.staff);
        if (staffData.permissions?.length) setAllPermissions(staffData.permissions);
        setPresets(staffData.presets || []);
        setSalesReport(reportData.rows);
        setStores(storeData.stores);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  // Dropdown hands back a value directly instead of an event.
  function setField(field) {
    return (value) => setForm((f) => ({ ...f, [field]: value }));
  }

  function togglePermission(perm) {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(perm) ? f.permissions.filter((p) => p !== perm) : [...f.permissions, perm],
    }));
  }

  // A preset is a shortcut, not a mode: it ticks the boxes and fills the job title, then
  // gets out of the way so the seller can add or drop any single permission.
  function applyPreset(preset) {
    setForm((f) => ({
      ...f,
      permissions: [...preset.permissions],
      jobTitle: f.jobTitle || t(`seller.preset.${preset.key}`) || preset.label,
    }));
  }

  function closeForm() {
    setFormOpen(false);
    setHandover(null);
  }

  function openAdd() {
    setStoreWasClosed(false);
    setAccessOpen(false);
    setHandover(null);
    // Filled in already, because the alternative a shopkeeper reaches for is "123456".
    // Visible, editable, and one press away from a different one.
    setSuggested(suggestPassword());
    setForm({ ...emptyForm, password: '' });
    setEditingId(null);
    setFormError('');
    setFormOpen(true);
  }

  function openEdit(member) {
    // A store can be closed after somebody was assigned to it. Sending that id back would
    // 404, so the picker falls back to "no store selected" — which the server resolves to
    // the shop's default — and says so rather than moving them quietly.
    const stillOpen = assignableStores.some((store) => store._id === member.store);
    setStoreWasClosed(Boolean(member.store) && !stillOpen);
    setForm({
      name: member.name || '',
      email: member.email || '',
      password: '',
      jobTitle: member.jobTitle || '',
      counterName: member.counterName || '',
      commissionRate: member.commissionRate ? String(member.commissionRate) : '',
      salary: member.salary ? String(member.salary) : '',
      permissions: [...(member.permissions || [])],
      storeId: stillOpen ? member.store : '',
      phone: member.phone || '',
    });
    setHandover(null);
    setEditingId(member.id);
    // A set nobody can name is a set that has to be shown.
    setAccessOpen(matchingPreset(presets, member.permissions || []) === '');
    setFormError('');
    setFormOpen(true);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      // The form holds commission as a string so the input can be emptied; the API wants a
      // number, and a blank means "no commission" rather than "leave it unset".
      const payload = {
        ...form,
        commissionRate: Number(form.commissionRate) || 0,
        salary: Number(form.salary) || 0,
      };
      if (editingId) {
        const body = { ...payload };
        // Email is the login id and never changes; a blank password means "leave it alone".
        delete body.email;
        if (!body.password) delete body.password;
        await apiFetch(`/api/seller/staff/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.success(t('seller.staffUpdated'));
        // A reset password has exactly the same problem a new one does — it is useless
        // until it reaches the person — so it gets the same hand-over.
        if (body.password) {
          setHandover({ name: form.name, email: form.email, password: body.password, phone: form.phone });
        } else {
          closeForm();
        }
      } else {
        await apiFetch('/api/seller/staff', { method: 'POST', body: JSON.stringify(payload) });
        toast.success(t('seller.staffCreated'));
        setHandover({ name: form.name, email: form.email, password: form.password, phone: form.phone });
      }
      setForm(emptyForm);
      load();
    } catch (err) {
      setFormError(apiErrorMessage(lang, err));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(member) {
    try {
      await apiFetch(`/api/seller/staff/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !member.isActive }),
      });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  // "He left the shop" — the action an owner actually reaches for, as opposed to the two
  // that were here before. Deactivate alone left the ex-employee's phone receiving the
  // shop's push notifications; delete would have orphaned every bill and khata entry
  // pointing at them. This ends the access and keeps the history.
  async function handleOffboard(member) {
    // One dialog, not a confirm followed by a prompt. The reason belongs to the same
    // decision, and asking twice is how a shopkeeper learns to dismiss both.
    const answer = await confirm({
      tone: 'danger',
      title: t('seller.offboardTitle'),
      body: t('seller.confirmOffboard', { name: member.name }),
      input: { label: t('seller.offboardReasonPrompt'), placeholder: t('seller.offboardReasonPlaceholder') },
      confirmLabel: t('seller.offboardTitle'),
    });
    if (!answer) return;
    const reason = answer.value || '';
    try {
      const result = await apiFetch(`/api/seller/staff/${member.id}/offboard`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      // The device count is the part an owner would not otherwise know happened, and it is
      // the reason this is worth pressing instead of just deactivating. The dues line only
      // appears when there ARE dues — somebody walking out mid-month is exactly when a
      // final settlement gets forgotten, and this is the last moment anyone looks.
      if (result.duesPending > 0) {
        toast.error(t('staff.duesOnOffboard', {
          devices: result.devicesRevoked || 0,
          amount: Number(result.duesPending).toLocaleString('en-IN'),
        }));
      } else {
        toast.success(t('seller.offboardDone', { count: result.devicesRevoked || 0 }));
      }
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleDelete(member) {
    if (!(await confirm({ tone: 'danger', title: t('common.delete'), body: t('seller.confirmRemoveStaff', { name: member.name }), confirmLabel: t('common.delete') }))) return;
    try {
      await apiFetch(`/api/seller/staff/${member.id}`, { method: 'DELETE' });
      toast.success(t('seller.staffRemoved'));
      load();
    } catch (err) {
      // The server now refuses to delete an account with work behind it, because doing so
      // would leave those bills and payout rows pointing at nobody. Say what to do
      // instead, rather than repeating a refusal the owner can do nothing with.
      if (err.code === 'STAFF_HAS_HISTORY') {
        const goOffboard = await confirm({
          tone: 'warning',
          title: t('seller.offboardTitle'),
          body: t('staff.historyBlocked'),
          confirmLabel: t('seller.offboardStaff'),
        });
        if (goOffboard) handleOffboard(member);
        return;
      }
      toast.error(err.message);
    }
  }

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('seller.staffTitle')}</h1>
          <p>{t('seller.staffSubtitle')}</p>
        </div>
        <button type="button" className="btn btn-primary btn-inline" onClick={openAdd}>
          <PlusIcon size={17} />
          {t('seller.addStaff')}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="segmented" role="group" style={{ maxWidth: '460px' }}>
        <button type="button" className={tab === 'team' ? 'active' : undefined} onClick={() => setTab('team')}>
          <UsersIcon size={15} /> {t('staff.tabTeam')}
        </button>
        <button type="button" className={tab === 'attendance' ? 'active' : undefined} onClick={() => setTab('attendance')}>
          <CalendarIcon size={15} /> {t('staff.tabAttendance')}
        </button>
        <button type="button" className={tab === 'payroll' ? 'active' : undefined} onClick={() => setTab('payroll')}>
          <WalletIcon size={15} /> {t('staff.tabPayroll')}
        </button>
      </div>

      {tab === 'attendance' && (
        <StaffAttendance staff={staff} month={month} onMonthChange={setMonth} />
      )}

      {tab === 'payroll' && (
        <StaffPayroll staff={staff} month={month} onMonthChange={setMonth} />
      )}

      {tab === 'team' && (
      <>
      <div className="panel">
        <h2>{t('seller.staffTitle')}</h2>
        {loading ? (
          <SkeletonTable rows={5} cols={6} />
        ) : staff.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="people" />
            <p>{t('seller.noStaff')}</p>
            <button type="button" className="btn btn-primary btn-small btn-inline" onClick={openAdd}>
              <PlusIcon size={15} />
              {t('seller.addStaff')}
            </button>
          </div>
        ) : (
          <div className="table-wrap auto-height">
            <table className="data-table sticky-actions" style={{ minWidth: '780px' }}>
              <thead>
                <tr>
                  <SortHeader sortKey="name" label={t('common.name')} sort={staffSort.sort} onSort={staffSort.toggle} />
                  <SortHeader sortKey="email" label={t('seller.staffEmail')} sort={staffSort.sort} onSort={staffSort.toggle} />
                  {stores.length > 1 && <th>{t('seller.assignedStore')}</th>}
                  <th>{t('seller.staffPermissions')}</th>
                  <SortHeader sortKey="status" label={t('common.status')} sort={staffSort.sort} onSort={staffSort.toggle} />
                  <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {staffPage.pageItems.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="cell-stack">
                        <span className="cell-strong">{s.name}</span>
                        {(s.jobTitle || s.counterName || s.commissionRate > 0) && (
                          <span className="cell-sub">
                            {[
                              s.jobTitle,
                              s.counterName,
                              // Only ever shown where a rate is actually set, so a trade
                              // that doesn't pay commission never sees the word.
                              s.commissionRate > 0 ? `${s.commissionRate}% ${t('seller.commissionRate')}` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="cell-muted">{s.email}</td>
                    {stores.length > 1 && (
                      <td className="cell-muted">{stores.find((st) => st._id === s.store)?.name || '—'}</td>
                    )}
                    <td>
                      <div className="chip-row">
                        {(s.permissions || []).length === 0 ? (
                          <span className="cell-muted">{t('seller.noPermissions')}</span>
                        ) : (
                          (s.permissions || []).map((p) => (
                            <span key={p} className="badge badge-pending">{t(`seller.perm.${p}`)}</span>
                          ))
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${s.isActive ? 'badge-active' : 'badge-inactive'}`}>
                        {s.isActive ? t('common.active') : t('common.inactive')}
                      </span>
                    </td>
                    <td className="tight">
                      <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                        {/* "Deactivate", "Offboard" and "Delete" are three different endings
                            for one employee and the only thing that tells them apart is the
                            word. None of them can be a glyph, and all three are rare — so
                            the row shows the pencil and keeps the endings in the menu. */}
                        <button type="button" className="icon-btn" data-tip={t('common.edit')} onClick={() => openEdit(s)}>
                          <EditIcon size={17} />
                        </button>
                        <RowMenu
                          items={[
                            {
                              label: s.isActive ? t('seller.deactivateStaff') : t('seller.activateStaff'),
                              icon: <CheckCircleIcon size={15} />,
                              onClick: () => toggleActive(s),
                            },
                            {
                              label: t('seller.offboardStaff'),
                              icon: <LogOutIcon size={15} />,
                              hidden: !s.isActive,
                              onClick: () => handleOffboard(s),
                            },
                            {
                              label: t('common.delete'),
                              icon: <TrashIcon size={15} />,
                              danger: true,
                              onClick: () => handleDelete(s),
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
        {staff.length > 0 && (
          <Pagination
            page={staffPage.page}
            pageCount={staffPage.pageCount}
            pageSize={staffPage.pageSize}
            total={staffPage.total}
            from={staffPage.from}
            to={staffPage.to}
            onPageChange={staffPage.setPage}
            onPageSizeChange={staffPage.setPageSize}
            label={t('seller.staffTitle')}
          />
        )}
      </div>

      <div className="panel">
        <h2>{t('seller.staffSalesReport')}</h2>
        {/* Two different questions live on this page and they return different numbers for
            the same person: this panel counts who RANG UP the bill, the pagaar tab counts
            who the work was CREDITED to. Unlabelled, that difference reads as a bug. */}
        <p className="field-hint" style={{ marginTop: 0 }}>{t('staff.salesReportHint')}</p>
        {salesReport.length === 0 ? (
          <p className="empty-state">{t('seller.noSalesYet')}</p>
        ) : (
          <div className="table-wrap auto-height">
            <table className="data-table" style={{ minWidth: '420px' }}>
              <thead>
                <tr>
                  <SortHeader sortKey="name" label={t('common.name')} sort={salesSort.sort} onSort={salesSort.toggle} />
                  <SortHeader sortKey="billCount" label={t('seller.billCount')} sort={salesSort.sort} onSort={salesSort.toggle} align="right" />
                  <SortHeader sortKey="totalSales" label={t('seller.revenue')} sort={salesSort.sort} onSort={salesSort.toggle} align="right" />
                </tr>
              </thead>
              <tbody>
                {salesPage.pageItems.map((row) => (
                  <tr key={row.staffId || row.name}>
                    <td className="cell-strong">{row.name}</td>
                    <td className="num">{row.billCount}</td>
                    <td className="num">₹{row.totalSales}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {salesReport.length > 0 && (
          <Pagination
            page={salesPage.page}
            pageCount={salesPage.pageCount}
            pageSize={salesPage.pageSize}
            total={salesPage.total}
            from={salesPage.from}
            to={salesPage.to}
            onPageChange={salesPage.setPage}
            onPageSizeChange={salesPage.setPageSize}
            label={t('seller.staffSalesReport')}
          />
        )}
      </div>

      </>
      )}

      {formOpen && (
        <Modal
          as={handover ? 'div' : 'form'}
          className="staff-modal"
          onSubmit={handleSubmit}
          onClose={closeForm}
          title={editingId ? t('seller.editStaff') : t('seller.addStaff')}
          hint={t('seller.staffFormHint')}
          footer={
            handover ? null : (
              <>
                {/* In the pinned bar, not above it. It used to render on the PAGE, which put
                    the reason a save failed behind the very modal the person was looking at;
                    in the scrolling body it would only have moved below the fold. It belongs
                    next to the button that caused it. */}
                {formError && <div className="modal-actions-error">{formError}</div>}
                <button type="submit" className="btn btn-primary btn-inline" disabled={submitting}>
                  {submitting ? t('common.saving') : editingId ? t('common.saveChanges') : t('seller.addStaff')}
                </button>
                <button type="button" className="btn btn-secondary btn-inline" onClick={closeForm}>
                  {t('common.cancel')}
                </button>
              </>
            )
          }
        >

            {handover ? (
              <StaffHandover person={handover} onDone={closeForm} />
            ) : (
            <>
              <section className="form-step">
                <h3><span className="form-step-num">1</span>{t('staff.stepWho')}</h3>
                <div className="form-grid cols-2">
                  <div className="field">
                    <label htmlFor="staffName">{t('common.name')}</label>
                    <input id="staffName" value={form.name} onChange={update('name')} required autoFocus />
                  </div>
                  <div className="field">
                    <label htmlFor="staffEmail">{t('seller.staffEmail')}</label>
                    <input id="staffEmail" type="email" value={form.email} onChange={update('email')} required disabled={Boolean(editingId)} />
                    {editingId && <p className="field-hint">{t('staff.emailLocked')}</p>}
                  </div>
                  <PhoneField
                    id="staffPhone"
                    label={t('staff.phone')}
                    value={form.phone}
                    onChange={(value) => setForm((f) => ({ ...f, phone: value }))}
                    hint={t('staff.phoneHint')}
                  />
                  <div className="field field-span2">
                    <label htmlFor="staffPassword">{editingId ? t('seller.newPasswordOptional') : t('seller.staffPassword')}</label>
                    {/* Plain text, not dots, and a suggestion already in the box.

                        This is not a password anybody is choosing for themselves — it is
                        one person creating a login to read out to another. Hiding it
                        behind dots protects it from nobody (the owner is typing it) and
                        costs the one thing that matters, which is being able to say it
                        out loud. And a field that starts empty is a field a shopkeeper
                        fills with 123456. */}
                    <div className="input-action">
                      <input
                        id="staffPassword"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={form.password}
                        onChange={update('password')}
                        minLength={6}
                        required={!editingId}
                        placeholder={editingId ? t('staff.leaveBlankKeep') : ''}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-inline"
                        onClick={() => setForm((f) => ({ ...f, password: suggestPassword() }))}
                      >
                        <RefreshIcon size={17} />
                        {t('staff.suggest')}
                      </button>
                    </div>
                    <p className="field-hint">{t('staff.passwordDictateHint')}</p>
                  </div>
                </div>
              </section>

              <section className="form-step">
                <h3><span className="form-step-num">2</span>{t('staff.stepRole')}</h3>
                <p className="field-hint" style={{ marginTop: 0 }}>{t('staff.roleHint')}</p>

                {/* The one decision that configures the rest of the dialog, so it leads —
                    and it is a row of cards rather than a strip of chips because a role is
                    a thing you recognise, not a word you read. Picking one fills the job
                    title and ticks the boxes below; the boxes are still there for anyone
                    who wants a shape none of these cards has. */}
                <div className="role-grid">
                  {presets.map((preset) => {
                    const Icon = ROLE_ICONS[preset.key] || ShieldIcon;
                    return (
                      <button
                        type="button"
                        key={preset.key}
                        className={`role-card${activePreset === preset.key ? ' active' : ''}`}
                        onClick={() => applyPreset(preset)}
                        aria-pressed={activePreset === preset.key}
                      >
                        <span className="role-card-icon"><Icon size={18} /></span>
                        <span className="role-card-name">{t(`seller.preset.${preset.key}`) || preset.label}</span>
                        <span className="role-card-sub">
                          {preset.permissions.length === allPermissions.length
                            ? t('staff.roleEverything')
                            : preset.permissions.slice(0, 2).map((p) => t(`seller.perm.${p}`)).join(', ')
                              + (preset.permissions.length > 2 ? ` +${preset.permissions.length - 2}` : '')}
                        </span>
                        {activePreset === preset.key && <CheckIcon size={14} className="role-card-tick" />}
                      </button>
                    );
                  })}
                </div>

                <div className="field" style={{ marginTop: '0.85rem' }}>
                  <label htmlFor="staffJob">{t('seller.jobTitle')}</label>
                  <input id="staffJob" value={form.jobTitle} onChange={update('jobTitle')} placeholder={t('seller.jobTitlePlaceholder')} />
                </div>

                {/* Nine checkboxes were most of this dialog's height for a decision the
                    cards above have usually already made. Folded away, with the answer
                    stated on the button so nothing is hidden — only quiet. */}
                <button
                  type="button"
                  className={`disclosure${accessOpen ? ' open' : ''}`}
                  onClick={() => setAccessOpen((open) => !open)}
                  aria-expanded={accessOpen}
                >
                  <ChevronDownIcon size={15} className="disclosure-caret" />
                  <span className="disclosure-label">{t('staff.customAccess')}</span>
                  <span className="disclosure-value">
                    {form.permissions.length === 0
                      ? t('seller.noPermissions')
                      : t('staff.permCount', { n: form.permissions.length })}
                  </span>
                </button>

                {accessOpen && (
                  <div className="permission-grid" style={{ marginTop: '0.6rem' }}>
                    {allPermissions.map((perm) => (
                      <label key={perm} className="permission-option">
                        <input
                          type="checkbox"
                          checked={form.permissions.includes(perm)}
                          onChange={() => togglePermission(perm)}
                        />
                        <span>
                          <strong>{t(`seller.perm.${perm}`)}</strong>
                          <small>{t(`seller.permDesc.${perm}`)}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </section>

              <section className="form-step">
                <h3><span className="form-step-num">3</span>{t('staff.stepPlace')}</h3>
                <div className="form-grid cols-2">
                  <div className="field">
                    <label htmlFor="staffSalary">{t('staff.salary')}</label>
                    <div className="field-affix">
                      <RupeeIcon size={15} />
                      <input
                        id="staffSalary"
                        type="number"
                        min="0"
                        step="1"
                        value={form.salary}
                        onChange={update('salary')}
                        placeholder="0"
                      />
                    </div>
                    <p className="field-hint">{t('staff.salaryHint')}</p>
                  </div>
                  {/* A salon pays chair-wise and a gym trainer-wise; a kirana's helper is
                      on a salary and the field is noise on his form. Stays visible for
                      anyone who already has a rate set, so nothing becomes uneditable. */}
                  {showCommission && (
                    <div className="field">
                      <label htmlFor="staffCommission">{t('seller.commissionRate')}</label>
                      <input
                        id="staffCommission"
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={form.commissionRate}
                        onChange={update('commissionRate')}
                        placeholder="0"
                      />
                      <p className="field-hint">{t('seller.commissionRateHint')}</p>
                    </div>
                  )}
                  <div className="field">
                    <label htmlFor="staffCounter">{t('seller.staffCounter')}</label>
                    <input id="staffCounter" value={form.counterName} onChange={update('counterName')} placeholder="Counter 1" />
                  </div>
                  {assignableStores.length > 1 && (
                    <div className="field">
                      <label>{t('seller.assignedStore')}</label>
                      <Dropdown
                        value={form.storeId}
                        onChange={setField('storeId')}
                        options={[
                          { value: '', label: t('seller.noStoreAssigned') },
                          ...assignableStores.map((s) => ({ value: s._id, label: s.name })),
                        ]}
                      />
                      {storeWasClosed && <p className="field-hint">{t('staff.storeClosedMoved')}</p>}
                    </div>
                  )}
                </div>
              </section>

            </>
            )}
        </Modal>
      )}
    </>
  );
}
