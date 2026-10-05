'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch, API_URL, downloadFile } from '../../../lib/api';
import { useDashboardUser, useHiddenNav } from '../../components/DashboardShell';
import { useLanguage } from '../../components/LanguageProvider';
import { PhotoFallback } from '../../components/CategoryArt';
import { formatQty, formatRupees } from '../../../lib/format';
import { apiErrorMessage } from '../../../lib/apiErrors';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { startBarcodeScanner } from '../../../lib/barcodeScanner';
import { parseScan } from '../../../lib/scanCode';
import { Pagination, usePagination } from '../../components/Pagination';
import { SortHeader, useSort } from '../../components/DataTable';
import {
  PlusIcon,
  UploadIcon,
  TrashIcon,
  SlidersIcon,
  XIcon,
  PackageIcon,
  RupeeIcon,
  AlertIcon,
  ClockIcon,
  SearchIcon,
  EditIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  RowsIcon,
  ListIcon,
  EyeIcon,
  EyeOffIcon,
  RefreshIcon,
  DownloadIcon,
  LayersIcon,
  TagIcon,
  ClipboardIcon,
  TruckIcon,
  BarcodeIcon,
  FilterClearIcon,
} from '../../components/Icons';
import StockTake from '../../components/StockTake';
import { syncStockTakeQueue, stockTakeQueueCount } from '../../../lib/stockTakeQueue';
import VariantBuilder from '../../components/VariantBuilder';
import BatchManager from '../../components/BatchManager';
import RecipeEditor, { recipePayload, recipeProblem } from '../../components/RecipeEditor';
import { recipeUnitChoices, recipeUnitFactor } from '../../../lib/recipeUnits';
import KitchenStock from '../../components/KitchenStock';
import { SkeletonStats, SkeletonTable } from '../../components/Skeleton';
import DataLoadNotice from '../../components/DataLoadNotice';
import Dropdown from '../../components/Dropdown';
import Modal from '../../components/Modal';
import {
  gstRateOptions,
  SERVICE_UNITS,
  UNITS,
  SUB_UNIT_SUGGESTIONS,
  defaultPackSize,
  packSizeOf,
  subUnitPriceOf,
  splitPackStock,
  formatSubUnitPrice,
  unitOptions,
  isLegacyGstSlab,
} from '../../../lib/catalog';
import { businessType, businessTypeOptions, tradeUses, DEFAULT_BUSINESS_TYPE } from '../../../lib/businessTypes';
import Illustration from '../../components/Illustration';
import ImportProgress, { importAddedNothing } from '../../components/ImportProgress';
import { fetchProductImportPreview } from '../../../lib/productImportPreview';
import { recordHref } from '../../../lib/routeId';

const ADJUSTMENT_TYPES = ['damage', 'theft', 'self_use', 'correction'];
// Mirrors MAX_IMPORT_BYTES in backend/utils/uploadGuard.js. If one moves, move both —
// a browser that allows more than the server does is a 413 with no explanation.
const IMPORT_MAX_MB = 2;

/**
 * Failures after which the import may STILL BE RUNNING on the server.
 *
 * Node cannot cancel work already in flight, so a request that timed out, dropped or was
 * told "already being saved" has not been undone — it has only stopped being watched. The
 * card has to say so, because the obvious next move after an error is to press Import
 * again, and doing that while the first copy is still inserting rows is how a shop ends up
 * with its whole catalog twice.
 */
const MAY_STILL_BE_RUNNING = new Set(['REQUEST_TIMEOUT', 'NETWORK_UNREACHABLE', 'IDEMPOTENCY_IN_PROGRESS']);
const DENSITY_KEY = 'dukaan_table_density';
// A shop that routinely fills in GST/HSN/barcode on every product had to click "More
// details" open on every single add — remembered per-browser so it opens the way this
// shop actually uses it, not collapsed back to the first-time default every time.
const ADVANCED_PREF_KEY = 'dukaan_addproduct_advanced';

const CATEGORY_COLORS = [
  { bg: '#ffe4cc', color: '#7c2d12' },
  { bg: '#dbeafe', color: '#1e3a8a' },
  { bg: '#fef3c7', color: '#78350f' },
  { bg: '#dcfce7', color: '#14532d' },
  { bg: '#fae8ff', color: '#701a75' },
  { bg: '#e2e8f0', color: '#1e293b' },
];

function categoryStyle(category) {
  if (!category) return undefined;
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  const { bg, color } = CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
  return { background: bg, color };
}

const BASE_FORM = {
  name: '',
  // What the customer reads on the storefront's product sheet. It had a column in the
  // schema, a slot on the customer app ("No description added for this item.") and a
  // barcode lookup writing into it — and no box anywhere in the dashboard, so every
  // description ever fetched off a scan was dropped on save.
  description: '',
  // 'goods' sits on a shelf and has stock; 'service' is sold and billed the same way but
  // is never out of stock and never expires — a haircut, a wash cycle, an hour of tuition.
  kind: 'goods',
  durationMinutes: '30',
  unit: 'piece',
  price: '',
  mrp: '',
  costPrice: '',
  gstRate: '0',
  barcode: '',
  // Every other code the same pack answers to — the QR printed next to the barcode, the
  // wholesaler's carton code, an old code from before the pack changed.
  altCodes: [],
  stock: '',
  // Never edited here — carried so the Stock box knows to stand down. A batch-tracked
  // product's stock is the sum of its lots and only the batch manager may move it.
  trackBatches: false,
  lowStockThreshold: '5',
  lowStockUnit: '',
  category: '',
  expiryDate: '',
  hsnCode: '',
  showInCatalog: true,
  photoUrl: '',
  batchNumber: '',
  warrantyMonths: '',
  drugSchedule: '',
  pricingMode: 'fixed',
  purity: '',
  grossWeight: '',
  netWeight: '',
  makingChargeType: 'percent',
  makingChargeValue: '',
  wastagePercent: '',
  hallmarkNumber: '',
  secondaryUnit: '',
  conversionFactor: '',
  subUnit: '',
  subUnitsPerUnit: '',
  subUnitPrice: '',
  priceTiers: [],
  recipe: [],
  recipeExtraCost: '',
  recipeYield: '',
  modifierGroups: [],
  parcelPrice: '',
  deliveryPrice: '',
};

// A blank form opens on whatever this trade actually sells in: a hardware shop starts on
// "piece @ 18%", a dairy on "litre @ 0%". Both are still fully editable — this only saves
// the shopkeeper from re-picking the same two dropdowns on every single product.
//
// A trade that runs on the appointment book (salon, tailor, laundry, tuition, gym, a
// repair counter) opens straight on "Service" instead — the first thing they add is
// almost always a menu item, not a stocked good.
function blankForm(type) {
  const config = businessType(type);
  return {
    ...BASE_FORM,
    kind: config.sellsServices ? 'service' : 'goods',
    unit: config.defaultUnit,
    gstRate: String(config.defaultGstRate),
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Which expiry date actually describes what is on the shelf right now.
 *
 * For a batch-tracked product it is its most urgent surviving lot (`nearestExpiry`, sent
 * down by the server) — `expiryDate` on the product itself was last written before tracking
 * began and describes a lot that may well have sold out months ago. Showing that stale date
 * is worse than showing none: the seller acts on it.
 *
 * Everything else keeps using `expiryDate`, exactly as before.
 */
function effectiveExpiry(product) {
  return product.trackBatches ? product.nearestExpiry || null : product.expiryDate || null;
}

// Buckets a product by how close its expiry date is, so the coloured badge, the expiry
// filter and the stat card can all share one definition.
function expiryStatus(expiryDate) {
  if (!expiryDate) return { key: 'none' };
  const days = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) return { key: 'expired', days: -days, className: 'badge-expired' };
  if (days <= 30) return { key: 'expiring', days, className: 'badge-expiring' };
  return { key: 'safe', days, className: 'badge-safe' };
}

// Same idea for stock: one bucket used by the filter dropdown, the row badge and the
// coloured dot, so "low" can never mean two different things on the same screen.
function stockStatus(product) {
  // A haircut is never out of stock. Services sit at 0 forever and would otherwise be
  // counted as "out" by this card and listed by the refill filter — the server's low-stock
  // count has always excluded them, which is half of why the two numbers disagreed.
  // A recipe dish has no shelf of its own — its ingredients do, and they are rows on this
  // same list with their own badges. Counting the dish too called every dish "out".
  // Checked before the service rule: a hotel that entered its menu as services still wants
  // "can make 5" on each item, not a duration badge.
  if (product.recipe?.length) return 'dish';
  if (product.kind === 'service') return 'na';
  const stock = sellableStock(product);
  if (stock <= 0) return 'out';
  if (stock <= Number(product.lowStockThreshold)) return 'low';
  return 'in';
}

// Same for expiry: 'atrisk' spans the two buckets that need doing something about.
function expiryMatches(product, filter) {
  const key = expiryStatus(effectiveExpiry(product)).key;
  if (filter === 'atrisk') return key === 'expiring' || key === 'expired';
  return key === filter;
}

// The filter reads a bucket, not a status, so 'refill' can span two of them.
function stockMatches(product, filter) {
  const key = stockStatus(product);
  if (key === 'na' || key === 'dish') return false;
  if (filter === 'refill') return key === 'low' || key === 'out';
  return key === filter;
}

/**
 * What a dish's stock cell says instead of "0 piece · Out of stock": how many the
 * ingredients on the shelf can make, and which one runs out first. One element.
 */
function DishStock({ product, t, lang, block = false }) {
  const n = product.servingsPossible;
  const limit = product.limitingIngredient?.name;
  const Tag = block ? 'div' : 'span';
  if (product.recipeMissing) {
    return <Tag className="dish-stock is-out">{t('recipe.dishMissing')}</Tag>;
  }
  if (n == null) return <Tag className="dish-stock">{t('recipe.madeToOrder')}</Tag>;
  return (
    <Tag className={`dish-stock${n === 0 ? ' is-out' : ''}`}>
      <span className={`stock-dot ${n === 0 ? 'out' : 'ok'}`} />
      <strong>{n === 0 ? t('recipe.dishCantMake') : t('recipe.dishCanMake', { n: formatQty(n, lang) })}</strong>
      {limit && (
        <span className="cell-sub">
          {n === 0 ? t('recipe.dishOutBecause', { name: limit }) : t('recipe.summaryLimit', { name: limit })}
        </span>
      )}
    </Tag>
  );
}

// The alert level's unit on the form, falling back to the stock unit whenever the chosen
// one no longer converts (the stock unit was just changed from kg to packet, say).
function alertUnitChoices(form) {
  return recipeUnitChoices({ unit: form.unit, subUnit: form.subUnit, subUnitsPerUnit: Number(form.subUnitsPerUnit) || 0 });
}
function alertUnitOf(form) {
  const choices = alertUnitChoices(form);
  return form.lowStockUnit && choices.includes(form.lowStockUnit) ? form.lowStockUnit : form.unit;
}
// Stock units per one alert unit (gram → kg is 0.001).
function alertFactor(form) {
  return recipeUnitFactor(alertUnitOf(form), { unit: form.unit, subUnit: form.subUnit, subUnitsPerUnit: Number(form.subUnitsPerUnit) || 0 }) || 1;
}
function alertForForm(product) {
  const level = Number(product.lowStockThreshold ?? 5);
  const factor = product.lowStockUnit ? recipeUnitFactor(product.lowStockUnit, product) : null;
  if (!factor) return { lowStockThreshold: String(level), lowStockUnit: '' };
  return { lowStockThreshold: String(Number((level / factor).toFixed(3))), lowStockUnit: product.lowStockUnit };
}

function sellableStock(product) {
  return product.trackBatches && typeof product.sellableStock === 'number'
    ? product.sellableStock
    : Number(product.stock) || 0;
}

/**
 * The second line under a stock figure for a product sold loose: "188 packet + 12 tablet".
 *
 * Stock is stored as one number in one unit, so a shelf that has had three tablets taken
 * out of it reads "188.8 packet" — correct, and useless to someone standing in front of
 * the shelf counting. Returns null for every ordinary product, which is most of them.
 */
function packStockLabel(product, t) {
  const split = splitPackStock(product, sellableStock(product));
  if (!split.packSize) return null;
  const unit = t(`units.${product.unit}`);
  const subUnit = t(`units.${product.subUnit}`);
  const packs = split.loose > 0
    ? t('pack.stockWithLoose', { packs: split.packs, unit, loose: split.loose, subUnit })
    : t('pack.stockPacks', { packs: split.packs, unit });
  return `${packs} · ${t('pack.stockTotalPieces', { total: split.subTotal.toLocaleString('en-IN'), subUnit })}`;
}

// 'atrisk' is the union of expiring and expired — the same reason 'refill' exists below:
// the stat card counts both and its click has to land on both.
const EXPIRY_FILTERS = ['all', 'atrisk', 'expiring', 'expired', 'none'];
const EXPIRY_FILTER_LABELS = {
  atrisk: 'expiry.atrisk',
  expiring: 'expiry.expiring',
  expired: 'expiry.expired',
  none: 'expiry.none',
};
// 'refill' is the union of low and out: the shelf that needs a purchase order. Every
// count the app shows for "low stock" — the dashboard card, the bell, the stat card on
// this page — is `quantity <= threshold`, which includes an item sitting at zero. Sending
// those clicks to the 'low' bucket alone showed a smaller list than the number they were
// on, so the number and the list disagreed on the same screen.
const STOCK_FILTERS = ['all', 'in', 'refill', 'low', 'out'];
const STOCK_FILTER_LABELS = {
  in: 'seller.stockIn',
  refill: 'seller.stockRefill',
  low: 'seller.stockLow',
  out: 'seller.stockOut',
};
// Deep-linked from Business Insights, where a margin cannot be shown because these
// products have no cost price. The link only earns its place if it lands on the exact
// list that needs fixing, so this is a real filter and not a decorated /seller/products.
const COST_FILTERS = ['all', 'missing'];

// Declared at module scope so useSort's memo dependency stays referentially stable —
// rebuilding this object every render would re-sort the whole list on every keystroke.
const SORT_ACCESSORS = {
  name: (p) => (p.name || '').toLowerCase(),
  hsn: (p) => p.hsnCode || '',
  price: (p) => Number(p.price) || 0,
  stock: sellableStock,
  value: (p) => (Number(p.price) || 0) * sellableStock(p),
  expiry: (p) => {
    const at = effectiveExpiry(p);
    return at ? new Date(at).getTime() : '';
  },
};

function money(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export default function SellerProductsPage() {
  // useSearchParams (for ?expiry= deep links) needs a Suspense boundary under
  // Next's App Router, matching the login page pattern.
  return (
    <Suspense fallback={null}>
      <SellerProductsPageInner />
    </Suspense>
  );
}

function SellerProductsPageInner() {
  const user = useDashboardUser();
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  // Staff inherit the shop owner's type (resolved in the /me handler), so a hardware
  // shop's counter staff get the same form defaults the owner does.
  const bizType = user?.businessType || DEFAULT_BUSINESS_TYPE;
  const biz = businessType(bizType);
  /**
   * This screen has two names.
   *
   * For a kirana it is the shelf. For a salon, a tailor, a gym it is the service menu — the
   * sidebar has said "Services" for a while (DashboardShell.navLabel), but the page it opened
   * still said "Inventory", "No products yet" and "Add your first product". A tailor sent here
   * to add a stitching rate arrives at a stock screen and reasonably concludes he is in the
   * wrong place. Same screen, same form; only the words follow the trade.
   */
  const serviceLed = biz.sellsServices;
  const hiddenNav = useHiddenNav();
  const [products, setProducts] = useState([]);
  // A kirana/dairy/vegetable shop never bills time — the Goods/Service choice only means
  // something to a trade that actually sells services. Shown anyway once the shop already
  // has a service product (someone switched business type after adding one), same rule as
  // backend/utils/navRelevance.js: hidden by trade, back the moment there's real data.
  const canToggleKind = biz.sellsServices || products.some((p) => p.kind === 'service');

  // Which optional product tools this trade actually sees. Each one stays hidden until it
  // belongs to the trade OR the shop already has data in it — so a kirana is never offered
  // "sizes and colours", and a shop that switches business type never loses what it built.
  // See tradeUses() in lib/businessTypes.js for why this matters more than tidiness.
  const showVariants = tradeUses(bizType, 'variants', products.some((p) => p.variantGroup));
  const showBatches = tradeUses(bizType, 'batches', products.some((p) => p.trackBatches));
  const showWarranty = tradeUses(bizType, 'warranty', products.some((p) => p.warrantyMonths > 0));
  // Schedule H/H1/X is a pharmacy's business and nobody else's — but it stays visible for
  // any shop that already has one set, the same escape hatch tradeUses() gives every tool.
  const showDrugSchedule = bizType === 'medical' || products.some((p) => p.drugSchedule);
  // A jeweller prices off the morning's gold rate, not off a number typed into `price`.
  // Shown for the jewellery trade, and for anyone already using it.
  const showWeightPricing = bizType === 'jewellery' || products.some((p) => p.pricingMode === 'weight');
  const showSecondaryUnit = tradeUses(bizType, 'secondaryUnit', products.some((p) => p.secondaryUnit));
  const showPriceTiers = tradeUses(bizType, 'priceTiers', products.some((p) => p.priceTiers?.length));
  const showRecipe = tradeUses(bizType, 'recipe', products.some((p) => p.recipe?.length && p.kind !== 'service'));
  // The same editor on a service: what a haircut or a wash uses up.
  const showServiceMaterials = tradeUses(bizType, 'serviceMaterials', products.some((p) => p.recipe?.length && p.kind === 'service'));
  const showModifiers = tradeUses(bizType, 'modifiers', products.some((p) => p.modifierGroups?.length));
  const showChannelPricing = tradeUses(bizType, 'channelPricing', products.some((p) => p.orderTypePricing?.parcel || p.orderTypePricing?.delivery));
  const showLooseSale = tradeUses(bizType, 'looseSale', products.some((p) => p.subUnit));
  const [form, setForm] = useState(BASE_FORM);
  // Whether the last group in "More details" has anything in it for THIS shop — see the
  // heading guard where it is used.
  const showsSellingGroup =
    showWarranty ||
    form.warrantyMonths ||
    (form.kind !== 'service' &&
      (showWeightPricing ||
        form.pricingMode === 'weight' ||
        showDrugSchedule ||
        form.drugSchedule ||
        showSecondaryUnit ||
        form.secondaryUnit ||
        showLooseSale ||
        form.subUnit));
  const [categoryFilter, setCategoryFilter] = useState('');
  const initialStock = STOCK_FILTERS.includes(searchParams.get('stock')) ? searchParams.get('stock') : 'all';
  const [stockFilter, setStockFilter] = useState(initialStock);
  // Deep-linked from the notification bell (?expiry=expiring / expired) so a tapped
  // expiry alert lands the seller straight on the filtered list.
  const initialExpiry = EXPIRY_FILTERS.includes(searchParams.get('expiry')) ? searchParams.get('expiry') : 'all';
  const [expiryFilter, setExpiryFilter] = useState(initialExpiry);
  const initialCost = COST_FILTERS.includes(searchParams.get('cost')) ? searchParams.get('cost') : 'all';
  const [costFilter, setCostFilter] = useState(initialCost);
  const [search, setSearch] = useState('');
  const [density, setDensity] = useState('comfortable');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [stockTakeOpen, setStockTakeOpen] = useState(false);
  const [kitchenOpen, setKitchenOpen] = useState(false);
  // Products still on a pre-GST-2.0 slab (12% / 28%) — see the banner above the list.
  const legacyGstProducts = useMemo(
    () => products.filter((p) => p.status !== 'archived' && isLegacyGstSlab(p.gstRate)),
    [products]
  );
  // Which bulk edit the selection bar is asking a value for: 'price' | 'category' |
  // 'lowStock'. One panel at a time — a bar with three open forms in it is a form, and a
  // selection bar has to stay readable at a glance.
  const [bulkPanel, setBulkPanel] = useState(null);
  const [bulkPriceMode, setBulkPriceMode] = useState('percent');
  const [bulkValue, setBulkValue] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  // The add-product modal starts on just the fields a first-time entry actually needs —
  // everything else (GST, HSN, barcode, expiry...) is one tap away, not thrown at the
  // seller all at once. Editing an existing item opens it expanded since that data may
  // already be filled in and shouldn't be hidden from the person who entered it.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [variantOpen, setVariantOpen] = useState(false);
  const [batchProduct, setBatchProduct] = useState(null);
  const [ledgerProduct, setLedgerProduct] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  // What the Stock box was filled with when the form opened, so saving can tell "the seller
  // retyped this" from "the seller never touched it". See handleSubmit for why that matters.
  const [openingStock, setOpeningStock] = useState('');
  const [error, setError] = useState('');
  // Kept apart from `error` above, which renders on the PAGE — behind the very dialog the
  // shopkeeper is looking at. A refused save (duplicate barcode, a price the server won't
  // take) left the form sitting open with nothing on it changed and nothing said, which is
  // indistinguishable from "the button does nothing". Same fix the staff form already has.
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [adjustProduct, setAdjustProduct] = useState(null);
  const [adjustments, setAdjustments] = useState([]);
  /**
   * Where the import dialog is: 'idle' (the three numbered steps), 'running' (the progress
   * card) or 'done' (the same card, holding the count).
   *
   * One value rather than a pile of booleans because the three are mutually exclusive and
   * the dialog's width, its close button and its footer all read off it. `importStage` is
   * which of the three lines on the running card is current, and it is moved only by real
   * events — see handleImportFile.
   */
  const [importPhase, setImportPhase] = useState('idle');
  const [importStage, setImportStage] = useState(0);
  // Name and size of the sheet being sent, so the card can show the seller their own file
  // rather than a spinner. Not the File object: nothing here needs the bytes again.
  const [importFile, setImportFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState('');
  // Whether the refused rows are expanded on the finished card. Collapsed by default: on a
  // clean run there is nothing behind it, and on a messy one the count comes first.
  const [importDetails, setImportDetails] = useState(false);
  /**
   * A run that broke, as opposed to a run that finished badly.
   *
   * Held apart from `importError`, which is the red banner on the INSTRUCTIONS screen and
   * belongs to the checks that happen before anything is sent — wrong file type, too big.
   * Once the sheet is on its way, bouncing back to a screen of numbered steps with a line
   * of English server text over it throws away the two things the shopkeeper needs most:
   * where it broke, and whether any of their catalog changed. So that failure gets a card.
   *
   * `reached` is the whole point of the shape: it records whether the bytes actually left
   * the device, because "nothing was sent, try again" and "it is on the server and may
   * still be running" are opposite instructions and look identical from here.
   */
  const [importFail, setImportFail] = useState(null);
  // What the server said the sheet WOULD do, held on screen while the seller decides.
  const [importPreview, setImportPreview] = useState(null);
  const [importStockMode, setImportStockMode] = useState('keep');
  const [importPriceMode, setImportPriceMode] = useState('keep');
  const [importResolutions, setImportResolutions] = useState({});
  const [importReviewBusy, setImportReviewBusy] = useState(false);
  const importWritingRef = useRef(false);
  const importPreviewRequestRef = useRef(false);
  const [importCooldown, setImportCooldown] = useState({ preview: 0, write: 0 });
  const [importClock, setImportClock] = useState(() => Date.now());
  const previewWait = Math.max(0, Math.ceil((importCooldown.preview - importClock) / 1000));
  const writeWait = Math.max(0, Math.ceil((importCooldown.write - importClock) / 1000));
  useEffect(() => {
    setImportClock(Date.now());
    if (!importOpen || Math.max(importCooldown.preview, importCooldown.write) <= Date.now()) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setImportClock(now);
      if (now >= Math.max(importCooldown.preview, importCooldown.write)) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [importOpen, importCooldown]);

  function pauseImport(err, kind) {
    const seconds = Math.max(1, Math.ceil(Number(err.retryAfter) || 60));
    const now = Date.now();
    setImportClock(now);
    setImportCooldown((previous) => ({ ...previous, [kind]: now + seconds * 1000 }));
  }
  /**
   * The encoded sheet, kept between the preview and the confirm.
   *
   * A ref, not state: it is up to two megabytes of base64 that nothing renders, and putting
   * it in state would re-render a page holding five thousand product rows for no reason.
   * Cleared on every way out, so a dialog abandoned halfway does not leave the last sheet
   * sitting in memory for the rest of the session.
   */
  const importBytesRef = useRef(null);
  // Which trade the sample file is filled with. Starts on this shop's own business type —
  // a chemist should never have to pick "Medical" to be shown strips — but stays changeable,
  // because a shop signed up as "Something else" and a shop that sells two things both
  // exist, and neither should be handed a kirana's sheet.
  const [sampleType, setSampleType] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  // 'barcode' (the main box) or 'altCode' (one more code this pack answers to). One camera,
  // one reader — this only says where the result goes.
  const [scanTarget, setScanTarget] = useState('barcode');
  // What is being typed into the extra-codes box before it becomes a chip.
  const [altCodeDraft, setAltCodeDraft] = useState('');
  const [lookingUpBarcode, setLookingUpBarcode] = useState(false);
  // What other shops charge for the scanned barcode. Held apart from `form` on purpose:
  // it is something offered, not something entered, and it disappears the moment it is
  // used or the form is closed.
  const [priceHint, setPriceHint] = useState(null);
  const scannerRef = useRef(null);
  const searchRef = useRef(null);

  // Returns the promise. Nothing used to, and nothing needed to — until the import card
  // grew a "Finalizing import" step, which is only honest if it ends when the catalog
  // behind the dialog has really come back.
  function load() {
    setLoading(true);
    setLoadError('');
    return apiFetch('/api/seller/products')
      .then((data) => setProducts(data.products))
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }

  function loadAdjustments() {
    apiFetch('/api/seller/stock-adjustments')
      .then((data) => setAdjustments(data.adjustments))
      .catch(() => {});
  }

  /**
   * Sends up any stock count that was finished while the device had no signal.
   *
   * Runs on open and again the moment the connection returns, so a count taken in the
   * godown lands without the shopkeeper having to remember it is pending. Safe to replay
   * late: each row carries the quantity the device saw, and the server applies that
   * difference rather than overwriting today's stock with an hour-old absolute number.
   */
  async function flushStockTakeQueue() {
    if (stockTakeQueueCount() === 0) return;
    const { synced, failures } = await syncStockTakeQueue((payload) =>
      apiFetch('/api/seller/stock-take', { method: 'POST', body: JSON.stringify(payload) })
    );
    if (synced > 0) {
      toast.success(t('stockTake.syncedTitle'), { detail: t('stockTake.syncedHint', { count: synced }) });
      load();
      loadAdjustments();
    }
    for (const message of failures) toast.error(message);
  }

  // `?edit=<id>` opens that product's form straight away — the detail page's Edit button
  // links here rather than carrying a second copy of the form and a second set of
  // validation rules. Waits for the catalog, since the form is filled from it.
  const editParam = searchParams.get('edit');
  // Consumed once per id, and taken out of the address bar with it. `products` is a
  // dependency because the form is filled from the catalog, and every save, delete and bulk
  // action ends by reloading the catalog — so with the parameter still sitting in the URL
  // this effect fired again and reopened the form the seller had just closed. From the
  // counter that reads as "maine save dabaya aur kuch hua hi nahi".
  const consumedEditParam = useRef(null);
  useEffect(() => {
    if (!editParam || products.length === 0 || consumedEditParam.current === editParam) return;
    const product = products.find((p) => p._id === editParam);
    if (!product) return;
    consumedEditParam.current = editParam;
    openEditForm(product);
    const url = new URL(window.location.href);
    url.searchParams.delete('edit');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, products]);

  /**
   * `?new=1` opens the blank form.
   *
   * Three places already linked here with it — the command palette's "Add product", the
   * getting-started checklist, and the appointment book's "set up your service menu first"
   * — and none of them worked, because the parameter was never read. Every one of them
   * landed the shopkeeper on a list he had just been told was empty, with the button he
   * needed somewhere at the top of it. Consumed once and stripped from the URL, same as
   * `?edit=`, so a later save can't reopen it.
   */
  // `?view=kitchen` — the deep link the Tables screen and the command palette use to land
  // straight on Kitchen stock. Consumed once and stripped, like `?new=`.
  const viewParam = searchParams.get('view');
  const consumedViewParam = useRef(false);
  useEffect(() => {
    if (viewParam !== 'kitchen' || consumedViewParam.current) return;
    consumedViewParam.current = true;
    setKitchenOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, [viewParam]);

  const newParam = searchParams.get('new');
  const consumedNewParam = useRef(false);
  useEffect(() => {
    if (!newParam || consumedNewParam.current) return;
    consumedNewParam.current = true;
    openAddForm();
    const url = new URL(window.location.href);
    url.searchParams.delete('new');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newParam]);

  useEffect(() => {
    load();
    loadAdjustments();
    flushStockTakeQueue();
    // A count finished in the godown should land the moment the phone finds signal again,
    // without the shopkeeper having to remember it is waiting.
    const onOnline = () => flushStockTakeQueue();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Row height is a personal preference that should survive a reload — a seller who
  // wants 40 rows on screen shouldn't have to re-pick it every visit.
  useEffect(() => {
    const stored = localStorage.getItem(DENSITY_KEY);
    if (stored === 'compact' || stored === 'comfortable') setDensity(stored);
  }, []);

  function changeDensity(next) {
    setDensity(next);
    localStorage.setItem(DENSITY_KEY, next);
  }

  // "/" focuses search from anywhere on the page, the same shortcut billing already uses.
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey) return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort(),
    [products]
  );

  // The loose-unit picker opens on what this stocking unit is usually broken into — a
  // packet offers tablet, capsule, piece; a kilo offers gram. Everything else follows
  // below rather than being removed, because trades invent their own packs and the app
  // has no business refusing "one bag = 40 piece".
  const looseUnitOptions = useMemo(() => {
    const suggested = (SUB_UNIT_SUGGESTIONS[form.unit] || []).filter((unit) => unit !== form.unit);
    const rest = UNITS.filter((unit) => unit !== form.unit && !suggested.includes(unit) && !SERVICE_UNITS.includes(unit));
    return [...suggested, ...rest].map((unit) => ({ value: unit, label: t(`units.${unit}`) }));
  }, [form.unit, t]);

  // What the form currently adds up to, or null while it's still half-answered. Uses the
  // same helpers the server does, so the price previewed here is the price billed.
  const packPreview = useMemo(() => {
    const draft = { unit: form.unit, subUnit: form.subUnit, subUnitsPerUnit: Number(form.subUnitsPerUnit), subUnitPrice: Number(form.subUnitPrice) || undefined };
    const size = packSizeOf(draft);
    if (!size) return null;
    return { size, price: subUnitPriceOf(draft, Number(form.price) || 0) };
  }, [form.unit, form.subUnit, form.subUnitsPerUnit, form.subUnitPrice, form.price]);

  /**
   * What the preview strip at the top of the form says, derived from what has been typed so
   * far. Both are deliberately null/0 until the numbers that make them meaningful exist —
   * a "0% margin" chip on an empty form would be noise, and a wrong one at that.
   */
  const previewSaving = useMemo(() => {
    const mrp = Number(form.mrp) || 0;
    const price = Number(form.price) || 0;
    return mrp > price ? mrp - price : 0;
  }, [form.mrp, form.price]);

  const previewMargin = useMemo(() => {
    const cost = Number(form.costPrice) || 0;
    const price = Number(form.price) || 0;
    if (cost <= 0 || price <= 0) return null;
    // Margin on the selling price, which is how a shopkeeper reads it ("sau rupaye bikta
    // hai, bees bachta hai") — not markup on cost, which flatters the number.
    return { amount: price - cost, percent: ((price - cost) / price) * 100 };
  }, [form.costPrice, form.price]);

  // An empty `subUnitPrice` is not a missing answer — it is the answer "just divide the
  // pack price", which is what almost every shop means and what the server does with it.
  //
  // Whether the override BOX is open is deliberately its own state rather than derived
  // from the field being non-empty: derived, the input would vanish the moment someone
  // selected its contents and hit backspace, halfway through retyping a price.
  const [priceOverrideOpen, setPriceOverrideOpen] = useState(false);

  // Opening it seeds the box with the price the app worked out, so a shop that wants ₹4 a
  // tablet edits 3.67 rather than typing into an empty field with no idea what the fair
  // number was. Closing it hands the number back to the app.
  function togglePriceOverride() {
    setPriceOverrideOpen((open) => {
      if (open) setForm((f) => ({ ...f, subUnitPrice: '' }));
      else if (packPreview) setForm((f) => ({ ...f, subUnitPrice: packPreview.price.toFixed(2) }));
      return !open;
    });
  }

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryFilter && p.category !== categoryFilter) return false;
      if (expiryFilter !== 'all' && !expiryMatches(p, expiryFilter)) return false;
      if (stockFilter !== 'all' && !stockMatches(p, stockFilter)) return false;
      // A service priced by labour has no cost price to enter and would sit in this
      // list forever, so it is not "missing" — only stocked goods are.
      if (costFilter === 'missing' && (p.kind === 'service' || Number(p.costPrice) > 0)) return false;
      if (!q) return true;
      return (
        p.name?.toLowerCase().includes(q) ||
        p.barcode?.toLowerCase().includes(q) ||
        // A code pasted or scanned into this box may be one of the product's other codes —
        // the QR's value, the carton code — and searching for it should still find the row.
        p.altCodes?.some((code) => code.toLowerCase().includes(q)) ||
        p.hsnCode?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q)
      );
    });
  }, [products, categoryFilter, expiryFilter, stockFilter, costFilter, search]);

  const { sorted, sort, toggle } = useSort(filteredProducts, SORT_ACCESSORS, { key: 'name', dir: 'asc' });

  const filterKey = `${search}|${categoryFilter}|${stockFilter}|${expiryFilter}|${costFilter}`;
  const page = usePagination(sorted, { pageSize: 25, resetKey: filterKey });

  // A selection that survives a filter change would let a seller delete rows they can no
  // longer see — clearing it keeps "delete selected" honest about its scope.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filterKey]);

  const counts = useMemo(() => {
    const result = {
      expiry: { all: products.length, atrisk: 0, expiring: 0, expired: 0, none: 0 },
      stock: { all: products.length, in: 0, refill: 0, low: 0, out: 0 },
      totalValue: 0,
    };
    for (const p of products) {
      const expiryKey = expiryStatus(effectiveExpiry(p)).key;
      if (result.expiry[expiryKey] !== undefined && expiryKey !== 'all') result.expiry[expiryKey] += 1;
      if (expiryKey === 'expiring' || expiryKey === 'expired') result.expiry.atrisk += 1;
      const stockKey = stockStatus(p);
      if (result.stock[stockKey] !== undefined) result.stock[stockKey] += 1;
      if (stockKey === 'low' || stockKey === 'out') result.stock.refill += 1;
      result.totalValue += (Number(p.price) || 0) * sellableStock(p);
    }
    return result;
  }, [products]);

  const lowOrOut = counts.stock.refill;
  const totalSellableStock = products
    .filter((product) => product.kind !== 'service' && !product.recipe?.length)
    .reduce((sum, product) => sum + sellableStock(product), 0);
  const expiringOrExpired = counts.expiry.atrisk;

  const [hsnSuggestions, setHsnSuggestions] = useState([]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  // Dropdown (the custom, non-native <select> replacement) hands back a value directly
  // instead of an event, so it needs its own setter shaped that way.
  function setField(field) {
    return (value) => setForm((f) => ({ ...f, [field]: value }));
  }

  // Picking the loose unit fills in the pack size when the answer is a fact rather than a
  // choice — a kilo is a thousand grams, a dozen is twelve. Nobody should be made to
  // confirm that. Anything the app can't know (tablets in a strip) is left blank for the
  // shop to type, which is also the only field that then needs their attention.
  function setSubUnit(value) {
    setForm((f) => {
      const known = defaultPackSize(f.unit, value);
      return { ...f, subUnit: value, subUnitsPerUnit: value ? (known ? String(known) : f.subUnitsPerUnit) : '', subUnitPrice: value ? f.subUnitPrice : '' };
    });
  }

  function openAddForm() {
    setForm(blankForm(bizType));
    setEditingId(null);
    setOpeningStock('');
    setPriceOverrideOpen(false);
    setPriceHint(null);
    setHsnSuggestions([]);
    setFormError('');
    let rememberedOpen = false;
    try {
      rememberedOpen = localStorage.getItem(ADVANCED_PREF_KEY) === '1';
    } catch {
      rememberedOpen = false;
    }
    setAdvancedOpen(rememberedOpen);
    setFormOpen(true);
  }

  // Pre-fills the shared modal with an existing product so the seller can fix price,
  // stock, category, photo — anything — instead of deleting and re-adding.
  function openEditForm(product) {
    setForm({
      name: product.name || '',
      description: product.description || '',
      kind: product.kind || 'goods',
      durationMinutes: String(product.durationMinutes || 30),
      unit: product.unit || 'piece',
      price: product.price ?? '',
      mrp: product.mrp ?? '',
      costPrice: product.costPrice ?? '',
      gstRate: String(product.gstRate ?? '0'),
      barcode: product.barcode || '',
      altCodes: product.altCodes || [],
      stock: product.stock ?? '',
      trackBatches: Boolean(product.trackBatches),
      // Shown back in the unit it was set in: 0.5 kg set as "500 gram" reads "500 gram".
      ...alertForForm(product),
      category: product.category || '',
      expiryDate: product.expiryDate ? product.expiryDate.slice(0, 10) : '',
      hsnCode: product.hsnCode || '',
      showInCatalog: product.showInCatalog ?? true,
      photoUrl: product.photoUrl || '',
      batchNumber: product.batchNumber || '',
      warrantyMonths: product.warrantyMonths ?? '',
      drugSchedule: product.drugSchedule || '',
      pricingMode: product.pricingMode || 'fixed',
      purity: product.purity || '',
      grossWeight: product.grossWeight ?? '',
      netWeight: product.netWeight ?? '',
      makingChargeType: product.makingChargeType || 'percent',
      makingChargeValue: product.makingChargeValue ?? '',
      wastagePercent: product.wastagePercent ?? '',
      hallmarkNumber: product.hallmarkNumber || '',
      secondaryUnit: product.secondaryUnit || '',
      conversionFactor: product.conversionFactor ?? '',
      subUnit: product.subUnit || '',
      subUnitsPerUnit: product.subUnitsPerUnit ?? '',
      subUnitPrice: product.subUnitPrice ?? '',
      priceTiers: (product.priceTiers || []).map((t2) => ({ minQty: String(t2.minQty), price: String(t2.price) })),
      // `amount`/`unit` are what the cook typed. An older line has neither, and its
      // `quantity` was always in the ingredient's stock unit — shown as exactly that.
      recipe: (product.recipe || []).map((r) => ({
        product: r.product?._id || r.product,
        amount: String(r.amount ?? r.quantity),
        unit: r.unit || '',
      })),
      recipeExtraCost: product.recipeExtraCost ?? '',
      recipeYield: product.recipeYield ?? '',
      parcelPrice: product.orderTypePricing?.parcel ?? '',
      deliveryPrice: product.orderTypePricing?.delivery ?? '',
      modifierGroups: (product.modifierGroups || []).map((g) => ({
        name: g.name,
        required: Boolean(g.required),
        multiple: Boolean(g.multiple),
        options: (g.options || []).map((o) => ({ name: o.name, priceDelta: String(o.priceDelta ?? 0) })),
      })),
    });
    // A product that carries its own loose price opens with that box already showing —
    // otherwise the shop would see "auto" next to a price that isn't the auto one.
    setOpeningStock(product.stock ?? '');
    setPriceOverrideOpen(product.subUnitPrice !== undefined && product.subUnitPrice !== null);
    setPriceHint(null);
    setEditingId(product._id);
    setHsnSuggestions([]);
    setFormError('');
    setAdvancedOpen(true);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setOpeningStock('');
    setForm(blankForm(bizType));
    setPriceOverrideOpen(false);
    setPriceHint(null);
    setHsnSuggestions([]);
    setFormError('');
    setAdvancedOpen(false);
  }

  function clearFilters() {
    setSearch('');
    setCategoryFilter('');
    setStockFilter('all');
    setExpiryFilter('all');
    setCostFilter('all');
  }

  const filtersActive =
    Boolean(search.trim()) || Boolean(categoryFilter) || stockFilter !== 'all' || expiryFilter !== 'all' || costFilter !== 'all';

  function toggleRow(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Select-all deliberately covers the current page only. Selecting 400 invisible rows
  // from one checkbox is how people delete their whole catalogue by accident.
  const pageIds = page.pageItems.map((p) => p._id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected = pageIds.some((id) => selectedIds.has(id));

  function toggleAllOnPage() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function handlePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setForm((f) => ({ ...f, photoUrl: dataUrl }));
  }

  // Only fills in fields the seller hasn't already typed something into — price/stock
  // are never touched since no external database can know what this shop charges.
  /**
   * What a scanned barcode can tell us, from two very different sources.
   *
   * The public food database fills the descriptive fields, and only the ones still empty —
   * it must never overwrite something the shopkeeper typed. It is switched off server-side
   * for a chemist entirely; see lookupBarcodeExternal for why a crowd-edited food database
   * has no business pre-filling a medicine.
   *
   * The price is NOT filled in. It comes from what other shops on Dukaan charge for the
   * same barcode, which is a good suggestion and a terrible default: a price that appears
   * by itself is a price nobody checked. It is offered as something to tap.
   */
  async function lookupExternalBarcode(code) {
    if (!code) return;
    setLookingUpBarcode(true);
    setPriceHint(null);
    try {
      const [info, hint] = await Promise.allSettled([
        apiFetch(`/api/seller/products/barcode-info?code=${encodeURIComponent(code)}`),
        apiFetch(`/api/seller/products/price-hint?code=${encodeURIComponent(code)}`),
      ]);

      const data = info.status === 'fulfilled' ? info.value : null;
      if (data?.found) {
        setForm((f) => ({
          ...f,
          name: f.name || data.name || f.name,
          category: f.category || data.category || f.category,
          photoUrl: f.photoUrl || data.imageUrl || f.photoUrl,
          // Net quantity and ingredients — "what's actually in it" — go into the
          // description, which is a field a human reads and edits before saving. They are
          // never parsed into unit or pack size: net weight and pack size are different
          // questions, and guessing one from the other would mis-state what is being sold.
          description: f.description || [data.netQuantity, data.ingredients].filter(Boolean).join(' · ') || f.description,
        }));
      }

      if (hint.status === 'fulfilled' && hint.value?.found) setPriceHint(hint.value);
    } catch {
      // Public database unreachable — seller can still fill the form by hand.
    } finally {
      setLookingUpBarcode(false);
    }
  }

  function applyPriceHint() {
    if (!priceHint) return;
    setForm((f) => ({ ...f, price: String(priceHint.price) }));
    setPriceHint(null);
  }

  /**
   * Adds one more code this product answers to.
   *
   * Stores what is INSIDE the symbol, not the symbol's whole payload: the QR on a pack is
   * usually a GS1 Digital Link, and saving sixty characters of URL would never match the
   * plain GTIN a counter scan produces later. A QR that is only a link (a brand's website)
   * is kept as it is — it is still a unique string this pack answers to.
   */
  function addAltCode(value) {
    /*
     * The shop's scale layout is passed in here for a reason that is easy to miss and
     * expensive to get wrong.
     *
     * The natural way to teach the app a kaanta's item number is to weigh something, take
     * the sticker off it and scan it into this very box. Without the layout, `parseScan`
     * has no way to know that is what happened and stores all thirteen digits —
     * "2012345057500" — which contains THAT packet's price and can therefore never match
     * again. The shopkeeper would have set it up exactly as instructed, watched it work
     * once on the packet in his hand, and found it broken on the next one.
     *
     * With the layout, the same scan stores "12345", which is the part that does not
     * change. Same box, same gun, same gesture — see the hint under the field.
     */
    const scan = parseScan(value, { scale: user?.billingSettings?.scaleBarcode });
    const code = (scan.code || String(value || '').trim()).slice(0, 120);
    if (!code) return;
    setForm((f) => {
      if (code === f.barcode || (f.altCodes || []).includes(code)) return f;
      // The first code scanned into a blank form belongs in the barcode box, not the extras.
      if (!f.barcode) return { ...f, barcode: code };
      return { ...f, altCodes: [...(f.altCodes || []), code].slice(0, 10) };
    });
    setAltCodeDraft('');
  }

  function removeAltCode(code) {
    setForm((f) => ({ ...f, altCodes: (f.altCodes || []).filter((entry) => entry !== code) }));
  }

  /**
   * `scanTarget` decides where a camera read lands: the main barcode box (and a public
   * lookup off it), or the extra-codes list. Same camera, same reader — the difference is
   * only what the shopkeeper pressed.
   */
  function openBarcodeScanner(target = 'barcode') {
    setScanTarget(target);
    setScannerOpen(true);
    setTimeout(async () => {
      try {
        const scanner = await startBarcodeScanner({
          elementId: 'product-barcode-scanner-viewport',
          onDecode: (decodedText) => {
            setScannerOpen(false);
            if (target === 'altCode') {
              addAltCode(decodedText);
              return;
            }
            // A QR can say more than a number. Our own shelf sticker names a product by id
            // (nothing to type into a form — the shopkeeper is looking at a product they
            // already have), and a GS1 symbol carries the GTIN plus batch and expiry, which
            // belong in their own fields rather than mashed into the barcode box.
            const scan = parseScan(decodedText);
            if (scan.kind === 'link' || (scan.productId && !scan.code)) {
              setFormError(t('seller.scanNotAProduct'));
              return;
            }
            const code = scan.code || decodedText;
            setForm((f) => ({
              ...f,
              barcode: code,
              batchNumber: scan.batch || f.batchNumber,
              expiryDate: scan.expiry || f.expiryDate,
            }));
            lookupExternalBarcode(code);
          },
        });
        scannerRef.current = scanner;
      } catch (err) {
        setFormError(t('seller.scanCameraFailed', { reason: err?.message || String(err) }));
        setScannerOpen(false);
      }
    }, 50);
  }

  function closeBarcodeScanner() {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
    }
    setScannerOpen(false);
  }

  async function handleSuggestHsn() {
    if (!form.name && !form.category) return;
    try {
      const data = await apiFetch(`/api/seller/products/hsn-suggest?q=${encodeURIComponent(form.category || form.name)}`);
      setHsnSuggestions(data.suggestions);
      if (data.suggestions[0]) {
        setForm((f) => ({ ...f, hsnCode: data.suggestions[0].code }));
      }
    } catch {
      setHsnSuggestions([]);
    }
  }

  function addPriceTier() {
    setForm((f) => ({ ...f, priceTiers: [...f.priceTiers, { minQty: '', price: '' }] }));
  }
  function updatePriceTier(index, key, value) {
    setForm((f) => ({ ...f, priceTiers: f.priceTiers.map((row, i) => (i === index ? { ...row, [key]: value } : row)) }));
  }
  function removePriceTier(index) {
    setForm((f) => ({ ...f, priceTiers: f.priceTiers.filter((_, i) => i !== index) }));
  }

  function setRecipe(lines) {
    setForm((f) => ({ ...f, recipe: lines }));
  }

  /**
   * A raw ingredient made from inside a dish's recipe: no selling price, kept off the online
   * shop, filed under "Ingredients". The counter keeps unpriced ingredients out of its
   * search and grid too (see kitchenOnlyIds in billing), so a cashier cannot bill raw paneer.
   */
  async function createIngredient({ name, unit, stock, costPrice, lowStockThreshold }) {
    const data = await apiFetch('/api/seller/products', {
      method: 'POST',
      body: JSON.stringify({
        name,
        unit,
        price: 0,
        costPrice,
        stock,
        lowStockThreshold,
        kind: 'goods',
        category: t('recipe.ingredientCategory'),
        showInCatalog: false,
      }),
    });
    const created = data.product;
    if (created) setProducts((list) => [created, ...list]);
    toast.success(t('recipe.newCreated', { name: created?.name || name }));
    return created;
  }

  function addModifierGroup() {
    setForm((f) => ({
      ...f,
      modifierGroups: [...f.modifierGroups, { name: '', required: false, multiple: false, options: [{ name: '', priceDelta: '' }] }],
    }));
  }
  function updateModifierGroup(index, key, value) {
    setForm((f) => ({ ...f, modifierGroups: f.modifierGroups.map((g, i) => (i === index ? { ...g, [key]: value } : g)) }));
  }
  function removeModifierGroup(index) {
    setForm((f) => ({ ...f, modifierGroups: f.modifierGroups.filter((_, i) => i !== index) }));
  }
  function addModifierOption(groupIndex) {
    setForm((f) => ({
      ...f,
      modifierGroups: f.modifierGroups.map((g, i) =>
        i === groupIndex ? { ...g, options: [...g.options, { name: '', priceDelta: '' }] } : g
      ),
    }));
  }
  function updateModifierOption(groupIndex, optionIndex, key, value) {
    setForm((f) => ({
      ...f,
      modifierGroups: f.modifierGroups.map((g, i) =>
        i === groupIndex
          ? { ...g, options: g.options.map((o, j) => (j === optionIndex ? { ...o, [key]: value } : o)) }
          : g
      ),
    }));
  }
  function removeModifierOption(groupIndex, optionIndex) {
    setForm((f) => ({
      ...f,
      modifierGroups: f.modifierGroups.map((g, i) =>
        i === groupIndex ? { ...g, options: g.options.filter((_, j) => j !== optionIndex) } : g
      ),
    }));
  }

  async function recalcCost() {
    if (!editingId) return;
    const recipeError = recipeProblem(form.recipe, products, t);
    if (recipeError) {
      toast.error(recipeError);
      return;
    }
    try {
      const recipe = recipePayload(form.recipe, products);
      const data = await apiFetch(`/api/seller/products/${editingId}/recalc-cost`, {
        method: 'POST',
        body: JSON.stringify({ recipe, recipeExtraCost: form.recipeExtraCost, recipeYield: form.recipeYield }),
      });
      setForm((f) => ({ ...f, costPrice: String(data.product.costPrice) }));
      toast.success(t('seller.recipeCostUpdated', { cost: data.product.costPrice }));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');
    // An incomplete recipe line would otherwise be dropped on save without a word.
    const recipeError = recipeProblem(form.recipe, products, t);
    if (recipeError) {
      setFormError(recipeError);
      return;
    }
    if (form.recipeExtraCost !== '' && !(Number(form.recipeExtraCost) >= 0)) {
      setFormError(t('recipe.errExtraCost'));
      return;
    }
    if (form.recipeYield !== '' && !(Number(form.recipeYield) > 0)) {
      setFormError(t('recipe.errYield'));
      return;
    }
    setSubmitting(true);

    const isService = form.kind === 'service';

    /**
     * Whether this save is allowed to touch stock at all.
     *
     * `stock` is an ABSOLUTE quantity set on the active store, not a delta — so re-sending
     * the number the modal happened to open with is not harmless. A shopkeeper who reopens
     * a product at 4pm to fix its HSN code would silently un-sell whatever the counter
     * billed while the dialog sat open. It is only sent when the box was actually retyped.
     *
     * A batch-tracked product never sends it: its stock is the sum of its lots and the
     * server ignores the field for exactly that reason, which until now meant the seller
     * typed a number, saved, and watched nothing happen with nothing said.
     */
    const stockChanged = String(form.stock ?? '') !== String(openingStock ?? '');
    const sendsStock = !editingId || (!isService && !form.trackBatches && stockChanged);

    const payload = {
      name: form.name,
      description: form.description,
      // Only read on create — the backend won't let an existing product's kind change.
      kind: form.kind,
      durationMinutes: isService ? Number(form.durationMinutes) || undefined : undefined,
      unit: form.unit,
      price: Number(form.price),
      // Sent as '' rather than omitted when cleared, so a PATCH can actually remove an
      // MRP the shopkeeper no longer wants printed (see the same rule on subUnit below).
      mrp: isService ? undefined : form.mrp === '' ? '' : Number(form.mrp),
      costPrice: form.costPrice === '' ? '' : Number(form.costPrice),
      gstRate: Number(form.gstRate),
      barcode: isService ? undefined : form.barcode,
      // Always sent as an array (empty when cleared), so removing the last extra code on a
      // PATCH actually removes it instead of leaving the old list in place.
      altCodes: isService ? undefined : form.altCodes || [],
      ...(sendsStock ? { stock: isService ? 0 : Number(form.stock) || 0 } : {}),
      // `|| 5` here meant a reorder level of 0 — "stop warning me about this one" — was
      // silently turned back into 5 on every save. Only a genuinely empty box falls back.
      // Typed in the alert unit, stored in the stock unit (500 gram → 0.5 kg).
      lowStockThreshold: isService
        ? 0
        : form.lowStockThreshold === '' || Number.isNaN(Number(form.lowStockThreshold))
        ? 5
        : Number((Number(form.lowStockThreshold) * alertFactor(form)).toFixed(6)),
      lowStockUnit: isService ? '' : alertUnitOf(form),
      category: form.category,
      // Every optional box below is sent as '' rather than omitted when it is empty, for
      // the same reason the photo and the MRP already were: on a PATCH the server reads a
      // missing key as "the form is not talking about this field" and leaves the old value
      // alone. Omitting them meant a wrong expiry date, a wrong barcode or a wrong HSN code
      // could be typed in but never taken back out — the shopkeeper cleared the box, saved,
      // and the old value came straight back.
      expiryDate: isService ? undefined : form.expiryDate,
      hsnCode: form.hsnCode,
      showInCatalog: form.showInCatalog,
      // Sent as '' rather than omitted when cleared, so removing a photo on an edit actually
      // removes it — the server reads `photoUrl !== undefined` as "the form is telling me
      // about the photo", and an omitted key left the old one in place.
      photoUrl: form.photoUrl,
      batchNumber: isService ? undefined : form.batchNumber,
      warrantyMonths: form.warrantyMonths === '' ? '' : Number(form.warrantyMonths),
      // Sent even when blank on purpose. Clearing this box takes a prescription tag OFF a
      // medicine, which is the one product edit in the app with a legal consequence — the
      // server records it (see updateProduct) and could not, while the key was being
      // dropped, because it never learned the box had been emptied.
      drugSchedule: form.drugSchedule,
      pricingMode: form.pricingMode,
      purity: form.purity,
      grossWeight: form.grossWeight,
      netWeight: form.netWeight,
      makingChargeType: form.makingChargeType,
      makingChargeValue: form.makingChargeValue,
      wastagePercent: form.wastagePercent,
      hallmarkNumber: form.hallmarkNumber,
      secondaryUnit: isService ? undefined : form.secondaryUnit,
      // Cleared with the unit it belongs to — "90 per roll" left behind on a product that
      // no longer has rolls is a number nothing can read correctly.
      conversionFactor: isService ? undefined : !form.secondaryUnit ? '' : Number(form.conversionFactor) || undefined,
      // Always sent (as '' when off) rather than omitted, because on a PATCH the server
      // reads `subUnit !== undefined` as "the form is telling me about loose selling" —
      // which is how clearing the sub-unit turns the feature back off.
      subUnit: isService ? '' : form.subUnit || '',
      subUnitsPerUnit: isService || !form.subUnit ? undefined : Number(form.subUnitsPerUnit) || undefined,
      subUnitPrice: isService || !form.subUnit || form.subUnitPrice === '' ? undefined : Number(form.subUnitPrice),
      priceTiers: isService
        ? undefined
        : form.priceTiers
            .filter((row) => row.minQty !== '' && row.price !== '')
            .map((row) => ({ minQty: Number(row.minQty), price: Number(row.price) })),
      recipe: recipePayload(form.recipe, products),
      recipeExtraCost: form.recipeExtraCost,
      recipeYield: form.recipeYield,
      // Blank clears the override — always sent (as '') so a PATCH can actually remove one.
      orderTypePricing: { parcel: form.parcelPrice === '' ? '' : Number(form.parcelPrice), delivery: form.deliveryPrice === '' ? '' : Number(form.deliveryPrice) },
      modifierGroups: form.modifierGroups
        .filter((g) => g.name.trim() && g.options.some((o) => o.name.trim()))
        .map((g) => ({
          name: g.name.trim(),
          required: g.required,
          multiple: g.multiple,
          options: g.options
            .filter((o) => o.name.trim())
            .map((o) => ({ name: o.name.trim(), priceDelta: Number(o.priceDelta) || 0 })),
        })),
    };

    try {
      if (editingId) {
        const saved = await apiFetch(`/api/seller/products/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        // Changing an ingredient's unit (kg → gram) re-bases every recipe that uses it, so
        // "200 g per plate" still means 200 g. Said out loud, because it touched other items.
        if (saved?.recipesRebased?.updated > 0) {
          toast.success(t('recipe.rebased', { n: saved.recipesRebased.updated }));
        }
        if (saved?.recipesRebased?.stuck?.length) {
          toast.error(t('recipe.rebaseStuck', { names: saved.recipesRebased.stuck.slice(0, 3).join(', ') }));
        }
      } else {
        await apiFetch('/api/seller/products', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      toast.success(editingId ? t('common.saveChanges') : t('common.add'));
      closeForm();
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * The same three questions the server asks, asked here first.
   *
   * Not a security check — the server's is the one that counts, and it re-does every one of
   * these against the bytes rather than the file picker. This is a courtesy: telling someone
   * their file is a PDF takes a millisecond here and a 3MB upload over shop wifi there, and
   * on a phone that is the difference between "wrong file" and "the app is broken".
   *
   * The magic-number check reads the first four bytes rather than the name. `.xlsx` is a
   * ZIP, so a real one starts with PK\x03\x04 — which is also how a file renamed to .xlsx
   * gives itself away before it costs anybody an upload.
   */
  /* Out of the dialog for good: nothing here survives to the next import, so a sheet that
     went wrong on Tuesday cannot greet the shopkeeper on Wednesday. */
  function closeImport() {
    setImportOpen(false);
    setImportPhase('idle');
    setImportFile(null);
    setImportResult(null);
    setImportDetails(false);
    setImportFail(null);
    setImportPreview(null);
    setImportStockMode('keep');
    setImportPriceMode('keep');
    setImportResolutions({});
    importBytesRef.current = null;
  }

  /* Back to the instructions with the file picker on them, dialog still open. The error is
     cleared too — whatever the last sheet did, the next one has not done it yet. */
  function resetImport() {
    setImportPhase('idle');
    setImportFile(null);
    setImportResult(null);
    setImportDetails(false);
    setImportError('');
    setImportFail(null);
    setImportPreview(null);
    setImportStockMode('keep');
    setImportPriceMode('keep');
    setImportResolutions({});
    importBytesRef.current = null;
  }

  /**
   * Broke, rather than finished badly. Shared by all three requests this dialog can make.
   *
   * Three things are worked out here, because the card cannot work them out for itself:
   *
   *   the sentence   — apiErrorMessage, not err.message. The API answers with a stable
   *                    `code` and an English line on purpose (see lib/apiErrors.js), and
   *                    reading err.message straight is how "Too many changes at once."
   *                    ends up on a Marathi screen.
   *   how long       — a 429 or a 503 carries the seconds it wants us to wait. The retry
   *                    layer has already sat out anything short, so a number that reaches
   *                    here is one the shopkeeper has to be told.
   *   what happened to their catalog — see `maybeRan`.
   *
   * `maybeRan` is the one that matters. A timeout, a dropped connection or "already being
   * saved" all mean the server HAS the sheet and may still be working through it; the
   * request gave up, the import did not. Telling someone "please try again" there is how a
   * catalog ends up imported twice. Everything else — a refusal, a plan wall, a rate limit
   * — was decided before a single row was written, so it is safe to say nothing changed.
   *
   * `reached` is false only for the preview's own upload and the checks before it, where
   * genuinely nothing has been sent yet.
   */
  function failImport(err, reached, requestKind = 'write') {
    const code = err.code || '';
    if (err.status === 429) {
      const kind = code === 'RATE_LIMIT_IMPORT_PREVIEW' ? 'preview' : requestKind;
      pauseImport(err, kind);
      setImportPhase(importPreview ? 'review' : 'paused');
      return;
    }
    const maybeRan =
      reached &&
      (MAY_STILL_BE_RUNNING.has(code) || err.status === 0 || err.status >= 500 || err.status === 409);

    setImportPreview(null);
    setImportStockMode('keep');
    setImportPriceMode('keep');
    setImportResolutions({});
    setImportFail({
      message: apiErrorMessage(lang, err),
      code,
      retryAfter: Number(err.retryAfter) > 0 ? Math.ceil(Number(err.retryAfter)) : 0,
      reached,
      maybeRan,
    });
    // The list behind the dialog is refreshed either way. If some rows did land before it
    // broke, "View products" must show them — and a GET costs nothing that just failed.
    if (reached) load();
    setImportPhase('failed');
  }

  /**
   * Sends the sheet to be written, and lands the answer on the finished card.
   *
   * Split out of handleImportFile because there are now two ways in: straight through, when
   * the sheet holds nothing the shop already has, and from the review screen once the seller
   * has chosen what to do about the rows it does. Both have to report identically — a run
   * confirmed from the review screen that summarised itself differently would undo the point
   * of showing the summary.
   *
   * `mode` is 'add' (a barcode the shop already has is refused) or 'merge' (it is updated
   * from the sheet). The server defaults to 'add', so nothing that skips this path changes.
   */
  async function resolveImportMatch(row, decision, stockMode = importStockMode, priceMode = importPriceMode) {
    if (importPreviewRequestRef.current || importCooldown.preview > Date.now()) return;
    importPreviewRequestRef.current = true;
    const fileBase64 = importBytesRef.current;
    const resolutions = row == null ? importResolutions : { ...importResolutions, [row]: decision };
    setImportReviewBusy(true);
    try {
      const preview = await fetchProductImportPreview(apiFetch, {
        fileBase64, sheetToken: importPreview?.sheetToken, resolutions, stockMode, priceMode,
      });
      if (importBytesRef.current !== fileBase64) return;
      setImportResolutions(resolutions);
      setImportStockMode(stockMode);
      setImportPriceMode(priceMode);
      setImportPreview(preview);
      setImportPhase('review');
    } catch (err) {
      if (err.status === 429) pauseImport(err, 'preview');
      else toast.error(apiErrorMessage(lang, err));
    }
    finally { importPreviewRequestRef.current = false; setImportReviewBusy(false); }
  }

  async function runImport(fileBase64, mode) {
    if (importWritingRef.current || importPreviewRequestRef.current || importCooldown.write > Date.now()) return;
    importWritingRef.current = true;
    setImportStage(1);
    setImportPhase('running');
    try {
      const data = await apiFetch('/api/seller/products/import', {
        method: 'POST',
        body: JSON.stringify({ fileBase64, mode, stockMode: importStockMode, priceMode: importPriceMode, resolutions: importResolutions }),
        /**
         * The two defaults in lib/net.js are wrong for this one request, and between them
         * they are how a shop ended up with its catalog imported twice.
         *
         * timeoutMs: the default is 30 seconds. bulkImportProducts does a Product.create
         * plus two store-stock writes per row, one after another, so a real catalog is
         * minutes — the deadline was firing on a healthy import that was going perfectly
         * well, and the abort looks exactly like a dead connection from here.
         *
         * retries: writes normally get two, which is safe because the idempotency key makes
         * a replay free. It is not free here. Even now that the key survives a timeout (see
         * middleware/idempotency.js), an automatic retry can only be told "this is already
         * being saved" — a true sentence that reads as a fresh failure. One honest attempt,
         * and a card that explains what happened, beats a silent second copy of the most
         * expensive request in the app.
         */
        timeoutMs: 3 * 60 * 1000,
        retries: 0,
      });

      // The server has answered. The last step is the catalog behind this dialog catching
      // up, and it is awaited rather than fired and forgotten so that "View products"
      // cannot land the seller on the list they had before the import.
      setImportStage(2);
      await load();

      /**
       * Every finished run stays on screen until it has been read.
       *
       * A clean import used to close the dialog and drop a toast, which is four seconds of
       * one sentence over a list of five thousand rows: by the time the shopkeeper looked up
       * from the sheet they had just uploaded, the answer to "how many went in?" had gone.
       */
      const refused = (data.errors?.length || 0) + (data.moreErrors || 0) + (data.skipped || 0);
      const touched = (data.created || 0) + (data.updated || 0) + (data.unchanged || 0);

      // Header row present, no product rows under it — nothing to do and nothing to complain
      // about per row, which would otherwise show as a bare "0 products added." The one
      // outcome that is a mistake rather than a result, so it goes back to the instructions
      // with the reason on it instead of onto a card headed "Import complete".
      if (touched === 0 && refused === 0) {
        setImportError(t('seller.importNothing'));
        setImportPhase('idle');
        return;
      }

      setImportResult(data);
      // Expanded from the start when nothing landed. On a good run the refused rows are a
      // footnote; on a run that changed nothing they are the entire story, and making the
      // seller press a link to find out why is making them ask twice.
      setImportDetails((data.created || 0) + (data.updated || 0) === 0);
      setImportPhase('done');
    } catch (err) {
      failImport(err, true);
    }
    finally { importWritingRef.current = false; }
  }

  async function handleImportFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImportError('');
    setImportResult(null);
    setImportDetails(false);

    if (file.size > IMPORT_MAX_MB * 1024 * 1024) {
      setImportError(t('seller.importTooBig', { mb: IMPORT_MAX_MB }));
      return;
    }
    if (!file.size) {
      setImportError(t('seller.importNotXlsx'));
      return;
    }

    /**
     * From here the dialog becomes the progress card, and the three lines on it are moved
     * by the three things that actually happen — never by a timer, and never towards a
     * percentage nobody measured.
     *
     *   stage 0  reading the sheet off the disk, checking it is really an .xlsx, and
     *            encoding it. On a 2MB file on a cheap phone this is seconds of real work.
     *   stage 1  the bytes are with the server and it has not answered. This is the long
     *            one: ExcelJS parses the sheet and every row is a Product.create() plus
     *            two store-stock writes.
     *   stage 2  the answer is in, and the catalog behind the dialog is being reloaded.
     *
     * The card only ever claims a step is finished once its await has returned, which is
     * why "File uploaded" can be trusted — and why there is no fourth, invented step.
     */
    setImportFile({ name: file.name, size: file.size });
    setImportStage(0);
    setImportPhase('running');
    setImportFail(null);
    /* Not the `importStage` state: this is read inside the catch below, and a state variable
       read from the closure that set it is the stale one. A plain local is always the truth
       at the moment it is checked. */
    let reached = false;
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
        setImportError(t('seller.importNotXlsx'));
        setImportPhase('idle');
        return;
      }

      // Chunked rather than one character at a time: the old loop built a 2MB string by
      // appending to it two million times, which locks up a mid-range phone for seconds
      // before the upload has even started. 8KB slices are well inside the argument limit
      // of `apply` on every browser this app supports.
      const parts = [];
      for (let i = 0; i < bytes.length; i += 8192) {
        parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)));
      }
      const fileBase64 = btoa(parts.join(''));

      // The sheet has been read and checked and is on its way out. That is the first tick,
      // and from here on a failure can no longer promise that nothing happened.
      setImportStage(1);
      reached = true;
      importBytesRef.current = fileBase64;

      /**
       * Ask what this sheet would DO before doing any of it.
       *
       * This is the whole answer to "Duplicate barcode". A seller who keeps their catalog in
       * Excel, corrects it and sends it back was shown a wall of red and lost every
       * corrected rate in silence — the import only ever added, so a barcode the shop
       * already had was refused rather than updated. The refusal was visible and harmless;
       * the dropped price changes were invisible and cost the shop money at the counter.
       *
       * The preview writes nothing. What comes back is counts plus a few worked examples,
       * which is what turns the next screen into a decision the seller can actually take.
       */
      setImportPhase('checking');
      const preview = await fetchProductImportPreview(apiFetch, { fileBase64 });

      /* Only ask when there is something to decide. A first import, or a sheet of genuinely
         new stock, holds nothing the shop already owns — and putting a confirm screen in
         front of that is how people learn to click through confirm screens without reading
         them, which is the one habit this screen cannot afford to teach. */
      setImportPreview(preview);
      if (preview.existingRows > 0 || preview.nameMatches?.length || preview.errors?.length || preview.moreErrors || preview.zeroPriceRows || preview.belowCostRows || preview.aboveMrpRows) {
        setImportPhase('review');
        return;
      }

      await runImport(fileBase64, 'add');
    } catch (err) {
      failImport(err, reached, 'preview');
    }
  }

  async function handleDelete(product) {
    if (!(await confirm({ tone: 'danger', title: t('common.delete'), body: t('table.confirmDelete', { name: product.name }), confirmLabel: t('common.delete') }))) return;
    try {
      await apiFetch(`/api/seller/products/${product._id}`, { method: 'DELETE' });
      toast.success(t('common.delete'));
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!(await confirm({ tone: 'danger', title: t('common.delete'), body: t('table.confirmBulkDelete', { count: ids.length }), confirmLabel: t('common.delete') }))) return;
    setBulkBusy(true);
    try {
      // Sequential rather than Promise.all: a shop's phone on 3G handling 100 parallel
      // requests is how you get half-applied bulk operations and a confusing list.
      for (const id of ids) {
        await apiFetch(`/api/seller/products/${id}`, { method: 'DELETE' });
      }
      toast.success(t('table.deleteSelected'), { detail: t('table.selected', { count: ids.length }) });
      setSelectedIds(new Set());
      load();
    } catch (err) {
      toast.error(err.message);
      load();
    } finally {
      setBulkBusy(false);
    }
  }

  /**
   * Every bulk edit goes through one request.
   *
   * These used to be `for` loops firing one PATCH per selected row. Fine for the three
   * rows someone hides from the catalog; ruinous for the four hundred selected when GST
   * changes and every price has to move — four hundred requests, and a failure halfway
   * leaves half the catalog on the new price with nothing on screen saying which half.
   * The server validates the whole set before writing any of it.
   */
  async function runBulk(action, { value, mode, successMessage } = {}) {
    const ids = [...selectedIds];
    if (!ids.length) return false;
    setBulkBusy(true);
    try {
      const data = await apiFetch('/api/seller/products/bulk', {
        method: 'PATCH',
        body: JSON.stringify({ ids, action, value, mode }),
      });
      toast.success(successMessage || t('table.bulkDone', { count: data.updated }));
      setSelectedIds(new Set());
      load();
      return true;
    } catch (err) {
      toast.error(err.message);
      return false;
    } finally {
      setBulkBusy(false);
    }
  }

  function handleBulkCatalog(show) {
    return runBulk('catalog', {
      value: show,
      successMessage: show ? t('seller.showSelected') : t('seller.hideSelected'),
    });
  }

  // The shop's own catalog back out as a spreadsheet — for the yearly physical count and
  // for the accountant. Goes through downloadFile, never an <a href>: the route is
  // authenticated and a bare link only works while the API shares the dashboard's host.
  async function handleExport() {
    setExporting(true);
    try {
      await downloadFile('/api/seller/products/export.xlsx', `inventory-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(false);
    }
  }

  const canSell = user?.shopStatus === 'approved';

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <h1>{serviceLed ? t('nav.inventoryService') : t('seller.inventoryTitle')}</h1>
          <p className="page-head-sub">{serviceLed ? t('seller.serviceMenuSubtitle') : t('seller.inventorySubtitle')}</p>
          {/* A chemist's shelf is two lots of the same strip expiring in different months.
              Saying so once, on the screen where they'd hit the problem, beats leaving them
              to discover the batch button by accident. */}
          {biz.suggestsBatches && <p className="page-head-sub">{t('seller.batchNudge')}</p>}
          {/* Central Inventory only exists for a shop with more than one branch, and only
              on a plan that carries multi-store. This link was unconditional, so on every
              plan below enterprise it was a shortcut to a 403. Filtered on the same list the
              sidebar uses so the two can never disagree. */}
          {!hiddenNav.includes('centralInventory') && (
            <Link href="/seller/stores/central" className="link-quiet">
              {t('seller.centralInventoryTitle')} →
            </Link>
          )}
        </div>
        {canSell && (
          <div className="page-head-actions">
            <Link href="/seller/catalog" className="btn btn-secondary btn-inline">
              <EyeIcon size={17} />
              {t('seller.catalogPreview')}
            </Link>
            {/* A shop could put its catalog in and never get it back out. That matters at
                the yearly physical count (done on paper against a printout), to the
                accountant who wants closing stock, and to the plain question of whether
                the shop's own data is hostage to the app. */}
            {/* The yearly/monthly physical count. Opens on whatever the list is filtered
                to, because a shop is counted a shelf at a time. */}
            <button type="button" className="btn btn-secondary btn-inline" onClick={() => setStockTakeOpen(true)}>
              <ClipboardIcon size={17} />
              {t('stockTake.open')}
            </button>
            {/* A kitchen's stock is its ingredients: one view of all of them, how long each
                lasts, and which dishes stop when one runs out. */}
            {(showRecipe || products.some((p) => p.recipe?.length)) && (
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setKitchenOpen(true)}>
                <LayersIcon size={17} />
                {t('kitchenStock.open')}
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-inline" disabled={exporting} onClick={handleExport}>
              <DownloadIcon size={17} />
              {exporting ? t('common.loading') : t('seller.exportInventory')}
            </button>
            {/* Cleared on the way IN, not on the way out. Only a run that went wrong
                leaves anything behind now, and a red banner from last Tuesday's bad sheet
                greeting a shopkeeper who has come to import a good one reads as a fresh
                failure — before they have chosen a file. */}
            <button
              type="button"
              className="btn btn-secondary btn-inline"
              onClick={() => {
                setImportError('');
                setImportResult(null);
                setImportPhase('idle');
                setImportFile(null);
                setImportDetails(false);
                setImportFail(null);
                setImportOpen(true);
              }}
            >
              <UploadIcon size={17} />
              {t('seller.importOpen')}
            </button>
            {/* A garments or footwear shop almost never adds a single row — it adds a
                size × colour grid — so for those trades the variant builder is the primary
                action and the plain form steps back. A kirana never sees it at all. */}
            {showVariants && (
              <button
                type="button"
                className={`btn btn-inline ${biz.suggestsVariants ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setVariantOpen(true)}
              >
                <LayersIcon size={17} />
                {t('seller.addVariants')}
              </button>
            )}
            <button
              type="button"
              className={`btn btn-inline ${showVariants && biz.suggestsVariants ? 'btn-secondary' : 'btn-primary'}`}
              onClick={openAddForm}
            >
              <PlusIcon size={17} />
              {t('seller.newProduct')}
            </button>
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}
      <DataLoadNotice loading={loading} error={loadError} onRetry={load} />

      {/* GST 2.0 (22 Sept 2025) removed the 12% and 28% slabs for almost everything. A
          product still sitting on one bills at that rate on every new invoice, and nothing
          said so. Not blocked — a few goods (tobacco) still carry 28% — but named, with the
          way in to fix each one. Only for a shop that issues tax invoices. */}
      {user?.gstin && legacyGstProducts.length > 0 && (
        <div className="info-banner gst-legacy-banner">
          <AlertIcon size={18} />
          <div>
            <strong>{t('seller.gstLegacyTitle', { count: legacyGstProducts.length })}</strong>
            <p>{t('seller.gstLegacyBody')}</p>
            <div className="gst-legacy-list">
              {legacyGstProducts.slice(0, 12).map((p) => (
                <button key={p._id} type="button" className="link-quiet" onClick={() => openEditForm(p)}>
                  {p.name} ({p.gstRate}%)
                </button>
              ))}
              {legacyGstProducts.length > 12 && <span className="cell-muted">+{legacyGstProducts.length - 12}</span>}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <SkeletonStats count={4} />
      ) : (
        <div className="stat-grid">
          <StatCard
            icon={<PackageIcon size={17} />}
            tone="icon-brand"
            value={totalSellableStock.toLocaleString('en-IN', { maximumFractionDigits: 3 })}
            label={t('seller.stats.unitsInStock')}
            onClick={filtersActive ? clearFilters : undefined}
          />
          <StatCard
            icon={<AlertIcon size={17} />}
            tone="icon-gold"
            value={lowOrOut}
            label={t('seller.stats.lowStockCount')}
            active={stockFilter === 'refill' || stockFilter === 'low' || stockFilter === 'out'}
            onClick={() => setStockFilter((f) => (f === 'refill' ? 'all' : 'refill'))}
          />
          <StatCard
            icon={<ClockIcon size={17} />}
            tone="icon-danger"
            value={expiringOrExpired}
            label={t('seller.stats.expiringSoonCount')}
            active={expiryFilter === 'atrisk' || expiryFilter === 'expiring' || expiryFilter === 'expired'}
            onClick={() => setExpiryFilter((f) => (f === 'atrisk' ? 'all' : 'atrisk'))}
          />
          <StatCard
            icon={<RupeeIcon size={17} />}
            tone="icon-success"
            value={`₹${counts.totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
            label={t('seller.stats.inventoryValue')}
          />
        </div>
      )}

      <div className="data-panel">
        <div className="data-filters">
          <div className="search-box">
            <SearchIcon size={16} />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('seller.searchProducts')}
            />
          </div>

          {/* The filters wrap among themselves before the row splits, and the density
              toggle stays pinned to the right edge via .filter-actions. */}
          <div className="filter-group">
            {categories.length > 0 && (
              <SelectControl
                value={categoryFilter}
                onChange={setCategoryFilter}
                filtered={Boolean(categoryFilter)}
                options={[
                  { value: '', label: t('seller.allCategories') },
                  ...categories.map((c) => ({ value: c, label: c })),
                ]}
              />
            )}

            <SelectControl
              value={stockFilter}
              onChange={setStockFilter}
              filtered={stockFilter !== 'all'}
              options={STOCK_FILTERS.map((key) => ({
                value: key,
                label:
                  key === 'all'
                    ? t('seller.stockAll')
                    : `${t(STOCK_FILTER_LABELS[key])} (${counts.stock[key]})`,
              }))}
            />

            <SelectControl
              value={expiryFilter}
              onChange={setExpiryFilter}
              filtered={expiryFilter !== 'all'}
              options={EXPIRY_FILTERS.map((key) => ({
                value: key,
                label: key === 'all' ? t('expiry.filterLabel') : `${t(EXPIRY_FILTER_LABELS[key])} (${counts.expiry[key]})`,
              }))}
            />

            {/* Four screens link here as /seller/products?cost=missing — the Munafa card,
                the margin coach, Insights. The list arrived filtered to a dozen rows out of
                four hundred with nothing on screen saying why, which reads as a broken
                catalog rather than as a filter. Shown as a chip that can be taken off. */}
            {costFilter === 'missing' && (
              <button type="button" className="filter-clear active" onClick={() => setCostFilter('all')}>
                <XIcon size={13} />
                {t('seller.costFilterMissing')}
              </button>
            )}

            {filtersActive && (
              <button type="button" className="filter-clear" onClick={clearFilters}>
                <XIcon size={13} />
                {t('table.clearFilters')}
              </button>
            )}
          </div>

          <div className="filter-actions">
            <div className="segmented-mini density-toggle" role="group" aria-label={t('table.density')}>
              <button
                type="button"
                className={density === 'comfortable' ? 'active' : ''}
                onClick={() => changeDensity('comfortable')}
                data-tip={t('table.comfortable')}
              >
                <RowsIcon size={14} />
              </button>
              <button
                type="button"
                className={density === 'compact' ? 'active' : ''}
                onClick={() => changeDensity('compact')}
                data-tip={t('table.compact')}
              >
                <ListIcon size={14} />
              </button>
            </div>
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="bulk-bar">
            <div className="bulk-bar__row">
              <span className="bulk-count">{t('table.selected', { count: selectedIds.size })}</span>
              {/* The three edits a shop actually makes to a whole shelf at once. Until now
                  the only bulk actions were show/hide and delete, so "GST badha, sab 3%
                  badhao" meant opening four hundred forms one at a time. */}
              {canSell && (
                <>
                  {/* One button for both prices — the panel it opens carries the
                      Selling/Cost switch, so the bar does not grow a second near-identical
                      control for a distinction most sellers make once a quarter. */}
                  <button
                    type="button"
                    className={`btn btn-small btn-inline ${bulkPanel === 'price' || bulkPanel === 'cost' ? 'btn-primary' : 'btn-secondary'}`}
                    disabled={bulkBusy}
                    onClick={() => {
                      setBulkPanel((p) => (p === 'price' || p === 'cost' ? null : 'price'));
                      setBulkValue('');
                    }}
                  >
                    <RupeeIcon size={15} />
                    {t('seller.bulkPrice')}
                  </button>
                  <button
                    type="button"
                    className={`btn btn-small btn-inline ${bulkPanel === 'category' ? 'btn-primary' : 'btn-secondary'}`}
                    disabled={bulkBusy}
                    onClick={() => {
                      setBulkPanel((p) => (p === 'category' ? null : 'category'));
                      setBulkValue('');
                    }}
                  >
                    <TagIcon size={15} />
                    {t('seller.bulkCategory')}
                  </button>
                  <button
                    type="button"
                    className={`btn btn-small btn-inline ${bulkPanel === 'lowStock' ? 'btn-primary' : 'btn-secondary'}`}
                    disabled={bulkBusy}
                    onClick={() => {
                      setBulkPanel((p) => (p === 'lowStock' ? null : 'lowStock'));
                      setBulkValue('');
                    }}
                  >
                    <AlertIcon size={15} />
                    {t('seller.bulkLowStock')}
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-small btn-inline"
                disabled={bulkBusy}
                onClick={() => handleBulkCatalog(true)}
              >
                <EyeIcon size={15} />
                {t('seller.showSelected')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-small btn-inline"
                disabled={bulkBusy}
                onClick={() => handleBulkCatalog(false)}
              >
                <EyeOffIcon size={15} />
                {t('seller.hideSelected')}
              </button>
              {canSell && (
                <button
                  type="button"
                  className="btn btn-danger btn-small btn-inline"
                  disabled={bulkBusy}
                  onClick={handleBulkDelete}
                >
                  <TrashIcon size={15} />
                  {t('table.deleteSelected')}
                </button>
              )}
              <button type="button" className="filter-clear" onClick={() => setSelectedIds(new Set())}>
                {t('table.clearSelection')}
              </button>
            </div>

            {bulkPanel && (
              <form
                className="bulk-bar__panel"
                onSubmit={async (e) => {
                  e.preventDefault();
                  // Sent as the raw string, NOT Number(bulkValue): an empty box became 0,
                  // and "Set to" 0 across a whole selection prices the shelf at nothing.
                  // The server refuses '' and converts the rest itself.
                  const ok = await runBulk(bulkPanel, {
                    value: bulkPanel === 'category' ? bulkValue.trim() : bulkValue,
                    mode: bulkPanel === 'price' ? bulkPriceMode : undefined,
                  });
                  if (ok) {
                    setBulkPanel(null);
                    setBulkValue('');
                  }
                }}
              >
                {(bulkPanel === 'price' || bulkPanel === 'cost') && (
                  <>
                    {/* Which number is moving. A wholesaler's list going up and a rate
                        revision are different events, and confusing the two silently
                        rewrites every margin in the reports — so it is picked, not
                        guessed. */}
                    <div className="segmented-mini">
                      {[
                        { id: 'price', label: t('seller.bulkTargetSelling') },
                        { id: 'cost', label: t('seller.bulkTargetCost') },
                      ].map(({ id, label }) => (
                        <button
                          key={id}
                          type="button"
                          className={bulkPanel === id ? 'active' : ''}
                          onClick={() => setBulkPanel(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {/* "3% badha do", "5 rupaye kam", "sab ka 20 kar do" — the three ways
                        a shopkeeper says it, rather than making them convert one into
                        another in their head. */}
                    <div className="segmented-mini">
                      {[
                        { id: 'percent', label: '%' },
                        { id: 'amount', label: '₹ +/−' },
                        { id: 'set', label: t('seller.bulkPriceSet') },
                      ].map(({ id, label }) => (
                        <button
                          key={id}
                          type="button"
                          className={bulkPriceMode === id ? 'active' : ''}
                          onClick={() => setBulkPriceMode(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      autoFocus
                      required
                      value={bulkValue}
                      onChange={(e) => setBulkValue(e.target.value)}
                      placeholder={bulkPriceMode === 'percent' ? '5' : bulkPriceMode === 'amount' ? '-2' : '20'}
                      aria-label={bulkPanel === 'cost' ? t('seller.bulkCost') : t('seller.bulkPrice')}
                    />
                    <span className="bulk-bar__hint">
                      {bulkPriceMode === 'percent'
                        ? t('seller.bulkPriceHintPercent')
                        : bulkPriceMode === 'amount'
                        ? t('seller.bulkPriceHintAmount')
                        : t('seller.bulkPriceHintSet')}
                    </span>
                  </>
                )}

                {bulkPanel === 'category' && (
                  <>
                    {/* Free text with the shop's existing categories offered, because
                        after an import everything lands uncategorised and the seller is
                        both creating the category and applying it in the same breath. */}
                    <input
                      list="bulk-category-options"
                      autoFocus
                      value={bulkValue}
                      onChange={(e) => setBulkValue(e.target.value)}
                      placeholder={t('seller.bulkCategoryPlaceholder')}
                      aria-label={t('seller.bulkCategory')}
                    />
                    <datalist id="bulk-category-options">
                      {categories.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                    <span className="bulk-bar__hint">{t('seller.bulkCategoryHint')}</span>
                  </>
                )}

                {bulkPanel === 'lowStock' && (
                  <>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      autoFocus
                      required
                      value={bulkValue}
                      onChange={(e) => setBulkValue(e.target.value)}
                      placeholder="5"
                      aria-label={t('seller.bulkLowStock')}
                    />
                    <span className="bulk-bar__hint">{t('seller.bulkLowStockHint')}</span>
                  </>
                )}

                <button
                  type="submit"
                  className="btn btn-primary btn-small"
                  disabled={bulkBusy || (bulkPanel !== 'category' && bulkValue === '')}
                >
                  {bulkBusy ? t('common.saving') : t('seller.bulkApply', { count: selectedIds.size })}
                </button>
                <button type="button" className="filter-clear" onClick={() => setBulkPanel(null)}>
                  {t('common.cancel')}
                </button>
              </form>
            )}
          </div>
        )}

        {/* The low-stock filter used to be a dead end: it told you what had run out and
            then offered nothing to do about it, while a whole purchase-order module sat
            one click away already computing reorder quantities from 30-day sales. */}
        {!loading && (stockFilter === 'refill' || stockFilter === 'low' || stockFilter === 'out') && sorted.length > 0 && (
          <div className="reorder-nudge">
            <TruckIcon size={16} />
            <span>{t('seller.reorderNudge', { count: sorted.length })}</span>
            <Link href="/seller/purchase-orders" className="btn btn-primary btn-small btn-inline">
              {t('seller.reorderNudgeAction')}
            </Link>
          </div>
        )}

        {loading ? (
          <div className="data-panel-body">
            <SkeletonTable rows={8} cols={6} />
          </div>
        ) : products.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="shelf" />
            <p>{serviceLed ? t('seller.noServicesYet') : t('seller.noProducts')}</p>
            {canSell && (
              <button type="button" className="btn btn-primary btn-small btn-inline" onClick={openAddForm}>
                <PlusIcon size={15} />
                {serviceLed ? t('seller.addYourFirstService') : t('seller.addYourFirstProduct')}
              </button>
            )}
          </div>
        ) : sorted.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="search" />
            <p>{t('table.noResults')}</p>
            <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={clearFilters}>
              <FilterClearIcon size={15} /> {t('table.clearFilters')}
            </button>
          </div>
        ) : (
          <>
            <div className="table-wrap mobile-cards">
              {/* Every other wide list in the app declares its own minimum — orders 820,
                  purchase orders 860, billing 720 — because `.data-table`'s CSS floor is
                  min(720px, 100%), which is deliberately generous so three-column tables
                  aren't forced to scroll. This table never got one, and it is the widest
                  in the app: eight columns, one of which is a five-button action group
                  worth ~186px on its own. On a 1366 laptop that is fine. On a 1280 screen
                  at Windows' 125% scaling — a 1024px viewport, so ~747px of table — the
                  seven fixed columns want ~736px and the product name, the only flexible
                  one, was left with about ten pixels. It did not overflow; it shattered,
                  one letter per line, exactly as the phone cards did.
                  940 gives the name ~200px before the wrapper starts scrolling, and is
                  below the width a 1366 laptop already has, so the common case is
                  unchanged. */}
              <table
                className={`data-table sticky-actions${density === 'compact' ? ' compact' : ''}`}
                style={{ minWidth: '940px' }}
              >
                <thead>
                  <tr>
                    <th className="tight">
                      <input
                        type="checkbox"
                        className="row-check"
                        aria-label={t('table.selectAll')}
                        checked={allPageSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = !allPageSelected && somePageSelected;
                        }}
                        onChange={toggleAllOnPage}
                      />
                    </th>
                    {/* Widths, because letting the browser decide was giving the space to
                        the wrong columns. `th` is `white-space: nowrap`, so a long HEADER
                        sets a floor no matter how short its data is: "Expiry date
                        (optional)" reserved roughly twice the width of "25/5/2028", while
                        Stock — which carries a figure, a unit and a pack breakdown — was
                        squeezed until "189 packet" wrapped onto two lines. Declaring them
                        puts the room where the content is. Name stays unsized so it takes
                        whatever is left, which is the column that can actually use it. */}
                    <SortHeader sortKey="name" label={t('seller.productName')} sort={sort} onSort={toggle} />
                    <SortHeader sortKey="hsn" label={t('seller.hsnCode')} sort={sort} onSort={toggle} width="5.5rem" />
                    <SortHeader sortKey="price" label={t('seller.price')} sort={sort} onSort={toggle} align="right" width="6.5rem" />
                    <SortHeader sortKey="stock" label={t('seller.stock')} sort={sort} onSort={toggle} align="right" width="8rem" />
                    <SortHeader sortKey="value" label={t('seller.stockValue')} sort={sort} onSort={toggle} align="right" width="6rem" />
                    {/* "(optional)" is guidance for the person FILLING the field, and it
                        belongs on the add-product form — where the same string still says
                        it. In a column header it is not information, it is rent. */}
                    <SortHeader sortKey="expiry" label={t('seller.expiryColumn')} sort={sort} onSort={toggle} width="6rem" />
                    <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.pageItems.map((product) => {
                    const stockKey = stockStatus(product);
                    const expiry = expiryStatus(effectiveExpiry(product));
                    const selected = selectedIds.has(product._id);
                    return (
                      <tr key={product._id} className={selected ? 'selected' : undefined}>
                        <td className="tight">
                          <input
                            type="checkbox"
                            className="row-check"
                            aria-label={t('table.selectRow')}
                            checked={selected}
                            onChange={() => toggleRow(product._id)}
                          />
                        </td>
                        <td>
                          <div className="product-name-cell">
                            {product.photoUrl ? (
                              <img src={product.photoUrl} alt="" className="product-thumb" />
                            ) : (
                              <PhotoFallback item={product} />
                            )}
                            <div className="product-name-meta">
                              {/* The name is the way in to the product's own page. It used
                                  to be plain text, so everything about a product was
                                  reachable only through a modal you could not link to. */}
                              <Link href={recordHref('/seller/products/[id]', product._id)} className="name product-name-link">
                                {product.name}
                              </Link>
                              <span className="cell-sub">
                                {/* Twelve rows called "Cotton Shirt — M / Blue" read as
                                    clutter without this: the tag is what says they are one
                                    item, and the group name is what the seller searches. */}
                                {product.variantGroup && (
                                  <span className="badge badge-pending">
                                    {product.variantAttributes?.map((a) => a.value).join(' / ') || product.variantGroup}
                                  </span>
                                )}
                                {product.category && (
                                  <span className="category-tag" style={categoryStyle(product.category)}>{product.category}</span>
                                )}
                                {product.showInCatalog === false && (
                                  <span className="badge badge-inactive">{t('seller.hiddenInCatalog')}</span>
                                )}
                                {product.status && product.status !== 'active' && (
                                  <span className="badge badge-inactive">{product.status}</span>
                                )}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="cell-muted">
                          <div className="cell-stack">
                            <span>{product.hsnCode || '—'}</span>
                            {Number(product.gstRate) > 0 && (
                              <span className="cell-sub">{t('seller.gstShort', { rate: product.gstRate })}</span>
                            )}
                          </div>
                        </td>
                        <td className="num">
                          <div className="cell-stack">
                            <span className="cell-strong">{money(product.price)}</span>
                            <span className="cell-sub">/ {product.unit}</span>
                            {/* What one loose piece costs — the number the counter will
                                actually charge for "ek goli", worked out here so nobody
                                has to divide 55 by 15 at the till. */}
                            {packSizeOf(product) > 0 && (
                              <span className="cell-sub">
                                {t('pack.perPiece', { price: formatSubUnitPrice(subUnitPriceOf(product)), subUnit: t(`units.${product.subUnit}`) })}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="num">
                          {product.kind === 'service' && stockKey !== 'dish' ? (
                            <span className="badge badge-active">
                              {t('seller.serviceRow', { minutes: product.durationMinutes || 30 })}
                            </span>
                          ) : stockKey === 'dish' ? (
                            <DishStock product={product} t={t} lang={lang} block />
                          ) : (
                            <>
                              <span className={`stock-dot ${stockKey === 'out' ? 'out' : stockKey === 'low' ? 'low' : 'ok'}`} />
                              <strong>{sellableStock(product)} {product.unit}</strong>
                              {packStockLabel(product, t) && (
                                <span className="cell-sub" style={{ display: 'block', marginTop: '0.25rem' }}>
                                  {packStockLabel(product, t)}
                                </span>
                              )}
                              {product.trackBatches && Number(product.expiredStock) > 0 && (
                                <span className="cell-sub" style={{ display: 'block', marginTop: '0.25rem' }}>
                                  {t('seller.onShelfVsExpired', { shelf: product.stock, expired: product.expiredStock })}
                                </span>
                              )}
                              {stockKey === 'low' && <span className="badge badge-pending" style={{ marginLeft: '0.4rem' }}>{t('seller.lowStock')}</span>}
                              {stockKey === 'out' && <span className="badge badge-expired" style={{ marginLeft: '0.4rem' }}>{t('seller.outOfStock')}</span>}
                            </>
                          )}
                        </td>
                        <td className="num cell-muted">
                          {product.kind === 'service' || stockKey === 'dish' ? '—' : money((Number(product.price) || 0) * sellableStock(product))}
                        </td>
                        <td>
                          {effectiveExpiry(product) ? (
                            <span className="expiry-cell">
                              <span className="expiry-date">{new Date(effectiveExpiry(product)).toLocaleDateString('en-IN')}</span>
                              {expiry.key === 'expiring' && (
                                <span className={`badge ${expiry.className}`}>{t('expiry.daysLeft', { days: expiry.days })}</span>
                              )}
                              {expiry.key === 'expired' && (
                                <span className={`badge ${expiry.className}`}>{t('expiry.expiredAgo', { days: expiry.days })}</span>
                              )}
                              {/* On a tracked product this date belongs to one lot out of
                                  several, and which lot it is decides what the seller pulls
                                  off the shelf. Saying only the date would send him looking
                                  through every strip of that medicine. */}
                              {product.trackBatches && product.nearestExpiryBatch && (
                                <span className="cell-sub">
                                  {t('seller.expiryLotHint', { batch: product.nearestExpiryBatch, lots: product.lotCount || 1 })}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="cell-sub">—</span>
                          )}
                        </td>
                        <td className="tight">
                          <div className="row-actions-hover">
                            {canSell && (
                              <button type="button" className="icon-btn" data-tip={t('common.edit')} onClick={() => openEditForm(product)}>
                                <EditIcon size={17} />
                              </button>
                            )}
                            {/* Nothing to adjust on a service — it has no StoreStock row. */}
                            {product.kind !== 'service' && !(showBatches && product.trackBatches) && (
                              <button type="button" className="icon-btn" data-tip={t('seller.adjustStock')} onClick={() => setAdjustProduct(product)}>
                                <SlidersIcon size={17} />
                              </button>
                            )}
                            {/* A batch-tracked product's stock only moves lot by lot, so
                                the blanket adjust above is replaced rather than added to —
                                two ways to set the same number is how they drift apart.
                                Hidden entirely for trades whose stock never expires — a
                                hardware shop has no lots. */}
                            {product.kind !== 'service' && showBatches && (
                              <button type="button" className="icon-btn" data-tip={t('seller.batchesAction')} onClick={() => setBatchProduct(product)}>
                                <LayersIcon size={17} />
                              </button>
                            )}
                            {/* "10 packet the, ab 3 kyun?" — every movement of this one
                                product in one timeline. The question inventory software
                                exists to answer, and the one this app could not. */}
                            {product.kind !== 'service' && (
                              <button type="button" className="icon-btn" data-tip={t('seller.stockLedger')} onClick={() => setLedgerProduct(product)}>
                                <ClockIcon size={17} />
                              </button>
                            )}
                            {canSell && (
                              <button type="button" className="icon-btn danger" data-tip={t('common.delete')} onClick={() => handleDelete(product)}>
                                <TrashIcon size={17} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* The same page of rows restated for phones, where a 8-column table would
                mean horizontal scrolling — the single worst thing about most shop apps. */}
            <div className="record-cards mobile-only">
              {page.pageItems.map((product) => {
                const stockKey = stockStatus(product);
                const expiry = expiryStatus(effectiveExpiry(product));
                return (
                  <div className="record-card" key={product._id}>
                    {product.photoUrl ? (
                      <img src={product.photoUrl} alt="" className="product-thumb" />
                    ) : (
                      <PhotoFallback item={product} />
                    )}
                    <div className="record-card-main">
                      <Link href={recordHref('/seller/products/[id]', product._id)} className="record-card-title product-name-link">
                        {product.name}
                      </Link>
                      <div className="record-card-meta">
                        {product.kind === 'service' && stockKey !== 'dish' ? (
                          <span className="badge badge-active">
                            {t('seller.serviceRow', { minutes: product.durationMinutes || 30 })}
                          </span>
                        ) : stockKey === 'dish' ? (
                          <DishStock product={product} t={t} lang={lang} />
                        ) : (
                          <span>
                            <span className={`stock-dot ${stockKey === 'out' ? 'out' : stockKey === 'low' ? 'low' : 'ok'}`} />
                            <strong>{packStockLabel(product, t) || `${sellableStock(product)} ${product.unit}`}</strong>
                            {product.trackBatches && Number(product.expiredStock) > 0 &&
                              ` · ${t('seller.expiredCount', { count: product.expiredStock })}`}
                          </span>
                        )}
                        {product.category && (
                          <span className="category-tag" style={categoryStyle(product.category)}>{product.category}</span>
                        )}
                        {expiry.key === 'expiring' && (
                          <span className={`badge ${expiry.className}`}>{t('expiry.daysLeft', { days: expiry.days })}</span>
                        )}
                        {expiry.key === 'expired' && (
                          <span className={`badge ${expiry.className}`}>{t('expiry.expiredAgo', { days: expiry.days })}</span>
                        )}
                        {stockKey === 'out' && product.kind !== 'service' && <span className="badge badge-expired">{t('seller.outOfStock')}</span>}
                        {stockKey === 'low' && product.kind !== 'service' && <span className="badge badge-pending">{t('seller.lowStock')}</span>}
                      </div>
                    </div>
                    <div className="record-card-side">
                      <span className="record-card-price">{money(product.price)}</span>
                      <div className="row-actions">
                        {canSell && (
                          <button type="button" className="icon-btn" data-tip={t('common.edit')} onClick={() => openEditForm(product)}>
                            <EditIcon size={17} />
                          </button>
                        )}
                        {product.kind !== 'service' && !(showBatches && product.trackBatches) && (
                          <button type="button" className="icon-btn" data-tip={t('seller.adjustStock')} onClick={() => setAdjustProduct(product)}>
                            <SlidersIcon size={17} />
                          </button>
                        )}
                        {product.kind !== 'service' && showBatches && (
                          <button type="button" className="icon-btn" data-tip={t('seller.batchesAction')} onClick={() => setBatchProduct(product)}>
                            <LayersIcon size={17} />
                          </button>
                        )}
                        {/* "10 packet the, ab 3 kyun?" — this was on the desktop row but
                            not on the phone card, so the one screen a shopkeeper actually
                            has in their hand on the shop floor could not answer it. */}
                        {product.kind !== 'service' && (
                          <button type="button" className="icon-btn" data-tip={t('seller.stockLedger')} onClick={() => setLedgerProduct(product)}>
                            <ClockIcon size={17} />
                          </button>
                        )}
                        {canSell && (
                          <button type="button" className="icon-btn danger" data-tip={t('common.delete')} onClick={() => handleDelete(product)}>
                            <TrashIcon size={17} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
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
              label={t('seller.products')}
            />
          </>
        )}
      </div>

      <AdjustmentHistory
        adjustments={adjustments}
        open={historyOpen}
        onToggle={() => setHistoryOpen((v) => !v)}
        t={t}
      />

      {canSell && (
        <VariantBuilder
          open={variantOpen}
          onClose={() => setVariantOpen(false)}
          onCreated={load}
          businessType={bizType}
          categories={categories}
        />
      )}

      {/* Counts whatever the list is currently filtered to — not the current page: you
          count a shelf, and a shelf does not stop at row 25. */}
      {kitchenOpen && canSell && (
        <KitchenStock
          onClose={() => setKitchenOpen(false)}
          onChanged={load}
          onOpenProduct={(id) => {
            const product = products.find((p) => p._id === id);
            if (product) {
              setKitchenOpen(false);
              openEditForm(product);
            }
          }}
        />
      )}

      {stockTakeOpen && canSell && (
        <StockTake
          // A recipe dish has no shelf to count — its ingredients are on this list.
          products={sorted.filter((p) => !(p.recipe?.length && p.kind !== 'service'))}
          scopeLabel={
            categoryFilter ||
            (stockFilter !== 'all'
              ? t(STOCK_FILTER_LABELS[stockFilter])
              : search.trim() || t('seller.allCategories'))
          }
          onClose={() => setStockTakeOpen(false)}
          onSaved={load}
        />
      )}

      {batchProduct && (
        <BatchManager product={batchProduct} onClose={() => setBatchProduct(null)} onChanged={load} />
      )}

      {ledgerProduct && <StockLedgerModal product={ledgerProduct} onClose={() => setLedgerProduct(null)} t={t} />}

      {importOpen && canSell && (
        <Modal
          /* Three dialogs' worth of chrome, driven off one value.
             While the sheet is in flight there is no close button, no Escape and no
             backdrop dismiss: half an import is not a state this app can undo, and a
             misplaced tap on a phone is how you get one. Once it has finished the card is
             fully dismissible again — the seller has read it, or they have not, and that
             is their call. */
          onClose={importPhase === 'running' || importPhase === 'checking' ? undefined : closeImport}
          title={importPhase === 'idle' ? t('seller.importTitle') : undefined}
          /* The running and finished cards carry their own heading, so the dialog is named
             by that rather than by a header bar it does not draw. */
          labelledBy={importPhase === 'idle' ? undefined : 'import-run-title'}
          className={`import-modal${importPhase === 'idle' ? '' : ' import-modal--run'}${importPhase === 'review' ? ' import-modal--review' : ''}`}
          /* Keep the width stable; each phase uses only the height its content needs. */
          maxWidth={560}
          overlayClassName="import-overlay"
          closeOnBackdrop={importPhase === 'idle'}
          closeOnEscape={importPhase !== 'running' && importPhase !== 'checking'}
          /* The upload button lives in the pinned action row, not down at step 3 with the
             rest of the instructions. Three numbered steps plus their hints is taller than
             a laptop's viewport, so the one control the shopkeeper opened this dialog to
             press was the first thing to scroll out of sight. `footer` is the band Modal
             never lets scroll.
             The running card has no footer at all: there is nothing to press while a sheet
             is being imported, and an empty pinned bar is just a band of dead chrome under
             a card that is trying to look calm. */
          footer={
            importPhase === 'idle' ? (
              <label className="btn btn-primary btn-inline" style={{ cursor: 'pointer' }}>
                <UploadIcon size={17} />
                {t('seller.importProducts')}
                <input type="file" accept=".xlsx" onChange={handleImportFile} style={{ display: 'none' }} />
              </label>
            ) : importPhase === 'review' ? (
              <div className="import-review-actions">
                <p className="import-review-intro">{t('seller.importReviewChoose')}</p>
                <div className="import-review-choice">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={writeWait > 0 || importReviewBusy || Boolean(importPreview?.nameMatches?.length)}
                    data-tip={t('seller.importReviewMergeHint')}
                    aria-describedby="import-merge-hint"
                    onClick={() => runImport(importBytesRef.current, 'merge')}
                  >
                    {t('seller.importReviewMerge')}
                  </button>
                  <p id="import-merge-hint">{t('seller.importReviewMergeHint')}</p>
                </div>
                <div className="import-review-choice">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-tip={t(importPreview?.newRows > 0 ? 'seller.importReviewAddHint' : 'seller.importReviewAddZeroHint', { count: formatQty(importPreview?.newRows || 0, lang) })}
                    disabled={writeWait > 0 || importReviewBusy || Boolean(importPreview?.nameMatches?.length)}
                    aria-describedby="import-add-hint"
                    onClick={() => runImport(importBytesRef.current, 'add')}
                  >
                    {t('seller.importReviewAddOnly')}
                  </button>
                  <p id="import-add-hint">
                    {t(importPreview?.newRows > 0 ? 'seller.importReviewAddHint' : 'seller.importReviewAddZeroHint', { count: formatQty(importPreview?.newRows || 0, lang) })}
                  </p>
                </div>
              </div>
            ) : importPhase === 'paused' ? (
              <>
                <button type="button" className="btn btn-primary" disabled={previewWait > 0 || importReviewBusy} onClick={() => resolveImportMatch(null, null)}>
                  {t('seller.importCheckAgain')}
                </button>
                <button type="button" className="btn btn-secondary" onClick={closeImport}>{t('common.close')}</button>
              </>
            ) : importPhase === 'failed' ? (
              importFail?.maybeRan ? (
                <>
                  {/* The loud action is "go and look", not "do it again". The sheet may
                      still be going in on the server, and a second import while the first
                      is running is the one outcome this screen must not make easy. */}
                  <button type="button" className="btn btn-primary btn-inline" onClick={closeImport}>
                    {t('seller.importViewProducts')}
                  </button>
                  <button type="button" className="btn btn-secondary btn-inline" onClick={resetImport}>
                    {t('seller.importTryAgain')}
                  </button>
                </>
              ) : (
                <>
                  {/* Nothing reached the catalog, so trying again is simply the next step. */}
                  <button type="button" className="btn btn-primary btn-inline" onClick={resetImport}>
                    {t('seller.importTryAgain')}
                  </button>
                  <button type="button" className="btn btn-secondary btn-inline" onClick={closeImport}>
                    {t('common.close')}
                  </button>
                </>
              )
            ) : importPhase === 'done' ? (
              importAddedNothing(importResult) ? (
                <>
                  {/* Nothing was added, so "View products" would send the seller to look at
                      a list that has not changed. What they need is the sheet fixed and sent
                      again, and that is what the loud button does. */}
                  <button type="button" className="btn btn-primary btn-inline" onClick={resetImport}>
                    {t('seller.importAnother')}
                  </button>
                  <button type="button" className="btn btn-secondary btn-inline" onClick={closeImport}>
                    {t('common.close')}
                  </button>
                </>
              ) : (
                <>
                  {/* The catalog behind this dialog was reloaded before the card was drawn,
                      so this really does hand them the list with the new rows in it. */}
                  <button type="button" className="btn btn-primary btn-inline" onClick={closeImport}>
                    {t('seller.importViewProducts')}
                  </button>
                  {/* A shop that splits its catalog across two sheets imports twice in a row.
                      Sending them back through the Import button on the page for that is one
                      click of nothing. */}
                  <button type="button" className="btn btn-secondary btn-inline" onClick={resetImport}>
                    {t('seller.importAnother')}
                  </button>
                </>
              )
            ) : null
          }
        >
          {importPhase === 'idle' ? (
            <>
            {/* Above the steps, not below them. A message rendered under step 3 was another
                scroll away from the button that produced it — so the answer to "did it
                work?" arrived off-screen. Counts and refused rows no longer come out here
                at all: those belong to the finished card, which the seller is already
                looking at when they arrive. */}
            {importError && <div className="error-banner" style={{ marginBottom: '0.9rem' }}>{importError}</div>}

            {/* Step 1 — the sample file. Without it the seller has to guess the column
                names, and a sheet with the wrong headers imports nothing at all. The file
                comes filled with this trade's own stock, so the seller overtypes examples
                that already read like their shop instead of reading a guide. */}
            <div className="import-step">
              <span className="import-step-num">1</span>
              <div className="import-step-body">
                <strong>{t('seller.importStep1')}</strong>
                <p>{t('seller.importStep1Hint')}</p>
                {/* Picker and button on one row: the dropdown decides what the button
                    gives you, so stacking them cost a whole line to say nothing. */}
                <div className="import-sample-pick">
                  <label htmlFor="import-sample-type">{t('seller.importSampleFor')}</label>
                  <Dropdown
                    id="import-sample-type"
                    className="import-sample-type"
                    value={sampleType || bizType}
                    onChange={setSampleType}
                    searchable
                    searchPlaceholder={t('seller.importSampleSearch')}
                    options={businessTypeOptions(t).map((option) => ({
                      value: option.key,
                      label: `${option.icon} ${option.label}`,
                    }))}
                  />
                  <a
                    className="btn btn-secondary btn-small btn-inline"
                    href={`${API_URL}/api/public/product-import-template.xlsx?type=${sampleType || bizType}`}
                  >
                    <DownloadIcon size={15} /> {t('seller.importDownloadSample')}
                  </a>
                </div>
              </div>
            </div>

            <div className="import-step">
              <span className="import-step-num">2</span>
              <div className="import-step-body">
                <strong>{t('seller.importStep2')}</strong>
                <p>{t('seller.importStep2Hint')}</p>
              </div>
            </div>

            <div className="import-step">
              <span className="import-step-num">3</span>
              <div className="import-step-body">
                <strong>{t('seller.importStep3')}</strong>
                {/* No button here — it is pinned in the footer below, which is where the
                    thumb finds it whether or not this step is still on screen. */}
                <p>{t('seller.importHint')}</p>
              </div>
            </div>

            <p className="import-warning">{t('seller.importDuplicateWarning')}</p>
            </>
          ) : (
            <ImportProgress
              phase={importPhase}
              stage={importStage}
              file={importFile}
              result={importResult}
              detailsOpen={importDetails}
              /* The catalog was reloaded before this card was drawn, so this is the real
                 count the shop is now carrying, not the old one plus what went in. */
              catalogTotal={products.length}
              error={importFail}
              preview={importPreview}
              stockMode={importStockMode}
              onStockModeChange={(mode) => resolveImportMatch(null, null, mode)}
              priceMode={importPriceMode}
              onPriceModeChange={(mode) => resolveImportMatch(null, null, importStockMode, mode)}
              onResolveMatch={resolveImportMatch}
              reviewBusy={importReviewBusy || previewWait > 0}
              previewWait={previewWait}
              writeWait={writeWait}
              onToggleDetails={() => setImportDetails((open) => !open)}
              t={t}
              lang={lang}
            />
          )}
        </Modal>
      )}

      {formOpen && canSell && (
        <Modal
          as="form"
          onSubmit={handleSubmit}
          onClose={closeForm}
          title={editingId ? t('seller.editProduct') : t('seller.addProduct')}
          hint={editingId ? form.name : t('seller.addProductHint')}
          maxWidth={760}
          footer={
            <>
              {/* Inside the pinned bar, next to the button that caused it. On the page it
                  rendered behind this dialog; in the scrolling body it would sit above the
                  fold of a form that is taller than the screen. */}
              {formError && <div className="modal-actions-error">{formError}</div>}
              <button type="submit" className="btn btn-primary btn-inline" disabled={submitting}>
                {submitting ? t('common.saving') : editingId ? t('common.saveChanges') : t('common.add')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={closeForm}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
              {/* Whether this line sits on a shelf or is sold as time — a haircut, a wash
                  cycle, an hour of tuition. Locked once saved: flipping an existing
                  product would strand its stock rows and rewrite what every past bill
                  line meant, so a changed mind means a new entry instead. */}
              {editingId ? (
                form.kind === 'service' && (
                  <p className="field-hint" style={{ marginBottom: '0.6rem' }}>{t('seller.serviceLocked')}</p>
                )
              ) : canToggleKind ? (
                // One line, not a full-width row: it is a two-option question that used to
                // take as much of the dialog as the product's name.
                <div className="kind-row">
                  <span>{t('seller.productKind')}</span>
                  <div className="segmented segmented-sm" role="group">
                    <button
                      type="button"
                      className={form.kind === 'goods' ? 'active' : ''}
                      onClick={() =>
                        setForm((f) =>
                          f.kind === 'goods'
                            ? f
                            : {
                                ...f,
                                kind: 'goods',
                                // A salon's own default unit is 'service' — no good for a
                                // shampoo bottle it also retails, so goods fall back to
                                // 'piece' whenever the trade's usual unit is time-based.
                                unit: SERVICE_UNITS.includes(biz.defaultUnit) ? 'piece' : biz.defaultUnit,
                              }
                        )
                      }
                    >
                      {t('seller.kindGoods')}
                    </button>
                    <button
                      type="button"
                      className={form.kind === 'service' ? 'active' : ''}
                      onClick={() =>
                        setForm((f) =>
                          f.kind === 'service' ? f : { ...f, kind: 'service', unit: SERVICE_UNITS.includes(f.unit) ? f.unit : 'service' }
                        )
                      }
                    >
                      {t('seller.kindService')}
                    </button>
                  </div>
                </div>
              ) : null}
              {/* What is being created, as it will actually read on a shelf label and in the
                  catalog — and the one number a form like this can work out for you, the
                  margin, while the price is still being typed. The photo picker lives here
                  too: a square you tap that then shows the photo, instead of the browser's
                  "Choose File / No file chosen" slab at the bottom of the dialog. */}
              <div className="product-preview">
                <div className="photo-slot">
                  <label className={`photo-tile${form.photoUrl ? ' filled' : ''}`} data-tip={t('seller.productPhoto')}>
                    <input type="file" accept="image/*" onChange={handlePhoto} aria-label={t('seller.productPhoto')} />
                    {form.photoUrl ? (
                      <img src={form.photoUrl} alt="" />
                    ) : (
                      <>
                        <PackageIcon size={18} />
                        {t('seller.addPhoto')}
                      </>
                    )}
                  </label>
                  {form.photoUrl && (
                    <button
                      type="button"
                      className="photo-remove"
                      onClick={() => setForm((f) => ({ ...f, photoUrl: '' }))}
                      aria-label={t('seller.remove')}
                    >
                      <XIcon size={11} />
                    </button>
                  )}
                </div>
                <div className="product-preview__body">
                  <span className={`product-preview__name${form.name ? '' : ' placeholder'}`}>
                    {form.name || t('seller.previewNamePlaceholder')}
                  </span>
                  <div className="product-preview__price">
                    {/* A dash, not ₹0, until a price is typed — an empty form must not state
                        a rate nobody set. */}
                    {Number(form.price) > 0 ? (
                      <span className="amount">{formatRupees(Number(form.price), lang)}</span>
                    ) : (
                      <span className="amount placeholder">₹—</span>
                    )}
                    {form.unit && form.unit !== 'piece' && <span className="per">/{t(`units.${form.unit}`)}</span>}
                    {previewSaving > 0 && <span className="mrp">{formatRupees(Number(form.mrp), lang)}</span>}
                    {previewSaving > 0 && (
                      <span className="meta-chip good">{t('seller.previewSaving', { amount: formatRupees(previewSaving, lang) })}</span>
                    )}
                  </div>
                  <div className="product-preview__meta">
                    {form.category && <span className="meta-chip">{form.category}</span>}
                    {form.kind !== 'service' && Number(form.stock) > 0 && (
                      <span className="meta-chip">{t('seller.previewStock', { qty: form.stock, unit: t(`units.${form.unit}`) })}</span>
                    )}
                    {/* Margin, the moment both numbers exist. A price typed below cost is the
                        mistake this dialog can actually catch, and it says so here rather
                        than after the sale shows up as a loss in Insights. */}
                    {previewMargin && (
                      <span className={`meta-chip ${previewMargin.percent < 0 ? 'warn' : 'good'}`}>
                        {t('seller.previewMargin', { amount: formatRupees(previewMargin.amount, lang), percent: previewMargin.percent.toFixed(1) })}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Basic: the minimum a shopkeeper needs to know to sell this thing on day
                  one. Everything more specialised (GST, HSN, barcode, expiry...) lives
                  behind "More details" so a first-time entry isn't a wall of fields. */}
              {/* Order is deliberate: the two required fields sit together on the first row
                  (name is two tracks wide — it is the longest thing anyone types here), and
                  the optional three follow. Before this, name shared a four-across row with
                  Stock and Unit at 165px each, and Category was orphaned on a row of its
                  own with three empty tracks beside it. */}
              <div className="form-grid">
                <div className="field field-span2">
                  {/* `id="product-name"`, never `id="name"`. Chrome classifies a field from
                      its id, and to that classifier "name" means a PERSON's name — which is
                      why this box used to open the browser's saved-profile list, offering the
                      shopkeeper their own name and their organisation as the product. */}
                  <label htmlFor="product-name">{t('seller.productName')} <span className="field-required">*</span></label>
                  <input id="product-name" value={form.name} onChange={update('name')} required />
                </div>
                <div className="field">
                  <label htmlFor="price">{t('seller.price')} <span className="field-required">*</span></label>
                  <div className="field-affix">
                    <span className="affix lead">₹</span>
                    <input id="price" type="number" min="0" step="0.01" value={form.price} onChange={update('price')} required />
                  </div>
                  {/* Offered, never filled in. A price that appears by itself is a price
                      nobody checked, and the pack in the shopkeeper's hand is the only
                      authority on what it costs — this is a shortcut past typing, not a
                      substitute for reading. The spread is shown whenever shops disagree,
                      so a suggestion can never pass itself off as one settled number. */}
                  {priceHint && (
                    <button type="button" className="price-hint" onClick={applyPriceHint}>
                      <span className="price-hint-amount">₹{priceHint.price}</span>
                      <span className="price-hint-note">
                        {t('seller.priceHint', { count: priceHint.shopCount })}
                        {priceHint.minPrice !== priceHint.maxPrice
                          ? ` · ${t('seller.priceHintRange', { min: priceHint.minPrice, max: priceHint.maxPrice })}`
                          : ''}
                      </span>
                    </button>
                  )}
                </div>
                {form.kind === 'service' ? (
                  <div className="field">
                    <label htmlFor="durationMinutes">{t('seller.duration')}</label>
                    <input
                      id="durationMinutes"
                      type="number"
                      min="5"
                      step="5"
                      value={form.durationMinutes}
                      onChange={update('durationMinutes')}
                    />
                    <p className="field-hint">{t('seller.durationHint')}</p>
                  </div>
                ) : (
                  <div className="field">
                    <label htmlFor="stock">{t('seller.stock')}</label>
                    <div className="field-affix">
                      {/* Read-only once the product is tracked by batch: its stock is the sum
                          of its lots, and the server ignores anything typed here — which
                          until now meant the box accepted a number, saved without complaint
                          and changed nothing. Better to say so than to take the typing. */}
                      <input
                        id="stock"
                        type="number"
                        min="0"
                        step="0.001"
                        value={form.stock}
                        onChange={update('stock')}
                        readOnly={Boolean(form.trackBatches)}
                      />
                      <span className="affix trail">{t(`units.${form.unit}`)}</span>
                    </div>
                    {form.trackBatches && <p className="field-hint">{t('seller.stockBatchLocked')}</p>}
                    {/* A dish's own stock is never read: billing takes its ingredients. */}
                    {form.recipe.some((r) => r.product) && <p className="field-hint">{t('recipe.dishStockNote')}</p>}
                  </div>
                )}
                <div className="field">
                  <label htmlFor="unit">{t('seller.unit')}</label>
                  <Dropdown
                    id="unit"
                    value={form.unit}
                    onChange={setField('unit')}
                    groups={unitOptions(t, biz.preferredUnits).map((group) => ({ label: group.label, options: group.units }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="category">{t('seller.category')}</label>
                  <input id="category" value={form.category} onChange={update('category')} list="product-category-options" />
                  {/* The shop's own categories first, then this trade's usual ones — so an
                      empty catalog still gets useful suggestions on day one. */}
                  <datalist id="product-category-options">
                    {[...categories, ...biz.categories.filter((c) => !categories.includes(c))].map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
              </div>

              <button
                type="button"
                className="form-section-toggle"
                onClick={() =>
                  setAdvancedOpen((open) => {
                    const next = !open;
                    try {
                      localStorage.setItem(ADVANCED_PREF_KEY, next ? '1' : '0');
                    } catch {
                      // localStorage unavailable — the toggle still works, it just won't be remembered
                    }
                    return next;
                  })
                }
                aria-expanded={advancedOpen}
              >
                {advancedOpen ? <ChevronDownIcon size={15} /> : <ChevronRightIcon size={15} />}
                {t('seller.moreDetails')}
              </button>

              {advancedOpen && (
                <div className="form-section-body">
                  {/* Grouped, and each group named. These are the same fields as before in the
                      same order — the difference is that "cost, MRP, GST, HSN" now reads as
                      one question about money instead of four strangers sharing a row with a
                      barcode and an expiry date. */}
                  <p className="form-subhead">{t('seller.groupRate')}</p>
                  {/* Four fields, so two tracks: three-across would strand HSN on a row of
                      its own, and the wider track is what lets "HSN [Suggest]" breathe. */}
                  <div className="form-grid cols-2">
                    <div className="field">
                      <label htmlFor="costPrice">{t('seller.costPrice')}</label>
                      <div className="field-affix">
                        <span className="affix lead">₹</span>
                        <input id="costPrice" type="number" min="0" step="0.01" value={form.costPrice} onChange={update('costPrice')} />
                      </div>
                    </div>
                    {/* The printed maximum, which is a different thing from what this shop
                        charges. Left empty by the many shops that simply sell at MRP; when
                        it is filled the shelf label carries it struck through above the
                        rate, and the receipt says how much the customer saved. */}
                    <div className="field">
                      <label htmlFor="mrp">{t('seller.mrp')}</label>
                      <div className="field-affix">
                        <span className="affix lead">₹</span>
                        <input id="mrp" type="number" min="0" step="0.01" value={form.mrp} onChange={update('mrp')} />
                      </div>
                      {Number(form.mrp) > 0 && Number(form.price) > 0 && Number(form.mrp) > Number(form.price) && (
                        <p className="field-hint">
                          {t('seller.mrpSavingHint', { amount: (Number(form.mrp) - Number(form.price)).toFixed(2) })}
                        </p>
                      )}
                      {Number(form.mrp) > 0 && Number(form.price) > Number(form.mrp) && (
                        <p className="field-hint" style={{ color: 'var(--text-warning)' }}>{t('seller.mrpBelowPriceHint')}</p>
                      )}
                    </div>
                    <div className="field">
                      <label htmlFor="gstRate">{t('seller.gstRate')}</label>
                      <Dropdown
                        id="gstRate"
                        value={form.gstRate}
                        onChange={setField('gstRate')}
                        options={gstRateOptions(form.gstRate)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="hsnCode">{t('seller.hsnCode')}</label>
                      <div className="input-action">
                        <input id="hsnCode" value={form.hsnCode} onChange={update('hsnCode')} />
                        <button type="button" className="btn btn-secondary btn-small" onClick={handleSuggestHsn}>
                          {t('seller.suggestHsn')}
                        </button>
                      </div>
                      {hsnSuggestions.length > 0 && (
                        <p className="field-hint">{hsnSuggestions.map((s) => `${s.code} (${s.label})`).join(', ')}</p>
                      )}
                    </div>
                  </div>

                  {/* Barcode, low-stock alerting and expiry only mean something for a
                      thing on a shelf — a service is never scanned at a till, never runs
                      low and never expires. */}
                  {form.kind !== 'service' && (
                    <>
                      <p className="form-subhead">{t('seller.groupCodes')}</p>
                      {/* Two tracks: a 13-digit barcode plus its Scan button needs more than a
                          third of the dialog, and the codes list below wants a full row for its
                          chips. */}
                      <div className="form-grid cols-2">
                        <div className="field">
                          <label htmlFor="barcode">{t('seller.barcode')}</label>
                          <div className="input-action">
                            <input
                              id="barcode"
                              value={form.barcode}
                              onChange={update('barcode')}
                              onBlur={() => lookupExternalBarcode(form.barcode)}
                              onKeyDown={(e) => {
                                // A hardware scanner gun "types" the barcode then sends Enter —
                                // treat that as "confirm this barcode", not "submit the form"
                                // (price is still empty at this point and would block submit).
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  lookupExternalBarcode(form.barcode);
                                }
                              }}
                            />
                            {/* Icon + one word. "Scan with camera" is four words: next to an
                                input in a grid track it wrapped onto three lines and squeezed
                                the box it belongs to down to 85px. The full sentence is still
                                the scanner dialog's own title. */}
                            <button
                              type="button"
                              className="btn btn-secondary btn-small btn-inline"
                              onClick={() => openBarcodeScanner('barcode')}
                              data-tip={t('seller.scanWithCamera')}
                            >
                              <BarcodeIcon size={15} /> {t('seller.scan')}
                            </button>
                          </div>
                          {lookingUpBarcode && <p className="field-hint">{t('seller.barcodeLookingUp')}</p>}
                        </div>
                        {/* Most packs now carry a QR beside the barcode, and the two do not
                            hold the same value. Whichever one the counter happens to scan has
                            to find this product — which is what this list is for. Also where a
                            wholesaler's carton code goes. Two tracks wide: it holds an input, a
                            row of chips and a line of explanation. */}
                        <div className="field field-span2">
                          <label htmlFor="altCode">{t('seller.extraCodes')}</label>
                          <div className="input-action">
                            <input
                              id="altCode"
                              value={altCodeDraft}
                              onChange={(e) => setAltCodeDraft(e.target.value)}
                              placeholder={t('seller.extraCodesPlaceholder')}
                              onKeyDown={(e) => {
                                // Same reason as the barcode box above: a scanner gun ends with
                                // Enter, and that must mean "add this code", not "save".
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  addAltCode(altCodeDraft);
                                }
                              }}
                            />
                            <button
                              type="button"
                              className="btn btn-secondary btn-small btn-inline"
                              onClick={() => openBarcodeScanner('altCode')}
                              data-tip={t('seller.scanWithCamera')}
                            >
                              <BarcodeIcon size={15} /> {t('seller.scan')}
                            </button>
                          </div>
                          {(form.altCodes || []).length > 0 && (
                            <div className="chip-row" style={{ marginTop: '0.45rem' }}>
                              {form.altCodes.map((code) => (
                                <span className="code-chip" key={code}>
                                  {code}
                                  <button type="button" onClick={() => removeAltCode(code)} aria-label={t('seller.remove')}>
                                    <XIcon size={11} />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                          <p className="field-hint">{t('seller.extraCodesHint')}</p>
                          {/* Only for a shop that has switched the kaanta on. A shop with no
                              weighing scale must not be told where its item number goes. */}
                          {user?.billingSettings?.scaleBarcode?.enabled && (
                            <p className="field-hint">{t('seller.extraCodesScaleHint')}</p>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {form.kind !== 'service' && (
                    <>
                      <p className="form-subhead">{t('seller.groupStock')}</p>
                      <div className="form-grid">
                        <div className="field">
                          <label htmlFor="lowStockThreshold">{t('seller.lowStockThreshold')}</label>
                          {/* In the stock unit, said on the box: "5" on paneer is 5 kg, on
                              saffron it would be 5 grams, and a bare number hid which. */}
                          {/* The number AND its unit: "500 gram" on paneer stocked by the kilo,
                              "10 piece" on eggs stocked by the tray. Only units that convert to
                              the stock unit are offered, so the alert can never mean the wrong
                              amount. */}
                          <div className="alert-level-row">
                            <input id="lowStockThreshold" type="number" min="0" step="any" inputMode="decimal" value={form.lowStockThreshold} onChange={update('lowStockThreshold')} />
                            {alertUnitChoices(form).length > 1 ? (
                              <Dropdown
                                className="alert-level-unit"
                                value={alertUnitOf(form)}
                                onChange={(u) => setForm((f) => ({ ...f, lowStockUnit: u }))}
                                options={alertUnitChoices(form).map((u) => ({ value: u, label: t(`units.${u}`) }))}
                              />
                            ) : (
                              <span className="alert-level-fixed">{t(`units.${form.unit}`)}</span>
                            )}
                          </div>
                          <p className="field-hint">
                            {form.recipe.some((r) => r.product)
                              ? t('recipe.dishAlertNote')
                              : t('seller.alertNotifyHint', { qty: form.lowStockThreshold || '0', unit: t(`units.${alertUnitOf(form)}`) })}
                          </p>
                        </div>
                        {/* Expiry is asked for only where it means something. A hardware or
                            electronics shop never has an expiring item, and a service never has
                            one either — the field is pure noise on both. Still shown when editing
                            something that already carries a date, so nothing becomes uneditable. */}
                        {(biz.tracksExpiry || form.expiryDate) && (
                          <div className="field">
                            <label htmlFor="expiryDate">{t('seller.expiryDate')}</label>
                            <input id="expiryDate" type="date" value={form.expiryDate} onChange={update('expiryDate')} />
                          </div>
                        )}
                        {(biz.tracksExpiry || form.batchNumber) && (
                          <div className="field">
                            <label htmlFor="batchNumber">{t('seller.batchNumber')}</label>
                            <input id="batchNumber" value={form.batchNumber} onChange={update('batchNumber')} />
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* Every field in this group is trade-specific — a kirana sees none of
                      them. Without this guard the heading would announce a group that turns
                      out to be empty, which is worse than no heading at all. */}
                  {showsSellingGroup && <p className="form-subhead">{t('seller.groupSelling')}</p>}
                  <div className="form-grid">
                    {/* Warranty only means something where a unit can fail and be brought
                        back. A dal packet cannot, and asking about it on one is exactly how
                        a kirana owner decides this app was written for somebody else. */}
                    {(showWarranty || form.warrantyMonths) && (
                      <div className="field">
                        <label htmlFor="warrantyMonths">{t('seller.warrantyMonths')}</label>
                        <input id="warrantyMonths" type="number" min="0" value={form.warrantyMonths} onChange={update('warrantyMonths')} />
                        <p className="field-hint">{t('seller.warrantyMonthsHint')}</p>
                      </div>
                    )}
                    {/* A jeweller's piece has no price of its own — it is worth whatever
                        gold is worth this morning, so the bill is computed from weight ×
                        today's rate + making. Setting this hides the plain Price field's
                        meaning entirely, which is why it says so out loud. */}
                    {form.kind !== 'service' && (showWeightPricing || form.pricingMode === 'weight') && (
                      <>
                        <div className="field">
                          <label htmlFor="pricingMode">{t('seller.pricingMode')}</label>
                          <Dropdown
                            id="pricingMode"
                            value={form.pricingMode}
                            onChange={setField('pricingMode')}
                            options={[
                              { value: 'fixed', label: t('seller.pricingFixed') },
                              { value: 'weight', label: t('seller.pricingWeight') },
                            ]}
                          />
                          <p className="field-hint">{t('seller.pricingModeHint')}</p>
                        </div>
                        {form.pricingMode === 'weight' && (
                          <>
                            <div className="field">
                              <label htmlFor="purity">{t('seller.purity')}</label>
                              <Dropdown
                                id="purity"
                                value={form.purity}
                                onChange={setField('purity')}
                                options={[
                                  { value: '', label: t('seller.purityPick') },
                                  { value: '24K', label: '24K' },
                                  { value: '22K', label: '22K' },
                                  { value: '18K', label: '18K' },
                                  { value: 'silver', label: t('seller.puritySilver') },
                                ]}
                              />
                            </div>
                            <div className="field">
                              <label htmlFor="grossWeight">{t('seller.grossWeight')}</label>
                              <input id="grossWeight" type="number" min="0" step="0.001" value={form.grossWeight} onChange={update('grossWeight')} />
                            </div>
                            <div className="field">
                              <label htmlFor="netWeight">{t('seller.netWeight')}</label>
                              <input id="netWeight" type="number" min="0" step="0.001" value={form.netWeight} onChange={update('netWeight')} />
                              <p className="field-hint">{t('seller.netWeightHint')}</p>
                            </div>
                            <div className="field">
                              <label htmlFor="makingChargeType">{t('seller.makingCharge')}</label>
                              <Dropdown
                                id="makingChargeType"
                                value={form.makingChargeType}
                                onChange={setField('makingChargeType')}
                                options={[
                                  { value: 'percent', label: t('seller.makingPercent') },
                                  { value: 'perGram', label: t('seller.makingPerGram') },
                                  { value: 'fixed', label: t('seller.makingFixed') },
                                ]}
                              />
                            </div>
                            <div className="field">
                              <label htmlFor="makingChargeValue">{t('seller.makingValue')}</label>
                              <input id="makingChargeValue" type="number" min="0" step="0.01" value={form.makingChargeValue} onChange={update('makingChargeValue')} />
                            </div>
                            <div className="field">
                              <label htmlFor="wastagePercent">{t('seller.wastagePercent')}</label>
                              <input id="wastagePercent" type="number" min="0" max="100" step="0.01" value={form.wastagePercent} onChange={update('wastagePercent')} />
                              <p className="field-hint">{t('seller.wastageHint')}</p>
                            </div>
                            <div className="field">
                              <label htmlFor="hallmarkNumber">{t('seller.hallmarkNumber')}</label>
                              <input id="hallmarkNumber" value={form.hallmarkNumber} onChange={update('hallmarkNumber')} />
                            </div>
                          </>
                        )}
                      </>
                    )}
                    {form.kind !== 'service' && (showDrugSchedule || form.drugSchedule) && (
                      <div className="field">
                        <label htmlFor="drugSchedule">{t('seller.drugSchedule')}</label>
                        <Dropdown
                          id="drugSchedule"
                          value={form.drugSchedule}
                          onChange={setField('drugSchedule')}
                          options={[
                            { value: '', label: t('seller.drugScheduleNone') },
                            { value: 'H', label: 'Schedule H' },
                            { value: 'H1', label: 'Schedule H1' },
                            { value: 'X', label: 'Schedule X' },
                          ]}
                        />
                        <p className="field-hint">{t('seller.drugScheduleHint')}</p>
                      </div>
                    )}
                    {form.kind !== 'service' && (showSecondaryUnit || form.secondaryUnit) && (
                      <div className="field">
                        <label htmlFor="secondaryUnit">{t('seller.secondaryUnit')}</label>
                        <Dropdown
                          id="secondaryUnit"
                          value={form.secondaryUnit}
                          onChange={setField('secondaryUnit')}
                          options={[{ value: '', label: t('seller.none') }, ...unitOptions(t, biz.preferredUnits).flatMap((group) => group.units)]}
                        />
                        <p className="field-hint">{t('seller.secondaryUnitHint')}</p>
                      </div>
                    )}
                    {form.kind !== 'service' && form.secondaryUnit && (
                      <div className="field">
                        <label htmlFor="conversionFactor">{t('seller.conversionFactor', { unit: form.unit, secondaryUnit: form.secondaryUnit })}</label>
                        <input id="conversionFactor" type="number" min="0" step="0.001" value={form.conversionFactor} onChange={update('conversionFactor')} />
                      </div>
                    )}
                    {/* Selling loose.
                        Two questions, not three: what the small piece is called, and how
                        many are in a pack. The per-piece price is NOT asked for — the app
                        already knows the pack price and the pack size, so making a
                        shopkeeper divide 55 by 15 for four thousand medicines is work a
                        computer should have done. It is shown, not requested, and stays
                        live: reprice the strip and the tablet price follows on its own.

                        Overriding it is a deliberate second step, because a shop that
                        charges a loose premium is saying something the arithmetic can't
                        know — and until they say it, silence should mean "just divide it".

                        Spans the grid because it is one sentence with blanks in it; split
                        across the auto-fit columns it reads as unrelated fields, which is
                        how a shopkeeper ends up naming a sub-unit and never saying how
                        many are in the pack. */}
                    {form.kind !== 'service' && (showLooseSale || form.subUnit) && (
                      <div className="field field-wide">
                        <label htmlFor="subUnit">{t('pack.title')}</label>
                        <p className="field-hint">{t('pack.hint')}</p>
                        <div className="pack-fields">
                          <Dropdown
                            id="subUnit"
                            value={form.subUnit}
                            onChange={setSubUnit}
                            options={[{ value: '', label: t('seller.none') }, ...looseUnitOptions]}
                          />
                          {form.subUnit && (
                            <label className="pack-size-field" htmlFor="subUnitsPerUnit">
                              <span>{t('pack.packSize', { unit: t(`units.${form.unit}`) })}</span>
                              <input
                                id="subUnitsPerUnit"
                                type="number"
                                min="2"
                                step="1"
                                value={form.subUnitsPerUnit}
                                onChange={update('subUnitsPerUnit')}
                                placeholder={t('pack.packSizePlaceholder')}
                              />
                            </label>
                          )}
                        </div>

                        {/* The sentence the shopkeeper was trying to write, read back with
                            the one number they cannot work out in their head. */}
                        {form.subUnit && !packPreview && <p className="field-hint">{t('pack.incomplete')}</p>}

                        {form.subUnit && packPreview && (
                          <div className="pack-summary">
                            <strong>
                              {t('pack.summary', {
                                unit: t(`units.${form.unit}`),
                                size: packPreview.size,
                                subUnit: t(`units.${form.subUnit}`),
                                price: formatSubUnitPrice(packPreview.price),
                              })}
                            </strong>
                            <button type="button" className="link-btn" onClick={togglePriceOverride}>
                              {priceOverrideOpen ? t('pack.useAutoPrice') : t('pack.setOwnPrice')}
                            </button>
                          </div>
                        )}

                        {form.subUnit && packPreview && priceOverrideOpen && (
                          <div className="pack-override">
                            <label htmlFor="subUnitPrice">{t('pack.loosePrice')}</label>
                            <input
                              id="subUnitPrice"
                              type="number"
                              min="0"
                              step="0.01"
                              value={form.subUnitPrice}
                              onChange={update('subUnitPrice')}
                              autoFocus
                            />
                            <span>{t('pack.perUnitSuffix', { subUnit: t(`units.${form.subUnit}`) })}</span>
                          </div>
                        )}

                        {form.subUnit && packPreview && !priceOverrideOpen && (
                          <p className="field-hint">{t('pack.autoFollows', { unit: t(`units.${form.unit}`) })}</p>
                        )}
                      </div>
                    )}
                  </div>

                  {form.kind !== 'service' && (showPriceTiers || form.priceTiers.length > 0) && (
                    <div className="field" style={{ marginTop: '0.6rem' }}>
                      <label>{t('seller.priceTiers')}</label>
                      <p className="field-hint">{t('seller.priceTiersHint')}</p>
                      {form.priceTiers.map((row, index) => (
                        <div key={index} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
                          <input
                            type="number"
                            min="0"
                            placeholder={t('seller.priceTierMinQty')}
                            value={row.minQty}
                            onChange={(e) => updatePriceTier(index, 'minQty', e.target.value)}
                            style={{ flex: 1 }}
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder={t('seller.price')}
                            value={row.price}
                            onChange={(e) => updatePriceTier(index, 'price', e.target.value)}
                            style={{ flex: 1 }}
                          />
                          <button type="button" className="icon-btn danger" onClick={() => removePriceTier(index)}>
                            <XIcon size={17} />
                          </button>
                        </div>
                      ))}
                      <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={addPriceTier}>
                        <PlusIcon size={15} /> {t('seller.addPriceTier')}
                      </button>
                    </div>
                  )}

                  {(form.recipe.length > 0 || (form.kind === 'service' ? showServiceMaterials : showRecipe)) && (
                    <RecipeEditor
                      isService={form.kind === 'service'}
                      extraCost={form.recipeExtraCost}
                      onExtraCostChange={(v) => setForm((f) => ({ ...f, recipeExtraCost: v }))}
                      recipeYield={form.recipeYield}
                      onYieldChange={(v) => setForm((f) => ({ ...f, recipeYield: v }))}
                      onCreateIngredient={createIngredient}
                      lines={form.recipe}
                      onChange={setRecipe}
                      products={products}
                      editingId={editingId}
                      dishUnit={form.unit}
                      onRecalcCost={editingId ? recalcCost : undefined}
                      t={t}
                      lang={lang}
                    />
                  )}

                  {(showChannelPricing || form.parcelPrice !== '' || form.deliveryPrice !== '') && (
                  <div className="field" style={{ marginTop: '0.6rem' }}>
                    <label>{t('seller.channelPricing')}</label>
                    <p className="field-hint">{t('seller.channelPricingHint')}</p>
                    <div className="form-grid">
                      <div className="field">
                        <label htmlFor="parcelPrice">{t('tables.type.parcel')} (₹)</label>
                        <input
                          id="parcelPrice"
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.parcelPrice}
                          onChange={update('parcelPrice')}
                          placeholder={form.price || '—'}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="deliveryPrice">{t('tables.type.delivery')} (₹)</label>
                        <input
                          id="deliveryPrice"
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.deliveryPrice}
                          onChange={update('deliveryPrice')}
                          placeholder={form.price || '—'}
                        />
                      </div>
                    </div>
                  </div>
                  )}

                  {(showModifiers || form.modifierGroups.length > 0) && form.kind !== 'service' && (
                  <div className="field" style={{ marginTop: '0.6rem' }}>
                    <label>{t('seller.modifierGroups')}</label>
                    <p className="field-hint">{t('seller.modifierGroupsHint')}</p>
                    {form.modifierGroups.map((group, gi) => (
                      <div key={gi} style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '0.6rem', marginBottom: '0.6rem' }}>
                        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
                          <input
                            placeholder={t('seller.modifierGroupName')}
                            value={group.name}
                            onChange={(e) => updateModifierGroup(gi, 'name', e.target.value)}
                            style={{ flex: 1 }}
                          />
                          <button type="button" className="icon-btn danger" onClick={() => removeModifierGroup(gi)}>
                            <XIcon size={17} />
                          </button>
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 400 }}>
                            <input type="checkbox" checked={group.required} onChange={(e) => updateModifierGroup(gi, 'required', e.target.checked)} />
                            {t('seller.modifierRequired')}
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 400 }}>
                            <input type="checkbox" checked={group.multiple} onChange={(e) => updateModifierGroup(gi, 'multiple', e.target.checked)} />
                            {t('seller.modifierMultiple')}
                          </label>
                        </div>
                        {group.options.map((option, oi) => (
                          <div key={oi} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.35rem' }}>
                            <input
                              placeholder={t('seller.modifierOptionName')}
                              value={option.name}
                              onChange={(e) => updateModifierOption(gi, oi, 'name', e.target.value)}
                              style={{ flex: 2 }}
                            />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder={t('seller.modifierPriceDelta')}
                              value={option.priceDelta}
                              onChange={(e) => updateModifierOption(gi, oi, 'priceDelta', e.target.value)}
                              style={{ flex: 1 }}
                            />
                            <button type="button" className="icon-btn danger" onClick={() => removeModifierOption(gi, oi)}>
                              <XIcon size={17} />
                            </button>
                          </div>
                        ))}
                        <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => addModifierOption(gi)}>
                          <PlusIcon size={15} /> {t('seller.addModifierOption')}
                        </button>
                      </div>
                    ))}
                    <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={addModifierGroup}>
                      <PlusIcon size={15} /> {t('seller.addModifierGroup')}
                    </button>
                  </div>
                  )}

                  {/* Sits with the catalog tick because that is what it is for: this is the
                      only sentence a customer gets about the item on the online shop, and
                      until now there was nowhere in the app to write it. Also where a
                      scanned barcode's net quantity and ingredients land. */}
                  <p className="form-subhead">{t('seller.groupCatalog')}</p>
                  <div className="form-grid">
                    <div className="field field-span2">
                      <label htmlFor="description">{t('seller.productDescription')}</label>
                      <textarea
                        id="description"
                        rows={2}
                        value={form.description}
                        onChange={update('description')}
                        maxLength={500}
                      />
                      <p className="field-hint">{t('seller.productDescriptionHint')}</p>
                    </div>
                  </div>

                  <label className="checkbox-row" style={{ marginTop: '0.5rem' }}>
                    <input type="checkbox" checked={form.showInCatalog} onChange={(e) => setForm((f) => ({ ...f, showInCatalog: e.target.checked }))} />
                    <span>{t('seller.showInCatalog')}</span>
                  </label>
                  {/* Said here, next to the tick, because the server keeps these two off the
                      storefront whatever the tick says (backend/utils/catalog.js). A shopkeeper
                      who ticks the box and then cannot find the item online would reasonably
                      conclude the app is broken — the honest answer is that a prescription-only
                      medicine and expired stock cannot be sold online at all. */}
                  {form.showInCatalog && (form.drugSchedule === 'H1' || form.drugSchedule === 'X') && (
                    <p className="field-hint">{t('seller.catalogPrescriptionBlocked')}</p>
                  )}
                </div>
              )}

        </Modal>
      )}

      {adjustProduct && (
        <AdjustStockPanel
          product={adjustProduct}
          t={t}
          onCancel={() => setAdjustProduct(null)}
          onSaved={() => {
            setAdjustProduct(null);
            load();
            loadAdjustments();
          }}
        />
      )}

      {scannerOpen && (
        <Modal onClose={closeBarcodeScanner} title={t('seller.scanWithCamera')} maxWidth={380} closeOnBackdrop={false}>
          <div id="product-barcode-scanner-viewport" style={{ width: '100%' }} />
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', marginTop: '0.5rem' }}>{t('seller.scanHint')}</p>
        </Modal>
      )}
    </>
  );
}

// A stat card that doubles as a filter shortcut when given an onClick — the number the
// seller just read is the fastest way to ask "show me those".
function StatCard({ icon, tone, value, label, active, onClick }) {
  const interactive = typeof onClick === 'function';
  return (
    <div
      className={`stat-card${active ? ' stat-card-active' : ''}`}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      style={interactive ? { cursor: 'pointer' } : undefined}
      onClick={onClick}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="stat-card-top">
        <div className={`stat-card-icon ${tone}`}>{icon}</div>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function SelectControl({ value, onChange, options, filtered }) {
  return (
    <Dropdown className={`select-control${filtered ? ' filtered' : ''}`} value={value} onChange={onChange} options={options} />
  );
}

// Stock adjustments are an audit trail, not a daily task — collapsed by default so they
// stop competing with the inventory list for the top of the page.
function AdjustmentHistory({ adjustments, open, onToggle, t }) {
  const historyPage = usePagination(adjustments, { pageSize: 10 });

  return (
    <div className={`disclosure${open ? ' open' : ''}`}>
      <button type="button" className="disclosure-trigger" onClick={onToggle} aria-expanded={open}>
        <span>
          {t('seller.adjustmentHistory')}{' '}
          <span className="disclosure-sub">· {adjustments.length} {t('seller.adjustments')}</span>
        </span>
        <span className="disclosure-caret"><ChevronDownIcon size={16} /></span>
      </button>
      {open && (
        <div className="disclosure-body">
          {adjustments.length === 0 ? (
            <p className="empty-state">{t('seller.noAdjustments')}</p>
          ) : (
            <>
              <div className="table-wrap auto-height">
                <table className="data-table" style={{ minWidth: '520px' }}>
                  <thead>
                    <tr>
                      <th>{t('seller.productName')}</th>
                      <th>{t('common.status')}</th>
                      <th className="num">{t('seller.quantity')}</th>
                      <th>{t('seller.note')}</th>
                      <th>{t('common.date')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyPage.pageItems.map((a) => (
                      <tr key={a._id}>
                        <td className="cell-strong">{a.product?.name || '—'}</td>
                        <td><span className="badge">{t(`seller.adjustReason.${a.type}`)}</span></td>
                        <td className={`num ${a.delta > 0 ? 'cell-strong' : 'cell-muted'}`}>
                          {a.delta > 0 ? '+' : ''}{a.delta}
                        </td>
                        <td className="cell-muted">{a.note || '—'}</td>
                        <td className="cell-muted">{new Date(a.createdAt).toLocaleDateString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                compact
                page={historyPage.page}
                pageCount={historyPage.pageCount}
                pageSize={historyPage.pageSize}
                total={historyPage.total}
                from={historyPage.from}
                to={historyPage.to}
                onPageChange={historyPage.setPage}
                label={t('seller.adjustments')}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AdjustStockPanel({ product, t, onCancel, onSaved }) {
  const [type, setType] = useState('damage');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError('');
    const qty = Number(quantity);
    if (!qty) {
      setError(t('seller.adjustQtyRequired'));
      return;
    }
    const delta = type === 'correction' ? qty : -Math.abs(qty);

    setSaving(true);
    try {
      await apiFetch('/api/seller/stock-adjustments', {
        method: 'POST',
        body: JSON.stringify({ productId: product._id, type, delta, note }),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onCancel}
      title={`${t('seller.adjustStock')} — ${product.name}`}
      maxWidth={480}
      footer={
        <>
          <button type="button" className="btn btn-primary btn-inline" onClick={handleSave} disabled={saving}>
            {t('common.save')}
          </button>
          <button type="button" className="btn btn-secondary btn-inline" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
        {error && <div className="error-banner">{error}</div>}
        <div className="form-grid">
          <div className="field">
            <label>{t('common.status')}</label>
            {/* Was rendering the raw enum — a Marathi shopkeeper picked between "damage",
                "theft", "self_use" and "correction". */}
            <Dropdown
              value={type}
              onChange={setType}
              options={ADJUSTMENT_TYPES.map((typeOption) => ({ value: typeOption, label: t(`seller.adjustReason.${typeOption}`) }))}
            />
          </div>
          <div className="field">
            <label>{type === 'correction' ? t('seller.correctionHint') : t('seller.quantityToRemove')}</label>
            <input type="number" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="field">
            <label>{t('seller.note')}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
    </Modal>
  );
}

/**
 * One product's entire stock history, in one timeline.
 *
 * This is the screen a shopkeeper opens when the count is wrong, and until now the app
 * could not answer the question at all. Every movement existed — a bill took stock off, a
 * purchase put it back, a transfer moved it, an adjustment wrote it off — but each lived
 * behind its own page, so "10 packet the, ab 3 kyun hain" meant opening four screens and
 * doing the arithmetic by hand.
 *
 * Two things make this worth more than the equivalent in Marg or Vyapar: every row says
 * *why* in the shopkeeper's own words ("Bill #142 — Ramesh"), not just a document type;
 * and the running balance is computed backwards from the current shelf count, so the top
 * row always reconciles with what the inventory list shows right now.
 */
function StockLedgerModal({ product, onClose, t }) {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch(`/api/seller/products/${product._id}/ledger?days=${days}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [product._id, days]);

  const unit = data?.product?.unit || product.unit;

  return (
    <Modal onClose={onClose} title={t('seller.stockLedger')} hint={product.name} maxWidth={760}>

        <div className="segmented" role="group" style={{ marginBottom: '0.9rem' }}>
          {[30, 90, 365].map((option) => (
            <button key={option} type="button" className={days === option ? 'active' : ''} onClick={() => setDays(option)}>
              {t('seller.ledgerDays', { days: option })}
            </button>
          ))}
        </div>

        {error && <div className="error-banner">{error}</div>}

        {loading ? (
          <SkeletonTable rows={6} />
        ) : data ? (
          <>
            <div className="ledger-summary">
              <div>
                <span>{t('seller.ledgerOpening')}</span>
                <strong>{data.openingStock} {unit}</strong>
              </div>
              <div>
                <span>{t('seller.ledgerIn')}</span>
                <strong style={{ color: 'var(--text-success)' }}>+{data.totals.in}</strong>
              </div>
              <div>
                <span>{t('seller.ledgerOut')}</span>
                <strong style={{ color: 'var(--text-danger)' }}>−{data.totals.out}</strong>
              </div>
              <div>
                <span>{t('seller.ledgerNow')}</span>
                <strong>{data.currentStock} {unit}</strong>
              </div>
            </div>

            {data.rows.length === 0 ? (
              <p className="empty-state">{t('seller.ledgerEmpty')}</p>
            ) : (
              <div className="table-wrap" style={{ flex: 1, overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('seller.ledgerWhen')}</th>
                      <th>{t('seller.ledgerWhat')}</th>
                      <th className="num">{t('seller.ledgerChange')}</th>
                      <th className="num">{t('seller.ledgerBalance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, index) => (
                      <tr key={`${row.referenceId}-${index}`}>
                        <td className="cell-muted" style={{ whiteSpace: 'nowrap' }}>
                          {new Date(row.at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                          <span className="ledger-note">
                            {new Date(row.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </td>
                        <td>
                          <span className="cell-strong">{row.reference}</span>
                          <span className="ledger-note">{row.note}</span>
                        </td>
                        <td className="num">
                          <span className={`ledger-delta ${row.delta > 0 ? 'in' : row.delta < 0 ? 'out' : 'nil'}`}>
                            {row.delta > 0 ? '+' : row.delta < 0 ? '−' : ''}
                            {Math.abs(row.delta) || row.quantity}
                          </span>
                        </td>
                        <td className="num cell-strong">{row.balanceAfter}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
    </Modal>
  );
}
