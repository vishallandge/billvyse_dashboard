'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch, downloadFile } from '../../../lib/api';
import { formatRupees, formatDate, toDateInput } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { apiErrorMessage } from '../../../lib/apiErrors';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import DateRangeFilter, { DEFAULT_RANGE, rangeToQuery } from '../../components/DateRangeFilter';
import AnimatedNumber from '../../components/AnimatedNumber';
import { SkeletonStats, SkeletonTable } from '../../components/Skeleton';
import { Pagination, usePagination } from '../../components/Pagination';
import Dropdown from '../../components/Dropdown';
import Modal from '../../components/Modal';
import { useDashboardUser } from '../../components/DashboardShell';
import { gstRateOptions } from '../../../lib/catalog';
import {
  PlusIcon,
  XIcon,
  EditIcon,
  TrashIcon,
  TrendUpIcon,
  TrendDownIcon,
  SearchIcon,
  ExcelIcon,
  PdfIcon,
} from '../../components/Icons';

const PAYMENT_MODES = ['cash', 'upi', 'card', 'bank'];

// Built-in categories have a translation; the ones a shop invents are stored as plain
// text, so the raw name is the label. translate() hands back the lookup path when a key is
// missing, which is exactly the signal that this is a shop's own category.
function categoryLabel(t, category) {
  const label = t(`expenses.category.${category}`);
  return label === `expenses.category.${category}` ? category : label;
}

function emptyForm() {
  return {
    type: 'expense',
    category: 'rent',
    amount: '',
    paymentMode: 'cash',
    paidTo: '',
    note: '',
    date: toDateInput(),
    isRecurring: false,
    supplier: '',
    // Input tax credit on the overhead. Blank by default and only asked for once the
    // shopkeeper says there is a tax invoice behind the kharcha — a bijli bill typed in
    // four seconds must stay a four-second job.
    gstRate: 0,
    vendorGstin: '',
    // Only used while the "+ new category" row is open — a category the shop invents is
    // saved as plain text on the entry, never as a separate record to manage.
    customCategory: '',
  };
}

const NEW_CATEGORY = '__new__';

export default function ExpensesPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const user = useDashboardUser();
  // Only a registered shop outside the composition scheme has any input credit to claim.
  // The server enforces the same rule (see expenseTax) — this only decides whether to ask.
  const canClaimItc = Boolean((user?.gstin || '').trim()) && !user?.isComposition;

  const [range, setRange] = useState({ ...DEFAULT_RANGE, preset: 'month' });
  const [filters, setFilters] = useState({ type: '', category: '', paymentMode: '', q: '', supplier: '' });
  const [data, setData] = useState(null);
  const [categories, setCategories] = useState({ expense: [], income: [], custom: [] });
  const [suppliers, setSuppliers] = useState([]);
  const [recurringDue, setRecurringDue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams(rangeToQuery(range));
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString();
  }, [range, filters]);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/seller/expenses?${query}`)
      .then((result) => {
        setData(result);
        setCategories(result.categories);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(load, [load]);

  const loadRecurring = useCallback(() => {
    apiFetch('/api/seller/expenses/recurring-due')
      .then((result) => setRecurringDue(result.due || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadRecurring();
    // Suppliers let a kharcha be tagged to the wholesaler it went to. The list is optional
    // — a shop with the suppliers module switched off still gets the rest of the screen.
    apiFetch('/api/seller/suppliers?status=active')
      .then((result) => setSuppliers(result.suppliers || []))
      .catch(() => {});
  }, [loadRecurring]);

  // A search box that fires on every keystroke would hammer the API on a shop's phone
  // connection; the list catches up a beat after typing stops.
  const [searchDraft, setSearchDraft] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => (f.q === searchDraft ? f : { ...f, q: searchDraft })), 350);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const summary = data?.summary;
  const expenses = data?.expenses || [];
  // The shop's own categories sit alongside the built-in ones in the same picker, so a
  // "mandir chanda" entry is as easy to repeat as rent.
  const activeCategories = useMemo(() => {
    const base = form.type === 'income' ? categories.income : categories.expense;
    return [...(base || []), ...(categories.custom || []).filter((name) => !base?.includes(name))];
  }, [form.type, categories]);
  const biggestCategory = summary?.byCategory?.[0];
  // A year of daily kharcha is thousands of rows — page it rather than painting them all.
  const entryPage = usePagination(expenses, {
    pageSize: 25,
    resetKey: `${query}|${filters.type}|${filters.category}|${filters.paymentMode}|${filters.q}|${filters.supplier}`,
  });

  function update(field) {
    return (event) => {
      const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
      setForm((f) => {
        // Switching expense↔income invalidates the chosen category — reset to that
        // list's first entry rather than saving a category the type doesn't have.
        if (field === 'type') {
          const list = value === 'income' ? categories.income : categories.expense;
          return { ...f, type: value, category: list[0] || 'other' };
        }
        return { ...f, [field]: value };
      });
    };
  }

  // Dropdown hands back a value directly instead of an event.
  function setField(field) {
    return (value) =>
      setForm((f) => {
        if (field === 'type') {
          const list = value === 'income' ? categories.income : categories.expense;
          return { ...f, type: value, category: list[0] || 'other' };
        }
        return { ...f, [field]: value };
      });
  }

  function openAdd(prefill) {
    setForm({ ...emptyForm(), ...(prefill || {}) });
    setEditingId(null);
    setFormOpen(true);
  }

  function openEdit(entry) {
    setForm({
      ...emptyForm(),
      type: entry.type,
      category: entry.category,
      amount: String(entry.amount),
      paymentMode: entry.paymentMode,
      paidTo: entry.paidTo || '',
      note: entry.note || '',
      date: toDateInput(entry.date),
      isRecurring: Boolean(entry.isRecurring),
      supplier: entry.supplier?._id || entry.supplier || '',
      gstRate: entry.gstRate || 0,
      vendorGstin: entry.vendorGstin || '',
    });
    setEditingId(entry._id);
    setFormOpen(true);
  }

  // "Post it" on a recurring reminder opens the form pre-filled with last month's entry,
  // dated today — never saved silently, because a rent that changed or a month the shop
  // was shut must not appear in the books on its own.
  function postRecurring(due) {
    openAdd({
      type: due.type,
      category: due.category,
      amount: String(due.amount),
      paymentMode: due.paymentMode || 'cash',
      paidTo: due.paidTo || '',
      note: due.note || '',
      supplier: due.supplier || '',
      isRecurring: true,
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const category = form.category === NEW_CATEGORY ? form.customCategory.trim() : form.category;
    if (!category) {
      toast.error(t('expenses.categoryRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const body = JSON.stringify({
        type: form.type,
        category,
        amount: Number(form.amount),
        paymentMode: form.paymentMode,
        paidTo: form.paidTo,
        note: form.note,
        date: form.date,
        isRecurring: form.isRecurring,
        supplier: form.supplier || null,
        gstRate: Number(form.gstRate) || 0,
        vendorGstin: form.vendorGstin || '',
      });
      if (editingId) {
        await apiFetch(`/api/seller/expenses/${editingId}`, { method: 'PATCH', body });
        toast.success(t('expenses.updated'));
      } else {
        await apiFetch('/api/seller/expenses', { method: 'POST', body });
        toast.success(form.type === 'income' ? t('expenses.incomeAdded') : t('expenses.added'));
      }
      setFormOpen(false);
      load();
      loadRecurring();
    } catch (err) {
      toast.error(apiErrorMessage(lang, err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(entry) {
    if (!(await confirm({ tone: 'danger', title: t('common.delete'), body: t('expenses.confirmDelete'), confirmLabel: t('common.delete') }))) return;
    try {
      await apiFetch(`/api/seller/expenses/${entry._id}`, { method: 'DELETE' });
      toast.success(t('expenses.deleted'));
      load();
      loadRecurring();
    } catch (err) {
      toast.error(apiErrorMessage(lang, err));
    }
  }

  // Fetched with the session rather than opened as a plain <a href>.
  //
  // The link form only ever worked because the session also existed as a host-only cookie
  // on the same hostname — the moment the API lives on api.x.com and the dashboard on
  // app.x.com the browser stops sending it and every export 401s into a new tab showing
  // raw JSON. It survives on localhost only because cookies ignore the port.
  async function handleExport(format) {
    try {
      await downloadFile(`/api/seller/expenses?${query}&format=${format}`, `kharcha.${format}`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('expenses.title')}</h1>
          <p>{t('expenses.subtitle')}</p>
          <Link href="/seller/daybook" className="nav-link">{t('expenses.openDayBook')} →</Link>
        </div>
        <button type="button" className="btn btn-primary btn-inline" onClick={openAdd}>
          <PlusIcon size={17} />
          {t('expenses.add')}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="filter-bar">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {loading && !data ? (
        <SkeletonStats count={4} />
      ) : (
        <div className="stat-grid">
          <div className="stat-card accent-danger">
            <div className="stat-icon"><TrendDownIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={summary?.totalExpense || 0} /></div>
            <div className="stat-label">{t('expenses.totalExpense')}</div>
          </div>
          <div className="stat-card accent-success">
            <div className="stat-icon"><TrendUpIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={summary?.totalIncome || 0} /></div>
            <div className="stat-label">{t('expenses.totalIncome')}</div>
          </div>
          <div className={`stat-card ${(summary?.net || 0) >= 0 ? 'accent-success' : 'accent-danger'}`}>
            <div className="stat-value">{formatRupees(summary?.net || 0, lang)}</div>
            <div className="stat-label">{t('expenses.net')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ fontSize: 'var(--fs-lg)' }}>
              {biggestCategory ? categoryLabel(t, biggestCategory.category) : '—'}
            </div>
            <div className="stat-label">
              {biggestCategory ? `${t('expenses.biggestSpend')} · ${formatRupees(biggestCategory.total, lang, { decimals: false })}` : t('expenses.biggestSpend')}
            </div>
          </div>
        </div>
      )}

      {recurringDue.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>{t('expenses.recurringDue')}</h2>
            <span className="cell-muted">{t('expenses.recurringDueHint')}</span>
          </div>
          <div className="suggestion-row">
            {recurringDue.map((due) => (
              <button type="button" key={due.id} className="suggestion-chip" onClick={() => postRecurring(due)}>
                <span className="suggestion-name">{categoryLabel(t, due.category)}</span>
                <span className="suggestion-meta">
                  {formatRupees(due.amount, lang, { decimals: false })}
                  {due.paidTo ? ` · ${due.paidTo}` : ''}
                </span>
                <PlusIcon size={14} />
              </button>
            ))}
          </div>
        </div>
      )}

      {summary?.byCategory?.length > 0 && (
        <div className="panel">
          <h2>{t('expenses.breakdown')}</h2>
          <div className="breakdown-list">
            {summary.byCategory.map((row) => {
              const share = summary.totalExpense ? (row.total / summary.totalExpense) * 100 : 0;
              return (
                <button
                  type="button"
                  key={row.category}
                  className={`breakdown-row${filters.category === row.category ? ' active' : ''}`}
                  onClick={() =>
                    setFilters((f) => ({ ...f, category: f.category === row.category ? '' : row.category, type: 'expense' }))
                  }
                >
                  <span className="breakdown-name">{categoryLabel(t, row.category)}</span>
                  <span className="breakdown-track">
                    <span className="breakdown-fill" style={{ width: `${Math.max(share, 2)}%` }} />
                  </span>
                  <span className="breakdown-value">{formatRupees(row.total, lang, { decimals: false })}</span>
                  <span className="breakdown-share">{share.toFixed(0)}%</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>{t('expenses.entries')}</h2>
          <div className="panel-tools">
            <div className="search-box-inline">
              <SearchIcon size={15} />
              <input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder={t('expenses.searchPlaceholder')}
              />
            </div>
            <Dropdown
              className="filter-select"
              value={filters.type}
              onChange={(v) => setFilters((f) => ({ ...f, type: v, category: '' }))}
              options={[
                { value: '', label: t('expenses.allTypes') },
                { value: 'expense', label: t('expenses.typeExpense') },
                { value: 'income', label: t('expenses.typeIncome') },
              ]}
            />
            <Dropdown
              className="filter-select"
              value={filters.paymentMode}
              onChange={(v) => setFilters((f) => ({ ...f, paymentMode: v }))}
              options={[{ value: '', label: t('expenses.allModes') }, ...PAYMENT_MODES.map((mode) => ({ value: mode, label: t(`expenses.mode.${mode}`) }))]}
            />
            {suppliers.length > 0 && (
              <Dropdown
                className="filter-select"
                value={filters.supplier}
                onChange={(v) => setFilters((f) => ({ ...f, supplier: v }))}
                options={[{ value: '', label: t('expenses.allSuppliers') }, ...suppliers.map((s) => ({ value: s._id, label: s.name }))]}
              />
            )}
            <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => handleExport('xlsx')}>
              <ExcelIcon size={17} /> Excel
            </button>
            <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => handleExport('pdf')}>
              <PdfIcon size={17} /> PDF
            </button>
          </div>
        </div>

        {(filters.category || filters.type || filters.paymentMode || filters.q || filters.supplier) && (
          <div className="active-filters">
            {[
              filters.type && { key: 'type', label: t(`expenses.type${filters.type === 'income' ? 'Income' : 'Expense'}`) },
              filters.category && { key: 'category', label: categoryLabel(t, filters.category) },
              filters.paymentMode && { key: 'paymentMode', label: t(`expenses.mode.${filters.paymentMode}`) },
              filters.supplier && { key: 'supplier', label: suppliers.find((s) => s._id === filters.supplier)?.name || '—' },
              filters.q && { key: 'q', label: `"${filters.q}"` },
            ]
              .filter(Boolean)
              .map((chip) => (
                <button
                  type="button"
                  key={chip.key}
                  className="filter-pill"
                  onClick={() => {
                    if (chip.key === 'q') setSearchDraft('');
                    setFilters((f) => ({ ...f, [chip.key]: '' }));
                  }}
                >
                  {chip.label} <XIcon size={12} />
                </button>
              ))}
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setSearchDraft('');
                setFilters({ type: '', category: '', paymentMode: '', q: '', supplier: '' });
              }}
            >
              {t('expenses.clearFilters')}
            </button>
          </div>
        )}

        {loading ? (
          <SkeletonTable rows={5} cols={5} />
        ) : expenses.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="coins" />
            <p>{t('expenses.empty')}</p>
            <button type="button" className="btn btn-primary btn-small btn-inline" onClick={openAdd}>
              <PlusIcon size={15} />
              {t('expenses.add')}
            </button>
          </div>
        ) : (
          <>
            <div className="table-wrap auto-height">
              <table className="data-table" style={{ minWidth: '680px' }}>
                <thead>
                  <tr>
                    <th>{t('expenses.date')}</th>
                    <th>{t('expenses.categoryLabel')}</th>
                    <th>{t('expenses.paidTo')}</th>
                    <th>{t('expenses.modeLabel')}</th>
                    <th className="num">{t('expenses.amount')}</th>
                    <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {entryPage.pageItems.map((entry) => (
                    <tr key={entry._id} className="row-enter">
                      <td className="cell-muted">{formatDate(entry.date, lang)}</td>
                      <td>
                        <div className="cell-stack">
                          <span className={`badge ${entry.type === 'income' ? 'badge-active' : 'badge-pending'}`} style={{ width: 'fit-content' }}>
                            {categoryLabel(t, entry.category)}
                          </span>
                          {entry.note && <span className="cell-sub">{entry.note}</span>}
                          {entry.isRecurring && <span className="cell-sub">{t('expenses.recurring')}</span>}
                        </div>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span>{entry.paidTo || entry.supplier?.name || '—'}</span>
                          {entry.supplier?.name && entry.paidTo && <span className="cell-sub">{entry.supplier.name}</span>}
                        </div>
                      </td>
                      <td className="cell-muted">{t(`expenses.mode.${entry.paymentMode}`)}</td>
                      <td className={`num cell-strong ${entry.type === 'income' ? 'amount-in' : 'amount-out'}`}>
                        {entry.type === 'income' ? '+' : '−'}{formatRupees(entry.amount, lang)}
                      </td>
                      <td className="tight">
                        <div className="row-actions-hover">
                          <button type="button" className="icon-btn" data-tip={t('common.edit')} onClick={() => openEdit(entry)}>
                            <EditIcon size={17} />
                          </button>
                          <button type="button" className="icon-btn danger" data-tip={t('common.delete')} onClick={() => handleDelete(entry)}>
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
              compact
              page={entryPage.page}
              pageCount={entryPage.pageCount}
              pageSize={entryPage.pageSize}
              total={entryPage.total}
              from={entryPage.from}
              to={entryPage.to}
              onPageChange={entryPage.setPage}
              onPageSizeChange={entryPage.setPageSize}
              label={t('expenses.entries')}
            />
          </>
        )}
      </div>

      {formOpen && (
        <Modal
          as="form"
          onSubmit={handleSubmit}
          onClose={() => setFormOpen(false)}
          title={editingId ? t('expenses.editEntry') : t('expenses.add')}
          hint={t('expenses.formHint')}
          maxWidth={560}
          footer={
            <>
              <button type="submit" className="btn btn-primary btn-inline" disabled={submitting}>
                {submitting ? t('common.saving') : editingId ? t('common.saveChanges') : t('common.add')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setFormOpen(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
              <div className="segmented" role="group">
                <button
                  type="button"
                  className={form.type === 'expense' ? 'active' : ''}
                  onClick={() => update('type')({ target: { value: 'expense' } })}
                >
                  <TrendDownIcon size={15} /> {t('expenses.typeExpense')}
                </button>
                <button
                  type="button"
                  className={form.type === 'income' ? 'active' : ''}
                  onClick={() => update('type')({ target: { value: 'income' } })}
                >
                  <TrendUpIcon size={15} /> {t('expenses.typeIncome')}
                </button>
              </div>

              <div className="form-grid">
                <div className="field">
                  <label>{t('expenses.amount')}</label>
                  <input type="number" step="0.01" min="0.01" value={form.amount} onChange={update('amount')} required autoFocus />
                </div>
                <div className="field">
                  <label>{t('expenses.categoryLabel')}</label>
                  <Dropdown
                    value={form.category}
                    onChange={setField('category')}
                    options={[
                      ...activeCategories.map((category) => ({ value: category, label: categoryLabel(t, category) })),
                      { value: NEW_CATEGORY, label: `+ ${t('expenses.newCategory')}` },
                    ]}
                  />
                  {form.category === NEW_CATEGORY && (
                    <input
                      value={form.customCategory}
                      onChange={update('customCategory')}
                      placeholder={t('expenses.newCategoryPlaceholder')}
                      style={{ marginTop: '0.4rem' }}
                      required
                    />
                  )}
                </div>
                <div className="field">
                  <label>{t('expenses.date')}</label>
                  <input type="date" value={form.date} onChange={update('date')} max={toDateInput()} />
                </div>
                <div className="field">
                  <label>{t('expenses.modeLabel')}</label>
                  <Dropdown
                    value={form.paymentMode}
                    onChange={setField('paymentMode')}
                    options={PAYMENT_MODES.map((mode) => ({ value: mode, label: t(`expenses.mode.${mode}`) }))}
                  />
                </div>
                <div className="field">
                  <label>{t('expenses.paidTo')}</label>
                  <input value={form.paidTo} onChange={update('paidTo')} placeholder={t('expenses.paidToPlaceholder')} />
                </div>
                {suppliers.length > 0 && (
                  <div className="field">
                    <label>{t('expenses.linkSupplier')}</label>
                    <Dropdown
                      value={form.supplier}
                      onChange={setField('supplier')}
                      options={[{ value: '', label: t('expenses.noSupplier') }, ...suppliers.map((s) => ({ value: s._id, label: s.name }))]}
                    />
                    <p className="field-hint">{t('expenses.linkSupplierHint')}</p>
                  </div>
                )}
                <div className="field">
                  <label>{t('expenses.note')}</label>
                  <input value={form.note} onChange={update('note')} />
                </div>
                {/* Input tax credit on an overhead. Only shown to a registered shop that is
                    not on the composition scheme — nobody else can claim it, and offering
                    the field to them would be an invitation to record a credit that does
                    not exist. Never shown on an income row: money coming in is not a
                    purchase. */}
                {canClaimItc && form.type !== 'income' && (
                  <>
                    <div className="field">
                      <label>{t('expenses.gstRate')}</label>
                      <Dropdown value={String(form.gstRate || 0)} onChange={setField('gstRate')} options={gstRateOptions(form.gstRate)} />
                      <p className="field-hint">{t('expenses.gstRateHint')}</p>
                    </div>
                    {Number(form.gstRate) > 0 && (
                      <div className="field">
                        <label>{t('expenses.vendorGstin')}</label>
                        <input
                          value={form.vendorGstin}
                          onChange={(e) => setForm((f) => ({ ...f, vendorGstin: e.target.value.toUpperCase() }))}
                          placeholder="27ABCDE1234F1Z5"
                          maxLength={15}
                        />
                        <p className="field-hint">{t('expenses.vendorGstinHint')}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
              {/* Shown as it is typed, because "₹2,400 mein se ₹366 wapas milega" is the
                  whole reason a shopkeeper would bother filling these two fields at all. */}
              {canClaimItc && form.type !== 'income' && Number(form.gstRate) > 0 && Number(form.amount) > 0 && (
                <p className="field-hint" style={{ color: 'var(--text-success)' }}>
                  {t('expenses.itcPreview', {
                    amount: formatRupees(
                      Number(form.amount) - Number(form.amount) / (1 + Number(form.gstRate) / 100)
                    ),
                  })}
                </p>
              )}

              <label className="checkbox-row">
                <input type="checkbox" checked={form.isRecurring} onChange={update('isRecurring')} />
                <span>{t('expenses.recurring')}</span>
              </label>
              <p className="field-hint">{t('expenses.recurringHint')}</p>

        </Modal>
      )}
    </>
  );
}
