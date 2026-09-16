'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, API_URL, downloadFile } from '../../../lib/api';
import { formatRupees, formatDate, toDateInput } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import DateRangeFilter, { rangeToQuery } from '../../components/DateRangeFilter';
import AnimatedNumber from '../../components/AnimatedNumber';
import { SkeletonStats, SkeletonTable } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import {
  PlusIcon,
  XIcon,
  EditIcon,
  TrashIcon,
  TruckIcon,
  ClipboardIcon,
  DownloadIcon,
  SearchIcon,
  CheckCircleIcon,
  AlertIcon,
  RupeeIcon,
  UploadIcon,
  InfoIcon,
  LinkIcon,
  ClockIcon,
  TrendUpIcon,
  EyeIcon,
  ExcelIcon,
  PdfIcon,
} from '../../components/Icons';
import { gstRateOptions, unitOptions } from '../../../lib/catalog';
import { purchaseTotals, chargedTotal, receivedQuantity, effectiveCost, mrpValue } from '../../../lib/purchaseTotals';
import { businessType, DEFAULT_BUSINESS_TYPE } from '../../../lib/businessTypes';
import { useDashboardUser } from '../../components/DashboardShell';
import Dropdown from '../../components/Dropdown';
import Modal from '../../components/Modal';
import BillScanModal from '../../components/BillScanModal';
import SupplierQuickAdd from '../../components/SupplierQuickAdd';
import CatalogQuickAdd from '../../components/CatalogQuickAdd';
import InvoiceAttachments from '../../components/InvoiceAttachments';
import PurchaseRateAnchor from '../../components/PurchaseRateAnchor';
import RowMenu from '../../components/RowMenu';
import PriceHistorySheet from '../../components/PriceHistorySheet';
import RateFillSheet from '../../components/RateFillSheet';
import ReorderPanel from '../../components/ReorderPanel';
import { recordHref } from '../../../lib/routeId';

// Where the suppliers page leaves a selection on its way here. Session storage rather than
// a query string: it is a list of items with quantities, it is meaningless to anyone but
// the next screen, and it must not survive a refresh of that screen either.
const REORDER_HANDOFF_KEY = 'dukaan.reorderHandoff';

// Where "not now" is remembered for the one-time bill-scan offer. Per browser on purpose:
// a dismissal is not a setting, and it must never outlive the machine it was made on.
const SCAN_NUDGE_KEY = 'dukaan.billScanNudgeHidden';

const STATUS_FILTERS = ['', 'draft', 'ordered', 'partial', 'received', 'pendingPayment', 'cancelled'];
const ATTACHMENT_FILTERS = ['', 'true', 'false'];
const PAYMENT_STATUS_FILTERS = ['', 'paid', 'partial', 'unpaid'];

function emptyLine() {
  return {
    productId: '',
    name: '',
    unit: 'piece',
    quantity: '',
    costPrice: '',
    gstRate: 0,
    hsnCode: '',
    // The wholesaler's "Disc." column — a discount on this row alone, which is a different
    // thing from the discounts at the foot of the bill.
    discountPercent: '',
    // The batch row: only ever shown when the shop needs it. A hardware shop buying pipe
    // never sees any of this.
    batchNumber: '',
    expiryDate: '',
    mrp: '',
    freeQuantity: '',
    company: '',
    packLabel: '',
  };
}

function emptyCharges() {
  return { lineDiscount: '', cashDiscountPercent: '', cashDiscount: '', freight: '', otherCharges: '', roundOff: '' };
}

function emptyForm() {
  return {
    supplierId: '',
    supplierInvoiceNumber: '',
    supplierInvoiceDate: '',
    // When the wholesaler wants paying, off the bill. Blank falls back to the supplier's
    // default credit terms for the reminder.
    dueDate: '',
    expectedAt: '',
    notes: '',
    items: [emptyLine()],
    charges: emptyCharges(),
  };
}

// Only the charged units. The free ones in a scheme arrive but are not billed, which is
// exactly why they sit in their own column on the wholesaler's bill too.
function lineTotal(line) {
  return chargedTotal(line);
}

// A line is a chemist's line once it carries a lot number, an expiry or a scheme. Used to
// decide whether the batch row opens by itself on an order that already has one.
function hasBatchData(line) {
  return Boolean(line.batchNumber || line.expiryDate || line.mrp || Number(line.freeQuantity) > 0);
}

// "2028-06" out of the month picker, back from a stored date. The pack prints a month, so
// that is what the field shows.
function toMonthInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Warning payloads from the bill scanner carry raw numbers so the server never has to know
// the shop's language. Anything that is money is put into rupees here, on the way into the
// translated sentence.
const MONEY_KEYS = ['amount', 'printed', 'computed', 'difference', 'value', 'margin'];

function formatWarningValues(values, lang) {
  if (!values) return undefined;
  const formatted = {};
  for (const [key, value] of Object.entries(values)) {
    formatted[key] = MONEY_KEYS.includes(key) && typeof value === 'number' ? formatRupees(value, lang) : value;
  }
  return formatted;
}

export default function PurchaseOrdersPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const user = useDashboardUser();
  // Order lines get the same trade-first unit list the product form uses.
  const biz = businessType(user?.businessType || DEFAULT_BUSINESS_TYPE);

  // A purchase register defaults to the whole history — a shop opening this screen is
  // usually chasing an old order, not reviewing today's.
  const [range, setRange] = useState({ preset: 'all', from: '', to: '' });
  const [filters, setFilters] = useState({
    status: '',
    supplierId: '',
    q: '',
    hasAttachment: '',
    overdue: '',
    paymentStatus: '',
  });
  const [searchDraft, setSearchDraft] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  // Which rows the checkbox column has picked, for the bulk export/ZIP bar. Cleared
  // whenever the underlying list changes shape — a selection made against last page's rows
  // makes no sense once a filter or page change has replaced them.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [attachOrder, setAttachOrder] = useState(null);

  const [data, setData] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  // The counts and the money behind the reorder list, and whether the silenced rows are
  // being shown. `showSnoozed` drives a refetch rather than a client-side filter — the
  // snoozed rows are not in the payload at all unless they are asked for.
  const [suggestionSummary, setSuggestionSummary] = useState(null);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  // The PO number of the order being edited. Carried so the two-numbers note can name it
  // ("PO-13") instead of describing it in the abstract; blank on a new order, whose number
  // the server has not allocated yet.
  const [editingLabel, setEditingLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  // Reading a bill off a photo. `scanReview` is everything the scan was unsure about — it
  // rides along with the pre-filled form so the shopkeeper is looking at the doubts and
  // the numbers on the same screen, and is dropped the moment a form is opened any other
  // way.
  const [scanOpen, setScanOpen] = useState(false);
  const [scanEnabled, setScanEnabled] = useState(false);
  // Whether this shop has ever actually scanned a bill — read off the orders themselves,
  // not a preference flag, so it is the same evidence an auditor would use. Drives the
  // one-time offer below; `scanNudgeHidden` is the shopkeeper saying "not now", which is
  // per-browser on purpose: it is a dismissal, not a setting worth a database row.
  const [scanUsed, setScanUsed] = useState(true);
  const [scanNudgeHidden, setScanNudgeHidden] = useState(true);
  const [scanReview, setScanReview] = useState(null);
  // The photos the scan was read from, waiting for an order to hang off. Kept apart from
  // `scanReview` because they outlive it by one step: the review is cleared when the form
  // is submitted, and these are used immediately after the order comes back with an id.
  const [scanImages, setScanImages] = useState([]);
  // Adding a wholesaler without leaving the order. Holds whatever the bill said about him
  // so the form opens filled in; an empty object is a plain "add a supplier" from the field
  // itself, which is the case a hand-typed order needs.
  const [supplierDraft, setSupplierDraft] = useState(null);
  // The lines that matched nothing in the catalogue and are about to become products.
  const [catalogDraft, setCatalogDraft] = useState(null);
  // The supplier field, so a refusal to save can point at it rather than describe it.
  const supplierFieldRef = useRef(null);

  // The batch/expiry row and the bill's charges block are both hidden by default, because
  // for most trades they are six fields of nothing. A chemist gets them open from the
  // start; everyone else gets a link, and any order that already carries the data opens
  // them by itself rather than hiding what is on screen.
  const [batchMode, setBatchMode] = useState(false);
  const [chargesOpen, setChargesOpen] = useState(false);

  // The order this bill number is already sitting on, when the server has just refused to
  // enter it twice. Holds the earlier order plus which button was pressed, so answering
  // "different bill" resaves exactly what was being saved.
  const [duplicate, setDuplicate] = useState(null);

  // Products whose MRP arrived different from what they sell at, handed back by receiving.
  // Offered, never applied automatically — see updatePurchaseOrderStatus on the server.
  const [priceGaps, setPriceGaps] = useState([]);
  // Products the bill says come in packs of N, where the shop never told the app what a
  // pack holds — the number the loose-sale feature needs to sell one tablet out of a strip.
  const [packSuggestions, setPackSuggestions] = useState([]);
  const [applyingPrices, setApplyingPrices] = useState(false);
  /**
   * What this load did to the shop's margins — the cost went up and the shelf price didn't.
   * The most expensive thing a small shop does silently, and receiving is the only moment it
   * can be caught: the new rate is on screen and the goods are still in the crate.
   */
  const [marginAlerts, setMarginAlerts] = useState([]);
  const [applyingMargins, setApplyingMargins] = useState(false);

  // What this shop last paid for each product on the form, keyed by product id. Fetched for
  // the lines actually on screen rather than the whole catalogue — a shop with 4,000 SKUs
  // must not pay for all of them to fill in twelve placeholders.
  const [lastRates, setLastRates] = useState({});
  // How far a rate has to move before this trade is warned. Comes from the server with the
  // rates because it depends on the business type — 5% is an event for a chemist and a
  // Tuesday for a vegetable shop.
  const [rateAlertPercent, setRateAlertPercent] = useState(15);
  const [historyProductId, setHistoryProductId] = useState(null);
  // The order whose blank rates are being filled in before it can be received, and the
  // receive that was interrupted to ask for them.
  const [rateFillOrder, setRateFillOrder] = useState(null);
  const [insights, setInsights] = useState(null);

  // A filter or date-range change makes the current page number meaningless — someone on
  // page 7 who picks a different supplier would otherwise land on a blank page and think
  // the app broke. Page size lives outside this key on purpose: it resets itself, right
  // where it's changed, instead of coupling to every other filter.
  const filterKey = useMemo(() => JSON.stringify({ range, filters }), [range, filters]);
  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  const query = useMemo(() => {
    const params = new URLSearchParams(rangeToQuery(range));
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    params.set('page', String(page));
    params.set('limit', String(pageSize));
    return params.toString();
  }, [range, filters, page, pageSize]);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/seller/suppliers/purchase-orders?${query}`)
      .then((result) => {
        setData(result);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(load, [load]);

  // A selection made against one filter's rows makes no sense once the filter itself has
  // changed — but paging through the *same* filtered list must not touch it, or picking
  // rows on page 1 and then turning to page 2 for more would silently lose page 1's picks.
  // Keyed on `filterKey` (range + filters only), not on `query` (which also carries page).
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filterKey]);

  // The inline attach-bill popover shows a live attachment count; once a fetch lands, pull
  // its snapshot forward so an upload/delete inside it is reflected without closing it.
  useEffect(() => {
    if (!attachOrder) return;
    const fresh = (data?.orders || []).find((o) => o._id === attachOrder._id);
    if (fresh) setAttachOrder(fresh);
  }, [data]);

  /**
   * The reorder list, on its own fetch rather than inside the bundle below.
   *
   * It is the one thing here that changes as a result of what the shopkeeper does on this
   * screen — raising an order moves rows into "already ordered", snoozing takes them off —
   * so it has to be refetchable without pulling the whole catalogue down again.
   */
  const loadSuggestions = useCallback(() => {
    apiFetch(`/api/seller/suppliers/reorder-suggestions${showSnoozed ? '?includeSnoozed=1' : ''}`)
      .then((result) => {
        setSuggestions(result.suggestions || []);
        setSuggestionSummary(result.summary || null);
      })
      .catch(() => {
        setSuggestions([]);
        setSuggestionSummary(null);
      });
  }, [showSnoozed]);

  useEffect(loadSuggestions, [loadSuggestions]);

  /**
   * A selection made on the suppliers page, landing here.
   *
   * That screen shows the same reorder list but has no order form on it, so its bar hands
   * the picked rows over and sends the shopkeeper here rather than making him remember six
   * item names across a navigation. Read once and cleared immediately — a stale handoff
   * silently re-opening a six-line order on the next visit would be a small horror.
   */
  useEffect(() => {
    if (suggestions.length === 0) return;
    let handoff = null;
    try {
      const raw = window.sessionStorage.getItem(REORDER_HANDOFF_KEY);
      window.sessionStorage.removeItem(REORDER_HANDOFF_KEY);
      handoff = raw ? JSON.parse(raw) : null;
    } catch {
      handoff = null;
    }
    if (!Array.isArray(handoff) || handoff.length === 0) return;

    const byId = new Map(suggestions.map((s) => [String(s.product.id), s]));
    const rows = handoff
      .map((row) => ({ suggestion: byId.get(String(row.productId)), quantity: Number(row.quantity) || 0 }))
      // Anything that has moved off the list since the tap (received, or ordered by
      // somebody else on another till) is dropped rather than resurrected from the id.
      .filter((row) => row.suggestion && row.quantity > 0);
    if (rows.length > 0) addSuggestions(rows);
  }, [suggestions]);

  // Suppliers, the catalog and the scan status only change when the seller changes them,
  // so they are fetched once instead of on every filter change.
  useEffect(() => {
    Promise.all([
      apiFetch('/api/seller/suppliers?status=active'),
      apiFetch('/api/seller/products'),
      // Bill scanning needs an API key on the server. Asking first means the button is
      // simply absent on an install without one, rather than being offered and then
      // failing the first time somebody taps it.
      apiFetch('/api/seller/suppliers/purchase-orders/scan/status').catch(() => ({ enabled: false })),
    ])
      .then(([supplierData, productData, scanStatus]) => {
        setSuppliers(supplierData.suppliers || []);
        // A service has no stock a wholesaler can deliver — it never belongs on a
        // purchase order, so it's kept out of the name-match picker entirely.
        setProducts((productData.products || []).filter((p) => p.kind !== 'service'));
        setScanEnabled(Boolean(scanStatus?.enabled));
        setScanUsed(scanStatus?.used !== false);
        // Read here rather than in the initial state so the card cannot flash on a shop
        // that has already dismissed it, and never renders at all during the first paint.
        try {
          setScanNudgeHidden(window.localStorage.getItem(SCAN_NUDGE_KEY) === '1');
        } catch {
          // A browser with storage blocked simply gets the offer again next visit.
          setScanNudgeHidden(false);
        }
      })
      .catch((err) => setError(err.message));
  }, []);

  // What has got dearer and where a cheaper supplier is already on record. Separate from the
  // bundle above because it is the only one of these that changes on its own — a receipt
  // entered yesterday can produce a finding today.
  useEffect(() => {
    apiFetch('/api/seller/suppliers/purchase-prices/insights')
      .then(setInsights)
      .catch(() => setInsights(null));
  }, []);

  /**
   * Anchors for whatever products are on the form right now.
   *
   * Incremental: only ids we have not already looked up, so adding a thirteenth line costs
   * one product's worth of query rather than thirteen. Nothing is ever evicted — a form
   * session is short and re-fetching a rate the shopkeeper just saw would make the
   * placeholder flicker.
   */
  const formProductIds = useMemo(
    () => [...new Set(form.items.map((line) => line.productId).filter(Boolean))].join(','),
    [form.items]
  );

  useEffect(() => {
    const ids = formProductIds.split(',').filter((id) => id && !(id in lastRates));
    if (ids.length === 0) return;
    apiFetch(`/api/seller/suppliers/purchase-prices/last?productIds=${ids.join(',')}`)
      .then((result) => {
        setRateAlertPercent(result.rateAlertPercent || 15);
        setLastRates((current) => {
          const next = { ...current };
          // Every id that was asked for is written back, `null` included. Without that a
          // product with no history would be re-queried on every keystroke.
          for (const id of ids) next[id] = result.rates?.[id] || null;
          return next;
        });
      })
      .catch(() => {});
  }, [formProductIds, lastRates]);

  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => (f.q === searchDraft ? f : { ...f, q: searchDraft })), 350);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const orders = data?.orders || [];
  const summary = data?.summary;
  // The server already paged this — `orders` is one page's worth, `data.total` is the
  // count over the whole filtered set. From/to are the same "Showing 26–50" figures the
  // old client-side hook derived, just off the server's numbers instead of an array length.
  const total = data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  // Totalled through the same function the server saves with — see lib/purchaseTotals.js
  // on why the two files have to move together.
  const totals = useMemo(() => purchaseTotals(form.items, form.charges), [form.items, form.charges]);
  // What this load is worth at MRP, and what the shop makes on it. Only meaningful once
  // MRPs are actually being entered, so it stays out of the way until then.
  const shelfValue = useMemo(() => mrpValue(form.items), [form.items]);

  /**
   * The total printed on the paper against what the form adds up to RIGHT NOW.
   *
   * The scan answered this once, at the moment it read the bill, and the banner then went
   * on shouting "these lines are ₹155.08 away" through every correction the shopkeeper
   * made — including the one that fixed it. Recomputing here means the check answers to
   * his edits: it turns green the moment the bill ties, which is the only version of this
   * banner worth reading.
   *
   * The server's diagnosis of WHY it doesn't tie is kept only while the gap is still the
   * size that diagnosis was about. A cause that no longer explains the number on screen is
   * worse than no cause at all.
   */
  const scanTie = useMemo(() => {
    const printed = scanReview?.totals?.printedTotal;
    if (printed == null) return null;
    const difference = Number((printed - totals.totalAmount).toFixed(2));
    const tolerance = Math.max(1, Math.abs(printed) * 0.005);
    const matches = Math.abs(difference) <= tolerance;
    const diagnosis = scanReview.totals.diagnosis || null;
    const stillApplies =
      !matches &&
      diagnosis &&
      Math.abs(Math.abs(difference) - Math.abs(Number(diagnosis.values?.amount) || 0)) <= tolerance;
    return { printed, computed: totals.totalAmount, difference, matches, diagnosis: stillApplies ? diagnosis : null };
  }, [scanReview, totals.totalAmount]);

  const scanWarnings = useMemo(
    () => (scanReview?.warnings || []).filter((warning) => !(warning.code === 'totalMismatch' && scanTie)),
    [scanReview, scanTie]
  );

  // Lines on this order that point at nothing on the shelf. They bill correctly and move
  // no stock — the one thing on the review screen the shopkeeper could previously be told
  // about but not act on.
  const unlinkedIndexes = useMemo(
    () => form.items.map((line, index) => ({ line, index })).filter(({ line }) => line.name.trim() && !line.productId).map(({ index }) => index),
    [form.items]
  );

  function updateForm(field) {
    return (event) => setForm((f) => ({ ...f, [field]: event.target.value }));
  }

  // Dropdown hands back a value directly instead of an event.
  function setFormField(field) {
    return (value) => setForm((f) => ({ ...f, [field]: value }));
  }

  function updateLine(index, patch) {
    setForm((f) => ({ ...f, items: f.items.map((line, i) => (i === index ? { ...line, ...patch } : line)) }));
  }

  function updateCharge(field) {
    return (event) => setForm((f) => ({ ...f, charges: { ...f.charges, [field]: event.target.value } }));
  }

  // Typing a name that matches a catalog item links the line to that product, which is
  // what makes receiving the order add the stock and update the cost price. A line left
  // unlinked still bills correctly — it just can't move stock, and the form says so.
  function onLineNameChange(index, value) {
    const match = products.find((p) => p.name.toLowerCase() === value.trim().toLowerCase());
    if (match) {
      updateLine(index, {
        name: match.name,
        productId: match._id,
        unit: match.unit || 'piece',
        costPrice: form.items[index].costPrice || (match.costPrice ? String(match.costPrice) : ''),
        gstRate: match.gstRate || 0,
        hsnCode: match.hsnCode || '',
      });
    } else {
      updateLine(index, { name: value, productId: '' });
    }
  }

  // Accepts one of the scanner's near-misses. The catalog's own spelling wins over the
  // wholesaler's, because from here on the line is that product — it is what receiving the
  // order will add stock against.
  function linkAlternative(index, alternative) {
    const product = products.find((p) => p._id === alternative.id);
    updateLine(index, {
      productId: alternative.id,
      name: product?.name || alternative.name,
      unit: product?.unit || form.items[index].unit,
    });
  }

  function addLine() {
    setForm((f) => ({ ...f, items: [...f.items, emptyLine()] }));
  }

  function removeLine(index) {
    setForm((f) => ({ ...f, items: f.items.length === 1 ? [emptyLine()] : f.items.filter((_, i) => i !== index) }));
  }

  /**
   * One suggestion becomes one line on the order, at the quantity the panel is showing —
   * which is the shopkeeper's number if he touched the stepper, and the app's 14-day
   * estimate if he did not.
   *
   * The rate comes off the last purchase before it falls back to the product's own cost
   * price: the wholesaler's last bill is a fact, the catalogue's cost price is whatever was
   * typed when the item was created and is frequently a year stale.
   */
  function suggestionToLine(suggestion, quantity) {
    const product = suggestion.product;
    const rate = suggestion.lastBuy?.costPrice || product.costPrice || 0;
    return {
      ...emptyLine(),
      productId: product.id,
      name: product.name,
      unit: product.unit || 'piece',
      quantity: String(quantity || suggestion.suggestedQty),
      costPrice: rate ? String(rate) : '',
      gstRate: product.gstRate || 0,
      hsnCode: product.hsnCode || '',
    };
  }

  /**
   * Put a whole selection on the order in one go — the thing that used to take one tap per
   * item, with the form reopening in between.
   *
   * Two details that only show up with more than one row:
   *
   *   · the supplier. Every picked row carries the wholesaler it was last bought from; when
   *     they all agree and the form has not already got a supplier on it, that name is
   *     filled in. Six items from Sharma should not make anybody choose "Sharma" from a
   *     dropdown of forty. When they disagree the field is left alone — guessing which of
   *     three wholesalers this order is for would be worse than asking.
   *   · re-picking something already on the form. It updates that line's quantity rather
   *     than adding a second line for the same product, which would leave the wholesaler
   *     with two entries for one item on the same bill.
   */
  function addSuggestions(rows) {
    if (!rows || rows.length === 0) return;
    const lines = rows.map((row) => suggestionToLine(row.suggestion, row.quantity));

    const supplierIds = new Set(rows.map((row) => (row.suggestion.lastBuy?.supplierId ? String(row.suggestion.lastBuy.supplierId) : '')));
    const onlySupplier = supplierIds.size === 1 ? [...supplierIds][0] : '';

    if (!formOpen) {
      setForm({ ...emptyForm(), supplierId: onlySupplier, items: lines });
      setEditingId(null);
      setEditingLabel('');
      setScanReview(null);
      setScanImages([]);
      setBatchMode(Boolean(biz.suggestsBatches));
      setChargesOpen(false);
      setFormOpen(true);
      toast.success(t('purchase.reorderAdded', { count: lines.length }));
      return;
    }

    setForm((f) => {
      const items = [...f.items];
      lines.forEach((line) => {
        const at = items.findIndex((existing) => existing.productId === line.productId);
        if (at >= 0) items[at] = { ...items[at], quantity: line.quantity };
        else items.push(line);
      });
      // The blank starter line is replaced rather than pushed past, so adding the first
      // suggestion doesn't leave an empty row at the top.
      const withoutBlank = items.filter((line, index) => index !== 0 || line.name || line.quantity);
      return {
        ...f,
        supplierId: f.supplierId || onlySupplier,
        items: withoutBlank.length > 0 ? withoutBlank : [emptyLine()],
      };
    });
    toast.success(t('purchase.reorderAdded', { count: lines.length }));
  }

  /**
   * A selection spanning three wholesalers, raised as three drafts.
   *
   * A purchase order has exactly one supplier — that is not a UI limitation, it is what a
   * purchase order is — so the honest answer to "add all eleven" when they come from three
   * different men is three orders, not one. They are created as drafts on purpose: nothing
   * is sent anywhere, each one opens for a look and a rate check before it is placed.
   */
  async function splitSuggestionsBySupplier(groups) {
    const usable = groups.filter((group) => group.supplierId && group.rows.length > 0);
    if (usable.length === 0) return;

    const ok = await confirm({
      title: t('purchase.reorderSplitTitle'),
      body: t('purchase.reorderSplitConfirm', {
        orders: usable.length,
        items: usable.reduce((sum, group) => sum + group.rows.length, 0),
      }),
      confirmLabel: t('purchase.reorderSplitCta'),
    });
    if (!ok) return;

    setReorderBusy(true);
    const made = [];
    const failed = [];
    // Sequential rather than Promise.all: each create bumps the shop's PO counter, and
    // firing four at once at the same counter is how two orders end up sharing a number.
    for (const group of usable) {
      try {
        const result = await apiFetch('/api/seller/suppliers/purchase-orders', {
          method: 'POST',
          body: JSON.stringify({
            supplierId: group.supplierId,
            status: 'draft',
            items: group.rows.map((row) => {
              const line = suggestionToLine(row.suggestion, row.quantity);
              return {
                productId: line.productId,
                name: line.name,
                unit: line.unit,
                quantity: Number(line.quantity),
                costPrice: Number(line.costPrice) || 0,
                gstRate: line.gstRate,
                hsnCode: line.hsnCode,
              };
            }),
          }),
        });
        made.push(result.order);
      } catch (err) {
        failed.push(`${group.supplierName || ''}: ${err.message}`);
      }
    }
    setReorderBusy(false);

    if (made.length > 0) {
      toast.success(t('purchase.reorderSplitDone', { count: made.length }));
      load();
      loadSuggestions();
    }
    // Partial failure is reported rather than swallowed: three of four drafts existing is a
    // different situation from all four, and only the shopkeeper can decide what to do
    // about the fourth.
    if (failed.length > 0) setError(failed.join(' · '));
  }

  /**
   * "Abhi nahi" — take these off the morning list for a while.
   *
   * Reloads rather than patching the rows in place, because snoozing changes the summary
   * (the counts, the round's cost, the supplier rows) as much as it changes the list.
   */
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

  function openAdd(supplierId = '') {
    setForm({ ...emptyForm(), supplierId });
    setEditingId(null);
    setEditingLabel('');
    setScanReview(null);
    setScanImages([]);
    // A chemist works in lots; nobody else should have to look at six empty boxes to find
    // that out. `suggestsBatches` is the same flag that opens the batch drawer on the
    // product form — see lib/businessTypes.js.
    setBatchMode(Boolean(biz.suggestsBatches));
    setChargesOpen(false);
    setFormOpen(true);
  }

  /**
   * A scanned bill lands in the ordinary purchase-order form rather than in a screen of
   * its own. That is the whole point: the shopkeeper edits it with the same fields, the
   * same product picker and the same totals he already knows, and the order is created by
   * the same validated endpoint — the photo only saves the typing, it never takes a
   * shortcut past the confirmation.
   */
  function applyScan(scan, images) {
    // Held only until the order is saved. See handleSubmit, where they become attachments
    // on the order that was just created — and are dropped untouched if the shopkeeper
    // closes the form instead.
    setScanImages(images || []);
    const items = (scan.lines || []).map((line) => ({
      ...emptyLine(),
      productId: line.productId || '',
      name: line.name || '',
      unit: line.unit || 'piece',
      quantity: line.quantity != null ? String(line.quantity) : '',
      costPrice: line.costPrice != null ? String(line.costPrice) : '',
      gstRate: line.gstRate || 0,
      hsnCode: line.hsnCode || '',
      discountPercent: line.discountPercent ? String(line.discountPercent) : '',
      batchNumber: line.batchNumber || '',
      // Already "yyyy-mm" off the server — the month the strip prints, which is what the
      // month picker wants.
      expiryDate: line.expiry || '',
      mrp: line.mrp != null ? String(line.mrp) : '',
      freeQuantity: line.freeQuantity ? String(line.freeQuantity) : '',
      company: line.company || '',
      packLabel: line.packLabel || '',
      // Everything the scan was unsure about, carried on the line so the row itself can
      // say so. Stripped out again in handleSubmit, which only ever sends named fields.
      scan: {
        confidence: line.confidence,
        batchConfidence: line.batchConfidence,
        issues: line.issues || [],
        alternatives: line.alternatives || [],
        printedRate: line.printedRate,
        printedLineTotal: line.printedLineTotal,
        grossedUp: line.grossedUp,
        note: line.note,
      },
    }));

    // The bill's own charges now have fields of their own, so they land in them rather than
    // in a note nobody totals. What has NOT changed is that they are kept off the rates: a
    // discount spread across the lines would make every printed rate on screen disagree
    // with the paper in the shopkeeper's hand, which is exactly the trust this screen
    // depends on.
    const c = scan.charges || {};
    const charges = {
      lineDiscount: c.lineDiscount ? String(c.lineDiscount) : '',
      cashDiscountPercent: c.cashDiscountPercent ? String(c.cashDiscountPercent) : '',
      // Only one of the two can be the truth, and the percentage is what the bill printed —
      // the rupees beside it are derived from it. Filling both would put a figure in the
      // flat box that nothing is using, which now that the box is on screen reads as a
      // second discount. Same rule as openEdit().
      cashDiscount: c.cashDiscountPercent ? '' : c.cashDiscount ? String(c.cashDiscount) : '',
      freight: c.freight ? String(c.freight) : '',
      otherCharges: c.otherCharges ? String(c.otherCharges) : '',
      roundOff: c.roundOff ? String(c.roundOff) : '',
    };

    setForm({
      supplierId: scan.supplier?.matchedId || '',
      supplierInvoiceNumber: scan.invoice?.number || '',
      supplierInvoiceDate: scan.invoice?.date || '',
      dueDate: scan.invoice?.dueDate || '',
      expectedAt: '',
      notes: '',
      items: items.length > 0 ? items : [emptyLine()],
      charges,
    });
    setScanReview(scan);
    // He has now seen what it does, so the one-time offer has done its job.
    setScanUsed(true);
    setEditingId(null);
    setEditingLabel('');
    // Whatever the bill turned out to carry is shown, whatever the trade. A batch number
    // read off a photo and then hidden behind a toggle is a batch number nobody checks.
    setBatchMode(Boolean(biz.suggestsBatches) || items.some(hasBatchData));
    setChargesOpen(Object.values(charges).some(Boolean));
    setScanOpen(false);
    setFormOpen(true);
  }

  /**
   * A wholesaler this shop has never bought from before, added without losing the order.
   *
   * The bill's own reading is the prefill, not the answer: it opens the short supplier form
   * with the name, GSTIN, phone and address already in it, and the shopkeeper corrects
   * whatever the photo got wrong before it becomes a permanent record. That matters more
   * than it sounds — this row is what every future purchase, payment and udhaar figure for
   * this wholesaler hangs off, and a letterhead read at an angle is a transcription.
   *
   * It also has to work when the scan read NOTHING. A bill folded on the counter often
   * loses its letterhead, and the old button — which only appeared if a name had been read —
   * left exactly that shopkeeper with a form he could not save and no way out of it except
   * to abandon the scan he had just paid for.
   */
  /**
   * The fix for the gap the scan diagnosed, applied to the form.
   *
   * Every one of these is a correction the shopkeeper could make by hand in the fields
   * right below — this only saves him working out which field. Nothing here is hidden: the
   * discount boxes empty in front of him, the rates change to the ones printed on the bill,
   * and the total re-ties on screen. That is deliberate. A "fix" that quietly adjusted a
   * number he could not see would break the one thing this whole screen runs on, which is
   * that what is on the screen is what is on the paper.
   */
  /**
   * Puts the refusal next to the box that answers it.
   *
   * The ring is a static box-shadow that JS removes, not something that lives only inside
   * the keyframes — a shopkeeper on `data-motion="off"` has to see it too. Same rule, and
   * the same class, as the billing screen's fixes.
   */
  function flashSupplierField() {
    // The supplier picker is a Dropdown, so there is no input with an id to look up — this
    // is the by-element way into the same one flash. See lib/focusField.js.
    flashElement(supplierFieldRef.current);
  }

  function hideScanNudge() {
    setScanNudgeHidden(true);
    try {
      window.localStorage.setItem(SCAN_NUDGE_KEY, '1');
    } catch {
      // Nothing to do — it comes back next visit, which is the harmless failure.
    }
  }

  function applyScanFix(code) {
    if (code === 'discountAlreadyIncluded') {
      // The wholesaler had already taken his discount off before printing his total, so
      // taking it off again charges the shop for it twice.
      setForm((f) => ({ ...f, charges: { ...f.charges, lineDiscount: '', cashDiscount: '', cashDiscountPercent: '' } }));
      setChargesOpen(true);
      dropScanWarnings(['billDiscount', 'cashDiscount']);
    } else if (code === 'chargesAlreadyIncluded') {
      setForm((f) => ({ ...f, charges: { ...f.charges, freight: '', otherCharges: '' } }));
      setChargesOpen(true);
      dropScanWarnings(['otherCharges']);
    } else if (code === 'ratesAlreadyIncludeGst') {
      // The bill was read as quoting rates before tax and every rate got grossed up. The
      // printed rate is still on each line, so putting it back is exact rather than a
      // second division that would leave paise adrift.
      setForm((f) => ({
        ...f,
        items: f.items.map((line) =>
          line.scan?.grossedUp && line.scan.printedRate != null
            ? { ...line, costPrice: String(line.scan.printedRate), scan: { ...line.scan, grossedUp: false } }
            : line
        ),
      }));
      // "The bill quotes rates before GST" has just stopped being true of this order.
      dropScanWarnings(['ratesGrossedUp']);
    } else if (code === 'lineMissing') {
      addLine();
    }
  }

  // A warning the shopkeeper has just answered. Left up, it argues with the fields right
  // below it — the review is only worth reading while every line on it is still true.
  function dropScanWarnings(codes) {
    setScanReview((current) =>
      current ? { ...current, warnings: current.warnings.filter((w) => !codes.includes(w.code)) } : current
    );
  }

  function openSupplierAdd(prefill = null) {
    setSupplierDraft({ prefill, fromBill: Boolean(prefill) });
  }

  function onSupplierCreated(supplier) {
    setSuppliers((current) => (current.some((s) => s._id === supplier._id) ? current : [...current, supplier]));
    setForm((f) => ({ ...f, supplierId: supplier._id }));
    setScanReview((current) =>
      current
        ? {
            ...current,
            supplier: { ...current.supplier, matchedId: supplier._id },
            // The "not in your list yet" line has just been answered — leaving it up would
            // have the banner arguing with the field right below it.
            warnings: current.warnings.filter(
              (w) => !['noSupplierMatch', 'supplierUnsure', 'supplierNotRead', 'supplierIsBuyer'].includes(w.code)
            ),
          }
        : current
    );
    toast.success(t('supplier.added'));
  }

  /**
   * The lines that matched nothing on the shelf, handed to the catalogue form.
   *
   * `index` is carried on every row because that is how the created product finds its way
   * back to the line it came from — the order still has to point at a real product id, or
   * receiving it moves no stock, which is the whole reason the warning existed.
   */
  function openCatalogAdd(indexes) {
    const rows = indexes
      .map((index) => ({ index, line: form.items[index] }))
      .filter(({ line }) => line && line.name.trim() && !line.productId)
      .map(({ index, line }) => ({
        index,
        name: line.name,
        unit: line.unit,
        mrp: line.mrp ? Number(line.mrp) : null,
        costPrice: line.costPrice ? Number(line.costPrice) : null,
        gstRate: line.gstRate || 0,
        hsnCode: line.hsnCode || '',
        packLabel: line.packLabel || '',
        company: line.company || '',
      }));
    if (rows.length === 0) return;
    setCatalogDraft(rows);
  }

  function onProductsCreated(created) {
    // Straight into the picker's list, so the datalist and every other line on this order
    // can reach the new product without a reload.
    setProducts((current) => [
      ...current,
      ...created.map(({ product }) => product).filter((product) => !current.some((p) => p._id === product._id)),
    ]);
    setForm((f) => ({
      ...f,
      items: f.items.map((line, index) => {
        const match = created.find((entry) => entry.index === index);
        if (!match) return line;
        // The catalogue's spelling wins from here on: this line IS that product now, and it
        // is what receiving the order will add stock against.
        return { ...line, productId: match.product._id, name: match.product.name };
      }),
    }));
    // The "N items aren't linked" line is only answered once nothing is left unlinked;
    // creating three of five and then dropping the warning would hide the other two.
    const stillUnlinked = form.items.filter(
      (line, index) => line.name.trim() && !line.productId && !created.some((entry) => entry.index === index)
    ).length;
    setScanReview((current) =>
      current
        ? {
            ...current,
            warnings: current.warnings
              .filter((w) => w.code !== 'unlinkedLines' || stillUnlinked > 0)
              .map((w) => (w.code === 'unlinkedLines' ? { ...w, values: { ...w.values, count: stillUnlinked } } : w)),
          }
        : current
    );
    toast.success(t('catalogAdd.created', { count: created.length }));
  }

  function openEdit(order) {
    const items = order.items.map((item) => ({
      ...emptyLine(),
      productId: item.product || '',
      name: item.name,
      unit: item.unit || 'piece',
      quantity: String(item.quantity),
      costPrice: String(item.costPrice),
      gstRate: item.gstRate || 0,
      hsnCode: item.hsnCode || '',
      discountPercent: item.discountPercent ? String(item.discountPercent) : '',
      batchNumber: item.batchNumber || '',
      expiryDate: toMonthInput(item.expiryDate),
      mrp: item.mrp != null ? String(item.mrp) : '',
      freeQuantity: item.freeQuantity ? String(item.freeQuantity) : '',
      company: item.company || '',
      packLabel: item.packLabel || '',
    }));
    const c = order.charges || {};
    const charges = {
      lineDiscount: c.lineDiscount ? String(c.lineDiscount) : '',
      cashDiscountPercent: c.cashDiscountPercent ? String(c.cashDiscountPercent) : '',
      cashDiscount: c.cashDiscountPercent ? '' : c.cashDiscount ? String(c.cashDiscount) : '',
      freight: c.freight ? String(c.freight) : '',
      otherCharges: c.otherCharges ? String(c.otherCharges) : '',
      roundOff: c.roundOff ? String(c.roundOff) : '',
    };

    setForm({
      supplierId: order.supplier?._id || order.supplier?.id || '',
      supplierInvoiceNumber: order.supplierInvoiceNumber || '',
      supplierInvoiceDate: order.supplierInvoiceDate ? toDateInput(order.supplierInvoiceDate) : '',
      dueDate: order.dueDate ? toDateInput(order.dueDate) : '',
      expectedAt: order.expectedAt ? toDateInput(order.expectedAt) : '',
      notes: order.notes || '',
      items,
      charges,
    });
    setEditingId(order._id);
    setEditingLabel(order.label || '');
    setScanReview(null);
    setScanImages([]);
    // An order that already has lots or charges on it opens showing them — hiding data the
    // shopkeeper is about to edit is how a field gets silently blanked.
    setBatchMode(Boolean(biz.suggestsBatches) || items.some(hasBatchData));
    setChargesOpen(Object.values(charges).some(Boolean));
    setFormOpen(true);
  }

  async function handleSubmit(event, status) {
    event.preventDefault();
    return submitOrder(status, false);
  }

  /**
   * `force` is the shopkeeper's answer to the duplicate-bill question, never a default. The
   * server refuses a wholesaler's bill number it has already seen against that wholesaler;
   * this sends it back a second time only once he has looked at the earlier order and said
   * it is a different bill.
   */
  async function submitOrder(status, force) {
    if (!form.supplierId) {
      toast.error(t('seller.selectSupplierFirst'));
      // Naming the problem is not the same as being able to solve it. A shop with no
      // suppliers on file — a brand new shop, or one whose first bill came from a
      // wholesaler nobody had entered — was being told to pick from an empty list, so the
      // box that answers the refusal opens with it.
      if (suppliers.length === 0) openSupplierAdd(scanReview?.supplier?.extracted || null);
      else flashSupplierField();
      return;
    }
    /**
     * A line survives on a name and a quantity. The rate is not required.
     *
     * This used to also demand `costPrice !== ''`, which meant a shopkeeper ordering twelve
     * items and unsure of three rates saved a nine-item order and was never told — the three
     * lines simply vanished between the screen and the request. Almost every real order is
     * placed before the rates are known (quantities today, bill tomorrow), so a blank rate is
     * the normal case, not an invalid one.
     *
     * `null` is sent for a blank so the server can tell it apart from a typed zero: the first
     * is "not told yet" and gets flagged `rateUnknown`, the second is a genuinely free line.
     */
    const items = form.items
      .filter((line) => line.name && Number(line.quantity) > 0)
      .map((line) => ({
        productId: line.productId || undefined,
        name: line.name,
        unit: line.unit,
        quantity: Number(line.quantity),
        costPrice: line.costPrice === '' ? null : Number(line.costPrice),
        gstRate: Number(line.gstRate) || 0,
        hsnCode: line.hsnCode || undefined,
        discountPercent: line.discountPercent !== '' ? Number(line.discountPercent) : undefined,
        batchNumber: line.batchNumber || undefined,
        // "2028-06" — the server resolves a month to its last day, because a medicine is
        // sellable for the whole of its expiry month.
        expiryDate: line.expiryDate || undefined,
        mrp: line.mrp !== '' ? Number(line.mrp) : undefined,
        freeQuantity: line.freeQuantity !== '' ? Number(line.freeQuantity) : undefined,
        company: line.company || undefined,
        packLabel: line.packLabel || undefined,
      }));
    if (items.length === 0) {
      toast.error(t('purchase.needOneItem'));
      return;
    }

    // A lot number with no expiry cannot go into the batch ledger, so the goods would land
    // as one anonymous pile and FEFO would have nothing to sort. Worth stopping for: the
    // shopkeeper has the strip in his hand right now, and will not once the order is saved.
    const noExpiry = form.items.filter((line) => line.name && line.batchNumber && !line.expiryDate);
    if (noExpiry.length > 0 && !(await confirm({ tone: 'warning', title: t('purchase.noExpiryTitle'), body: t('purchase.confirmNoExpiry', { count: noExpiry.length }), confirmLabel: t('common.confirm') }))) {
      return;
    }

    setSubmitting(true);
    try {
      const body = JSON.stringify({
        supplierId: form.supplierId,
        supplierInvoiceNumber: form.supplierInvoiceNumber || undefined,
        supplierInvoiceDate: form.supplierInvoiceDate || undefined,
        dueDate: form.dueDate || undefined,
        expectedAt: form.expectedAt || undefined,
        notes: form.notes || undefined,
        items,
        charges: {
          lineDiscount: Number(form.charges.lineDiscount) || 0,
          cashDiscountPercent: Number(form.charges.cashDiscountPercent) || 0,
          cashDiscount: Number(form.charges.cashDiscount) || 0,
          freight: Number(form.charges.freight) || 0,
          otherCharges: Number(form.charges.otherCharges) || 0,
          roundOff: Number(form.charges.roundOff) || 0,
        },
        status,
        allowDuplicateInvoice: force || undefined,
      });
      if (editingId) {
        await apiFetch(`/api/seller/suppliers/purchase-orders/${editingId}`, { method: 'PATCH', body });
        toast.success(t('purchase.updated'));
      } else {
        const created = await apiFetch('/api/seller/suppliers/purchase-orders', { method: 'POST', body });
        toast.success(status === 'draft' ? t('purchase.draftSaved') : t('purchase.created'));
        // The bill this order was read off, now that there is an order to attach it to.
        // Deliberately after the success toast and never awaited into it: the order is
        // saved either way, and a failed upload must not read as a failed purchase.
        if (scanImages.length > 0 && created?.order?._id) {
          saveScanImages(created.order._id, scanImages);
        }
      }
      setFormOpen(false);
      setForm(emptyForm());
      setEditingId(null);
      setEditingLabel('');
      setScanReview(null);
      setScanImages([]);
      setDuplicate(null);
      load();
    } catch (err) {
      // This wholesaler's bill number is already on another order. Asked as a question with
      // that order's date and amount in it rather than refused outright — only the person
      // holding the paper can tell a re-entry from a genuinely re-used number — and never
      // as a toast, which is gone before it has been read.
      if (err.code === 'DUPLICATE_SUPPLIER_INVOICE' && err.data?.duplicate) {
        // `retryStatus` is kept separate from the earlier order's own `status` — saying
        // "yes, different bill" has to resave as draft or as placed, whichever button was
        // pressed.
        setDuplicate({ ...err.data.duplicate, retryStatus: status });
        return;
      }
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Keeps the photos a bill was scanned from, as attachments on the order they produced.
   *
   * Best-effort on purpose. The purchase is already saved by the time this runs, and the
   * copy of the bill — however much it is worth at audit time — is not worth telling a
   * shopkeeper their order failed over. A failure here is reported quietly and the order
   * stands; the bill can be attached again from its own page.
   */
  async function saveScanImages(orderId, images) {
    try {
      for (const [index, dataUrl] of images.entries()) {
        await apiFetch(`/api/seller/suppliers/purchase-orders/${orderId}/attachments`, {
          method: 'POST',
          body: JSON.stringify({ file: dataUrl, filename: `bill-${index + 1}.jpg`, source: 'scan' }),
        });
      }
    } catch {
      toast.error(t('purchase.billSaveFailed'));
    } finally {
    setScanImages([]);
    }
  }

  // `skipConfirm` is only ever set by the rate sheet retrying the receive it interrupted —
  // the shopkeeper already answered that question a moment ago, and asking twice for one
  // delivery is how a confirm stops being read.
  async function changeStatus(order, status, { skipConfirm = false } = {}) {
    // This button signs for the WHOLE order. Short supply is a different question with a
    // different answer, and the confirm says so rather than letting a shopkeeper whose load
    // came up two dabbe short tap it anyway — which is what used to happen, because nothing
    // on this screen suggested there was another way.
    if (status === 'received' && !skipConfirm && !(await confirm({ tone: 'warning', title: t('purchase.receive'), body: t('purchase.confirmReceiveFull'), confirmLabel: t('purchase.receiveAll'), cancelLabel: t('common.goBack') }))) return;
    if (status === 'cancelled' && !(await confirm({ tone: 'danger', title: t('purchase.cancelOrder'), cancelLabel: t('common.goBack'), body: t('purchase.confirmCancel'), confirmLabel: t('purchase.cancelOrder') }))) return;
    setBusyId(order._id);
    try {
      const result = await apiFetch(`/api/seller/suppliers/purchase-orders/${order._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      toast.success(status === 'received' ? t('purchase.receivedToast') : t('purchase.statusUpdated'));
      /**
       * Goods that came in and reached no shelf.
       *
       * The one-tap receive is the path most likely to hit this — a bill scanned into an
       * order and signed for in one go, with lines the catalogue never had — and it was the
       * quietest about it: a green "maal aa gaya" and a stock list that was short. The fix
       * lives on the order, so this says what happened and sends him there rather than
       * carrying a whole second screen on the register.
       */
      if (result?.notStocked?.length) {
        toast.error(t('purchase.stockGapToast', { count: result.notStocked.length }));
      }
      // The new load's MRP doesn't match what these are selling at. Never applied on the
      // server — a selling price is the shopkeeper's call, not a side effect of taking
      // delivery — so it is offered here instead, once, with the numbers in front of him.
      // Only the owner is offered this: changing a selling price is a seller-only endpoint,
      // and a staff member at the receiving counter tapping a button that 403s is worse
      // than never being shown it.
      if (user?.role !== 'staff') {
        if (result?.priceGaps?.length) setPriceGaps(result.priceGaps);
        if (result?.packSuggestions?.length) setPackSuggestions(result.packSuggestions);
        // The cost went up and the shelf price didn't. Shown after the MRP question so the
        // shopkeeper answers one thing at a time.
        if (result?.marginAlerts?.length) setMarginAlerts(result.marginAlerts);
      }
      load();
      // A receipt is the only thing that can create a new finding, so the panel is refreshed
      // right here rather than on a timer.
      apiFetch('/api/seller/suppliers/purchase-prices/insights').then(setInsights).catch(() => {});
    } catch (err) {
      // The order still has lines waiting for their rate. Rather than a refusal he can do
      // nothing with, open the sheet that asks for exactly those rates and then retries.
      if (err.code === 'RATES_MISSING') {
        setRateFillOrder(order);
      } else {
        toast.error(err.message);
      }
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Applies the selling prices the shopkeeper just agreed to after a cost rise.
   *
   * Same shape as applyPriceGaps below and for the same reason — one request per product,
   * because this is a handful of rows off one delivery, not a catalogue import. Rows whose
   * suggestion is null (there was no margin to restore) are skipped rather than sent as a
   * zero.
   */
  async function applyMarginAlerts() {
    const withSuggestion = marginAlerts.filter((row) => row.suggestedPrice > 0);
    setApplyingMargins(true);
    try {
      await Promise.all(
        withSuggestion.map((row) =>
          apiFetch(`/api/seller/products/${row.productId}`, {
            method: 'PATCH',
            body: JSON.stringify({ price: row.suggestedPrice }),
          })
        )
      );
      toast.success(t('purchase.pricesUpdated', { count: withSuggestion.length }));
      setMarginAlerts([]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setApplyingMargins(false);
    }
  }

  // Applies the MRPs the shopkeeper just agreed to. One request per product rather than a
  // bulk endpoint, because this is a handful of rows on a delivery, not a catalogue import.
  async function applyPriceGaps() {
    setApplyingPrices(true);
    try {
      await Promise.all(
        priceGaps.map((gap) =>
          apiFetch(`/api/seller/products/${gap.productId}`, {
            method: 'PATCH',
            body: JSON.stringify({ price: gap.mrp }),
          })
        )
      );
      toast.success(t('purchase.pricesUpdated', { count: priceGaps.length }));
      setPriceGaps([]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setApplyingPrices(false);
    }
  }

  // "15 TAB" off the bill becomes "one strip holds 15 tablets", which is what lets the
  // counter sell a single tablet. Same rule as the price prompt: offered, never applied
  // — a pack size decides how a fractional sale is priced.
  async function applyPackSuggestions() {
    setApplyingPrices(true);
    try {
      await Promise.all(
        packSuggestions.map((pack) =>
          apiFetch(`/api/seller/products/${pack.productId}`, {
            method: 'PATCH',
            body: JSON.stringify({ subUnit: pack.subUnit, subUnitsPerUnit: pack.subUnitsPerUnit }),
          })
        )
      );
      toast.success(t('purchase.packsUpdated', { count: packSuggestions.length }));
      setPackSuggestions([]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setApplyingPrices(false);
    }
  }

  async function handleDelete(order) {
    if (!(await confirm({ tone: 'danger', title: t('common.delete'), body: t('purchase.confirmDelete'), confirmLabel: t('common.delete') }))) return;
    setBusyId(order._id);
    try {
      await apiFetch(`/api/seller/suppliers/purchase-orders/${order._id}`, { method: 'DELETE' });
      toast.success(t('purchase.deleted'));
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  // Exports ride the `token` cookie the browser already has — an apiFetch can't hand the
  // file to the download manager.
  function exportUrl(format) {
    return `${API_URL}/api/seller/suppliers/purchase-orders?${query}&format=${format}`;
  }

  // The checkbox selection narrows within whatever the filters already found — `ids` is
  // read as a further $in on the server, on top of the same filter object.
  //
  // Fetched through `downloadFile` rather than a plain `<a href>` (unlike the register's
  // own Excel/PDF buttons, which always have rows to export): a selection can legitimately
  // 404 — "these orders have no bill copies" — and a bare anchor link has no way to say so.
  // It would just look like the button did nothing.
  const [bulkDownloading, setBulkDownloading] = useState(false);
  async function downloadSelected(format) {
    const params = new URLSearchParams(query);
    params.set('format', format);
    params.set('ids', [...selectedIds].join(','));
    setBulkDownloading(true);
    try {
      await downloadFile(`/api/seller/suppliers/purchase-orders?${params.toString()}`, `purchase-register.${format}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBulkDownloading(false);
    }
  }

  async function downloadSelectedZip() {
    setBulkDownloading(true);
    try {
      await downloadFile(
        `/api/seller/suppliers/purchase-orders/attachments/zip?ids=${[...selectedIds].join(',')}`,
        'purchase-bills.zip'
      );
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBulkDownloading(false);
    }
  }

  function toggleSelect(orderId) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  const allOnPageSelected = orders.length > 0 && orders.every((order) => selectedIds.has(order._id));
  function toggleSelectAll() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allOnPageSelected) orders.forEach((order) => next.delete(order._id));
      else orders.forEach((order) => next.add(order._id));
      return next;
    });
  }

  const hasFilters =
    filters.status ||
    filters.supplierId ||
    filters.q ||
    filters.hasAttachment ||
    filters.overdue ||
    filters.paymentStatus ||
    range.preset !== 'all';

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('purchase.title')}</h1>
          <p>{t('purchase.subtitle')}</p>
          <div className="head-links">
            <Link href="/seller/suppliers" className="nav-link">{t('nav.suppliers')} →</Link>
            <Link href="/seller/suppliers/ledger" className="nav-link">{t('seller.supplierLedgerTitle')} →</Link>
          </div>
        </div>
        <div className="row-actions">
          {scanEnabled && (
            <button type="button" className="btn btn-secondary btn-inline" onClick={() => setScanOpen(true)}>
              <UploadIcon size={17} />
              {t('billScan.button')}
            </button>
          )}
          <button type="button" className="btn btn-primary btn-inline" onClick={() => openAdd()}>
            <PlusIcon size={17} />
            {t('purchase.create')}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* The most valuable thing on this screen was also the least discovered. A shopkeeper
          who has typed forty bills by hand has no reason to press a button he has never
          pressed — and this one only sells itself once he has watched it fill a form. So it
          is offered properly, once, with what it actually does written next to it, and it
          disappears the moment he has used it or said no. */}
      {scanEnabled && !scanUsed && !scanNudgeHidden && (
        <div className="try-card">
          <span className="try-card-icon"><UploadIcon size={20} /></span>
          <div className="try-card-body">
            <strong>{t('billScan.tryTitle')}</strong>
            <p>{t('billScan.tryBody')}</p>
          </div>
          <div className="try-card-actions">
            <button type="button" className="btn btn-primary btn-small btn-inline" onClick={() => setScanOpen(true)}>
              {t('billScan.tryNow')}
            </button>
            <button type="button" className="icon-btn" data-tip={t('common.close')} onClick={hideScanNudge}>
              <XIcon size={17} />
            </button>
          </div>
        </div>
      )}

      {loading && !data ? (
        <SkeletonStats count={4} />
      ) : (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-icon"><ClipboardIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={summary?.totalPurchased || 0} /></div>
            <div className="stat-label">
              {t('purchase.totalPurchased')}
              {/* A cash discount is money the shop earns by paying on time and never sees
                  added up anywhere. Seeing the period's total is what makes it worth
                  chasing the next one. */}
              {summary?.discountEarned > 0 && (
                <span className="cell-sub">{t('purchase.discountEarned', { amount: formatRupees(summary.discountEarned, lang) })}</span>
              )}
            </div>
          </div>
          <div className="stat-card accent-danger">
            <div className="stat-icon"><RupeeIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={summary?.totalPending || 0} /></div>
            <div className="stat-label">{t('purchase.pendingPayment')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><TruckIcon size={16} /></div>
            <div className="stat-value">{summary?.awaitingDelivery || 0}</div>
            <div className="stat-label">
              {t('purchase.awaitingDelivery')}
              {summary?.overdue > 0 && <span className="badge badge-expired" style={{ marginLeft: '0.4rem' }}>{t('purchase.lateCount', { count: summary.overdue })}</span>}
            </div>
          </div>
          <div className="stat-card accent-success">
            <div className="stat-icon"><CheckCircleIcon size={16} /></div>
            <div className="stat-value">₹<AnimatedNumber value={summary?.gstPaid || 0} /></div>
            <div className="stat-label">{t('purchase.inputGst')}</div>
          </div>
        </div>
      )}

      {/* What has got dearer, and where a cheaper supplier is already on record.
          Both stated as money rather than as percentages — a shopkeeper does not act on
          "15%", he acts on "har piece par ₹4 kam bachega". Absent entirely when there is
          nothing to say, which on a new shop is most of the time. */}
      {(insights?.rateRises?.length > 0 || insights?.switches?.length > 0) && (
        <div className="panel accent-danger">
          <div className="panel-head">
            <h2>
              <TrendUpIcon size={16} /> {t('purchase.insightsTitle')}
            </h2>
            <span className="cell-sub">{t('purchase.insightsSince', { days: 120 })}</span>
          </div>

          {insights.rateRises.length > 0 && (
            <div className="table-wrap auto-height">
              <table className="data-table" style={{ minWidth: '620px' }}>
                <thead>
                  <tr>
                    <th>{t('seller.productName')}</th>
                    <th className="num">{t('purchase.costWas')}</th>
                    <th className="num">{t('purchase.costNow')}</th>
                    <th>{t('purchase.whatItCosts')}</th>
                    <th className="tight" />
                  </tr>
                </thead>
                <tbody>
                  {insights.rateRises.map((row) => (
                    <tr key={String(row.productId)}>
                      <td className="cell-stack">
                        <span className="cell-strong">{row.name}</span>
                        {row.supplierName && <span className="cell-sub">{row.supplierName}</span>}
                      </td>
                      <td className="num cell-muted">{formatRupees(row.previousCost, lang)}</td>
                      <td className="num cell-strong amount-out">{formatRupees(row.currentCost, lang)}</td>
                      <td>
                        {row.nowBelowCost ? (
                          <span className="badge badge-danger">{t('purchase.belowCost')}</span>
                        ) : (
                          t('purchase.earnsLess', { amount: formatRupees(row.perUnitRise, lang), unit: row.unit || '' })
                        )}
                      </td>
                      <td className="tight">
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="icon-btn"
                            data-tip={t('purchase.seeHistory')}
                            onClick={() => setHistoryProductId(row.productId)}
                          >
                            <TrendUpIcon size={17} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Only a different supplier who is genuinely cheaper on the REAL cost — a man
              running 10+2 at ₹100 beats one at ₹90 flat, and the billed rate says the
              opposite. See supplierComparisonFor(). */}
          {insights.switches?.length > 0 && (
            <>
              <h3 className="section-sub">{t('purchase.switchTitle')}</h3>
              <ul className="plain-list">
                {insights.switches.map((row) => (
                  <li key={String(row.productId)}>
                    {t('purchase.switchLine', {
                      name: row.name,
                      current: row.currentSupplierName,
                      currentCost: formatRupees(row.currentCost, lang),
                      best: row.bestSupplierName,
                      bestCost: formatRupees(row.bestCost, lang),
                      saving: formatRupees(row.savingPerUnit, lang),
                    })}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {(suggestions.length > 0 || suggestionSummary?.snoozed > 0) && (
        <ReorderPanel
          suggestions={suggestions}
          summary={suggestionSummary}
          busy={reorderBusy}
          onAdd={addSuggestions}
          onSplitBySupplier={splitSuggestionsBySupplier}
          onSnooze={snoozeSuggestions}
          onOpenOrder={(poId) => router.push(recordHref('/seller/purchase-orders/[id]', poId))}
          onToggleSnoozed={setShowSnoozed}
          showingSnoozed={showSnoozed}
        />
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>{t('purchase.register')}</h2>
          <div className="panel-tools">
            {/* Lives here rather than as its own bar above the stats — a custom range typed
                right next to the status/supplier/attachment filters reads as one filter set
                instead of two separate controls that happen to feed the same query. It
                still drives the stat cards above: same `range` state either way. */}
            <DateRangeFilter value={range} onChange={setRange} compact />
            <div className="search-box-inline">
              <SearchIcon size={15} />
              <input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder={t('purchase.searchPlaceholder')} />
            </div>
            <Dropdown
              className="filter-select"
              value={filters.status}
              onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
              options={STATUS_FILTERS.map((status) => ({ value: status, label: status ? t(`purchase.status.${status}`) : t('purchase.allStatuses') }))}
            />
            <Dropdown
              className="filter-select"
              value={filters.supplierId}
              onChange={(v) => setFilters((f) => ({ ...f, supplierId: v }))}
              options={[{ value: '', label: t('purchase.allSuppliers') }, ...suppliers.map((s) => ({ value: s._id, label: s.name }))]}
            />
            <Dropdown
              className="filter-select"
              value={filters.hasAttachment}
              onChange={(v) => setFilters((f) => ({ ...f, hasAttachment: v }))}
              options={ATTACHMENT_FILTERS.map((value) => ({
                value,
                label:
                  value === '' ? t('purchase.filterAttachmentAll') : value === 'true' ? t('purchase.filterAttachmentYes') : t('purchase.filterAttachmentNo'),
              }))}
            />
            <Dropdown
              className="filter-select"
              value={filters.overdue}
              onChange={(v) => setFilters((f) => ({ ...f, overdue: v }))}
              options={[
                { value: '', label: t('purchase.filterOverdueAll') },
                { value: 'true', label: t('purchase.filterOverdueOnly') },
              ]}
            />
            <Dropdown
              className="filter-select"
              value={filters.paymentStatus}
              onChange={(v) => setFilters((f) => ({ ...f, paymentStatus: v }))}
              options={PAYMENT_STATUS_FILTERS.map((value) => ({
                value,
                label: value === '' ? t('purchase.filterPaymentAll') : t(`purchase.filterPayment_${value}`),
              }))}
            />
            <a className="btn btn-secondary btn-small btn-inline" href={exportUrl('xlsx')}>
              <ExcelIcon size={17} /> Excel
            </a>
            <a className="btn btn-secondary btn-small btn-inline" href={exportUrl('pdf')}>
              <PdfIcon size={17} /> PDF
            </a>
          </div>
        </div>

        {hasFilters && (
          <div className="active-filters">
            {range.preset !== 'all' && (
              <button type="button" className="filter-pill" onClick={() => setRange({ preset: 'all', from: '', to: '' })}>
                {range.preset === 'custom' && range.from && range.to
                  ? `${formatDate(range.from, lang)} – ${formatDate(range.to, lang)}`
                  : t(`range.${range.preset}`)}{' '}
                <XIcon size={12} />
              </button>
            )}
            {filters.status && (
              <button type="button" className="filter-pill" onClick={() => setFilters((f) => ({ ...f, status: '' }))}>
                {t(`purchase.status.${filters.status}`)} <XIcon size={12} />
              </button>
            )}
            {filters.supplierId && (
              <button type="button" className="filter-pill" onClick={() => setFilters((f) => ({ ...f, supplierId: '' }))}>
                {suppliers.find((s) => s._id === filters.supplierId)?.name || '—'} <XIcon size={12} />
              </button>
            )}
            {filters.q && (
              <button type="button" className="filter-pill" onClick={() => { setSearchDraft(''); setFilters((f) => ({ ...f, q: '' })); }}>
                &quot;{filters.q}&quot; <XIcon size={12} />
              </button>
            )}
            {filters.hasAttachment && (
              <button type="button" className="filter-pill" onClick={() => setFilters((f) => ({ ...f, hasAttachment: '' }))}>
                {filters.hasAttachment === 'true' ? t('purchase.filterAttachmentYes') : t('purchase.filterAttachmentNo')} <XIcon size={12} />
              </button>
            )}
            {filters.overdue && (
              <button type="button" className="filter-pill" onClick={() => setFilters((f) => ({ ...f, overdue: '' }))}>
                {t('purchase.filterOverdueOnly')} <XIcon size={12} />
              </button>
            )}
            {filters.paymentStatus && (
              <button type="button" className="filter-pill" onClick={() => setFilters((f) => ({ ...f, paymentStatus: '' }))}>
                {t(`purchase.filterPayment_${filters.paymentStatus}`)} <XIcon size={12} />
              </button>
            )}
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setSearchDraft('');
                setFilters({ status: '', supplierId: '', q: '', hasAttachment: '', overdue: '', paymentStatus: '' });
                setRange({ preset: 'all', from: '', to: '' });
              }}
            >
              {t('expenses.clearFilters')}
            </button>
          </div>
        )}

        {selectedIds.size > 0 && (
          <div className="active-filters">
            <span className="cell-strong">{t('purchase.selectedCount', { count: selectedIds.size })}</span>
            <button
              type="button"
              className="btn btn-secondary btn-small btn-inline"
              disabled={bulkDownloading}
              onClick={() => downloadSelected('xlsx')}
            >
              <ExcelIcon size={17} /> Excel
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-small btn-inline"
              disabled={bulkDownloading}
              onClick={() => downloadSelected('pdf')}
            >
              <PdfIcon size={17} /> PDF
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-small btn-inline"
              disabled={bulkDownloading}
              onClick={downloadSelectedZip}
            >
              <DownloadIcon size={15} /> {t('purchase.downloadBillsZip')}
            </button>
            <button type="button" className="link-btn" onClick={() => setSelectedIds(new Set())}>
              {t('purchase.clearSelection')}
            </button>
          </div>
        )}

        {loading ? (
          <SkeletonTable rows={5} cols={5} />
        ) : orders.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="parcel" />
            <p>{hasFilters ? t('purchase.noneMatch') : t('seller.noPurchaseOrders')}</p>
            {!hasFilters && (
              <div className="row-actions">
                <button type="button" className="btn btn-primary btn-small btn-inline" onClick={() => openAdd()}>
                  <PlusIcon size={15} />
                  {t('purchase.create')}
                </button>
                {/* The strongest moment there is to show what the photo does: a shopkeeper
                    looking at an empty register is about to type his first bill by hand. */}
                {scanEnabled && (
                  <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => setScanOpen(true)}>
                    <UploadIcon size={15} /> {t('billScan.button')}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="table-wrap auto-height">
              <table className="data-table sticky-actions" style={{ minWidth: '860px' }}>
                <thead>
                  <tr>
                    <th className="tight">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={toggleSelectAll}
                        aria-label={t('purchase.selectAll')}
                      />
                    </th>
                    {/* Plain 1, 2, 3 — the column every paper register in every trade opens
                        with. It answers "how many bills is this" and "which row are we
                        talking about" without anyone having to read a PO number, and it is
                        the one heading on this table that needs no explaining. */}
                    <th className="sr">{t('common.srNo')}</th>
                    <th>{t('purchase.orderNo')}</th>
                    <th>{t('seller.supplier')}</th>
                    <th className="num">{t('seller.total')}</th>
                    <th className="num">{t('purchase.pending')}</th>
                    <th>{t('common.status')}</th>
                    <th className="tight">{t('purchase.billCopyTitle')}</th>
                    <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order, index) => (
                    <tr
                      key={order._id}
                      className={`row-enter selectable-row${selectedIds.has(order._id) ? ' selected' : ''}`}
                    >
                      <td className="tight">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(order._id)}
                          onChange={() => toggleSelect(order._id)}
                          aria-label={order.label}
                        />
                      </td>
                      {/* The list itself shows newest first (so the order you just placed is
                          the one you see), but a serial number counts entries in the order
                          they were made — the 3rd bill you ever added should read "3", not
                          "1" because it happens to be on top. So the count runs backwards
                          from the total: the newest row gets the highest number, the oldest
                          visible row gets the lowest. `total`/`from` are the same figures
                          the "Showing 26–50 of N" line below the table already uses. */}
                      <td className="sr">{total - (from + index) + 1}</td>
                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{order.label}</span>
                          <span className="cell-sub">
                            {formatDate(order.createdAt, lang)} · {t('purchase.itemCount', { count: order.itemCount })}
                            {order.batchLines > 0 && ` · ${t('purchase.lotCount', { count: order.batchLines })}`}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{order.supplier?.name || '—'}</span>
                          {/* Said in words rather than left as a bare "#1183", which on a
                              row that already carries a PO number reads as a second guess
                              at the same thing. */}
                          {order.supplierInvoiceNumber && (
                            <span className="cell-sub">{t('purchase.billNoShort', { number: order.supplierInvoiceNumber })}</span>
                          )}
                        </div>
                      </td>
                      <td className="num">
                        <div className="cell-stack">
                          <span className="cell-strong">{formatRupees(order.totalAmount, lang)}</span>
                          {order.gstAmount > 0 && <span className="cell-sub">GST {formatRupees(order.gstAmount, lang)}</span>}
                        </div>
                      </td>
                      <td className="num">
                        {order.pending > 0 ? (
                          <span className="cell-strong amount-out">{formatRupees(order.pending, lang)}</span>
                        ) : (
                          <span className="badge badge-active">{t('purchase.fullyPaid')}</span>
                        )}
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span className={`badge ${order.status === 'received' ? 'badge-active' : order.status === 'cancelled' ? 'badge-inactive' : 'badge-pending'}`} style={{ width: 'fit-content' }}>
                            {t(`purchase.status.${order.status}`)}
                          </span>
                          {/* Why a draft has no reply: it was never sent. Sits in the status
                              cell because that is where the shopkeeper looks when he wonders
                              what the wholesaler is doing about it. */}
                          {order.status === 'draft' && (
                            <span className="cell-sub">{t('purchase.draftNotSent')}</span>
                          )}
                          {/* How much of this load is still sitting in the wholesaler's
                              godown. In the status cell because "partial" on its own is a
                              label, and the shopkeeper's actual question is how much. */}
                          {order.pendingLines > 0 && (
                            <span className="cell-sub amount-out">
                              {t('purchase.itemsStillDue', { count: order.pendingLines })}
                            </span>
                          )}
                          {/* Goods this order took in that are on no shelf. On the register
                              row and not only inside the order, because the shopkeeper who
                              notices his stock is short comes to THIS list looking for which
                              purchase did it. */}
                          {order.unstockedLines?.length > 0 && (
                            <span className="tag-nostock">
                              {t('purchase.stockGapBanner', { count: order.unstockedLines.length })}
                            </span>
                          )}
                          {order.isOverdue && (
                            <span className="cell-sub amount-out">
                              <AlertIcon size={12} /> {t('purchase.expectedOn', { date: formatDate(order.expectedAt, lang) })}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="tight">
                        <button
                          type="button"
                          className="icon-btn"
                          data-tip={order.attachments?.length > 0 ? t('purchase.billAttached') : t('purchase.attachBill')}
                          onClick={() => setAttachOrder(order)}
                        >
                          {order.attachments?.length > 0 ? (
                            <span className="badge badge-active" style={{ width: 'fit-content' }}>
                              <ClipboardIcon size={17} /> {order.attachments.length}
                            </span>
                          ) : (
                            <ClipboardIcon size={17} />
                          )}
                        </button>
                      </td>
                      <td className="tight">
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          {/* The row's yes, whatever "yes" means at this stage of the
                              order: place it, take the load in, or finish taking it in.
                              One square in the same spot on every row, so the eye going
                              down the column always finds it in the same place. */}
                          {order.status === 'ordered' && (
                            <button
                              type="button"
                              className="icon-btn primary"
                              data-tip={t('purchase.receive')}
                              disabled={busyId === order._id}
                              onClick={() => changeStatus(order, 'received')}
                            >
                              <CheckCircleIcon size={17} />
                            </button>
                          )}
                          {/* The balance of a short-supplied load is taken in line by line,
                              which needs the delivery screen — so this goes to the order
                              rather than pretending one tap could describe what came. */}
                          {order.status === 'partial' && (
                            <button
                              type="button"
                              className="icon-btn primary"
                              data-tip={t('purchase.receiveBalance')}
                              onClick={() => router.push(recordHref('/seller/purchase-orders/[id]', order._id))}
                            >
                              <CheckCircleIcon size={17} />
                            </button>
                          )}
                          {order.status === 'draft' && (
                            <button
                              type="button"
                              className="icon-btn primary"
                              data-tip={t('purchase.place')}
                              disabled={busyId === order._id}
                              onClick={() => changeStatus(order, 'ordered')}
                            >
                              <TruckIcon size={17} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="icon-btn"
                            data-tip={t('seller.viewDetails')}
                            onClick={() => router.push(recordHref('/seller/purchase-orders/[id]', order._id))}
                          >
                            <EyeIcon size={17} />
                          </button>
                          {(order.status === 'draft' || order.status === 'ordered') && (
                            <button type="button" className="icon-btn" data-tip={t('common.edit')} onClick={() => openEdit(order)}>
                              <EditIcon size={17} />
                            </button>
                          )}
                          <RowMenu
                            items={[
                              {
                                label: t('common.delete'),
                                icon: <TrashIcon size={15} />,
                                danger: true,
                                hidden: order.status !== 'draft',
                                onClick: () => handleDelete(order),
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
              page={page}
              pageCount={pageCount}
              pageSize={pageSize}
              total={total}
              from={from}
              to={to}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              label={t('nav.purchaseOrders')}
            />
          </>
        )}
      </div>

      {formOpen && (
        <Modal
          as="form"
          className="modal-wide"
          onSubmit={(e) => handleSubmit(e, 'ordered')}
          onClose={() => setFormOpen(false)}
          title={editingId ? t('purchase.editOrder') : t('purchase.create')}
          hint={t('purchase.formHint')}
          footer={
            <>
              <button type="submit" className="btn btn-primary btn-inline" disabled={submitting}>
                {submitting ? t('common.saving') : editingId ? t('common.saveChanges') : t('purchase.placeOrder')}
              </button>
              {!editingId && (
                <button
                  type="button"
                  className="btn btn-secondary btn-inline"
                  disabled={submitting}
                  // Given a tooltip rather than left bare: the two buttons look equally
                  // final, and only one of them actually reaches the wholesaler.
                  data-tip={t('purchase.draftInvisible')}
                  onClick={(e) => handleSubmit(e, 'draft')}
                >
                  {t('purchase.saveDraft')}
                </button>
              )}
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setFormOpen(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
          {/* Two numbers, two owners. Said once at the top of the form, with our own
              number named when there is one to name, so the field lower down only has to
              remind rather than explain. */}
          <p className="field-hint">
            {editingLabel
              ? t('purchase.twoNumbersEditing', { po: editingLabel })
              : t('purchase.twoNumbersNew')}
          </p>

            {scanReview && (
              <div className="scan-review">
                <div className="scan-review-head">
                  <strong>{t('billScan.reviewTitle')}</strong>
                  <span className="cell-sub">{t('billScan.reviewHint')}</span>
                </div>

                {/* The bill's own grand total is an independent check on every row above
                    it: when the two tie, a misread digit or a dropped line is ruled out
                    without anyone having to re-read the paper. */}
                {scanTie && (
                  <div className={`scan-total ${scanTie.matches ? 'ok' : 'bad'}`}>
                    {scanTie.matches ? <CheckCircleIcon size={16} /> : <AlertIcon size={16} />}
                    <span>
                      {scanTie.matches
                        ? t('billScan.totalMatches', { amount: formatRupees(scanTie.printed, lang) })
                        : t('billScan.totalDiffers', {
                            printed: formatRupees(scanTie.printed, lang),
                            computed: formatRupees(scanTie.computed, lang),
                          })}
                    </span>
                  </div>
                )}

                {/* Why it doesn't tie, when the gap itself says so. "₹155.08 short" sends
                    the shopkeeper back through twenty rows hunting for a misread digit;
                    "that ₹155.08 is the discount, and the wholesaler had already taken it
                    off" is the same fact with the answer attached. */}
                {scanTie?.diagnosis && (
                  <div className="scan-cause">
                    <p>
                      {t(`billScan.cause.${scanTie.diagnosis.code}`, formatWarningValues(scanTie.diagnosis.values, lang))}
                    </p>
                    {scanTie.diagnosis.code !== 'lineDuplicated' && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-small btn-inline"
                        onClick={() => applyScanFix(scanTie.diagnosis.code)}
                      >
                        {t(`billScan.fix.${scanTie.diagnosis.code}`)}
                      </button>
                    )}
                  </div>
                )}

                {/* The grand total above silently proves every rupee on the bill. Nothing
                    proves a batch number — there is no arithmetic to check an arbitrary
                    code against — so the only defence a chemist has is being told exactly
                    which lots to re-read off the strips. This block is deliberately louder
                    than a warning line and sits directly under the total, because a batch
                    that goes in wrong is not a rounding error: it is a lot that cannot be
                    found when a recall comes. */}
                {scanReview.lines?.some((line) => line.batchNumber) && (
                  <div className={`scan-batches${scanReview.lines.some((l) => l.batchConfidence === 'low') ? ' bad' : ''}`}>
                    <div className="scan-batches-head">
                      <AlertIcon size={14} />
                      <strong>{t('billScan.batchCheckTitle')}</strong>
                    </div>
                    <p className="cell-sub">{t('billScan.batchCheckHint')}</p>
                    <div className="scan-batch-chips">
                      {scanReview.lines
                        .filter((line) => line.batchNumber)
                        .map((line, index) => (
                          <span
                            key={`${line.batchNumber}-${index}`}
                            className={`scan-batch-chip${line.batchConfidence === 'low' ? ' unsure' : ''}`}
                            data-tip={line.name}
                          >
                            <code>{line.batchNumber}</code>
                            <span>{line.expiry || t('billScan.noExpiry')}</span>
                          </span>
                        ))}
                    </div>
                  </div>
                )}

                {/* `totalMismatch` says exactly what the band above already says, and unlike
                    the band it cannot know the shopkeeper has since fixed it. Dropped
                    whenever the band is on screen, which is precisely when the bill printed
                    a total to check against. */}
                {scanWarnings.length > 0 && (
                  <ul className="scan-warnings">
                    {scanWarnings.map((warning, index) => (
                      <li key={`${warning.code}-${index}`} className={`scan-warning ${warning.level}`}>
                        {warning.level === 'info' ? <InfoIcon size={13} /> : <AlertIcon size={13} />}
                        <span>{t(`billScan.warn.${warning.code}`, formatWarningValues(warning.values, lang))}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* The two things the review used to name and then leave the shopkeeper to
                    solve somewhere else. Both now happen without unmounting the form — a
                    scanned bill's twenty lines and six batch numbers must never be the
                    price of adding a wholesaler or a product. */}
                {/* The suppliers the scan thought this bill might be from but wasn't sure
                    enough to pick. The server has scored and returned these from the start
                    and the screen threw them away — so a wholesaler saved as "Kundan Med.
                    Agency" against a bill printed "KUNDAN MEDICAL AGENCIES" was reported as
                    "not in your supplier list yet", and the shopkeeper's answer was to add
                    him a second time. Two records, one wholesaler, and his udhaar split
                    across both. */}
                {!form.supplierId && scanReview.supplier?.alternatives?.length > 0 && (
                  <div className="scan-suggestions">
                    <span className="cell-sub">{t('billScan.didYouMean')}</span>
                    {scanReview.supplier.alternatives.slice(0, 3).map((alt) => (
                      <button
                        key={alt.id}
                        type="button"
                        className="scan-chip"
                        onClick={() => setForm((f) => ({ ...f, supplierId: alt.id }))}
                      >
                        <LinkIcon size={11} /> {alt.name}
                      </button>
                    ))}
                  </div>
                )}

                <div className="scan-actions">
                  {!form.supplierId && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-small btn-inline"
                      onClick={() => openSupplierAdd(scanReview.supplier?.extracted || {})}
                    >
                      <PlusIcon size={15} />
                      {scanReview.supplier?.extracted?.name
                        ? t('billScan.createSupplier', { name: scanReview.supplier.extracted.name })
                        : t('billScan.createSupplierBlank')}
                    </button>
                  )}
                  {unlinkedIndexes.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-small btn-inline"
                      onClick={() => openCatalogAdd(unlinkedIndexes)}
                    >
                      <PlusIcon size={15} />
                      {t('billScan.addToCatalog', { count: unlinkedIndexes.length })}
                    </button>
                  )}
                </div>
              </div>
            )}


              <div className="form-grid">
                <div className="field" ref={supplierFieldRef}>
                  <label>{t('seller.supplier')}</label>
                  {/* The order will not save without this, so the way to fill it in has to
                      be here rather than on another page. It used to be a link, and a link
                      unmounts the form — which on a scanned bill threw away every line the
                      shopkeeper had just had read for him. */}
                  <div className="input-action">
                    <Dropdown
                      value={form.supplierId}
                      onChange={setFormField('supplierId')}
                      options={[{ value: '', label: '—' }, ...suppliers.map((s) => ({ value: s._id, label: `${s.name}${s.company ? ` · ${s.company}` : ''}` }))]}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-inline"
                      data-tip={t('supplierAdd.title')}
                      aria-label={t('supplierAdd.title')}
                      onClick={() => openSupplierAdd(scanReview?.supplier?.extracted || null)}
                    >
                      <PlusIcon size={17} />
                    </button>
                  </div>
                  {suppliers.length === 0 && <p className="field-hint">{t('purchase.noSuppliersYet')}</p>}
                </div>
                <div className="field">
                  <label>{t('purchase.supplierInvoiceNo')}</label>
                  <input value={form.supplierInvoiceNumber} onChange={updateForm('supplierInvoiceNumber')} placeholder={t('purchase.invoicePlaceholder')} />
                  {/* The single most-asked question on this screen: why there are two
                      numbers and whether they are supposed to agree. They are not — ours
                      counts our entries, his counts his bills — and the shopkeeper only
                      finds that out by being told. */}
                  <span className="field-hint">{t('purchase.invoiceNoHint')}</span>
                </div>
                <div className="field">
                  <label>{t('purchase.supplierInvoiceDate')}</label>
                  <input type="date" value={form.supplierInvoiceDate} onChange={updateForm('supplierInvoiceDate')} />
                </div>
                <div className="field">
                  <label>{t('purchase.dueDate')}</label>
                  <input type="date" value={form.dueDate} onChange={updateForm('dueDate')} />
                  {/* Blank is fine and common. The reminder then falls back to this
                      supplier's usual credit terms, which is right for most loads and wrong
                      for exactly the one taken on unusual terms. */}
                  <span className="field-hint">{t('purchase.dueDateHint')}</span>
                </div>
                <div className="field">
                  <label>{t('purchase.expectedAt')}</label>
                  <input type="date" value={form.expectedAt} onChange={updateForm('expectedAt')} />
                </div>
              </div>

              <datalist id="po-product-list">
                {products.map((p) => (
                  <option key={p._id} value={p.name} />
                ))}
              </datalist>

              <div className="line-items">
                <div className="line-items-head">
                  <span>{t('seller.items')}</span>
                  <div className="row-actions">
                    {/* Six extra boxes are the difference between a chemist's form and a
                        hardware shop's. The toggle is what lets one screen be both. */}
                    <button type="button" className="link-btn" onClick={() => setBatchMode((on) => !on)}>
                      {batchMode ? t('purchase.hideBatchFields') : t('purchase.showBatchFields')}
                    </button>
                    <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={addLine}>
                      <PlusIcon size={15} /> {t('seller.addLine')}
                    </button>
                  </div>
                </div>

                {form.items.map((line, index) => (
                  <div className="line-item" key={index}>
                    <div className="field line-name">
                      <label>{t('seller.productName')}</label>
                      <input
                        list="po-product-list"
                        value={line.name}
                        onChange={(e) => onLineNameChange(index, e.target.value)}
                        placeholder={t('purchase.itemPlaceholder')}
                      />
                      <div className="link-row">
                        <span className={`link-flag${line.productId ? ' linked' : ''}`}>
                          {line.productId ? t('purchase.linked') : t('purchase.notLinked')}
                        </span>
                        {/* A line that points at nothing still bills correctly and still
                            moves no stock. One tap makes the product off what the bill
                            already said about it — name, pack, MRP, GST slab and HSN. */}
                        {!line.productId && line.name.trim() && (
                          <button type="button" className="scan-chip" onClick={() => openCatalogAdd([index])}>
                            <PlusIcon size={11} /> {t('purchase.addToCatalog')}
                          </button>
                        )}
                      </div>
                      {/* The scanner found products that look like this line but wasn't
                          sure enough to link one outright — a wrong link moves stock on
                          the wrong shelf, so the choice stays with the shopkeeper. */}
                      {!line.productId && line.scan?.alternatives?.length > 0 && (
                        <div className="scan-suggestions">
                          <span className="cell-sub">{t('billScan.didYouMean')}</span>
                          {line.scan.alternatives.slice(0, 3).map((alt) => (
                            <button
                              key={alt.id}
                              type="button"
                              className="scan-chip"
                              onClick={() => linkAlternative(index, alt)}
                            >
                              <LinkIcon size={11} /> {alt.name}
                            </button>
                          ))}
                        </div>
                      )}
                      {/* Whatever the scan wrote about this row that had nowhere else to
                          go. Its own line: run inline it reads as one sentence with the
                          linked/not-linked flag above it ("Not linked to stockNet value
                          485.09"), which is how it looked on the first bill anyone tried. */}
                      {line.scan?.note && <span className="cell-sub line-note">{line.scan.note}</span>}
                    </div>
                    <div className="field line-sm">
                      <label>{t('seller.unit')}</label>
                      <Dropdown
                        value={line.unit}
                        onChange={(v) => updateLine(index, { unit: v })}
                        groups={unitOptions(t, biz.preferredUnits).map((group) => ({ label: group.label, options: group.units }))}
                      />
                    </div>
                    <div className="field line-sm">
                      <label>{t('seller.quantity')}</label>
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={line.quantity}
                        onChange={(e) => updateLine(index, { quantity: e.target.value })}
                      />
                    </div>
                    <div className="field line-sm">
                      <label>{t('purchase.rate')}</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.costPrice}
                        onChange={(e) => updateLine(index, { costPrice: e.target.value })}
                      />
                      {/* This app stores cost prices with GST already in them; a proper
                          tax invoice quotes them without. When the rate here is not the
                          number printed on the paper, the row says so rather than leaving
                          the shopkeeper to wonder which of them is wrong. */}
                      {line.scan?.grossedUp && line.scan.printedRate != null && (
                        <span className="cell-sub">{t('billScan.printedRate', { rate: formatRupees(line.scan.printedRate, lang) })}</span>
                      )}
                      {/* What this shop last paid for it. Only on a line linked to a
                          product — a one-off name typed on a bill has no history to
                          anchor against. */}
                      {line.productId && (
                        <PurchaseRateAnchor
                          anchor={lastRates[line.productId]}
                          typedRate={line.costPrice}
                          thresholdPercent={rateAlertPercent}
                          onUse={(rate) => updateLine(index, { costPrice: String(rate) })}
                          onOpenHistory={
                            lastRates[line.productId] ? () => setHistoryProductId(line.productId) : undefined
                          }
                        />
                      )}
                    </div>
                    <div className="field line-sm">
                      <label>{t('purchase.discPercent')}</label>
                      {/* The wholesaler's own "Disc." column. Kept off the rate above so
                          the rate on screen is still the rate on the paper; the line total
                          below carries it, and so does the real cost per unit. */}
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={line.discountPercent}
                        onChange={(e) => updateLine(index, { discountPercent: e.target.value })}
                        placeholder="0"
                      />
                    </div>
                    <div className="field line-sm">
                      <label>{t('purchase.gstPercent')}</label>
                      <Dropdown
                        value={line.gstRate}
                        onChange={(v) => updateLine(index, { gstRate: Number(v) })}
                        options={gstRateOptions(line.gstRate)}
                      />
                    </div>
                    <div className="field line-sm">
                      <label>HSN</label>
                      <input value={line.hsnCode} onChange={(e) => updateLine(index, { hsnCode: e.target.value })} />
                    </div>
                    {/* The line's total and its delete button are wrapped so a phone can put
                        them on one footer strip. On a laptop the wrapper is
                        `display: contents`, so both stay direct children of the eight-column
                        line grid and the wide layout is exactly what it was. */}
                    <div className="line-foot">
                      <div className="line-total">
                        <span className="cell-sub">{t('seller.total')}</span>
                        <strong>{formatRupees(lineTotal(line), lang)}</strong>
                      </div>
                      <button type="button" className="icon-btn danger line-remove" data-tip={t('common.delete')} onClick={() => removeLine(index)}>
                        <TrashIcon size={17} />
                      </button>
                    </div>

                    {/* The lot, as opposed to the money. Its own row across the full width
                        of the line, because a chemist reads batch and expiry together off
                        the strip and splitting them across a wrapped grid makes that
                        harder, not easier. */}
                    {batchMode && (
                      <div className="line-batch">
                        <div className="field line-sm">
                          <label>{t('purchase.batchNo')}</label>
                          <input
                            value={line.batchNumber}
                            // Batch numbers are printed in capitals and matched character
                            // by character during a recall; letting one in as lower case
                            // makes two spellings of the same lot.
                            onChange={(e) => updateLine(index, { batchNumber: e.target.value.toUpperCase() })}
                            placeholder={t('purchase.batchPlaceholder')}
                            className={line.scan?.batchConfidence === 'low' ? 'input-unsure' : undefined}
                          />
                          {line.scan?.batchConfidence === 'low' && line.batchNumber && (
                            <span className="field-warn">{t('purchase.batchUnsure')}</span>
                          )}
                        </div>
                        <div className="field line-sm">
                          <label>{t('purchase.expiry')}</label>
                          {/* A month, not a day — that is what the pack prints. */}
                          <input type="month" value={line.expiryDate} onChange={(e) => updateLine(index, { expiryDate: e.target.value })} />
                          {line.batchNumber && !line.expiryDate && <span className="field-warn">{t('purchase.expiryNeeded')}</span>}
                        </div>
                        <div className="field line-sm">
                          <label>{t('purchase.mrp')}</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.mrp}
                            onChange={(e) => updateLine(index, { mrp: e.target.value })}
                          />
                        </div>
                        <div className="field line-sm">
                          <label>{t('purchase.freeQty')}</label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={line.freeQuantity}
                            onChange={(e) => updateLine(index, { freeQuantity: e.target.value })}
                            placeholder="0"
                          />
                        </div>
                        <div className="field line-sm">
                          <label>{t('purchase.company')}</label>
                          <input value={line.company} onChange={(e) => updateLine(index, { company: e.target.value })} />
                        </div>
                        <div className="field line-sm">
                          <label>{t('purchase.pack')}</label>
                          <input
                            value={line.packLabel}
                            onChange={(e) => updateLine(index, { packLabel: e.target.value })}
                            placeholder={t('purchase.packPlaceholder')}
                          />
                        </div>
                        {/* A scheme changes two numbers the shopkeeper cares about and
                            neither is on the bill: how many actually arrive, and what one
                            really cost him. Both are shown the moment a free quantity is
                            typed rather than left to be worked out later. */}
                        {Number(line.freeQuantity) > 0 && Number(line.quantity) > 0 && (
                          <div className="line-scheme">
                            {t('purchase.schemeEffect', {
                              received: receivedQuantity(line),
                              unit: line.unit,
                              cost: formatRupees(effectiveCost(line), lang),
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* The foot of the wholesaler's bill. Folded away by default because most
                  trades never see a cash discount, and opened by itself whenever a scanned
                  bill turns out to have one. */}
              <div className="charges-block">
                <button type="button" className="link-btn" onClick={() => setChargesOpen((on) => !on)}>
                  {chargesOpen ? t('purchase.hideCharges') : t('purchase.showCharges')}
                </button>
                {chargesOpen && (
                  <>
                    <p className="field-hint">{t('purchase.chargesHint')}</p>
                    <div className="form-grid">
                      <div className="field">
                        <label>{t('purchase.cashDiscountPercent')}</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={form.charges.cashDiscountPercent}
                          onChange={updateCharge('cashDiscountPercent')}
                          placeholder="0"
                        />
                        {/* The percentage is what the bill prints and what gets stored; the
                            rupees follow from it, so they are shown rather than typed. */}
                        {Number(form.charges.cashDiscountPercent) > 0 && totals.cashDiscount > 0 && (
                          <span className="field-hint">− {formatRupees(totals.cashDiscount, lang)}</span>
                        )}
                      </div>
                      {/* The flat version of the same thing. It has always been computed —
                          a bill that prints "C.D. ₹46.53" with no percentage beside it went
                          straight into the total — but there was no box for it, so the
                          shopkeeper saw a cash discount of 0% quietly taking ₹46.53 off his
                          bill and had no way to correct or even locate it. */}
                      <div className="field">
                        <label>{t('purchase.cashDiscountAmount')}</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.charges.cashDiscount}
                          onChange={updateCharge('cashDiscount')}
                          placeholder="0"
                          disabled={Number(form.charges.cashDiscountPercent) > 0}
                        />
                        <span className="field-hint">
                          {Number(form.charges.cashDiscountPercent) > 0
                            ? t('purchase.cashDiscountPercentWins')
                            : t('purchase.cashDiscountAmountHint')}
                        </span>
                      </div>
                      <div className="field">
                        <label>{t('purchase.lineDiscount')}</label>
                        <input type="number" min="0" step="0.01" value={form.charges.lineDiscount} onChange={updateCharge('lineDiscount')} placeholder="0" />
                      </div>
                      <div className="field">
                        <label>{t('purchase.freight')}</label>
                        <input type="number" min="0" step="0.01" value={form.charges.freight} onChange={updateCharge('freight')} placeholder="0" />
                      </div>
                      <div className="field">
                        <label>{t('purchase.otherCharges')}</label>
                        <input type="number" min="0" step="0.01" value={form.charges.otherCharges} onChange={updateCharge('otherCharges')} placeholder="0" />
                      </div>
                      <div className="field">
                        <label>{t('purchase.roundOff')}</label>
                        <input type="number" step="0.01" value={form.charges.roundOff} onChange={updateCharge('roundOff')} placeholder="0" />
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="field">
                <label>{t('purchase.notes')}</label>
                <input value={form.notes} onChange={updateForm('notes')} placeholder={t('purchase.notesPlaceholder')} />
              </div>

              <div className="order-totals">
                {/* Laid out the way the bottom-right box of a wholesaler's bill is laid
                    out, in the same order, so the two can be read side by side. Rows that
                    are zero are simply absent — an empty freight line on a bill that had
                    none is noise. */}
                {totals.lessTotal > 0 && (
                  <>
                    <div>
                      <span>{t('purchase.grossAmount')}</span>
                      <strong>{formatRupees(totals.grossAmount, lang)}</strong>
                    </div>
                    <div>
                      <span>{t('purchase.lessTotal')}</span>
                      <strong className="amount-in">− {formatRupees(totals.lessTotal, lang)}</strong>
                    </div>
                  </>
                )}
                <div>
                  <span>{t('purchase.taxableValue')}</span>
                  <strong>{formatRupees(totals.taxableAmount, lang)}</strong>
                </div>
                <div>
                  {/* Deliberately just "GST" here. Whether this load carries IGST or
                      CGST+SGST is decided from the two GSTINs on the server, so the form
                      cannot know it before saving — and a label that guessed would be wrong
                      on exactly the out-of-state bills that matter. The split is shown on
                      the order's own page, where it is a saved fact. */}
                  <span>{t('purchase.gstAmount')}</span>
                  <strong>{formatRupees(totals.gstAmount, lang)}</strong>
                </div>
                {totals.addTotal > 0 && (
                  <div>
                    <span>{t('purchase.addTotal')}</span>
                    <strong>+ {formatRupees(totals.addTotal, lang)}</strong>
                  </div>
                )}
                <div className="grand">
                  <span>{t('seller.total')}</span>
                  <strong>{formatRupees(totals.totalAmount, lang)}</strong>
                </div>
                {/* The number the shopkeeper actually wants off a purchase bill, and the
                    one no other screen in the app has ever shown him: what this load is
                    worth on the shelf, and therefore what he makes on it. */}
                {shelfValue > 0 && totals.totalAmount > 0 && (
                  <div className="order-totals-note">
                    {t('purchase.shelfValue', {
                      value: formatRupees(shelfValue, lang),
                      margin: formatRupees(shelfValue - totals.totalAmount, lang),
                    })}
                  </div>
                )}
              </div>

              {/* Rate-less lines are allowed and are the normal shape of an order — but
                  they are said out loud, because the previous behaviour was to drop them
                  silently and a shopkeeper cannot notice what he was never shown. */}
              {form.items.filter((line) => line.name && Number(line.quantity) > 0 && line.costPrice === '').length > 0 && (
                <p className="field-hint">
                  <ClockIcon size={13} />{' '}
                  {t('purchase.ratesPendingHint', {
                    count: form.items.filter((line) => line.name && Number(line.quantity) > 0 && line.costPrice === '').length,
                  })}
                </p>
              )}
              {!editingId && <p className="field-hint">{t('purchase.draftVsPlaceHint')}</p>}
        </Modal>
      )}

      {/* The same wholesaler's bill number, already on another order. Shown as a question
          rather than an error, because both answers are real: usually it is the same bill
          being entered twice — which would double the stock and double what the shop thinks
          it owes — and occasionally a wholesaler has genuinely re-used a number. The earlier
          order's date and amount are what tell the two apart, so they are on the screen
          rather than behind a link. */}
      {duplicate && (
        <Modal
          onClose={() => setDuplicate(null)}
          title={t('purchase.duplicateInvoiceTitle')}
          hint={t('purchase.duplicateInvoiceHint', { number: form.supplierInvoiceNumber })}
          footer={
            <>
              {/* The safe answer first and as the primary button: nine times in ten the
                  bill is already entered and the right thing is to go and look at it. */}
              <button
                type="button"
                className="btn btn-primary btn-inline"
                onClick={() => {
                  setDuplicate(null);
                  setFormOpen(false);
                  router.push(recordHref('/seller/purchase-orders/[id]', duplicate.id));
                }}
              >
                {t('purchase.duplicateOpenExisting')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-inline"
                disabled={submitting}
                onClick={() => {
                  const status = duplicate.retryStatus;
                  setDuplicate(null);
                  submitOrder(status, true);
                }}
              >
                {submitting ? t('common.saving') : t('purchase.duplicateSaveAnyway')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setDuplicate(null)}>
                {t('purchase.duplicateEditNumber')}
              </button>
            </>
          }
        >
            <div className="detail-grid">
              <div>
                <span>{t('purchase.orderNo')}</span>
                <strong>{duplicate.label}</strong>
              </div>
              <div>
                <span>{t('purchase.supplierInvoiceDate')}</span>
                <strong>
                  {duplicate.supplierInvoiceDate
                    ? formatDate(duplicate.supplierInvoiceDate, lang)
                    : formatDate(duplicate.createdAt, lang)}
                </strong>
              </div>
              <div>
                <span>{t('seller.total')}</span>
                <strong>{formatRupees(duplicate.totalAmount, lang)}</strong>
              </div>
              <div>
                <span>{t('common.status')}</span>
                <strong>{t(`purchase.status.${duplicate.status}`)}</strong>
              </div>
            </div>
        </Modal>
      )}

      {/* The one moment this question can be answered well: the goods are on the counter,
          the pack is in the shopkeeper's hand, and the old shelf price is now wrong. Asked
          once, right after receiving, and dismissable — a shop that prices below MRP on
          purpose must not be nagged about it on every delivery. */}
      {priceGaps.length > 0 && (
        <Modal
          onClose={() => setPriceGaps([])}
          title={t('purchase.mrpChangedTitle')}
          hint={t('purchase.mrpChangedHint', { count: priceGaps.length })}
          footer={
            <>
              <button type="button" className="btn btn-primary btn-inline" disabled={applyingPrices} onClick={applyPriceGaps}>
                {applyingPrices ? t('common.saving') : t('purchase.useMrpAsPrice')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setPriceGaps([])}>
                {t('purchase.keepMyPrices')}
              </button>
            </>
          }
        >
            <div className="table-wrap auto-height" style={{ maxHeight: '320px' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('seller.productName')}</th>
                    <th className="num">{t('purchase.sellingNow')}</th>
                    <th className="num">{t('purchase.newMrp')}</th>
                  </tr>
                </thead>
                <tbody>
                  {priceGaps.map((gap) => (
                    <tr key={gap.productId}>
                      <td className="cell-strong">{gap.name}</td>
                      <td className="num cell-muted">{formatRupees(gap.currentPrice, lang)}</td>
                      <td className="num cell-strong">{formatRupees(gap.mrp, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </Modal>
      )}

      {/* The cost went up and the shelf price did not. Queued behind the MRP question for
          the same reason the pack question is — one thing at a time after a delivery.
          Framed as money per unit, not as a percentage: "margin 22% se 9% hua" is a
          statistic, "har piece par ₹4 kam bachega" is a decision. */}
      {priceGaps.length === 0 && marginAlerts.length > 0 && (
        <Modal
          onClose={() => setMarginAlerts([])}
          title={t('purchase.costRoseTitle')}
          maxWidth={640}
          hint={
            marginAlerts.some((row) => row.belowCost)
              ? t('purchase.costRoseBelowHint', { count: marginAlerts.filter((r) => r.belowCost).length })
              : t('purchase.costRoseHint', { count: marginAlerts.length })
          }
          footer={
            <>
              <button
                type="button"
                className="btn btn-primary btn-inline"
                disabled={applyingMargins || !marginAlerts.some((row) => row.suggestedPrice > 0)}
                onClick={applyMarginAlerts}
              >
                {applyingMargins ? t('common.saving') : t('purchase.applySuggestedPrices')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setMarginAlerts([])}>
                {t('purchase.keepMyPrices')}
              </button>
            </>
          }
        >
            <div className="table-wrap auto-height">
              <table className="data-table" style={{ minWidth: '600px' }}>
                <thead>
                  <tr>
                    <th>{t('seller.productName')}</th>
                    <th className="num">{t('purchase.costWas')}</th>
                    <th className="num">{t('purchase.costNow')}</th>
                    <th className="num">{t('purchase.sellingNow')}</th>
                    <th className="num">{t('purchase.marginNow')}</th>
                    <th className="num">{t('purchase.suggestedPrice')}</th>
                  </tr>
                </thead>
                <tbody>
                  {marginAlerts.map((row) => (
                    <tr key={row.productId}>
                      <td className="cell-strong">
                        {row.name}
                        {/* Selling below cost is a different fact from a thinner margin —
                            one is a squeeze, the other is a loss on every single sale. */}
                        {row.belowCost && <span className="cell-sub amount-out">{t('purchase.belowCost')}</span>}
                      </td>
                      <td className="num cell-muted">{formatRupees(row.previousCost, lang)}</td>
                      <td className="num cell-strong amount-out">{formatRupees(row.newCost, lang)}</td>
                      <td className="num">{formatRupees(row.sellingPrice, lang)}</td>
                      <td className="num">
                        <span className="cell-muted">{row.oldMarginPercent}%</span>
                        {' → '}
                        <span className={row.newMarginPercent <= 0 ? 'amount-out' : ''}>{row.newMarginPercent}%</span>
                      </td>
                      <td className="num cell-strong">
                        {row.suggestedPrice > 0 ? formatRupees(row.suggestedPrice, lang) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="field-hint">{t('purchase.suggestedPriceHint')}</p>
        </Modal>
      )}

      {/* The rates the bill carries, asked for at the counter because receiving cannot
          proceed without them. Opened by the 409 the server sends, not by a button. */}
      {rateFillOrder && (
        <RateFillSheet
          order={rateFillOrder}
          onClose={() => setRateFillOrder(null)}
          onFilled={async () => {
            const order = rateFillOrder;
            setRateFillOrder(null);
            // Straight back into the receive he was in the middle of, rather than making
            // him find the button again with the van still outside.
            await changeStatus(order, 'received', { skipConfirm: true });
          }}
        />
      )}

      {historyProductId && (
        <PriceHistorySheet productId={historyProductId} onClose={() => setHistoryProductId(null)} />
      )}

      {/* Asked once, right after receiving, and only when nothing else is already asking:
          two modals stacked on top of each other after a delivery is how a shopkeeper
          learns to dismiss both without reading either. */}
      {priceGaps.length === 0 && marginAlerts.length === 0 && packSuggestions.length > 0 && (
        <Modal
          onClose={() => setPackSuggestions([])}
          title={t('purchase.packFoundTitle')}
          hint={t('purchase.packFoundHint', { count: packSuggestions.length })}
          footer={
            <>
              <button type="button" className="btn btn-primary btn-inline" disabled={applyingPrices} onClick={applyPackSuggestions}>
                {applyingPrices ? t('common.saving') : t('purchase.enableLooseSale')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setPackSuggestions([])}>
                {t('purchase.notNow')}
              </button>
            </>
          }
        >
            <div className="table-wrap auto-height" style={{ maxHeight: '320px' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('seller.productName')}</th>
                    <th>{t('purchase.pack')}</th>
                    <th className="num">{t('purchase.packHolds')}</th>
                  </tr>
                </thead>
                <tbody>
                  {packSuggestions.map((pack) => (
                    <tr key={pack.productId}>
                      <td className="cell-strong">{pack.name}</td>
                      <td className="cell-muted">{pack.packLabel}</td>
                      <td className="num cell-strong">
                        {pack.subUnitsPerUnit} {t(`units.${pack.subUnit}`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </Modal>
      )}

      <BillScanModal open={scanOpen} onClose={() => setScanOpen(false)} onScanned={applyScan} />

      {/* Both open ON TOP of the order form and leave it mounted underneath. That is the
          whole point of them: the order — twenty lines, six batch numbers and a scan the
          shop paid for — is still there when they close. */}
      {supplierDraft && (
        <SupplierQuickAdd
          prefill={supplierDraft.prefill}
          fromBill={supplierDraft.fromBill}
          onClose={() => setSupplierDraft(null)}
          onCreated={onSupplierCreated}
        />
      )}

      {catalogDraft && (
        <CatalogQuickAdd lines={catalogDraft} onClose={() => setCatalogDraft(null)} onCreated={onProductsCreated} />
      )}

      {/* The same attachment manager the order's own detail page uses, opened straight off
          the register row — a shopkeeper flipping through a stack of paper bills shouldn't
          have to open each order fully just to file its copy. */}
      {attachOrder && (
        <Modal
          onClose={() => setAttachOrder(null)}
          title={t('purchase.billCopyTitle')}
          hint={`${attachOrder.label}${attachOrder.supplier?.name ? ` · ${attachOrder.supplier.name}` : ''}`}
        >
          <InvoiceAttachments orderId={attachOrder._id} attachments={attachOrder.attachments || []} onChange={load} />
        </Modal>
      )}
    </>
  );
}
