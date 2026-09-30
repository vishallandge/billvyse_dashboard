'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, downloadFile } from '../../../lib/api';
import { useDashboardUser, useDashboardStores, useHiddenNav } from '../../components/DashboardShell';
import { formatRupees, formatQty, formatCompactRupees } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { SkeletonTable } from '../../components/Skeleton';
import TrendChart from '../../components/TrendChart';
import Dropdown from '../../components/Dropdown';
import DateRangeFilter, { rangeToQuery } from '../../components/DateRangeFilter';
import { Pagination, usePagination } from '../../components/Pagination';
import { SortHeader, useSort } from '../../components/DataTable';
import {
  PdfIcon,
  ExcelIcon,
  RefreshIcon,
  BarChartIcon,
  CalendarIcon,
  SearchIcon,
  RupeeIcon,
} from '../../components/Icons';
import Illustration from '../../components/Illustration';

/**
 * WHICH REPORTS GET A CHART
 *
 * A report is one of two things. A REGISTER is looked up — the daily sales list, GSTR-1
 * Table 4, the udhaar book — and a chart of it is decoration: nobody asks "what shape is my
 * invoice register". A COMPARISON is read all at once — which hour, which counter, which
 * category, which week — and a table of twenty rows hides the very answer it contains,
 * because ranking twenty numbers by eye is work and reading one bar chart is not.
 *
 * So: comparisons get a chart, registers do not. `top` caps a long comparison at the rows
 * that matter — a bar chart with sixty categories on its axis is a table again.
 */
const CHART_CONFIG = {
  'sales-trend': { type: 'line', x: 'bucket', y: 'sales', money: true },
  'peak-hours': { type: 'bar', x: 'hourLabel', y: 'billCount', money: false, sortBy: 'hourLabel', shortX: 5 },
  'profit-by-category': { type: 'bar', x: 'category', y: 'revenue', money: true, top: 10 },
  'counter-wise-sales': { type: 'bar', x: 'counter', y: 'sales', money: true, top: 10 },
  'charges-collected': { type: 'bar', x: 'charge', y: 'amount', money: true, top: 10 },
  'staff-performance': { type: 'bar', x: 'staffName', y: 'sales', money: true, top: 10 },
  'slow-moving-stock': { type: 'bar', x: 'name', y: 'stockValue', money: true, top: 10 },
};

/**
 * The report catalogue.
 *
 * `group` is what turned a flat list of eighteen into something a shopkeeper can read. The
 * picker used to be one unlabelled dropdown eighteen entries long, in the order they
 * happened to be written, so finding "supplier payable" meant reading past the GST returns.
 *
 * `pointInTime` marks the reports a date range means nothing to. Stock valuation, udhaar and
 * supplier payable are all "as things stand right now" — offering a range next to them is a
 * filter that silently does nothing, which is worse than no filter at all.
 *
 * `preset` is the window that report opens on: today's till for daily sales, this month for
 * a GST return, the quarter for CMP-08 (which is a QUARTERLY statement — opening it on today
 * would show a shopkeeper a tax figure that is a ninetieth of what they owe).
 */
const REPORT_TYPES = [
  // ---- Sales: what went over the counter ----
  { key: 'daily-sales', group: 'sales', labelKey: 'seller.reportDailySales', preset: 'today' },
  { key: 'sales-trend', group: 'sales', labelKey: 'seller.reportSalesTrend', preset: 'quarter', option: 'period' },
  { key: 'peak-hours', group: 'sales', labelKey: 'seller.reportPeakHours', preset: 'last7' },
  // A report is only worth listing if the shop has the thing it reports ON. A one-counter
  // kirana asking for "counter-wise sales" gets one row that says what it already knew, and a
  // shop with no staff gets an empty table — both read as the app not knowing whose shop it
  // is. `needsNav` ties each one to the screen it belongs to, so it disappears for exactly
  // the shops whose menu does not carry that screen either (trade default, plan, or the
  // owner's own choice in Settings → Screens) and comes back the moment that changes.
  { key: 'counter-wise-sales', group: 'sales', labelKey: 'seller.reportCounterWise', preset: 'today', needsNav: 'counters' },
  { key: 'customer-purchase-pattern', group: 'sales', labelKey: 'seller.reportPurchasePattern', preset: 'last30' },
  // Packing, delivery, section charges, labour — everything billed on top of the goods. Not
  // tied to a trade: a hardware shop's tempo bhaada is the same kind of line as a dhaba's
  // parcel charge, and the server only ever lists charges a shop actually billed.
  { key: 'charges-collected', group: 'sales', labelKey: 'seller.reportChargesCollected', preset: 'month' },

  // ---- Profit ----
  { key: 'monthly-profit', group: 'profit', labelKey: 'seller.reportMonthlyProfit', preset: 'month' },
  { key: 'profit-by-category', group: 'profit', labelKey: 'seller.reportProfitByCategory', preset: 'month' },

  // ---- Stock ----
  { key: 'stock-valuation', group: 'stock', labelKey: 'seller.reportStockValuation', pointInTime: true },
  { key: 'slow-moving-stock', group: 'stock', labelKey: 'seller.reportSlowMoving', pointInTime: true, option: 'days' },
  // Damage, theft, self-use and counted corrections. The app has always recorded these and
  // never had anywhere to show them over a period — which is both a number that changes how
  // a shopkeeper buys and, for the CA, the evidence behind stock written off.
  { key: 'stock-adjustments', group: 'stock', labelKey: 'seller.reportStockAdjustments', preset: 'month' },

  // ---- Money in, money out ----
  { key: 'customer-udhaar', group: 'money', labelKey: 'seller.reportCustomerUdhaar', pointInTime: true },
  // Both of these had been built on the server and simply never listed here, so the two
  // questions a shop with suppliers asks most — "kis supplier ka kitna baaki hai" and the
  // purchase register a CA wants for ITC — were unreachable from the UI.
  { key: 'supplier-payable', group: 'money', labelKey: 'seller.reportSupplierPayable', pointInTime: true, needsNav: 'suppliers' },
  // Owed is one question, how long it has been owed is another — and the second is the one
  // a CA asks and the one that decides who gets paid on Monday. The customer side of the
  // shop has had this schedule since day one; the supply side never did.
  { key: 'supplier-aging', group: 'money', labelKey: 'seller.reportSupplierAging', pointInTime: true, needsNav: 'suppliers' },
  // Money that actually moved, tender by tender — the one report a bank passbook can be
  // reconciled against, and the question a CA opens the month with.
  { key: 'cash-bank-book', group: 'money', labelKey: 'seller.reportCashBankBook', preset: 'month' },

  // ---- People ----
  { key: 'staff-performance', group: 'staff', labelKey: 'seller.reportStaffPerformance', preset: 'month', needsNav: 'staff' },

  // A shop that hasn't registered for GST charges none, files none, and has no use for
  // these — the rest of the app already hides tax on that basis (see the Boolean(gstin)
  // gate in billController), so the reports list has to agree. Offering a kirana "GSTR-1"
  // is both noise and a promise the report can't keep.
  //
  // `regularOnly` marks the ones a composition dealer must never be shown: they file
  // CMP-08 *instead of* GSTR-1 and 3B, collect no tax and claim no input credit, so those
  // reports would all read zero and invite them to file a return they are not registered
  // for. `compositionOnly` is the mirror — CMP-08 means nothing to anyone else.
  { key: 'gstr1', group: 'gst', labelKey: 'seller.reportGstr1', preset: 'month', needsGstin: true, regularOnly: true },
  { key: 'gstr1-hsn', group: 'gst', labelKey: 'seller.reportGstr1Hsn', preset: 'month', needsGstin: true, regularOnly: true },
  { key: 'gstr1-b2b', group: 'gst', labelKey: 'seller.reportGstr1B2b', preset: 'month', needsGstin: true, regularOnly: true },
  { key: 'gstr1-b2cl', group: 'gst', labelKey: 'seller.reportGstr1B2cl', preset: 'month', needsGstin: true, regularOnly: true },
  { key: 'gstr3b', group: 'gst', labelKey: 'seller.reportGstr3b', preset: 'month', needsGstin: true, regularOnly: true },
  { key: 'cmp08', group: 'gst', labelKey: 'seller.reportCmp08', preset: 'quarter', needsGstin: true, compositionOnly: true },
  { key: 'purchase-register', group: 'gst', labelKey: 'seller.reportPurchaseRegister', preset: 'month', needsGstin: true, regularOnly: true },
  { key: 'debit-note-register', group: 'gst', labelKey: 'seller.reportDebitNoteRegister', preset: 'month', needsGstin: true, regularOnly: true, needsNav: 'suppliers' },
];

const GROUP_ORDER = [
  { key: 'sales', labelKey: 'seller.reportGroupSales' },
  { key: 'profit', labelKey: 'seller.reportGroupProfit' },
  { key: 'stock', labelKey: 'seller.reportGroupStock' },
  { key: 'money', labelKey: 'seller.reportGroupMoney' },
  { key: 'staff', labelKey: 'seller.reportGroupStaff' },
  { key: 'gst', labelKey: 'seller.reportGroupGst' },
];

// GSTIN lives on the shop, not the store (see backend/models/User.js) — a per-store GSTR
// wouldn't correspond to anything actually filed, so these never take a store filter.
const SHOP_WIDE_ONLY_REPORTS = [
  'gstr1', 'gstr1-hsn', 'gstr1-b2b', 'gstr1-b2cl', 'gstr3b', 'cmp08', 'purchase-register', 'supplier-aging',
];

// Reports open on their own natural window, so the strip only offers what makes sense: a
// daily register wants "today", a GST return wants a month or a quarter, nobody files a
// return for "last 7 days". `all` is deliberately absent — every report here is either a
// period or a snapshot, and "all time GSTR-1" is not a document.
const REPORT_PRESETS = ['today', 'yesterday', 'last7', 'last30', 'month', 'lastMonth', 'quarter', 'fy'];

/**
 * The reports a BRANCH MANAGER can actually run.
 *
 * Everything on this list is Bill-based, so it means something for one branch. Everything off
 * it is either the business's GST filing (one GSTIN, no branch owns it) or a book with no
 * branch at all — customer udhaar and supplier payable are owed to the SHOP, so a "branch
 * version" would just be the whole shop's ledger handed to one manager.
 *
 * Mirrors `branchOrOwner` in backend/routes/reportRoutes.js, which is what actually refuses
 * them. This list only keeps a manager from picking a report that would answer 403 — the
 * server is the gate, this is the manners.
 */
// A manager answers for their own branch's shelf and their own branch's drawer, so
// `stock-adjustments` and `cash-bank-book` are theirs too. Neither touches a party balance,
// which is the line the rest of this list is drawn on.
//
// Kept as bare quoted strings with no comments between them: reports.test.js reads this
// array out of the source to check it against the routes, and a comma inside a comment
// here makes the screen look like it offers a report the server answers 403 to.
const BRANCH_MANAGER_REPORTS = [
  'daily-sales', 'monthly-profit', 'stock-valuation', 'sales-trend', 'profit-by-category',
  'slow-moving-stock', 'peak-hours', 'counter-wise-sales', 'staff-performance',
  'stock-adjustments', 'cash-bank-book', 'charges-collected',
];

const EMPTY = [];
const TREND_PERIODS = ['daily', 'weekly', 'monthly'];
const SLOW_DAYS = [30, 60, 90, 180];

export default function ReportsPage() {
  const user = useDashboardUser();
  const { stores } = useDashboardStores();
  // The same list the sidebar hides links from, so the reports list and the menu can never
  // disagree about which parts of the app this shop uses.
  const hiddenNav = useHiddenNav();
  const { t, lang } = useLanguage();

  const [reportType, setReportType] = useState('daily-sales');
  const [range, setRange] = useState({ preset: 'today', from: '', to: '' });
  const [storeId, setStoreId] = useState('');
  const [period, setPeriod] = useState('weekly');
  const [slowDays, setSlowDays] = useState(30);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState('');

  // An unregistered shop is never offered the GST reports it cannot file, and no shop is
  // offered a report about a screen it does not have.
  const isComposition = Boolean(user?.gstin) && Boolean(user?.isComposition);
  // A staff login on this screen is a branch manager — nobody else can reach it.
  const branchManager = user?.role === 'staff';

  const visibleReports = useMemo(
    () =>
      REPORT_TYPES.filter((r) => {
        if (branchManager && !BRANCH_MANAGER_REPORTS.includes(r.key)) return false;
        if (r.needsGstin && !user?.gstin) return false;
        if (r.regularOnly && isComposition) return false;
        if (r.compositionOnly && !isComposition) return false;
        if (r.needsNav && hiddenNav.includes(r.needsNav)) return false;
        return true;
      }),
    [branchManager, user?.gstin, isComposition, hiddenNav]
  );

  const report = visibleReports.find((r) => r.key === reportType) || visibleReports[0] || REPORT_TYPES[0];
  const storeFilterUsable = stores.length > 1 && !SHOP_WIDE_ONLY_REPORTS.includes(report.key);

  // Never leave the picker sitting on a report that has just been filtered away — the page
  // would keep fetching a report the shop cannot see any option for.
  useEffect(() => {
    if (visibleReports.length > 0 && !visibleReports.some((r) => r.key === reportType)) {
      setReportType(visibleReports[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleReports]);

  /* ------------------------------------------------------------------ the query */

  // Each report opens on the window it is actually read in — today's till for the daily
  // register, the quarter for CMP-08. Picking a report therefore moves the date strip with
  // it, rather than running a quarterly tax statement over "today" and showing a shopkeeper
  // a ninetieth of what they owe.
  function pickReport(key) {
    setReportType(key);
    const next = REPORT_TYPES.find((r) => r.key === key);
    if (next?.preset) setRange({ preset: next.preset, from: '', to: '' });
  }

  const query = useMemo(() => {
    const params = new URLSearchParams(report.pointInTime ? '' : rangeToQuery(range));
    if (storeFilterUsable && storeId) params.set('storeId', storeId);
    if (report.option === 'period') params.set('period', period);
    if (report.option === 'days') params.set('days', String(slowDays));
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [report, range, storeId, storeFilterUsable, period, slowDays]);

  // A stale answer overwriting a fresh one is the classic filter bug: change the range
  // twice quickly and the slower first request lands last. Every fetch carries a ticket and
  // only the newest one is allowed to write.
  const ticket = useRef(0);
  // Refresh re-runs the same fetch with the same arguments, so it needs a dependency that
  // changed. One counter is cheaper and less error-prone than a second copy of the call.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const mine = ticket.current + 1;
    ticket.current = mine;
    setLoading(true);
    setError('');
    apiFetch(`/api/seller/reports/${report.key}${query}`)
      .then((payload) => {
        if (ticket.current !== mine) return;
        setData(payload);
      })
      .catch((err) => {
        if (ticket.current !== mine) return;
        setError(err.message);
        setData(null);
      })
      .finally(() => {
        if (ticket.current === mine) setLoading(false);
      });
  }, [report.key, query, nonce]);

  /* ------------------------------------------------------------------ the shape */

  // One shared empty array rather than a fresh `[]` each render: these feed the column,
  // sort-accessor and pagination memos, and a new identity every render would rebuild all
  // three on every keystroke elsewhere on the page.
  const rows = data?.rows || EMPTY;
  const summaryRows = data?.summaryRows || EMPTY;

  /**
   * Columns come from the server, labels and all.
   *
   * They always did — every report builds `{ key, label, type }` for its PDF and its Excel
   * sheet — but the JSON branch used to drop them, so the screen fell back to
   * `Object.keys(rows[0])` and a shopkeeper read "billNumber", "netSales", "gstAmount" and
   * "hourLabel" as column headings while the PDF of the same report said "Bill #", "Net
   * Sales", "GST" and "Hour". The fallback is kept for the one case that can still happen:
   * a browser holding an older cached response.
   */
  const columns = useMemo(() => {
    if (data?.columns?.length) return data.columns;
    const source = rows[0] || summaryRows[0];
    return source ? Object.keys(source).map((key) => ({ key, label: key })) : [];
  }, [data, rows, summaryRows]);

  const isNum = (col) => col.type === 'money' || col.type === 'number';

  // The server formats for arithmetic ("1234.00"); the screen formats for reading
  // (₹1,234.00, grouped the Indian way, in the shop's own numerals). A summary row puts
  // words in a numeric column on purpose ("6 staff", "120 slow items"), so anything that is
  // not a number falls through untouched rather than being coerced into one.
  function cell(col, raw) {
    if (raw === null || raw === undefined || raw === '') return '';
    if (isNum(col)) {
      const n = Number(raw);
      if (Number.isFinite(n)) {
        return col.type === 'money' ? formatRupees(n, lang) : formatQty(n, lang);
      }
    }
    return String(raw);
  }

  // Sorting has to happen on the VALUE, not on the printed string: "9.00" sorts above
  // "1234.00" as text. Numeric columns hand the sorter a real number.
  const sortAccessors = useMemo(
    () =>
      Object.fromEntries(
        columns.map((col) => [
          col.key,
          (row) => {
            const raw = row[col.key];
            if (isNum(col)) {
              const n = Number(raw);
              if (Number.isFinite(n)) return n;
            }
            return raw;
          },
        ])
      ),
    [columns]
  );

  const { sorted, sort, toggle } = useSort(rows, sortAccessors);
  const page = usePagination(sorted, { pageSize: 25, resetKey: `${report.key}|${query}` });

  /**
   * The answer, above the table that contains it.
   *
   * Every report ends in a TOTAL row, and with 25 rows to a page that row was often four
   * pages away from the shopkeeper who opened the report to read exactly it. The money
   * columns of the last summary row become the cards at the top — "last" because the
   * purchase register's footer is three rows deep (purchases, less returns, net) and the
   * net is the one a CA carries to the return.
   */
  const kpis = useMemo(() => {
    const totalRow = summaryRows[summaryRows.length - 1];
    if (!totalRow) return [];
    return columns
      .filter((col) => col.type === 'money')
      .map((col) => ({ label: col.label, value: totalRow[col.key] }))
      .filter((k) => k.value !== '' && k.value !== null && k.value !== undefined && Number.isFinite(Number(k.value)))
      .slice(0, 4);
  }, [columns, summaryRows]);

  const chartConfig = CHART_CONFIG[report.key];
  const chartData = useMemo(() => {
    if (!chartConfig || rows.length === 0) return null;
    let source = rows;
    if (chartConfig.sortBy) {
      source = [...rows].sort((a, b) => String(a[chartConfig.sortBy]).localeCompare(String(b[chartConfig.sortBy])));
    }
    if (chartConfig.top) source = source.slice(0, chartConfig.top);
    return source
      .map((row) => ({
        x: chartConfig.shortX ? String(row[chartConfig.x]).slice(0, chartConfig.shortX) : String(row[chartConfig.x] ?? ''),
        y: Number(row[chartConfig.y]) || 0,
      }))
      // A chart of nothing but zeros is a flat line that says the report failed. It has not
      // — the rows are simply all zero, and the table says so honestly.
      .filter((point) => Number.isFinite(point.y));
  }, [chartConfig, rows]);

  const chartHasValue = chartData && chartData.some((point) => point.y > 0);

  /* ------------------------------------------------------------------ downloads */

  // Fetched with the auth header rather than opened as a plain link — a link relies on
  // the session cookie reaching the API host, which stops happening as soon as the API
  // sits on a different hostname than the dashboard.
  async function handleDownload(format) {
    setError('');
    setDownloading(format);
    try {
      const separator = query ? '&' : '?';
      await downloadFile(
        `/api/seller/reports/${report.key}${query}${separator}format=${format}`,
        `${report.key}.${format}`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading('');
    }
  }

  const busy = downloading !== '';
  const hasRows = rows.length > 0;

  return (
    <>
      <div className="content-header">
        {/* The report on screen goes into the breadcrumb — "Reports › Daily sales" — since
            the picker that names it scrolls away with the page (PageTrail.js). */}
        <h1 data-trail-section={t(report.labelKey)}>{t('seller.reportsTitle')}</h1>
        <p>{t('seller.reportsSubtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* A manager's numbers are smaller than the owner's for a reason, and being told that
          once is the difference between a report and a doubt. */}
      {branchManager && <div className="info-banner">{t('seller.branchOnlyNotice')}</div>}

      {/* ---------- one toolbar, above everything it scopes ---------- */}
      <div className="filter-bar report-toolbar">
        {/* One picker for eighteen reports, grouped by the part of the shop they
            describe and searchable, because "supplier payable" should be two
            keystrokes and not a scroll past six GST returns. */}
        <Dropdown
          id="report-type"
          className="report-select"
          value={report.key}
          onChange={pickReport}
          searchable
          searchPlaceholder={t('seller.reportSearch')}
          groups={GROUP_ORDER.map((group) => ({
            label: t(group.labelKey),
            options: visibleReports
              .filter((r) => r.group === group.key)
              .map((r) => ({ value: r.key, label: t(r.labelKey) })),
          })).filter((group) => group.options.length > 0)}
        />

        {/* A range picker next to a report the range does not touch is a control that
            silently does nothing. Stock valuation, udhaar and supplier payable are all
            "as things stand right now", and they say so instead. */}
        {report.pointInTime ? (
          <span className="report-asof">
            <CalendarIcon size={14} />
            {t('seller.reportAsOfNow')}
          </span>
        ) : (
          <DateRangeFilter value={range} onChange={setRange} presets={REPORT_PRESETS} compact />
        )}

        <div className="report-tools">
          {report.option === 'period' && (
            <Dropdown
              value={period}
              onChange={setPeriod}
              className="filter-select"
              options={TREND_PERIODS.map((value) => ({ value, label: t(`seller.reportTrend.${value}`) }))}
            />
          )}
          {report.option === 'days' && (
            <Dropdown
              value={String(slowDays)}
              onChange={(value) => setSlowDays(Number(value))}
              className="filter-select"
              options={SLOW_DAYS.map((value) => ({ value: String(value), label: t('seller.reportNotSoldIn', { days: value }) }))}
            />
          )}
          {stores.length > 1 && (
            <Dropdown
              value={storeFilterUsable ? storeId : ''}
              onChange={setStoreId}
              disabled={!storeFilterUsable}
              className="filter-select"
              options={[
                { value: '', label: t('seller.reportAllStores') },
                ...stores.map((s) => ({ value: s._id, label: s.name })),
              ]}
            />
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={() => setNonce((n) => n + 1)}
            disabled={loading}
            aria-label={t('common.refresh')}
            data-tip={t('common.refresh')}
          >
            <RefreshIcon size={17} />
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={busy || !hasRows}
            onClick={() => handleDownload('pdf')}
            data-tip={t('seller.downloadPdf')}
          >
            <PdfIcon size={17} /> {downloading === 'pdf' ? t('seller.downloading') : 'PDF'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={busy || !hasRows}
            onClick={() => handleDownload('xlsx')}
            data-tip={t('seller.downloadExcel')}
          >
            <ExcelIcon size={17} /> {downloading === 'xlsx' ? t('seller.downloading') : 'Excel'}
          </button>
        </div>
      </div>

      {stores.length > 1 && !storeFilterUsable && (
        <div className="info-banner">{t('seller.reportsAllStoresNotice')}</div>
      )}

      {/* ---------- what you are looking at, and over what period ---------- */}
      <div className="report-head">
        {/* Tone 5 — the colour this app gives to looking back at the shop rather
            than running it (reports, insights, accounting). See lib/moduleTones.js. */}
        <span className="mod-chip mod-tone-5"><BarChartIcon size={17} /></span>
        <div className="report-head-main">
          <h2>{t(report.labelKey)}</h2>
          <p>{t(`seller.reportAbout.${report.key}`)}</p>
        </div>
        <div className="report-head-meta">
          <span className="report-period">
            {report.pointInTime ? t('seller.reportAsOfNow') : data?.range?.label || t('range.label')}
          </span>
          {!loading && (
            <span className="report-count">{t('seller.reportRowCount', { count: rows.length })}</span>
          )}
        </div>
      </div>

      {/* ---------- the answer, before the table that holds it ---------- */}
      {!loading && kpis.length > 0 && (
        <div className="stat-grid report-kpis">
          {kpis.map((kpi) => (
            <div className="stat-card" key={kpi.label}>
              {/* The same `.stat-icon` corner mark the stat cards on Accounting,
                  Appointments and the rest already wear — these were the ones still
                  going bare, which is why a report's totals read as loose text where
                  every other screen's read as cards.
                  A rupee on every one of them is not a guess dressed up as a choice:
                  this list is built by filtering the report's columns to
                  `type === 'money'`, so "it is an amount" is the only thing all of
                  them are known to have in common across nineteen different reports. */}
              <div className="stat-icon"><RupeeIcon size={16} /></div>
              <div className="stat-value">{formatRupees(Number(kpi.value), lang)}</div>
              <div className="stat-label">{kpi.label}</div>
            </div>
          ))}
        </div>
      )}

      {!loading && chartHasValue && (
        <div className="panel">
          <TrendChart
            type={chartConfig.type}
            data={chartData}
            // Exact rupees on hover, Indian short form on the axis — ₹2.5L reads at a
            // glance and, unlike ₹2,50,000, fits the gutter it has to sit in.
            formatValue={chartConfig.money ? (v) => formatRupees(v, lang) : (v) => formatQty(v, lang)}
            formatAxis={chartConfig.money ? (v) => formatCompactRupees(v, lang) : (v) => formatQty(v, lang)}
          />
        </div>
      )}

      <div className="panel report-panel">
        {loading ? (
          <SkeletonTable rows={6} cols={5} />
        ) : !hasRows ? (
          <div className="empty-state-rich">
            <Illustration scene="board" />
            <p>{report.pointInTime ? t('seller.reportEmptyNow') : t('seller.reportEmptyPeriod')}</p>
            {/* The fix, not just the diagnosis. Nine times in ten an empty report is a
                range that is too narrow, and the shopkeeper's next move is to widen it —
                so the screen offers to do it rather than describing the problem. */}
            {!report.pointInTime && range.preset !== 'last30' && (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => setRange({ preset: 'last30', from: '', to: '' })}
              >
                <SearchIcon size={15} /> {t('seller.reportTryLast30')}
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop and tablet: the table. `mobile-cards` is what removes it below
                901px, where the cards below take over — a twelve-column GSTR-1 B2B table
                on a 390px phone is a sideways scroll nobody completes. */}
            <div className="table-wrap mobile-cards auto-height">
              <table className="data-table">
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <SortHeader
                        key={col.key}
                        sortKey={col.key}
                        label={col.label}
                        sort={sort}
                        onSort={toggle}
                        align={isNum(col) ? 'right' : 'left'}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {page.pageItems.map((row, idx) => (
                    <tr key={idx}>
                      {columns.map((col) => (
                        <td key={col.key} className={isNum(col) ? 'num' : undefined}>
                          {cell(col, row[col.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {/* A real <tfoot>, not bold rows glued to the end of the body. It is the
                    total of the whole report, so it stays put while the pages change under
                    it — a total that only appears on the last page is a total nobody
                    finds. */}
                {summaryRows.length > 0 && (
                  <tfoot className="report-total">
                    {summaryRows.map((row, idx) => (
                      <tr key={`summary-${idx}`}>
                        {columns.map((col) => (
                          <td key={col.key} className={isNum(col) ? 'num' : undefined}>
                            {cell(col, row[col.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tfoot>
                )}
              </table>
            </div>

            {/* Phone: one card per row. The first column is the row's name and every other
                column is a labelled line under it, so a report with three columns and one
                with twelve both read as a list instead of a scroll. */}
            <div className="report-cards mobile-only">
              {page.pageItems.map((row, idx) => (
                <div className="report-card" key={idx}>
                  <div className="report-card-title">{cell(columns[0], row[columns[0].key]) || '—'}</div>
                  <dl className="report-card-fields">
                    {columns.slice(1).map((col) => (
                      <div className="report-card-field" key={col.key}>
                        <dt>{col.label}</dt>
                        <dd className={isNum(col) ? 'num' : undefined}>{cell(col, row[col.key]) || '—'}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
              {summaryRows.map((row, idx) => (
                <div className="report-card is-total" key={`summary-card-${idx}`}>
                  <div className="report-card-title">{cell(columns[0], row[columns[0].key]) || t('seller.reportTotal')}</div>
                  <dl className="report-card-fields">
                    {columns.slice(1).map((col) => {
                      const value = cell(col, row[col.key]);
                      if (!value) return null;
                      return (
                        <div className="report-card-field" key={col.key}>
                          <dt>{col.label}</dt>
                          <dd className={isNum(col) ? 'num' : undefined}>{value}</dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              ))}
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
              label={t('seller.reportsTitle')}
            />
          </>
        )}
      </div>
    </>
  );
}
