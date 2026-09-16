'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouteId } from '../../../../lib/routeId';
import { apiFetch } from '../../../../lib/api';
import { formatRupees, formatDate, toDateInput } from '../../../../lib/format';
import { useLanguage } from '../../../components/LanguageProvider';
import { useToast } from '../../../components/Toast';
import AddressField from '../../../components/AddressField';
import { addressErrorText } from '../../../../lib/addressRules';
import { useDashboardStores } from '../../../components/DashboardShell';
import { SkeletonStats, SkeletonTable } from '../../../components/Skeleton';
import Dropdown from '../../../components/Dropdown';
import PhoneField from '../../../components/PhoneField';
import {
  RupeeIcon, WarehouseIcon, ReceiptIcon, AlertIcon, SwapIcon, StarIcon,
} from '../../../components/Icons';
import { recordHref } from '../../../../lib/routeId';

/**
 * One branch's own screen — the thing multi-store never had.
 *
 * Until this page existed the only way to ask anything about a branch was to switch the
 * whole app into it and read a shop-wide screen, which answers a different question and
 * makes an owner with three shops switch three times to compare them. Everything here is
 * about THIS branch: its month, its shelf, its people, what it sells, what it billed last.
 *
 * The profile form is on the same page rather than behind an edit dialog because a branch's
 * details are read far more often than they are changed — the manager's name and the branch
 * phone number are the reason somebody opens this screen at all.
 */
export default function BranchDetailPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const params = { id: useRouteId() };
  const storeId = params?.id;
  const { activeStore } = useDashboardStores();

  const [data, setData] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // The address box's own verdict. The server refuses the same thing (its addressRules
  // is the file dashboard/lib/addressRules.js mirrors) — this is so the sentence lands
  // next to the box instead of arriving as a banner after a round trip.
  const [addrProblem, setAddrProblem] = useState(null);
  const [showAddrErrors, setShowAddrErrors] = useState(false);
  const [form, setForm] = useState(null);

  const load = useCallback(() => {
    if (!storeId) return;
    setLoading(true);
    apiFetch(`/api/seller/stores/${storeId}`)
      .then((result) => {
        setData(result);
        setError('');
        setForm({
          name: result.store.name || '',
          code: result.store.code || '',
          address: result.store.address || '',
          city: result.store.city || '',
          pincode: result.store.pincode || '',
          phone: result.store.phone || '',
          managerId: result.store.manager || '',
          openingTime: result.store.openingTime || '',
          closingTime: result.store.closingTime || '',
          openedOn: result.store.openedOn ? toDateInput(result.store.openedOn) : '',
          notes: result.store.notes || '',
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [storeId]);

  useEffect(load, [load]);

  useEffect(() => {
    apiFetch('/api/seller/staff')
      .then((result) => setStaffList(result.staff || []))
      .catch(() => {});
  }, []);

  const store = data?.store;
  const stats = store?.stats;

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function save(event) {
    event.preventDefault();
    if (addrProblem) {
      setShowAddrErrors(true);
      toast.error(addressErrorText(addrProblem.code, t));
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/seller/stores/${storeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...form, openedOn: form.openedOn || undefined }),
      });
      toast.success(t('seller.storeSaved'));
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault() {
    try {
      await apiFetch(`/api/seller/stores/${storeId}/set-default`, { method: 'POST' });
      toast.success(t('seller.storeSaved'));
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (error) {
    return (
      <>
        <div className="error-banner">{error}</div>
      </>
    );
  }

  return (
    <>

      <div className="content-header page-head">
        <div>
          <h1>{store?.name || t('seller.storesTitle')}</h1>
          <p>
            {store?.code ? `${store.code} · ` : ''}
            {[store?.address, store?.city].filter(Boolean).join(', ') || t('seller.noAddress')}
          </p>
        </div>
        {store && !store.isDefault && (
          <button type="button" className="btn btn-secondary btn-inline" onClick={makeDefault}>
            <StarIcon size={17} />
            {t('seller.setDefault')}
          </button>
        )}
      </div>

      {/* Which branch the app itself is currently pointed at, said here because it is the
          difference between reading this page and billing from it. Switching stores is the
          sidebar's job — this only tells the truth about where you are. */}
      {store && activeStore && String(activeStore._id) !== String(store._id) && (
        <div className="info-banner">{t('seller.notActiveBranch', { store: activeStore.name })}</div>
      )}

      {loading && !data ? (
        <SkeletonStats count={4} />
      ) : stats ? (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-icon"><RupeeIcon size={16} /></div>
            <div className="stat-value">{formatRupees(stats.todaySales, lang, { decimals: false })}</div>
            <div className="stat-label">{t('seller.branchToday')} · {t('seller.nBills', { n: stats.todayBills })}</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><ReceiptIcon size={16} /></div>
            <div className="stat-value">{formatRupees(stats.monthSales, lang, { decimals: false })}</div>
            <div className="stat-label">{t('seller.branchMonth')} · {t('seller.nBills', { n: stats.monthBills })}</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><WarehouseIcon size={16} /></div>
            <div className="stat-value">{formatRupees(stats.stockValue, lang, { decimals: false })}</div>
            <div className="stat-label">{t('seller.branchStock')}</div>
          </div>
          <div className={`stat-card${stats.outOfStock ? ' accent-danger' : ''}`}>
            <div className="stat-icon"><AlertIcon size={16} /></div>
            <div className="stat-value">{stats.outOfStock + stats.lowStock}</div>
            <div className="stat-label">{t('seller.needRefill')}</div>
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-head">
          <h2>{t('seller.branchProfile')}</h2>
          <div className="row-actions">
            <Link href="/seller/stores/transfer" className="btn btn-secondary btn-small btn-inline">
              <SwapIcon size={15} />
              {t('nav.transfers')}
            </Link>
          </div>
        </div>
        {!form ? (
          <SkeletonTable rows={4} cols={2} />
        ) : (
          <form onSubmit={save}>
            <div className="form-grid cols-2">
              <div className="field">
                <label>{t('seller.storeName')}</label>
                <input value={form.name} onChange={update('name')} required maxLength={120} />
              </div>
              <div className="field">
                <label>{t('seller.branchCode')}</label>
                <input value={form.code} onChange={update('code')} maxLength={12} />
                <p className="field-hint">{t('seller.branchCodeHint')}</p>
              </div>
              {/* One box for all three. A branch keeps city and pincode in columns of their
                  own — the branch card prints them beside the address — so the address line
                  holds only the shop number and the road, and the other two are written
                  back where they already lived. */}
              <AddressField
                id="store-address"
                label={t('seller.storeAddress')}
                value={form.address}
                place={{ city: form.city, pincode: form.pincode }}
                omitPlace
                onChange={(line, parts) =>
                  setForm((f) => ({ ...f, address: line, city: parts.city, pincode: parts.pincode }))
                }
                onValidity={setAddrProblem}
                showErrors={showAddrErrors}
                maxLength={200}
                className="field-span2"
              />
              <PhoneField
                label={t('seller.branchPhone')}
                value={form.phone}
                onChange={(value) => setForm((f) => ({ ...f, phone: value }))}
              />
              <div className="field">
                <label>{t('seller.managerLabel')}</label>
                <Dropdown
                  value={form.managerId}
                  onChange={(value) => setForm((f) => ({ ...f, managerId: value }))}
                  options={[
                    { value: '', label: t('seller.noManager') },
                    // `s.id` — see the note on the same dropdown in stores/page.js.
                    ...staffList.filter((s) => s.isActive !== false).map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
              </div>
              <div className="field">
                <label>{t('seller.opensAt')}</label>
                <input type="time" value={form.openingTime} onChange={update('openingTime')} />
              </div>
              <div className="field">
                <label>{t('seller.closesAt')}</label>
                <input type="time" value={form.closingTime} onChange={update('closingTime')} />
              </div>
              <div className="field">
                <label>{t('seller.openedOn')}</label>
                <input type="date" value={form.openedOn} onChange={update('openedOn')} />
              </div>
              <div className="field field-span2">
                <label>{t('recurring.notesLabel')}</label>
                <input value={form.notes} onChange={update('notes')} maxLength={500} />
              </div>
            </div>
            <button type="submit" className="btn btn-primary btn-inline" style={{ marginTop: '0.6rem' }} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </form>
        )}
      </div>

      <div className="branch-profile-grid">
        <div className="panel">
          <h2>{t('seller.branchStaffTitle')}</h2>
          {data?.staff?.length ? (
            <ul className="plain-list">
              {data.staff.map((member) => (
                <li key={member._id}>
                  <strong>{member.name}</strong>
                  {member.phone ? ` · ${member.phone}` : ''}
                  {member.isActive === false ? ` · ${t('seller.storeInactive')}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="cell-sub">
              {t('seller.noBranchStaff')} <Link href="/seller/staff">{t('nav.staff')}</Link>
            </p>
          )}
        </div>

        <div className="panel">
          <h2>{t('seller.branchTopItems')}</h2>
          {data?.topProducts?.length ? (
            <ul className="plain-list">
              {data.topProducts.map((row) => (
                <li key={row.name}>
                  {row.name} — <strong>{formatRupees(row.amount, lang, { decimals: false })}</strong>
                  <span className="cell-sub"> · {row.quantity}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cell-sub">{t('seller.noBranchSales')}</p>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>{t('seller.branchRecentBills')}</h2>
        {data?.recentBills?.length ? (
          <div className="table-wrap auto-height">
            <table className="data-table" style={{ minWidth: '520px' }}>
              <thead>
                <tr>
                  <th>{t('seller.billNo')}</th>
                  <th>{t('common.date')}</th>
                  <th>{t('recurring.paymentMode')}</th>
                  <th>{t('seller.billedBy')}</th>
                  <th>{t('recurring.lineTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {data.recentBills.map((bill) => (
                  <tr key={bill._id}>
                    <td><Link href={recordHref('/seller/invoice/[id]', bill._id)}>#{bill.billNumber}</Link></td>
                    <td>{formatDate(bill.createdAt, lang)}</td>
                    <td>{bill.paymentMode}</td>
                    <td>{bill.createdByName || '—'}</td>
                    <td>{formatRupees(bill.total, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="cell-sub">{t('seller.noBranchSales')}</p>
        )}
      </div>
    </>
  );
}
