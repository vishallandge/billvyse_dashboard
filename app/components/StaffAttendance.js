'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { SkeletonTable } from './Skeleton';
import Dropdown from './Dropdown';
import { Pagination, usePagination } from './Pagination';
import { SortHeader, useSort } from './DataTable';
import { CalendarIcon, EditIcon, TrashIcon, UsersIcon, CheckCircleIcon } from './Icons';
import Modal from './Modal';
import { formatDate } from '../../lib/format';

const STATUSES = ['present', 'half_day', 'absent', 'leave'];

// Absent is the one that costs the shop money, so it is the one that reads loudest.
// Chhutti that was asked for and granted is planned, and stays neutral — using the same
// amber for both would flatten exactly the distinction the owner is looking for.
const STATUS_BADGE = {
  present: 'badge-active',
  half_day: 'badge-pending',
  absent: 'badge-danger',
  leave: 'badge-inactive',
};

const SORT_ACCESSORS = {
  date: (r) => r.date || '',
  name: (r) => (r.staff?.name || '').toLowerCase(),
  checkIn: (r) => (r.checkIn ? new Date(r.checkIn).getTime() : 0),
  checkOut: (r) => (r.checkOut ? new Date(r.checkOut).getTime() : 0),
  status: (r) => r.status || '',
};

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Whether somebody was on the books on a given day.
 *
 * The grid used to list everyone who ever had an account — so "Everyone present" marked a
 * man who left in March as present today, and that row then pulled him back onto the pay
 * sheet. Somebody who already has a row for the day stays visible regardless, so a record
 * can always be seen and corrected.
 */
function onBooks(member, day) {
  if (member.joinedOn && member.joinedOn > day) return false;
  if (member.leftOn) return member.leftOn >= day;
  return member.isActive !== false;
}

// The day's rows, keyed by whose they are, so the grid can ask "is this person marked"
// without walking the list once per row.
function indexByStaff(records) {
  const map = {};
  for (const record of records || []) {
    const id = String(record.staff?._id || record.staff);
    map[id] = record;
  }
  return map;
}

function formatTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// <input type="datetime-local"> wants the local wall clock with no zone, which is exactly
// what toISOString() does NOT give.
function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Attendance, as a month rather than a list of punches.
 *
 * The half of this that was missing until now is the half that costs money. The only way
 * a row could ever be created was somebody pressing check-in, which hard-codes 'present'
 * — so a shop could record who turned up and had no way at all to record who did not.
 * `absent` and `half_day` sat in the schema, unreachable. Marking, correcting a punch and
 * a month summary are all new; the day list was already here.
 */
export default function StaffAttendance({ staff, month, onMonthChange }) {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();

  const [summary, setSummary] = useState({ rows: [], daysInMonth: 30 });
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStaffId, setFilterStaffId] = useState('');

  // The day grid: which day is on screen, what is already marked on it, and which row is
  // mid-save. Keyed by staff id so a tap only ever spins its own row.
  const [day, setDay] = useState(todayStr());
  const [dayRows, setDayRows] = useState({});
  const [busy, setBusy] = useState({});
  const [markingAll, setMarkingAll] = useState(false);
  const [editing, setEditing] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const dayStaff = staff.filter((member) => onBooks(member, day) || dayRows[member.id]);

  const sort = useSort(records, SORT_ACCESSORS, { key: 'date', dir: 'desc' });
  const page = usePagination(sort.sorted, { pageSize: 25, resetKey: `${month}|${filterStaffId}` });

  function load() {
    setLoading(true);
    const params = new URLSearchParams({ from: `${month}-01`, to: `${month}-31` });
    if (filterStaffId) params.set('staffId', filterStaffId);
    Promise.all([
      apiFetch(`/api/seller/staff/attendance/summary?month=${month}`),
      apiFetch(`/api/seller/staff/attendance?${params.toString()}`),
      apiFetch(`/api/seller/staff/attendance?from=${day}&to=${day}`),
    ])
      .then(([summaryData, listData, dayData]) => {
        setSummary(summaryData);
        setRecords(listData.records);
        setDayRows(indexByStaff(dayData.records));
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [month, filterStaffId, day]);

  /**
   * One tap = one person marked, saved immediately.
   *
   * No Save button on purpose. This is a list the owner runs down once a morning, and a
   * form that collects eight answers before committing any of them is a form that loses
   * all eight when somebody is called to the counter halfway through.
   */
  async function markOne(member, status) {
    setBusy((b) => ({ ...b, [member.id]: true }));
    try {
      const data = await apiFetch('/api/seller/staff/attendance/mark', {
        method: 'POST',
        body: JSON.stringify({ staffId: member.id, date: day, status }),
      });
      setDayRows((rows) => ({ ...rows, [member.id]: data.attendance }));
      // The month summary above is now out of date by exactly one day.
      refreshMonth();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy((b) => ({ ...b, [member.id]: false }));
    }
  }

  // The overwhelmingly common morning: everybody turned up. Marks only the ones with no
  // row yet, so it never overwrites an absence somebody already recorded.
  async function markEveryonePresent() {
    const entries = dayStaff
      .filter((member) => !dayRows[member.id])
      .map((member) => ({ staffId: member.id, status: 'present' }));
    if (entries.length === 0) return;

    setMarkingAll(true);
    try {
      const data = await apiFetch('/api/seller/staff/attendance/mark-day', {
        method: 'POST',
        body: JSON.stringify({ date: day, entries, onlyMissing: true }),
      });
      setDayRows(indexByStaff(data.records));
      toast.success(t('staff.daySaved'));
      refreshMonth();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setMarkingAll(false);
    }
  }

  // Only the parts a single tap can change — reloading the whole tab would blank the grid
  // under the finger that just tapped it.
  function refreshMonth() {
    const params = new URLSearchParams({ from: `${month}-01`, to: `${month}-31` });
    if (filterStaffId) params.set('staffId', filterStaffId);
    Promise.all([
      apiFetch(`/api/seller/staff/attendance/summary?month=${month}`),
      apiFetch(`/api/seller/staff/attendance?${params.toString()}`),
    ])
      .then(([summaryData, listData]) => {
        setSummary(summaryData);
        setRecords(listData.records);
      })
      .catch(() => {
        // The tap itself already succeeded and is on screen; a failed refresh of the
        // summary is not worth a second error toast about the same action.
      });
  }

  async function saveEdit(event) {
    event.preventDefault();
    setSavingEdit(true);
    try {
      await apiFetch(`/api/seller/staff/attendance/${editing._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          checkIn: editing.checkIn || null,
          checkOut: editing.checkOut || null,
          status: editing.status,
          note: editing.note || '',
        }),
      });
      toast.success(t('staff.recordUpdated'));
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function removeRecord(record) {
    const ok = await confirm({
      tone: 'danger',
      title: t('common.delete'),
      body: t('staff.confirmDeleteRecord', {
        name: record.staff?.name || '',
        date: formatDate(record.date, lang),
      }),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/seller/staff/attendance/${record._id}`, { method: 'DELETE' });
      toast.success(t('staff.recordRemoved'));
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

  const staffOptions = staff.map((s) => ({ value: s.id, label: s.name }));
  const markedCount = dayStaff.filter((member) => dayRows[member.id]).length;

  return (
    <div className="staff-tab">
      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-brand"><CheckCircleIcon size={16} /></div>
          <h2>{t('staff.dayTitle')}</h2>
        </div>

        <div className="attendance-day-head">
          <div className="field">
            <label htmlFor="dayPick">{t('staff.pickDay')}</label>
            <input
              id="dayPick"
              type="date"
              value={day}
              max={todayStr()}
              onChange={(e) => setDay(e.target.value)}
            />
          </div>
          <div className="attendance-day-meta">
            <span className="cell-sub">{t('staff.markedOf', { done: markedCount, total: dayStaff.length })}</span>
            <button
              type="button"
              className="btn btn-secondary btn-small btn-inline"
              onClick={markEveryonePresent}
              disabled={markingAll || markedCount === dayStaff.length}
            >
              {markingAll ? t('common.saving') : t('staff.allPresent')}
            </button>
          </div>
        </div>

        <p className="field-hint">{t('staff.dayHint')} {t('staff.correctBelow')}</p>

        {dayStaff.length === 0 && <p className="empty-state">{t('staff.noOneOnDay')}</p>}
        <ul className="attendance-day-list">
          {dayStaff.map((member) => {
            const row = dayRows[member.id];
            return (
              <li key={member.id} className="attendance-day-row">
                <div className="cell-stack attendance-day-who">
                  <span className="cell-strong">{member.name}</span>
                  <span className="cell-sub">
                    {row
                      ? [
                          t(`seller.attendanceStatus.${row.status}`),
                          row.checkIn ? formatTime(row.checkIn) : null,
                        ].filter(Boolean).join(' · ')
                      : t('staff.notMarked')}
                  </span>
                </div>
                <div className="segmented segmented-sm attendance-day-pick" role="group">
                  {STATUSES.map((status) => (
                    <button
                      type="button"
                      key={status}
                      className={row?.status === status ? 'active' : undefined}
                      disabled={busy[member.id]}
                      onClick={() => markOne(member, status)}
                    >
                      {t(`seller.attendanceStatus.${status}`)}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-brand"><CalendarIcon size={16} /></div>
          <h2>{t('staff.summaryTitle')}</h2>
        </div>
        <p className="field-hint" style={{ marginTop: 0 }}>{t('staff.summaryHint')}</p>

        {loading ? (
          <SkeletonTable rows={4} cols={6} />
        ) : summary.rows.every((r) => !r.present && !r.halfDay && !r.absent && !r.leave) ? (
          <p className="empty-state">{t('staff.noSummary')}</p>
        ) : (
          <div className="table-wrap auto-height">
            <table className="data-table" style={{ minWidth: '560px' }}>
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th className="num">{t('staff.present')}</th>
                  <th className="num">{t('staff.halfDay')}</th>
                  <th className="num">{t('staff.absent')}</th>
                  <th className="num">{t('staff.leave')}</th>
                  <th className="num">{t('staff.hours')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((row) => (
                  <tr key={row.staffId}>
                    <td>
                      <div className="cell-stack">
                        <span className="cell-strong">{row.name}</span>
                        {row.jobTitle && <span className="cell-sub">{row.jobTitle}</span>}
                      </div>
                    </td>
                    <td className="num">{row.present}</td>
                    <td className="num">{row.halfDay}</td>
                    <td className="num">{row.absent ? <strong className="amount-out">{row.absent}</strong> : 0}</td>
                    <td className="num">{row.leave}</td>
                    <td className="num">{row.hours || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="data-panel">
        <div className="panel-head">
          <h2>{t('seller.attendanceTitle')}</h2>
          <div className="panel-tools">
            <Dropdown
              className="filter-select"
              value={filterStaffId}
              onChange={setFilterStaffId}
              options={[{ value: '', label: t('seller.allStaff') }, ...staffOptions]}
            />
            <input type="month" value={month} onChange={(e) => onMonthChange(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="data-panel-body"><SkeletonTable rows={5} cols={6} /></div>
        ) : records.length === 0 ? (
          <div className="empty-state-rich">
            <div className="empty-icon"><CalendarIcon size={26} /></div>
            <p>{t('seller.noAttendanceYet')}</p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table sticky-actions">
                <thead>
                  <tr>
                    <SortHeader sortKey="date" label={t('expenses.date')} sort={sort.sort} onSort={sort.toggle} />
                    <SortHeader sortKey="name" label={t('common.name')} sort={sort.sort} onSort={sort.toggle} />
                    <SortHeader sortKey="checkIn" label={t('seller.checkIn')} sort={sort.sort} onSort={sort.toggle} />
                    <SortHeader sortKey="checkOut" label={t('seller.checkOut')} sort={sort.sort} onSort={sort.toggle} />
                    <SortHeader sortKey="status" label={t('common.status')} sort={sort.sort} onSort={sort.toggle} />
                    <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.pageItems.map((record) => (
                    <tr key={record._id}>
                      <td className="cell-muted">{formatDate(record.date, lang)}</td>
                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{record.staff?.name || '—'}</span>
                          {record.note && <span className="cell-sub">{record.note}</span>}
                        </div>
                      </td>
                      <td>{formatTime(record.checkIn)}</td>
                      <td>{formatTime(record.checkOut)}</td>
                      <td>
                        <div className="cell-stack">
                          <span className={`badge ${STATUS_BADGE[record.status] || 'badge-inactive'}`}>
                            {t(`seller.attendanceStatus.${record.status}`)}
                          </span>
                          {/* A row the owner wrote is not a punch, and at month end that
                              difference is worth being able to see. */}
                          {record.markedByOwner && <span className="cell-sub">{t('staff.markedByOwner')}</span>}
                        </div>
                      </td>
                      <td className="tight">
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="icon-btn"
                            data-tip={t('staff.editRecord')}
                            onClick={() => setEditing({
                              _id: record._id,
                              name: record.staff?.name || '',
                              date: record.date,
                              checkIn: toLocalInput(record.checkIn),
                              checkOut: toLocalInput(record.checkOut),
                              status: record.status,
                              note: record.note || '',
                            })}
                          >
                            <EditIcon size={17} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn danger"
                            data-tip={t('common.delete')}
                            onClick={() => removeRecord(record)}
                          >
                            <TrashIcon size={17} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page.page}
              pageCount={page.pageCount}
              pageSize={page.pageSize}
              total={page.total}
              from={page.from}
              to={page.to}
              onPageChange={page.setPage}
              onPageSizeChange={page.setPageSize}
              label={t('seller.attendanceTitle')}
            />
          </>
        )}
      </div>

      {editing && (
        <Modal
          as="form"
          onSubmit={saveEdit}
          onClose={() => setEditing(null)}
          title={t('staff.editRecord')}
          hint={`${editing.name} · ${formatDate(editing.date, lang)}`}
          maxWidth={480}
          footer={
            <>
              <button type="submit" className="btn btn-primary btn-inline" disabled={savingEdit}>
                {savingEdit ? t('common.saving') : t('common.saveChanges')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >


              <div className="form-grid cols-2">
                <div className="field">
                  <label htmlFor="editIn">{t('seller.checkIn')}</label>
                  <input
                    id="editIn"
                    type="datetime-local"
                    value={editing.checkIn}
                    onChange={(e) => setEditing((r) => ({ ...r, checkIn: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="editOut">{t('seller.checkOut')}</label>
                  <input
                    id="editOut"
                    type="datetime-local"
                    value={editing.checkOut}
                    onChange={(e) => setEditing((r) => ({ ...r, checkOut: e.target.value }))}
                  />
                </div>
                <div className="field field-span2">
                  <label>{t('staff.markStatus')}</label>
                  <div className="segmented" role="group">
                    {STATUSES.map((status) => (
                      <button
                        type="button"
                        key={status}
                        className={editing.status === status ? 'active' : undefined}
                        onClick={() => setEditing((r) => ({ ...r, status }))}
                      >
                        {t(`seller.attendanceStatus.${status}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field field-span2">
                  <label htmlFor="editNote">{t('staff.markNote')}</label>
                  <input
                    id="editNote"
                    value={editing.note}
                    onChange={(e) => setEditing((r) => ({ ...r, note: e.target.value }))}
                    placeholder={t('staff.markNotePlaceholder')}
                  />
                </div>
              </div>

        </Modal>
      )}
    </div>
  );
}
