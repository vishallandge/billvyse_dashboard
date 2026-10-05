'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { quoteDateForDays, MAX_QUOTE_VALID_DAYS, validateQuoteForm } from '../../../lib/quoteValidity';
import { useRouter } from 'next/navigation';
import { apiFetch, downloadFile } from '../../../lib/api';
import { isExpiredProduct } from '../../../lib/productExpiry';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { printSlip, qrSlotsReady } from '../../../lib/printer/slip';
import { getRolePrinter, getSettings as getPrinterSettings } from '../../../lib/printer';
import PrinterStatusChip from '../../components/PrinterStatusChip';
import { getShopSocket } from '../../../lib/socket';
import { useDashboardUser, useHiddenNav } from '../../components/DashboardShell';
import UpiQr from '../../components/UpiQr';
import RowMenu from '../../components/RowMenu';
import ThermalReceipt from '../../components/ThermalReceipt';
import KotTicket from '../../components/KotTicket';
import ModifierPicker from '../../components/ModifierPicker';
import { enqueueBill, getQueue, removeFromQueue, updateQueueEntry, queueCount, newClientBillId } from '../../../lib/offlineQueue';
import { startBarcodeScanner } from '../../../lib/barcodeScanner';
import { parseScan, scanExtras } from '../../../lib/scanCode';
import { counterFeedback, isCounterSoundOn, setCounterSoundOn } from '../../../lib/counterFeedback';
import { saveBillDraft, readBillDraft, clearBillDraft } from '../../../lib/billDraft';
import WhatsappSheet from '../../components/WhatsappSheet';
import { TrashIcon, XIcon, ReceiptIcon, ClockIcon, RupeeIcon, CreditCardIcon, WalletIcon, LedgerIcon, BarcodeIcon, SwapIcon, PlusIcon, CheckCircleIcon, StarIcon, SearchIcon, UsersIcon, AlertIcon, ZapIcon, ClipboardIcon, TagIcon, CopyIcon, InfoIcon, EditIcon, CounterIcon, UndoIcon, FilterIcon, DownloadIcon, ChevronDownIcon, ChevronUpIcon, CheckIcon, SpinnerIcon, ChevronRightIcon, PrinterIcon, WhatsappIcon, SparkleIcon } from '../../components/Icons';
import {
  gstRateOptions,
  SERVICE_UNITS,
  UNITS,
  SUB_UNIT_SUGGESTIONS,
  defaultPackSize,
  packSizeOf,
  subUnitPriceOf,
  splitPackStock,
  lineTotalOf,
  formatSubUnitPrice,
} from '../../../lib/catalog';
import { businessType, tradeUses, DEFAULT_BUSINESS_TYPE } from '../../../lib/businessTypes';
import AnimatedNumber from '../../components/AnimatedNumber';
import VoiceSearchButton from '../../components/VoiceSearchButton';
import { Pagination } from '../../components/Pagination';
import { SkeletonTable } from '../../components/Skeleton';
import Dropdown from '../../components/Dropdown';
import PhoneField from '../../components/PhoneField';
import Modal from '../../components/Modal';
import DateRangeFilter from '../../components/DateRangeFilter';
import { recordHref } from '../../../lib/routeId';
import { formatQty } from '../../../lib/format';
import { customerOptionLabel, nameIsPhone } from '../../../lib/customerLabel';

const COUNTER_KEY = 'dukaan_counter_name';
// The counter's own shortlist of what it sells all day. Kept on the device rather than the
// server because it is a habit, not shop data: the sweet counter and the medicine counter
// of the same shop reach for different things, and neither should have to wait on a
// network round-trip for a strip that has to be on screen the moment the page opens.
//
// It is a single scrolling line of chips, never a grid. This started life as a grid of the
// same tiles the search results use and it was wrong: those tiles carry stock and price
// because you are *deciding* there, and at that size four items ate half the fold of the
// busiest screen in the app, pushed the cart down, and left a ragged half-empty last row.
// Here you already know the product — the strip only has to be tappable, so it costs one
// line of height and scrolls sideways instead of growing downwards.
const QUICK_PICK_KEY = 'dukaan_billing_quick_picks';
const QUICK_PICK_LIMIT = 12;
/**
 * How many tiles the shelf draws before it stops and says so.
 *
 * A shop with 600 products would otherwise put 600 tiles in the DOM of the screen that has
 * to stay responsive under a barcode gun. Sixty fills roughly two screens of grid at any
 * width we support, and the honest overflow line sends the rest to the search box — which
 * is faster than scrolling to them anyway.
 */
const BROWSE_LIMIT = 60;

/**
 * How a quotation arrives at the counter to be billed or revised.
 *
 * sessionStorage, not a query string: the lines, the party and the discounts are the whole
 * document, and a URL long enough to carry them is a URL that gets truncated by something.
 * Session-scoped on purpose — a quote handed over three days ago must not resurrect itself
 * into an open cart because a tab was restored.
 */
const ESTIMATE_CART_KEY = 'dukaan_estimate_to_cart';

// Money is compared and displayed to the paisa all over this page; doing it inline meant
// floating-point noise occasionally showed a ₹0.01 "remaining" on a split that was exactly
// settled. Same rounding the server's utils/billTotals.js uses.
const round2 = (value) => Number((Number(value) || 0).toFixed(2));

/**
 * Everything the bill register is currently asking the server for, in one object.
 *
 * One object rather than eight useStates because every one of these has to be turned into
 * the same query string, and because a filter change must always land back on page 1 —
 * that is one rule in `setBillFilter` instead of eight places to forget it.
 */
const DEFAULT_BILL_QUERY = {
  preset: 'today',
  from: '',
  to: '',
  q: '',
  paymentMode: '',
  // Cancelled bills are LISTED by default — struck through in red with who cancelled them —
  // so a deleted bill is never invisible. They are never inside the money totals (the
  // server keeps them out of Sales, the mode split and the counter/cashier sums).
  status: 'all',
  counter: '',
  cashier: '',
  unpaid: false,
  page: 1,
  limit: 25,
};

// Not the full ten-preset row the reports pages use. This panel sits under a live billing
// screen, and a counter reaching into it wants today, yesterday, the week or the month —
// "this quarter" and "this FY" belong on a report, and here they would only push the
// date row onto a second line on the busiest screen in the app. Custom still covers them.
const BILL_RANGE_PRESETS = ['today', 'yesterday', 'last7', 'month', 'all'];

// Which filters count as "narrowed" for the badge on the filter button. The date range is
// deliberately not one of them: it is always set to something and is already on screen.
const BILL_FILTER_KEYS = ['q', 'paymentMode', 'status', 'counter', 'cashier', 'unpaid'];

// The register's summary figures are read at a glance and checked against a cash drawer,
// not reconciled to the paisa — trailing ".00" on six cells is noise. Indian grouping,
// because "₹1,84,320" is the only way this number is ever said out loud.
function rupees(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/**
 * A rupee amount the way it is read out loud, with paise.
 *
 * The counter had two spellings of the same number sitting one above the other — the total
 * bar said "₹12,500.00" and the button under it said "₹12500.00". A cashier checking the
 * amount before committing has to read both, and two formats for one figure is exactly the
 * kind of small wrongness that makes software feel untrustworthy at a till.
 */
function money(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// What a khata bill still has riding on it, once returns and part-payments are taken off.
function billDue(bill) {
  const gross = bill.payableTotal ?? bill.total;
  const returned = (bill.returns || []).reduce((sum, entry) => sum + (entry.amount || 0), 0);
  return round2(gross - returned - (bill.amountPaid || 0));
}

function readQuickPicks() {
  try {
    const raw = JSON.parse(localStorage.getItem(QUICK_PICK_KEY) || '{}');
    return {
      tally: raw.tally && typeof raw.tally === 'object' ? raw.tally : {},
      pins: Array.isArray(raw.pins) ? raw.pins : [],
      hidden: Boolean(raw.hidden),
    };
  } catch {
    return { tally: {}, pins: [], hidden: false };
  }
}

function writeQuickPicks(next) {
  try {
    localStorage.setItem(QUICK_PICK_KEY, JSON.stringify(next));
  } catch {
    // A full or blocked localStorage is not worth failing a sale over.
  }
}

/**
 * A saved quotation, turned back into cart lines.
 *
 * Rebuilt from the live catalog rather than trusted from the document, because a quotation is
 * a *rate that was promised*, not a bill: the counter has to be able to see today's pack
 * size, sub-unit and stock on the line it is about to sell. Only the quantity, the unit it
 * was quoted in and the line discount come off the estimate — the price is then re-read by
 * the server at billing time exactly as it is for any other cart.
 *
 * A line whose product has since been deleted from the catalog is kept as a charge line at
 * the quoted rate rather than dropped. The shop promised that money; silently losing the
 * line would understate the bill the customer is standing there expecting.
 */
function cartLinesFromEstimate(items, products) {
  return (items || []).map((item, index) => {
    const product = item.product ? products.find((p) => p._id === String(item.product)) : null;
    if (!product) {
      return {
        lineId: `est-${index}`,
        isService: true,
        name: item.name,
        unit: item.unit || 'service',
        price: Number(item.price) || 0,
        quantity: Number(item.quantity) || 1,
        gstRate: Number(item.gstRate) || 0,
        discountPercent: Number(item.discountPercent) || '',
      };
    }
    const packSize = packSizeOf(product);
    const loose = Boolean(packSize) && item.unit === product.subUnit;
    const unit = loose ? product.subUnit : product.unit;
    return {
      lineId: `${product._id}:${unit}:`,
      productId: product._id,
      isService: product.kind === 'service',
      name: product.name,
      unit,
      price: loose ? subUnitPriceOf(product) : product.price,
      gstRate: product.gstRate || 0,
      quantity: Number(item.quantity) || 1,
      packSize,
      packUnit: product.unit,
      subUnit: packSize ? product.subUnit : undefined,
      packPrice: product.price,
      loosePrice: packSize ? subUnitPriceOf(product) : undefined,
      saleUnit: unit,
      warrantyMonths: product.warrantyMonths || undefined,
      drugSchedule: product.drugSchedule || undefined,
      serialNumber: '',
      discountPercent: Number(item.discountPercent) || '',
    };
  });
}

/**
 * The notes a customer would realistically hand over for a bill of this size.
 *
 * Not a fixed ₹100/500/2000 row: for a ₹1,247 bill those are all useless. Rounding the
 * bill up to the next 10/50/100/500 is what actually happens at a counter ("1,250 de do"),
 * and the plain notes are only offered while they are still bigger than the bill.
 */
function tenderSuggestions(amount) {
  if (!(amount > 0)) return [];
  const values = new Set();
  for (const step of [10, 50, 100, 500]) {
    const up = Math.ceil(amount / step) * step;
    if (up > amount) values.add(up);
  }
  for (const note of [100, 200, 500, 2000]) {
    if (note > amount) values.add(note);
  }
  return [...values].sort((a, b) => a - b).slice(0, 4);
}

/**
 * The same idea turned upside down, for a khata advance.
 *
 * Cash tender is money handed over, so the useful numbers sit *above* the bill — you pay
 * 500 for a 347 bill. A khata advance is the opposite: it is what the customer can manage
 * today, so the numbers that matter are the round ones *below* it. On a ₹340 bill a
 * counter hears "do sau de deta hoon, baaki kal" — never "₹500". Anything at or above the
 * total is Exact's job, so nothing here can accidentally settle the bill.
 */
function partPaySuggestions(amount) {
  if (!(amount > 1)) return [];
  const values = new Set();
  for (const note of [50, 100, 200, 500, 1000, 2000]) {
    if (note < amount) values.add(note);
  }
  // Round-down landmarks, so a ₹1,250 bill offers ₹1,200 and not just the note values.
  for (const step of [100, 500, 1000]) {
    const down = Math.floor(amount / step) * step;
    if (down > 0 && down < amount) values.add(down);
  }
  // Keep the four *closest* to the bill — on a ₹2,400 bill, ₹50 is not a part payment
  // anyone offers — then show them small-to-large, the order a row of notes reads in.
  // Three, not the cash side's four: this row shares its line with "kuch nahi" and
  // "aadha", and a wrapped second row of pills at a counter is a row nobody reads.
  return [...values]
    .sort((a, b) => b - a)
    .slice(0, 3)
    .sort((a, b) => a - b);
}

/**
 * "3*parle" / "parle*3" / "3x parle" — a quantity said in the same breath as the name.
 *
 * A counter does not add one biscuit packet six times; it says "chhe parle". Every fast
 * POS in the world lets the quantity ride along with the search term, and without it the
 * only way to sell six of something here was to add it and then work the − / + buttons or
 * retype the number in the cart, which is three interactions for what is one thought.
 *
 * Only a leading or trailing whole number attached with * or x counts, so a genuine
 * product name that happens to contain a digit ("7 Up", "Lux 100g") is never mangled.
 */
function parseQuantityQuery(raw) {
  const value = String(raw || '');
  // "x" only counts as a multiplier when a space keeps it away from the name. Without that
  // rule a hardware shop typing "2x4 wood" would bill two of a "4 wood", and typing
  // "Lux 100" would search for "Lu" a hundred times over — both real products, both
  // ordinary things to type. "*" needs no such guard: nothing is named with one.
  const lead = value.match(/^\s*(\d{1,4})\s*(?:\*\s*|[x×]\s+)(.+)$/i);
  if (lead) return { quantity: Number(lead[1]), term: lead[2].trim() };
  const trail = value.match(/^(.+?)(?:\s*\*\s*|\s+[x×]\s*)(\d{1,4})\s*$/i);
  if (trail) return { quantity: Number(trail[2]), term: trail[1].trim() };
  return { quantity: null, term: value.trim() };
}

/**
 * A problem, and the way out of it.
 *
 * The counter's own words for what was wrong with this screen: "error kahin dikh rahi
 * aur input field kahin par" — the sentence appeared in one corner and the box that
 * answers it was somewhere else, sometimes on another page. So the sentence is a control
 * now: it carries the name of the fix and pressing it goes there.
 *
 * One element, never a fragment: this is dropped into the page banner slot, into the
 * checkout ticket's foot and into the review modal, and each of those owns its own
 * spacing around it.
 */
function ProblemNote({ text, fix, onFix, className = '' }) {
  return (
    <div className={`problem-note${fix ? ' problem-note--fixable' : ''}${className ? ` ${className}` : ''}`} role="alert">
      <AlertIcon size={15} />
      <span className="problem-note__text">{text}</span>
      {fix && (
        <button type="button" className="problem-note__fix" onClick={onFix}>
          <span>{fix.label}</span>
          <ChevronRightIcon size={13} />
        </button>
      )}
    </div>
  );
}

export default function SellerBillingPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const user = useDashboardUser();
  /**
   * Quotations are a trade's screen, and the button that makes one is the same screen one
   * level down — so it follows the same answer rather than a second rule of its own. A kirana
   * that is not shown the Quotations register has no business being offered a "Quotation"
   * button beside Hold: it would build a document it could then never find again.
   *
   * Read off the shell's `hiddenNav` (server ∪ trade), not off the business type here, so an
   * owner who switched the screen on gets his button back with it.
   */
  const quotesHidden = useHiddenNav().includes('estimates');
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  // One box for both scanning and typing a name — see handleQuerySubmit. Splitting these
  // into two separate fields/forms (as this page used to) forced the cashier to decide
  // which one to use for every item; a hardware scanner and manual typing both just land
  // in this same input, and Enter tries a barcode lookup while every keystroke also
  // live-filters by name underneath.
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState([]);
  // A product with modifierGroups is added via a picker, not a bare tap — see
  // handleProductAdd below, which is what ProductTile's onAdd is actually wired to.
  const [modifierPickFor, setModifierPickFor] = useState(null); // { product, saleUnit, quantity }
  const [paymentMode, setPaymentMode] = useState('cash');
  const [customerId, setCustomerId] = useState('');
  const [staffList, setStaffList] = useState([]);
  const [staffPaysCommission, setStaffPaysCommission] = useState(false);
  const [billStaffId, setBillStaffId] = useState('');
  const [paidNow, setPaidNow] = useState('');
  const [paidNowMode, setPaidNowMode] = useState('cash');
  // "Exact" is a standing instruction, not a one-time paste — see the sync effect below.
  // Two separate latches because the cash drawer and a khata advance are two different
  // sentences ("poore paise liye" / "poora aaj hi de diya") and a shopkeeper can be mid-way
  // through one when they switch to the other.
  const [paidNowExact, setPaidNowExact] = useState(false);
  // Split tender: how much came in through each mode. Only the modes with an amount
  // typed in are sent, so "aadha cash aadha UPI" is two keystrokes, not a form.
  const [split, setSplit] = useState({ cash: '', upi: '', card: '', bank: '' });
  // The shop's scan-to-pay code, blown up big enough to turn the screen around with.
  const [upiQrOpen, setUpiQrOpen] = useState(false);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceForm, setServiceForm] = useState({ name: '', price: '', quantity: '1', unit: 'service', gstRate: 0 });
  // What this trade sells decides how prominent a charge line is and what GST it
  // defaults to — a repair counter's charge is 18%, a kirana's delivery fee is usually 0.
  const biz = businessType(user?.businessType || DEFAULT_BUSINESS_TYPE);
  // A cafe or dhaba that bills at the counter first still has a kitchen that needs the
  // order on paper. Same trades that run tables — a kirana has no kitchen to send to.
  const [kotSlip, setKotSlip] = useState(null);
  // Setting a pack size from the billing screen writes to the product, so it is offered
  // only to someone allowed to edit products. A staff cashier with billing-only rights
  // sees no such link rather than a button that 403s when they tap it.
  const canEditProducts =
    user?.role !== 'staff' || (Array.isArray(user?.permissions) && user.permissions.includes('inventory'));
  // Salon/gym/tuition-style trades see the "work done by" picker by default; anyone else
  // sees it only once they actually have a staff member on commission.
  const showStaffPicker = tradeUses(user?.businessType || DEFAULT_BUSINESS_TYPE, 'commission', staffPaysCommission);

  function blankCharge() {
    return { name: '', price: '', quantity: '1', unit: 'service', gstRate: biz.defaultGstRate };
  }
  const [counter, setCounter] = useState('Counter 1');
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [redeemPoints, setRedeemPoints] = useState('');
  const [loyaltyPreview, setLoyaltyPreview] = useState(null);
  const [loyaltyError, setLoyaltyError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  /**
   * What the shop's shelf schemes ("1 pe 1 free") do to this cart.
   *
   * Asked of the server on every cart change rather than worked out here, and that is the
   * whole point: the same engine that answers this is the one createBill runs a moment
   * later, on prices resolved the same way. A counter shown "1 free, ₹80 payable" that
   * then bills ₹90 is worse than showing nothing, and an offer computed in the browser is
   * an offer a browser can invent.
   */
  const [offerPreview, setOfferPreview] = useState(null);
  const [liveNotice, setLiveNotice] = useState('');
  const [bills, setBills] = useState([]);
  const [billsLoading, setBillsLoading] = useState(true);
  const [dailyBillCount, setDailyBillCount] = useState(0);
  // "Wo kal wala bill nikalo." The recent-bills panel only ever showed today, so a bill
  // from yesterday — the single most common thing a customer walks back in and asks for —
  // was unreachable from the screen the shopkeeper is already standing on. It is now the
  // shop's whole register: any period, any counter, any mode, searchable by customer.
  const [billQuery, setBillQuery] = useState(DEFAULT_BILL_QUERY);

  /**
   * Arriving at `/seller/billing#bills` (the Tables floor's "Recent bills" shortcut) means
   * "show me the register", not "show me an empty counter". Scrolled once the first page of
   * bills has landed rather than on mount: until then the table is a skeleton, and the
   * product shelf above it is still settling, so an early scroll lands short.
   */
  const billsHashDone = useRef(false);
  useEffect(() => {
    if (billsHashDone.current || billsLoading) return;
    billsHashDone.current = true;
    if (window.location.hash !== '#bills') return;
    requestAnimationFrame(() => {
      document.getElementById('bills')?.scrollIntoView({ block: 'start' });
    });
  }, [billsLoading]);
  // The find box is uncontrolled by the query on purpose — typing three letters of a name
  // must not fire a request per keystroke against a collection this size. Applied on Enter.
  const [billSearchDraft, setBillSearchDraft] = useState('');
  // The numbers under the table, computed by the server over the WHOLE filtered set rather
  // than the page on screen (see listBills). This is the day-end tally.
  const [billSummary, setBillSummary] = useState(null);
  const [billTotal, setBillTotal] = useState(0);
  const [billFiltersOpen, setBillFiltersOpen] = useState(false);
  // Which bill's line items are unfolded in place, so "unhone kya kya liya tha" is answered
  // without leaving the billing screen for the invoice page and losing the cart.
  const [openBillId, setOpenBillId] = useState(null);
  // Bumped by anything that changes bills behind the register's back — a new sale, a
  // return, a cancellation, another counter's socket event. See refreshBills().
  const [billRefresh, setBillRefresh] = useState(0);
  const [billExporting, setBillExporting] = useState(false);
  // Cash handed over at the counter, and therefore the change owed back. This is the
  // arithmetic every cash sale ends in and the one thing the billing screen never did:
  // the shopkeeper was doing "500 minus 347" in their head while the queue waited.
  const [cashReceived, setCashReceived] = useState('');
  const [cashExact, setCashExact] = useState(false);
  // Kept after the cart is cleared, because the change is owed *after* the bill exists —
  // clearing the cart used to wipe the only place the number was ever shown.
  const [lastTender, setLastTender] = useState(null);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  /**
   * The khata customer already on this bill, opened for correction.
   *
   * "Number galat chala gaya" is found at the counter, on the bill it is about to go out
   * on — not later, on the Khata screen, after the receipt has already been sent to the
   * wrong phone. Holds the customer being edited, null when nothing is being edited.
   */
  const [editCustomer, setEditCustomer] = useState(null);
  // Who prescribed what is on this bill. Required by the server before a Schedule H1/X
  // medicine can go out — see the prescription block in createBill.
  const [prescription, setPrescription] = useState({ doctorName: '', patientName: '', number: '' });
  // Teaching the app a pack size mid-bill — see savePackSetup for why this lives here.
  const [packSetup, setPackSetup] = useState(null);
  // Per-device shortlist for the search panel's dead empty state — see QUICK_PICK_KEY.
  const [quickPicks, setQuickPicks] = useState({ tally: {}, pins: [], hidden: false });
  // Which aisle of the shelf is showing. '' is everything — see the browse panel below.
  const [browseCategory, setBrowseCategory] = useState('');
  // ── Quotations ────────────────────────────────────────────────────────────────────────
  // The same cart, saved as an estimate instead of billed. `estimateLink` is set when the
  // cart was loaded FROM a quotation — 'convert' means bill it and stamp the quote as
  // billed, 'edit' means revise that same document rather than issue a second one.
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteFieldErrors, setQuoteFieldErrors] = useState({});
  const [quoteForm, setQuoteForm] = useState({ contactName: '', contactPhone: '', validityMode: 'days', validDays: '7', validUntil: '', notes: '' });
  const [quoteSaving, setQuoteSaving] = useState(false);
  const [quoteSaved, setQuoteSaved] = useState(null);
  const [estimateLink, setEstimateLink] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [receiptText, setReceiptText] = useState('');
  const [receiptUpiLink, setReceiptUpiLink] = useState(null);
  // The customer's own no-login link to the bill on screen — printed as a QR on the slip
  // and copied from the receipt menu. Comes back with the receipt text; see handleCopyBillLink.
  const [receiptBillLink, setReceiptBillLink] = useState(null);
  const [shareLinks, setShareLinks] = useState(null);
  /**
   * The number, asked for AFTER the money is in the drawer.
   *
   * Every cash sale at a counter is anonymous, and it stays anonymous because the only
   * place to put a number was the customer picker — which sits mid-sale, in front of the
   * cashier, with the customer waiting. So it never got typed, and a shop with four
   * thousand sales a month had eleven people it could tell about a scheme.
   *
   * This asks in the one second the counter is actually free: the bill is done, the change
   * is handed over, and the customer is still standing there. Skipping it costs nothing —
   * the box is never a step, and the next scan clears it.
   */
  const [capturePhone, setCapturePhone] = useState('');
  const [captureName, setCaptureName] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [capturedName, setCapturedName] = useState('');
  const [captureError, setCaptureError] = useState('');
  /**
   * The open WhatsApp send sheet, or null.
   *
   * Everything that used to live inline on the receipt — an auto-send button, a link
   * button, a "sent" line, a spinner flag — now belongs to components/WhatsappSheet.js,
   * which the quotation panel below shares. This holds only what that sheet needs to draw
   * itself: who, what, where it can go, and which route would send it.
   */
  const [waSheet, setWaSheet] = useState(null);
  /**
   * An error, and the box that fixes it.
   *
   * The counter's complaint was never that the app failed to notice a problem — it was
   * that the sentence appeared in one corner ("khata customer chuniye") while the control
   * that answers it lived in another, sometimes on another screen entirely, and the
   * cashier had to work out for themselves where to go. So an error is now allowed to
   * carry a fix: a label and the thing to do — open the right chip, scroll the field into
   * view, focus it, flash it — and the message is drawn as a button that does it.
   *
   * `setError` keeps its old single-argument shape so every existing call site (and every
   * `setError('')` that clears the banner) behaves exactly as before; the fix is a second,
   * optional argument, and clearing the text always clears the fix with it.
   */
  const [error, setErrorText] = useState('');
  const [errorFix, setErrorFix] = useState(null);
  const setError = useCallback((text, fix = null) => {
    setErrorText(text);
    setErrorFix(text ? fix : null);
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [returnBillId, setReturnBillId] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [offlineCount, setOfflineCount] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmFilter, setConfirmFilter] = useState('');
  const [onlyShortages, setOnlyShortages] = useState(false);
  // A discount on the whole bill. Two fields rather than one because a shopkeeper says it
  // both ways — "10% chhod do" and "1200 kar do" — and forcing them to convert in their
  // head at the counter is exactly the friction this is meant to remove.
  const [billDiscountPercent, setBillDiscountPercent] = useState('');
  const [billDiscountAmount, setBillDiscountAmount] = useState('');
  /**
   * Which optional block of the checkout ticket is open — customer, discount,
   * prescription, "work done by", coupon/points — or none, which is how most bills are
   * rung up.
   *
   * These all used to be permanently on screen. On a chemist's counter that meant three
   * prescription boxes, a customer picker, a coupon field and a points field standing
   * between the total and the button on every single sale, including the ₹10 cash one —
   * roughly 400px of form asking questions nobody had. They are all still one tap away,
   * and each chip says what it is currently set to, so nothing is hidden *and* forgotten.
   *
   * One at a time on purpose: two open blocks are already taller than the fold, and an
   * accordion means the pay button never moves further than one panel's height away.
   */
  const [openExtra, setOpenExtra] = useState(null);
  // Which search result the arrow keys are sitting on. -1 = none, and Enter then falls
  // back to the barcode lookup exactly as it always did.
  const [activeResult, setActiveResult] = useState(-1);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /**
   * Which cart line the keyboard is standing on. −1 = none, which is where it sits for the
   * whole of an ordinary scan-scan-scan-pay sale.
   *
   * The cart was mouse-only: every correction — wrong quantity, wrong item, wrong rate —
   * meant lifting a hand off the keys, finding a 28px stepper and clicking it, on the one
   * screen in this app where hands never leave the keyboard. Arrow keys walk the lines,
   * +/− change the quantity, Delete drops the line, Enter opens its rate editor.
   */
  const [activeLine, setActiveLine] = useState(-1);
  // The counter's own beep. Default on — see lib/counterFeedback.js for why the app makes
  // this sound instead of trusting the scanner's.
  const [soundOn, setSoundOn] = useState(true);
  /**
   * A cart this device was holding when it was last closed, offered back rather than
   * restored — see lib/billDraft.js. Null in the overwhelmingly normal case where the last
   * session ended with a bill.
   */
  const [draftOffer, setDraftOffer] = useState(null);
  /**
   * True while the counter is in the full-height two-pane layout (the CSS calls it
   * `.pos-fit`, gated at 1101px). React needs to know, because two behaviours differ: the
   * receipt must NOT scroll the terminal off the screen when the terminal is the screen,
   * and the "bill done" summary belongs in the ticket rather than a panel below the fold.
   */
  const [posFit, setPosFit] = useState(false);
  /**
   * Is there honestly room for the shelf under this bill?
   *
   * This exists to enforce one rule: **the left column never has two scrollbars.** A
   * screen where the bill scrolls inside itself AND the shelf scrolls inside itself, on
   * top of a page that also scrolls, is a screen where turning a wheel does something
   * different depending on a pixel the cashier cannot see. So the shelf is shown only when
   * the whole bill already fits — the moment the bill is long enough to need scrolling,
   * the shelf gets out of the way and gives it the whole column.
   *
   * Which is also the right behaviour on its own terms: somebody eleven items into a sale
   * is scanning, not browsing.
   */
  const [shelfFits, setShelfFits] = useState(false);
  const [counterEditing, setCounterEditing] = useState(false);
  // The cart line whose price is being edited (see the price editor in the cart).
  const [priceEditLine, setPriceEditLine] = useState(null);
  // Parked carts (see backend models/HeldBill.js).
  const [heldBills, setHeldBills] = useState([]);
  const [holdPanelOpen, setHoldPanelOpen] = useState(false);
  const [holdLabel, setHoldLabel] = useState('');
  // The cart came off a parked bill; sending this lets the server clear it once the bill
  // is actually created, so a resumed cart can't be billed twice.
  const [resumedHoldId, setResumedHoldId] = useState(null);
  // A 409 from the server listing lines being sold below cost, held until the shopkeeper
  // either fixes them or says "haan, jaan-boojh kar".
  const [belowCostPrompt, setBelowCostPrompt] = useState(null);
  // What the server said about the bill just created — margin made, stock driven negative.
  const [billOutcome, setBillOutcome] = useState(null);
  const queryInputRef = useRef(null);
  const receiptRef = useRef(null);
  const receiptQrRef = useRef(null);
  const receiptQrScrolledRef = useRef(null);
  // The grid whose height is pinned to whatever the viewport has left — see the
  // measurement effect below.
  const posLayoutRef = useRef(null);
  // The cart's own scroll box. Once the bill scrolls inside the panel rather than moving
  // the page, a keyboard-selected line thirty items down has to be brought to the eye.
  const cartLinesRef = useRef(null);
  // So a saved draft is only ever *offered* once per page load, and never re-offered the
  // moment the cashier empties the cart again.
  const draftCheckedRef = useRef(false);
  // So a quotation handed to the cart is only ever unpacked once — see the effect below.
  const estimateHydratedRef = useRef(false);
  const syncingRef = useRef(false);
  const billQueryRef = useRef(null);

  // `billQuery` → query string. Derived rather than stored so there is exactly one thing
  // that can be out of date, and it is the one the fetch effect below watches.
  const billQueryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('preset', billQuery.preset);
    if (billQuery.preset === 'custom') {
      if (billQuery.from) params.set('from', billQuery.from);
      if (billQuery.to) params.set('to', billQuery.to);
    }
    if (billQuery.q) params.set('search', billQuery.q);
    if (billQuery.paymentMode) params.set('paymentMode', billQuery.paymentMode);
    if (billQuery.status) params.set('status', billQuery.status);
    if (billQuery.counter) params.set('counter', billQuery.counter);
    if (billQuery.cashier) params.set('cashier', billQuery.cashier);
    if (billQuery.unpaid) params.set('unpaid', 'true');
    params.set('page', String(billQuery.page));
    params.set('limit', String(billQuery.limit));
    return params.toString();
  }, [billQuery]);

  // Only an untouched "today" view can speak for the header's bills-today count — a search
  // for bill #12 returning one row must not rewrite the day's tally to 1.
  const isDefaultBillView = useMemo(
    () => billQuery.preset === 'today' && BILL_FILTER_KEYS.every((key) => !billQuery[key]),
    [billQuery]
  );
  const activeBillFilterCount = BILL_FILTER_KEYS.filter((key) => billQuery[key]).length;
  // Who was on the tills in this period. Grouped by the server over the date window and
  // NOT narrowed by the current counter/cashier selection, so picking "Counter 2" can
  // never make the other counters vanish from the list you picked it in.
  const counterOptions = billSummary?.byCounter || [];
  // Bills written before staff logins existed carry no `createdBy`, so there is nothing to
  // filter on — they'd be an option that returns nothing.
  const cashierOptions = (billSummary?.byCashier || []).filter((row) => row.id);
  const canExportBills =
    user?.role !== 'staff' || (Array.isArray(user?.permissions) && user.permissions.includes('exports'));

  /**
   * Change what the register is showing. Every filter goes through here so that none of
   * them can leave the page number behind: someone on page 7 who picks "UPI only" would
   * otherwise land on a blank page and think the app broke.
   */
  function setBillFilter(patch) {
    setBillQuery((current) => ({ ...current, ...patch, page: 1 }));
  }

  function resetBillFilters() {
    setBillSearchDraft('');
    setBillQuery((current) => ({ ...DEFAULT_BILL_QUERY, limit: current.limit }));
  }

  /**
   * "Something changed underneath — show it again."
   *
   * Callers do not fetch themselves. A socket handler subscribed three filter changes ago
   * closes over the query string as it was back then, and would happily overwrite the
   * table with the wrong window. Bumping a counter lets the effect below — which always
   * sees the current query — do the actual fetch.
   */
  function refreshBills() {
    setBillRefresh((n) => n + 1);
  }

  useEffect(() => {
    // The skeleton belongs to a change of window (a filter, the find box), not to the
    // background refresh that follows every new bill — that one must not blink the table
    // away while the shopkeeper is reading it. The first load counts as a change.
    const windowChanged = billQueryRef.current !== billQueryString;
    billQueryRef.current = billQueryString;
    if (windowChanged) setBillsLoading(true);

    let cancelled = false;
    apiFetch(`/api/seller/bills?${billQueryString}`)
      .then((data) => {
        if (cancelled) return;
        setBills(data.bills || []);
        setBillTotal(data.total || 0);
        // Older servers don't send a summary; the strip simply doesn't render.
        setBillSummary(data.summary || null);
        if (isDefaultBillView) setDailyBillCount(data.summary?.count ?? (data.bills || []).length);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setBillsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billQueryString, billRefresh]);

  /**
   * The register as a file. The server re-runs the same filter and writes every matching
   * bill, not just the page on screen — a shopkeeper handing their CA "July, UPI only"
   * means all of July.
   */
  async function exportBills(format) {
    setBillExporting(true);
    try {
      await downloadFile(`/api/seller/bills?${billQueryString}&format=${format}`, `bill-register.${format}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBillExporting(false);
    }
  }

  // What this counter reaches for, learned from what it actually bills. Counted per
  // finished bill rather than per tap, so a mis-scan that gets removed again never earns
  // a product a place in the grid.
  function rememberQuickPicks(lines) {
    const ids = lines.filter((line) => !line.isService && line.productId).map((line) => line.productId);
    if (ids.length === 0) return;
    setQuickPicks((prev) => {
      const tally = { ...prev.tally };
      for (const id of ids) tally[id] = (tally[id] || 0) + 1;
      const next = { ...prev, tally };
      writeQuickPicks(next);
      return next;
    });
  }

  function toggleQuickPin(productId) {
    setQuickPicks((prev) => {
      const pins = prev.pins.includes(productId)
        ? prev.pins.filter((id) => id !== productId)
        : [productId, ...prev.pins].slice(0, QUICK_PICK_LIMIT);
      const next = { ...prev, pins };
      writeQuickPicks(next);
      return next;
    });
  }

  // "Isko hata do." Unpinning alone would not be enough — the tally that put it there in
  // the first place would just bring it back on the next bill, which reads as the app
  // ignoring the shopkeeper. So the count is dropped too.
  function forgetQuickPick(productId) {
    setQuickPicks((prev) => {
      const tally = { ...prev.tally };
      delete tally[productId];
      const next = { ...prev, tally, pins: prev.pins.filter((id) => id !== productId) };
      writeQuickPicks(next);
      return next;
    });
  }

  function setQuickPicksHidden(hidden) {
    setQuickPicks((prev) => {
      const next = { ...prev, hidden };
      writeQuickPicks(next);
      return next;
    });
  }

  async function syncOfflineQueue() {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      const queue = getQueue();
      let syncedAny = false;
      for (const entry of queue) {
        try {
          await apiFetch('/api/seller/bills', { method: 'POST', body: JSON.stringify(entry.payload) });
          removeFromQueue(entry.localId);
          syncedAny = true;
        } catch (err) {
          if (err instanceof TypeError) break; // still offline — stop and retry later
          updateQueueEntry(entry.localId, { error: err.message, errorCode: err.code });
        }
      }
      setOfflineCount(queueCount());
      if (syncedAny) {
        refreshBills();
        apiFetch('/api/seller/products').then((d) => setProducts(d.products)).catch(() => {});
      }
    } finally {
      syncingRef.current = false;
    }
  }

  // A khata bill can't drop its customer — the customer is the whole point. Any other
  // mode only carries one for loyalty (coupon/points), which is meaningless without them,
  // so both are stripped along with the dead id. This is what turns a queued bill stuck
  // forever on a customer merged/deleted elsewhere before the queue synced into a bill
  // that goes through — instead of the shopkeeper's only option being to delete the sale.
  function rebillQueueEntryAsWalkIn(entry) {
    const { customerId, couponCode, redeemPoints, ...rest } = entry.payload;
    updateQueueEntry(entry.localId, { payload: rest, error: null, errorCode: null });
    syncOfflineQueue();
  }

  useEffect(() => {
    apiFetch('/api/seller/products').then((data) => setProducts(data.products)).catch(() => {});
    apiFetch('/api/seller/khata/customers').then((data) => setCustomers(data.customers)).catch(() => {});
    loadHeldBills();
    // silentUpgrade: this is only deciding whether to show the loyalty chip, not something
    // the shopkeeper asked for — a shop without the feature should just not see the chip,
    // not get greeted with an upgrade sheet the moment they open the billing screen.
    apiFetch('/api/seller/loyalty/settings', { silentUpgrade: true })
      .then((data) => setLoyaltyEnabled(!!data.settings?.enabled))
      .catch(() => {});
    // Only used to offer the "work done by" picker. A shop with no staff never sees it,
    // so a one-man kirana's counter stays exactly as it is.
    apiFetch('/api/seller/staff/list')
      .then((data) => {
        setStaffList(data.staff || []);
        setStaffPaysCommission(Boolean(data.paysCommission));
      })
      .catch(() => {});
    // The bill register loads itself — its own effect fires on mount off billQueryString.

    const stored = localStorage.getItem(COUNTER_KEY);
    if (stored) setCounter(stored);
    else if (user?.counterName) setCounter(user.counterName);
    setQuickPicks(readQuickPicks());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * A quotation opened from the Estimates screen, landing in the cart.
   *
   * Waits for the catalog, because the lines are rebuilt from live products (see
   * cartLinesFromEstimate) rather than trusted from the document. Runs once per arrival —
   * the handoff is deleted as soon as it is read, so a page refresh mid-sale does not reset
   * the cart back to the quoted lines and lose whatever the counter has added since.
   */
  useEffect(() => {
    if (estimateHydratedRef.current || products.length === 0) return;
    let payload = null;
    try {
      payload = JSON.parse(sessionStorage.getItem(ESTIMATE_CART_KEY) || 'null');
    } catch {
      payload = null;
    }
    if (!payload?.estimateId) return;
    estimateHydratedRef.current = true;
    try {
      sessionStorage.removeItem(ESTIMATE_CART_KEY);
    } catch {
      /* a blocked sessionStorage is not worth failing the handoff over */
    }

    setCart(cartLinesFromEstimate(payload.items, products));
    if (payload.customerId) setCustomerId(payload.customerId);
    if (Number(payload.billDiscountPercent) > 0) setBillDiscountPercent(String(payload.billDiscountPercent));
    else if (Number(payload.billDiscount) > 0) setBillDiscountAmount(String(payload.billDiscount));
    setEstimateLink({
      id: payload.estimateId,
      number: payload.number || '',
      mode: payload.mode === 'edit' ? 'edit' : 'convert',
    });
    setQuoteForm({
      contactName: payload.contactName || '',
      contactPhone: payload.contactPhone || '',
      validityMode: 'date',
      validDays: '7',
      validUntil: payload.validUntil ? String(payload.validUntil).slice(0, 10) : '',
      notes: payload.notes || '',
    });
  }, [products]);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    setOfflineCount(queueCount());

    function handleOnline() {
      setIsOnline(true);
      syncOfflineQueue();
    }
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (navigator.onLine) syncOfflineQueue();
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user?.counterName && !localStorage.getItem(COUNTER_KEY)) setCounter(user.counterName);
  }, [user]);

  function handleCounterChange(value) {
    setCounter(value);
    localStorage.setItem(COUNTER_KEY, value);
  }

  useEffect(() => {
    setSoundOn(isCounterSoundOn());
  }, []);

  function toggleSound() {
    // Computed out here rather than inside the state updater: an updater must be pure, and
    // React calls it twice in development — which would beep twice for one tap.
    const next = !soundOn;
    setCounterSoundOn(next);
    setSoundOn(next);
    // Play the blip the moment it is switched on, so the person deciding hears exactly what
    // they are agreeing to rather than finding out at the next scan.
    if (next) counterFeedback('add');
  }

  /**
   * Is the counter running as a full-height terminal?
   *
   * Same 1101px the two-pane layout has always used — read here rather than guessed, so
   * the JS behaviours that depend on it can never disagree with the CSS that draws it.
   */
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(min-width: 1101px)');
    const apply = () => setPosFit(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  /**
   * Pin the terminal to the viewport.
   *
   * This screen is used standing up, one-handed, with a customer waiting — and it was a
   * document that scrolled. The cart grew downwards until the items at the top of the bill
   * were somewhere above the window, and finding out what was on the bill meant scrolling a
   * page instead of reading a screen.
   *
   * The height cannot be written as a constant in CSS because what sits above the grid is
   * not constant: a page title, an offline banner, a scheme notice, a restored-cart strip,
   * the sync queue's errors. So the grid measures its own distance from the top of the
   * document and takes the rest of the viewport — recomputed whenever anything above it can
   * have appeared or gone. `100dvh`, not `vh`, or a phone's collapsing address bar leaves
   * the pay button under the browser chrome.
   */
  useEffect(() => {
    const el = posLayoutRef.current;
    if (!el) return undefined;
    function measure() {
      const node = posLayoutRef.current;
      if (!node) return;
      /**
       * offsetTop up the chain, NOT getBoundingClientRect().
       *
       * Every panel and the page header carry `fadeInUp`, which is a transform. A rect
       * read while that animation is still running is a rect that is ten-odd pixels out
       * of place, and the grid would then be built ten pixels short for the rest of the
       * session — a permanent gap at the bottom of the screen caused by a 400ms
       * animation. Offset positions are laid-out positions and transforms cannot move
       * them, so this reads the same number before, during and after the entrance.
       */
      let top = 0;
      for (let el = node; el; el = el.offsetParent) top += el.offsetTop;
      node.style.setProperty('--pos-top', `${Math.max(0, Math.round(top))}px`);
    }
    measure();
    // A webfont landing after first paint changes the height of the title above the grid.
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(() => {});
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [error, liveNotice, isOnline, offlineCount, counterEditing, draftOffer, posFit]);

  /* The other half of sizing this screen — which of its boxes ended up scrolling — lives
     further down, next to the memos its dependency array reads. */


  /**
   * Mirror the open cart to this device, on every change.
   *
   * Debounced so that holding "+" does not write a hundred times, and cheap enough at that
   * rate to be invisible. Cleared — not just skipped — when the cart empties, so a finished
   * bill can never be offered back as an unfinished one.
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      if (cart.length === 0) {
        clearBillDraft();
        return;
      }
      saveBillDraft({
        userId: user?.id,
        cart,
        paymentMode,
        customerId,
        billDiscountPercent,
        billDiscountAmount,
        counter,
        // Deliberately NOT saved: the resumed-hold id and the quotation link. Both are
        // claims on a server-side document, and a draft restored hours later must not
        // quietly close somebody's parked cart or stamp a quotation as billed.
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [cart, paymentMode, customerId, billDiscountPercent, billDiscountAmount, counter, user]);

  /**
   * "Aapka pichla bill wapas mil gaya."
   *
   * Checked once, after the catalog has loaded (the lines carry their own prices, but the
   * screen is useless before the product list is there to search), and only when the cart
   * is genuinely empty — a quotation handed to the counter, or a cart already being built,
   * always wins over a saved draft.
   */
  useEffect(() => {
    if (draftCheckedRef.current || !user?.id || products.length === 0) return;
    draftCheckedRef.current = true;
    if (cart.length > 0 || estimateLink) return;
    const draft = readBillDraft(user.id);
    if (draft?.cart?.length) setDraftOffer(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, products]);

  /**
   * Decide whether the shelf gets to exist right now.
   *
   * The measurement is deliberately built out of numbers that do NOT change when the shelf
   * appears or disappears, because anything else oscillates: hide the shelf, the bill gets
   * taller, the bill now fits, show the shelf, the bill no longer fits, hide it again —
   * forever, at sixty frames a second.
   *
   *   - the column height comes from the viewport and --pos-top, never from the column's
   *     own clientHeight (which IS shelf-dependent, since the column only takes a definite
   *     height while a shelf is in it)
   *   - the bill's height is its NATURAL height: the panel as rendered, with the cart's
   *     visible list swapped for its full scroll height
   *
   * 190px is the smallest shelf worth drawing — one row of tiles plus its aisle chips.
   * Below that it is a sliver of half-cut products, which is worse than no shelf at all.
   */
  useEffect(() => {
    if (!posFit) {
      setShelfFits(false);
      return undefined;
    }
    function measure() {
      const layout = posLayoutRef.current;
      if (!layout) return;
      const search = layout.querySelector('.pos-search-panel');
      const cartPanel = layout.querySelector('.pos-cart-panel');
      if (!search || !cartPanel) return;
      const lines = layout.querySelector('.cart-lines');
      const top = Number.parseInt(layout.style.getPropertyValue('--pos-top'), 10) || 0;
      const columnHeight = window.innerHeight - top - 20;
      const billNatural = lines
        ? cartPanel.offsetHeight - lines.clientHeight + lines.scrollHeight
        : cartPanel.offsetHeight;
      setShelfFits(columnHeight - search.offsetHeight - billNatural - 18 >= 190);
    }
    // After paint: the cart panel has to have been laid out before it can be measured.
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
  }, [posFit, cart, offerPreview, estimateLink, heldBills, holdPanelOpen, error, liveNotice, draftOffer]);

  function restoreDraft() {
    if (!draftOffer) return;
    setCart(draftOffer.cart);
    if (draftOffer.paymentMode) setPaymentMode(draftOffer.paymentMode);
    if (draftOffer.customerId) setCustomerId(draftOffer.customerId);
    if (draftOffer.billDiscountPercent) setBillDiscountPercent(draftOffer.billDiscountPercent);
    if (draftOffer.billDiscountAmount) setBillDiscountAmount(draftOffer.billDiscountAmount);
    setDraftOffer(null);
    queryInputRef.current?.focus();
  }

  function dismissDraft() {
    clearBillDraft();
    setDraftOffer(null);
  }

  useEffect(() => {
    const socket = getShopSocket();
    if (!socket) return;
    const onBillCreated = (payload) => {
      if (payload.counter && payload.counter !== counter) {
        setLiveNotice(`${payload.createdByName || 'Another counter'} (${payload.counter}) just billed ₹${payload.total}`);
        setTimeout(() => setLiveNotice(''), 6000);
      }
      refreshBills();
    };
    socket.on('bill:created', onBillCreated);
    return () => socket.off('bill:created', onBillCreated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counter]);

  // Fast-billing shortcuts: "/" and F2 both jump to the search/scan box (kept as two
  // shortcuts for muscle memory even though they now do the same thing), Ctrl/Cmd+Enter
  // finalizes the bill, Escape backs out of the scanner or clears the box — all skipped
  // while typing except Escape/Ctrl+Enter, so they don't fight normal typing.
  useEffect(() => {
    function handleKeyDown(event) {
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // While the confirm modal is open it owns the keyboard: Enter finalizes the bill,
      // Escape backs out to keep editing. Nothing else fires underneath it.
      if (confirmOpen) {
        // Ctrl/Cmd+Enter always confirms. Plain Enter confirms only when not typing, so
        // hitting Enter after a search term filters/does nothing instead of firing the bill.
        const ctrlEnter = event.key === 'Enter' && (event.ctrlKey || event.metaKey);
        if (event.key === 'Enter' && (ctrlEnter || !typing)) {
          event.preventDefault();
          if (!submitting) handleCreateBill();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setConfirmOpen(false);
        }
        return;
      }

      // Any other modal owns the keyboard too — Ctrl+Enter must not fire a bill from
      // behind the add-customer or add-charge form the cashier is actually typing into.
      if (newCustomerOpen || editCustomer || serviceOpen || packSetup || returnBillId) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setNewCustomerOpen(false);
          setEditCustomer(null);
          setServiceOpen(false);
          setPackSetup(null);
          setReturnBillId(null);
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        if (cart.length > 0 && !submitting) requestCreateBill();
        return;
      }
      if (event.key === 'Escape') {
        if (scannerOpen) {
          closeScanner();
          return;
        }
        document.activeElement?.blur();
        setQuery('');
        setActiveLine(-1);
        setPriceEditLine(null);
        return;
      }
      /**
       * The function row.
       *
       * Every counter package a shopkeeper has used before this one — Busy, Marg, Tally,
       * the ₹8,000 box the wholesaler sells with a printer — is driven from F-keys, and a
       * cashier who has been billing for fifteen years reaches for them without deciding
       * to. Offering only "/" and Ctrl+Enter meant this app was the one that had to be
       * used with a mouse. F5 and F11 are left alone (reload, fullscreen); F1/F3 are
       * claimed back from the browser with preventDefault.
       *
       * Deliberately ABOVE the "are they typing" guard, unlike everything below it: on this
       * screen the cursor lives in the search box between every single scan, so a function
       * row that only worked when nothing had focus would be a function row that never
       * worked. An F-key types no character, so there is nothing for it to interrupt.
       */
      if (event.key === 'F1') {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }
      if (event.key === 'F3') {
        event.preventDefault();
        if (cart.length > 0) handleHoldBill();
        return;
      }
      if (event.key === 'F4') {
        event.preventDefault();
        setOpenExtra((open) => (open === 'customer' ? null : 'customer'));
        return;
      }
      if (event.key === 'F6') {
        event.preventDefault();
        // The segmented control is off screen until there is a cart, so cycling it there
        // would change a setting nobody can see — and then surprise the next customer.
        if (cart.length === 0) return;
        const modes = ['cash', 'upi', 'card', 'khata', 'split'];
        setPaymentMode((mode) => modes[(modes.indexOf(mode) + 1) % modes.length]);
        return;
      }
      if (event.key === 'F8') {
        event.preventDefault();
        setServiceForm(blankCharge());
        setServiceOpen(true);
        return;
      }
      if (event.key === 'F9') {
        event.preventDefault();
        setOpenExtra((open) => (open === 'discount' ? null : 'discount'));
        return;
      }

      // Everything past this point produces a character or already means something inside
      // an input, so it belongs to whatever has focus.
      if (typing) return;

      /**
       * Walking the bill.
       *
       * These only fire when nothing has focus — inside the search box the same arrows
       * already move through the *results*, which is the more urgent job and keeps its
       * meaning. Out here they move down the printed bill, which is what a cashier is
       * looking at when a customer says "woh do nahi, ek".
       */
      if (cart.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        setActiveLine((index) => {
          if (index < 0) return event.key === 'ArrowDown' ? 0 : cart.length - 1;
          return event.key === 'ArrowDown'
            ? (index + 1) % cart.length
            : (index - 1 + cart.length) % cart.length;
        });
        return;
      }
      if (activeLine >= 0 && activeLine < cart.length) {
        const line = cart[activeLine];
        if (event.key === '+' || event.key === '=') {
          event.preventDefault();
          updateQuantity(line.lineId, Math.round((line.quantity + 1) * 1000) / 1000);
          return;
        }
        if (event.key === '-' || event.key === '_') {
          event.preventDefault();
          updateQuantity(line.lineId, Math.max(0.001, Math.round((line.quantity - 1) * 1000) / 1000));
          return;
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          removeFromCart(line.lineId);
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          setPriceEditLine((open) => (open === line.lineId ? null : line.lineId));
          return;
        }
      }

      if (event.key === '/' || event.key === 'F2') {
        event.preventDefault();
        setActiveLine(-1);
        queryInputRef.current?.focus();
        return;
      }

      /**
       * The scanner gun's safety net — and the reason it is worth more than it looks.
       *
       * A barcode gun is not a scanner as far as the browser is concerned. It is a
       * KEYBOARD: it types the code and presses Enter, at about a thousand characters a
       * minute. So it only ever worked here while the search box happened to hold focus —
       * and focus is lost by every ordinary thing a counter does between two customers:
       * tapping a product tile, correcting a line, taking a payment, or simply opening the
       * screen, which starts with focus nowhere at all. The gun then fired its whole code
       * into a page that was listening for F-keys, every character was swallowed, and the
       * shopkeeper got no beep, no line and no error — the scan just did not happen. He
       * scans again, harder, and blames the gun.
       *
       * So any plain character typed with nothing focused means the same thing it means in
       * every counter package ever written: start typing in the search box. The keystroke
       * that woke it is carried in rather than dropped, because a gun's first digit is
       * part of the barcode and losing it silently corrupts the code instead of losing it.
       *
       * Last in the handler on purpose — everything with a real meaning has already had
       * its turn, so this can never steal a shortcut.
       */
      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        /^[a-zA-Z0-9]$/.test(event.key)
      ) {
        event.preventDefault();
        setActiveLine(-1);
        setQuery((current) => current + event.key);
        queryInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, activeLine, submitting, scannerOpen, confirmOpen, newCustomerOpen, editCustomer, serviceOpen, packSetup, returnBillId]);

  // A highlight pointing at row 4 of a three-line cart is a highlight pointing at the wrong
  // product. It is dropped whenever the cart shrinks past it rather than clamped, because
  // "nothing selected" is the honest state after the selected thing was removed.
  useEffect(() => {
    setActiveLine((index) => (index >= cart.length ? -1 : index));
  }, [cart.length]);

  useEffect(() => {
    if (activeLine < 0) return;
    // `nearest` and not `center`: a line already on screen must not be shoved around just
    // because the arrow key moved onto it.
    cartLinesRef.current?.querySelector(`[data-line="${activeLine}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeLine]);

  // If the shopkeeper empties the cart from inside the review modal (customer cancelled
  // everything), there's nothing left to confirm — drop back to the billing screen.
  useEffect(() => {
    if (confirmOpen && cart.length === 0) setConfirmOpen(false);
  }, [confirmOpen, cart.length]);

  /**
   * The receipt renders below the fold, so after a bill is created bring it into view
   * instead of making the shopkeeper hunt for it by scrolling down every single time.
   *
   * …except on the full-height terminal, where the counter IS the screen. Scrolling away
   * from it would answer "what was the bill number" by taking away the place the next
   * customer's items get scanned — so there the ticket shows the finished bill in place
   * (see `.pos-ticket__done`) and the page does not move at all.
   */
  useEffect(() => {
    if (receipt && receipt.paymentMode !== 'upi' && !posFit && receiptRef.current) {
      receiptRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [receipt, posFit]);

  // "3*parle" searches for parle and remembers the 3 — see parseQuantityQuery.
  const parsedQuery = useMemo(() => parseQuantityQuery(query), [query]);

  /**
   * The catalogue with its names already lowercased, rebuilt only when the catalogue
   * itself changes.
   *
   * The search below runs on every keystroke at the counter, and it used to call
   * `p.name.toLowerCase()` inside the filter — one fresh string allocated per product per
   * letter typed. A kirana with five thousand SKUs was therefore allocating five thousand
   * strings between one key going down and the results appearing, on the screen the shop
   * spends its whole day on and usually on the cheapest phone in the building. That is
   * exactly the shape of lag a cashier feels as "typing is behind me".
   */
  /**
   * Kitchen-only stock: raw paneer, tomato, oil — used in a recipe and never sold (no price).
   * Left in the counter's search and grid, a cashier tapping "Paneer" billed a kilo of raw
   * paneer at ₹0 instead of the dish. They stay in `products` (the dish checks need their
   * stock); they are only kept out of what the cashier picks from.
   */
  const kitchenOnlyIds = useMemo(() => {
    const used = new Set();
    for (const p of products) for (const line of p.recipe || []) used.add(String(line.product?._id || line.product));
    if (!used.size) return new Set();
    return new Set(products.filter((p) => used.has(p._id) && !(Number(p.price) > 0)).map((p) => p._id));
  }, [products]);
  const sellableProducts = useMemo(
    () => (kitchenOnlyIds.size ? products.filter((p) => !kitchenOnlyIds.has(p._id)) : products),
    [products, kitchenOnlyIds]
  );

  const searchIndex = useMemo(
    () => sellableProducts.map((product) => ({ product, haystack: product.name.toLowerCase() })),
    [sellableProducts]
  );

  const filteredProducts = useMemo(() => {
    const q = parsedQuery.term.toLowerCase();
    if (!q) return [];
    // Stops at eight rather than matching the whole catalogue and throwing the rest away,
    // which is what `.filter().slice(0, 8)` did. Same eight results, in the same order.
    const found = [];
    for (const entry of searchIndex) {
      if (entry.haystack.includes(q)) {
        found.push(entry.product);
        if (found.length === 8) break;
      }
    }
    return found;
  }, [parsedQuery, searchIndex]);

  // The highlight always lands back on the first result when the list changes underneath
  // it — otherwise a cashier who types one more letter is left pointing at whatever row
  // index 3 happens to be now, which is how you bill the wrong product.
  useEffect(() => {
    setActiveResult(filteredProducts.length > 0 ? 0 : -1);
  }, [filteredProducts]);

  /**
   * The grid that fills the search panel before anything is typed.
   *
   * Until now this half of the screen was blank until the cashier typed — on the busiest
   * page in the app, for the twenty products that are most of every day's sales. Pinned
   * items come first in the order they were pinned, then whatever this counter bills most,
   * so the grid is useful on day one (nothing) and better every week after.
   */
  const quickPickProducts = useMemo(() => {
    // On the fitted layout the shelf below the cart does this job properly, with stock and
    // categories and room to breathe. Two shortlists on one screen is one too many.
    if (posFit || parsedQuery.term || sellableProducts.length === 0) return [];
    const byId = new Map(sellableProducts.map((p) => [p._id, p]));
    const pinned = quickPicks.pins.map((id) => byId.get(id)).filter(Boolean);
    const pinnedIds = new Set(pinned.map((p) => p._id));
    const frequent = Object.entries(quickPicks.tally)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => byId.get(id))
      .filter((p) => p && !pinnedIds.has(p._id));
    return [...pinned, ...frequent].slice(0, QUICK_PICK_LIMIT);
  }, [posFit, parsedQuery, sellableProducts, quickPicks]);

  /**
   * Which of this screen's boxes are actually scrolling.
   *
   * Three of them fade their bottom edge to say "there is more below" (see the mask-image
   * block in globals.css). The fade was unconditional, and on a counter that is wrong far
   * more often than it is right: a one-item bill had its only row dimmed at the bottom,
   * and the checkout ticket cut its chip row in half with no way to tell that from a
   * rendering fault — reported from a live shop as exactly that. The stylesheet could not
   * work out which case it was in (there is no CSS for "does this overflow"), so it is
   * measured here and the mask is gated on the result.
   *
   * ResizeObserver on both the box and its content, because either can change without the
   * other: adding a cart line grows the content, opening an extras panel shrinks the box.
   */
  useEffect(() => {
    const root = posLayoutRef.current;
    if (!root) return undefined;
    const boxes = Array.from(
      root.querySelectorAll('.cart-lines, .pos-browse-grid, .pos-ticket__body')
    );
    if (boxes.length === 0) return undefined;

    function sync() {
      for (const box of boxes) {
        // A pixel of slack: sub-pixel layout leaves scrollHeight a hair over clientHeight
        // on boxes that visibly do not scroll, which would fade every one of them.
        const scrolls = box.scrollHeight - box.clientHeight > 1;
        if (scrolls) box.setAttribute('data-scrollable', 'true');
        else box.removeAttribute('data-scrollable');
      }
    }
    sync();

    const observer = new ResizeObserver(sync);
    for (const box of boxes) {
      observer.observe(box);
      // The scroll box itself does not resize when a child is added to it, so the content
      // has to be watched too — otherwise a bill only gained its fade on the next resize.
      for (const child of box.children) observer.observe(child);
    }
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [posFit, cart, openExtra, paymentMode, offerPreview, receipt, filteredProducts, quickPickProducts]);

  /**
   * The aisles. Only drawn when the shop actually keeps more than one — a chemist who has
   * never filled in a category should not be given a filter bar with one button in it.
   */
  const browseCategories = useMemo(
    () => Array.from(new Set(sellableProducts.map((p) => p.category).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [sellableProducts]
  );

  /**
   * What the shelf shows, in the order a counter wants it.
   *
   * Pinned first, then whatever this till bills most, then alphabetical — the same ranking
   * the quick-pick rail used, so a shop that has been running for a month opens billing to
   * its own twenty best-sellers rather than to whatever the database returned first. It is
   * the rail's job done at full size, which is why the rail stands down on this layout.
   */
  const browseProducts = useMemo(() => {
    if (!posFit || !shelfFits || parsedQuery.term || sellableProducts.length === 0) return [];
    const pins = new Set(quickPicks.pins);
    const tally = quickPicks.tally || {};
    return sellableProducts
      .filter((p) => !browseCategory || p.category === browseCategory)
      .slice()
      .sort((a, b) => {
        const pinDelta = (pins.has(b._id) ? 1 : 0) - (pins.has(a._id) ? 1 : 0);
        if (pinDelta) return pinDelta;
        const tallyDelta = (tally[b._id] || 0) - (tally[a._id] || 0);
        if (tallyDelta) return tallyDelta;
        return a.name.localeCompare(b.name);
      });
  }, [posFit, shelfFits, parsedQuery, sellableProducts, browseCategory, quickPicks]);

  // A category that has been emptied — every product in it deleted or moved — would leave
  // the shelf staring at nothing with no way back except guessing. Drop the filter.
  useEffect(() => {
    if (browseCategory && !browseCategories.includes(browseCategory)) setBrowseCategory('');
  }, [browseCategories, browseCategory]);

  /**
   * `saleUnit` is the product's sub-unit when the counter tapped "+ 1 tablet" instead of
   * the tile itself. Left out — which is every scan, every Enter, every voice match and
   * every ordinary tap — it adds a whole pack exactly as it always did.
   *
   * Lines are keyed by product AND unit, not by product alone. "Do strip aur teen goli"
   * is one real sale of one medicine and has to be two lines: the customer is paying a
   * different rate for each half, and merging them into one number would make the bill a
   * lie about what was handed over.
   */
  function addToCart(product, saleUnit, quantity, modifiers, scan) {
    if (blockExpiredProduct(product)) return;
    const packSize = packSizeOf(product);
    const loose = Boolean(packSize) && saleUnit === product.subUnit;
    const unit = loose ? product.subUnit : product.unit;
    // Resolved purely for what the counter sees while the bill is still open — the server
    // never trusts this and re-derives it from Product.modifierGroups at bill creation
    // (see expandModifierLines in backend/utils/modifiers.js). This is the same
    // snapshot-for-display, re-resolve-for-money split the Tables screen uses.
    let modifierDelta = 0;
    const modifierLabels = [];
    for (const sel of modifiers || []) {
      const group = (product.modifierGroups || []).find((g) => g._id === sel.groupId);
      if (!group) continue;
      for (const optId of sel.optionIds || []) {
        const option = (group.options || []).find((o) => o._id === optId);
        if (!option) continue;
        modifierDelta += option.priceDelta || 0;
        modifierLabels.push(option.name);
      }
    }
    // A different modifier pick is a different sale, not more of the same line — "Large"
    // and "Small" of the same dish must never merge quantities together.
    const modifierKey = (modifiers || [])
      .map((m) => `${m.groupId}:${(m.optionIds || []).slice().sort().join(',')}`)
      .sort()
      .join('|');
    const lineId = `${product._id}:${unit}:${modifierKey}`;
    // A quantity typed with the search term ("6*parle") is what the customer asked for,
    // not one more of something already on the bill — so it replaces the line's quantity
    // rather than adding to it. A plain tap keeps the old +1 behaviour.
    const asked = Number(quantity) > 0 ? Number(quantity) : null;
    /*
     * ...except a weighing-scale sticker, which is a PACKET, not an amount.
     *
     * A customer buying two 250g boxes of barfi hands over two stickers and the counter
     * scans both. Replacing would have billed 0.25kg for two boxes — the second scan
     * silently overwriting the first with the same number, and the shop giving away half
     * the sale with nothing on screen looking wrong. Each sticker is its own weight and
     * they add up, exactly as two taps of the same tile add up.
     */
    const stickerAdds = scan?.kind === 'scale' && asked != null;
    setCart((prev) => {
      const existing = prev.find((item) => item.lineId === lineId);
      if (existing) {
        const next = stickerAdds
          ? Math.round((existing.quantity + asked) * 1000) / 1000
          : asked ?? existing.quantity + 1;
        return prev.map((item) => (item.lineId === lineId ? { ...item, quantity: next } : item));
      }
      return [
        ...prev,
        {
          lineId,
          productId: product._id,
          // A catalog service (haircut, wash-and-iron) has no shelf — it must never be
          // treated as stock-limited the way a goods line is, or billing a walk-in
          // service with no appointment would wrongly get blocked as "out of stock".
          isService: product.kind === 'service',
          name: modifierLabels.length ? `${product.name} (${modifierLabels.join(', ')})` : product.name,
          modifiers: modifiers && modifiers.length ? modifiers : undefined,
          unit,
          price: (loose ? subUnitPriceOf(product) : product.price) + modifierDelta,
          gstRate: product.gstRate || 0,
          quantity: asked ?? 1,
          // Both prices ride along from the moment the line is created, so flipping
          // "packet ⇄ tablet" on an already-added line is instant and needs no lookup.
          packSize,
          packUnit: product.unit,
          subUnit: packSize ? product.subUnit : undefined,
          packPrice: product.price,
          loosePrice: packSize ? subUnitPriceOf(product) : undefined,
          saleUnit: unit,
          // Only a warranty-tracked product (electronics, auto parts) asks for a serial
          // at the counter — a kirana line never needs one.
          warrantyMonths: product.warrantyMonths || undefined,
          // Drives the prescription block below. Carried on the line so the counter is
          // asked the moment a scheduled medicine is scanned, not after the server
          // refuses the bill.
          drugSchedule: product.drugSchedule || undefined,
          // A GS1 QR/DataMatrix carries the piece's own serial (AI 21) — an electronics or
          // auto-parts scan already knows the number the counter would otherwise be reading
          // off the box and typing in by hand. Only ever pre-filled from the symbol that was
          // just scanned, never guessed, and still editable on the line.
          serialNumber: scan?.serial || '',
        },
      ];
    });
    setQuery('');
    // The confirmation the shopkeeper actually perceives. Their eyes are on the next packet
    // in the crate, not on this screen — see lib/counterFeedback.js.
    counterFeedback('add');
  }

  /**
   * How much of the thing a weighing-scale sticker is actually for.
   *
   * The kaanta has already done the sum — it weighed the packet, multiplied by its own
   * rate, and printed the answer. What it does NOT print is anything the app can bill
   * against: `2012345057500` is an item number with ₹57.50 buried in it, and a bill line
   * needs a quantity.
   *
   * Two shapes, and which one a shop gets depends on how its scale is configured:
   *
   *   weight on the sticker → that IS the quantity. Nothing is derived, nothing can drift.
   *   price on the sticker  → the rupees are the truth (the customer is holding a packet
   *                           with them printed on it), so the quantity is what the shop's
   *                           own rate says those rupees bought. Bill the money the label
   *                           promised and let the weight follow, never the other way
   *                           round — a customer arguing with a sticker is a lost customer.
   *
   * The price shape only lands on the right weight while the scale's rate and the app's
   * rate agree, which is why the counter shows its working (see noteScan) and Settings
   * says so in as many words. Nothing here can detect a disagreement: the money always
   * reconciles by construction, and it is the *weight* — and therefore the stock — that
   * quietly goes wrong. Showing the arithmetic on screen is the only honest answer, and
   * the shopkeeper is holding the packet it is about.
   */
  function scaleStickerQuantity(product, scan) {
    const sticker = scan?.scale;
    if (!sticker) return null;

    if (sticker.weight != null) {
      // Always kilos — Settings calibrates the layout against a weight the shopkeeper types
      // in kg, so there is no gram/kilo ambiguity left by the time it reaches here.
      return product?.unit === 'gram' ? sticker.weight * 1000 : sticker.weight;
    }

    const rate = Number(product?.price) || 0;
    if (!(rate > 0) || !(sticker.price > 0)) return null;
    // Three decimals is one gram, which is also the resolution the cart keeps everywhere
    // else and finer than any counter scale reports.
    return Math.round((sticker.price / rate) * 1000) / 1000;
  }

  /**
   * What the pack said beyond its code, on screen for a few seconds.
   *
   * A medicine strip's DataMatrix carries its batch and expiry. Showing them at the moment of
   * the scan is what turns "kaunsa batch bech diya" from a guess into something the person at
   * the counter actually saw — and it is free, because the symbol was read anyway.
   */
  function noteScan(product, scan) {
    // A scale sticker's "extras" are the sum it was printed from, and showing that sum is
    // the whole safety net: the shopkeeper is holding the packet, so "₹57.50 → 0.25 kg" is
    // checked against reality in the half-second it takes to read it. A rate that has
    // drifted apart between the kaanta and the app shows up here as a weight that is
    // visibly not the packet's, which is the only place it can ever be caught.
    const derived = scaleStickerQuantity(product, scan);
    const stickerNote =
      scan?.kind === 'scale' && derived
        ? scan.scale.price != null
          ? t('seller.scaleStickerPriceRead', {
              amount: money(scan.scale.price),
              qty: formatQty(derived, lang),
              unit: t(`units.${product?.unit || 'piece'}`),
            })
          : t('seller.scaleStickerWeightRead', {
              qty: formatQty(derived, lang),
              unit: t(`units.${product?.unit || 'piece'}`),
              amount: money(derived * (Number(product?.price) || 0)),
            })
        : '';
    const extras = [stickerNote, scanExtras(scan)].filter(Boolean).join(' · ');
    if (!extras) return;
    setLiveNotice(`${product.name} — ${extras}`);
    setTimeout(() => setLiveNotice((current) => (current === `${product.name} — ${extras}` ? '' : current)), 6000);
  }

  // What every tap/scan/Enter on a product actually calls. A product with no
  // modifierGroups goes straight into addToCart exactly as it always did; one that has
  // them opens the picker first, and addToCart only runs once that's confirmed.
  function blockExpiredProduct(product) {
    if (!isExpiredProduct(product)) return false;
    const message = t('seller.expiredCannotBill', { names: product.name });
    setErrorFix(null);
    setError(message);
    toast.error(message);
    return true;
  }

  function handleProductAdd(product, saleUnit, quantity, scan) {
    if (blockExpiredProduct(product)) return;
    if (product.modifierGroups?.length > 0) {
      setModifierPickFor({ product, saleUnit, quantity });
      return;
    }
    // A scale sticker carries its own quantity and nothing else can have asked for one —
    // it was scanned, not typed, so there is no "6*" prefix to respect. Falls back to the
    // caller's quantity when the sticker cannot be turned into one (a product with no
    // rate), which bills a packet as a single unit rather than refusing the sale.
    const asked = scaleStickerQuantity(product, scan) ?? quantity;
    addToCart(product, saleUnit, asked, undefined, scan);
    if (scan) noteScan(product, scan);
  }

  // Handles Enter in the unified search/scan box. A hardware scanner types the code and
  // fires Enter itself, so this always tries an exact barcode lookup first. If that 404s
  // while they were genuinely mid-typing a product name, the live name-filter below is
  // already showing (or not showing) the right feedback — only surface the lookup's error
  // when there's *also* no name match, so hitting Enter early while typing "chini" doesn't
  // flash a scary "barcode not found" banner on every keystroke.
  async function handleQuerySubmit(event) {
    event.preventDefault();
    // The highlighted result wins over a barcode lookup: if the cashier has walked the
    // arrow keys onto a row, Enter means "that one" — firing a network lookup for the
    // half-typed name instead would be the app arguing with what is on screen.
    // …except when the box holds something only a scanner types. A six-digit-plus run of
    // digits is a barcode, and a product whose *name* contains those digits must not
    // hijack the scan.
    //
    // A 2D scanner in keyboard mode types its WHOLE payload here and hits Enter the same
    // way — a GS1 string or a link, not digits — so anything the reader recognises as a
    // symbol counts as a scan too. Nobody types "(01)08901…" into a search box by hand.
    const code = query.trim();
    const scanned = parseScan(code);
    const isScan = scanned.kind === 'code' ? /^\d{6,}$/.test(scanned.code) : scanned.kind !== 'empty';
    const highlighted = isScan ? null : filteredProducts[activeResult];
    if (highlighted) {
      handleProductAdd(highlighted, undefined, parsedQuery.quantity);
      return;
    }
    if (!code) return;
    try {
      // The raw text goes to the server, not our parse of it: one reader (utils/scanCode.js)
      // runs there, so a scanner gun typing into this box and the camera below can never
      // resolve the same symbol two different ways.
      const data = await apiFetch(`/api/seller/products/lookup?code=${encodeURIComponent(code)}`);
      handleProductAdd(data.product, undefined, parsedQuery.quantity, data.scan);
      setError('');
    } catch (err) {
      if (filteredProducts.length === 0) {
        setError(err.message);
        // A scan that resolved to nothing has to sound different from a scan that landed,
        // or a counter working by ear bills ten items and hands over eleven.
        counterFeedback('error');
      }
    }
  }

  /**
   * Arrow keys through the results, without ever leaving the box a scanner types into.
   *
   * The results were mouse-only: a cashier typing "par" had to lift a hand off the
   * keyboard, find the tile and click it, on the one screen in the app where hands never
   * leave the keys. Down/Up move the highlight, Enter (handled by the form above) adds it.
   */
  function handleQueryKeyDown(event) {
    if (filteredProducts.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveResult((index) => (index + 1) % filteredProducts.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveResult((index) => (index <= 0 ? filteredProducts.length - 1 : index - 1));
    }
  }

  // Spoken input lands in the same box as typing and scanning. Interim words stream in so
  // the cashier can see it working; on the final phrase, if exactly one product matches,
  // it goes straight into the cart — with the spoken quantity if one was said ("do kilo
  // cheeni" → 2 × Cheeni). Anything ambiguous is left in the box as a normal search, so a
  // misheard word can never silently bill the wrong item.
  function handleVoiceResult({ transcript, isFinal, text, quantity }) {
    setQuery(isFinal ? text : transcript);
    if (!isFinal) return;

    const needle = (text || '').toLowerCase().trim();
    if (!needle) return;

    // Same prepared index the typed search uses — no second lowercase pass over the shelf.
    const matches = searchIndex.filter((entry) => entry.haystack.includes(needle)).map((entry) => entry.product);
    if (matches.length !== 1) return;

    // The spoken quantity is passed straight into addToCart. It used to be applied
    // afterwards with `updateQuantity(product._id, …)`, which silently did nothing: cart
    // lines are keyed `productId:unit`, never by product id alone, so "do kilo cheeni"
    // had been billing one kilo since loose selling landed.
    handleProductAdd(matches[0], undefined, quantity);
    setQuery('');
  }

  async function openScanner() {
    setScannerOpen(true);
    setTimeout(async () => {
      try {
        const scanner = await startBarcodeScanner({
          elementId: 'barcode-scanner-viewport',
          onDecode: async (decodedText) => {
            setScannerOpen(false);
            try {
              const data = await apiFetch(`/api/seller/products/lookup?code=${encodeURIComponent(decodedText)}`);
              handleProductAdd(data.product, undefined, undefined, data.scan);
            } catch (err) {
              setError(err.message);
            }
          },
        });
        window.__dukaanScanner = scanner;
      } catch (err) {
        setError(t('seller.cameraScanFailed', { reason: err?.message || String(err) }));
        setScannerOpen(false);
      }
    }, 50);
  }

  function closeScanner() {
    if (window.__dukaanScanner) {
      window.__dukaanScanner.stop().catch(() => {});
    }
    setScannerOpen(false);
  }

  // Keyed by lineId, not productId — the same medicine can legitimately be on the bill
  // twice, once by the strip and once by the tablet.
  function updateQuantity(lineId, quantity) {
    setCart((prev) => prev.map((item) => (item.lineId === lineId ? { ...item, quantity } : item)));
  }

  /**
   * "Packet" ⇄ "tablet" on one cart line.
   *
   * Switching resets the quantity to 1 rather than converting it. Converting reads as
   * clever and is wrong at a counter: a cashier who taps "tablet" on a line showing 2
   * packets meant "actually they want tablets", not "give them 30". One is the number
   * they'd have typed anyway, and it's the safe direction to be wrong in.
   */
  function setSaleUnit(lineId, saleUnit) {
    setCart((prev) => {
      const line = prev.find((item) => item.lineId === lineId);
      if (!line || !line.packSize || line.saleUnit === saleUnit) return prev;
      const loose = saleUnit === line.subUnit;
      const unit = loose ? line.subUnit : line.packUnit;
      const nextId = `${line.productId}:${unit}`;

      // The cart may already hold this medicine in the unit being switched TO — the
      // cashier added a strip and three tablets, then flipped the strip line. Two lines
      // with the same id would be an invisible duplicate, so the switched line is folded
      // into the one that's already there, adding the single unit a switch always means.
      const twin = prev.find((item) => item.lineId === nextId);
      if (twin) {
        return prev
          .filter((item) => item.lineId !== lineId)
          .map((item) => (item.lineId === nextId ? { ...item, quantity: item.quantity + 1 } : item));
      }

      return prev.map((item) =>
        item.lineId === lineId
          ? { ...item, lineId: nextId, saleUnit: unit, unit, price: loose ? item.loosePrice : item.packPrice, quantity: 1 }
          : item
      );
    });
  }

  /**
   * Teaching the app a pack size from the billing screen.
   *
   * Every product that existed before loose selling did — which for a chemist importing a
   * price list is all four thousand of them — has no pack size, so no switch appears and
   * "ek goli chahiye" is still impossible. Sending them to Inventory to open four thousand
   * forms is not an answer; the moment they actually need it is the moment a customer is
   * standing at the counter asking for one tablet.
   *
   * So it is set here, once, in two fields, and the line they are already billing turns
   * into a loose line straight away. The product is genuinely updated, so it never has to
   * be answered again.
   *
   * (State declared with the rest, up top — the keyboard handler's dependency list reads
   * it during render and a `const` down here would still be in its temporal dead zone.)
   */

  async function savePackSetup({ subUnit, subUnitsPerUnit }) {
    const target = packSetup;
    if (!target) return;
    const size = Number(subUnitsPerUnit);
    if (!subUnit || !Number.isFinite(size) || size <= 1) {
      setError(t('pack.incomplete'));
      return;
    }
    try {
      const { product } = await apiFetch(`/api/seller/products/${target.productId}`, {
        method: 'PATCH',
        body: JSON.stringify({ subUnit, subUnitsPerUnit: size }),
      });
      // Refresh the catalog copy first, so the search tiles and any other line of the same
      // product pick the pack up too rather than only the line that was being edited.
      setProducts((prev) => prev.map((p) => (p._id === product._id ? { ...p, ...product } : p)));
      const packSize = packSizeOf(product);
      setCart((prev) =>
        prev.map((item) =>
          item.productId !== product._id
            ? item
            : {
                ...item,
                packSize,
                packUnit: product.unit,
                subUnit: product.subUnit,
                packPrice: product.price,
                loosePrice: subUnitPriceOf(product),
              }
        )
      );
      setPackSetup(null);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  /**
   * How much of the shelf a cart line actually consumes, in the product's own stocking
   * unit. 3 tablets out of a 15-tablet strip is 0.2 packet — which is what the stock
   * check has to compare against, and mirrors what the server will deduct.
   */
  function stockQuantityOf(item) {
    return item.packSize && item.saleUnit === item.subUnit ? item.quantity / item.packSize : item.quantity;
  }

  function updateSerialNumber(lineId, serialNumber) {
    setCart((prev) => prev.map((item) => (item.lineId === lineId ? { ...item, serialNumber } : item)));
  }

  function removeFromCart(lineId) {
    setCart((prev) => prev.filter((item) => item.lineId !== lineId));
  }

  // A charge, not a thing: labour, repair, delivery/tempo bhaada, packing, service visit.
  // It gets a synthetic id so every cart operation already written (quantity, remove, the
  // review modal, the offline queue) keeps working untouched — the server recognises the
  // `svc:` prefix as "no product" and never touches stock for it.
  function addServiceLine(line) {
    const id = `svc:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    setCart((prev) => [
      ...prev,
      {
        lineId: id,
        productId: id,
        isService: true,
        name: line.name.trim(),
        unit: line.unit || 'service',
        price: Number(line.price),
        gstRate: Number(line.gstRate) || 0,
        quantity: Number(line.quantity) || 1,
      },
    ]);
  }

  // How many units of this product the shop currently has, per the last products load.
  // undefined means we don't know (product not in the loaded list) — then we don't block
  // and let the server be the source of truth.
  function availableStock(productId) {
    const p = products.find((x) => x._id === productId);
    if (!p) return undefined;
    // A dish is made from its ingredients; its own stock is a number nobody keeps, and
    // reading it turned every dish red as "stock kam hai". What the shelf can make is the
    // honest figure — and when the server did not send one, we do not know, so we do not
    // block (it checks every ingredient on the way in anyway).
    if (p.recipe?.length) return typeof p.servingsPossible === 'number' ? p.servingsPossible : undefined;
    // Batch-tracked stock may include expired lots. Only the unexpired portion is
    // sellable, matching the server's FEFO allocation rule.
    if (p.trackBatches && typeof p.sellableStock === 'number') return p.sellableStock;
    return typeof p.stock === 'number' ? p.stock : undefined;
  }

  function isExpiredCartItem(item) {
    if (item.isService) return false;
    const product = products.find((p) => p._id === item.productId);
    return isExpiredProduct(product);
  }

  function expiredCartItems() {
    return cart.filter(isExpiredCartItem);
  }

  // "Ye jaldi nikaal do" — the weeks *before* an item expires, which nothing in the app
  // said at the counter. Selling something already expired is refused by the server; this
  // is the softer nudge that gives a shopkeeper a chance to clear stock while it is still
  // worth something. The window is the shop's own setting, and zero switches it off.
  function expiryWarningFor(item) {
    if (item.isService || isExpiredCartItem(item)) return null;
    const days = Number(user?.billingSettings?.expiryWarningDays ?? 30);
    if (!days) return null;
    const product = products.find((p) => p._id === item.productId);
    // A batch-tracked product's real expiry lives on its lots, not on the product row —
    // the batch screen and the FEFO allocation already handle those.
    if (!product?.expiryDate || product.trackBatches) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysLeft = Math.ceil((new Date(product.expiryDate) - today) / 86400000);
    if (daysLeft < 0 || daysLeft > days) return null;
    return daysLeft === 0 ? t('seller.expiresToday') : t('seller.expiresInDays', { days: daysLeft });
  }

  function hasBatchTrackedCartItems() {
    return cart.some((item) => products.find((product) => product._id === item.productId)?.trackBatches);
  }

  function removeExpiredCartItems() {
    const ids = new Set(expiredCartItems().map((item) => item.lineId));
    setCart((prev) => prev.filter((item) => !ids.has(item.lineId)));
    setError('');
  }

  /**
   * Total shelf quantity the cart wants of each product, summed across its lines.
   *
   * Summing is the point: one medicine can now appear twice — 2 strips and 3 loose
   * tablets — and each line on its own can look affordable while the two together empty
   * the shelf. Checking them separately would wave the bill through and let the server
   * reject it halfway, after some of the stock had already moved.
   */
  const neededStock = useMemo(() => {
    const map = new Map();
    for (const item of cart) {
      // A menu item entered as a service still draws on its recipe's shelf.
      if (item.isService && !recipeOf(item.productId)) continue;
      const lines = recipeOf(item.productId);
      if (lines) {
        // A dish wants its INGREDIENTS, added into the same map: two dishes that both use
        // paneer, or a dish plus paneer sold loose, all draw on one shelf. Checking each
        // dish against its own "can make N" waved a cart through that the shelf could not
        // cover, and the server refused it after the cashier had already said the total.
        for (const line of lines) {
          const id = String(line.product?._id || line.product);
          map.set(id, (map.get(id) || 0) + (Number(line.quantity) || 0) * stockQuantityOf(item));
        }
        continue;
      }
      map.set(item.productId, (map.get(item.productId) || 0) + stockQuantityOf(item));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, products]);

  // The recipe lines of a dish — or of a menu item entered as a service — or null. Neither
  // ever blocks the bill (see stockShortages); the line just says what is short.
  function recipeOf(productId) {
    const p = products.find((x) => x._id === productId);
    return p && p.recipe?.length ? p.recipe : null;
  }

  // The first ingredient this dish line cannot be covered by, counting every other line
  // in the cart that draws on the same shelf. null when the shelf covers it, or when the
  // ingredient is not in the loaded list (then the server is the judge).
  function dishShortfall(item) {
    const lines = recipeOf(item.productId);
    if (!lines) return null;
    for (const line of lines) {
      const id = String(line.product?._id || line.product);
      const stock = availableStock(id);
      if (stock === undefined) continue;
      if ((neededStock.get(id) || 0) > stock + 0.000001) {
        const ingredient = products.find((x) => x._id === id);
        return { id, name: ingredient?.name || '', per: Number(line.quantity) || 0, stock };
      }
    }
    return null;
  }

  function isOverStock(item) {
    if (item.isService && !recipeOf(item.productId)) return false;
    if (recipeOf(item.productId)) return Boolean(dishShortfall(item));
    const stock = availableStock(item.productId);
    return stock !== undefined && (neededStock.get(item.productId) || 0) > stock;
  }

  /**
   * How much of this line the shelf can actually cover, in the unit the line is sold in.
   *
   * The shortfall was already known — the row turns red — but the number never was, so
   * "stock kam hai" left the cashier to open the product screen and work out what to type
   * instead. This is what lets the line say "sirf 3 bacha hai" and offer to become 3.
   *
   * Room left over, not raw stock: the same product can sit on two rows (2 strips and 4
   * loose tablets), and the other rows have already claimed part of the shelf.
   */
  function lineStockRoom(item) {
    if (item.isService && !recipeOf(item.productId)) return null;
    const short = dishShortfall(item);
    if (short) {
      // How many of THIS dish the short ingredient still allows once the other lines have
      // taken their share — the number the quantity box can be set to.
      const mine = short.per * stockQuantityOf(item);
      const left = Math.max(0, short.stock - ((neededStock.get(short.id) || 0) - mine));
      const room = short.per > 0 ? Math.floor(left / short.per + 1e-9) : 0;
      return { room, unit: item.unit, ingredient: short.name };
    }
    const stock = availableStock(item.productId);
    if (stock === undefined) return null;
    const claimedByOthers = (neededStock.get(item.productId) || 0) - stockQuantityOf(item);
    const roomInStockUnits = Math.max(0, stock - claimedByOthers);
    // Back into the unit this row is priced in, so the number offered is the number the
    // quantity box takes. A loose row counts in pieces; its room is packs × pack size.
    const sellingLoose = Boolean(item.packSize) && item.saleUnit === item.subUnit;
    const room = sellingLoose ? roomInStockUnits * item.packSize : roomInStockUnits;
    return {
      room: Math.floor(room * 1000) / 1000,
      unit: sellingLoose ? item.subUnit : item.unit,
    };
  }

  // Cart lines asking for more than we have in stock. Used to catch the problem inside
  // the review modal instead of after a rejected round-trip to the server.
  // Lines that must be fixed before billing. Empty when the shop has chosen to bill below
  // zero (Settings → "Let billing continue when stock shows zero"): the server lets those
  // through, and blocking here anyway made that setting do nothing at the counter. The
  // lines are still marked, so the cashier sees the count is off.
  //
  // A DISH never blocks either. Its ingredient counts are the least reliable numbers in a
  // kitchen (a new hotel has not entered its stock yet; yesterday's delivery is still on
  // paper), and the food is cooked by the time it is billed. The line still says which
  // ingredient reads short, and the bill reports what went below zero.
  function stockShortages() {
    if (user?.billingSettings?.allowNegativeStock) return [];
    return cart.filter((item) => !recipeOf(item.productId) && isOverStock(item));
  }

  async function clearCart() {
    if (cart.length > 0 && !(await confirm({ tone: 'warning', title: t('seller.clearCart'), body: t('seller.clearCartConfirm'), confirmLabel: t('seller.clearCart') }))) return;
    setCart([]);
    clearBillDraft();
    setActiveLine(-1);
  }

  /**
   * Ask the server what the schemes do to this cart, on every change.
   *
   * Debounced, because a cashier holding the "+" button would otherwise fire a request per
   * repeat. 250ms is below the threshold at which a counter notices a lag and well above
   * the keystroke rate. An empty cart short-circuits without a request at all, and a
   * failure is swallowed: a scheme preview that cannot load must never stop a sale — the
   * bill the server writes will still apply the offer correctly.
   */
  useEffect(() => {
    if (cart.length === 0) {
      setOfferPreview(null);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiFetch('/api/seller/offers/preview', {
        method: 'POST',
        signal: controller.signal,
        // silentUpgrade: this fires on every cart change to ask "does a scheme apply?" —
        // a shop with no schemes feature must just get no discount, not an upgrade sheet
        // interrupting the sale on every item they add. See the loyalty/settings probe
        // above this component for the same bug, and lib/api.js for the flag itself.
        silentUpgrade: true,
        body: JSON.stringify({
          customerId: customerId || undefined,
          items: cart.map((item) => ({
            key: item.lineId,
            productId: item.productId || undefined,
            quantity: item.quantity,
            saleUnit: item.saleUnit,
            discountPercent: item.discountPercent || undefined,
          })),
        }),
      })
        .then(setOfferPreview)
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [cart, customerId]);

  useEffect(() => {
    // Deliberately does NOT drop `loyaltyPreview` any more — the debounced effect further
    // down owns it, and re-asks the server whenever the bill's total moves. Clearing it
    // here left `couponCode` in state, still sent with the bill, while the payable on
    // screen had quietly stopped counting it.
    setLoyaltyError('');
    // Editing the cart (fixing an over-stock qty, removing an item) clears any stale
    // error banner so a fixed problem doesn't keep showing its old message.
    setError('');
    // A price the shopkeeper has just changed invalidates the server's below-cost verdict
    // too — otherwise the warning stays on screen after the thing it warned about is gone.
    setBelowCostPrompt(null);
  }, [customerId, couponCode, redeemPoints, cart, billDiscountPercent, billDiscountAmount]);

  /**
   * An empty counter is a fresh bill.
   *
   * Everything folded into "add to this bill" is attached to the sale, not to the till.
   * Taking the last line off used to leave the chip row still reading "abc (7507279182)",
   * a −₹40 discount and a half-typed prescription sitting over a bill with nothing on it —
   * and the next walk-in was one tap away from being billed onto abc's khata by a chip
   * nobody re-read.
   *
   * Keyed on `cart.length`, so it fires only on the transition INTO empty. Picking the
   * customer *before* the first item is scanned — "Ramesh aaya hai, khata pe likhna hai" —
   * is a real counter habit and survives untouched: the length never changed, so this
   * never ran.
   *
   * Deliberately left alone: the payment mode and the billed-by staff member, which are
   * counter settings that outlive one bill (see the `extras` note on the staff chip), and
   * the quotation link, which is a claim on a server-side document this screen does not
   * get to drop on its own.
   */
  useEffect(() => {
    if (cart.length > 0) return;
    setCustomerId('');
    setCouponCode('');
    setRedeemPoints('');
    setLoyaltyPreview(null);
    setLoyaltyError('');
    setBillDiscountPercent('');
    setBillDiscountAmount('');
    setPaidNow('');
    setPaidNowExact(false);
    setCashReceived('');
    setCashExact(false);
    setBelowCostPrompt(null);
    setOpenExtra(null);
    // The two object states get functional updaters: a fresh `{}` on every mount would
    // re-render the busiest screen in the app for nothing, where React bails out of the
    // primitives above on its own.
    setPrescription((p) => (p.doctorName || p.patientName || p.number ? { doctorName: '', patientName: '', number: '' } : p));
    setSplit((s) => (s.cash || s.upi || s.card || s.bank ? { cash: '', upi: '', card: '', bank: '' } : s));
  }, [cart.length]);

  // Every line total in this page goes through one function, and it rounds a loose line
  // the same way the server does (up, to the paisa). Multiplying inline — which is what
  // this page used to do everywhere — meant the cart could show ₹11.00 while the bill
  // that came back said ₹11.01, and the shopkeeper collected the wrong money.
  const lineGross = (item) =>
    lineTotalOf({ price: item.price, quantity: item.quantity, loose: Boolean(item.packSize) && item.saleUnit === item.subUnit });

  // What the shelf scheme took off this particular line, straight from the server's own
  // plan. Keyed by lineId and not by product, because the same product can legitimately
  // sit on two rows and only one of them may have earned the free unit.
  const offerByLine = useMemo(() => {
    const map = new Map();
    for (const hit of offerPreview?.lines || []) if (hit.key) map.set(hit.key, hit);
    return map;
  }, [offerPreview]);
  const offerDiscount = (item) => round2(offerByLine.get(item.lineId)?.discount || 0);

  // A discount typed on this line. Mirrors utils/billTotals.js applyLineDiscount exactly,
  // so the cart never shows a total the server then disagrees with.
  //
  // The scheme's rupees are ADDED to it, in the same order the server folds them in — the
  // cashier's discount first, then the offer making the free units free of what is left.
  // They have to be inside this number: everything downstream on this screen (the payable,
  // the cash-tendered change, the split-payment remainder) reads it, and a counter that
  // collects the pre-offer total has taken money the bill does not ask for.
  const lineDiscountManual = (item) => {
    const percent = Math.min(Math.max(Number(item.discountPercent) || 0, 0), 100);
    return percent > 0 ? round2((lineGross(item) * percent) / 100) : 0;
  };
  const lineDiscount = (item) => round2(Math.min(lineDiscountManual(item) + offerDiscount(item), lineGross(item)));
  const lineTotal = (item) => round2(lineGross(item) - lineDiscount(item));

  // What one unit of this line is actually going out at, after whatever discount is on it.
  // The cart used to print the list rate here even on a discounted line, so the one number
  // a shopkeeper reads back to the customer ("bees rupaye ka") was the wrong one.
  const effectiveRate = (item) => {
    const percent = Math.min(Math.max(Number(item.discountPercent) || 0, 0), 100);
    return percent > 0 ? (Number(item.price) || 0) * (1 - percent / 100) : Number(item.price) || 0;
  };

  const subtotal = round2(cart.reduce((sum, item) => sum + lineGross(item), 0));
  const itemDiscountTotal = round2(cart.reduce((sum, item) => sum + lineDiscount(item), 0));
  // Freebies the scheme will ADD to the bill, which are not in the cart the cashier is
  // editing. Net zero for an ordinary "free" one; a "second at half price" reward is the
  // case where this is not zero and the customer genuinely owes something for it.
  const offerFreeLines = offerPreview?.freeLines || [];
  const offerFreeLinesNet = round2(
    offerFreeLines.reduce((sum, line) => sum + (round2(line.price * line.quantity) - round2(line.value)), 0)
  );
  const offerDiscountTotal = round2(cart.reduce((sum, item) => sum + offerDiscount(item), 0));
  const afterItemDiscount = round2(subtotal - itemDiscountTotal + offerFreeLinesNet);

  // "1,240 ka 1,200 kar do" — the single most common thing a shopkeeper says to close a
  // sale, and until now the only way to express it was a coupon created in advance for a
  // discount decided in the moment. Percent wins over a typed amount when both are set,
  // the same precedence the server applies.
  const billDiscountValue = (() => {
    const percent = Math.min(Math.max(Number(billDiscountPercent) || 0, 0), 100);
    if (percent > 0) return round2((afterItemDiscount * percent) / 100);
    return Math.min(round2(Math.max(0, Number(billDiscountAmount) || 0)), afterItemDiscount);
  })();

  const total = round2(afterItemDiscount - billDiscountValue);
  // Only shops that have filled a GSTIN break tax out on their bills; an unregistered
  // kirana bills plain amounts. The saved receipt is gated the same way on the backend
  // (createBill), so this preview matches what actually prints.
  const gstRegistered = Boolean((user?.gstin || '').trim());
  const gstBreakdown = cart.reduce(
    (acc, item) => {
      const gross = lineTotal(item);
      const rate = item.gstRate || 0;
      const taxable = rate ? gross / (1 + rate / 100) : gross;
      acc.taxable += taxable;
      acc.gst += gross - taxable;
      return acc;
    },
    { taxable: 0, gst: 0 }
  );

  // What the customer actually has to hand over — after every discount, then rounded to
  // the whole rupee the shop and the customer will actually settle in. `roundOff` is kept
  // visible as its own line rather than folded silently into the total: a counter that
  // cannot see where 40 paise went does not trust the number above it.
  /**
   * The coupon and the redeemed points, taken off the CURRENT total rather than read as a
   * finished figure off the preview.
   *
   * Reading `loyaltyPreview.payableTotal` was reading an answer to a question that had
   * since changed. The preview is asked with the total as it stood when the shopkeeper
   * tapped Apply; then he says "aur pachaas kam kar do" and types a bill discount, and that
   * stored number no longer describes this bill. The effect below re-asks the server so the
   * rupee value of a percentage coupon keeps up, but the arithmetic must be right in the
   * gap too — so the discount is applied here, exactly the way computeBillTotals applies it
   * on the server: total, less the coupon, less the points, never below zero.
   *
   * What it used to do instead was drop the preview whenever the bill discount moved, while
   * `couponCode` stayed in state and was still sent with the bill. So the screen totalled
   * ₹950 on a bill the server then wrote at ₹750, and the counter collected the ₹950 and
   * gave change against it. On a split bill the same gap came out as the server refusing
   * the sale — "payments add up to more than the amount due" — with nothing on screen to
   * explain which number was wrong.
   */
  const loyaltyReduction = round2(
    (Number(loyaltyPreview?.couponDiscount) || 0) + (Number(loyaltyPreview?.pointsRedeemedValue) || 0)
  );
  const payableBeforeRounding = round2(Math.max(0, total - loyaltyReduction));
  const roundOffEnabled = user?.billingSettings?.roundOff !== false;
  const roundOff = roundOffEnabled && payableBeforeRounding > 0 ? round2(Math.round(payableBeforeRounding) - payableBeforeRounding) : 0;
  const payable = round2(payableBeforeRounding + roundOff);

  // What the customer saved against printed MRP on this cart — the line a receipt is read
  // for. Only products actually priced below their MRP contribute.
  const mrpSavings = round2(
    cart.reduce((sum, item) => {
      const product = item.isService ? null : products.find((p) => p._id === item.productId);
      if (!product?.mrp || product.mrp <= product.price) return sum;
      const packSize = packSizeOf(product);
      const loose = Boolean(item.packSize) && item.saleUnit === item.subUnit;
      const mrpPerSoldUnit = loose && packSize > 0 ? product.mrp / packSize : product.mrp;
      return sum + Math.max(0, (mrpPerSoldUnit - item.price) * item.quantity);
    }, 0)
  );

  // ── Cash drawer ─────────────────────────────────────────────────────────────────────
  // The last step of a cash sale, which the screen used to leave entirely to the
  // shopkeeper's head: they hand over 500, the bill is 347, and the app said nothing
  // about the 153 going back. Wrong change is real money lost, every day, both ways.
  const cashReceivedValue = round2(Number(cashReceived) || 0);
  const changeDue = round2(cashReceivedValue - payable);
  const tenderOptions = tenderSuggestions(payable);
  const partPayOptions = partPaySuggestions(payable);
  const halfPay = payable > 1 ? round2(Math.round(payable / 2)) : 0;

  /**
   * The counter's own scan-to-pay code, built here rather than asked for.
   *
   * The server already returns a `upiLink` — but only with the receipt, i.e. after the bill
   * is written, which is the wrong end of the conversation: the customer scans, pays, and
   * *then* the shopkeeper commits. So this is the same NPCI intent (`utils/upi.js`) assembled
   * from what the dashboard already holds, with the live `payable` in it — no request, and
   * nothing to go stale when the next packet is added to the cart.
   *
   * No `tn` note: the bill has no number yet, and several UPI apps rewrite that field anyway.
   */
  const counterUpiLink = useMemo(() => {
    if (!user?.upiId || !(payable > 0)) return null;
    const params = new URLSearchParams();
    params.set('pa', user.upiId);
    params.set('pn', (user.shopName || 'Shop').slice(0, 50));
    params.set('am', payable.toFixed(2));
    params.set('cu', 'INR');
    return `upi://pay?${params.toString()}`;
  }, [user?.upiId, user?.shopName, payable]);

  /**
   * "Exact" means *the bill*, not the number the bill happened to show when it was tapped.
   *
   * A counter does not finish the cart and then take the money — the customer says "ek
   * Maggi aur" after the amount has already been said out loud. Tapping Exact and then
   * adding a line used to leave the old figure sitting in the box: on cash that quietly
   * became wrong change, and on khata it was worse — the difference slid onto the
   * customer's tab with nobody told, because the field still looked deliberately filled.
   *
   * So Exact latches. While it is on, the amount tracks the payable through anything that
   * moves it — a line added or removed, a quantity, a bill discount, a coupon, points,
   * round-off — and the latch drops the moment a human types a figure of their own, taps a
   * note, or clears. An empty cart drops it too, so the next customer never inherits it.
   */
  useEffect(() => {
    if (!cashExact && !paidNowExact) return;
    if (!(payable > 0)) {
      if (cashExact) { setCashExact(false); setCashReceived(''); }
      if (paidNowExact) { setPaidNowExact(false); setPaidNow(''); }
      return;
    }
    const next = String(payable);
    if (cashExact) setCashReceived((cur) => (cur === next ? cur : next));
    if (paidNowExact) setPaidNow((cur) => (cur === next ? cur : next));
  }, [payable, cashExact, paidNowExact]);

  /**
   * Keep the coupon and points preview in step with the bill, the same way the offers
   * preview above keeps up with the cart.
   *
   * A coupon is not a fixed number of rupees: a percentage one, a `maxDiscount` cap and a
   * `minBillAmount` floor all depend on what the bill comes to, and the bill comes to
   * something different every time a line or a discount moves. The server is the only thing
   * that knows the answer — and it is also the thing that will REFUSE the bill if the
   * coupon has stopped qualifying (see createBill), so a stale preview meant the shopkeeper
   * found out at the moment he pressed Bill.
   *
   * Debounced and abortable for the same reason as the offers preview: this fires on every
   * keystroke in the discount box. A failure leaves the last good preview in place rather
   * than blanking the discount line — the bill the server writes applies the coupon either
   * way, and `loyaltyReduction` above is what keeps the screen honest meanwhile.
   */
  useEffect(() => {
    if (!customerId || (!couponCode && !redeemPoints) || !(total > 0)) {
      setLoyaltyPreview(null);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiFetch('/api/seller/loyalty/preview', {
        method: 'POST',
        signal: controller.signal,
        // Same reason as the offers probe: a shop without the feature must get no discount,
        // not an upgrade sheet thrown across the counter mid-sale.
        silentUpgrade: true,
        body: JSON.stringify({
          customerId,
          couponCode: couponCode || undefined,
          redeemPoints: redeemPoints ? Number(redeemPoints) : undefined,
          billAmount: total,
        }),
      })
        .then(setLoyaltyPreview)
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [customerId, couponCode, redeemPoints, total]);

  // Typing, tapping a note, or clearing is the shopkeeper saying a number themselves —
  // from then on the app must not move it under them. Every writer other than Exact and
  // the sync above goes through these, so no path can arm-and-forget.
  function enterCashReceived(value) {
    setCashExact(false);
    setCashReceived(value);
  }

  function enterPaidNow(value) {
    setPaidNowExact(false);
    setPaidNow(value);
  }

  // Exact reads as pressed while it is armed, so pressing it again has to un-press it —
  // and un-pressing a shortcut that filled the box means emptying the box.
  function toggleCashExact() {
    if (cashExact) return enterCashReceived('');
    setCashExact(true);
    setCashReceived(String(payable));
  }

  function togglePaidNowExact() {
    if (paidNowExact) return enterPaidNow('');
    setPaidNowExact(true);
    setPaidNow(String(payable));
  }

  // ── Who is standing at the counter ──────────────────────────────────────────────────
  // Picking a khata customer used to tell the shopkeeper nothing about them. What they
  // already owe and how much room is left on their limit is exactly the thing you need
  // *before* agreeing to put one more bill on the tab, not on the khata page afterwards.
  // A chemist records the prescriber on every bill if they want to; a scheduled medicine
  // makes it compulsory. `scheduledInCart` is what turns the block from optional to
  // required, and names the medicines so the counter knows which slip to ask for.
  const scheduledInCart = cart.filter((item) => item.drugSchedule === 'H1' || item.drugSchedule === 'X');
  const showPrescription = (user?.businessType === 'medical' || scheduledInCart.length > 0) && cart.length > 0;
  const prescriptionMissing =
    scheduledInCart.length > 0 && (!prescription.doctorName.trim() || !prescription.patientName.trim());
  const scheduledCount = scheduledInCart.length;

  // The moment a scheduled medicine is scanned, the register block opens itself — the one
  // thing on this screen that is the law rather than a preference.
  useEffect(() => {
    if (scheduledCount > 0) setOpenExtra('prescription');
  }, [scheduledCount]);

  /**
   * The two cases where a folded-away block is not optional, so the app opens it itself
   * instead of leaving the cashier to discover a rule they cannot see.
   *
   * Khata with nobody picked cannot be billed at all, and a Schedule H1/X medicine cannot
   * legally leave the shop without the prescriber on record. Both were previously enforced
   * by an error *after* the cashier pressed the button, which is the wrong end of the sale.
   * Neither re-opens itself once closed, because the dependency it watches has stopped
   * changing — a shopkeeper who folds it away has been told and decided.
   */
  useEffect(() => {
    if (cart.length > 0 && paymentMode === 'khata' && !customerId) setOpenExtra('customer');
  }, [cart.length, paymentMode, customerId]);

  /**
   * …and the step straight after it, which the screen used to leave the cashier to find.
   *
   * "Khata" asks two questions, in this order: kaun, then kitna diya. The picker answered
   * the first one in a fold-out panel low on the ticket, while the second appeared as a
   * box *above* it — so choosing Ramesh left the cursor nowhere, the panel still open over
   * the thing it had just produced, and the amount question off the top of the phone
   * screen. Most bills were then written with the advance silently left blank.
   *
   * Picking a name now folds the picker away, brings the amount card into view and puts
   * the cursor in it. Only on the *change* of customer, so a cashier who deliberately
   * scrolls back to the cart is not yanked forward again on every render.
   */
  // `null` until the first pass, so a draft that reloads mid-sale with a customer already
  // on it is recorded rather than acted on — nobody just chose that name, and a page that
  // opens with the keyboard up on a phone is a page that opens wrong.
  const askedFor = useRef(null);
  useEffect(() => {
    const firstPass = askedFor.current === null;
    if (paymentMode !== 'khata' || !customerId || cart.length === 0) {
      askedFor.current = '';
      return;
    }
    if (askedFor.current === customerId) return;
    askedFor.current = customerId;
    if (firstPass) return;
    setOpenExtra((open) => (open === 'customer' ? null : open));
    // The same jump every "Fix" button on this screen uses: the whole card is scrolled to
    // the middle of the checkout column — not just the input, which left the chips and the
    // khata line below the fold — then focused, selected and flashed.
    focusFix('#paidNow');
  }, [paymentMode, customerId, cart.length]);

  const selectedCustomer = customers.find((c) => c.id === customerId) || null;
  const khataPortion =
    paymentMode === 'khata' ? Math.max(0, round2(payable - (Number(paidNow) || 0))) : 0;
  // Money handed over beyond the bill is change, not an advance — the server caps the
  // advance at the bill, so anything above it has to go back across the counter.
  const paidNowChange =
    paymentMode === 'khata' ? Math.max(0, round2((Number(paidNow) || 0) - payable)) : 0;
  const creditLimit = Number(selectedCustomer?.creditLimit) || 0;
  const customerOwes = round2(Number(selectedCustomer?.balance) || 0);
  const projectedBalance = round2(customerOwes + khataPortion);
  // Only a bill that actually adds to the tab can "push them over" — on a cash sale to a
  // customer who is already past their limit, saying so here would be blaming this bill
  // for something it isn't doing. The headroom line already shows ₹0 left in that case.
  const overLimitBy = creditLimit > 0 && khataPortion > 0 ? round2(projectedBalance - creditLimit) : 0;

  function splitLines() {
    return Object.entries(split)
      .filter(([, amount]) => Number(amount) > 0)
      .map(([mode, amount]) => ({ mode, amount: Number(amount) }));
  }

  const splitEntered = splitLines().reduce((sum, line) => sum + line.amount, 0);
  const splitRemaining = Number((payable - splitEntered).toFixed(2));

  async function handlePreviewLoyalty() {
    if (!customerId || (!couponCode && !redeemPoints)) return;
    setLoyaltyError('');
    setPreviewing(true);
    try {
      const data = await apiFetch('/api/seller/loyalty/preview', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          couponCode: couponCode || undefined,
          redeemPoints: redeemPoints ? Number(redeemPoints) : undefined,
          billAmount: total,
        }),
      });
      setLoyaltyPreview(data);
    } catch (err) {
      setLoyaltyError(err.message);
    } finally {
      setPreviewing(false);
    }
  }

  function clearCartAfterBill() {
    setCart([]);
    // The draft's whole reason to exist has just been discharged. Cleared here as well as
    // by the debounced mirror below, so the window between "bill written" and "next tick"
    // cannot hand a reloaded page a cart that has already been sold.
    clearBillDraft();
    setActiveLine(-1);
    setOfferPreview(null);
    setCustomerId('');
    setCouponCode('');
    setRedeemPoints('');
    setLoyaltyPreview(null);
    setPaidNow('');
    setPaidNowMode('cash');
    // The next customer must not inherit the last one's standing "Exact".
    setPaidNowExact(false);
    setCashExact(false);
    setSplit({ cash: '', upi: '', card: '', bank: '' });
    setBillDiscountPercent('');
    setBillDiscountAmount('');
    setOpenExtra(null);
    setPriceEditLine(null);
    setResumedHoldId(null);
    setBelowCostPrompt(null);
    setCashReceived('');
    setPrescription({ doctorName: '', patientName: '', number: '' });
    // The quotation this cart came from has been dealt with — billed, revised, or parked.
    // Cleared last, so the stamping call in handleCreateBill has already read it.
    setEstimateLink(null);
  }

  /**
   * Adds a customer without leaving the bill.
   *
   * "Khata pe likh do" from someone who isn't in the book yet used to mean abandoning a
   * half-built cart, walking to Khata, adding them, and coming back to start over. Two
   * fields here, and the new customer is selected on this bill straight away.
   *
   * A clash on the phone number is not an error worth showing: the person is already in
   * the book, so they are simply selected — which is what the shopkeeper wanted anyway.
   */
  async function handleQuickAddCustomer(form) {
    try {
      const data = await apiFetch('/api/seller/khata/customers', {
        method: 'POST',
        body: JSON.stringify({ name: form.name.trim(), phone: form.phone.trim(), creditLimit: Number(form.creditLimit) || 0 }),
      });
      setCustomers((prev) => [data.customer, ...prev]);
      setCustomerId(data.customer.id);
      setNewCustomerOpen(false);
      setError('');
      return true;
    } catch (err) {
      const existing = err.data?.existingCustomer;
      if (err.status === 409 && existing) {
        setCustomers((prev) => (prev.some((c) => c.id === existing.id) ? prev : [existing, ...prev]));
        setCustomerId(existing.id);
        setNewCustomerOpen(false);
        setLiveNotice(t('seller.quickCustomerExists', { name: existing.name }));
        setTimeout(() => setLiveNotice(''), 6000);
        return true;
      }
      throw err;
    }
  }

  /**
   * Correcting the customer already on this bill, from the bill.
   *
   * A wrong phone number is discovered at exactly one moment — when the receipt is about
   * to be sent — and until now the only way to fix it was to abandon the cart, walk to
   * Khata, edit the row and come back. The number is the field this exists for; the name
   * and the credit limit come along because the same two-field form already draws them.
   *
   * The server refuses a number another record already holds (409) rather than silently
   * splitting one person's udhaar across two rows — that message names whose number it is
   * and is shown as-is inside the form, beside the field that caused it.
   */
  async function handleEditCustomer(form) {
    if (!editCustomer) return true;
    const data = await apiFetch(`/api/seller/khata/customers/${editCustomer.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: form.name.trim(),
        phone: form.phone.trim(),
        // Sent as a number even when the box is empty: an omitted limit would leave the old
        // one in place, and a shopkeeper who cleared the field meant to clear the limit.
        creditLimit: Number(form.creditLimit) || 0,
      }),
    });
    setCustomers((prev) => prev.map((c) => (c.id === data.customer.id ? data.customer : c)));
    setEditCustomer(null);
    setError('');
    setLiveNotice(t('seller.customerUpdated', { name: data.customer.name }));
    setTimeout(() => setLiveNotice(''), 5000);
    return true;
  }

  /**
   * "Isko nahi lena" — the customer comes off the bill, the bill stays.
   *
   * The picker's blank row could always do this, but a dash in a dropdown is not an
   * affordance anybody finds while a customer is standing at the counter. Everything that
   * only makes sense for a named customer leaves with them: a coupon, points being
   * redeemed and the discount those were previewing all belong to the person, not the cart.
   *
   * Khata is the one mode that cannot survive it, so the bill falls back to cash rather
   * than sitting on "udhaar" with nobody to book it against.
   */
  function clearBillCustomer() {
    setCustomerId('');
    setCouponCode('');
    setRedeemPoints('');
    setLoyaltyPreview(null);
    setLoyaltyError('');
    if (paymentMode === 'khata') setPaymentMode('cash');
    setError('');
  }

  // ── Parked carts ────────────────────────────────────────────────────────────────────
  function loadHeldBills() {
    apiFetch('/api/seller/bills/held')
      .then((data) => setHeldBills(data.held || []))
      .catch(() => {});
  }

  async function handleHoldBill() {
    if (cart.length === 0) return;
    try {
      await apiFetch('/api/seller/bills/held', {
        method: 'POST',
        body: JSON.stringify({
          // The cart goes up as-is. It is re-priced and re-validated from scratch when it
          // is resumed and billed, so this is a note-to-self, not a contract.
          items: cart.map((item) => ({ ...item, lineTotal: lineTotal(item) })),
          label: holdLabel,
          customerId: customerId || undefined,
          counter,
        }),
      });
      setHoldLabel('');
      clearCartAfterBill();
      loadHeldBills();
      setHoldPanelOpen(true);
    } catch (err) {
      setError(err.message);
    }
  }

  async function resumeHeldBill(held) {
    if (cart.length > 0 && !(await confirm({ tone: 'warning', title: t('seller.holdReplaceTitle'), body: t('seller.holdReplaceConfirm'), confirmLabel: t('seller.holdReplaceTitle') }))) return;
    setCart(held.items || []);
    setCustomerId(held.customer || '');
    setResumedHoldId(held._id);
    setHoldPanelOpen(false);
    setError('');
  }

  async function discardHeldBill(id) {
    if (!(await confirm({ tone: 'danger', title: t('common.delete'), body: t('seller.holdDiscardConfirm'), confirmLabel: t('common.delete') }))) return;
    try {
      await apiFetch(`/api/seller/bills/held/${id}`, { method: 'DELETE' });
      loadHeldBills();
    } catch (err) {
      setError(err.message);
    }
  }

  // A percentage discount typed against one cart line.
  function updateLineDiscount(lineId, percent) {
    const clean = percent === '' ? '' : Math.min(Math.max(Number(percent) || 0, 0), 100);
    setCart((prev) => prev.map((item) => (item.lineId === lineId ? { ...item, discountPercent: clean } : item)));
  }

  /**
   * "Ye 40 rupaye ka de do."
   *
   * A shopkeeper settles a line by naming the rate, not the percentage — nobody at a
   * counter says "give me 11.11% off". Until now the cart only took a percent, so an
   * agreed rate had to be converted in the head, mid-sale, with a customer waiting.
   *
   * A goods line is priced by the server from the catalog and the only reduction it will
   * accept is a discount percent (deliberately — the browser must not be able to name its
   * own price), so a typed rate is stored as the discount that produces it. The arithmetic
   * is the same either way; only the question changes. A charge line carries its own price
   * in the payload, so there the rate is simply the rate.
   *
   * Above list price is not a discount, it is a price change, and it belongs in Inventory:
   * the field refuses it rather than quietly billing the old rate.
   */
  function updateLineRate(lineId, rate) {
    setCart((prev) =>
      prev.map((item) => {
        if (item.lineId !== lineId) return item;
        const asked = Number(rate);
        if (rate === '' || !Number.isFinite(asked) || asked < 0) return item;
        if (item.isService) return { ...item, price: asked };
        const base = Number(item.price) || 0;
        if (!base) return item;
        const percent = Math.min(Math.max(((base - asked) / base) * 100, 0), 100);
        return { ...item, discountPercent: percent > 0 ? Number(percent.toFixed(4)) : '' };
      })
    );
  }

  /**
   * Rebuilds a cart out of a bill that was already rung up.
   *
   * "Wahi wala phir se de do" is most of a kirana's repeat business — the same six things,
   * every week — and re-finding all six by hand was the whole point of the search box the
   * shopkeeper was trying to avoid. Prices and stock are deliberately NOT taken from the
   * old bill: it seeds the cart, the catalog prices it, so a rate that has moved since is
   * today's rate and not last month's.
   */
  async function repeatBill(bill) {
    if (cart.length > 0 && !(await confirm({ tone: 'warning', title: t('seller.holdReplaceTitle'), body: t('seller.holdReplaceConfirm'), confirmLabel: t('seller.holdReplaceTitle') }))) return;
    const lines = [];
    const missing = [];
    for (const item of bill.items || []) {
      if (!item.product) {
        // A charge line (labour, delivery) has no shelf behind it — copied as it stood.
        lines.push({
          lineId: `svc:${Date.now()}:${lines.length}`,
          productId: `svc:${Date.now()}:${lines.length}`,
          isService: true,
          name: item.name,
          unit: item.unit || 'service',
          price: Number(item.price) || 0,
          gstRate: Number(item.gstRate) || 0,
          quantity: Number(item.quantity) || 1,
        });
        continue;
      }
      const product = products.find((p) => p._id === String(item.product));
      if (!product) {
        missing.push(item.name);
        continue;
      }
      const packSize = packSizeOf(product);
      // The old line may have been sold loose. `stockUnit` on the bill names the shelf
      // unit, so anything else is a sub-unit line and comes back as one.
      const loose = Boolean(packSize) && item.unit && item.unit === product.subUnit;
      const unit = loose ? product.subUnit : product.unit;
      lines.push({
        lineId: `${product._id}:${unit}`,
        productId: product._id,
        isService: product.kind === 'service',
        name: product.name,
        unit,
        price: loose ? subUnitPriceOf(product) : product.price,
        gstRate: product.gstRate || 0,
        quantity: Number(item.quantity) || 1,
        packSize,
        packUnit: product.unit,
        subUnit: packSize ? product.subUnit : undefined,
        packPrice: product.price,
        loosePrice: packSize ? subUnitPriceOf(product) : undefined,
        saleUnit: unit,
        warrantyMonths: product.warrantyMonths || undefined,
        drugSchedule: product.drugSchedule || undefined,
        serialNumber: '',
      });
    }
    if (lines.length === 0) {
      setError(t('seller.repeatBillNothing'));
      return;
    }
    setCart(lines);
    // Only if that customer is still in the khata list this device has loaded — pointing
    // the picker at an id it has no row for would leave it looking blank and unset.
    const billCustomerId = bill.customer ? String(bill.customer._id || bill.customer) : '';
    setCustomerId(customers.some((c) => c.id === billCustomerId) ? billCustomerId : '');
    setResumedHoldId(null);
    setError('');
    setLiveNotice(
      missing.length > 0
        ? t('seller.repeatBillPartial', { count: lines.length, names: missing.join(', ') })
        : t('seller.repeatBillDone', { count: lines.length, number: bill.billNumber })
    );
    setTimeout(() => setLiveNotice(''), 7000);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Queues a bill locally when there's no connection (or the request just failed to
  // reach the server) — shows an unconfirmed "pending sync" receipt and optimistically
  // decrements local stock so the seller can keep billing without waiting.
  function queueOfflineBill(payload) {
    enqueueBill(payload);
    setOfflineCount(queueCount());

    const items = payload.items
      .map((it) => {
        // A service line carries its own name and price in the payload; a goods line is
        // just a product id, so the name and price come from the catalog in memory.
        if (!it.productId) {
          return { name: it.name, unit: it.unit, quantity: it.quantity, lineTotal: it.price * it.quantity };
        }
        const product = products.find((p) => p._id === it.productId);
        if (!product) return null;
        // A loose line prices off the sub-unit, exactly as the server will when this
        // queued bill finally syncs — otherwise the pending receipt would quote the whole
        // strip for one tablet and the shopkeeper would collect the wrong money.
        const loose = it.saleUnit && it.saleUnit === product.subUnit;
        const price = loose ? subUnitPriceOf(product) : product.price;
        return {
          name: product.name,
          unit: loose ? product.subUnit : product.unit,
          quantity: it.quantity,
          lineTotal: lineTotalOf({ price, quantity: it.quantity, loose }),
        };
      })
      .filter(Boolean);
    const offlineTotal = items.reduce((sum, i) => sum + i.lineTotal, 0);

    setReceipt({ offline: true, items, total: offlineTotal, paymentMode: payload.paymentMode });
    setBillOutcome(null);
    setReceiptText('');
    setReceiptUpiLink(null);
    setReceiptBillLink(null);
    setShareLinks(null);
    resetCapture();
    setProducts((prev) =>
      prev.map((p) => {
        // Summed over the payload, not matched once: the same product can be on the bill
        // twice, by the pack and by the piece. Stock is counted in packs, so a loose line
        // takes a fraction off the local copy.
        const packSize = packSizeOf(p);
        const off = payload.items.reduce((sum, it) => {
          if (!it.productId || it.productId !== p._id) return sum;
          const loose = it.saleUnit && it.saleUnit === p.subUnit && packSize;
          return sum + (loose ? it.quantity / packSize : it.quantity);
        }, 0);
        if (!(off > 0)) return p;
        // A dish's shelf is its ingredients, so it is the plates-possible figure that drops.
        // Other dishes sharing those ingredients catch up on the next products load.
        if (p.recipe?.length) {
          return typeof p.servingsPossible === 'number'
            ? { ...p, servingsPossible: Math.max(0, Math.floor(p.servingsPossible - off)) }
            : p;
        }
        return { ...p, stock: Math.max(0, p.stock - off) };
      })
    );
    setLastTender(
      payload.paymentMode === 'cash' && cashReceivedValue > 0
        ? { received: cashReceivedValue, change: changeDue }
        : null
    );
    rememberQuickPicks(cart);
    clearCartAfterBill();
  }

  /**
   * The cart, in the shape the server accepts.
   *
   * One builder for both documents this screen can produce — a bill and a quotation — so a
   * quoted rate and the bill that follows it can never be built from two different readings
   * of the same cart.
   *
   * A service line carries its own name and price; a goods line is just a pointer, so the
   * server always re-reads the price from the catalog and can't be talked into a different
   * one by the browser.
   */
  function cartItemsPayload() {
    return cart.map((item) =>
      item.isService
        ? {
            name: item.name,
            unit: item.unit,
            price: item.price,
            quantity: item.quantity,
            gstRate: item.gstRate,
            // A discount typed on a charge line used to be left out of the payload
            // entirely, so the cart showed one total and the bill was written at another
            // — the server has always accepted it (see readDiscount in billController).
            discountPercent: Number(item.discountPercent) || undefined,
          }
        : {
            productId: item.productId,
            quantity: item.quantity,
            // Which unit the quantity is counted in. Sent only when the line was
            // actually switched to loose, so an ordinary bill goes up exactly as
            // before — and the server re-derives the loose price itself, the same way
            // it already refuses to take the browser's word for a pack price.
            saleUnit: item.packSize && item.saleUnit === item.subUnit ? item.subUnit : undefined,
            serialNumber: item.serialNumber || undefined,
            discountPercent: Number(item.discountPercent) || undefined,
            // Re-resolved against the catalog by expandModifierLines — item.price above
            // already includes the delta for the cart's own running total, but the bill
            // itself is priced from this selection, never from that number.
            modifiers: item.modifiers,
          }
    );
  }

  /* ── Quotations ─────────────────────────────────────────────────────────────────────────
   *
   * "Bhaav bata do, sochke bataunga." The same cart, saved as a document that moves no stock
   * and counts as no sale — see backend/models/Estimate.js for why that had to stop being a
   * reprinted bill. Three outcomes now come off one cart: bill it, quote it, or revise a
   * quote it was loaded from.
   */
  function setQuoteField(field, value) {
    setQuoteForm((form) => ({ ...form, [field]: value }));
    setQuoteFieldErrors((errors) => ({ ...errors, [field]: undefined }));
  }
  function checkQuoteField(field) {
    const problems = validateQuoteForm(quoteForm, Boolean(customerId));
    setQuoteFieldErrors((errors) => ({ ...errors, [field]: problems[field] }));
  }
  function quoteFieldError(field) {
    return quoteFieldErrors[field] ? <p className="field-error" id={`quote-error-${field}`} role="alert">{t(quoteFieldErrors[field])}</p> : null;
  }

  function openQuoteModal() {
    if (cart.length === 0) return;
    setError('');
    // A quote is worth nothing without a date it stops holding, and nobody types one into an
    // empty box — so it opens at a week out, which is what most trades say out loud.
    setQuoteForm((current) => ({
      ...current,
      validityMode: current.validityMode || 'days',
      validDays: current.validDays || '7',
    }));
    setQuoteFieldErrors({});
    setQuoteOpen(true);
  }

  async function handleSaveQuote(event) {
    event?.preventDefault?.();
    if (cart.length === 0) return;
    /**
     * Deliberately NOT queued offline like a bill is.
     *
     * A bill can wait in the offline queue because it is a record of something that already
     * happened — money changed hands. A quotation is the opposite: it is a *number the
     * customer is about to be told*, priced by the server off the live catalog, and a queued
     * quote would either hand over a rate the shop cannot see yet or one worked out in the
     * browser. Better to say so than to promise a number nobody has agreed to.
     */
    if (!isOnline) {
      setError(t('seller.quoteOfflineHint'));
      return;
    }
    const quoteProblems = validateQuoteForm(quoteForm, Boolean(customerId));
    setQuoteFieldErrors(quoteProblems);
    if (Object.keys(quoteProblems).length) {
      const ids = { contactName: 'quote-name', contactPhone: 'quote-phone', validDays: 'quote-valid-days', validUntil: 'quote-valid', notes: 'quote-notes' };
      requestAnimationFrame(() => document.getElementById(ids[Object.keys(quoteProblems)[0]])?.focus());
      return;
    }
    setQuoteSaving(true);
    setError('');
    try {
      const editingId = estimateLink?.mode === 'edit' ? estimateLink.id : null;
      const data = await apiFetch(editingId ? `/api/seller/estimates/${editingId}` : '/api/seller/estimates', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify({
          items: cartItemsPayload(),
          customerId: customerId || undefined,
          // Only meaningful for somebody who is NOT in the khata — which is most people a
          // quotation goes to. Ignored server-side when a customer is selected.
          contactName: customerId ? undefined : quoteForm.contactName.trim() || undefined,
          contactPhone: customerId ? undefined : quoteForm.contactPhone.trim() || undefined,
          validityMode: quoteForm.validityMode,
          validDays: quoteForm.validityMode === 'days' ? Number(quoteForm.validDays) : undefined,
          validUntil: quoteForm.validityMode === 'date' ? quoteForm.validUntil || undefined : undefined,
          notes: quoteForm.notes.trim() || undefined,
          billDiscountPercent: Number(billDiscountPercent) || undefined,
          billDiscount:
            !Number(billDiscountPercent) && Number(billDiscountAmount) ? Number(billDiscountAmount) : undefined,
        }),
      });
      setQuoteSaved({
        _id: data.estimate._id,
        number: data.estimate.number,
        total: data.estimate.payableTotal ?? data.estimate.total,
        revised: Boolean(editingId),
      });
      setQuoteOpen(false);
      setQuoteForm({ contactName: '', contactPhone: '', validityMode: 'days', validDays: '7', validUntil: '', notes: '' });
      // The cart has become a document. Cleared like a billed one so the next customer does
      // not walk up to somebody else's quotation still sitting on the counter.
      clearCartAfterBill();
    } catch (err) {
      const fields = { contactName: 'seller.quoteNameError', contactPhone: 'seller.quotePhoneError', validDays: 'seller.quoteValidDaysError', validUntil: 'seller.quoteDateError', notes: 'seller.quoteNotesError' };
      if (fields[err.data?.field]) setQuoteFieldErrors({ [err.data.field]: fields[err.data.field] });
      else setError(err.message);
    } finally {
      setQuoteSaving(false);
    }
  }

  async function handleQuoteShare() {
    if (!quoteSaved) return;
    try {
      const data = await apiFetch(`/api/seller/estimates/${quoteSaved._id}/share`);
      if (!data.whatsappLink && !data.whatsappAuto) {
        setError(t('seller.noCustomerPhone'));
        return;
      }
      setWaSheet({
        title: t('wa.sendEstimate'),
        to: { name: quoteForm.contactName || quoteSaved.contactName, phone: quoteSaved.contactPhone },
        message: data.text,
        link: data.whatsappLink,
        auto: data.whatsappAuto,
        appLink: data.appLink,
        endpoint: `/api/seller/estimates/${quoteSaved._id}/whatsapp`,
      });
    } catch (err) {
      setError(err.message);
    }
  }

  /**
   * Put the cashier's eye — and the caret — on the control that fixes the problem.
   *
   * Scroll it into view, focus whatever inside it can be typed into or pressed, and flash
   * its outline for a moment so the eye finds it without reading. The flash is what makes
   * this work on the checkout column: the field is often already on screen, so a silent
   * focus jump looks like nothing happened at all.
   *
   * Two frames of delay because the caller usually opens a chip panel in the same tick,
   * and the element being aimed at does not exist until React has committed that render.
   */
  function focusFix(selector) {
    if (typeof window === 'undefined') return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.querySelector(selector);
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const focusable = el.matches('input, select, textarea, button')
          ? el
          : el.querySelector('input, select, textarea, button');
        if (focusable) {
          focusable.focus({ preventScroll: true });
          if (typeof focusable.select === 'function' && focusable.tagName === 'INPUT') {
            // A wrong amount is replaced far more often than it is edited, so the value
            // comes up selected — one keystroke overwrites it.
            try { focusable.select(); } catch { /* number inputs on some browsers */ }
          }
        }
        /**
         * Flash the box, not the input.
         *
         * Partly because a ring around the whole group is what the eye actually catches,
         * and partly because `.field input:focus` already owns a box-shadow ring at a
         * higher specificity than any single class — a flash painted onto the input we
         * just focused would be the one thing on screen that never showed up.
         */
        const box =
          el.closest('.field, .cash-tender, .split-panel, .paid-now, .pos-extra-panel, .customer-picker, .prescription-block__fields') || el;
        // Restart the animation if this box is already mid-flash, which happens when the
        // shopkeeper taps "Fix" a second time because the first jump was missed.
        box.classList.remove('fix-flash');
        void box.offsetWidth;
        box.classList.add('fix-flash');
        window.setTimeout(() => box.classList.remove('fix-flash'), 1800);
      })
    );
  }

  /**
   * The four things a fix is ever allowed to do, in the order they have to happen:
   * leave the review modal (the field is behind it), open the block that holds the field,
   * run anything bespoke, and then aim at the field itself.
   */
  function runFix(fix) {
    if (!fix) return;
    if (fix.closeConfirm !== false) setConfirmOpen(false);
    if (fix.extra) setOpenExtra(fix.extra);
    if (typeof fix.run === 'function') fix.run();
    if (fix.focus) focusFix(fix.focus);
  }

  /**
   * Raise a problem and walk the counter to it in the same breath.
   *
   * The banner still says what is wrong and keeps its "Fix" button — a cashier who looked
   * away needs a way back — but the first jump is automatic, because the complaint from
   * the shop floor was precisely that pressing "Create bill" appeared to do nothing while
   * a sentence they had not looked at yet explained why.
   */
  function blockWith(text, fix) {
    setError(text, fix);
    runFix(fix);
  }

  /**
   * Every way this screen can refuse a bill, paired with the control that answers it.
   *
   * Kept in one place rather than written at each `setError` so the label a shopkeeper
   * reads on the "Fix" button and the field it lands on can never drift apart — and so the
   * list itself is readable as the answer to "what can go wrong at this counter".
   */
  const billFixes = {
    customer: { label: t('seller.fixPickCustomer'), extra: 'customer', focus: '#customer' },
    prescription: { label: t('seller.fixPrescription'), extra: 'prescription', focus: '#prescriptionDoctor' },
    split: { label: t('seller.fixSplit'), focus: '#split-cash' },
    // These two stay in the review modal on purpose: the problem is a row of the bill, and
    // the modal is the one place that can filter the cart down to just those rows.
    shortages: {
      label: t('seller.fixShortages'),
      closeConfirm: false,
      run: () => {
        setConfirmFilter('');
        setOnlyShortages(true);
        setConfirmOpen(true);
      },
    },
    expired: {
      label: t('seller.fixExpired'),
      closeConfirm: false,
      run: () => {
        setConfirmFilter('');
        setOnlyShortages(false);
        setConfirmOpen(true);
      },
    },
  };

  // Step 1 of billing: validate, then open the review modal instead of creating straight
  // away. This is the "sach mein billing karni hai?" safety check the counter asked for —
  // and doubles as the last-second edit surface when a customer says "yeh hata do" while
  // the shopkeeper is already at the total. The actual POST lives in handleCreateBill.
  function requestCreateBill() {
    setError('');
    if (cart.length === 0) return;
    if (paymentMode === 'khata' && !customerId) {
      blockWith(t('seller.selectKhataCustomer'), billFixes.customer);
      return;
    }
    // The two field-shaped refusals, checked here as well as in handleCreateBill. Both
    // were only caught after the review modal had been opened and confirmed, so fixing a
    // missing prescriber cost the counter two presses and a dialog that closed itself.
    if (prescriptionMissing) {
      blockWith(t('seller.prescriptionRequiredShort'), billFixes.prescription);
      return;
    }
    if (paymentMode === 'split' && Math.abs(splitEntered - payable) > 0.01) {
      blockWith(
        t('seller.splitMismatch', { entered: splitEntered.toFixed(2), due: payable.toFixed(2) }),
        billFixes.split
      );
      return;
    }
    // Shop can turn the confirm step off from Settings for one-tap billing on a busy
    // counter; then "Create bill" goes straight through — UNLESS a line is over stock,
    // in which case we always open the review so they can see and fix the flagged row.
    if (user?.confirmBeforeBill === false && stockShortages().length === 0 && expiredCartItems().length === 0) {
      handleCreateBill();
      return;
    }
    setConfirmFilter('');
    setOnlyShortages(false);
    setConfirmOpen(true);
  }

  async function handleCreateBill({ confirmBelowCost = false } = {}) {
    setError('');
    if (cart.length === 0) return;
    if (paymentMode === 'khata' && !customerId) {
      blockWith(t('seller.selectKhataCustomer'), billFixes.customer);
      return;
    }
    // A scheduled medicine without a prescriber on record is refused by the server anyway
    // (PRESCRIPTION_REQUIRED); catching it here means the counter is told while the
    // customer is still at the till rather than after a rejected round-trip.
    if (prescriptionMissing) {
      // Was `setConfirmOpen(true)`: the review modal was thrown up over the very field the
      // message was asking the counter to fill in. The prescription box is in the checkout
      // column, so the modal has to get out of the way and the caret has to land in it.
      blockWith(t('seller.prescriptionRequiredShort'), billFixes.prescription);
      return;
    }
    // Catch over-stock lines before hitting the server. Keep the review modal open (or
    // open it) so the shopkeeper lands right on the flagged rows and can fix them.
    const shortages = stockShortages();
    const expired = expiredCartItems();
    if (expired.length > 0) {
      blockWith(t('seller.expiredMustRemove', { count: expired.length }), billFixes.expired);
      return;
    }
    if (shortages.length > 0) {
      // Jump straight to the flagged row(s) instead of leaving the shopkeeper to scroll
      // and hunt through a long bill for whichever line the error is actually about.
      blockWith(t('seller.stockShortError', { name: shortages[0].name }), billFixes.shortages);
      return;
    }

    if (paymentMode === 'split') {
      if (Math.abs(splitEntered - payable) > 0.01) {
        blockWith(
          t('seller.splitMismatch', { entered: splitEntered.toFixed(2), due: payable.toFixed(2) }),
          billFixes.split
        );
        return;
      }
    }

    const payload = {
      items: cartItemsPayload(),
      paymentMode,
      payments: paymentMode === 'split' ? splitLines() : undefined,
      customerId: customerId || undefined,
      staffId: billStaffId || undefined,
      counter,
      couponCode: customerId && couponCode ? couponCode : undefined,
      redeemPoints: customerId && redeemPoints ? Number(redeemPoints) : undefined,
      paidNow: paymentMode === 'khata' && paidNow ? Number(paidNow) : undefined,
      paidNowMode: paymentMode === 'khata' && paidNow ? paidNowMode : undefined,
      billDiscountPercent: Number(billDiscountPercent) || undefined,
      billDiscount: !Number(billDiscountPercent) && Number(billDiscountAmount) ? Number(billDiscountAmount) : undefined,
      // Generated here rather than server-side so a retry — from the offline queue, from a
      // dropped response, from an impatient second tap — is recognised as the same bill
      // instead of writing a second one and taking the stock off twice.
      clientBillId: newClientBillId(),
      // Set only after the shopkeeper has seen the below-cost warning and chosen to go
      // ahead anyway; clearing near-expiry stock at a loss is a real thing shops do.
      confirmBelowCost: confirmBelowCost || undefined,
      // Clears the parked cart this bill came from, once the bill actually exists.
      heldBillId: resumedHoldId || undefined,
      // Only sent when the counter actually filled it in — an empty block must not
      // write a blank prescription onto every ordinary bill.
      prescription: prescription.doctorName.trim() ? prescription : undefined,
    };

    if (!isOnline) {
      // Batch expiry is validated against the live lots on the server. Do not create a
      // misleading pending receipt while offline: the lot could have crossed its expiry
      // date or been sold from another counter since this device last synced.
      if (hasBatchTrackedCartItems()) {
        setError(t('seller.batchNeedsOnline'));
        setConfirmOpen(true);
        return;
      }
      queueOfflineBill(payload);
      setConfirmOpen(false);
      return;
    }

    setSubmitting(true);
    try {
      const data = await apiFetch('/api/seller/bills', { method: 'POST', body: JSON.stringify(payload) });
      setReceipt(data.bill);
      counterFeedback('done');
      /**
       * The quotation this cart came from just became a sale.
       *
       * Fired after the bill exists and deliberately not awaited: the bill is written, the
       * customer is at the counter, and a slow or failed stamp on a *quotation* must never
       * hold up the receipt. The endpoint is idempotent, so the worst case of a lost
       * response is a quote that still reads "accepted" — a wrong label on a document
       * nobody's money depends on, which is the right thing to risk here.
       */
      if (estimateLink?.mode === 'convert' && estimateLink.id) {
        apiFetch(`/api/seller/estimates/${estimateLink.id}/convert`, {
          method: 'POST',
          body: JSON.stringify({ billId: data.bill._id }),
        }).catch(() => {});
      }
      // Margin made on this bill, lines sold below cost, stock driven negative — the three
      // things a shopkeeper would otherwise only discover at month end, said at the moment
      // they can still do something about them.
      setBillOutcome(
        data.profit !== undefined || data.belowCost || data.negativeStock
          ? {
              profit: data.profit,
              // Whether that margin is worth stating — see the render below.
              profitCoverage: data.profitCoverage,
              belowCost: data.belowCost,
              negativeStock: data.negativeStock,
            }
          : null
      );
      setBelowCostPrompt(null);
      setShareLinks(null);
    resetCapture();
      setReceiptUpiLink(null);
      setReceiptBillLink(null);
      // The change is owed after the bill exists, so it has to outlive the cart that was
      // cleared to make it. Captured before clearCartAfterBill blanks the tender field.
      setLastTender(
        paymentMode === 'cash' && cashReceivedValue > 0 ? { received: cashReceivedValue, change: changeDue } : null
      );
      rememberQuickPicks(cart);
      apiFetch(`/api/seller/bills/${data.bill._id}/receipt-text`)
        .then((r) => {
          setReceiptText(r.text);
          setReceiptUpiLink(r.upiLink || null);
          setReceiptBillLink(r.billLink || null);
          autoPrintReceipt(r.text);
        })
        .catch(() => autoPrintReceipt(''));
      clearCartAfterBill();
      setConfirmOpen(false);
      // A today-scoped reload recounts the day for us; while the panel is parked on a
      // wider window it cannot, so the header's counter is nudged by hand.
      if (!isDefaultBillView) setDailyBillCount((count) => count + 1);
      refreshBills();
      apiFetch('/api/seller/products').then((d) => setProducts(d.products)).catch(() => {});
    } catch (err) {
      if (err instanceof TypeError) {
        setIsOnline(false);
        queueOfflineBill(payload);
        setConfirmOpen(false);
      } else if (err.code === 'BELOW_COST') {
        // Not a dead end and not a silent override: the counter is shown exactly which
        // lines lose money and by how much, and decides.
        setBelowCostPrompt({ message: err.message, lines: err.lines || [] });
        setConfirmOpen(true);
      } else {
        // e.g. "Insufficient stock" if another counter sold the last unit between our
        // stale product load and this submit. Leave the modal open with the message so
        // they can drop the quantity and try again — never a dead-end banner.
        setError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function resetCapture() {
    setCapturePhone('');
    setCaptureName('');
    setCapturedName('');
    setCaptureError('');
  }

  /**
   * Saves the number onto the bill that is on screen.
   *
   * Nothing about the sale moves — no points, no balance, no total. The bill simply stops
   * being anonymous, which is what puts the customer on the shop's own list and puts the
   * receipt into their storefront history. The share links are re-fetched straight after,
   * so the WhatsApp button that was dead a moment ago now has somewhere to send the bill.
   */
  async function handleCaptureNumber(event) {
    event.preventDefault();
    if (!receipt?._id) return;
    setCaptureError('');
    setCapturing(true);
    try {
      const data = await apiFetch(`/api/seller/bills/${receipt._id}/customer`, {
        method: 'PATCH',
        body: JSON.stringify({ phone: capturePhone.trim(), name: captureName.trim() || undefined }),
      });
      setCapturedName(data.customer?.name || capturePhone.trim());
      setCapturePhone('');
      setCaptureName('');
      // The bill now names somebody, so the receipt on screen should say so too — otherwise
      // the next thing the cashier does (share, print) reads the stale one.
      setReceipt((current) => (current ? { ...current, customer: data.customer } : current));
      // Just the refetch, not the sheet: the cashier typed a number to save it, and having
      // a dialog open itself on top of the receipt they were reading is not what they asked
      // for. The green button is right there when they do want it.
      loadShareLinks();
    } catch (err) {
      setCaptureError(err.message);
    } finally {
      setCapturing(false);
    }
  }

  /**
   * Fetches the share payload without opening anything.
   *
   * Split out because two callers want two different things from the same request: the
   * "share" button wants the sheet, and the capture form — which has just put a phone
   * number on an anonymous bill — only wants the panel below it to stop saying there is
   * nobody to send to.
   */
  async function loadShareLinks() {
    if (!receipt) return null;
    try {
      const data = await apiFetch(`/api/seller/bills/${receipt._id}/share`);
      setShareLinks(data);
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }

  async function handleShare() {
    const data = await loadShareLinks();
    if (!data) return;
    setWaSheet({
      title: t('wa.sendBill'),
      to: { name: receipt.customer?.name || capturedName, phone: receipt.customer?.phone },
      message: data.smsText,
      link: data.whatsappLink,
      auto: data.whatsappAuto,
      appLink: data.appLink,
      endpoint: `/api/seller/bills/${receipt._id}/whatsapp`,
    });
  }

  /**
   * Copies the customer's own link to this bill — for a chat that is not WhatsApp, a
   * WhatsApp Business account on another phone, or an email the cashier is typing.
   * Usually already in hand from the receipt text; fetched (and minted) if not.
   */
  async function handleCopyBillLink() {
    if (!receipt?._id) return;
    try {
      const url = receiptBillLink || (await apiFetch(`/api/seller/bills/${receipt._id}/link`)).url;
      if (!url) return;
      setReceiptBillLink(url);
      await navigator.clipboard.writeText(url);
      toast.success(t('seller.billLinkCopied'));
    } catch (err) {
      toast.error(err?.status ? err.message : t('seller.billLinkCopyFailed'));
    }
  }

  /**
   * Straight to the counter printer when one is set up (Settings → Printers), otherwise —
   * or if that fails — the Print screen, where the body class makes the stylesheet show
   * only the portalled thermal receipt.
   */
  function handlePrint() {
    return printSlip({
      shop: user,
      role: 'receipt',
      selector: '.thermal-receipt',
      bodyClass: 'printing-receipt',
      fallbackText: receiptText,
      ready: qrSlotsReady,
      onFallback: (message) => toast.info(message),
      t,
    });
  }

  /**
   * "Print the bill as soon as it is saved" — only ever to a direct printer. Opening the
   * Print screen on its own after every bill would be a dialog in the cashier's face.
   * Called once the receipt's links have landed, so the QR on the slip is the real one.
   */
  function autoPrintReceipt(text) {
    if (!getPrinterSettings().autoPrint || !getRolePrinter('receipt')) return;
    setTimeout(() => {
      printSlip({
        shop: user,
        role: 'receipt',
        selector: '.thermal-receipt',
        bodyClass: 'printing-receipt',
        fallbackText: text,
        ready: qrSlotsReady,
        directOnly: true,
        onFallback: (message) => toast.error(message),
        t,
      });
    }, 150);
  }

  // The kitchen's copy of a counter bill: names, quantities, no prices. The bill number
  // doubles as the KOT/token number, so the counter and the kitchen call out one number.
  function handlePrintKot() {
    if (!receipt || receipt.offline) return;
    flushSync(() => setKotSlip({
      kot: {
        number: receipt.billNumber,
        sentAt: receipt.createdAt,
        items: (receipt.items || []).map((item) => ({ name: item.name, quantity: item.quantity })),
      },
      order: { tableName: t('seller.kotCounter') },
    }));
    requestAnimationFrame(() => {
      printSlip({
        shop: user,
        role: 'kot',
        selector: '.kot-ticket',
        bodyClass: 'printing-kot',
        onFallback: (message) => toast.info(message),
        t,
      });
    });
  }

  /**
   * Sends one return and reports back to the dialog.
   *
   * Resolves `{ ok }` rather than swallowing the outcome, because the dialog stays open on
   * a failure and has to say why — the page's error banner sits behind the overlay, where
   * the shopkeeper cannot read it.
   */
  async function handleReturn(billId, item, lineIndex, quantity, reason, refundMode, chargeKeptFreebies = false) {
    try {
      const data = await apiFetch(`/api/seller/bills/${billId}/return`, {
        method: 'POST',
        // lineIndex is what the server matches on — a charge line has no product id, and
        // two of them can share a name. productId rides along for older servers.
        body: JSON.stringify({
          items: [{ productId: item.product, lineIndex, quantity }],
          reason,
          refundMode,
          chargeKeptFreebies: chargeKeptFreebies || undefined,
        }),
      });
      // The refund is the number the shopkeeper has to physically hand over, and on a
      // discounted bill it is *not* the printed line total — so it is said out loud rather
      // than left to be worked out from the ledger afterwards.
      const refund = data.refund;
      if (refund) {
        setLiveNotice(
          // Returning an item on a khata bill refunds to the khata, and the server says so
          // with mode 'khata' — a value expenses.mode has never had. The `||` here was no
          // safety net either: translate() returns the key path itself when it misses, and
          // a non-empty string is truthy.
          t('seller.refundDone', {
            amount: refund.amount.toFixed(2),
            mode: billModeLabel(refund.mode),
          }) +
            // Said out loud, because the refund is short of the printed line total and the
            // customer will ask why. Better from the cashier's mouth than from the ledger.
            (refund.freebieCharge ? ` (free item ₹${refund.freebieCharge.toFixed(2)} kaata)` : '')
        );
      }
      refreshBills();
      setReturnBillId(null);
      return { ok: true };
    } catch (err) {
      /**
       * The customer is walking out with a freebie they no longer qualify for.
       *
       * "Shampoo wapas kar rahe ho to brush bhi do, ya uske paise do" — the sentence a
       * shopkeeper says at their own counter, so the app asks it the same way rather than
       * either refusing the return outright or quietly eating the loss. Confirming
       * re-sends the same return with the freebie's price deducted from the refund.
       */
      if (err.code === 'OFFER_FREEBIE_KEPT') {
        // The server wrote this sentence — it names the freebie and the money — so it is
        // shown as the body rather than being re-written here.
        const keepIt = await confirm({
          tone: 'warning',
          title: t('seller.freebieKeptTitle'),
          body: err.message,
          confirmLabel: t('seller.freebieKeptConfirm'),
        });
        if (keepIt) {
          return handleReturn(billId, item, lineIndex, quantity, reason, refundMode, true);
        }
        // Backed out of the freebie question — the dialog stays open with nothing to
        // explain, because the shopkeeper just answered it themselves.
        return { ok: false };
      }
      setError(err.message);
      return { ok: false, message: err.message };
    }
  }

  /**
   * The name of a bill's payment mode, in the shop's own language.
   *
   * Named off the same five keys the payment-mode toggle above uses, so a bill in the
   * history says exactly the word the cashier tapped when they made it. Not expenses.mode:
   * that list has no `khata` — a shop's own expense is never bought on credit from itself —
   * so a khata bill rendered the literal string "expenses.mode.khata" on screen, which is
   * what translate() returns for a key it cannot find.
   */
  function billModeLabel(mode) {
    const labels = {
      cash: t('seller.cash'),
      upi: t('seller.upi'),
      card: t('seller.card'),
      khata: t('nav.khata'),
      split: t('seller.splitPayment'),
      // Never a bill's headline mode, but one leg of a split can land in the bank — and the
      // register's mode breakdown has to name it or that money reads as missing.
      bank: t('expenses.mode.bank'),
    };
    return labels[mode] || mode;
  }

  async function handleCancelBill(bill) {
    // The popup says the money: what comes off today's sales and every report, and that the
    // bill stays on the list struck through with the canceller's name — never just gone.
    const answer = await confirm({
      tone: 'danger',
      title: t('seller.cancelBillTitle'), cancelLabel: t('common.goBack'),
      body: `${t('seller.cancelBillReasonPrompt', { number: bill.billNumber })} ${t('seller.cancelBillMoneyNote', {
        amount: (bill.payableTotal ?? bill.total ?? 0).toFixed(2),
      })}`,
      input: { label: t('seller.cancelBillReasonLabel'), placeholder: t('seller.cancelBillReasonPlaceholder'), required: true },
      confirmLabel: t('seller.cancelBillTitle'),
    });
    const reason = answer ? answer.value : null;
    if (!reason || !reason.trim()) return;
    try {
      await apiFetch(`/api/seller/bills/${bill._id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      setLiveNotice(t('seller.cancelBillDone', { number: bill.billNumber }));
      refreshBills();
      apiFetch('/api/seller/products').then((d) => setProducts(d.products)).catch(() => {});
    } catch (err) {
      setError(err.message);
    }
  }

  /**
   * The optional half of a bill, as a row of chips.
   *
   * Everything here used to be permanently open in the checkout column. Ordered by how
   * often a counter actually reaches for it, each one carries its own current value so a
   * folded block can never quietly hold something the shopkeeper has forgotten about — a
   * chip reading "Ramesh · ₹1,200 udhaar" or "−₹40" says more than the open form did.
   */
  const extras = [
    {
      id: 'customer',
      label: t('seller.extraCustomer'),
      icon: UsersIcon,
      summary: selectedCustomer ? selectedCustomer.name : '',
      // Khata is not a discount you can skip — there is no bill at all without a name.
      // Only once there is a bill, though: an empty counter still carrying the last sale's
      // khata mode was marking the chip red for a customer nobody is serving yet.
      required: cart.length > 0 && paymentMode === 'khata' && !customerId,
    },
    {
      id: 'discount',
      label: t('seller.extraDiscount'),
      icon: TagIcon,
      summary: billDiscountValue > 0 ? `−₹${billDiscountValue.toFixed(2)}` : '',
    },
    showPrescription && {
      id: 'prescription',
      label: t('seller.prescriptionTitle'),
      icon: ClipboardIcon,
      summary: prescription.doctorName.trim() ? `Dr. ${prescription.doctorName.trim()}` : '',
      required: prescriptionMissing,
    },
    showStaffPicker &&
      staffList.length > 0 && {
        id: 'staff',
        label: t('seller.extraStaff'),
        icon: StarIcon,
        summary: staffList.find((s) => s.id === billStaffId)?.name || '',
      },
    loyaltyEnabled &&
      customerId && {
        id: 'loyalty',
        label: t('seller.extraLoyalty'),
        icon: ZapIcon,
        summary: loyaltyPreview
          ? `−₹${(loyaltyPreview.couponDiscount + loyaltyPreview.pointsRedeemedValue).toFixed(2)}`
          : couponCode || '',
      },
  ].filter(Boolean);

  return (
    <>
      {/* `pos-page-header` buys the cart its height back — see the compaction block in
          globals.css. A title on a screen nobody reads as a page does not need a page
          title's worth of room. */}
      <div className="content-header pos-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1>{t('seller.billingTitle')}</h1>
          <p style={{ margin: 0 }}>
            {t('seller.billingSubtitle')} ·{' '}
            <strong style={{ color: 'var(--brand-light)' }}>{t(dailyBillCount === 1 ? 'seller.billsTodayOne' : 'seller.billsToday', { count: dailyBillCount })}</strong>
          </p>
        </div>
        {/* The counter name is set once when a shop first opens a till and then never
            again — it does not deserve a labelled form field permanently occupying the
            header of the busiest screen in the app. It reads as a chip and becomes an
            input only when someone actually means to change it. */}
        {counterEditing ? (
          <div className="field counter-chip__field" style={{ marginBottom: 0 }}>
            <label htmlFor="counter">{t('seller.staffCounter')}</label>
            <input
              id="counter"
              value={counter}
              autoFocus
              onChange={(e) => handleCounterChange(e.target.value)}
              onBlur={() => setCounterEditing(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') setCounterEditing(false);
              }}
            />
          </div>
        ) : (
          <button type="button" className="counter-chip" onClick={() => setCounterEditing(true)} data-tip={t('seller.counterChange')}>
            <CounterIcon size={14} />
            <span>{counter}</span>
            <EditIcon size={12} />
          </button>
        )}
      </div>

      {/* A problem with a fix is drawn beside the button that raised it — in the checkout
          ticket's foot, where the cashier's eye already is — not up here above the fold of
          a screen they are not looking at. This slot keeps the ones with nowhere to send
          anybody: a failed share, a camera that would not open, a server message. */}
      {error && !errorFix && <ProblemNote text={error} />}
      {liveNotice && <div className="info-banner">{liveNotice}</div>}
      {!isOnline && <div className="error-banner">{t('seller.offlineBanner')}</div>}
      {isOnline && offlineCount > 0 && (
        <div className="info-banner">{t('seller.syncingBanner', { count: offlineCount })}</div>
      )}
      {offlineCount > 0 && getQueue().some((entry) => entry.error) && (
        <div className="panel">
          <h2>{t('seller.offlineQueueErrorsTitle')}</h2>
          {getQueue()
            .filter((entry) => entry.error)
            .map((entry) => (
              <div key={entry.localId} className="error-banner" style={{ marginBottom: '0.5rem' }}>
                <p style={{ margin: 0 }}>
                  {entry.payload.items.length} item(s) · {entry.payload.paymentMode} — {entry.error}
                </p>
                <div className="row-actions" style={{ marginTop: '0.4rem' }}>
                  <button className="btn btn-secondary btn-small" onClick={() => syncOfflineQueue()}>{t('seller.retry')}</button>
                  {entry.errorCode === 'CUSTOMER_NOT_FOUND' && entry.payload.paymentMode !== 'khata' && (
                    <button className="btn btn-secondary btn-small" onClick={() => rebillQueueEntryAsWalkIn(entry)}>
                      {t('seller.rebillAsWalkIn')}
                    </button>
                  )}
                  <button
                    className="btn btn-danger btn-small"
                    onClick={() => {
                      removeFromQueue(entry.localId);
                      setOfflineCount(queueCount());
                    }}
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* The cart this device was holding when it was last closed. Offered, never restored
          on its own — see lib/billDraft.js. */}
      {draftOffer && cart.length === 0 && (
        <div className="draft-recover">
          <div className="draft-recover__text">
            <UndoIcon size={16} />
            <span>
              {t('seller.cartDraftFound', {
                count: draftOffer.cart.length,
                amount: draftOffer.cart
                  .reduce((sum, line) => sum + lineTotal(line), 0)
                  .toFixed(2),
              })}
            </span>
          </div>
          <div className="row-actions">
            <button type="button" className="btn btn-primary btn-small btn-inline" onClick={restoreDraft}>
              {t('seller.cartDraftRestore')}
            </button>
            <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={dismissDraft}>
              {t('seller.cartDraftDiscard')}
            </button>
          </div>
        </div>
      )}

      {/* The counter, sized to the screen it is standing on. `pos-fit` is what turns the
          two panes into a terminal that never scrolls — the class is always written and the
          1101px media query decides whether it means anything, so there is one source of
          truth for the breakpoint. See the measurement effect for --pos-top. */}
      <div className="pos-layout pos-fit" ref={posLayoutRef}>
        <div className="pos-main">
          <div className="panel pos-search-panel">
            <form onSubmit={handleQuerySubmit} className="pos-search-bar">
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="query">{t('seller.searchOrScan')}</label>
                {/* The one control this whole screen is built around, and it used to be
                    drawn as an ordinary form input — the same box as a pincode field on a
                    settings page. On the fitted layout the label is hidden (the placeholder
                    says the same thing), so the icon is what names it at a glance and gives
                    the box a left edge to aim at. */}
                <span className="pos-search-bar__icon" aria-hidden="true">
                  <SearchIcon size={18} />
                </span>
                <input
                  id="query"
                  ref={queryInputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleQueryKeyDown}
                  placeholder={t('seller.searchOrScanHint')}
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={filteredProducts.length > 0}
                  aria-controls="pos-results"
                />
              </div>
              <VoiceSearchButton onResult={handleVoiceResult} />
              <button type="button" className="icon-btn" data-tip={t('seller.scanWithCamera')} onClick={openScanner}>
                <BarcodeIcon size={17} />
              </button>
              {/* The shortcut list used to be a permanent line of small grey text under the
                  box, which is where a tip goes to be read once and then never again. Behind
                  a "?" it costs nothing and can afford to say all of it. */}
              <button
                type="button"
                className={`icon-btn${shortcutsOpen ? ' active' : ''}`}
                data-tip={t('seller.shortcutsTitle')}
                aria-expanded={shortcutsOpen}
                onClick={() => setShortcutsOpen((open) => !open)}
              >
                <InfoIcon size={17} />
              </button>
            </form>

            {shortcutsOpen && (
              <div className="pos-shortcuts">
                <div className="pos-shortcuts__head">
                  <ZapIcon size={13} />
                  <strong>{t('seller.shortcutsTitle')}</strong>
                  <button type="button" className="link-btn" onClick={() => setShortcutsOpen(false)}>
                    {t('seller.quickPicksHide')}
                  </button>
                </div>
                <ul>
                  <li><kbd>/</kbd><kbd>F2</kbd><span>{t('seller.shortcutFocus')}</span></li>
                  <li><kbd>↑</kbd><kbd>↓</kbd><span>{t('seller.shortcutMove')}</span></li>
                  <li><kbd>Enter</kbd><span>{t('seller.shortcutAdd')}</span></li>
                  <li><kbd>3*</kbd><span>{t('seller.shortcutQty')}</span></li>
                  <li><kbd>Ctrl</kbd><kbd>Enter</kbd><span>{t('seller.shortcutBill')}</span></li>
                  <li><kbd>Esc</kbd><span>{t('seller.shortcutClear')}</span></li>
                </ul>
                {/* Two groups, because the two halves have genuinely different rules and
                    saying so is the difference between a list that teaches and a list that
                    misleads: the line keys need nothing focused (they type characters), the
                    function row works wherever the cursor is. */}
                <div className="pos-shortcuts__label">{t('seller.shortcutsCartGroup')}</div>
                <ul>
                  <li><kbd>↑</kbd><kbd>↓</kbd><span>{t('seller.shortcutLine')}</span></li>
                  <li><kbd>+</kbd><kbd>−</kbd><span>{t('seller.shortcutLineQty')}</span></li>
                  <li><kbd>Del</kbd><span>{t('seller.shortcutLineDrop')}</span></li>
                  <li><kbd>Enter</kbd><span>{t('seller.shortcutLineRate')}</span></li>
                </ul>
                <div className="pos-shortcuts__label">{t('seller.shortcutsFnGroup')}</div>
                <ul>
                  <li><kbd>F3</kbd><span>{t('seller.holdBill')}</span></li>
                  <li><kbd>F4</kbd><span>{t('seller.extraCustomer')}</span></li>
                  <li><kbd>F6</kbd><span>{t('seller.shortcutMode')}</span></li>
                  <li><kbd>F8</kbd><span>{t('seller.addCharge')}</span></li>
                  <li><kbd>F9</kbd><span>{t('seller.billDiscount')}</span></li>
                  <li><kbd>F1</kbd><span>{t('seller.shortcutHelp')}</span></li>
                </ul>
                {/* Sound lives here rather than in Settings because the only person who
                    ever wants it off is the one standing at this counter, and they want it
                    off now — not after finding a page two menus away. */}
                <button
                  type="button"
                  className={`pos-sound-toggle${soundOn ? ' on' : ''}`}
                  role="switch"
                  aria-checked={soundOn}
                  onClick={toggleSound}
                >
                  <span className="pos-sound-toggle__dot" aria-hidden="true" />
                  {soundOn ? t('seller.counterSoundOn') : t('seller.counterSoundOff')}
                </button>
              </div>
            )}

            {/* "6*parle" — the quantity is echoed back before anything is added, because a
                stray asterisk silently multiplying an order by 60 is not a mistake anyone
                should find out about from the printed bill. */}
            {parsedQuery.quantity > 0 && filteredProducts.length > 0 && (
              <p className="pos-qty-hint">{t('seller.qtyPrefixActive', { quantity: parsedQuery.quantity })}</p>
            )}

            {filteredProducts.length > 0 ? (
              <div className="pos-product-results" id="pos-results" role="listbox">
                {filteredProducts.map((p, index) => (
                  <ProductTile
                    key={p._id}
                    product={p}
                    onAdd={handleProductAdd}
                    quantity={parsedQuery.quantity}
                    active={index === activeResult}
                    onHover={() => setActiveResult(index)}
                    pinned={quickPicks.pins.includes(p._id)}
                    onTogglePin={toggleQuickPin}
                    t={t}
                  />
                ))}
              </div>
            ) : parsedQuery.term ? (
              // Typing a name the shop does not stock used to produce silence — no list,
              // no message, nothing to tell the cashier whether they had mistyped or the
              // product genuinely isn't in the catalog yet.
              <div className="pos-no-match">
                <span>{t('seller.noProductMatch', { query: parsedQuery.term })}</span>
                {canEditProducts && (
                  <Link href="/seller/products" className="link-btn">
                    <PlusIcon size={17} /> {t('seller.addThisProduct')}
                  </Link>
                )}
              </div>
            ) : !posFit && quickPicks.hidden ? (
              // Switched off for good on this device, but never a dead end — one small
              // link is all that is left of it.
              <button type="button" className="link-btn pos-quick-restore" onClick={() => setQuickPicksHidden(false)}>
                {t('seller.quickPicksShow')}
              </button>
            ) : quickPickProducts.length > 0 ? (
              // The panel is no longer blank before anything is typed — but it costs one
              // line, not half the fold. See QUICK_PICK_KEY for why this is a strip.
              <div className="pos-quick">
                <div className="pos-quick-head">
                  <ZapIcon size={13} />
                  <strong data-tip={t('seller.quickPicksHint')}>{t('seller.quickPicks')}</strong>
                  <button type="button" className="link-btn" onClick={() => setQuickPicksHidden(true)}>
                    {t('seller.quickPicksHide')}
                  </button>
                </div>
                <div className="pos-quick-rail">
                  {quickPickProducts.map((p) => (
                    <span className="quick-chip" key={p._id}>
                      <button type="button" className="quick-chip__add" onClick={() => handleProductAdd(p)}>
                        <span className="quick-chip__name">{p.name}</span>
                        <strong>₹{p.price}</strong>
                      </button>
                      <button
                        type="button"
                        className="quick-chip__drop"
                        data-tip={t('seller.quickPickRemove')}
                        onClick={() => forgetQuickPick(p._id)}
                      >
                        <XIcon size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="panel pos-cart-panel">
            <div className="section-title has-actions">
              <div className="section-title__label">
                <div className="icon-badge icon-brand"><ReceiptIcon size={16} /></div>
                <h2>
                  {t('seller.cart')}
                  {cart.length > 0 && (
                    <span style={{ marginLeft: '0.6rem', fontSize: 'var(--fs-base)', color: 'var(--text-muted)', fontWeight: 400 }}>
                      ({cart.length} {cart.length === 1 ? 'item' : 'items'})
                    </span>
                  )}
                </h2>
              </div>
              <div className="row-actions">
                {/* Anything on the bill that isn't stock: labour, repair, delivery,
                    packing. Sits next to Clear so it's reachable at any point in the sale,
                    not buried behind the product search. */}
                {/* A repair counter bills a charge far more often than it bills a product,
                    so on those trades this is the primary action rather than a secondary
                    one. Same button either way — only the weight changes. */}
                <button
                  type="button"
                  className={`btn btn-small btn-inline ${biz.chargesFirst ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => {
                    setServiceForm(blankCharge());
                    setServiceOpen(true);
                  }}
                >
                  <PlusIcon size={15} /> {t('seller.addCharge')}
                </button>
                {cart.length > 0 && (
                  <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={handleHoldBill}>
                    <ClockIcon size={15} /> {t('seller.holdBill')}
                  </button>
                )}
                {/* The same cart, given as a rate instead of sold. Sits beside Hold because
                    both are "don't bill this yet", and this is the one a wholesale, hardware
                    or furniture counter reaches for several times a day. */}
                {cart.length > 0 && !quotesHidden && (
                  <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={openQuoteModal}>
                    <ClipboardIcon size={15} />{' '}
                    {estimateLink?.mode === 'edit' ? t('seller.quoteUpdate') : t('seller.quoteCreate')}
                  </button>
                )}
                {heldBills.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-small btn-inline"
                    onClick={() => setHoldPanelOpen((open) => !open)}
                  >
                    {t('seller.heldBills')} <span className="count-pill">{heldBills.length}</span>
                  </button>
                )}
                {cart.length > 0 && (
                  <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={clearCart}>
                    <TrashIcon size={15} /> {t('seller.clearCart')}
                  </button>
                )}
              </div>
            </div>

            {/* Where this cart came from, when it came off a quotation. Without it the
                counter has no way of knowing that billing this will also close EST/…/0007,
                or that "Quotation" will revise that document instead of issuing a new one. */}
            {estimateLink && (
              <div className="info-banner" style={{ marginBottom: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <span>
                  {estimateLink.mode === 'edit'
                    ? t('seller.quoteEditingBanner', { number: estimateLink.number })
                    : t('seller.quoteConvertBanner', { number: estimateLink.number })}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-inline"
                  onClick={() => setEstimateLink(null)}
                >
                  {t('seller.quoteUnlink')}
                </button>
              </div>
            )}

            {/* Parked carts. The customer went back for one more thing, or forgot their
                wallet, and the queue behind them cannot stop. Server-side, so the other
                counter can pick up what this one parked. */}
            {holdPanelOpen && heldBills.length > 0 && (
              <div className="held-bills">
                {heldBills.map((held) => (
                  <div className="held-bill" key={held._id}>
                    <button type="button" className="held-bill-main" onClick={() => resumeHeldBill(held)}>
                      <strong>{held.label}</strong>
                      <span>
                        {held.itemCount} {held.itemCount === 1 ? t('seller.item') : t('seller.itemsInline')} · {money(held.estimatedTotal)}
                        {held.customerName ? ` · ${held.customerName}` : ''}
                      </span>
                      <em>{new Date(held.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</em>
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      data-tip={t('seller.holdDiscard')}
                      onClick={() => discardHeldBill(held._id)}
                    >
                      <TrashIcon size={17} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {cart.length === 0 ? (
              <div className="empty-state-rich compact">
                <div className="empty-icon"><ReceiptIcon size={22} /></div>
                <p>{t('seller.emptyCart')}</p>
              </div>
            ) : (
              /**
               * The cart is a line list, not a table.
               *
               * It was a `.data-table` with a 420px floor and a separate `.record-cards`
               * copy for phones, and that was wrong twice over. A table gives every line
               * the same five columns whether it needs them or not, so the moment one
               * cell grew — a two-word product name, a pack switch, a discount box — the
               * row outgrew the pos-main column and the whole panel scrolled sideways
               * with the Actions column (the delete button!) hanging off the edge. And
               * keeping a second markup for phones meant every cart feature had to be
               * written twice; the phone copy had quietly never got the discount field
               * at all.
               *
               * One line, one implementation, at every width: what it is and what it
               * costs on the top row, the controls that change it underneath, and the
               * name is the thing allowed to take the leftover room.
               */
              <div className="cart-lines" ref={cartLinesRef}>
                {cart.map((item, index) => (
                  <div
                    // `over` is the shelf-can't-cover tint. `expired` is the same idea for a
                    // row the server will refuse outright — it used to carry the problem
                    // line and the Remove button on an otherwise untouched white row.
                    className={`cart-line${isOverStock(item) ? ' over' : ''}${isExpiredCartItem(item) ? ' expired' : ''}${activeLine === index ? ' active' : ''}`}
                    key={item.lineId}
                    data-line={index}
                    // Pointer and keyboard agree on what "the line I am working on" means:
                    // touching a line makes it the one the +/−/Delete keys act on.
                    onMouseDown={() => setActiveLine(index)}
                  >
                    <span className="cart-line__no">{index + 1}</span>

                    <div className="cart-line__name">
                      {item.name}
                      {item.isService && <span className="badge badge-pending">{t('seller.chargeTag')}</span>}
                      {/* The scheme, said on the line it applies to. A cashier reading
                          "2 FREE" against the soap can answer the customer's question
                          without opening anything; a smaller total at the bottom cannot. */}
                      {offerByLine.get(item.lineId)?.freeUnits > 0 && (
                        <span className="free-badge" data-tip={offerByLine.get(item.lineId).offerName}>
                          {offerByLine.get(item.lineId).freeUnits} {t('seller.offerFreeBadge')}
                        </span>
                      )}
                    </div>

                    <div className="cart-line__money">
                      <strong>₹{lineTotal(item).toFixed(2)}</strong>
                      {lineDiscount(item) > 0 && <span className="line-struck">₹{lineGross(item).toFixed(2)}</span>}
                    </div>

                    <button
                      type="button"
                      className="icon-btn danger cart-line__remove"
                      data-tip={t('common.delete')}
                      onClick={() => removeFromCart(item.lineId)}
                    >
                      <TrashIcon size={17} />
                    </button>

                    <div className="cart-line__controls">
                      <div className="qty-control">
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.lineId, Math.max(0.001, Math.round((item.quantity - 1) * 1000) / 1000))}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          aria-label={t('seller.quantity')}
                          value={item.quantity}
                          onChange={(e) => updateQuantity(item.lineId, Number(e.target.value))}
                        />
                        <button type="button" onClick={() => updateQuantity(item.lineId, Math.round((item.quantity + 1) * 1000) / 1000)}>
                          +
                        </button>
                      </div>

                      {/* For a product that can be broken open, the unit label becomes a
                          switch — the whole answer to "packet mein 15 goli hai, ek
                          chahiye". Everything else keeps the plain label it had. */}
                      {item.packSize ? (
                        <span className="cart-line__unit">
                          <PackSwitch item={item} onChange={setSaleUnit} t={t} />
                          <small>{t('pack.perPiece', { price: formatSubUnitPrice(item.price), subUnit: t(`units.${item.unit}`) })}</small>
                        </span>
                      ) : (
                        <span className="cart-line__unit cart-line__unit--plain">
                          {item.unit}
                          {/* The escape hatch for every product that predates loose
                              selling: the customer wants one tablet, the app has never
                              been told how many are in the strip, and this is where they
                              say so — once, without leaving the bill. */}
                          {canEditProducts && !item.isService && (
                            <button type="button" className="link-btn pack-setup-link" onClick={() => setPackSetup(item)}>
                              {t('pack.setUp')}
                            </button>
                          )}
                        </span>
                      )}

                      {/* The rate this line is actually being sold at, and the way to
                          change it. It used to be a read-only string next to a permanent
                          "Disc %" number box on every line of every bill — two controls
                          for one decision, on lines that are almost never discounted.
                          Now it is one chip: it shows the rate (the only place a wrong
                          per-piece price is visible before printing), and opens rate +
                          discount + resulting line total together when tapped. */}
                      <button
                        type="button"
                        className={`cart-line__price${lineDiscount(item) > 0 ? ' discounted' : ''}${priceEditLine === item.lineId ? ' open' : ''}`}
                        aria-expanded={priceEditLine === item.lineId}
                        data-tip={t('seller.priceEditOpen')}
                        onClick={() => setPriceEditLine(priceEditLine === item.lineId ? null : item.lineId)}
                      >
                        <span>₹{formatSubUnitPrice(effectiveRate(item))} × {item.quantity}</span>
                        {lineDiscount(item) > 0 ? (
                          <em>−{Number(item.discountPercent).toFixed(Number(item.discountPercent) % 1 ? 1 : 0)}%</em>
                        ) : (
                          <TagIcon size={12} />
                        )}
                      </button>

                      {/* Selling an expired item is refused outright by the server. This
                          is the softer warning for the weeks before that. */}
                      {expiryWarningFor(item) && <span className="expiry-warn">{expiryWarningFor(item)}</span>}
                    </div>

                    {/**
                     * What is wrong with THIS line, on this line, with the button that
                     * fixes it.
                     *
                     * An over-stock row already turned red — and that was the whole of the
                     * message. The cashier was told a row was bad, not what was bad about
                     * it or what to do, and the actual number ("teen bacha hai") lived on
                     * a different screen. The real refusal then arrived at the far end of
                     * the counter when "Create bill" appeared to do nothing.
                     */}
                    {(() => {
                      if (isExpiredCartItem(item)) {
                        return (
                          <div className="cart-line__problem">
                            <AlertIcon size={13} />
                            <span>{t('seller.lineExpiredProblem')}</span>
                            <button type="button" className="cart-line__problem-fix" onClick={() => removeFromCart(item.lineId)}>
                              {t('seller.remove')}
                            </button>
                          </div>
                        );
                      }
                      if (!isOverStock(item)) return null;
                      const room = lineStockRoom(item);
                      if (!room) return null;
                      return (
                        <div className="cart-line__problem">
                          <AlertIcon size={13} />
                          <span>
                            {room.ingredient
                              ? t('recipe.cartShort', { name: room.ingredient, count: room.room })
                              : t('seller.lineStockProblem', { count: room.room, unit: room.unit })}
                          </span>
                          {room.room > 0 ? (
                            <button
                              type="button"
                              className="cart-line__problem-fix"
                              onClick={() => updateQuantity(item.lineId, room.room)}
                            >
                              {t('seller.lineStockFix', { count: room.room })}
                            </button>
                          ) : (
                            <button type="button" className="cart-line__problem-fix" onClick={() => removeFromCart(item.lineId)}>
                              {t('seller.remove')}
                            </button>
                          )}
                        </div>
                      );
                    })()}

                    {priceEditLine === item.lineId && (
                      <LinePriceEditor
                        item={item}
                        listRate={item.isService ? Infinity : Number(item.price) || 0}
                        effRate={effectiveRate(item)}
                        total={lineTotal(item)}
                        onRate={(value) => updateLineRate(item.lineId, value)}
                        onDiscount={(value) => updateLineDiscount(item.lineId, value)}
                        onClose={() => setPriceEditLine(null)}
                        t={t}
                      />
                    )}

                    {item.warrantyMonths ? (
                      <input
                        className="cart-line__serial"
                        value={item.serialNumber}
                        onChange={(e) => updateSerialNumber(item.lineId, e.target.value)}
                        placeholder={t('seller.serialNumber')}
                      />
                    ) : null}
                  </div>
                ))}

                {/**
                 * Freebies the scheme is adding to this bill that nobody scanned — a brush
                 * for the toothpaste, a gift for crossing ₹1,000.
                 *
                 * Shown as ghost rows rather than as real cart lines on purpose: they are
                 * not the cashier's to edit, and letting the quantity be typed into would
                 * mean a number the server is about to overwrite. They still have to be
                 * visible, because they are goods the counter physically has to hand over
                 * — an unseen freebie is a freebie the customer never receives.
                 */}
                {offerFreeLines.map((line, index) => (
                  <div className="offer-ghost-row" key={`${line.productId}-${index}`}>
                    {/* Indented to the same column the paid lines' names start in, so the
                        bill reads as one list. The pieces were previously three text nodes
                        in one span with no spacing between them, which printed the scheme's
                        name welded to its badge — "FREEbogo". */}
                    <span className="offer-ghost-row__name">
                      <span>{line.name} × {line.quantity} {line.unit}</span>
                      <span className="free-badge">{t('seller.offerFreeBadge')}</span>
                      <span className="muted-line">{line.offerName}</span>
                    </span>
                    <strong>₹{round2(line.price * line.quantity - line.value).toFixed(2)}</strong>
                  </div>
                ))}
              </div>
            )}

            {/* What the schemes did to this cart, and what nearly applied. Sits with the
                items rather than down in the totals because it is about the goods on the
                counter, and because "₹120 aur lo to ek soap free" is only worth anything
                while the customer is still deciding. */}
            {(offerPreview?.offers?.length > 0 || offerPreview?.notes?.length > 0) && (() => {
              // A note used to be a finished Hinglish sentence built in the backend and
              // printed as-is — which is how a counter set to Marathi was shown
              // "bogo: gift item catalog mein nahin mila". It is a { kind, code, vars }
              // now; the string shape is still handled because a browser can be holding
              // a cached response from before the change.
              const notes = (offerPreview.notes || []).map((note, index) =>
                typeof note === 'string'
                  ? { key: `legacy-${index}`, kind: 'nudge', text: note }
                  : {
                      key: `${note.code}-${index}`,
                      kind: note.kind || 'nudge',
                      text: t(`seller.${note.code}`, note.vars),
                      // A broken scheme is not this bill's problem — it is configuration,
                      // and it will misfire on every bill until someone opens the offer.
                      // The counter was being told about it on the one screen that could
                      // do nothing about it, so the note carries the way there.
                      // `?edit=<id>` is the app's existing "open this record's form"
                      // deep link — the products page has answered it since the detail
                      // screen stopped carrying its own copy of the form.
                      href: note.productId
                        ? `/seller/products?edit=${note.productId}`
                        : note.offerId
                        ? `/seller/offers?edit=${note.offerId}`
                        : null,
                    }
              );
              // "The free item is not in your catalog" is a broken offer, not a reward.
              // Drawn in the same green "you earned something" strip, it read as good news.
              const broken = notes.some((note) => note.kind === 'problem');
              return (
                <div className={`offer-strip${broken ? ' offer-strip--problem' : ''}`}>
                  {(offerPreview.offers || []).map((entry) => (
                    <div className="offer-strip-row" key={entry.offerId}>
                      <strong><SparkleIcon size={15} /> {entry.name}</strong>
                      <span className="num">
                        {entry.freeUnits > 0 ? `${entry.freeUnits} ${t('seller.offerFreeBadge')}` : ''}
                        {entry.discount > 0 ? ` −₹${entry.discount.toFixed(2)}` : ''}
                      </span>
                    </div>
                  ))}
                  {notes.map((note) => (
                    <div className={`offer-nudge offer-nudge--${note.kind}`} key={note.key}>
                      {note.kind === 'problem' && <AlertIcon size={13} />}
                      <span>{note.text}</span>
                      {/* Only on a problem: a "spend ₹120 more" nudge is good news and has
                          nothing to go and fix. */}
                      {note.href && note.kind === 'problem' && (
                        <Link className="offer-nudge__fix" href={note.href}>
                          <span>{t('seller.offerNoteFix')}</span>
                          <ChevronRightIcon size={12} />
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/**
           * The shelf.
           *
           * This is what the billing screen was actually missing, and it is why the page
           * read as empty no matter how the boxes were sized: below the search box there
           * was *nothing* until somebody typed. Every counter package a shopkeeper has seen
           * — and every POS on a phone — puts the shop's own products on that half of the
           * screen, because tapping a tile is faster than typing a name and because a till
           * that shows you your stock is a till you can hand to a new employee.
           *
           * It takes the room the bill is not using (`flex: 1 1 0`), so it can never push
           * the cart down — the exact objection that killed the earlier tile grid, which
           * sat ABOVE the cart. A one-item bill gets a big shelf; a twenty-item bill gets a
           * small one; neither loses a line of the bill for it.
           *
           * Fitted layout only. Below 1101px the page scrolls and a grid here would be the
           * old mistake again, so the one-line quick-pick rail keeps that job.
           */}
          {posFit && shelfFits && !parsedQuery.term && products.length > 0 && (
            <div className="panel pos-browse-panel">
              <div className="pos-browse-head">
                <strong>{t('seller.browseShelf')}</strong>
                {browseCategories.length > 1 && (
                  <div className="pos-browse-cats">
                    <button
                      type="button"
                      className={browseCategory ? '' : 'active'}
                      onClick={() => setBrowseCategory('')}
                    >
                      {t('seller.browseAll')}
                    </button>
                    {browseCategories.map((cat) => (
                      <button
                        type="button"
                        key={cat}
                        className={browseCategory === cat ? 'active' : ''}
                        onClick={() => setBrowseCategory(cat)}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {browseProducts.length === 0 ? (
                <p className="empty-state">{t('seller.browseEmptyCategory')}</p>
              ) : (
                <div className="pos-browse-grid">
                  {browseProducts.slice(0, BROWSE_LIMIT).map((p) => (
                    <ProductTile
                      key={p._id}
                      product={p}
                      onAdd={handleProductAdd}
                      quantity={parsedQuery.quantity}
                      pinned={quickPicks.pins.includes(p._id)}
                      onTogglePin={toggleQuickPin}
                      t={t}
                    />
                  ))}
                  {/* A shelf that quietly stops at sixty is a shelf that lies about what
                      the shop has. It says so, and points at the faster way to reach the
                      rest. */}
                  {browseProducts.length > BROWSE_LIMIT && (
                    <button
                      type="button"
                      className="pos-browse-more"
                      onClick={() => queryInputRef.current?.focus()}
                    >
                      {t('seller.browseMore', { count: browseProducts.length - BROWSE_LIMIT })}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/**
         * The checkout ticket.
         *
         * This column used to be one long open form: total, discount fields, payment
         * modes, a prescription block, a customer picker, a credit summary, a staff
         * picker, a coupon box, a points box, and only then the button. Every one of them
         * was on screen for every sale, so the ₹20 cash bill — which is most bills —
         * scrolled past four questions nobody had asked before it could be finished, and
         * on a laptop the button itself fell off the bottom of a sticky column that was
         * taller than the screen it was pinned to.
         *
         * It is a ticket now. The body holds what this particular sale needs and scrolls
         * on its own; the foot holds the total and the one button, and never moves. What
         * is optional is a chip until it is asked for — and opens itself when it stops
         * being optional (khata with no customer, a scheduled medicine on the bill).
         */}
        <div className="pos-checkout">
          <div className="panel pos-ticket">
            <div className="pos-ticket__body">
              {/**
               * The bill that just went out, said where the cashier is already looking.
               *
               * On the full-height terminal the receipt panel is below a screen that does
               * not scroll, so everything the counter needs in the ten seconds after a sale
               * — the number to say out loud, the change to hand back, and a way to print
               * it — has to be here. Only on `posFit`: at narrower widths the page still
               * scrolls to the full receipt, which is the better answer there.
               */}
              {posFit && receipt && cart.length === 0 && (
                <div className="pos-ticket__done">
                  <div className="pos-ticket__done-head">
                    <CheckCircleIcon size={16} />
                    <strong>
                      {receipt.offline ? t('seller.offlinePendingTitle') : `${t('seller.billNumber')}${receipt.billNumber}`}
                    </strong>
                    <button
                      type="button"
                      className="icon-btn"
                      data-tip={t('common.close')}
                      onClick={() => setReceipt(null)}
                    >
                      <XIcon size={17} />
                    </button>
                  </div>
                  <div className="pos-ticket__done-money">
                    <span>{t('seller.total')}</span>
                    <strong>{money(receipt.payableTotal ?? receipt.total ?? 0)}</strong>
                  </div>
                  {/* The number a busy counter forgets between taking the note and opening
                      the drawer, kept alive after the cart that produced it is gone. */}
                  {lastTender && lastTender.change > 0 && (
                    <div className="pos-ticket__done-change">
                      <span>{t('seller.changeDue')}</span>
                      <strong>₹{lastTender.change.toFixed(2)}</strong>
                    </div>
                  )}
                  {!receipt.offline && (
                    <div className="row-actions">
                      <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={handlePrint}>
                        <PrinterIcon size={15} /> {t('seller.print')}
                      </button>
                      {biz.runsTables && (
                        <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={handlePrintKot}>
                          <PrinterIcon size={15} /> {t('tables.kot')}
                        </button>
                      )}
                      <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={handleShare}>
                        <WhatsappIcon size={17} /> {t('seller.shareWhatsapp')}
                      </button>
                      <Link
                        href={recordHref('/seller/invoice/[id]', receipt._id)}
                        className="btn btn-secondary btn-small btn-inline"
                        style={{ textDecoration: 'none' }}
                      >
                        {t('seller.professionalBill')}
                      </Link>
                    </div>
                  )}
                </div>
              )}

              {/* Nothing is being paid for until something is in the cart.
                  ...so the whole money half of the ticket stays away until then. An empty
                  counter offering "Cash / UPI / Card / Khata / Split" is asking a question
                  about a bill that does not exist — and after a sale is written the cart
                  empties, which left the last customer's payment mode sitting there as if
                  the next one had already chosen it. The chips below (customer, discount)
                  deliberately stay: a shopkeeper who picks the khata name before scanning
                  the first packet is doing it in the right order, not the wrong one. */}
              {cart.length > 0 && (
                <>
                {/* Five modes on ONE row, icon over word — a keypad, not a form field.
                    As three-across-then-two it cost 79px of the tightest column in the app
                    and still left the fifth key stretched across a third of the control.
                    Stacking the icon lets every label keep its own full word (measured in
                    en/hi/mr: the widest, "यूपीआई", clears its track) inside 48px. */}
                <div className="pos-pay__modes">
                  <span className="pos-pay__label" id="paymentModeLabel">{t('seller.paymentMode')}</span>
                  <div className="segmented" role="group" aria-labelledby="paymentModeLabel">
                    {[
                      { id: 'cash', label: t('seller.cash'), icon: RupeeIcon },
                      { id: 'upi', label: t('seller.upi'), icon: WalletIcon },
                      { id: 'card', label: t('seller.card'), icon: CreditCardIcon },
                      { id: 'khata', label: t('nav.khata'), icon: LedgerIcon },
                      { id: 'split', label: t('seller.splitPayment'), icon: SwapIcon },
                    ].map(({ id, label, icon: ModeIcon }) => (
                      <button
                        key={id}
                        type="button"
                        // The control is a single-select, and without this a screen reader
                        // reads five identical buttons with no way to tell which one the
                        // bill is actually being written against.
                        aria-pressed={paymentMode === id}
                        className={paymentMode === id ? 'active' : ''}
                        onClick={() => setPaymentMode(id)}
                      >
                        <ModeIcon size={15} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cash in, change out. The one piece of arithmetic every cash sale ends in,
                    and the only one the app used to leave to the shopkeeper's head while a
                    queue waited. Nothing here is sent to the server — the bill is the same
                    bill — it is purely the counter's own maths, said out loud. */}
                {paymentMode === 'cash' && payable > 0 && (
                  <div className="cash-tender">
                    <div className="cash-tender__head">
                      <label htmlFor="cashReceived">{t('seller.cashReceived')}</label>
                      <button
                        type="button"
                        className={`filter-pill${cashExact ? ' active' : ''}`}
                        aria-pressed={cashExact}
                        data-tip={t('seller.exactFollows')}
                        onClick={toggleCashExact}
                      >
                        {cashExact && <CheckIcon size={12} />} {t('seller.cashExact')}
                      </button>
                    </div>
                    {/* Money in and money back on ONE line, because they are one thought —
                        "sau ka diya, bais wapas". They used to be two stacked blocks with a
                        chip row between them, which put the change 150px below the note the
                        cashier had just typed and, on a laptop-height ticket, past the edge
                        of the scroll box: the single number this whole card exists to say
                        was the one thing sliced in half. */}
                    <div className="cash-tender__pay">
                      <input
                        id="cashReceived"
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        placeholder={payable.toFixed(2)}
                        value={cashReceived}
                        onChange={(e) => enterCashReceived(e.target.value)}
                      />
                      {cashReceivedValue > 0 && (
                        changeDue >= 0 ? (
                          <div className="cash-change">
                            <span>{t('seller.changeDue')}</span>
                            <strong>₹{changeDue.toFixed(2)}</strong>
                          </div>
                        ) : (
                          <div className="cash-change short">
                            <span>{t('seller.cashShort')}</span>
                            <strong>₹{Math.abs(changeDue).toFixed(2)}</strong>
                          </div>
                        )
                      )}
                    </div>
                    <div className="cash-tender__notes">
                      {tenderOptions.map((amount) => (
                        <button type="button" key={amount} className="filter-pill" onClick={() => enterCashReceived(String(amount))}>
                          ₹{amount}
                        </button>
                      ))}
                      {cashReceived && (
                        <button type="button" className="link-btn" onClick={() => enterCashReceived('')}>
                          {t('seller.cashClear')}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* ── UPI and Card used to be holes ──────────────────────────────────────
                    Picking either one changed a highlight and nothing else: the ticket sat
                    there with the mode row, then a chip rail, then the total — no answer to
                    "aage kya". UPI now carries the thing a counter actually reaches for, the
                    shop's own scan-to-pay code, and Card says plainly what is about to be
                    recorded.

                    The QR is deliberately shown BEFORE the bill is written. A UPI intent
                    hands back no callback (see the receipt panel further down, and the same
                    rule the storefront runs on), so the shopkeeper is the confirmation
                    either way — and they would rather watch the money land and then press
                    the button than write the bill and hope. */}
                {paymentMode === 'upi' && payable > 0 && (
                  counterUpiLink ? (
                    <div className="pos-pay-upi">
                      <div className="pos-pay-upi__text">
                        <span className="pos-pay-upi__id">{user.upiId}</span>
                        <span className="pos-pay-upi__hint">{t('seller.scanToPay')}</span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small btn-inline"
                        onClick={() => setUpiQrOpen(true)}
                      >
                        <BarcodeIcon size={15} /> {t('seller.showQr')}
                      </button>
                    </div>
                  ) : (
                    <p className="pos-pay-note">
                      {t('seller.upiNotSetHint')}{' '}
                      <Link href="/seller/settings">{t('nav.settings')}</Link>
                    </p>
                  )
                )}

                {paymentMode === 'card' && payable > 0 && (
                  <p className="pos-pay-note">
                    {t('seller.payFullNote', { amount: money(payable), mode: t('seller.card') })}
                  </p>
                )}

                {/* "₹500 cash, ₹300 UPI". The layout lives in globals.css (.split-panel and
                    friends) — it was written inline here in a shape those rules could not
                    reach, so a stack of hand-set pixel values quietly outranked the
                    stylesheet the rest of the counter is built from. */}
                {paymentMode === 'split' && (
                  <div className="split-panel">
                    {/* Two boxes across instead of four down, and no heading of its own —
                        the panel only exists while the Split key above it is lit, so a
                        second word "Split" was a line of height spent saying what the
                        highlight already said. Four amounts stacked pushed the running
                        remainder — the one line that says "ab bill ban sakta hai" — clean
                        off the bottom of the ticket. */}
                    <div className="split-rows">
                      {['cash', 'upi', 'card', 'bank'].map((mode) => (
                        <div className="split-row" key={mode}>
                          <div className="split-row__head">
                            <label htmlFor={`split-${mode}`}>{t(`expenses.mode.${mode}`)}</label>
                            <button
                              type="button"
                              className="link-btn"
                              disabled={splitRemaining <= 0}
                              onClick={() =>
                                setSplit((s) => ({
                                  ...s,
                                  [mode]: String(Number((Number(s[mode] || 0) + splitRemaining).toFixed(2))),
                                }))
                              }
                            >
                              +{t('seller.splitRest')}
                            </button>
                          </div>
                          <input
                            id={`split-${mode}`}
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            placeholder="0"
                            value={split[mode]}
                            onChange={(e) => setSplit((s) => ({ ...s, [mode]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                    <div className={`split-total${Math.abs(splitRemaining) < 0.01 ? ' ok' : ''}`}>
                      <span>{t('seller.splitEntered')}</span>
                      <strong>₹{splitEntered.toFixed(2)}</strong>
                      {Math.abs(splitRemaining) >= 0.01 ? (
                        <em>
                          {splitRemaining > 0
                            ? t('seller.splitShort', { amount: splitRemaining.toFixed(2) })
                            : t('seller.splitOver', { amount: Math.abs(splitRemaining).toFixed(2) })}
                        </em>
                      ) : (
                        <em className="ok"><CheckIcon size={13} /> {t('seller.splitMatches')}</em>
                      )}
                      <button type="button" className="link-btn" onClick={() => setSplit({ cash: '', upi: '', card: '', bank: '' })}>
                        {t('seller.splitClear')}
                      </button>
                    </div>
                  </div>
                )}

                {/* ── The khata counter ───────────────────────────────────────────────────
                    One card that answers the whole udhaar sale in the order a counter says
                    it out loud: who is standing here, how much is changing hands right now,
                    and what that leaves on the tab. It used to be a bare number box with a
                    sentence underneath, while the name it was about lived in a fold-out
                    panel further down — the two halves of one question were never on screen
                    together. Picking a name now closes that panel and lands the cursor in
                    here (the `askedFor` effect, via the same focusFix every "Fix" uses).

                    Every state of "kitna diya" is one tap: nothing, half, a round note, or
                    the whole bill. Typing is the fallback, not the route. */}
                {paymentMode === 'khata' && customerId && (
                  <div className="paid-now">
                    <div className="paid-now__head">
                      <div className="paid-now__ask">
                        <label htmlFor="paidNow">{t('seller.paidNowLabel')}</label>
                        {selectedCustomer && (
                          <span
                            className="paid-now__who"
                            data-tip={
                              customerOwes > 0
                                ? t('seller.customerOwes', { name: selectedCustomer.name, amount: customerOwes.toFixed(2) })
                                : t('seller.customerClear', { name: selectedCustomer.name })
                            }
                          >
                            <UsersIcon size={12} />
                            <b>{selectedCustomer.name}</b>
                            {customerOwes > 0 && <em>₹{customerOwes.toFixed(0)}</em>}
                          </span>
                        )}
                      </div>
                      {payable > 0 && (
                        <button
                          type="button"
                          className={`filter-pill${paidNowExact ? ' active' : ''}`}
                          aria-pressed={paidNowExact}
                          data-tip={t('seller.exactFollows')}
                          onClick={togglePaidNowExact}
                        >
                          {paidNowExact && <CheckIcon size={12} />} {t('seller.cashExact')}
                        </button>
                      )}
                    </div>

                    {/* The rupee sign belongs to the box, not to the number the shopkeeper
                        types — a field that already says ₹ is never typed into with one. */}
                    <div className="paid-now__row">
                      <div className="paid-now__amount">
                        <span className="paid-now__cur" aria-hidden="true">₹</span>
                        <input
                          id="paidNow"
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          value={paidNow}
                          onChange={(e) => enterPaidNow(e.target.value)}
                          placeholder="0"
                        />
                      </div>
                      <Dropdown
                        className="paid-now-mode"
                        value={paidNowMode}
                        onChange={setPaidNowMode}
                        options={['cash', 'upi', 'card', 'bank'].map((m) => ({ value: m, label: t(`expenses.mode.${m}`) }))}
                      />
                    </div>

                    {/* The amounts an udhaar customer actually names — "kuch nahi", "aadha",
                        or a round note below the bill. Typing them was three taps on a number
                        pad held in one hand while the other counted notes. */}
                    {payable > 0 && (
                      <div className="paid-now__notes">
                        <button
                          type="button"
                          className={`filter-pill${!paidNowExact && !(Number(paidNow) > 0) ? ' active' : ''}`}
                          onClick={() => enterPaidNow('')}
                        >
                          {t('seller.paidNowNothing')}
                        </button>
                        {halfPay > 0 && (
                          <button
                            type="button"
                            className={`filter-pill${!paidNowExact && Number(paidNow) === halfPay ? ' active' : ''}`}
                            onClick={() => enterPaidNow(String(halfPay))}
                          >
                            {t('seller.paidNowHalf')} · ₹{halfPay}
                          </button>
                        )}
                        {partPayOptions
                          .filter((amount) => amount !== halfPay)
                          .map((amount) => (
                            <button
                              type="button"
                              key={amount}
                              className={`filter-pill${!paidNowExact && Number(paidNow) === amount ? ' active' : ''}`}
                              onClick={() => enterPaidNow(String(amount))}
                            >
                              ₹{amount}
                            </button>
                          ))}
                      </div>
                    )}

                    {/* The consequence, in two lines instead of one sentence, because the
                        second number is the one the shop carries home. Measured against
                        `payable` — the rounded-off figure the customer actually hands over
                        and the one the server books credit from — not the pre-round-off
                        total, which left Exact reading a few paise still owing. */}
                    <div className={`paid-now__sum${khataPortion <= 0 ? ' clear' : ''}`}>
                      <div className="paid-now__sum-row">
                        <span>{t('seller.paidNowGot')}</span>
                        <strong>₹{Math.min(Number(paidNow) || 0, payable).toFixed(2)}</strong>
                      </div>
                      <div className="paid-now__sum-row on-khata">
                        <span>{t('seller.paidNowOnKhata')}</span>
                        <strong>₹{khataPortion.toFixed(2)}</strong>
                      </div>
                    </div>

                    {/* A ₹500 note against a ₹340 khata bill. The server only ever books the
                        bill's worth as the advance, so the rest is change the counter owes —
                        said here, because the cash drawer's version of this line is on the
                        other payment mode and this one used to swallow the difference. */}
                    {paidNowChange > 0 && (
                      <div className="cash-change">
                        <span>{t('seller.changeDue')}</span>
                        <strong>₹{paidNowChange.toFixed(2)}</strong>
                      </div>
                    )}
                  </div>
                )}
                </>
              )}

              {/* Everything a bill can optionally carry, as one line of chips. See the
                  `extras` array above for what each one is and when it appears. */}
              <div className="pos-extras">
                <span className="pos-extras__label">{t('seller.addToBillLabel')}</span>
                <div className="pos-extras__chips">
                  {extras.map((extra) => {
                    const ExtraIcon = extra.icon;
                    return (
                      <button
                        key={extra.id}
                        type="button"
                        className={`pos-extra-chip${openExtra === extra.id ? ' open' : ''}${extra.summary ? ' set' : ''}${extra.required ? ' required' : ''}`}
                        aria-expanded={openExtra === extra.id}
                        onClick={() => setOpenExtra(openExtra === extra.id ? null : extra.id)}
                      >
                        <ExtraIcon size={13} />
                        <span>{extra.summary || extra.label}</span>
                        {extra.required && <em>{t('seller.extraNeeded')}</em>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {openExtra === 'customer' && (
                <div className="pos-extra-panel">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="customer">
                      {t('seller.selectCustomer')}
                      {paymentMode !== 'khata' && ` (${t('seller.optional')})`}
                    </label>
                    <div className="customer-picker">
                      {/* Searchable: the khata list is the one dropdown in this app that
                          grows without limit, and scrolling three hundred names to find
                          "Ramesh" is not something to do with a customer standing there. */}
                      <Dropdown
                        id="customer"
                        value={customerId}
                        onChange={setCustomerId}
                        searchable={customers.length > 8}
                        searchPlaceholder={t('seller.customerSearchHint')}
                        emptyLabel={t('seller.customerSearchNone')}
                        options={[
                          // Named, not a dash. This row is how a bill goes back to being a
                          // walk-in's, and "—" told nobody standing at a counter that.
                          { value: '', label: t('seller.noKhataCustomer') },
                          ...customers.map((c) => ({
                            value: c.id,
                            label: `${customerOptionLabel(c)}${loyaltyEnabled ? ` · ${c.loyaltyPoints || 0} pts` : ''}`,
                          })),
                        ]}
                      />
                      {/* "Khata pe likh do" from someone not in the book yet used to mean
                          abandoning a half-built cart to go and add them. */}
                      <button
                        type="button"
                        className="btn btn-secondary btn-small btn-inline"
                        onClick={() => setNewCustomerOpen(true)}
                        data-tip={t('seller.quickCustomerAdd')}
                      >
                        <PlusIcon size={15} /> {t('seller.newCustomerShort')}
                      </button>
                    </div>
                    {/* The two things a counter actually wants to do to the name it just
                        picked, next to the name itself: take it off this bill, or fix the
                        number the receipt is about to go to. Both used to mean leaving the
                        cart — one for a dash hidden in the dropdown, the other for the
                        Khata screen. The phone is spelled out here because it is the field
                        being checked; the dropdown row shows it too small to proof-read. */}
                    {selectedCustomer && (
                      <div className="picked-customer">
                        <span className="picked-customer__who">
                          <strong>{nameIsPhone(selectedCustomer) ? selectedCustomer.phone : selectedCustomer.name}</strong>
                          {/* A customer saved from just a number has that number as their name too. */}
                          {!nameIsPhone(selectedCustomer) && <span className="picked-customer__phone">{selectedCustomer.phone}</span>}
                        </span>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => setEditCustomer(selectedCustomer)}
                          data-tip={t('seller.customerEditTip')}
                          aria-label={t('seller.customerEditTip')}
                        >
                          <EditIcon size={17} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={clearBillCustomer}
                          data-tip={t('seller.customerRemoveTip')}
                          aria-label={t('seller.customerRemoveTip')}
                        >
                          <XIcon size={17} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {openExtra === 'discount' && (
                <div className="pos-extra-panel">
                  <div className="bill-discount-fields">
                    <div className="field">
                      <label htmlFor="billDiscountPercent">{t('seller.discountPercent')}</label>
                      <input
                        id="billDiscountPercent"
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        inputMode="decimal"
                        placeholder="0"
                        value={billDiscountPercent}
                        onChange={(e) => {
                          setBillDiscountPercent(e.target.value);
                          // The two fields are two ways of saying one thing, so typing in
                          // either clears the other rather than leaving both on screen with
                          // the shopkeeper guessing which one won.
                          if (e.target.value) setBillDiscountAmount('');
                        }}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="billDiscountAmount">{t('seller.discountAmount')}</label>
                      <input
                        id="billDiscountAmount"
                        type="number"
                        min="0"
                        step="1"
                        inputMode="decimal"
                        placeholder="0"
                        value={billDiscountAmount}
                        onChange={(e) => {
                          setBillDiscountAmount(e.target.value);
                          if (e.target.value) setBillDiscountPercent('');
                        }}
                      />
                    </div>
                    {/* "1,247 ka 1,200 kar do" in one tap: type the price you agreed and this
                        works the discount out backwards. */}
                    <div className="field">
                      <label htmlFor="billTargetTotal">{t('seller.discountTargetTotal')}</label>
                      <input
                        id="billTargetTotal"
                        type="number"
                        min="0"
                        step="1"
                        inputMode="decimal"
                        placeholder={afterItemDiscount.toFixed(0)}
                        onChange={(e) => {
                          const target = Number(e.target.value);
                          if (!e.target.value || !Number.isFinite(target)) return;
                          setBillDiscountPercent('');
                          setBillDiscountAmount(String(round2(Math.max(0, afterItemDiscount - target))));
                        }}
                      />
                    </div>
                  </div>
                  {billDiscountValue > 0 && (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        setBillDiscountPercent('');
                        setBillDiscountAmount('');
                      }}
                    >
                      {t('seller.discountRemove')}
                    </button>
                  )}
                </div>
              )}

              {/* A Schedule H1/X medicine cannot legally go out without the prescriber and
                  the patient on record, and the shop has to be able to produce that register
                  on inspection. Asked here, at the counter, rather than letting the server
                  refuse the bill after the customer is already waiting — but folded away
                  until it is either asked for or made compulsory by what is in the cart. */}
              {openExtra === 'prescription' && showPrescription && (
                <div className={`pos-extra-panel${scheduledInCart.length > 0 ? ' warn' : ''}`}>
                  {scheduledInCart.length > 0 ? (
                    <p className="prescription-block__why">
                      {t('seller.prescriptionRequired', {
                        drugs: scheduledInCart.map((item) => item.name).join(', '),
                      })}
                    </p>
                  ) : (
                    <p className="prescription-block__why muted">{t('seller.prescriptionOptional')}</p>
                  )}
                  <div className="prescription-block__fields">
                    <input
                      id="prescriptionDoctor"
                      value={prescription.doctorName}
                      onChange={(e) => setPrescription((p) => ({ ...p, doctorName: e.target.value }))}
                      placeholder={t('seller.doctorName')}
                      aria-label={t('seller.doctorName')}
                    />
                    <input
                      id="prescriptionPatient"
                      value={prescription.patientName}
                      onChange={(e) => setPrescription((p) => ({ ...p, patientName: e.target.value }))}
                      placeholder={t('seller.patientName')}
                      aria-label={t('seller.patientName')}
                    />
                    <input
                      value={prescription.number}
                      onChange={(e) => setPrescription((p) => ({ ...p, number: e.target.value }))}
                      placeholder={t('seller.prescriptionNumber')}
                      aria-label={t('seller.prescriptionNumber')}
                    />
                  </div>
                </div>
              )}

              {/* Only for trades that actually pay per-bill commission — a kirana's helper
                  is on a salary, and asking his counter "who did this work" on every packet
                  of biscuits is noise. Deliberately left sticky between bills: at a salon one
                  stylist works the chair for a stretch, so re-picking every time is worse
                  than leaving a visible selection on screen. */}
              {openExtra === 'staff' && showStaffPicker && staffList.length > 0 && (
                <div className="pos-extra-panel">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="billStaff">
                      {t('seller.billedBy')} ({t('seller.optional')})
                    </label>
                    <Dropdown
                      id="billStaff"
                      value={billStaffId}
                      onChange={setBillStaffId}
                      options={[
                        { value: '', label: t('seller.noStaffPicked') },
                        ...staffList.map((s) => ({
                          value: s.id,
                          label: s.jobTitle ? `${s.name} · ${s.jobTitle}` : s.name,
                        })),
                      ]}
                    />
                    <p className="field-hint">{t('seller.billedByHint')}</p>
                  </div>
                </div>
              )}

              {openExtra === 'loyalty' && loyaltyEnabled && customerId && (
                <div className="pos-extra-panel">
                  <div className="field">
                    <label htmlFor="couponCode">{t('seller.couponCode')}</label>
                    <input id="couponCode" value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} placeholder="DIWALI20" />
                  </div>
                  <div className="field">
                    <label htmlFor="redeemPoints">{t('seller.redeemPointsLabel')}</label>
                    <input id="redeemPoints" type="number" min="0" value={redeemPoints} onChange={(e) => setRedeemPoints(e.target.value)} />
                  </div>
                  <button type="button" className="btn btn-secondary btn-small" onClick={handlePreviewLoyalty} disabled={previewing}>
                    {t('seller.previewDiscount')}
                  </button>
                </div>
              )}

              {/* What you need to know before agreeing to put one more bill on the tab —
                  said here, at the counter, instead of on the khata page afterwards. Stays
                  visible whether or not the customer panel is open: an over-limit warning
                  folded inside a collapsed block is a warning nobody reads. */}
              {selectedCustomer && (
                <div className={`customer-credit${overLimitBy > 0 ? ' over' : ''}`}>
                  <div className="customer-credit__row">
                    <UsersIcon size={14} />
                    <span>
                      {customerOwes > 0
                        ? t('seller.customerOwes', { name: selectedCustomer.name, amount: customerOwes.toFixed(2) })
                        : t('seller.customerClear', { name: selectedCustomer.name })}
                    </span>
                  </div>
                  {creditLimit > 0 && (
                    <div className="customer-credit__row muted">
                      <span>
                        {t('seller.creditHeadroom', {
                          left: Math.max(0, round2(creditLimit - customerOwes)).toFixed(2),
                          limit: creditLimit.toFixed(2),
                        })}
                      </span>
                    </div>
                  )}
                  {selectedCustomer.promiseToPayDate && (
                    <div className="customer-credit__row muted">
                      <ClockIcon size={13} />
                      <span>
                        {t('seller.promisedBy', {
                          date: new Date(selectedCustomer.promiseToPayDate).toLocaleDateString('en-IN'),
                        })}
                      </span>
                    </div>
                  )}
                  {/* Never a block — a shopkeeper knows their customers better than a limit
                      they typed once does. It is said, and they decide. */}
                  {overLimitBy > 0 && (
                    <div className="customer-credit__row warn">
                      <AlertIcon size={14} />
                      <span>{t('seller.overLimitWarn', { amount: overLimitBy.toFixed(2), limit: creditLimit.toFixed(2) })}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Was a bare red <p> with an inline colour — the one message on this screen
                  that did not look like a message. It is already sitting next to the coupon
                  box it is about, so it needs no fix button, only the same shape. */}
              {loyaltyError && <ProblemNote text={loyaltyError} className="problem-note--inline" />}
              {loyaltyPreview && (
                <p style={{ color: 'var(--text-success)' }}>
                  {t('seller.discount')}: ₹{(loyaltyPreview.couponDiscount + loyaltyPreview.pointsRedeemedValue).toFixed(2)} ·{' '}
                  {t('seller.payableTotal')}: ₹{loyaltyPreview.payableTotal.toFixed(2)}
                </p>
              )}
            </div>

            {/* The foot never scrolls away: the total and the button are the two things a
                cashier reaches for with a customer's money already in their hand. */}
            <div className="pos-ticket__foot">
              {/* Every reduction between the cart and what the customer hands over, on its
                  own line. A total that silently differs from the sum of the items is the
                  fastest way to lose a counter's trust in the software. */}
              {(itemDiscountTotal > 0 || billDiscountValue > 0 || offerDiscountTotal > 0 || Math.abs(roundOff) >= 0.005) && (
                <div className="bill-total-lines">
                  <div className="bill-total-line">
                    <span>{t('seller.subtotal')}</span>
                    <span>₹{subtotal.toFixed(2)}</span>
                  </div>
                  {/* The scheme's rupees are already inside itemDiscountTotal (an offer IS
                      a line discount — that is what keeps its GST right). Shown split so
                      the cashier can tell "maine 10% chhoda" apart from "offer ne diya",
                      which are two very different conversations with the owner. */}
                  {round2(itemDiscountTotal - offerDiscountTotal) > 0 && (
                    <div className="bill-total-line discount">
                      <span>{t('seller.itemDiscount')}</span>
                      <span>−₹{round2(itemDiscountTotal - offerDiscountTotal).toFixed(2)}</span>
                    </div>
                  )}
                  {offerDiscountTotal > 0 && (
                    <div className="bill-total-line discount">
                      <span><SparkleIcon size={15} /> {t('seller.offerAppliedAtCounter')}</span>
                      <span>−₹{offerDiscountTotal.toFixed(2)}</span>
                    </div>
                  )}
                  {billDiscountValue > 0 && (
                    <div className="bill-total-line discount">
                      <span>{t('seller.billDiscount')}</span>
                      <span>−₹{billDiscountValue.toFixed(2)}</span>
                    </div>
                  )}
                  {Math.abs(roundOff) >= 0.005 && (
                    <div className="bill-total-line">
                      <span>{t('seller.roundOff')}</span>
                      <span>{roundOff > 0 ? '+' : '−'}₹{Math.abs(roundOff).toFixed(2)}</span>
                    </div>
                  )}
                </div>
              )}

              {gstRegistered && gstBreakdown.gst > 0.004 && (
                <p className="pos-ticket__note">
                  {t('seller.taxable')}: ₹{gstBreakdown.taxable.toFixed(2)} · {t('seller.gst')}: ₹{gstBreakdown.gst.toFixed(2)}
                </p>
              )}

              {/* The line the customer is actually pleased to hear. Only appears when the
                  shop has recorded an MRP above its own selling price. */}
              {mrpSavings > 0 && (
                <p className="mrp-saving-line">{t('seller.mrpSaving', { amount: mrpSavings.toFixed(2) })}</p>
              )}

              <div className="cart-total-bar">
                <span>{t('seller.total')} · {cart.length} {cart.length === 1 ? t('seller.item') : t('seller.itemsInline')}</span>
                <strong className="cart-total-value"><AnimatedNumber value={payable} prefix="₹" /></strong>
              </div>

              {/* Why the bill did not go through, one line above the button that did not
                  work. Nothing else on this screen is read as often as this button, and a
                  refusal explained two panes away is a refusal that reads as a bug. */}
              {error && errorFix && (
                <ProblemNote text={error} fix={errorFix} onFix={() => runFix(errorFix)} className="pos-ticket__problem" />
              )}

              {/* The amount is on the button on purpose: it is the last thing read before
                  committing, and a bare "Create bill" made the cashier's eye travel back up
                  to the total bar to check it every single time. */}
              <button
                type="button"
                className="btn btn-primary pos-ticket__pay"
                disabled={cart.length === 0 || submitting}
                onClick={requestCreateBill}
              >
                {submitting
                  ? t('seller.creatingBill')
                  : cart.length > 0
                  ? `${t('seller.createBill')} · ${money(payable)}`
                  : t('seller.createBill')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* On a phone/tablet the checkout card stops being sticky (see the 1100px block in
          globals.css) and the confirm button ends up far below a long cart — so the total
          and the one action that matters follow the cashier down the page instead. */}
      {cart.length > 0 && !confirmOpen && !scannerOpen && !serviceOpen && !packSetup && !newCustomerOpen && !editCustomer && (
        <div className="pos-paybar">
          <div className="pos-paybar__total">
            <span>{cart.length} {cart.length === 1 ? t('seller.item') : t('seller.itemsInline')}</span>
            <strong>{money(payable)}</strong>
          </div>
          <button type="button" className="btn btn-primary" disabled={submitting} onClick={requestCreateBill}>
            {submitting ? t('seller.creatingBill') : t('seller.createBill')}
          </button>
        </div>
      )}

      {/* The quotation landed. The three things a shopkeeper does next are all one tap
          away: print it, WhatsApp it, or open the list to follow it up. */}
      {quoteSaved && (
        <div className="panel" key={quoteSaved._id}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <CheckCircleIcon size={18} style={{ color: 'var(--success)', flexShrink: 0 }} />
            {quoteSaved.revised
              ? t('seller.quoteRevisedTitle', { number: quoteSaved.number })
              : t('seller.quoteSavedTitle', { number: quoteSaved.number })}
          </h2>
          <p>
            <strong>₹{Number(quoteSaved.total || 0).toFixed(2)}</strong> · {t('seller.quoteNotABill')}
          </p>
          <div className="row-actions" style={{ marginTop: '0.75rem' }}>
            <Link
              href={recordHref('/seller/invoice/[id]', quoteSaved._id, { src: 'estimate' })}
              className="btn btn-primary btn-small"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <ReceiptIcon size={15} /> {t('seller.quotePrint')}
            </Link>
            <button className="btn btn-secondary btn-small" onClick={handleQuoteShare}>
              <WhatsappIcon size={17} /> {t('seller.shareWhatsapp')}
            </button>
            <Link
              href="/seller/estimates"
              className="btn btn-secondary btn-small"
              style={{ textDecoration: 'none' }}
            >
              {t('seller.quoteOpenList')}
            </Link>
            <button className="btn btn-secondary btn-small" onClick={() => setQuoteSaved(null)}>
              {t('common.close')}
            </button>
          </div>
        </div>
      )}

      {/* Moment 1 — the bill landed. `key` is load-bearing: it remounts the panel per
          bill so the entrance animation replays on the next sale instead of firing once
          and then sitting still for the rest of the shift. An offline bill has no _id
          yet, hence the fallbacks. */}
      {receipt && (
        <div
          key={receipt._id || receipt.billNumber || 'offline-receipt'}
          className="panel moment-receipt receipt-result"
          ref={receiptRef}
          style={{ scrollMarginTop: '1rem', position: 'relative' }}
        >
          <span className="moment-burst" aria-hidden="true" />
          <div className="receipt-result-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            {!receipt.offline && (
              <CheckCircleIcon size={18} className="moment-tick" style={{ color: 'var(--success)', flexShrink: 0 }} />
            )}
            {receipt.offline ? t('seller.offlinePendingTitle') : `${t('seller.billNumber')}${receipt.billNumber}`}
          </h2>
          {!receipt.offline && (
              <div className="receipt-result-actions">
                {/* The full A4/A5 document — shop letterhead, GST breakup, signature and
                    paid stamp. The plain text receipt above stays for the counter roll. */}
                <Link
                  href={recordHref('/seller/invoice/[id]', receipt._id)}
                  className="btn btn-primary btn-small"
                  style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  <ReceiptIcon size={15} /> {t('seller.professionalBill')}
                </Link>
                <button className="btn btn-secondary btn-small" onClick={handlePrint}><PrinterIcon size={15} /> {t('seller.printReceiptAction')}</button>
                {biz.runsTables && (
                  <button className="btn btn-secondary btn-small" onClick={handlePrintKot}><PrinterIcon size={15} /> {t('tables.printKot')}</button>
                )}

                <button className="btn btn-secondary btn-small" onClick={handleShare}><WhatsappIcon size={17} /> {t('seller.shareWhatsapp')}</button>
                <RowMenu tip={t('common.moreActions')} items={[
                  { label: t('seller.copyBillLink'), icon: <CopyIcon size={15} />, onClick: handleCopyBillLink },
                ]} />
                <PrinterStatusChip role="receipt" />
              </div>
          )}
          </div>
          <div className="receipt-result-layout">
          <div className="receipt-result-details">
          {receipt.offline && <p className="info-banner">{t('seller.offlinePendingHint')}</p>}
          <div className="receipt-result-items">
          <table>
            <tbody>
              {receipt.items.map((item) => (
                <tr key={item.name}>
                  <td>{item.name}</td>
                  <td className="num">{item.quantity} {item.unit}</td>
                  <td className="num">₹{item.lineTotal.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="receipt-result-total"><strong>{t('seller.total')}: ₹{(receipt.payableTotal ?? receipt.total).toFixed(2)}</strong> ({receipt.paymentMode})</p>

          {/* The money still to be handed back, kept on screen after the cart that
              produced it was cleared. This is the number a busy counter forgets. */}
          {lastTender && (
            <div className="tender-summary">
              <span>{t('seller.tenderReceived', { amount: lastTender.received.toFixed(2) })}</span>
              <strong>{t('seller.tenderChange', { amount: Math.max(0, lastTender.change).toFixed(2) })}</strong>
            </div>
          )}
          {!receipt.offline &&
            (receipt.couponDiscount > 0 ||
              receipt.pointsRedeemedValue > 0 ||
              receipt.billDiscount > 0 ||
              receipt.itemDiscountTotal > 0) && (
              <p style={{ color: 'var(--text-success)' }}>
                {t('seller.discount')}: ₹
                {(
                  (receipt.couponDiscount || 0) +
                  (receipt.pointsRedeemedValue || 0) +
                  (receipt.billDiscount || 0) +
                  (receipt.itemDiscountTotal || 0)
                ).toFixed(2)}{' '}
                · {t('seller.payableTotal')}: ₹{receipt.payableTotal.toFixed(2)}
              </p>
            )}
          {!receipt.offline && Math.abs(receipt.roundOff || 0) >= 0.005 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-base)' }}>
              {t('seller.roundOff')}: {receipt.roundOff > 0 ? '+' : '−'}₹{Math.abs(receipt.roundOff).toFixed(2)}
            </p>
          )}

          {/* The three things a shopkeeper would otherwise only find out at month end,
              said while the customer is still at the counter. */}
          {/* The margin is only stated when the bill's own lines can back it. An item whose
              cost price was never entered is indistinguishable from one that cost nothing,
              so an uncosted bill reads as pure margin — "₹1,240 kamaya" on a sale that made
              ₹80. That is the most believable wrong number in the app, because it lands at
              the exact moment the shopkeeper is thinking about this sale. Same threshold as
              the Munafa card and the WhatsApp day summary. */}
          {billOutcome?.profit !== undefined &&
            (billOutcome.profitCoverage > 0 ? (
              <p className={billOutcome.profit >= 0 ? 'counter-profit' : 'counter-profit loss'}>
                {billOutcome.profit >= 0
                  ? t('seller.billProfit', { amount: billOutcome.profit.toFixed(2) })
                  : t('seller.billLoss', { amount: Math.abs(billOutcome.profit).toFixed(2) })}
                {billOutcome.profitCoverage < 0.8 && (
                  <span className="counter-profit-note">
                    {t('seller.billProfitPartial', { pct: Math.round(billOutcome.profitCoverage * 100) })}
                  </span>
                )}
              </p>
            ) : (
              <p className="counter-profit unknown">{t('seller.billProfitUnknown')}</p>
            ))}
          {billOutcome?.negativeStock?.length > 0 && (
            <p className="error-banner" style={{ marginTop: '0.6rem' }}>
              {t('seller.negativeStockWarn', {
                names: billOutcome.negativeStock.map((row) => `${row.name} (${row.quantity}${row.unit ? ` ${t(`units.${row.unit}`)}` : ''})`).join(', '),
              })}
            </p>
          )}
          {!receipt.offline && receipt.pointsEarned > 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-base)' }}>{t('seller.pointsEarned')}: {receipt.pointsEarned}</p>
          )}
          {!receipt.offline && receipt.gstAmount > 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-base)' }}>
              {t('seller.taxable')}: ₹{receipt.taxableAmount.toFixed(2)} · {t('seller.gst')}: ₹{receipt.gstAmount.toFixed(2)}
            </p>
          )}

          </div>
          {!receipt.offline && receipt.paymentMode === 'upi' && (
            receiptUpiLink ? (
              <div className="receipt-result-qr" ref={receiptQrRef}>
                <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-base)', marginBottom: '0.4rem' }}>{t('seller.scanToPay')}</p>
                <UpiQr key={`${receipt._id}:${receiptUpiLink}`} link={receiptUpiLink} size={180}
                  onLoad={() => {
                    if (receiptQrScrolledRef.current === receipt._id) return;
                    receiptQrScrolledRef.current = receipt._id;
                    receiptQrRef.current?.scrollIntoView({
                      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
                      block: 'center',
                    });
                  }} />
                <strong>{money(receipt.payableTotal ?? receipt.total)}</strong>
              </div>
            ) : (
              <p className="empty-state">{t('seller.upiNotSetHint')}</p>
            )
          )}

          </div>

          {!receipt.offline && (
            <>
              {shareLinks && !shareLinks.whatsappLink && !capturedName && (
                <form className="bill-capture" onSubmit={handleCaptureNumber}>
                  <div className="bill-capture-head">
                    <UsersIcon size={16} />
                    <div>
                      <strong>{t('seller.captureTitle')}</strong>
                      <small>{t('seller.captureHint')}</small>
                    </div>
                  </div>
                  <div className="bill-capture-fields">
                    {/* Asked at the counter with someone waiting, so it carries no label
                        of its own — the strip above already says what it is for. */}
                    <PhoneField
                      className="phone-inline"
                      value={capturePhone}
                      onChange={setCapturePhone}
                      autoComplete="off"
                      placeholder={t('seller.capturePhonePh')}
                      aria-label={t('seller.capturePhonePh')}
                    />
                    <input
                      type="text"
                      autoComplete="off"
                      maxLength={60}
                      value={captureName}
                      onChange={(e) => setCaptureName(e.target.value)}
                      placeholder={t('seller.captureNamePh')}
                      aria-label={t('seller.captureNamePh')}
                    />
                    <button type="submit" className="btn btn-primary btn-small" disabled={capturing || capturePhone.trim().length < 10}>
                      {capturing ? t('common.saving') : t('common.save')}
                    </button>
                  </div>
                  {captureError && <p className="bill-capture-error">{captureError}</p>}
                </form>
              )}
              {capturedName && <p className="bill-capture-done"><CheckCircleIcon size={15} /> {t('seller.captureSaved', { name: capturedName })}</p>}

              <ThermalReceipt receipt={receipt} shop={user} upiLink={receiptUpiLink} billLink={receiptBillLink} t={t} />
              {biz.runsTables && <KotTicket kot={kotSlip?.kot} order={kotSlip?.order} shop={user} t={t} />}
            </>
          )}
        </div>
      )}

      {modifierPickFor && (
        <ModifierPicker
          product={modifierPickFor.product}
          onCancel={() => setModifierPickFor(null)}
          onConfirm={(modifiers) => {
            addToCart(modifierPickFor.product, modifierPickFor.saleUnit, modifierPickFor.quantity, modifiers);
            setModifierPickFor(null);
          }}
        />
      )}

      {/* `#bills` is the address of this register — the Tables floor's "Recent bills"
          shortcut lands here (see the effect that scrolls to it). */}
      <div className="panel bill-register" id="bills">
        <div className="section-title has-actions">
          <div className="section-title__label">
            <div className="icon-badge icon-muted"><ClockIcon size={16} /></div>
            <h2>{t('seller.recentBills')}</h2>
          </div>
          {/* A customer walking back in with yesterday's bill was the one thing this panel
              could not answer — it only ever loaded today, and only by bill number. The box
              now takes whatever the person at the counter actually has: the slip, a name, a
              phone number, or the handset's serial. */}
          <div className="bill-history-controls">
            <form
              className="bill-find wide"
              onSubmit={(e) => {
                e.preventDefault();
                const term = billSearchDraft.trim();
                // A search searches the register, not the day. "Wo teen mahine purana bill
                // nikalo" is the whole reason this box exists, and it would find nothing
                // while the window sat on Today. The range chips move to "All" as it
                // happens, so the widening is visible rather than a hidden special case —
                // and clearing the box puts the shopkeeper back on today's counter.
                setBillFilter({ q: term, preset: term ? 'all' : 'today', from: '', to: '' });
              }}
            >
              {/* A real submit button, not a decorative glyph: on a phone the keypad is the
                  one place a cashier can end up with nothing to press. */}
              <button type="submit" className="icon-btn" data-tip={t('seller.findBill')}>
                <SearchIcon size={17} />
              </button>
              <input
                type="text"
                value={billSearchDraft}
                onChange={(e) => setBillSearchDraft(e.target.value)}
                placeholder={t('seller.findBillPlaceholder')}
                aria-label={t('seller.findBill')}
              />
              {(billSearchDraft || billQuery.q) && (
                <button
                  type="button"
                  className="icon-btn"
                  data-tip={t('common.cancel')}
                  onClick={() => {
                    setBillSearchDraft('');
                    setBillFilter({ q: '', preset: 'today', from: '', to: '' });
                  }}
                >
                  <XIcon size={17} />
                </button>
              )}
            </form>
            <button
              type="button"
              className={`icon-btn${billFiltersOpen || activeBillFilterCount > 0 ? ' active' : ''}`}
              onClick={() => setBillFiltersOpen((open) => !open)}
              data-tip={t('seller.billFilters')}
              aria-label={t('seller.billFilters')}
              aria-expanded={billFiltersOpen}
            >
              <FilterIcon size={17} />
              {activeBillFilterCount > 0 && <span className="icon-btn__badge">{activeBillFilterCount}</span>}
            </button>
            {/* Taking the shop's data out of the building is its own permission, not a
                side effect of being able to read the screen — the route enforces the same
                rule (see the export guard on GET /api/seller/bills). Mirrored here rather
                than assumed from the role, so a munshi the owner has actually trusted with
                `exports` finds the button where it should be. */}
            {canExportBills && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => exportBills('xlsx')}
                disabled={billExporting || billTotal === 0}
                data-tip={t('seller.exportRegister')}
                aria-label={t('seller.exportRegister')}
              >
                <DownloadIcon size={17} />
              </button>
            )}
          </div>
        </div>

        {/* The window, always on screen — a total means nothing without the period it is
            a total of. The narrower filters fold away because most of the day nobody
            needs them. */}
        <div className="bill-register-window">
          <DateRangeFilter
            compact
            presets={BILL_RANGE_PRESETS}
            value={{ preset: billQuery.preset, from: billQuery.from, to: billQuery.to }}
            onChange={(range) => setBillFilter({ preset: range.preset, from: range.from || '', to: range.to || '' })}
          />
        </div>

        {billFiltersOpen && (
          <div className="bill-filter-row">
            <Dropdown
              className="filter-select"
              value={billQuery.paymentMode}
              onChange={(value) => setBillFilter({ paymentMode: value })}
              options={[
                { value: '', label: t('seller.allModes') },
                ...['cash', 'upi', 'card', 'khata', 'split'].map((mode) => ({ value: mode, label: billModeLabel(mode) })),
              ]}
            />
            <Dropdown
              className="filter-select"
              value={billQuery.status}
              onChange={(value) => setBillFilter({ status: value })}
              options={[
                { value: '', label: t('seller.allBills') },
                { value: 'completed', label: t('seller.billStatus.completed') },
                { value: 'returns', label: t('seller.statusWithReturns') },
                // Cancelled bills are hidden everywhere else in the app on purpose; this is
                // the one screen that has to be able to show them, because "wo bill kahan
                // gaya" is exactly what someone asks after a cancellation.
                { value: 'cancelled', label: t('seller.billStatus.cancelled') },
                { value: 'all', label: t('seller.statusIncludingCancelled') },
              ]}
            />
            {counterOptions.length > 1 && (
              <Dropdown
                className="filter-select"
                value={billQuery.counter}
                placeholder={t('seller.allCounters')}
                onChange={(value) => setBillFilter({ counter: value })}
                options={[
                  { value: '', label: t('seller.allCounters') },
                  ...counterOptions.map((row) => ({
                    value: row.counter,
                    label: `${row.counter || '—'} · ${row.count}`,
                  })),
                ]}
              />
            )}
            {cashierOptions.length > 1 && (
              <Dropdown
                className="filter-select"
                value={billQuery.cashier}
                placeholder={t('seller.allCashiers')}
                onChange={(value) => setBillFilter({ cashier: value })}
                options={[
                  { value: '', label: t('seller.allCashiers') },
                  ...cashierOptions.map((row) => ({ value: row.id, label: `${row.name || '—'} · ${row.count}` })),
                ]}
              />
            )}
            {/* "Kis bill ka paisa baaki hai" — the single question the khata screen and the
                billing screen were both half-answering. */}
            <button
              type="button"
              className={`range-chip${billQuery.unpaid ? ' active' : ''}`}
              onClick={() => setBillFilter({ unpaid: !billQuery.unpaid })}
            >
              <WalletIcon size={13} /> {t('seller.onlyUnpaid')}
            </button>
            {activeBillFilterCount > 0 && (
              <button type="button" className="link-btn" onClick={resetBillFilters}>
                {t('seller.clearFilters')}
              </button>
            )}
          </div>
        )}

        {/* The day, in the six numbers a shopkeeper would otherwise count by hand at
            closing time. Computed by the server over everything the filters match, not
            over the rows on this page — a cash column that only added up the visible fifty
            bills would be worse than no cash column at all. */}
        {billSummary && billSummary.count > 0 && (
          <div className="bill-summary">
            <div className="bill-summary__cell">
              <span className="bill-summary__label">{t('seller.summaryBills')}</span>
              <span className="bill-summary__value">{billSummary.count}</span>
              <span className="bill-summary__note">{t('seller.summaryItems', { count: billSummary.items })}</span>
            </div>
            <div className="bill-summary__cell is-lead">
              <span className="bill-summary__label">{t('seller.summaryNet')}</span>
              <span className="bill-summary__value">{rupees(billSummary.net)}</span>
              {billSummary.returned > 0 && (
                <span className="bill-summary__note is-warn">
                  {t('seller.summaryReturned', { amount: rupees(billSummary.returned) })}
                </span>
              )}
            </div>
            {billSummary.byMode
              // Cash and UPI always hold their place so the drawer tally sits in the same
              // spot every day; the rest only appear when the shop actually took money that
              // way in this period.
              .filter((row) => row.amount !== 0 || row.mode === 'cash' || row.mode === 'upi')
              .map((row) => {
                const filterable = ['cash', 'upi', 'card', 'khata'].includes(row.mode);
                const selected = billQuery.paymentMode === row.mode;
                const body = (
                  <>
                    <span className="bill-summary__label">{billModeLabel(row.mode)}</span>
                    <span className="bill-summary__value">{rupees(row.amount)}</span>
                  </>
                );
                return filterable ? (
                  <button
                    type="button"
                    key={row.mode}
                    className={`bill-summary__cell is-tappable${selected ? ' is-on' : ''}`}
                    onClick={() => setBillFilter({ paymentMode: selected ? '' : row.mode })}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="bill-summary__cell" key={row.mode}>
                    {body}
                  </div>
                );
              })}
            {/* Cancelled bills are never inside Sales or the mode split — said here, in
                red, so a missing ₹840 is never a mystery. */}
            {billSummary.cancelled?.count > 0 && (
              <div className="bill-summary__cell is-cancelled">
                <span className="bill-summary__label">{t('seller.summaryCancelled')}</span>
                <span className="bill-summary__value">{rupees(billSummary.cancelled.amount)}</span>
                <span className="bill-summary__note">{t('seller.summaryCancelledNote', { count: billSummary.cancelled.count })}</span>
              </div>
            )}
            {billSummary.unpaid.amount > 0 && (
              <button
                type="button"
                className={`bill-summary__cell is-tappable is-due${billQuery.unpaid ? ' is-on' : ''}`}
                onClick={() => setBillFilter({ unpaid: !billQuery.unpaid })}
              >
                <span className="bill-summary__label">{t('seller.summaryUnpaid')}</span>
                <span className="bill-summary__value">{rupees(billSummary.unpaid.amount)}</span>
                <span className="bill-summary__note">
                  {t('seller.summaryUnpaidBills', { count: billSummary.unpaid.count })}
                </span>
              </button>
            )}
            {billSummary.discount > 0 && (
              <div className="bill-summary__cell">
                <span className="bill-summary__label">{t('seller.summaryDiscount')}</span>
                <span className="bill-summary__value">{rupees(billSummary.discount)}</span>
              </div>
            )}
            {billSummary.gst > 0 && (
              <div className="bill-summary__cell">
                <span className="bill-summary__label">{t('seller.gst')}</span>
                <span className="bill-summary__value">{rupees(billSummary.gst)}</span>
              </div>
            )}
          </div>
        )}

        {/* The shift board. Only earns its place in a shop that actually runs more than one
            till — a one-man kirana never sees it. */}
        {counterOptions.length > 1 && (
          <div className="bill-counter-row">
            {counterOptions.map((row) => (
              <button
                type="button"
                key={row.counter || '—'}
                className={`range-chip${billQuery.counter === row.counter ? ' active' : ''}`}
                onClick={() => setBillFilter({ counter: billQuery.counter === row.counter ? '' : row.counter })}
              >
                <CounterIcon size={13} /> {row.counter || '—'}
                <span className="bill-counter-row__amount">{rupees(row.amount)}</span>
              </button>
            ))}
          </div>
        )}
        {billsLoading ? (
          <SkeletonTable rows={5} cols={7} />
        ) : bills.length === 0 ? (
          <p className="empty-state">
            {billQuery.q
              ? t('seller.noBillFound', { number: billQuery.q })
              : activeBillFilterCount > 0
                ? t('seller.noBillsMatch')
                : billQuery.preset === 'today'
                  ? t('seller.noBills')
                  : t('seller.noBillsInRange')}
          </p>
        ) : (
          <>
            <div className="table-wrap auto-height">
              <table className="data-table" style={{ minWidth: '860px' }}>
                <thead>
                  <tr>
                    <th>{t('seller.billNumber')}</th>
                    <th>{t('seller.customer')}</th>
                    <th className="num">{t('seller.total')}</th>
                    <th>{t('seller.paymentMode')}</th>
                    <th>{t('common.time')}</th>
                    <th>{t('common.status')}</th>
                    <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((bill) => {
                    const due = bill.paymentMode === 'khata' && !bill.settled ? billDue(bill) : 0;
                    const open = openBillId === bill._id;
                    return (
                    <Fragment key={bill._id}>
                    <tr className={[open ? 'is-open' : '', bill.status === 'cancelled' ? 'is-cancelled-row' : ''].filter(Boolean).join(' ') || undefined}>
                      <td className="cell-strong">
                        {/* The number and the way into the bill's contents are the same
                            control: "unhone kya liya tha" is answered here rather than by
                            leaving the billing screen and losing the cart. */}
                        <div className="cell-stack">
                          <button
                            type="button"
                            className="bill-row-toggle"
                            onClick={() => setOpenBillId(open ? null : bill._id)}
                            aria-expanded={open}
                            data-tip={t('seller.viewItems')}
                          >
                            {open ? <ChevronUpIcon size={13} /> : <ChevronDownIcon size={13} />}
                            {bill.billNumber}
                          </button>
                          {(bill.counter || bill.createdByName) && counterOptions.length > 1 && (
                            <span className="cell-sub">{[bill.counter, bill.createdByName].filter(Boolean).join(' · ')}</span>
                          )}
                        </div>
                      </td>
                      {/* The most identifying thing about a bill, and until now the one
                          column the register did not have — a shopkeeper scanning for
                          "Sharma ji ka bill" had only a number to go on. */}
                      <td>
                        {bill.customer ? (
                          <div className="cell-stack">
                            <span className="cell-strong">{bill.customer.name}</span>
                            {bill.customer.phone && <span className="cell-sub">{bill.customer.phone}</span>}
                          </div>
                        ) : (
                          <span className="cell-muted">{t('seller.walkIn')}</span>
                        )}
                      </td>
                      <td className="num cell-strong">
                        <div className="cell-stack">
                          <span className={bill.status === 'cancelled' ? 'amount-struck' : undefined}>₹{(bill.payableTotal ?? bill.total).toFixed(2)}</span>
                          {/* Who took this money off the books, and when — on the row itself. */}
                          {bill.status === 'cancelled' && (
                            <span className="cell-sub amount-out">
                              {t('seller.cancelledByLine', {
                                name: bill.cancelledByName || '—',
                                time: bill.cancelledAt
                                  ? new Date(bill.cancelledAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                                  : '',
                              })}
                            </span>
                          )}
                          {due > 0 && <span className="cell-sub is-warn">{t('seller.stillDue', { amount: due.toFixed(2) })}</span>}
                        </div>
                      </td>
                      {/* Both of these printed the raw database enum — "Upi", "Khata",
                          "partially_returned" — in English, on a screen a shopkeeper may
                          well be reading in Hindi or Marathi. */}
                      <td><span className="badge">{billModeLabel(bill.paymentMode)}</span></td>
                      {/* Once the list can reach past today, the time alone stops
                          identifying a bill — two bills from two days both say 4:12 pm. */}
                      <td className="cell-muted">
                        {billQuery.q || billQuery.preset !== 'today'
                          ? new Date(bill.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                          : new Date(bill.createdAt).toLocaleTimeString('en-IN')}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            bill.status === 'completed' ? 'badge-active' : bill.status === 'cancelled' ? 'badge-danger' : 'badge-pending'
                          }`}
                        >
                          {t(`seller.billStatus.${bill.status}`)}
                        </span>
                      </td>
                      {/* One labelled action and three icons, the same shape the products
                          table already uses. Four full-width buttons per row meant forty
                          buttons on a screen of ten bills, all shouting equally — and the
                          only one a counter reaches for most of the time is the print. */}
                      <td className="tight">
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <Link href={recordHref('/seller/invoice/[id]', bill._id)} className="icon-btn" data-tip={t('seller.invoiceAction')}>
                            <ReceiptIcon size={17} />
                          </Link>
                          {/* "Wahi wala phir se de do." A repeat customer's second visit
                              used to mean finding all six items again by hand — the exact
                              work the search box exists to avoid. Prices come from today's
                              catalog, not from the old bill. */}
                          {bill.status !== 'cancelled' && (
                            <button
                              type="button"
                              className="icon-btn"
                              data-tip={t('seller.repeatBillTitle')}
                              aria-label={t('seller.repeatBill')}
                              onClick={() => repeatBill(bill)}
                            >
                              <CopyIcon size={17} />
                            </button>
                          )}
                          {bill.status !== 'returned' && bill.status !== 'cancelled' && (
                            <button
                              type="button"
                              className={`icon-btn${returnBillId === bill._id ? ' active' : ''}`}
                              data-tip={t('seller.returnItem')}
                              aria-label={t('seller.returnItem')}
                              onClick={() => setReturnBillId(returnBillId === bill._id ? null : bill._id)}
                            >
                              <UndoIcon size={17} />
                            </button>
                          )}
                          {/* Cancelling is the owner's call, so a staff cashier never sees
                              the button — the route refuses them anyway. Red, because it is
                              the one action here that unmakes a sale. */}
                          {user?.role !== 'staff' && bill.status === 'completed' && !bill.returns?.length && (
                            <button
                              type="button"
                              className="icon-btn danger"
                              data-tip={t('seller.cancelBill')}
                              aria-label={t('seller.cancelBill')}
                              onClick={() => handleCancelBill(bill)}
                            >
                              <XIcon size={17} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* A second <tr> rather than a nested table inside one cell: the seven
                        columns above keep their measured widths, so opening a bill doesn't
                        make the whole table jump. */}
                    {open && (
                      <tr className="bill-items-row">
                        <td colSpan={7}>
                          <ul className="bill-items-list">
                            {(bill.items || []).map((item, index) => (
                              <li key={`${item.name}-${index}`}>
                                <span className="bill-items-list__name">
                                  {item.name}
                                  {item.returnedQuantity > 0 && (
                                    <em>{t('seller.itemReturned', { count: item.returnedQuantity })}</em>
                                  )}
                                </span>
                                <span className="bill-items-list__qty">
                                  {item.quantity} {item.unit} × ₹{Number(item.price).toFixed(2)}
                                </span>
                                <span className="bill-items-list__total">₹{Number(item.lineTotal).toFixed(2)}</span>
                              </li>
                            ))}
                          </ul>
                          <div className="bill-items-foot">
                            {(bill.itemDiscountTotal || 0) + (bill.billDiscount || 0) + (bill.couponDiscount || 0) > 0 && (
                              <span>
                                {t('seller.discount')}: ₹
                                {round2((bill.itemDiscountTotal || 0) + (bill.billDiscount || 0) + (bill.couponDiscount || 0)).toFixed(2)}
                              </span>
                            )}
                            {bill.gstAmount > 0 && <span>{t('seller.gst')}: ₹{bill.gstAmount.toFixed(2)}</span>}
                            {Boolean(bill.roundOff) && <span>{t('seller.roundOff')}: ₹{bill.roundOff.toFixed(2)}</span>}
                            {bill.counter && <span>{bill.counter}</span>}
                            {bill.createdByName && <span>{t('seller.registerBilledBy', { name: bill.createdByName })}</span>}
                            {bill.status === 'cancelled' && bill.cancelReason && (
                              <span className="is-warn">{t('seller.cancelledBecause', { reason: bill.cancelReason })}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              compact
              page={billQuery.page}
              pageCount={Math.max(1, Math.ceil(billTotal / billQuery.limit))}
              pageSize={billQuery.limit}
              total={billTotal}
              from={billTotal === 0 ? 0 : (billQuery.page - 1) * billQuery.limit + 1}
              to={Math.min(billQuery.page * billQuery.limit, billTotal)}
              onPageChange={(next) => setBillQuery((current) => ({ ...current, page: next }))}
              onPageSizeChange={(size) => setBillQuery((current) => ({ ...current, limit: size, page: 1 }))}
              label={t('seller.recentBills')}
            />
          </>
        )}
      </div>

      {/* Outside the register's .panel, and that is load-bearing rather than tidiness: the
          panel keeps `transform: translateY(0)` after its fadeInUp (animation-fill-mode is
          `both`), which makes it the containing block for any position:fixed descendant —
          a full-screen overlay nested inside it would size itself to the panel. Keyed on
          the bill, so switching from one bill's return to another's starts the dialog over
          instead of carrying the last bill's line and quantity across. */}
      {returnBillId && (
        <ReturnModal
          key={returnBillId}
          bill={bills.find((b) => b._id === returnBillId)}
          t={t}
          onSubmit={handleReturn}
          onCancel={() => setReturnBillId(null)}
        />
      )}

      {/* The last look before a sale. Everything about how this is laid out lives in
          globals.css under `.bill-confirm` — deliberately, and it is the second time this
          file has had to learn it. The layout used to be written inline here, and the
          consequences were not cosmetic: the card was pinned to 680px while the
          stylesheet was designed around 920px, an inline `flex: 1` on both buttons killed
          the 1:2 emphasis the stylesheet asks for, and no media query could reach any of
          it — which is how the item list ended up 7px tall on a 1280x720 counter screen
          with nothing to say it was there. */}
      {confirmOpen && (() => {
        const q = confirmFilter.trim().toLowerCase();
        const shortages = stockShortages();
        const expired = expiredCartItems();
        const shortageIds = new Set(shortages.map((s) => s.lineId));
        const visible = cart.filter((item) => {
          if (q && !item.name.toLowerCase().includes(q)) return false;
          if (onlyShortages && !shortageIds.has(item.lineId)) return false;
          return true;
        });
        const custName = customers.find((c) => c.id === customerId)?.name;
        // A filter box on a four-item bill is the second-biggest thing on the screen and
        // does nothing. It appears when a cart is long enough to actually need hunting
        // through — and stays once it is in use, so a filter that empties the list can
        // still be cleared.
        const showFilter = cart.length > 6 || Boolean(q) || onlyShortages;
        // A split bill's headline mode says nothing on its own — show the actual breakup
        // in the line the shopkeeper reads just before committing the sale.
        const modeLabel =
          paymentMode === 'split'
            ? splitLines().map((line) => `${t(`expenses.mode.${line.mode}`)} ₹${line.amount.toFixed(2)}`).join(' + ') ||
              t('seller.splitPayment')
            : { cash: t('seller.cash'), upi: t('seller.upi'), card: t('seller.card'), khata: t('nav.khata') }[paymentMode];
        return (
          <div className="modal-overlay modal-overlay--fill" onClick={() => setConfirmOpen(false)}>
            <div className="modal-card bill-confirm" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <h2>{t('seller.confirmBillTitle')}</h2>
                  <p className="bill-confirm__hint">{t('seller.confirmBillHint')}</p>
                </div>
                <button type="button" className="modal-close" onClick={() => setConfirmOpen(false)}>
                  <XIcon size={18} />
                </button>
              </div>

              {/* The count is what makes a clipped row at the bottom edge read as "the
                  list carries on" instead of "the dialog is broken" — which is exactly how
                  it read when the list was two rows tall and said nothing. */}
              <div className="bill-confirm__toolbar">
                <span className="bill-confirm__toolbar-count">
                  <strong>{cart.length}</strong>{' '}
                  {cart.length === 1 ? t('seller.item') : t('seller.itemsInline')}
                </span>
                {showFilter && (
                  <div className="bill-confirm__search">
                    <input
                      type="text"
                      value={confirmFilter}
                      onChange={(e) => {
                        setConfirmFilter(e.target.value);
                        setOnlyShortages(false);
                      }}
                      placeholder={t('seller.searchItemsInBill')}
                      autoFocus={cart.length > 6}
                    />
                  </div>
                )}
              </div>
              {onlyShortages ? (
                <p className="bill-confirm__count bill-confirm__count--warn">
                  {t('seller.showingOnlyShortages', { count: shortages.length })}
                  {' · '}
                  <button type="button" className="link-btn" onClick={() => setOnlyShortages(false)}>
                    {t('seller.showAllItems')}
                  </button>
                </p>
              ) : q ? (
                <p className="bill-confirm__count">
                  {t('seller.confirmItemsCount', { count: visible.length })}
                </p>
              ) : null}

              <div className="bill-confirm__list">
                {visible.map((item, index) => {
                  const stock = availableStock(item.productId);
                  // Compared in shelf units and summed across this product's lines — see
                  // neededStock: 2 strips and 3 loose tablets come off the same shelf.
                  const over = isOverStock(item);
                  const expiredItem = isExpiredCartItem(item);
                  return (
                  <div
                    className={`bill-confirm__row${over || expiredItem ? ' bill-confirm__row--over' : ''}`}
                    key={item.lineId}
                  >
                    <span className="bill-confirm__row-no">{index + 1}</span>
                    <div className="bill-confirm__row-main">
                      <div className="bill-confirm__row-name">{item.name}</div>
                      <div className="bill-confirm__row-meta">
                        {expiredItem ? (
                          // Was hard-coded English, on a screen that ships in ten
                          // languages — the one line on this row that means "do not sell
                          // this" was the one line a Marathi shopkeeper could not read.
                          t('seller.confirmLineExpired')
                        ) : over ? (
                          // Stated in packs, because that is the unit the shelf is counted
                          // in — "only 0.2 tablet left" would be nonsense. "Need" is the
                          // whole cart's demand for this product, not this line's, so two
                          // lines of the same medicine explain the shortfall together
                          // instead of each looking innocent.
                          t('seller.confirmLineShort', {
                            stock,
                            unit: item.packSize ? item.packUnit : item.unit,
                            need: Number((neededStock.get(item.productId) || 0).toFixed(4)),
                          })
                        ) : (
                          // The rate this line is going out at, discount included — the
                          // list price here would disagree with the total two columns to
                          // its right on any line the counter has knocked something off.
                          <>₹{formatSubUnitPrice(effectiveRate(item))} × {item.quantity} {item.unit}</>
                        )}
                      </div>
                    </div>
                    <div className="qty-control qty-control--sm">
                      <button
                        type="button"
                        aria-label={t('seller.shortcutLineQty')}
                        onClick={() => updateQuantity(item.lineId, Math.max(0.001, Math.round((item.quantity - 1) * 1000) / 1000))}
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={item.quantity}
                        onChange={(e) => updateQuantity(item.lineId, Number(e.target.value))}
                      />
                      <button
                        type="button"
                        aria-label={t('seller.shortcutLineQty')}
                        onClick={() => updateQuantity(item.lineId, Math.round((item.quantity + 1) * 1000) / 1000)}
                      >
                        +
                      </button>
                    </div>
                    <div className="bill-confirm__row-amt">
                      <span>₹{lineTotal(item).toFixed(2)}</span>
                      <button type="button" className="icon-btn danger" data-tip={t('seller.remove')} onClick={() => removeFromCart(item.lineId)}>
                        <TrashIcon size={17} />
                      </button>
                    </div>
                  </div>
                  );
                })}
                {visible.length === 0 && (
                  <p className="bill-confirm__empty">{t('seller.noItemsMatch')}</p>
                )}
              </div>

              <div className="bill-confirm__foot">
                {(error || shortages.length > 0 || expired.length > 0) && (
                  expired.length > 0 ? (
                    <div className="bill-confirm__warn bill-confirm__warn--action">
                      <span>{t('seller.expiredCannotBill', { names: expired.map((item) => item.name).join(', ') })}</span>
                      <button type="button" className="btn btn-secondary btn-small" onClick={removeExpiredCartItems}>{t('seller.removeExpired')}</button>
                    </div>
                  ) : (
                  !error && shortages.length > 0 ? (
                    <button
                      type="button"
                      className="bill-confirm__warn-btn"
                      onClick={() => {
                        setConfirmFilter('');
                        setOnlyShortages(true);
                      }}
                    >
                      {t('seller.stockShortWarn', { names: shortages.map((s) => s.name).join(', ') })}
                      {/* The separator sits outside the span: inside it, the underline ran
                          back through the dot and the product name ended flush against it. */}
                      {!onlyShortages && (
                        <>
                          {' · '}
                          <span className="bill-confirm__warn-cta">{t('seller.jumpToRows')}</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <ProblemNote text={error} fix={errorFix} onFix={() => runFix(errorFix)} className="bill-confirm__problem" />
                  )
                  )
                )}
                {/* Lines the shop would lose money on, listed with the actual gap. Not a
                    block and not a silent override — clearing near-expiry stock at a loss
                    is a real thing shops do, so the counter is told and then decides. */}
                {belowCostPrompt && (
                  <div className="bill-confirm__warn below-cost">
                    {/* Written here, not on the server. The API knows the lines and the
                        count; it cannot know the counter is reading the screen in Marathi,
                        so it sends `code` + numbers and the sentence is built in whatever
                        language this dashboard is in. Same rule as lib/apiErrors.js. */}
                    <strong>
                      {belowCostPrompt.lines.length === 1
                        ? t('seller.belowCostOne', { name: belowCostPrompt.lines[0].name })
                        : belowCostPrompt.lines.length > 1
                          ? t('seller.belowCostMany', { count: belowCostPrompt.lines.length })
                          : belowCostPrompt.message}
                    </strong>
                    <ul>
                      {belowCostPrompt.lines.map((line) => (
                        <li key={line.name}>
                          {line.name} — {t('seller.belowCostLine', { sold: line.soldFor.toFixed(2), cost: line.costs.toFixed(2) })}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="bill-confirm__totals">
                  {/* Mode, discount, round-off and GST pair into two columns when the card
                      is wide enough. As four stacked full-width rows at body size they
                      came to 255px — most of the height the item list needed. */}
                  <div className="bill-confirm__meta">
                    <div className="row">
                      <span>{t('seller.paymentMode')}</span>
                      <span>{modeLabel}{custName ? ` · ${custName}` : ''}</span>
                    </div>
                    {(itemDiscountTotal > 0 || billDiscountValue > 0) && (
                      <div className="row discount">
                        <span>{t('seller.discount')}</span>
                        <span>−₹{(itemDiscountTotal + billDiscountValue).toFixed(2)}</span>
                      </div>
                    )}
                    {Math.abs(roundOff) >= 0.005 && (
                      <div className="row">
                        <span>{t('seller.roundOff')}</span>
                        <span>{roundOff > 0 ? '+' : '−'}₹{Math.abs(roundOff).toFixed(2)}</span>
                      </div>
                    )}
                    {gstRegistered && gstBreakdown.gst > 0.004 && (
                      <div className="row">
                        <span>{t('seller.gst')}</span>
                        <span>₹{gstBreakdown.gst.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                  <div className="grand">
                    <span>
                      {t('seller.total')}
                      <span className="bill-confirm__grand-count">
                        {cart.length} {cart.length === 1 ? t('seller.item') : t('seller.itemsInline')}
                      </span>
                    </span>
                    <span>₹{payable.toFixed(2)}</span>
                  </div>
                  {/* Repeated here because this is the screen the cashier is looking at
                      the instant the customer's money is in their hand. */}
                  {paymentMode === 'cash' && cashReceivedValue > 0 && changeDue >= 0 && (
                    <div className="bill-confirm__change">
                      <span>{t('seller.tenderReceived', { amount: cashReceivedValue.toFixed(2) })}</span>
                      <strong>{t('seller.tenderChange', { amount: changeDue.toFixed(2) })}</strong>
                    </div>
                  )}
                </div>
                <div className="bill-confirm__actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setConfirmOpen(false)}>
                    {t('seller.backToEdit')}
                  </button>
                  <button
                    type="button"
                    className={belowCostPrompt ? 'btn btn-danger' : 'btn btn-primary'}
                    disabled={submitting || shortages.length > 0 || expired.length > 0}
                    onClick={() => handleCreateBill({ confirmBelowCost: Boolean(belowCostPrompt) })}
                  >
                    {submitting ? (
                      <>
                        <SpinnerIcon size={17} />
                        {t('seller.creatingBill')}
                      </>
                    ) : belowCostPrompt ? (
                      t('seller.billAnyway')
                    ) : (
                      <>
                        {/* Was a literal "✓" typed into the label, which renders at the
                            font's own weight and baseline and sat visibly low against the
                            button text. Every other glyph in this app comes from Icons.js. */}
                        <CheckIcon size={17} />
                        {t('seller.confirmAndCreate')}
                      </>
                    )}
                  </button>
                </div>
                {/* Both of these have worked since the dialog shipped; neither has ever
                    been mentioned on screen. */}
                <p className="bill-confirm__keys">
                  <kbd>Enter</kbd>
                  <span>{t('seller.confirmKeyConfirm')}</span>
                  <span aria-hidden="true">·</span>
                  <kbd>Esc</kbd>
                  <span>{t('seller.confirmKeyBack')}</span>
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {scannerOpen && (
        <Modal onClose={closeScanner} title={t('seller.scanWithCamera')} maxWidth={380} closeOnBackdrop={false}>
          <div id="barcode-scanner-viewport" style={{ width: '100%' }} />
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', marginTop: '0.5rem' }}>{t('seller.scanHint')}</p>
        </Modal>
      )}

      {/* The screen turned around. A counter QR has to be scannable from the customer's
          side of the till, which a 40px chip in the ticket never was — and the amount has
          to be readable next to it, because "kitna bheju" is the question that follows
          every scan. Guarded on the mode as well as the flag so that switching to Cash
          while it is open cannot leave a UPI code on screen for a cash sale. */}
      {upiQrOpen && paymentMode === 'upi' && counterUpiLink && (
        <Modal
          onClose={() => setUpiQrOpen(false)}
          title={t('seller.showQr')}
          hint={t('seller.scanToPay')}
          maxWidth={340}
        >
          <div className="upi-qr-sheet">
            <UpiQr link={counterUpiLink} size={220} />
            <strong className="upi-qr-sheet__amount">{money(payable)}</strong>
            <span className="upi-qr-sheet__id">{user.upiId}</span>
          </div>
        </Modal>
      )}

      {newCustomerOpen && (
        <QuickCustomerModal onSave={handleQuickAddCustomer} onCancel={() => setNewCustomerOpen(false)} t={t} />
      )}

      {/* Keyed on the customer, so opening the form on a different name after closing it
          once does not hand back the previous name's prefilled fields. */}
      {editCustomer && (
        <QuickCustomerModal
          key={editCustomer.id}
          customer={editCustomer}
          onSave={handleEditCustomer}
          onCancel={() => setEditCustomer(null)}
          t={t}
        />
      )}

      {/* Saving the cart as a quotation. Deliberately a short form: a quote is given while
          somebody is standing there asking for a rate, so it asks only for what a rate needs
          — who it is for, how long it holds, and any condition on it. */}
      {quoteOpen && (
        <Modal
          as="form"
          onSubmit={handleSaveQuote}
          noValidate
          closeOnBackdrop={false}
          onClose={quoteSaving ? undefined : () => setQuoteOpen(false)}
          title={estimateLink?.mode === 'edit' ? t('seller.quoteUpdateTitle') : t('seller.quoteCreateTitle')}
          hint={t('seller.quoteFriendlyHint')}
          className="quote-save-modal"
          maxWidth={720}
          footer={
            <>
              <button type="submit" className="btn btn-primary btn-inline" disabled={quoteSaving}>
                <ClipboardIcon size={17} />{' '}
                {quoteSaving ? t('common.saving') : estimateLink?.mode === 'edit' ? t('seller.quoteUpdate') : t('seller.quoteSave')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" disabled={quoteSaving} onClick={() => setQuoteOpen(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >

            {error && <div className="error-banner" role="alert">{error}</div>}

            {/* The same total bar the ticket shows, so the number being quoted is read in
                the same place and the same shape as the number that would be billed. */}
            <div className="quote-summary">
              <div className="quote-summary-details"><span className="quote-summary-icon" aria-hidden="true"><ClipboardIcon size={22} /></span><div><span className="quote-summary-label">{t('seller.quoteSummaryLabel')}</span><span className="quote-item-count">
                {cart.length} {cart.length === 1 ? t('seller.item') : t('seller.itemsInline')}
              </span></div></div>
              <strong className="quote-summary-amount">₹{payable.toFixed(2)}</strong>
            </div>

            <div className="form-grid cols-2 quote-form-grid">
              {/* A quotation's party is usually NOT in the khata — that is what quoting is.
                  The customer picker on the ticket still wins when one is selected; these two
                  fields are for the person who has not bought anything yet. */}
              {!customerId && (
                <>
                  <div className="field">
                    <label htmlFor="quote-name">{t('seller.quotePartyName')} <span className="quote-optional">{t('seller.quoteOptional')}</span></label>
                    <input
                      id="quote-name"
                      value={quoteForm.contactName}
                      onChange={(e) => setQuoteField('contactName', e.target.value)}
                      onBlur={() => checkQuoteField('contactName')}
                      maxLength={120} aria-invalid={Boolean(quoteFieldErrors.contactName)} aria-describedby={quoteFieldErrors.contactName ? 'quote-error-contactName' : undefined}
                      placeholder={t('seller.quotePartyNamePlaceholder')}
                    />
                    {quoteFieldError('contactName')}
                  </div>
                  <PhoneField
                    id="quote-phone"
                    label={<>{t('seller.quotePartyPhone')} <span className="quote-optional">{t('seller.quoteOptional')}</span></>}
                    value={quoteForm.contactPhone}
                    onChange={(value) => setQuoteField('contactPhone', value)}
                    onBlur={() => checkQuoteField('contactPhone')}
                    error={quoteFieldErrors.contactPhone ? t(quoteFieldErrors.contactPhone) : ''}
                  />
                </>
              )}
              {customerId && (
                <p className="field-hint field-span2">
                  {t('seller.quoteForCustomer', {
                    name: customers.find((c) => c.id === customerId)?.name || '',
                  })}
                </p>
              )}
              <div className="field quote-validity-section">
                <span id="quote-validity-label" className="quote-validity-label">{t('seller.quoteValidityChoice')}</span>
                <div className="segmented quote-validity-switch" role="group" aria-labelledby="quote-validity-label">
                  {['days', 'date'].map((mode) => <button key={mode} type="button"
                    className={quoteForm.validityMode === mode ? 'active' : ''}
                    aria-pressed={quoteForm.validityMode === mode}
                    onClick={() => { setQuoteFieldErrors((errors) => ({ ...errors, validDays: undefined, validUntil: undefined })); setQuoteForm((f) => ({ ...f, validityMode: mode,
                      validUntil: mode === 'date' && f.validityMode === 'days' ? quoteDateForDays(f.validDays) : f.validUntil,
                    })); }}>
                    {t(mode === 'days' ? 'seller.quoteValidityDays' : 'seller.quoteValidityDate')}
                  </button>)}
                </div>
                {quoteForm.validityMode === 'days' ? <>
                  <label htmlFor="quote-valid-days">{t('seller.quoteValidDaysLabel')}</label>
                  <input id="quote-valid-days" type="number" min="1" max={MAX_QUOTE_VALID_DAYS} step="1" required
                    value={quoteForm.validDays} onChange={(e) => setQuoteField('validDays', e.target.value)} onBlur={() => checkQuoteField('validDays')} aria-invalid={Boolean(quoteFieldErrors.validDays)} aria-describedby={quoteFieldErrors.validDays ? 'quote-error-validDays' : undefined} />
                  {quoteFieldError('validDays')}
                  {quoteDateForDays(quoteForm.validDays) && <div className="quote-validity-preview"><span>{t('seller.quoteValidUntil')}</span><strong>{new Date(quoteDateForDays(quoteForm.validDays) + 'T12:00:00+05:30').toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</strong></div>}
                </> : <>
                  <label htmlFor="quote-valid">{t('seller.quoteValidUntil')}</label>
                  <input id="quote-valid" type="date" value={quoteForm.validUntil}
                    onChange={(e) => setQuoteField('validUntil', e.target.value)} onBlur={() => checkQuoteField('validUntil')} aria-invalid={Boolean(quoteFieldErrors.validUntil)} aria-describedby={quoteFieldErrors.validUntil ? 'quote-error-validUntil' : undefined} />
                  {quoteFieldError('validUntil')}
                </>}
                <p className="field-hint">{t('seller.quoteValidHint')}</p>
              </div>
              <div className="field quote-notes-section">
                <label htmlFor="quote-notes">{t('seller.quoteNotes')} <span className="quote-optional">{t('seller.quoteOptional')}</span></label>
                <textarea
                  id="quote-notes"
                  rows={2}
                  maxLength={500}
                  value={quoteForm.notes}
                  onChange={(e) => setQuoteField('notes', e.target.value)} onBlur={() => checkQuoteField('notes')}
                  aria-invalid={Boolean(quoteFieldErrors.notes)} aria-describedby="quote-note-count"
                  placeholder={t('seller.quoteNotesPlaceholder')}
                />
                <div className="quote-note-meta">{quoteFieldError('notes')}<span id="quote-note-count">{quoteForm.notes.length}/500</span></div>
              </div>
            </div>



        </Modal>
      )}

      {packSetup && (
        <PackSetupModal
          item={packSetup}
          product={products.find((p) => p._id === packSetup.productId)}
          onSave={savePackSetup}
          onCancel={() => setPackSetup(null)}
          t={t}
        />
      )}

      {serviceOpen && (
        <Modal
          as="form"
          maxWidth={460}
          onClose={() => setServiceOpen(false)}
          onSubmit={(e) => {
            e.preventDefault();
            addServiceLine(serviceForm);
            setServiceForm(blankCharge());
            setServiceOpen(false);
          }}
          footer={
            <>
              <button type="submit" className="btn btn-primary btn-inline">
                <PlusIcon size={17} /> {t('seller.addToCart')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setServiceOpen(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
          title={t('seller.addCharge')}
          hint={t('seller.addChargeHint')}
        >
            {/* One tap for the charges a counter adds again and again. */}
            <div className="chip-row" style={{ marginBottom: '0.7rem' }}>
              {['labour', 'delivery', 'packing', 'repair', 'installation'].map((preset) => (
                <button
                  type="button"
                  key={preset}
                  className="filter-pill"
                  onClick={() => setServiceForm((f) => ({ ...f, name: t(`seller.charge.${preset}`) }))}
                >
                  {t(`seller.charge.${preset}`)}
                </button>
              ))}
            </div>

            <div className="form-grid">
              <div className="field">
                <label>{t('seller.chargeName')}</label>
                <input
                  value={serviceForm.name}
                  onChange={(e) => setServiceForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={t('seller.chargeNamePlaceholder')}
                  required
                  autoFocus
                />
              </div>
              <div className="field">
                <label>{t('seller.amount')}</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={serviceForm.price}
                  onChange={(e) => setServiceForm((f) => ({ ...f, price: e.target.value }))}
                  required
                />
              </div>
              <div className="field">
                <label>{t('seller.quantity')}</label>
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={serviceForm.quantity}
                  onChange={(e) => setServiceForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>{t('seller.unit')}</label>
                <Dropdown
                  value={serviceForm.unit}
                  onChange={(v) => setServiceForm((f) => ({ ...f, unit: v }))}
                  options={SERVICE_UNITS.map((unit) => ({ value: unit, label: t(`units.${unit}`) }))}
                />
              </div>
              {gstRegistered && (
                <div className="field">
                  <label>{t('seller.gstRate')}</label>
                  <Dropdown
                    value={serviceForm.gstRate}
                    onChange={(v) => setServiceForm((f) => ({ ...f, gstRate: Number(v) }))}
                    options={gstRateOptions(serviceForm.gstRate)}
                  />
                </div>
              )}
            </div>

            <p className="field-hint">{t('seller.chargeNoStock')}</p>
        </Modal>
      )}

      {/* One sheet for the counter, shared by the bill and the quotation. Mounted at the
          end of the tree rather than inside either panel: `.panel` carries a transform from
          its entrance animation, and a transform makes its element the containing block for
          anything `position: fixed` inside it — Modal portals to <body> for exactly that
          reason, and there is no sense putting it somewhere it has to escape from. */}
      {waSheet && <WhatsappSheet {...waSheet} onClose={() => setWaSheet(null)} />}
    </>
  );
}

/**
 * One product in the search results or the quick-pick grid.
 *
 * Lifted out of the page because the two grids render the identical tile — and because
 * the copy that used to sit inline shadowed the `split` payment state with a local
 * `const split = splitPackStock(...)`, which is the kind of thing that reads fine right
 * up until someone adds a line that needs both.
 *
 * A tile that sells loose is a container with two tap targets, not one button — "ek goli
 * chahiye" has to be one tap, not add-the-strip-then-find-the-switch-then-retype. The
 * grid is also the only place the counter learns this product CAN be broken open, so the
 * per-piece price is printed right on it.
 */
function ProductTile({ product, onAdd, pinned, onTogglePin, quantity, active, onHover, t }) {
  const packSize = packSizeOf(product);
  const packs = splitPackStock(product, product.stock);
  return (
    <div
      className={`pos-product-tile${packSize ? ' has-loose' : ''}${pinned ? ' pinned' : ''}${active ? ' active' : ''}`}
      role={onHover ? 'option' : undefined}
      aria-selected={onHover ? Boolean(active) : undefined}
      onMouseEnter={onHover}
    >
      <button
        type="button"
        className="tile-pin"
        aria-pressed={pinned}
        data-tip={pinned ? t('seller.unpinProduct') : t('seller.pinProduct')}
        onClick={() => onTogglePin(product._id)}
      >
        <StarIcon size={13} />
      </button>
      <button type="button" className="tile-add" onClick={() => onAdd(product, undefined, quantity)}>
        <span className="tile-name">{product.name}</span>
        {isExpiredProduct(product) && (
          <span className="tile-meta amount-out">{t('seller.expiredCannotBill', { names: product.name })}</span>
        )}
        {product.recipe?.length ? (
          // A dish: how many its ingredients can make, not a stock figure nobody keeps.
          <span className={`tile-meta${product.servingsPossible === 0 ? ' amount-out' : ''}`}>
            {typeof product.servingsPossible !== 'number'
              ? t('recipe.madeToOrder')
              : product.servingsPossible === 0
                ? t('recipe.dishOutBecause', { name: product.limitingIngredient?.name || '' })
                : t('recipe.dishCanMake', { n: product.servingsPossible })}
          </span>
        ) : (
          <span className="tile-meta">
            {t('seller.stock')}: {packSize && packs.loose > 0
              ? t('pack.stockWithLoose', { packs: packs.packs, unit: t(`units.${product.unit}`), loose: packs.loose, subUnit: t(`units.${product.subUnit}`) })
              : `${product.stock} ${product.unit}`}
          </span>
        )}
        <span className="tile-price">
          ₹{product.price}<small> / {product.unit}</small>
          {/* The multiplier is repeated on the tile itself: the cashier's eye is on the
              product they are about to tap, not on a hint two rows above it. */}
          {quantity > 0 && <em className="tile-qty">× {quantity}</em>}
        </span>
      </button>
      {packSize > 0 && (
        <button
          type="button"
          className="tile-loose"
          onClick={() => onAdd(product, product.subUnit, quantity)}
          data-tip={t('pack.summary', {
            unit: t(`units.${product.unit}`),
            size: packSize,
            subUnit: t(`units.${product.subUnit}`),
            price: formatSubUnitPrice(subUnitPriceOf(product)),
          })}
        >
          <PlusIcon size={12} />
          <span>1 {t(`units.${product.subUnit}`)}</span>
          <strong>₹{formatSubUnitPrice(subUnitPriceOf(product))}</strong>
        </button>
      )}
    </div>
  );
}

/**
 * The rate / discount editor for one cart line.
 *
 * Two ways of saying one thing, side by side, because a counter uses both: "ye chalees ka
 * de do" (a rate) and "dus percent chhod do" (a percentage). Typing in either updates the
 * other and the line total underneath, so the shopkeeper never converts anything in their
 * head while a customer waits.
 *
 * The rate box keeps its own text rather than being driven straight off the cart. Rounding
 * the committed value back into the field mid-keystroke is what makes a controlled number
 * input eat a decimal point ("40." becoming "40" the instant it is typed), so the field is
 * only re-seeded when the number in it genuinely disagrees with the line.
 */
function LinePriceEditor({ item, listRate, effRate, total, onRate, onDiscount, onClose, t }) {
  const [rateText, setRateText] = useState(() => String(round2(effRate)));
  const tooHigh = Number(rateText) > listRate + 0.0001;

  useEffect(() => {
    // A percentage typed in the other box moves the rate, so this field has to follow it.
    // Compared numerically, and never while the typed rate is one the line cannot take —
    // otherwise the refusal would look like the field deleting what was just typed.
    if (!tooHigh && Number(rateText) !== Number(round2(effRate))) setRateText(String(round2(effRate)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effRate]);

  return (
    <div className="cart-line__priceedit">
      <label>
        <span>{t('seller.rateLabel')}</span>
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          autoFocus
          value={rateText}
          onChange={(e) => {
            setRateText(e.target.value);
            onRate(e.target.value);
          }}
        />
      </label>
      <label>
        <span>{t('seller.discountShort')}</span>
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          inputMode="decimal"
          placeholder="0"
          aria-label={t('seller.discountPercent')}
          value={item.discountPercent ?? ''}
          onChange={(e) => onDiscount(e.target.value)}
        />
      </label>
      <span className="cart-line__priceedit-total">
        <small>{t('seller.lineTotalLabel')}</small>
        <strong>₹{total.toFixed(2)}</strong>
      </span>
      <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={onClose}>
        {t('seller.priceEditDone')}
      </button>
      {tooHigh && (
        <p className="cart-line__priceedit-warn">{t('seller.rateAboveList', { price: round2(listRate).toFixed(2) })}</p>
      )}
    </div>
  );
}

/**
 * Adding a customer mid-bill.
 *
 * Deliberately three fields and no more. The khata page's full form (photo, address,
 * GSTIN) is the right place to fill someone in properly; this exists for the thirty
 * seconds where a person is standing at the counter saying "khata pe likh do" and the
 * cart is already half built.
 */
/**
 * The two-field customer form, in both of its moods.
 *
 * `customer` absent: adding somebody who is not in the book yet, which is what this form
 * was built for. `customer` present: correcting the one already on this bill — same three
 * fields, prefilled, so a wrong phone number is fixed where it is noticed instead of on
 * the Khata screen after the cart has been abandoned.
 */
function QuickCustomerModal({ onSave, onCancel, t, customer = null }) {
  const editing = Boolean(customer);
  const [form, setForm] = useState({
    name: customer?.name || '',
    phone: customer?.phone || '',
    // A limit of 0 is "no limit set" in the khata, and printing a literal 0 in the box
    // would make a shopkeeper think one had been set.
    creditLimit: customer?.creditLimit ? String(customer.creditLimit) : '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    setSaving(true);
    try {
      await onSave(form);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      as="form"
      onSubmit={submit}
      onClose={onCancel}
      title={editing ? t('seller.customerEditTitle') : t('seller.quickCustomerAdd')}
      hint={editing ? t('seller.customerEditHint') : t('seller.quickCustomerHint')}
      maxWidth={420}
      footer={
        <>
          <button
            type="submit"
            className="btn btn-primary btn-inline"
            disabled={saving || !form.name.trim() || !form.phone.trim()}
          >
            {saving ? t('common.saving') : editing ? t('common.saveChanges') : t('seller.quickCustomerSave')}
          </button>
          <button type="button" className="btn btn-secondary btn-inline" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        </>
      }
    >

        {message && <p className="error-banner">{message}</p>}

        <div className="field">
          <label htmlFor="qc-name">{t('common.name')}</label>
          <input id="qc-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required autoFocus />
        </div>
        <PhoneField
          id="qc-phone"
          label={t('common.phone')}
          value={form.phone}
          onChange={(value) => setForm((f) => ({ ...f, phone: value }))}
          required
        />
        <div className="field">
          <label htmlFor="qc-limit">{t('seller.creditLimit')}</label>
          <input
            id="qc-limit"
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            value={form.creditLimit}
            onChange={(e) => setForm((f) => ({ ...f, creditLimit: e.target.value }))}
            placeholder="0"
          />
        </div>

    </Modal>
  );
}

// Lines are picked by their position on the bill, not by product id: a charge line has no
// product, and a bill can carry two lines with the same name.
/** How much of a bill line has not been sent back yet. */
function returnableQty(item) {
  return item ? round2((item.quantity || 0) - (item.returnedQuantity || 0)) : 0;
}

/**
 * "Yeh wapas karna hai" — the return, in a dialog of its own.
 *
 * This used to be a panel appended below the bill register. On a screen showing ten bills
 * that meant tapping undo on row three and seeing nothing happen: the form had opened past
 * the bottom of the table, off screen, while the row that was tapped stayed exactly as it
 * was. A return takes money back out of the drawer and puts stock back on the shelf, so it
 * now gets what the bill-confirm already gets — one dialog, the page behind it frozen, and
 * no way to half-do it while looking at something else.
 *
 * The line is picked from the bill itself rather than from a dropdown of names, because
 * which of the six things on the bill is coming back is answered by looking at the qty and
 * the rate — "do wala nahi, ek wala" — and a list of bare product names cannot show that.
 */
function ReturnModal({ bill, t, onSubmit, onCancel }) {
  const items = bill?.items || [];
  // Open on something that can actually be returned; a bill whose first line has already
  // gone back would otherwise open on a line with nothing left in it.
  const firstReturnable = items.findIndex((item) => returnableQty(item) > 0);
  const [lineIndex, setLineIndex] = useState(Math.max(0, firstReturnable));
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  // How the money physically goes back. A khata return needs no answer — the udhaar just
  // shrinks — so the picker only appears when something actually leaves the drawer.
  const [refundMode, setRefundMode] = useState('cash');
  const [busy, setBusy] = useState(false);
  // The server's refusal — stock already moved, bill settled — has to be readable from
  // inside the dialog. The page's own error banner is behind the overlay, which is nowhere.
  const [failure, setFailure] = useState('');

  if (!bill) return null;
  const selected = items[lineIndex] || items[0];
  const remaining = returnableQty(selected);
  const nothingLeft = firstReturnable === -1;
  const isKhata = bill.paymentMode === 'khata';
  // Epsilon, because 0.001-step weights do not compare cleanly — 1.5 kg of a 1.5 kg line
  // must not read as "too many" on a float.
  const tooMany = quantity > remaining + 0.0001;
  const canSubmit = !busy && !nothingLeft && quantity > 0 && !tooMany;

  function chooseLine(index) {
    setLineIndex(index);
    // A quantity carried over from the previous line is how you end up asking to return
    // four of something the customer bought one of.
    const left = returnableQty(items[index]);
    setQuantity(left >= 1 ? 1 : left);
    setFailure('');
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setFailure('');
    // lineIndex is what the server matches on, so it is passed straight through rather
    // than looked up again from the item — two charge lines can share a name.
    const result = await onSubmit(bill._id, selected, lineIndex, quantity, reason, isKhata ? undefined : refundMode);
    // A success closes this dialog from the parent; only a failure comes back here.
    if (!result?.ok) {
      setFailure(result?.message || '');
      setBusy(false);
    }
  }

  // What the customer is actually owed for these units, which on a discounted bill is not
  // the printed line total. Mirrors utils/billTotals.js refundForQuantity so the counter
  // sees the same figure it is about to hand over.
  const paidRatio = bill.total > 0 ? Math.min(1, (bill.payableTotal ?? bill.total) / bill.total) : 1;
  const lineGross = selected ? (selected.price || 0) * quantity : 0;
  const lineDiscountShare =
    selected?.discountAmount && selected.grossLineTotal
      ? (selected.discountAmount * lineGross) / selected.grossLineTotal
      : 0;
  const refundEstimate = Math.max(0, (lineGross - lineDiscountShare) * paidRatio);

  return (
    <Modal
      className="return-modal"
      onClose={onCancel}
      title={t('seller.returnItem')}
      hint={`${t('seller.billNumber')}${bill.billNumber} · ${bill.customer?.name || t('seller.walkIn')} · ₹${(bill.payableTotal ?? bill.total).toFixed(2)}`}
      footer={
        <>
          {!nothingLeft && (
            <button type="button" className="btn btn-primary btn-inline" onClick={submit} disabled={!canSubmit}>
              {busy ? t('common.saving') : t('seller.returnConfirm')}
            </button>
          )}
          <button type="button" className="btn btn-secondary btn-inline" onClick={onCancel}>
            {nothingLeft ? t('common.close') : t('common.cancel')}
          </button>
        </>
      }
    >

        {nothingLeft ? (
          <p className="return-empty">{t('seller.returnNothingLeft')}</p>
        ) : (
          <>
            <p className="return-pick-label">{t('seller.returnPickItem')}</p>
            <div className="return-lines" role="radiogroup" aria-label={t('seller.returnPickItem')}>
              {items.map((item, index) => {
                const left = returnableQty(item);
                const active = index === lineIndex;
                return (
                  <button
                    key={`${item.name}-${index}`}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={left <= 0}
                    className={`return-line${active ? ' is-active' : ''}`}
                    onClick={() => chooseLine(index)}
                  >
                    <span className="return-line__main">
                      <span className="return-line__name">
                        {item.name}
                        {item.kind === 'service' && <em> · {t('seller.chargeTag')}</em>}
                        {item.returnedQuantity > 0 && <em>{t('seller.itemReturned', { count: item.returnedQuantity })}</em>}
                      </span>
                      <span className="return-line__qty">
                        {item.quantity} {item.unit} × ₹{Number(item.price).toFixed(2)}
                      </span>
                    </span>
                    <span className="return-line__state">
                      {left <= 0 ? t('seller.returnFullyReturned') : `₹${Number(item.lineTotal).toFixed(2)}`}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="form-grid cols-2">
              <div className="field">
                <label htmlFor="return-qty">{t('seller.returnQtyComingBack')}</label>
                {/* "Poora hi wapas" is the common case — a whole line coming back — and
                    typing 2.5 by hand to match a weighed line is how a refund goes wrong. */}
                <div className="input-action">
                  <input
                    id="return-qty"
                    type="number"
                    min="0.001"
                    step="0.001"
                    max={remaining || undefined}
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => setQuantity(remaining)}
                    disabled={remaining <= 0}
                  >
                    {t('seller.returnAll')}
                  </button>
                </div>
                <p className={`field-hint${tooMany ? ' field-hint-warn' : ''}`}>
                  {tooMany ? t('seller.returnTooMany', { qty: remaining }) : t('seller.returnRemaining', { qty: remaining })}
                </p>
              </div>
              <div className="field">
                <label htmlFor="return-reason">{t('seller.returnReason')}</label>
                <input
                  id="return-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t('seller.returnReasonPlaceholder')}
                />
              </div>
              {!isKhata && (
                <div className="field">
                  <label>{t('seller.refundMode')}</label>
                  <Dropdown
                    value={refundMode}
                    onChange={setRefundMode}
                    options={['cash', 'upi', 'card', 'bank'].map((mode) => ({ value: mode, label: t(`expenses.mode.${mode}`) }))}
                  />
                </div>
              )}
            </div>

            {/* The number the shopkeeper physically hands over. On any bill with a coupon,
                points or a counter discount this is less than the printed line total —
                which is precisely the case the old code got wrong, refunding the
                undiscounted amount and losing the shop the difference on every single
                discounted return. */}
            <p className="refund-estimate">
              {isKhata
                ? t('seller.refundToKhata', { amount: refundEstimate.toFixed(2) })
                : t('seller.refundEstimate', { amount: refundEstimate.toFixed(2) })}
            </p>
          </>
        )}

        {failure && <div className="error-banner">{failure}</div>}
    </Modal>
  );
}

/**
 * "Packet | Tablet" on one cart line.
 *
 * This two-button switch is the entire answer to the question a chemist's counter asks
 * fifty times a day — "packet mein 15 goli hai, customer ko ek chahiye". Before it, the
 * only ways to bill one tablet were to charge for the whole strip, or to type the
 * arithmetic in by hand as a custom charge line that inventory never saw.
 *
 * Rendered only for products that actually carry a pack size, so nothing appears on the
 * lines of a shop that never sells anything loose.
 */
function PackSwitch({ item, onChange, t }) {
  if (!item.packSize) return null;
  const loose = item.saleUnit === item.subUnit;
  return (
    <div className="pack-switch" role="group" aria-label={t('pack.sellBy')}>
      <button type="button" aria-pressed={!loose} onClick={() => onChange(item.lineId, item.packUnit)}>
        {t(`units.${item.packUnit}`)}
      </button>
      <button type="button" aria-pressed={loose} onClick={() => onChange(item.lineId, item.subUnit)}>
        {t(`units.${item.subUnit}`)}
      </button>
    </div>
  );
}

/**
 * "How many tablets are in one packet?" — asked once, at the counter, the first time it
 * matters.
 *
 * Two fields and nothing else on purpose: the price is not asked for, because the app
 * already knows what the packet costs and can divide. Everything the product form offers
 * beyond this (a loose price of its own, a photo, a batch) can wait for a quieter moment
 * — right now there is a customer at the counter wanting one tablet.
 */
function PackSetupModal({ item, product, onSave, onCancel, t }) {
  const unit = product?.unit || item.unit;
  const suggestions = SUB_UNIT_SUGGESTIONS[unit] || [];
  const [subUnit, setSubUnit] = useState(suggestions[0] || '');
  const [size, setSize] = useState(() => {
    const known = defaultPackSize(unit, suggestions[0]);
    return known ? String(known) : '';
  });

  // Picking a different piece re-answers the count for the pairs that are simply facts —
  // a kilo is a thousand grams whatever the shop sells.
  function chooseSubUnit(value) {
    setSubUnit(value);
    const known = defaultPackSize(unit, value);
    if (known) setSize(String(known));
  }

  const preview = packSizeOf({ unit, subUnit, subUnitsPerUnit: Number(size) })
    ? subUnitPriceOf({ unit, subUnit, subUnitsPerUnit: Number(size) }, product?.price || item.packPrice || item.price)
    : null;

  const options = [
    ...suggestions,
    ...UNITS.filter((u) => u !== unit && !suggestions.includes(u) && !SERVICE_UNITS.includes(u)),
  ].map((u) => ({ value: u, label: t(`units.${u}`) }));

  return (
    <Modal
      as="form"
      maxWidth={460}
      onClose={onCancel}
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ subUnit, subUnitsPerUnit: size });
      }}
      footer={
        <>
          <button type="submit" className="btn btn-primary btn-inline" disabled={!subUnit || !(Number(size) > 1)}>
            {t('common.save')}
          </button>
          <button type="button" className="btn btn-secondary btn-inline" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        </>
      }
      title={t('pack.setUpTitle')}
      hint={t('pack.setUpHint', { name: item.name, unit: t(`units.${unit}`) })}
    >
        <div className="pack-fields" style={{ marginTop: '0.6rem' }}>
          <Dropdown id="setup-sub-unit" value={subUnit} onChange={chooseSubUnit} options={options} />
          <label className="pack-size-field" htmlFor="setup-pack-size">
            <span>{t('pack.packSize', { unit: t(`units.${unit}`) })}</span>
            <input
              id="setup-pack-size"
              type="number"
              min="2"
              step="1"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder={t('pack.packSizePlaceholder')}
              autoFocus
            />
          </label>
        </div>

        {preview !== null && (
          <div className="pack-summary">
            <strong>
              {t('pack.summary', {
                unit: t(`units.${unit}`),
                size: Number(size),
                subUnit: t(`units.${subUnit}`),
                price: formatSubUnitPrice(preview),
              })}
            </strong>
          </div>
        )}

    </Modal>
  );
}
