'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { formatRupees, formatDate, toDateInput } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import Illustration from '../../components/Illustration';
import { SkeletonStats, SkeletonTable } from '../../components/Skeleton';
import Dropdown from '../../components/Dropdown';
import Modal from '../../components/Modal';
import PhoneField from '../../components/PhoneField';
import AddressField from '../../components/AddressField';
import { addressErrorText } from '../../../lib/addressRules';
import RowMenu from '../../components/RowMenu';
import {
  PlusIcon, StarIcon, CheckCircleIcon, EditIcon, TrashIcon, ShopIcon, PhoneIcon,
  UsersIcon, AlertIcon, RupeeIcon, WarehouseIcon, SwapIcon, ChevronRightIcon,
} from '../../components/Icons';
import { recordHref } from '../../../lib/routeId';

/**
 * Branches.
 *
 * This screen used to be a four-column table of names and addresses, and that is exactly what
 * an owner with three shops meant by "multi-store properly nahi dikh raha" — the app knew he
 * had three branches and could not tell him one thing about any of them.
 *
 * So a branch is a CARD, not a row, and every card carries the four numbers an owner actually
 * compares branches on: what it took today, what it has taken this month, what is sitting on
 * its shelf, and how many people are standing in it. Under the cards is the comparison the
 * cards cannot make — each branch's share of the month, its average bill and its margin, which
 * is the question "which shop is doing better" answered properly rather than left as
 * arithmetic for the owner to do in his head.
 *
 * A single-branch shop sees none of it. It gets its one card, the invitation to open a second
 * branch, and nothing else — a comparison table with one row in it is a screen apologising for
 * existing.
 */

const emptyForm = {
  name: '',
  code: '',
  address: '',
  city: '',
  pincode: '',
  phone: '',
  managerId: '',
  openingTime: '',
  closingTime: '',
  openedOn: '',
  notes: '',
};

export default function StoresPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();

  const [stores, setStores] = useState([]);
  const [limits, setLimits] = useState(null);
  const [staff, setStaff] = useState([]);
  const [compare, setCompare] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // The address box's own verdict. The server refuses the same thing (its addressRules
  // is the file dashboard/lib/addressRules.js mirrors) — this is so the sentence lands
  // next to the box instead of arriving as a banner after a round trip.
  const [addrProblem, setAddrProblem] = useState(null);
  const [showAddrErrors, setShowAddrErrors] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    // `stats=1` is what asks for the branch figures. Every other caller of this endpoint —
    // the sidebar switcher on every page load, the staff form, the transfer form — gets the
    // cheap list, which is the only reason those screens stay fast.
    apiFetch('/api/seller/stores?stats=1')
      .then(({ stores: rows, limits: planLimits }) => {
        setStores(rows);
        setLimits(planLimits || null);
        setError('');
        // Only worth asking for once there is something to compare. On a one-branch shop this
        // endpoint is also plan-gated, so not calling it is what keeps the screen clean rather
        // than showing a 402 nobody asked for.
        if (rows.length > 1) {
          apiFetch('/api/seller/stores/compare')
            .then(setCompare)
            .catch(() => setCompare(null));
        } else {
          setCompare(null);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    apiFetch('/api/seller/staff')
      .then((result) => setStaff(result.staff || []))
      .catch(() => {});
  }, []);

  const multiStore = stores.length > 1;
  const atLimit = limits?.maxStores != null && stores.length >= limits.maxStores;

  const totals = compare?.totals;

  const staffOptions = useMemo(
    // `s.id`, not `s._id` — /api/seller/staff serialises through User.toSafeObject(), which
    // returns `id`. With `_id` every option's value was undefined and no manager could be
    // picked at all. Only active staff: a manager who cannot log in cannot run a branch.
    () => [
      { value: '', label: t('seller.noManager') },
      ...staff.filter((s) => s.isActive !== false).map((s) => ({ value: s.id, label: s.name })),
    ],
    [staff, t]
  );

  /* ------------------------------------------------------------- the form */

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function openNew() {
    setForm(emptyForm);
    setEditingId(null);
    setFormOpen(true);
  }

  function openEdit(store) {
    setForm({
      name: store.name || '',
      code: store.code || '',
      address: store.address || '',
      city: store.city || '',
      pincode: store.pincode || '',
      phone: store.phone || '',
      managerId: store.manager || '',
      openingTime: store.openingTime || '',
      closingTime: store.closingTime || '',
      openedOn: store.openedOn ? toDateInput(store.openedOn) : '',
      notes: store.notes || '',
    });
    setEditingId(store._id);
    setFormOpen(true);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (addrProblem) {
      setShowAddrErrors(true);
      toast.error(addressErrorText(addrProblem.code, t));
      return;
    }
    setSubmitting(true);
    try {
      const body = JSON.stringify({ ...form, openedOn: form.openedOn || undefined });
      if (editingId) {
        await apiFetch(`/api/seller/stores/${editingId}`, { method: 'PATCH', body });
        toast.success(t('seller.storeSaved'));
        setFormOpen(false);
        load();
      } else {
        await apiFetch('/api/seller/stores', { method: 'POST', body });
        // Full reload so the sidebar's store switcher (fetched once in DashboardShell) picks
        // up the new branch immediately — it is the first thing the owner will reach for.
        window.location.reload();
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------------------------------------------------------- row actions */

  async function handleSetDefault(store) {
    setBusyId(store._id);
    try {
      await apiFetch(`/api/seller/stores/${store._id}/set-default`, { method: 'POST' });
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleActive(store) {
    // Only turning OFF asks. Turning one back on is additive and instantly visible; turning
    // one off quietly takes it out of the billing switcher, which is the change somebody can
    // make without realising they made it.
    if (store.isActive) {
      const ok = await confirm({
        tone: 'warning',
        title: t('seller.turnOffStoreTitle'),
        body: t('seller.turnOffStoreBody', { store: store.name }),
        confirmLabel: t('seller.turnOffStore'),
      });
      if (!ok) return;
    }
    setBusyId(store._id);
    try {
      await apiFetch(`/api/seller/stores/${store._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !store.isActive }),
      });
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(store) {
    const ok = await confirm({
      tone: 'danger',
      title: t('seller.deleteStoreTitle'),
      body: t('seller.deleteStoreBody'),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    setBusyId(store._id);
    try {
      await apiFetch(`/api/seller/stores/${store._id}`, { method: 'DELETE' });
      toast.success(t('seller.storeDeleted'));
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('seller.storesTitle')}</h1>
          <p>{t('seller.storesSubtitle')}</p>
        </div>
        <button type="button" className="btn btn-primary btn-inline" onClick={openNew} disabled={atLimit}>
          <PlusIcon size={17} />
          {t('seller.addStore')}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* The plan's branch count, said before it is hit. A limit a shop only meets by being
          refused is a limit that reads as a bug. */}
      {limits?.maxStores != null && (
        <div className="info-banner">
          {t('seller.branchesUsed', { used: limits.used, limit: limits.maxStores })}
          {atLimit && (
            <>
              {' '}
              <Link href="/seller/plan">{t('recurring.seePlans')}</Link>
            </>
          )}
        </div>
      )}

      {/* The chain's own totals, above the branches that make them up. */}
      {multiStore && (loading && !totals ? (
        <SkeletonStats count={4} />
      ) : totals ? (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-icon"><RupeeIcon size={16} /></div>
            <div className="stat-value">{formatRupees(totals.todaySales, lang, { decimals: false })}</div>
            <div className="stat-label">{t('seller.allBranchesToday')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><RupeeIcon size={16} /></div>
            <div className="stat-value">{formatRupees(totals.monthSales, lang, { decimals: false })}</div>
            <div className="stat-label">{t('seller.allBranchesMonth')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><WarehouseIcon size={16} /></div>
            <div className="stat-value">{formatRupees(totals.stockValue, lang, { decimals: false })}</div>
            <div className="stat-label">{t('seller.allBranchesStock')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><UsersIcon size={16} /></div>
            <div className="stat-value">{totals.staffCount}</div>
            <div className="stat-label">{t('seller.allBranchesStaff')}</div>
          </div>
        </div>
      ) : null)}

      <div className="panel">
        <div className="panel-head">
          <h2>{t('seller.branchList')}</h2>
          {multiStore && (
            <div className="row-actions">
              <Link href="/seller/stores/central" className="btn btn-secondary btn-small btn-inline">
                <WarehouseIcon size={15} />
                {t('nav.centralInventory')}
              </Link>
              <Link href="/seller/stores/transfer" className="btn btn-secondary btn-small btn-inline">
                <SwapIcon size={15} />
                {t('nav.transfers')}
              </Link>
            </div>
          )}
        </div>

        {loading ? (
          <SkeletonTable rows={3} cols={4} />
        ) : stores.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="shelf" />
            <p>{t('seller.noBranches')}</p>
            <button type="button" className="btn btn-primary btn-small btn-inline" onClick={openNew}>
              <PlusIcon size={15} />
              {t('seller.addStore')}
            </button>
          </div>
        ) : (
          <div className="branch-grid">
            {stores.map((store) => (
              <article key={store._id} className={`branch-card${store.isActive ? '' : ' closed'}`}>
                <header className="branch-card-head">
                  <div className="branch-name">
                    <ShopIcon size={16} />
                    <Link href={recordHref('/seller/stores/[id]', store._id)}>{store.name}</Link>
                    {store.code && <span className="branch-code">{store.code}</span>}
                  </div>
                  <RowMenu
                    items={[
                      {
                        label: t('seller.openBranch'),
                        icon: <ChevronRightIcon size={15} />,
                        href: recordHref('/seller/stores/[id]', store._id),
                      },
                      {
                        label: t('common.edit'),
                        icon: <EditIcon size={15} />,
                        onClick: () => openEdit(store),
                      },
                      {
                        label: t('seller.setDefault'),
                        icon: <StarIcon size={15} />,
                        hidden: Boolean(store.isDefault),
                        onClick: () => handleSetDefault(store),
                      },
                      {
                        label: store.isActive ? t('seller.turnOffStore') : t('seller.turnOnStore'),
                        icon: <CheckCircleIcon size={15} />,
                        danger: Boolean(store.isActive),
                        onClick: () => handleToggleActive(store),
                      },
                      {
                        label: t('common.delete'),
                        icon: <TrashIcon size={15} />,
                        danger: true,
                        // The server refuses a branch that has billed or holds stock, and an
                        // action that always fails is not an action. The main branch can
                        // never go.
                        hidden: Boolean(store.isDefault),
                        onClick: () => handleDelete(store),
                      },
                    ]}
                  />
                </header>

                <div className="branch-badges">
                  {store.isDefault && <span className="badge badge-active">{t('seller.defaultStore')}</span>}
                  <span className={`badge ${store.isActive ? 'badge-active' : 'badge-inactive'}`}>
                    {store.isActive ? t('seller.storeActive') : t('seller.storeInactive')}
                  </span>
                  {store.stats?.outOfStock > 0 && (
                    <span className="badge badge-expired">
                      {t('seller.outOfStockN', { n: store.stats.outOfStock })}
                    </span>
                  )}
                  {store.stats?.lowStock > 0 && (
                    <span className="badge badge-expiring">
                      {t('seller.lowStockN', { n: store.stats.lowStock })}
                    </span>
                  )}
                </div>

                <p className="branch-meta">
                  {[store.address, store.city, store.pincode].filter(Boolean).join(', ') || t('seller.noAddress')}
                </p>
                {(store.phone || store.managerName) && (
                  <p className="branch-meta">
                    {store.phone && (
                      <>
                        <PhoneIcon size={13} /> {store.phone}
                      </>
                    )}
                    {store.phone && store.managerName ? ' · ' : ''}
                    {store.managerName && `${t('seller.managerLabel')}: ${store.managerName}`}
                  </p>
                )}

                {/* The numbers. Only when there is more than one branch — on a single-store
                    shop these are the dashboard's own figures, already on the screen the
                    shopkeeper just came from. */}
                {store.stats && (
                  <div className="branch-figures">
                    <div>
                      <span>{t('seller.branchToday')}</span>
                      <strong>{formatRupees(store.stats.todaySales, lang, { decimals: false })}</strong>
                      <small>{t('seller.nBills', { n: store.stats.todayBills })}</small>
                    </div>
                    <div>
                      <span>{t('seller.branchMonth')}</span>
                      <strong>{formatRupees(store.stats.monthSales, lang, { decimals: false })}</strong>
                      <small>{t('seller.nBills', { n: store.stats.monthBills })}</small>
                    </div>
                    <div>
                      <span>{t('seller.branchStock')}</span>
                      <strong>{formatRupees(store.stats.stockValue, lang, { decimals: false })}</strong>
                      <small>{t('seller.atCost')}</small>
                    </div>
                    <div>
                      <span>{t('seller.branchStaff')}</span>
                      <strong>{store.stats.staffCount}</strong>
                      <small>
                        {store.stats.lastBillAt
                          ? t('seller.lastBillOn', { date: formatDate(store.stats.lastBillAt, lang) })
                          : t('seller.neverBilled')}
                      </small>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>

      {/* Which branch is doing better, and by how much. */}
      {multiStore && compare?.stores?.length > 1 && (
        <div className="panel">
          <h2>{t('seller.compareTitle')}</h2>
          <p className="cell-sub">{t('seller.compareHint')}</p>
          <div className="table-wrap auto-height">
            <table className="data-table" style={{ minWidth: '680px' }}>
              <thead>
                <tr>
                  <th>{t('seller.storeName')}</th>
                  <th>{t('seller.branchMonth')}</th>
                  <th>{t('seller.shareOfSales')}</th>
                  <th>{t('seller.nBillsHead')}</th>
                  <th>{t('seller.averageBill')}</th>
                  <th>{t('seller.marginHead')}</th>
                </tr>
              </thead>
              <tbody>
                {compare.stores.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={recordHref('/seller/stores/[id]', row.id)}>{row.name}</Link>
                      {row.code ? <span className="cell-sub"> {row.code}</span> : null}
                    </td>
                    <td>{formatRupees(row.monthSales, lang, { decimals: false })}</td>
                    <td>
                      {/* A bar, because a column of percentages is a column nobody reads.
                          The eye finds the short one before it reads a single number. */}
                      <div className="share-bar" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, row.shareOfSales)}%` }} />
                      </div>
                      {row.shareOfSales}%
                    </td>
                    <td>{row.monthBills}</td>
                    <td>{formatRupees(row.averageBill, lang, { decimals: false })}</td>
                    {/* Margin refuses to draw itself when the shop has not entered cost
                        prices — see the margin-honesty rule. A dash is the honest answer. */}
                    <td>{row.margin == null ? '—' : `${row.margin}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {formOpen && (
        <Modal
          as="form"
          onSubmit={handleSubmit}
          onClose={() => setFormOpen(false)}
          className="modal-tall"
          maxWidth="640px"
          title={editingId ? t('seller.editBranch') : t('seller.addStore')}
          hint={t('seller.branchFormHint')}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setFormOpen(false)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? t('common.saving') : t('common.save')}
              </button>
            </>
          }
        >
          <div className="form-grid cols-2">
            <div className="field">
              <label>{t('seller.storeName')}</label>
              <input value={form.name} onChange={update('name')} required maxLength={120} />
            </div>
            <div className="field">
              <label>{t('seller.branchCode')}</label>
              <input value={form.code} onChange={update('code')} maxLength={12} placeholder="MG-RD" />
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
                options={staffOptions}
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
        </Modal>
      )}
    </>
  );
}
