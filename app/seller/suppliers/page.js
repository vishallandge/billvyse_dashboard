'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, API_URL } from '../../../lib/api';
import { apiErrorMessage } from '../../../lib/apiErrors';
import { formatRupees, formatDate } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import AddressField from '../../components/AddressField';
import { addressErrorText, cleanAddressText, PARTY_NAME_MAX } from '../../../lib/addressRules';
import Illustration from '../../components/Illustration';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import AnimatedNumber from '../../components/AnimatedNumber';
import { SkeletonStats, SkeletonTable } from '../../components/Skeleton';
import { Pagination, usePagination } from '../../components/Pagination';
import Dropdown from '../../components/Dropdown';
import PhoneField from '../../components/PhoneField';
import Modal from '../../components/Modal';
import ReorderPanel from '../../components/ReorderPanel';
import {
  PlusIcon,
  XIcon,
  EditIcon,
  TrashIcon,
  SearchIcon,
  RupeeIcon,
  ClipboardIcon,
  UsersIcon,
  LinkIcon,
  CopyIcon,
  AlertIcon,
  SwapIcon,
  CheckCircleIcon,
  LedgerIcon,
  ExcelIcon,
  PdfIcon,
} from '../../components/Icons';
import RowMenu from '../../components/RowMenu';

// Mirrors the key the purchase-orders page reads on arrival. Two constants rather than a
// shared export because it is a handshake between exactly these two screens, and a third
// caller would be a bug rather than a reuse opportunity.
const REORDER_HANDOFF_KEY = 'dukaan.reorderHandoff';

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  company: '',
  address: '',
  gstin: '',
  upiId: '',
  openingBalance: '',
  paymentTermDays: '',
  notes: '',
};

export default function SuppliersPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();

  const [data, setData] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionSummary, setSuggestionSummary] = useState(null);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [filters, setFilters] = useState({ q: '', status: '' });
  const [searchDraft, setSearchDraft] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [payingSupplier, setPayingSupplier] = useState(null);
  const [payment, setPayment] = useState({ amount: '', mode: 'cash', note: '' });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  // The address box's own verdict. The server refuses the same thing (its addressRules
  // is the file dashboard/lib/addressRules.js mirrors) — this is so the sentence lands
  // next to the box instead of arriving as a banner after a round trip.
  const [addrProblem, setAddrProblem] = useState(null);
  const [showAddrErrors, setShowAddrErrors] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // Two records, one wholesaler, one phone — the payable split in half. Loaded alongside the
  // list rather than hidden behind a menu: a shopkeeper never goes looking for this, and the
  // number it costs him is only visible once both rows are shown together.
  const [duplicates, setDuplicates] = useState(null);
  const [mergeGroup, setMergeGroup] = useState(null);
  const [mergeKeepId, setMergeKeepId] = useState('');
  // The row the server says already holds the number being typed. Held here (not thrown as
  // an error) because the form has to keep the shopkeeper's input and ask a question.
  const [phoneDuplicate, setPhoneDuplicate] = useState(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.status) params.set('status', filters.status);
    return params.toString();
  }, [filters]);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/seller/suppliers?${query}`)
      .then((result) => {
        setData(result);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [query]);

  const loadDuplicates = useCallback(() => {
    apiFetch('/api/seller/suppliers/duplicates')
      .then(setDuplicates)
      .catch(() => setDuplicates(null));
  }, []);

  useEffect(load, [load]);
  useEffect(loadDuplicates, [loadDuplicates]);

  const loadSuggestions = useCallback(() => {
    apiFetch(`/api/seller/suppliers/reorder-suggestions${showSnoozed ? '?includeSnoozed=1' : ''}`)
      .then((result) => {
        setSuggestions(result.suggestions || []);
        setSuggestionSummary(result.summary || null);
      })
      .catch(() => {});
  }, [showSnoozed]);

  useEffect(loadSuggestions, [loadSuggestions]);

  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => (f.q === searchDraft ? f : { ...f, q: searchDraft })), 350);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const suppliers = data?.suppliers || [];
  const summary = data?.summary;
  const supplierPage = usePagination(suppliers, { pageSize: 25, resetKey: query });

  /**
   * This screen has no order form on it, so a selection made here is carried to the one
   * that does rather than being turned into an order behind the shopkeeper's back. The
   * purchase-orders page reads this on arrival, opens the form with all of it already on
   * board, and clears the key.
   */
  function handOffToPurchaseOrder(rows) {
    try {
      window.sessionStorage.setItem(
        REORDER_HANDOFF_KEY,
        JSON.stringify(rows.map((row) => ({ productId: String(row.suggestion.product.id), quantity: row.quantity })))
      );
    } catch {
      // Storage blocked. The order screen still opens — empty — which is the same place
      // the "New purchase order" button goes, so nothing is lost but the typing.
    }
    router.push('/seller/purchase-orders');
  }

  async function snoozeSuggestions(productIds, days) {
    if (!productIds || productIds.length === 0) return;
    setReorderBusy(true);
    try {
      await apiFetch('/api/seller/suppliers/reorder-suggestions/snooze', {
        method: 'POST',
        body: JSON.stringify({ productIds, days }),
      });
      toast.success(days > 0 ? t('purchase.reorderSnoozed', { count: productIds.length, days }) : t('purchase.reorderUnsnoozed', { count: productIds.length }));
      loadSuggestions();
    } catch (err) {
      setError(err.message);
    } finally {
      setReorderBusy(false);
    }
  }

  function update(field) {
    return (e) => {
      setForm((f) => ({ ...f, [field]: e.target.value }));
      // A field the shopkeeper is actively fixing shouldn't stay flagged red while they type.
      if (fieldErrors[field]) setFieldErrors((fe) => ({ ...fe, [field]: undefined }));
    };
  }

  function openAddForm() {
    setForm(emptyForm);
    setEditingId(null);
    setError('');
    setFieldErrors({});
    setPhoneDuplicate(null);
    setFormOpen(true);
  }

  function openEditForm(supplier) {
    setForm({
      name: supplier.name || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      company: supplier.company || '',
      address: supplier.address || '',
      gstin: supplier.gstin || '',
      upiId: supplier.upiId || '',
      // Opening balance is a one-time entry made when the supplier is created; editing it
      // later would rewrite the ledger's first line, so it isn't offered on edit.
      openingBalance: '',
      paymentTermDays: supplier.paymentTermDays ? String(supplier.paymentTermDays) : '',
      notes: supplier.notes || '',
    });
    setEditingId(supplier._id);
    setError('');
    setFieldErrors({});
    setPhoneDuplicate(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setFieldErrors({});
    setPhoneDuplicate(null);
  }

  async function handleSubmit(event, allowDuplicatePhone = false) {
    event.preventDefault();
    setError('');
    setFieldErrors({});
    if (addrProblem) {
      setShowAddrErrors(true);
      setError(addressErrorText(addrProblem.code, t));
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        name: form.name,
        phone: form.phone,
        email: form.email || undefined,
        company: form.company,
        address: form.address,
        gstin: form.gstin || undefined,
        upiId: form.upiId || undefined,
        paymentTermDays: form.paymentTermDays ? Number(form.paymentTermDays) : undefined,
        notes: form.notes,
        allowDuplicatePhone: allowDuplicatePhone || undefined,
      };
      if (editingId) {
        await apiFetch(`/api/seller/suppliers/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.success(t('supplier.updated'));
      } else {
        await apiFetch('/api/seller/suppliers', {
          method: 'POST',
          body: JSON.stringify({ ...body, openingBalance: Number(form.openingBalance) || 0 }),
        });
        toast.success(t('supplier.added'));
      }
      closeForm();
      load();
      loadDuplicates();
    } catch (err) {
      // This number already belongs to another supplier row. Asked as a question with that
      // row's name and payable in it rather than refused outright — two rows on one phone is
      // occasionally deliberate, and only the shopkeeper knows. Never a toast, which is gone
      // before it has been read.
      if (err.code === 'DUPLICATE_SUPPLIER_PHONE' && err.data?.duplicate) {
        setPhoneDuplicate(err.data.duplicate);
      } else {
        // In the shopkeeper's language when the server named the refusal (the own-number one
        // included); the server's English otherwise.
        const text = apiErrorMessage(lang, err);
        setError(text);
        if (err.data?.field) setFieldErrors({ [err.data.field]: text });
      }
    } finally {
      setSubmitting(false);
    }
  }

  function openMerge(group) {
    // Pre-picks the row worth keeping: the one with the most purchase history behind it, so
    // the default is the record the shop actually deals with rather than whichever was typed
    // first. Still a dropdown — the shopkeeper can overrule it.
    const best = [...group.suppliers].sort((a, b) => b.totalPurchased - a.totalPurchased || b.orderCount - a.orderCount)[0];
    setMergeKeepId(String(best?.id || ''));
    setMergeGroup(group);
  }

  async function submitMerge() {
    if (!mergeGroup || !mergeKeepId) return;
    const mergeIds = mergeGroup.suppliers.map((s) => String(s.id)).filter((id) => id !== mergeKeepId);
    setSubmitting(true);
    try {
      const result = await apiFetch('/api/seller/suppliers/merge', {
        method: 'POST',
        body: JSON.stringify({ keepId: mergeKeepId, mergeIds }),
      });
      toast.success(result.message);
      setMergeGroup(null);
      setMergeKeepId('');
      load();
      loadDuplicates();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function copyPortalUrl() {
    try {
      await navigator.clipboard.writeText(data?.portalUrl || '');
      toast.success(t('supplier.portalLinkCopied'));
    } catch {
      toast.error(t('common.copyFailed'));
    }
  }

  async function toggleActive(supplier) {
    try {
      await apiFetch(`/api/seller/suppliers/${supplier._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !supplier.isActive }),
      });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleDelete(supplier) {
    if (!(await confirm({ tone: 'danger', title: t('common.delete'), body: t('supplier.confirmDelete', { name: supplier.name }), confirmLabel: t('common.delete') }))) return;
    try {
      const result = await apiFetch(`/api/seller/suppliers/${supplier._id}`, { method: 'DELETE' });
      toast.success(result.deactivated ? t('supplier.deactivatedInstead') : t('supplier.removed'));
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function submitPayment(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch(`/api/seller/suppliers/${payingSupplier._id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(payment.amount), mode: payment.mode, note: payment.note || undefined }),
      });
      toast.success(t('seller.recordSupplierPayment'));
      setPayingSupplier(null);
      setPayment({ amount: '', mode: 'cash', note: '' });
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function exportUrl(format) {
    return `${API_URL}/api/seller/suppliers?${query}&format=${format}`;
  }

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('seller.suppliersTitle')}</h1>
          <p>{t('seller.suppliersSubtitle')}</p>
          <div className="head-links">
            <Link href="/seller/purchase-orders" className="nav-link">{t('seller.viewPurchaseOrders')} →</Link>
            <Link href="/seller/suppliers/ledger" className="nav-link">{t('seller.supplierLedgerTitle')} →</Link>
          </div>
        </div>
        <button type="button" className="btn btn-primary btn-inline" onClick={openAddForm}>
          <PlusIcon size={17} />
          {t('seller.addSupplier')}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading && !data ? (
        <SkeletonStats count={3} />
      ) : (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-icon"><UsersIcon size={16} /></div>
            <div className="stat-value">{summary?.activeCount || 0}</div>
            <div className="stat-label">{t('supplier.activeCount')}</div>
          </div>
          <div className="stat-card accent-danger">
            <div className="stat-icon"><RupeeIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={summary?.totalPayable || 0} /></div>
            <div className="stat-label">{t('seller.totalPayable')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><ClipboardIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={summary?.totalPurchased || 0} /></div>
            <div className="stat-label">{t('purchase.totalPurchased')}</div>
          </div>
        </div>
      )}

      {/* Two records, one wholesaler: the payable is split and neither half is what he is
          owed. Led with the money rather than the count, because "2 duplicate" reads as
          tidying and "₹4,995 do jagah bata hua" reads as a problem. */}
      {duplicates?.totalGroups > 0 && (
        <div className="panel accent-danger">
          <div className="panel-head">
            <h2><AlertIcon size={16} /> {t('supplier.duplicatesTitle')}</h2>
          </div>
          <p className="field-hint" style={{ marginTop: 0 }}>
            {t('supplier.duplicatesHint', {
              count: duplicates.totalGroups,
              amount: formatRupees(duplicates.totalSplitBalance, lang),
            })}
          </p>
          <div className="table-wrap auto-height">
            <table className="data-table" style={{ minWidth: '560px' }}>
              <thead>
                <tr>
                  <th>{t('common.phone')}</th>
                  <th>{t('supplier.duplicateRows')}</th>
                  <th className="num">{t('supplier.splitBalance')}</th>
                  <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {duplicates.groups.map((group) => (
                  <tr key={group.phoneKey}>
                    <td className="cell-strong">{group.phoneDisplay}</td>
                    <td>
                      <div className="cell-stack">
                        {group.suppliers.map((s) => (
                          <span key={String(s.id)} className="cell-sub">
                            {s.name}
                            {s.company ? ` · ${s.company}` : ''} — {formatRupees(s.balance, lang)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="num cell-strong amount-out">{formatRupees(group.splitBalance, lang)}</td>
                    <td className="tight">
                      <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="icon-btn primary"
                          data-tip={t('supplier.mergeCta')}
                          onClick={() => openMerge(group)}
                        >
                          <SwapIcon size={17} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* The portal was invisible from this side: a shopkeeper could see a supplier's phone
          and email on the row with no way of knowing the phone is the login and the email is
          not, nor whether the man had ever managed to get in. */}
      {!loading && suppliers.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2><LinkIcon size={16} /> {t('supplier.portalTitle')}</h2>
            <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={copyPortalUrl}>
              <CopyIcon size={15} /> {t('supplier.copyPortalLink')}
            </button>
          </div>
          <p className="field-hint" style={{ marginTop: 0 }}>{t('supplier.portalExplain')}</p>
          <p className="field-hint">
            <code>{data?.portalUrl}</code>
          </p>
          {summary?.noPortalCount > 0 && (
            <div className="info-banner" style={{ marginBottom: 0 }}>
              {t('supplier.portalGap', { count: summary.noPortalCount })}
            </div>
          )}
        </div>
      )}

      {/* The same list the purchase-orders screen shows, and now the same list you can act
          on. It used to be four read-only columns here: the shopkeeper could see that six
          things were low and then had to walk to another screen and find all six again by
          name. The bar hands the selection over instead. */}
      {(suggestions.length > 0 || suggestionSummary?.snoozed > 0) && (
        <ReorderPanel
          suggestions={suggestions}
          summary={suggestionSummary}
          busy={reorderBusy}
          onAdd={handOffToPurchaseOrder}
          onSnooze={snoozeSuggestions}
          onToggleSnoozed={setShowSnoozed}
          showingSnoozed={showSnoozed}
          headerExtra={
            <Link href="/seller/purchase-orders" className="nav-link">
              {t('purchase.create')} →
            </Link>
          }
        />
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>{t('seller.suppliersTitle')}</h2>
          <div className="panel-tools">
            <div className="search-box-inline">
              <SearchIcon size={15} />
              <input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder={t('supplier.searchPlaceholder')} />
            </div>
            <Dropdown
              className="filter-select"
              value={filters.status}
              onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
              options={[
                { value: '', label: t('supplier.allSuppliers') },
                { value: 'active', label: t('common.active') },
                { value: 'inactive', label: t('common.inactive') },
              ]}
            />
            <a className="btn btn-secondary btn-small btn-inline" href={exportUrl('xlsx')}>
              <ExcelIcon size={17} /> Excel
            </a>
            <a className="btn btn-secondary btn-small btn-inline" href={exportUrl('pdf')}>
              <PdfIcon size={17} /> PDF
            </a>
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={5} cols={5} />
        ) : suppliers.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="people" />
            <p>{filters.q || filters.status ? t('supplier.noneMatch') : t('seller.noSuppliers')}</p>
            {!filters.q && !filters.status && (
              <button type="button" className="btn btn-primary btn-small btn-inline" onClick={openAddForm}>
                <PlusIcon size={15} />
                {t('seller.addSupplier')}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="table-wrap auto-height">
              <table className="data-table" style={{ minWidth: '900px' }}>
                <thead>
                  <tr>
                    <th>{t('common.name')}</th>
                    <th>{t('common.phone')}</th>
                    <th className="num">{t('purchase.totalPurchased')}</th>
                    <th className="num">{t('seller.totalPayable')}</th>
                    <th>{t('common.status')}</th>
                    <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierPage.pageItems.map((s) => (
                    <tr key={s._id} className="row-enter">
                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{s.name}</span>
                          {s.company && <span className="cell-sub">{s.company}</span>}
                          {s.gstin && <span className="cell-sub">{s.gstin}</span>}
                        </div>
                      </td>
                      <td>
                        {s.phone || s.email ? (
                          <div className="cell-stack">
                            {s.phone && <a href={`tel:${s.phone}`} className="nav-link">{s.phone}</a>}
                            {s.whatsappLink && (
                              <a href={s.whatsappLink} target="_blank" rel="noreferrer" className="cell-sub nav-link">
                                WhatsApp
                              </a>
                            )}
                            {s.email && (
                              <a href={`mailto:${s.email}`} className="cell-sub nav-link">{s.email}</a>
                            )}
                          </div>
                        ) : (
                          <span className="cell-muted">—</span>
                        )}
                      </td>
                      <td className="num">
                        <div className="cell-stack">
                          <span>{formatRupees(s.totalPurchased, lang, { decimals: false })}</span>
                          <span className="cell-sub">
                            {s.lastOrderAt ? t('supplier.lastOrder', { date: formatDate(s.lastOrderAt, lang) }) : t('supplier.noOrdersYet')}
                          </span>
                        </div>
                      </td>
                      <td className="num">
                        {s.balance > 0 ? (
                          <span className="cell-strong amount-out">{formatRupees(s.balance, lang)}</span>
                        ) : s.balance < 0 ? (
                          <span className="cell-strong amount-in">{t('supplier.advance', { amount: formatRupees(-s.balance, lang) })}</span>
                        ) : (
                          <span className="badge badge-active">{t('supplier.settled')}</span>
                        )}
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span className={`badge ${s.isActive ? 'badge-active' : 'badge-inactive'}`}>
                            {s.isActive ? t('common.active') : t('common.inactive')}
                          </span>
                          {/* Three states worth telling apart, because the fix differs: no
                              number at all (nothing to invite), a number nobody has used yet
                              (send the invite), and a supplier already answering orders. */}
                          {!s.portal?.canLogin ? (
                            <span className="badge badge-inactive" data-tip={t('supplier.portalNoPhoneHint')}>
                              {t('supplier.portalNoPhone')}
                            </span>
                          ) : s.portal.hasAccount ? (
                            <span className="badge badge-active" data-tip={s.portal.lastLoginAt ? formatDate(s.portal.lastLoginAt, lang) : undefined}>
                              <CheckCircleIcon size={12} /> {t('supplier.portalJoined')}
                            </span>
                          ) : (
                            <span className="badge badge-pending">{t('supplier.portalNotJoined')}</span>
                          )}
                        </div>
                      </td>
                      <td className="tight">
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          {/* Six spelled-out buttons and two icons used to sit here, which
                              made the actions column wider than the supplier's name. Paying
                              him is the one thing this screen is opened to do, so it is the
                              tinted square; the statement is the one thing read beside it.
                              Everything else — the invite, the on/off switch, deleting —
                              happens once in a supplier's life and can afford a tap more. */}
                          {s.balance > 0 && (
                            <button
                              type="button"
                              className="icon-btn primary"
                              data-tip={t('seller.recordSupplierPayment')}
                              onClick={() => { setPayingSupplier(s); setPayment({ amount: String(s.balance), mode: 'cash', note: '' }); }}
                            >
                              <RupeeIcon size={17} />
                            </button>
                          )}
                          <Link href="/seller/suppliers/ledger" className="icon-btn" data-tip={t('seller.supplierStatement')}>
                            <LedgerIcon size={17} />
                          </Link>
                          <button type="button" className="icon-btn" data-tip={t('common.edit')} onClick={() => openEditForm(s)}>
                            <EditIcon size={17} />
                          </button>
                          <RowMenu
                            items={[
                              {
                                /* One tap, one message, pre-written — the whole reason this
                                   wholesaler never saw a single order. Only offered while he
                                   has not joined; after that it is noise on every row. */
                                label: t('supplier.portalInvite'),
                                icon: <LinkIcon size={15} />,
                                hidden: !s.portalInviteLink || Boolean(s.portal?.hasAccount),
                                href: s.portalInviteLink,
                                external: true,
                              },
                              {
                                label: s.isActive ? t('seller.deactivateStaff') : t('seller.activateStaff'),
                                icon: <CheckCircleIcon size={15} />,
                                onClick: () => toggleActive(s),
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
            <Pagination
              compact
              page={supplierPage.page}
              pageCount={supplierPage.pageCount}
              pageSize={supplierPage.pageSize}
              total={supplierPage.total}
              from={supplierPage.from}
              to={supplierPage.to}
              onPageChange={supplierPage.setPage}
              onPageSizeChange={supplierPage.setPageSize}
              label={t('nav.suppliers')}
            />
          </>
        )}
      </div>

      {formOpen && (
        <Modal
          as="form"
          onSubmit={handleSubmit}
          onClose={closeForm}
          title={editingId ? t('common.edit') : t('seller.addSupplier')}
          hint={editingId ? form.name : t('supplier.formHint')}
          maxWidth={620}
          footer={
            <>
              <button type="submit" className="btn btn-primary btn-inline" disabled={submitting}>
                {submitting ? t('common.saving') : editingId ? t('common.saveChanges') : t('common.add')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={closeForm}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
              <div className="form-grid">
                <div className={`field${fieldErrors.name ? ' has-error' : ''}`}>
                  <label>{t('common.name')}</label>
                  <input value={form.name} onChange={update('name')} required autoFocus />
                  {fieldErrors.name && <span className="field-error-text">{fieldErrors.name}</span>}
                </div>
                {/* The hint is said here because it is the one thing about this form
                    nobody guesses: the portal is keyed on this number and nothing else. */}
                <PhoneField
                  label={t('common.phone')}
                  value={form.phone}
                  onChange={(value) => {
                    setForm((f) => ({ ...f, phone: value }));
                    // The warning was about the old number; keep typing and it stops
                    // applying, so it should not sit there looking answered.
                    if (phoneDuplicate) setPhoneDuplicate(null);
                  }}
                  hint={t('supplier.phonePortalHint')}
                />
                <div className={`field${fieldErrors.email ? ' has-error' : ''}`}>
                  <label>{t('common.email')}</label>
                  <input type="email" value={form.email} onChange={update('email')} placeholder="supplier@example.com" />
                  {fieldErrors.email ? (
                    <span className="field-error-text">{fieldErrors.email}</span>
                  ) : (
                    <p className="field-hint">{t('supplier.emailPurposeHint')}</p>
                  )}
                </div>
                <div className="field">
                  <label>{t('seller.supplierCompany')}</label>
                  <input
                    value={form.company}
                    onChange={(e) => setForm((f) => ({ ...f, company: cleanAddressText(e.target.value, PARTY_NAME_MAX) }))}
                  />
                </div>
                <div className={`field${fieldErrors.gstin ? ' has-error' : ''}`}>
                  <label>{t('seller.gstin')}</label>
                  <input value={form.gstin} onChange={update('gstin')} placeholder="27ABCDE1234F1Z5" style={{ textTransform: 'uppercase' }} />
                  {fieldErrors.gstin ? (
                    <span className="field-error-text">{fieldErrors.gstin}</span>
                  ) : (
                    <p className="field-hint">{t('supplier.gstinHint')}</p>
                  )}
                </div>
                <AddressField
                  id="sup-address"
                  label={t('seller.supplierAddress')}
                  value={form.address}
                  onChange={(v) => setForm((f) => ({ ...f, address: v }))}
                  onValidity={setAddrProblem}
                  showErrors={showAddrErrors}
                  className="field-span2"
                />
                {/* Where money actually goes to him. The purchase screen has offered a "UPI"
                    payment mode since the beginning with nowhere on the platform holding a
                    VPA, so it named the payment and helped nobody — the shopkeeper still
                    hunted for it in WhatsApp and typed it in by hand. */}
                <div className={`field${fieldErrors.upiId ? ' has-error' : ''}`}>
                  <label>{t('supplier.upiId')}</label>
                  <input value={form.upiId} onChange={update('upiId')} placeholder="name@okaxis" />
                  {fieldErrors.upiId ? (
                    <span className="field-error-text">{fieldErrors.upiId}</span>
                  ) : (
                    <p className="field-hint">{t('supplier.upiIdHint')}</p>
                  )}
                </div>
                <div className="field">
                  <label>{t('supplier.paymentTerm')}</label>
                  <input type="number" min="0" max="365" value={form.paymentTermDays} onChange={update('paymentTermDays')} placeholder="30" />
                </div>
                {!editingId && (
                  <div className={`field${fieldErrors.openingBalance ? ' has-error' : ''}`}>
                    <label>{t('supplier.openingBalance')}</label>
                    <input type="number" min="0" step="0.01" value={form.openingBalance} onChange={update('openingBalance')} />
                    {fieldErrors.openingBalance ? (
                      <span className="field-error-text">{fieldErrors.openingBalance}</span>
                    ) : (
                      <p className="field-hint">{t('supplier.openingBalanceHint')}</p>
                    )}
                  </div>
                )}
                <div className="field">
                  <label>{t('expenses.note')}</label>
                  <input value={form.notes} onChange={update('notes')} placeholder={t('supplier.notesPlaceholder')} />
                </div>
              </div>
              {phoneDuplicate && (
                <div className="info-banner" style={{ marginTop: '0.9rem', marginBottom: 0 }}>
                  <strong>{t('supplier.duplicatePhoneTitle')}</strong>
                  <p style={{ margin: '0.35rem 0 0' }}>
                    {t('supplier.duplicatePhoneBody', {
                      name: phoneDuplicate.name,
                      amount: formatRupees(phoneDuplicate.balance, lang),
                    })}
                  </p>
                  <div className="row-actions" style={{ marginTop: '0.6rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small btn-inline"
                      disabled={submitting}
                      onClick={(e) => handleSubmit(e, true)}
                    >
                      {t('supplier.duplicatePhoneSaveAnyway')}
                    </button>
                    <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={closeForm}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}
        </Modal>
      )}

      {mergeGroup && (
        <Modal
          onClose={() => setMergeGroup(null)}
          title={t('supplier.mergeTitle')}
          hint={mergeGroup.phoneDisplay}
          maxWidth={540}
          footer={
            <>
              <button type="button" className="btn btn-primary btn-inline" disabled={submitting || !mergeKeepId} onClick={submitMerge}>
                <SwapIcon size={17} /> {submitting ? t('common.saving') : t('supplier.mergeConfirm')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setMergeGroup(null)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
            <p className="field-hint" style={{ marginTop: 0 }}>{t('supplier.mergeExplain')}</p>
            <div className="field">
              <label>{t('supplier.mergeKeepLabel')}</label>
              <Dropdown
                value={mergeKeepId}
                onChange={setMergeKeepId}
                options={mergeGroup.suppliers.map((s) => ({
                  value: String(s.id),
                  label: `${s.name}${s.company ? ` (${s.company})` : ''} — ${s.orderCount} order, ${formatRupees(s.balance, lang)}`,
                }))}
              />
              <p className="field-hint">{t('supplier.mergeKeepHint')}</p>
            </div>
            {/* Stated before the button, not after: this deletes records and moves money,
                and the count of what is about to move is the only honest preview of it. */}
            <div className="info-banner">
              {t('supplier.mergeWarning', {
                count: mergeGroup.suppliers.length - 1,
                orders: mergeGroup.suppliers
                  .filter((s) => String(s.id) !== mergeKeepId)
                  .reduce((sum, s) => sum + s.orderCount, 0),
              })}
            </div>
        </Modal>
      )}

      {payingSupplier && (
        <Modal
          as="form"
          onSubmit={submitPayment}
          onClose={() => setPayingSupplier(null)}
          title={payingSupplier.name}
          hint={`${t('seller.totalPayable')}: ${formatRupees(payingSupplier.balance, lang)}`}
          maxWidth={400}
          footer={
            <button type="submit" className="btn btn-primary btn-inline" disabled={submitting}>
              <RupeeIcon size={17} /> {submitting ? t('common.saving') : t('seller.recordSupplierPayment')}
            </button>
          }
        >
            <div className="field">
              <label>{t('seller.supplierPaymentAmount')}</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={payment.amount}
                onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label>{t('seller.paymentMode')}</label>
              <Dropdown
                value={payment.mode}
                onChange={(v) => setPayment((p) => ({ ...p, mode: v }))}
                options={['cash', 'upi', 'card', 'bank'].map((m) => ({ value: m, label: t(`expenses.mode.${m}`) }))}
              />
            </div>
            <div className="field">
              <label>{t('expenses.note')}</label>
              <input value={payment.note} onChange={(e) => setPayment((p) => ({ ...p, note: e.target.value }))} />
            </div>
            <p className="field-hint">{t('supplier.allocationHint')}</p>
        </Modal>
      )}
    </>
  );
}
