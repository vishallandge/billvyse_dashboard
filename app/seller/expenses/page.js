'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch, downloadFile } from '../../../lib/api';
import { formatRupees, formatMoney, formatCompactRupees, formatDate, toDateInput } from '../../../lib/format';
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
  StoreIcon,
  UsersIcon,
  ZapIcon,
  TruckIcon,
  PackageIcon,
  KitchenIcon,
  ToolboxIcon,
  MegaphoneIcon,
  CreditCardIcon,
  ReceiptIcon,
  BoxIcon,
  TagIcon,
  RepeatIcon,
  HandCoinsIcon,
  RupeeIcon,
  WalletIcon,
  RefreshIcon,
} from '../../components/Icons';

const PAYMENT_MODES = ['cash', 'upi', 'card', 'bank'];

// A picture for every built-in category, so a row is recognised before it is read — a
// shopkeeper scanning a month of kharcha finds "bijli" by the bolt, not by the word.
// A category the shop invented gets the plain tag.
const CATEGORY_ICONS = {
  rent: StoreIcon,
  salary: UsersIcon,
  electricity: ZapIcon,
  transport: TruckIcon,
  packaging: PackageIcon,
  teaSnacks: KitchenIcon,
  repair: ToolboxIcon,
  marketing: MegaphoneIcon,
  loanEmi: CreditCardIcon,
  gstTax: ReceiptIcon,
  stockPurchase: BoxIcon,
  other: TagIcon,
  scrapSale: RepeatIcon,
  rentReceived: StoreIcon,
  commission: HandCoinsIcon,
  interest: TrendUpIcon,
};

function CategoryIcon({ category, size = 16 }) {
  const Icon = CATEGORY_ICONS[category] || TagIcon;
  return <Icon size={size} />;
}

// The breakdown names five categories and folds the rest into one grey "everything else".
// More slices than that and the bar stops being readable at a glance, which is its job.
const NAMED_SLICES = 5;

// Built-in categories have a translation; the ones a shop invents are stored as plain
// text, so the raw name is the label. translate() hands back the lookup path when a key is
// missing, which is exactly the signal that this is a shop's own category.
function categoryLabel(t, category) {
  const label = t(`expenses.category.${category}`);
  return label === `expenses.category.${category}` ? category : label;
}

// Which comparison sentence fits the period on screen. "Last month" means the same days of
// it — see previousWindow on the server.
function previousLabel(t, preset) {
  if (preset === 'month') return t('expenses.prevMonth');
  if (preset === 'week') return t('expenses.prevWeek');
  if (preset === 'today') return t('expenses.prevToday');
  if (preset === 'yesterday') return t('expenses.prevYesterday');
  return t('expenses.prevDefault');
}

// "2026-09-29" as a shop-local calendar day, for grouping the list under day headers.
function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function trendLabel(key, bucket, lang) {
  // Keys are calendar days/months, not instants; read them at local noon so no timezone
  // can tip them into the neighbouring day.
  const date = new Date(bucket === 'month' ? `${key}-01T12:00:00` : `${key}T12:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  const locale = lang === 'hi' ? 'hi-IN' : lang === 'mr' ? 'mr-IN' : 'en-IN';
  return date.toLocaleDateString(locale, bucket === 'month' ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' });
}

function entryCountLabel(t, lang, count) {
  return count === 1 ? t('expenses.entryCountOne') : t('expenses.entryCount', { count: formatMoney(count, lang, { decimals: false }) });
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
    // Only used while the "+ new category" tile is open — a category the shop invents is
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
  const preset = data?.range?.preset || range.preset;
  const hasFilters = Boolean(filters.category || filters.type || filters.paymentMode || filters.q || filters.supplier);

  // The shop's own categories sit alongside the built-in ones in the same picker, so a
  // "mandir chanda" entry is as easy to repeat as rent.
  const activeCategories = useMemo(() => {
    const base = form.type === 'income' ? categories.income : categories.expense;
    return [...(base || []), ...(categories.custom || []).filter((name) => !base?.includes(name))];
  }, [form.type, categories]);

  // One colour per category for this period, shared by the stacked bar, its legend rows and
  // the dot on every entry below — so "the blue one" means the same thing all down the page.
  // The biggest five get a colour each; everything smaller is grey.
  const slices = useMemo(() => {
    const rows = summary?.byCategory || [];
    const total = summary?.totalExpense || 0;
    const named = rows.slice(0, NAMED_SLICES).map((row, index) => ({
      ...row,
      color: `var(--viz-${index + 1})`,
      share: total ? (row.total / total) * 100 : 0,
    }));
    const rest = rows.slice(NAMED_SLICES);
    const restTotal = rest.reduce((s, row) => s + row.total, 0);
    return {
      named,
      rest: rest.map((row) => ({ ...row, share: total ? (row.total / total) * 100 : 0 })),
      restTotal,
      restShare: total ? (restTotal / total) * 100 : 0,
    };
  }, [summary]);

  const colorOf = useCallback(
    (category) => slices.named.find((row) => row.category === category)?.color || 'var(--text-faint)',
    [slices]
  );

  // A year of daily kharcha is thousands of rows — page it rather than painting them all.
  const entryPage = usePagination(expenses, {
    pageSize: 25,
    resetKey: `${query}|${filters.type}|${filters.category}|${filters.paymentMode}|${filters.q}|${filters.supplier}`,
  });

  // The page's rows under a header per day — "Aaj", "Kal", then dates — each with that
  // day's total, which is how a shopkeeper already reads a rokad bahi.
  const dayGroups = useMemo(() => {
    const today = dayKey(new Date());
    const yesterday = dayKey(new Date(Date.now() - 86400000));
    const groups = [];
    for (const entry of entryPage.pageItems) {
      const key = dayKey(entry.date);
      let group = groups[groups.length - 1];
      if (!group || group.key !== key) {
        group = {
          key,
          label:
            key === today
              ? `${t('expenses.dayToday')} · ${formatDate(entry.date, lang)}`
              : key === yesterday
                ? `${t('expenses.dayYesterday')} · ${formatDate(entry.date, lang)}`
                : formatDate(entry.date, lang),
          out: 0,
          in: 0,
          entries: [],
        };
        groups.push(group);
      }
      group.entries.push(entry);
      if (entry.type === 'income') group.in += entry.amount;
      else group.out += entry.amount;
    }
    return groups;
  }, [entryPage.pageItems, t, lang]);

  const trend = summary?.trend || [];
  const trendMax = trend.reduce((max, row) => Math.max(max, row.total), 0);
  const trendPeak = trend.reduce((best, row) => (row.total > (best?.total || 0) ? row : best), null);

  // Cash that left the drawer against money that left the bank — the two numbers the day
  // book and the passbook each have to agree with.
  const modeTotals = summary?.byMode || [];
  const cashOut = modeTotals.find((row) => row.mode === 'cash')?.total || 0;
  const otherOut = modeTotals.filter((row) => row.mode !== 'cash').reduce((s, row) => s + row.total, 0);

  const comparison = useMemo(() => {
    const prev = summary?.previous;
    if (!prev) return null;
    const now = summary.totalExpense || 0;
    const label = previousLabel(t, preset);
    if (!prev.totalExpense) {
      return now ? { tone: 'neutral', text: t('expenses.vsNone', { prev: label }) } : null;
    }
    const diff = now - prev.totalExpense;
    // Under 1% either way is noise, not a trend worth a red arrow.
    if (Math.abs(diff) < prev.totalExpense * 0.01) return { tone: 'neutral', text: t('expenses.vsSame', { prev: label }) };
    const amount = formatRupees(Math.abs(diff), lang, { decimals: false });
    return diff > 0
      ? { tone: 'up', text: t('expenses.vsMore', { amount, prev: label }) }
      : { tone: 'down', text: t('expenses.vsLess', { amount, prev: label }) };
  }, [summary, preset, t, lang]);

  // The categories offered as one-tap chips: the ones this shop actually spends on first,
  // then the common built-ins, so a new shop still sees rent/bijli/pagaar on day one.
  const quickCategories = useMemo(() => {
    const used = (summary?.byCategory || []).map((row) => row.category);
    const defaults = ['rent', 'salary', 'electricity', 'teaSnacks', 'transport', 'packaging', 'repair'];
    return [...new Set([...used, ...defaults])].slice(0, 7);
  }, [summary]);

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
    return (value) => setForm((f) => ({ ...f, [field]: value }));
  }

  function openAdd(prefill) {
    // Also bound straight to onClick, where the "prefill" is a click event.
    const fields = prefill && !prefill.nativeEvent && !prefill.target ? prefill : {};
    setForm({ ...emptyForm(), ...fields });
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

  function toggleCategoryFilter(category) {
    setFilters((f) => ({ ...f, category: f.category === category ? '' : category, type: 'expense' }));
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
    if (!(await confirm({ tone: 'danger', title: t('common.delete'), body: `${t('expenses.confirmDelete')} ${t('expenses.deleteMoneyNote', { amount: '₹' + Number(entry.amount || 0).toFixed(2) })}`, confirmLabel: t('common.delete') }))) return;
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

  const topSlice = slices.named[0];
  const net = summary?.net || 0;

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
        <SkeletonStats count={3} />
      ) : (
        <>
          {/* ── 1. How much went out, and is that more or less than usual ── */}
          <section className="panel xp-hero">
            <div className="xp-hero-main">
              <div className="xp-eyebrow">
                <span className="xp-eyebrow-icon"><TrendDownIcon size={15} /></span>
                {t('expenses.heroSpent')}
              </div>
              <div className="xp-hero-figure">
                ₹<AnimatedNumber value={summary?.totalExpense || 0} decimals={false} />
              </div>
              {comparison && (
                <div className={`xp-compare is-${comparison.tone}`}>
                  {comparison.tone === 'up' ? <TrendUpIcon size={14} /> : comparison.tone === 'down' ? <TrendDownIcon size={14} /> : null}
                  {comparison.text}
                </div>
              )}
              <div className="xp-hero-meta">
                {summary?.dailyAverage != null && summary.totalExpense > 0 && (
                  <span>{t('expenses.perDay', { amount: formatRupees(summary.dailyAverage, lang, { decimals: false }) })}</span>
                )}
                <span>{entryCountLabel(t, lang, summary?.entryCount || 0)}</span>
              </div>

              <div className="xp-mini-stats">
                <div className="xp-mini" data-tip={t('expenses.otherIncomeHint')}>
                  <span className="xp-mini-label">{t('expenses.totalIncome')}</span>
                  <span className="xp-mini-value amount-in">+{formatRupees(summary?.totalIncome || 0, lang, { decimals: false })}</span>
                </div>
                <div className="xp-mini" data-tip={t('expenses.netHint')}>
                  <span className="xp-mini-label">{t('expenses.net')}</span>
                  <span className={`xp-mini-value ${net > 0 ? 'amount-in' : net < 0 ? 'amount-out' : ''}`}>
                    {net > 0 ? '+' : ''}{formatRupees(net, lang, { decimals: false })}
                  </span>
                </div>
              </div>
            </div>

            <div className="xp-trend">
              <div className="xp-section-label">{summary?.trendBucket === 'month' ? t('expenses.byMonth') : t('expenses.byDay')}</div>
              {trend.length > 0 && trendMax > 0 ? (
                <>
                  <div className="xp-bars" role="img" aria-label={summary?.trendBucket === 'month' ? t('expenses.byMonth') : t('expenses.byDay')}>
                    {trend.map((row) => (
                      <span
                        key={row.key}
                        className="xp-bar-slot"
                        data-tip={`${trendLabel(row.key, summary.trendBucket, lang)} · ${
                          row.total ? formatRupees(row.total, lang, { decimals: false }) : t('expenses.noSpendDay')
                        }`}
                      >
                        <span
                          className={`xp-bar${row.key === trendPeak?.key ? ' is-peak' : ''}${row.total ? '' : ' is-zero'}`}
                          style={{ height: row.total ? `${Math.max((row.total / trendMax) * 100, 4)}%` : undefined }}
                        />
                      </span>
                    ))}
                  </div>
                  <div className="xp-bars-axis">
                    <span>{trendLabel(trend[0].key, summary.trendBucket, lang)}</span>
                    {trendPeak && (
                      <span className="xp-bars-peak">
                        {t('expenses.peak', {
                          amount: formatCompactRupees(trendPeak.total, lang),
                          date: trendLabel(trendPeak.key, summary.trendBucket, lang),
                        })}
                      </span>
                    )}
                    <span>{trendLabel(trend[trend.length - 1].key, summary.trendBucket, lang)}</span>
                  </div>
                </>
              ) : (
                <p className="xp-trend-empty">{t('expenses.storyEmpty')}</p>
              )}
            </div>
          </section>

          {/* ── 2. Where it went, and how it was paid. Nothing to break down in an empty
              period — the hero already says so, once. ── */}
          {(topSlice || recurringDue.length > 0) && (
          <div className={`xp-grid${topSlice ? '' : ' is-single'}`}>
            {topSlice && (
            <section className="panel xp-where">
              <div className="panel-head">
                <h2>{t('expenses.breakdown')}</h2>
              </div>
                <>
                  <p className="xp-story">
                    {t('expenses.story', {
                      share: formatMoney(Math.round(topSlice.share), lang, { decimals: false }),
                      category: categoryLabel(t, topSlice.category),
                    })}
                  </p>
                  <div className="xp-stack" role="img" aria-label={t('expenses.breakdown')}>
                    {slices.named.map((row) => (
                      <button
                        type="button"
                        key={row.category}
                        className={`xp-stack-seg${filters.category === row.category ? ' active' : ''}`}
                        style={{ flexGrow: row.total, background: row.color }}
                        data-tip={`${categoryLabel(t, row.category)} · ${formatRupees(row.total, lang, { decimals: false })} · ${Math.round(row.share)}%`}
                        onClick={() => toggleCategoryFilter(row.category)}
                      />
                    ))}
                    {slices.restTotal > 0 && (
                      <span
                        className="xp-stack-seg is-rest"
                        style={{ flexGrow: slices.restTotal }}
                        data-tip={`${t('expenses.restLabel')} · ${formatRupees(slices.restTotal, lang, { decimals: false })}`}
                      />
                    )}
                  </div>

                  <div className="xp-cat-list">
                    {[...slices.named, ...slices.rest].map((row) => (
                      <button
                        type="button"
                        key={row.category}
                        className={`xp-cat-row${filters.category === row.category ? ' active' : ''}`}
                        onClick={() => toggleCategoryFilter(row.category)}
                      >
                        <span className="xp-cat-icon" style={{ '--xp-c': colorOf(row.category) }}>
                          <CategoryIcon category={row.category} size={15} />
                        </span>
                        <span className="xp-cat-name">
                          {categoryLabel(t, row.category)}
                          <span className="xp-cat-count">{entryCountLabel(t, lang, row.count)}</span>
                        </span>
                        <span className="xp-cat-track">
                          <span className="xp-cat-fill" style={{ width: `${Math.max(row.share, 2)}%`, background: colorOf(row.category) }} />
                        </span>
                        <span className="xp-cat-value">{formatRupees(row.total, lang, { decimals: false })}</span>
                        <span className="xp-cat-share">{formatMoney(Math.round(row.share), lang, { decimals: false })}%</span>
                      </button>
                    ))}
                  </div>
                  <p className="xp-hint">{t('expenses.tapToFilter')}</p>
                </>
            </section>
            )}

            <div className="xp-side">
              {summary?.totalExpense > 0 && (
                <section className="panel xp-how">
                  <div className="panel-head">
                    <h2>{t('expenses.howPaid')}</h2>
                  </div>
                  {[
                    { key: 'cash', label: t('expenses.cashOut'), value: cashOut, Icon: WalletIcon },
                    { key: 'other', label: t('expenses.otherOut'), value: otherOut, Icon: CreditCardIcon },
                  ].map(({ key, label, value, Icon }) => {
                    const share = summary.totalExpense ? (value / summary.totalExpense) * 100 : 0;
                    return (
                      <div key={key} className="xp-how-row">
                        <span className="xp-how-icon"><Icon size={16} /></span>
                        <div className="xp-how-main">
                          <div className="xp-how-top">
                            <span>{label}</span>
                            <strong>{formatRupees(value, lang, { decimals: false })}</strong>
                          </div>
                          <span className="xp-how-track">
                            <span className={`xp-how-fill is-${key}`} style={{ width: `${share}%` }} />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  <div className="xp-how-modes">
                    {modeTotals
                      .filter((row) => row.total > 0)
                      .map((row) => (
                        <button
                          type="button"
                          key={row.mode}
                          className={`xp-mode-chip${filters.paymentMode === row.mode ? ' active' : ''}`}
                          onClick={() => setFilters((f) => ({ ...f, paymentMode: f.paymentMode === row.mode ? '' : row.mode }))}
                        >
                          {t(`expenses.mode.${row.mode}`)} · {formatCompactRupees(row.total, lang)}
                        </button>
                      ))}
                  </div>
                </section>
              )}

              {recurringDue.length > 0 && (
                <section className="panel xp-due">
                  <div className="panel-head">
                    <h2>
                      <RefreshIcon size={16} />
                      {t('expenses.recurringDue')}
                    </h2>
                  </div>
                  <p className="xp-hint">{t('expenses.recurringDueHint')}</p>
                  <div className="xp-due-list">
                    {recurringDue.map((due) => (
                      <div key={due.id} className="xp-due-row">
                        <span className="xp-cat-icon" style={{ '--xp-c': 'var(--text-warning)' }}>
                          <CategoryIcon category={due.category} size={15} />
                        </span>
                        <span className="xp-due-name">
                          {categoryLabel(t, due.category)}
                          {due.paidTo && <span className="xp-cat-count">{due.paidTo}</span>}
                        </span>
                        <strong className="xp-due-amount">{formatRupees(due.amount, lang, { decimals: false })}</strong>
                        <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => postRecurring(due)}>
                          <PlusIcon size={15} />
                          {t('common.add')}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
          )}
        </>
      )}

      {/* ── 3. The entries themselves ── */}
      <section className="panel xp-entries">
        <div className="xp-quick">
          <div className="xp-quick-head">
            <strong>{t('expenses.quickAdd')}</strong>
            <span>{t('expenses.quickAddHint')}</span>
          </div>
          <div className="xp-quick-row">
            {quickCategories.map((category) => (
              <button
                type="button"
                key={category}
                className="xp-quick-chip"
                onClick={() => openAdd({ type: 'expense', category })}
              >
                <CategoryIcon category={category} size={15} />
                {categoryLabel(t, category)}
              </button>
            ))}
            <button type="button" className="xp-quick-chip is-income" onClick={() => openAdd({ type: 'income', category: categories.income?.[0] || 'other' })}>
              <TrendUpIcon size={15} />
              {t('expenses.typeIncome')}
            </button>
          </div>
        </div>

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

        {hasFilters && (
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
            {summary?.filtered && (
              <span className="xp-filtered-total">
                {t('expenses.showing', {
                  entries: entryCountLabel(t, lang, summary.filtered.count),
                  amount: formatRupees(summary.filtered.expense, lang, { decimals: false }),
                })}
                {summary.filtered.income > 0 &&
                  t('expenses.showingIn', { amount: formatRupees(summary.filtered.income, lang, { decimals: false }) })}
              </span>
            )}
          </div>
        )}

        {loading ? (
          <SkeletonTable rows={5} cols={4} />
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
            <div className="xp-days">
              {dayGroups.map((group) => (
                <div key={group.key} className="xp-day">
                  <div className="xp-day-head">
                    <span>{group.label}</span>
                    <span className="xp-day-total">
                      {group.in > 0 && <span className="amount-in">+{formatRupees(group.in, lang, { decimals: false })}</span>}
                      {group.out > 0 && <span className="amount-out">−{formatRupees(group.out, lang, { decimals: false })}</span>}
                    </span>
                  </div>
                  {group.entries.map((entry) => {
                    const income = entry.type === 'income';
                    const who = entry.paidTo || entry.supplier?.name;
                    const sub = [who, entry.supplier?.name && entry.paidTo ? entry.supplier.name : null, entry.note].filter(Boolean);
                    return (
                      <div key={entry._id} className="xp-entry row-enter">
                        <span className="xp-cat-icon" style={{ '--xp-c': income ? 'var(--text-success)' : colorOf(entry.category) }}>
                          <CategoryIcon category={entry.category} size={16} />
                        </span>
                        <div className="xp-entry-main">
                          <span className="xp-entry-title">
                            {categoryLabel(t, entry.category)}
                            {entry.isRecurring && (
                              <span className="xp-entry-tag" data-tip={t('expenses.recurring')}>
                                <RefreshIcon size={11} />
                              </span>
                            )}
                          </span>
                          {sub.length > 0 && <span className="xp-entry-sub">{sub.join(' · ')}</span>}
                        </div>
                        <span className="xp-entry-mode">{t(`expenses.mode.${entry.paymentMode}`)}</span>
                        <span className={`xp-entry-amount ${income ? 'amount-in' : 'amount-out'}`}>
                          {income ? '+' : '−'}{formatRupees(entry.amount, lang)}
                        </span>
                        <div className="xp-entry-actions">
                          <button type="button" className="icon-btn" data-tip={t('common.edit')} onClick={() => openEdit(entry)}>
                            <EditIcon size={17} />
                          </button>
                          <button type="button" className="icon-btn danger" data-tip={t('common.delete')} onClick={() => handleDelete(entry)}>
                            <TrashIcon size={17} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
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
      </section>

      {formOpen && (
        <Modal
          as="form"
          onSubmit={handleSubmit}
          onClose={() => setFormOpen(false)}
          title={editingId ? t('expenses.editEntry') : t('expenses.add')}
          hint={t('expenses.formHint')}
          maxWidth={600}
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

          {/* The amount first and large: it is the one thing every entry needs, and the
              number a shopkeeper has in their head when they open this. */}
          <div className="field xp-amount-field">
            <label>{t('expenses.amount')}</label>
            <div className={`xp-amount-input is-${form.type}`}>
              <RupeeIcon size={20} />
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={form.amount}
                onChange={update('amount')}
                placeholder="0"
                required
                autoFocus
              />
            </div>
          </div>

          <div className="field">
            <label>{t('expenses.whatFor')}</label>
            <div className="xp-cat-grid" role="radiogroup">
              {activeCategories.map((category) => (
                <button
                  type="button"
                  key={category}
                  role="radio"
                  aria-checked={form.category === category}
                  className={`xp-cat-tile${form.category === category ? ' active' : ''}`}
                  onClick={() => setField('category')(category)}
                >
                  <CategoryIcon category={category} size={18} />
                  <span>{categoryLabel(t, category)}</span>
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={form.category === NEW_CATEGORY}
                className={`xp-cat-tile is-new${form.category === NEW_CATEGORY ? ' active' : ''}`}
                onClick={() => setField('category')(NEW_CATEGORY)}
              >
                <PlusIcon size={18} />
                <span>{t('expenses.newCategory')}</span>
              </button>
            </div>
            {form.category === NEW_CATEGORY && (
              <input
                value={form.customCategory}
                onChange={update('customCategory')}
                placeholder={t('expenses.newCategoryPlaceholder')}
                style={{ marginTop: '0.5rem' }}
                required
                autoFocus
              />
            )}
          </div>

          <div className="field">
            <label>{form.type === 'income' ? t('expenses.receivedVia') : t('expenses.paidVia')}</label>
            <div className="segmented segmented-sm xp-mode-picker" role="group">
              {PAYMENT_MODES.map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={form.paymentMode === mode ? 'active' : ''}
                  onClick={() => setField('paymentMode')(mode)}
                >
                  {t(`expenses.mode.${mode}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="form-grid">
            <div className="field">
              <label>{t('expenses.date')}</label>
              <input type="date" value={form.date} onChange={update('date')} max={toDateInput()} />
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
              whole reason a shopkeeper would bother filling these two fields at all.
              formatMoney, not formatRupees: the sentence already carries the ₹. */}
          {canClaimItc && form.type !== 'income' && Number(form.gstRate) > 0 && Number(form.amount) > 0 && (
            <p className="field-hint" style={{ color: 'var(--text-success)' }}>
              {t('expenses.itcPreview', {
                amount: formatMoney(Number(form.amount) - Number(form.amount) / (1 + Number(form.gstRate) / 100), lang),
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
