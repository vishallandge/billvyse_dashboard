'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { flushSync } from 'react-dom';
import { apiFetch } from '../../../lib/api';
import { tableErrorText } from '../../../lib/tableErrors';
import { billMoney } from '../../../lib/billMath';
import { isExpiredProduct } from '../../../lib/productExpiry';
import { tableStockShortage, stockErrorProductId } from '../../../lib/tableStock';
import {
  buildGroups,
  canSplitQuantity,
  formatShareQuantity,
  sectionCharge,
  sectionChargeLine,
  takeawayCharge,
  flatChargeLine,
  tableBillKey,
} from '../../../lib/tableSplit';
import { getShopSocket } from '../../../lib/socket';
import { useDashboardUser, useHiddenNav } from '../../components/DashboardShell';
import { businessType, DEFAULT_BUSINESS_TYPE } from '../../../lib/businessTypes';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { useToast } from '../../components/Toast';
import { printSlip, qrSlotsReady } from '../../../lib/printer/slip';
import PrinterStatusChip from '../../components/PrinterStatusChip';
import { useConfirm } from '../../components/ConfirmDialog';
import { SkeletonStats } from '../../components/Skeleton';
import Dropdown from '../../components/Dropdown';
import PhoneField from '../../components/PhoneField';
import Modal from '../../components/Modal';
import ThermalReceipt from '../../components/ThermalReceipt';
import KotTicket from '../../components/KotTicket';
import ModifierPicker from '../../components/ModifierPicker';
import CustomerQuickAdd from '../../components/CustomerQuickAdd';
import { MenuSearchBox, CategoryRail } from './MenuSearch';
import { SettledBill, SplitSettledBills } from './SettledBills';
import RowMenu from '../../components/RowMenu';
import { searchMenu, MENU_SORTS } from '../../../lib/menuSearch';
import { customerLine, customerOptionLabel } from '../../../lib/customerLabel';
import WhatsappSheet from '../../components/WhatsappSheet';
import { freshFetch } from '../../../lib/freshFetch';
import ManageTables from './ManageTables';
import { FloorTableCard, FloorMap, SeatPicker, FloorLegend, ActionStrip, HowItWorks, TableJourney, TableSeats, GroupPicker, groupLetter, legendKey, seatClassesFor } from './FloorVisuals';
import { tableStage, tablesNeedingAction, mostUrgentStage, seatsAtTable } from '../../../lib/tableStage';
import { useRouter } from 'next/navigation';
import Switch from '../../components/Switch';
import {
  PlusIcon,
  TrashIcon,
  SearchIcon,
  TableIcon,
  ReceiptIcon,
  UsersIcon,
  ClockIcon,
  SwapIcon,
  LayersIcon,
  PrinterIcon,
  EditIcon,
  RupeeIcon,
  WalletIcon,
  CreditCardIcon,
  LedgerIcon,
  ChevronLeftIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  CheckIcon,
  KitchenIcon,
  PackageIcon,
  InfoIcon,
  XIcon,
  GridIcon,
  WhatsappIcon,
  CheckCircleIcon,
} from '../../components/Icons';
import { formatRupees } from '../../../lib/format';

// The restaurant floor. Everything else in this app bills in one shot at the counter; a
// restaurant opens a tab, adds to it over an hour, fires each round to the kitchen, and
// settles once at the end.
//
// Money only becomes real at settlement: this screen creates an ordinary bill from the
// table's items and *then* closes the table (see settleTableOrder on the server for why
// that order matters). Nothing here moves stock — a kitchen's stock is its ingredients.
//
// The floor plan (Table docs) is a separate, persistent thing from a running order
// (TableOrder) — see backend/models/Table.js. A table exists whether anyone is sitting at
// it or not, which is what makes an "available tables" view, a reservation and per-table
// history possible at all.

const TAKEAWAY_TYPES = ['parcel', 'delivery'];
const SPLIT_MODES = ['cash', 'upi', 'card'];
// Per-device count of how often each dish is added, for "Most added" and the empty search.
const MENU_TALLY_KEY = 'bv:menuTally';
const MENU_TALLY_MAX = 200;

function lineTotal(item) {
  return item.price * item.quantity;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatElapsed(from, now) {
  const mins = Math.max(0, Math.floor((now - new Date(from).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}


function describeEvent(event, t) {
  const meta = event.meta || {};
  switch (event.type) {
    case 'opened':
      return t('tables.event.opened');
    case 'item_added':
      return t('tables.event.itemAdded', { count: (meta.items || []).length });
    case 'item_voided':
      return t('tables.event.itemVoided', { name: meta.name || '' });
    case 'kot_sent':
      return t('tables.event.kotSent', { number: meta.number, count: meta.itemCount });
    case 'transferred':
      return t('tables.event.transferred', { from: meta.from, to: meta.to });
    case 'merged':
      return t('tables.event.merged', { table: meta.fromTable, count: meta.itemCount });
    case 'merged_out':
      return t('tables.event.mergedOut', { table: meta.intoTable });
    case 'assigned':
      return meta.staffName ? t('tables.event.assigned', { name: meta.staffName }) : t('tables.event.unassigned');
    case 'joined':
      return t('tables.event.joined', { tables: (meta.tables || []).join(', ') });
    case 'unjoined':
      return t('tables.event.unjoined', { table: meta.table || '' });
    case 'part_settled':
      return t('tables.event.partSettled', { label: meta.label || t('tables.bill'), number: meta.billNumber });
    case 'settled':
      return t('tables.event.settled', { number: meta.billNumber });
    case 'cancelled':
      return t('tables.event.cancelled');
    default:
      return event.type;
  }
}

export default function TablesPage() {
  const user = useDashboardUser();
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();

  const [orders, setOrders] = useState([]);
  const [floorTables, setFloorTables] = useState([]);
  const [products, setProducts] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [error, setError] = useState('');
  const [expiredProductIds, setExpiredProductIds] = useState([]);
  const [stockRejections, setStockRejections] = useState({});
  const [errorTarget, setErrorTarget] = useState(null);
  const orderItemRefs = useRef(new Map());
  const menuItemRefs = useRef(new Map());

  useEffect(() => {
    if (!errorTarget || errorTarget.orderId !== activeId) return;
    const card = orderItemRefs.current.get(errorTarget.productId) || menuItemRefs.current.get(errorTarget.productId);
    if (!card) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'center', inline: 'nearest' });
    card.focus({ preventScroll: true });
  }, [errorTarget, activeId]);
  const [busy, setBusy] = useState('');
  const [now, setNow] = useState(Date.now());

  const [menuQuery, setMenuQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  // How the menu is ordered: best match, most added on this device, price, A–Z.
  const [menuSort, setMenuSort] = useState('relevance');
  // How often each dish is added from this device — what "Most added" and the empty-search
  // suggestions are made of. Per device, like billing's quick picks: it is this counter's
  // habit, read without a server round-trip.
  const [menuTally, setMenuTally] = useState({});
  // The count typed with a dish ("2 naan") waits here while its modifiers are picked.
  const pendingQtyRef = useRef(1);
  const [modifierPickFor, setModifierPickFor] = useState(null); // product | null
  // "no onion", "less spicy" — the model, the API and the printed KOT have always carried
  // an item note; until now there was no way for a waiter to actually type one.
  const [noteEditingId, setNoteEditingId] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [guestEditing, setGuestEditing] = useState(false);
  const [kotHistoryOpen, setKotHistoryOpen] = useState(false);
  const [orderNoteDraft, setOrderNoteDraft] = useState('');

  // "Available table → seat or reserve" and "typed a name" both end up opening an order.
  const [floorModal, setFloorModal] = useState(null); // { table, mode: 'seat' | 'reserve' }
  const [floorModalForm, setFloorModalForm] = useState({ guestCount: '', customerName: '', customerPhone: '', time: '', note: '', joinIds: [], chairs: [] });

  // Section settings (AC / Non-AC / Rooftop…) — only zones a shop has given a charge to.
  const [zoneSettings, setZoneSettings] = useState([]);
  // Which section this device looks at. Per device: the waiter who works the AC hall
  // wants only the AC hall on their phone, the owner at the counter wants everything.
  const [zoneFilter, setZoneFilter] = useState('');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('bv:floorZone');
      if (saved) setZoneFilter(saved);
    } catch {}
  }, []);
  function changeZoneFilter(next) {
    setZoneFilter(next);
    try { localStorage.setItem('bv:floorZone', next); } catch {}
  }

  // Pushing more tables onto the running party.
  const [joinPicking, setJoinPicking] = useState(false);
  const [joinPick, setJoinPick] = useState([]);
  // The section charge on this table's bill. On by default; a customer who objects gets it
  // taken off with one switch — it is never a charge the counter can't remove.
  const [chargeOn, setChargeOn] = useState(true);
  // The parcel/delivery charge on this order (models/FloorSettings.js): on by default, off
  // with one switch for a regular, and the amount can be typed for this one order — a
  // delivery two streets away and one across town are not the same trip.
  const [takeawaySettings, setTakeawaySettings] = useState(null);
  const [takeawayOn, setTakeawayOn] = useState(true);
  const [takeawayDraft, setTakeawayDraft] = useState('');
  const [quickName, setQuickName] = useState('');
  const [quickGuests, setQuickGuests] = useState('');
  const [takeawayForm, setTakeawayForm] = useState({ orderType: 'parcel', label: '', guestCount: '', customerName: '', customerPhone: '' });

  const [takeawayOpen, setTakeawayOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  // Where Manage Tables opens: its overview, or straight on "add tables" from the empty floor.
  const [manageStart, setManageStart] = useState(null);
  // The chair(s) the waiter is taking an order from — every dish tapped goes to them. One
  // chair: that person's dish. Several: a dish those chairs share (the pizza 1 and 3
  // split). None: for the whole table. Reset whenever a different table is opened.
  const [seatPicks, setSeatPicks] = useState([]);
  const toggleSeat = (seat) => setSeatPicks((list) => (list.includes(seat) ? list.filter((s) => s !== seat) : [...list, seat].sort((a, b) => a - b)));
  // What to send for the current pick: one chair as `seat`, several as `seats`.
  const seatingPayload = () => (seatPicks.length === 1 ? { seat: seatPicks[0] } : seatPicks.length > 1 ? { seats: seatPicks } : {});

  // Strangers sharing one table: which table's groups are being picked from, and the
  // "seat a new group here" form.
  const [groupPickFor, setGroupPickFor] = useState(null); // tableId | null
  const [shareFor, setShareFor] = useState(null); // table | null
  const [shareForm, setShareForm] = useState({ guests: 1, name: '', phone: '', fix: {} });

  // Tiles (every table as a card) or the map (the room from above). Per device: the host
  // at the door wants the map, the waiter on a phone wants tiles.
  const [floorView, setFloorView] = useState('grid');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('bv:floorView');
      if (saved === 'map' || saved === 'grid') setFloorView(saved);
    } catch {}
  }, []);
  // Arranging the map: drag tables to where they stand in the room. Owner/manager only.
  const [mapEdit, setMapEdit] = useState(false);

  // One drag, one save. Shown where it was dropped at once; put back if the save fails.
  async function moveTableOnMap(table, pos) {
    setFloorTables((list) => list.map((tb) => (tb._id === table._id ? { ...tb, ...pos } : tb)));
    try {
      await apiFetch(`/api/seller/floor-tables/${table._id}`, { method: 'PATCH', body: JSON.stringify(pos) });
    } catch (err) {
      toast.error(tableErrorText(err, t));
      await loadFloorTables();
    }
  }

  function changeFloorView(next) {
    if (next !== 'map') setMapEdit(false);
    setFloorView(next);
    try { localStorage.setItem('bv:floorView', next); } catch {}
  }

  // Tap a colour in the legend to see only those tables — "where is food waiting?".
  const [stageFilter, setStageFilter] = useState('');
  // The four-picture guide: shown until someone says they've got it, per device.
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem('bv:tablesGuideSeen') !== '1') setGuideOpen(true);
    } catch {
      setGuideOpen(true);
    }
  }, []);
  function closeGuide() {
    setGuideOpen(false);
    try { localStorage.setItem('bv:tablesGuideSeen', '1'); } catch {}
  }
  const router = useRouter();
  // The same rule the server holds floor-plan writes to: the owner, or a manager (billing +
  // inventory). A waiter still sees Manage Tables, read-only.
  const canEditFloor = !user || user.role !== 'staff'
    || (Array.isArray(user.permissions) && user.permissions.includes('billing') && user.permissions.includes('inventory'));
  // Settled table bills live in the bill register on the billing screen. The shortcut is
  // shown only to someone that screen will open for — a waiter without billing would be
  // handed a 403, and a switched-off module is not a door either.
  const hiddenNav = useHiddenNav();
  const canSeeBills = !hiddenNav.includes('billing')
    && (!user || user.role !== 'staff' || (Array.isArray(user.permissions) && user.permissions.includes('billing')));

  const [transferPicking, setTransferPicking] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [mergePicking, setMergePicking] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');

  const [settleMode, setSettleMode] = useState('cash');
  const [settleCustomerId, setSettleCustomerId] = useState('');
  const [split, setSplit] = useState({ cash: '', upi: '', card: '' });
  const [billDiscountPercent, setBillDiscountPercent] = useState('');
  const [billDiscountAmount, setBillDiscountAmount] = useState('');
  // { bill, upiLink, customer: {id,name,phone}|null } — the customer is kept beside the bill
  // because the bill comes back with only the customer's id.
  const [settledReceipt, setSettledReceipt] = useState(null);
  // Adding a customer without leaving the bill: null, or { target: 'settle' | guest index }.
  const [customerAddFor, setCustomerAddFor] = useState(null);
  // The bill the hidden thermal slip is drawn for — whichever one was last sent to print,
  // so printing one split bill never replaces the settled panel on screen.
  const [slip, setSlip] = useState(null);
  const [waSheet, setWaSheet] = useState(null);
  // Whatever the super admin switched off is not offered here either.
  const [whatsappOn, setWhatsappOn] = useState(true);
  const [kotToPrint, setKotToPrint] = useState(null);
  // Whether firing a round also prints its slip. Per device, not per shop: it is the
  // phone or counter PC with a printer beside it that wants the slip, while the owner's
  // phone and a kitchen that works off the Kitchen screen do not. On by default, because
  // "send to kitchen" with no paper coming out is what a dhaba counter reads as broken.
  const [kotAutoPrint, setKotAutoPrint] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem('bv:kotAutoPrint') === '0') setKotAutoPrint(false);
    } catch {}
  }, []);
  function changeKotAutoPrint(next) {
    setKotAutoPrint(next);
    try { localStorage.setItem('bv:kotAutoPrint', next ? '1' : '0'); } catch {}
  }

  // Splitting the CHECK by guest, not the payment tender — see SPLIT_MODES/settleMode
  // above for that. Each guest here becomes a genuinely separate bill through the same
  // POST /api/seller/bills flow a normal sale uses, so GST/stock/invoice numbering never
  // learn a new code path; this state only decides which items go in which guest's bill.
  const [guestSplitOpen, setGuestSplitOpen] = useState(false);
  const [splitGuestCount, setSplitGuestCount] = useState(2);
  // itemId -> { to } | { share } | { qty: [] } — see lib/tableSplit.js.
  const [allocation, setAllocation] = useState({});
  const [groupNames, setGroupNames] = useState({}); // guestIndex -> "Friends", "Rahul"
  const [guestModes, setGuestModes] = useState({}); // guestIndex -> paymentMode
  const [guestCustomers, setGuestCustomers] = useState({}); // guestIndex -> khata customerId
  const [splitSettledReceipts, setSplitSettledReceipts] = useState([]); // [{bill, upiLink}]

  function load() {
    return apiFetch('/api/seller/table-orders')
      .then((data) => setOrders(data.orders || []))
      .catch((err) => setError(tableErrorText(err, t)));
  }

  function loadFloorTables() {
    return apiFetch('/api/seller/floor-tables')
      .then((data) => {
        setFloorTables(data.tables || []);
        setZoneSettings(data.zones || []);
        setTakeawaySettings(data.takeaway || null);
      })
      .catch((err) => setError(tableErrorText(err, t)));
  }

  useEffect(() => {
    Promise.all([load(), loadFloorTables()]).finally(() => setLoading(false));
    apiFetch('/api/seller/products').then((d) => setProducts(d.products || [])).catch(() => {});
    apiFetch('/api/seller/staff/list').then((d) => setStaffList(d.staff || [])).catch(() => {});
    apiFetch('/api/seller/khata/customers').then((d) => setCustomers(d.customers || [])).catch(() => {});
    // Same cached copy the sidebar reads — see lib/freshFetch.js.
    freshFetch('/api/seller/modules', { ttl: 60000 })
      .then((result) => setWhatsappOn(result.modules?.whatsapp !== false))
      .catch(() => {});
  }, []);

  // A closed khata is still in the list the API returns, but every bill refuses it — so it
  // is never offered as something to bill to.
  const billableCustomers = useMemo(() => customers.filter((c) => c.isActive !== false), [customers]);
  const customerOptions = useMemo(
    () => billableCustomers.map((c) => ({ value: c.id, label: customerOptionLabel(c) })),
    [billableCustomers],
  );

  // The khata customer on a typed phone number, matched on its last ten digits the way the
  // server matches it ("+91 98765 43210" and "9876543210" are one person).
  function customerForPhone(phone) {
    const key = String(phone || '').replace(/\D/g, '').slice(-10);
    if (key.length < 10) return null;
    return billableCustomers.find((c) => String(c.phone || '').replace(/\D/g, '').slice(-10) === key) || null;
  }

  function customerById(id) {
    return id ? customers.find((c) => c.id === id) || null : null;
  }

  // A customer just added (or found already on that number) from inside a bill: into the
  // list, and onto the bill that asked for them.
  function handleCustomerAdded(customer) {
    if (!customer?.id) return;
    setCustomers((list) => (list.some((c) => c.id === customer.id) ? list : [customer, ...list]));
    if (customerAddFor?.target === 'settle') setSettleCustomerId(customer.id);
    else if (Number.isInteger(customerAddFor?.target)) {
      setGuestCustomers((map) => ({ ...map, [customerAddFor.target]: customer.id }));
    }
  }

  // What the quick-add form opens with: the name and number the party was seated under, so
  // the waiter is not asked to type them twice. Only for the whole table's bill — a split
  // bill is one person out of that party, and handing them the host's number would put
  // the friend's bill on the host's khata.
  function customerPrefill(target) {
    if (target !== 'settle') return null;
    return { name: active?.customerName || '', phone: active?.customerPhone || '' };
  }

  // The clock a table's occupancy timer runs on — cheap to tick, and the only thing that
  // needs to force a re-render with nothing having actually changed on the server.
  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); if (!document.hidden) { load(); loadFloorTables(); } }, 15000);
    return () => clearInterval(id);
  }, []);

  // Two waiters on two phones have to see the same floor. A KOT fired from one screen is
  // also the one moment worth interrupting whoever else is looking, so it gets a toast; the
  // rest just refresh quietly.
  useEffect(() => {
    const socket = getShopSocket();
    if (!socket) return undefined;
    const refresh = () => {
      load();
      loadFloorTables();
    };
    const onKot = (payload) => {
      refresh();
      toast.info(`${t('tables.kot')} ${payload.number} · ${payload.tableName}`);
    };
    const events = ['connect', 'table:opened', 'table:updated', 'table:settled', 'table:transferred', 'table:merged', 'table:assigned', 'table:reserved', 'floor:changed'];
    events.forEach((e) => socket.on(e, refresh));
    socket.on('kot:sent', onKot);
    // The kitchen answered "can you still stop it?" — the waiter needs that before the
    // customer asks again.
    const onAnswer = (payload) => {
      refresh();
      if (payload.decision === 'stopped') toast.success(t('tables.change.kitchenStopped', { name: payload.name, table: payload.tableName }));
      else toast.info(t('tables.change.kitchenMade', { name: payload.name, table: payload.tableName }));
    };
    socket.on('kitchen:cancel-answer', onAnswer);
    return () => {
      events.forEach((e) => socket.off(e, refresh));
      socket.off('kot:sent', onKot);
      socket.off('kitchen:cancel-answer', onAnswer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = useMemo(() => orders.find((o) => o._id === activeId) || null, [orders, activeId]);

  // Keyed on the order id, not on `active`, so a socket refresh arriving mid-typing does
  // not yank the note field out from under whoever is typing in it.
  useEffect(() => {
    const order = orders.find((o) => o._id === activeId);
    setOrderNoteDraft(order?.note || '');
    // A different table is a different customer: its own charge decision, no half-built
    // split or join picker carried over from the last one.
    setChargeOn(true);
    setTakeawayOn(true);
    setTakeawayDraft('');
    setJoinPicking(false);
    setJoinPick([]);
    setGuestSplitOpen(false);
    setSeatPicks([]);
    // How the last table paid, its discount and its customer are that table's — carried
    // over, T2 would settle on T1's khata customer or with T1's 10% off.
    setSettleMode('cash');
    setSplit({ cash: '', upi: '', card: '' });
    setBillDiscountPercent('');
    setBillDiscountAmount('');
    // The party was seated under a phone number: if that number is already in the khata,
    // the bill starts on them, so "send the bill" has someone to go to without a search.
    setSettleCustomerId(customerForPhone(order?.customerPhone)?.id || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
  const takeawayOrders = useMemo(() => orders.filter((o) => o.orderType !== 'dine_in'), [orders]);
  // Every floor table under a running party — its main table AND any pushed alongside it,
  // so a joined table reads occupied everywhere (tile, stats, transfer and join pickers).
  const orderByTableId = useMemo(() => {
    const map = new Map();
    for (const o of orders) {
      if (o.table) map.set(String(o.table), o);
      for (const joined of o.joinedTables || []) if (joined.table) map.set(String(joined.table), o);
    }
    return map;
  }, [orders]);

  const zones = useMemo(() => {
    const map = new Map();
    for (const table of floorTables) {
      if (!table.isActive) continue;
      const zone = table.zone || 'Main';
      if (!map.has(zone)) map.set(zone, []);
      map.get(zone).push(table);
    }
    return Array.from(map.entries());
  }, [floorTables]);

  const zoneConfig = useMemo(() => new Map(zoneSettings.map((z) => [z.name, z])), [zoneSettings]);

  /**
   * What each running table will actually be billed: its dishes, plus its section charge
   * (AC 10%) or its parcel/delivery charge, rounded the way this shop rounds — the same
   * arithmetic the ticket and the saved bill use.
   *
   * Tiles and the floor's running total used to add up the dishes alone, so a table read
   * ₹500 on the floor and printed ₹550 on the bill — "table mein alag, bill mein alag",
   * which is exactly the kind of gap that costs an owner's trust. A bill discount is not
   * known until the bill is made, so it is the one thing not in here.
   */
  const toPayById = useMemo(() => {
    const roundOn = user?.billingSettings?.roundOff !== false;
    const map = new Map();
    for (const o of orders) {
      const lines = (o.items || []).map((item) => ({ item, quantity: item.quantity }));
      let extra = 0;
      if (o.orderType === 'dine_in') {
        const zone = o.table ? floorTables.find((tb) => String(tb._id) === String(o.table))?.zone || 'Main' : null;
        const pct = zone ? zoneConfig.get(zone)?.chargePercent || 0 : 0;
        if (pct > 0) extra = sectionCharge(lines, pct).amount;
      } else {
        const flat = takeawayCharge(o.orderType, takeawaySettings, lines);
        if (flat && !flat.free) extra = Number(flat.amount) || 0;
      }
      const money = billMoney({
        lines: [
          ...lines.map(({ item, quantity }) => ({ price: item.price, quantity })),
          ...(extra > 0 ? [{ price: extra, quantity: 1 }] : []),
        ],
        roundOff: roundOn,
      });
      map.set(o._id, money.payable);
    }
    return map;
  }, [orders, floorTables, zoneConfig, takeawaySettings, user]);
  // The orders the floor DRAWS, each carrying `toPay`. Everything else keeps `orders`.
  const pricedOrders = useMemo(
    () => orders.map((o) => ({ ...o, toPay: toPayById.has(o._id) ? toPayById.get(o._id) : o.subtotal })),
    [orders, toPayById]
  );
  function chargeLabelFor(zone) {
    const cfg = zoneConfig.get(zone);
    return cfg?.chargeLabel || t('tables.sectionChargeDefault', { zone });
  }

  // A saved filter for a section that has since been renamed or emptied shows everything
  // rather than a blank floor that looks like the restaurant lost its tables.
  const visibleZones = useMemo(
    () => (zoneFilter && zones.some(([zone]) => zone === zoneFilter) ? zones.filter(([zone]) => zone === zoneFilter) : zones),
    [zones, zoneFilter]
  );
  function freeIn(tables) {
    return tables.filter((tb) => !orderByTableId.has(String(tb._id)) && !tb.reservation).length;
  }

  // The section this table is sitting in, and what that section charges. Parcel and
  // delivery orders sit nowhere, so they never carry one.
  const activeZone = useMemo(() => {
    if (!active || active.orderType !== 'dine_in' || !active.table) return null;
    return floorTables.find((tb) => String(tb._id) === String(active.table))?.zone || 'Main';
  }, [active, floorTables]);
  const chargePercent = activeZone ? zoneConfig.get(activeZone)?.chargePercent || 0 : 0;
  const chargeLabel = activeZone ? chargeLabelFor(activeZone) : '';
  const chargeActive = chargePercent > 0 && chargeOn;

  // Parcel and delivery orders sit in no section, so this is their charge instead.
  const takeawayBase = active && active.orderType !== 'dine_in'
    ? takeawayCharge(active.orderType, takeawaySettings, (active.items || []).map((item) => ({ item, quantity: item.quantity })))
    : null;
  const takeawayLabel = !takeawayBase
    ? ''
    : takeawayBase.kind === 'parcel'
      ? takeawaySettings?.parcelLabel || t('tables.parcelChargeDefault')
      : takeawaySettings?.deliveryLabel || t('tables.deliveryChargeDefault');
  const takeawayTyped = takeawayDraft.trim() === '' ? NaN : Number(takeawayDraft);
  const takeawayAmount = takeawayBase && takeawayOn && !takeawayBase.free
    ? round2(Number.isFinite(takeawayTyped) && takeawayTyped >= 0 ? takeawayTyped : takeawayBase.amount)
    : 0;

  // Free tables the running party could spread onto — the same zone first, because the
  // table you push over is the one next to you.
  const joinableTables = useMemo(() => {
    const list = floorTables.filter((tb) => tb.isActive && !orderByTableId.has(String(tb._id)) && !tb.reservation);
    const zone = floorModal?.table?.zone || activeZone;
    const exclude = String(floorModal?.table?._id || '');
    return list
      .filter((tb) => String(tb._id) !== exclude)
      .sort((a, b) => ((a.zone === zone ? 0 : 1) - (b.zone === zone ? 0 : 1)) || a.zone.localeCompare(b.zone) || (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [floorTables, orderByTableId, floorModal, activeZone]);

  const categories = useMemo(
    // Only categories with a live dish — an archived menu's category would sit on the rail
    // as an empty pill.
    () => Array.from(new Set(products.filter((p) => p.status !== 'archived').map((p) => p.category).filter(Boolean))).sort(),
    [products]
  );

  /**
   * What a manager walking past the screen needs in one glance, and what this screen never
   * showed: how much of the floor is working, how much money is sitting on it unbilled, and
   * whether anything is waiting on the kitchen. Counting seats rather than only tables,
   * because "4 of 12 tables" and "22 of 48 covers" are different answers to "how full am I".
   */
  const floorStats = useMemo(() => {
    const activeTables = floorTables.filter((tb) => tb.isActive);
    let occupied = 0;
    let reserved = 0;
    let seatsTaken = 0;
    for (const table of activeTables) {
      const order = orderByTableId.get(String(table._id));
      const groups = orders.filter((o) => String(o.table) === String(table._id));
      if (groups.length > 1) {
        occupied += 1;
        seatsTaken += seatsAtTable(table.capacity, groups).taken;
      } else if (order) {
        occupied += 1;
        seatsTaken += order.guestCount || table.capacity || 0;
      } else if (table.reservation) {
        reserved += 1;
      }
    }
    // What the running tables will be BILLED, not just their dishes — see toPayById.
    const running = pricedOrders.reduce((sum, o) => sum + (o.toPay || 0), 0);
    const awaitingKitchen = orders.reduce((sum, o) => sum + (o.pendingItemCount || 0), 0);
    // Already with the kitchen and not yet served — what the Kitchen link's badge shows.
    // Distinct from awaitingKitchen above, which is "typed but not fired yet".
    const onFire = orders.reduce((sum, o) => sum + (o.kitchenActiveCount || 0), 0);
    return {
      total: activeTables.length,
      occupied,
      reserved,
      free: activeTables.length - occupied - reserved,
      seatsTaken,
      seatsTotal: activeTables.reduce((sum, tb) => sum + (tb.capacity || 0), 0),
      running,
      awaitingKitchen,
      onFire,
    };
  }, [floorTables, orderByTableId, orders, pricedOrders]);

  // Every table's stage, read once per render so the tiles, the legend counts and the
  // "do this now" strip can never disagree with each other.
  // The groups sitting at each table as its MAIN table — one for an ordinary party, two or
  // more when strangers share it. A table pushed onto another party is tracked separately.
  const ordersByTable = useMemo(() => {
    const map = new Map();
    for (const o of pricedOrders) {
      if (!o.table || o.orderType !== 'dine_in') continue;
      const key = String(o.table);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(o);
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(a.groupLabel || 'A').localeCompare(String(b.groupLabel || 'A')) || new Date(a.createdAt) - new Date(b.createdAt));
    }
    return map;
  }, [pricedOrders]);

  const stagesByOrder = useMemo(() => {
    const map = new Map();
    for (const o of orders) map.set(o._id, tableStage(o, null, now));
    return map;
  }, [orders, now]);

  const floorEntries = useMemo(() => {
    const byTable = new Map();
    for (const table of floorTables) {
      if (!table.isActive) continue;
      const id = String(table._id);
      const tableOrders = ordersByTable.get(id) || [];
      const holder = orderByTableId.get(id);
      const joinedOrder = tableOrders.length === 0 && holder && String(holder.table) !== id ? holder : null;
      const stage = tableOrders.length > 0
        ? mostUrgentStage(tableOrders.map((o) => stagesByOrder.get(o._id)))
        : joinedOrder
          ? stagesByOrder.get(joinedOrder._id)
          : tableStage(null, table, now);
      byTable.set(id, {
        table,
        orders: tableOrders,
        joinedOrder,
        stage,
        seatInfo: seatsAtTable(table.capacity, tableOrders),
      });
    }
    return byTable;
  }, [floorTables, ordersByTable, orderByTableId, stagesByOrder, now]);

  const legendCounts = useMemo(() => {
    const counts = {};
    for (const { joinedOrder, stage } of floorEntries.values()) {
      // A table pushed onto another party counts once, on the main table.
      if (joinedOrder) continue;
      const key = legendKey(stage.key);
      counts[key] = (counts[key] || 0) + 1;
    }
    for (const order of takeawayOrders) {
      const key = legendKey(tableStage(order, null, now).key);
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [floorEntries, takeawayOrders, now]);

  const needsAction = useMemo(
    () => tablesNeedingAction(orders.map((order) => ({ order, stage: tableStage(order, null, now) }))),
    [orders, now]
  );
  const activeStage = active ? tableStage(active, null, now) : null;

  // Dishes ordered from each chair — the badge on that chair in the picker. A dish two
  // chairs share counts on both.
  const seatCounts = useMemo(() => {
    const counts = {};
    for (const item of active?.items || []) {
      for (const seat of item.seats?.length ? item.seats : item.seat ? [item.seat] : []) counts[seat] = (counts[seat] || 0) + 1;
    }
    return counts;
  }, [active]);
  const seatsOf = (item) => (item.seats?.length ? item.seats : item.seat ? [item.seat] : []);
  // The ticket read the way food is served: chair 1, chair 2 … then what is for the table.
  // A table where nobody picked a chair stays one plain list, exactly as before.
  const ticketGroups = useMemo(() => {
    const items = active?.items || [];
    if (!items.some((it) => it.seat || it.seats?.length)) return [{ seats: [], items, plain: true }];
    const byKey = new Map();
    for (const it of items) {
      const seats = it.seats?.length ? it.seats : it.seat ? [it.seat] : [];
      const key = seats.join('+');
      if (!byKey.has(key)) byKey.set(key, { seats, items: [] });
      byKey.get(key).items.push(it);
    }
    // One chair at a time in order, then dishes a few chairs shared, then the whole table.
    const rank = (g) => (g.seats.length === 0 ? [2, 0] : g.seats.length === 1 ? [0, g.seats[0]] : [1, g.seats[0]]);
    return Array.from(byKey.values()).sort((a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1]);
  }, [active]);

  // Moves a dish to the chair(s) picked in the picker, or to "for the table" when none are.
  async function moveToSeat(item) {
    if (!active) return;
    try {
      const data = await apiFetch(`/api/seller/table-orders/${active._id}/items/${item._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ seats: seatPicks }),
      });
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
    } catch (err) {
      toast.error(tableErrorText(err, t));
    }
  }

  /**
   * How many of each dish are already on this table, keyed by product.
   *
   * A waiter adding a second round has no way to remember what the first one held, and the
   * ticket is a separate column to read. Showing the count on the tile itself is what stops
   * the same dish going in twice — the mistake this screen made easiest before.
   */
  const qtyOnTable = useMemo(() => {
    const map = new Map();
    for (const item of active?.items || []) {
      const key = String(item.product);
      map.set(key, (map.get(key) || 0) + item.quantity);
    }
    return map;
  }, [active]);

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(MENU_TALLY_KEY) || '{}');
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) setMenuTally(raw);
    } catch {
      // Storage blocked: "Most added" just starts empty.
    }
  }, []);

  function bumpMenuTally(productId, quantity) {
    setMenuTally((cur) => {
      const next = { ...cur, [productId]: (Number(cur[productId]) || 0) + Math.max(1, Math.round(quantity) || 1) };
      // Kept to the dishes that matter, so an old menu does not grow this forever.
      const trimmed = Object.fromEntries(Object.entries(next).sort((a, b) => b[1] - a[1]).slice(0, MENU_TALLY_MAX));
      try {
        localStorage.setItem(MENU_TALLY_KEY, JSON.stringify(trimmed));
      } catch {
        // Not remembered on this device; nothing else depends on it.
      }
      return trimmed;
    });
  }

  // Ranked, typo-forgiving search — see lib/menuSearch.js.
  const menuSearch = useMemo(
    () => searchMenu(products, menuQuery, { category: categoryFilter, sort: menuSort, tally: menuTally, limit: 120 }),
    [products, menuQuery, categoryFilter, menuSort, menuTally]
  );
  const menu = useMemo(() => menuSearch.results.map((r) => r.product), [menuSearch]);
  const menuSearching = menuQuery.trim() !== '';

  // Dishes per category for the rail: while searching, how many matches each holds.
  const categoryCounts = useMemo(() => {
    if (menuSearching) return menuSearch.facets;
    const map = new Map();
    for (const p of products) {
      if (p.status === 'archived' || !p.category) continue;
      map.set(p.category, (map.get(p.category) || 0) + 1);
    }
    return map;
  }, [menuSearching, menuSearch, products]);


  const transferableTables = useMemo(
    () => floorTables.filter((tb) => tb.isActive && !orderByTableId.has(String(tb._id)) && String(tb._id) !== String(active?.table)),
    [floorTables, orderByTableId, active]
  );
  const mergeableOrders = useMemo(
    () => orders.filter((o) => o.orderType === 'dine_in' && o._id !== active?._id),
    [orders, active]
  );

  // One entry point for every way a table ends up seated — an available tile, a
  // reservation, or the fallback of just typing a name. Same call, same server rule.
  async function submitOpenOrder(payload) {
    setBusy('open');
    try {
      const data = await apiFetch('/api/seller/table-orders', { method: 'POST', body: JSON.stringify(payload) });
      await Promise.all([load(), loadFloorTables()]);
      setActiveId(data.order._id);
      return true;
    } catch (err) {
      toast.error(tableErrorText(err, t));
      return false;
    } finally {
      setBusy('');
    }
  }

  async function handleQuickOpen(event) {
    event.preventDefault();
    if (!quickName.trim()) return;
    const ok = await submitOpenOrder({ tableName: quickName.trim(), orderType: 'dine_in', guestCount: quickGuests || undefined });
    if (ok) {
      setQuickName('');
      setQuickGuests('');
    }
  }

  async function handleTakeawayOpen(event) {
    event.preventDefault();
    const ok = await submitOpenOrder({
      orderType: takeawayForm.orderType,
      tableName: takeawayForm.label.trim() || undefined,
      guestCount: takeawayForm.guestCount || undefined,
      customerName: takeawayForm.customerName.trim() || undefined,
      customerPhone: takeawayForm.customerPhone.trim() || undefined,
    });
    // Only on success — a failed open (duplicate label, say) keeps the modal and what was
    // typed in it, rather than dumping the waiter back on the floor with nothing to fix.
    if (ok) {
      setTakeawayOpen(false);
      setTakeawayForm({ orderType: takeawayForm.orderType, label: '', guestCount: '', customerName: '', customerPhone: '' });
    }
  }

  function openTableFrom(table, entry) {
    const groups = entry?.orders || [];
    if (groups.length > 1) setGroupPickFor(String(table._id));
    else if (groups.length === 1) setActiveId(groups[0]._id);
    else if (entry?.joinedOrder) setActiveId(entry.joinedOrder._id);
    else openFloorModal(table, 'seat');
  }

  function openShare(table) {
    setGroupPickFor(null);
    setShareFor(table);
    setShareForm({ guests: 1, name: '', phone: '', fix: {}, chairs: [] });
  }

  /**
   * Seats a new group of strangers at a table somebody is already at. Any group sitting
   * there whose head-count was never entered is asked for first — without it "how many
   * chairs are left" has no honest answer, and the server counts it as one person.
   */
  async function submitShare(event) {
    event.preventDefault();
    if (!shareFor) return;
    setBusy('open');
    try {
      for (const [orderId, count] of Object.entries(shareForm.fix)) {
        if (Number(count) > 0) {
          await apiFetch(`/api/seller/table-orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ guestCount: Number(count) }) });
        }
      }
      const data = await apiFetch('/api/seller/table-orders', {
        method: 'POST',
        body: JSON.stringify({
          tableId: shareFor._id,
          orderType: 'dine_in',
          shareTable: true,
          guestCount: Math.max(Number(shareForm.guests) || 1, shareForm.chairs?.length || 0),
          seats: shareForm.chairs?.length ? shareForm.chairs : undefined,
          customerName: shareForm.name.trim() || undefined,
          customerPhone: shareForm.phone.trim() || undefined,
        }),
      });
      await Promise.all([load(), loadFloorTables()]);
      toast.success(t('tables.visual.groupSeated', { table: data.order.tableName }));
      setShareFor(null);
      setActiveId(data.order._id);
    } catch (err) {
      toast.error(tableErrorText(err, t));
      await load();
    } finally {
      setBusy('');
    }
  }

  function openFloorModal(table, mode) {
    setFloorModal({ table, mode });
    setFloorModalForm({ guestCount: '', customerName: '', customerPhone: '', time: '', note: '', joinIds: [], chairs: [] });
  }

  /**
   * Tapping a chair while seating: the chairs they sat on. More chairs than the typed
   * head-count raises the head-count — two chairs taken means at least two people.
   */
  function toggleSeatingChair(chair) {
    setFloorModalForm((f) => {
      const chairs = f.chairs.includes(chair) ? f.chairs.filter((c) => c !== chair) : [...f.chairs, chair].sort((a, b) => a - b);
      const typed = Number(f.guestCount) || 0;
      return { ...f, chairs, guestCount: chairs.length > typed ? String(chairs.length) : f.guestCount };
    });
  }

  async function submitFloorModal(event) {
    event.preventDefault();
    if (!floorModal) return;
    if (floorModal.mode === 'seat') {
      // More guests than the table (and any tables pushed onto it) has chairs for is the
      // one thing worth stopping before it reaches the floor — said in the shop's language.
      const guests = Number(floorModalForm.guestCount) || 0;
      const chairs = (floorModal.table.capacity || 0)
        + joinableTables.filter((tb) => floorModalForm.joinIds.includes(tb._id)).reduce((sum, tb) => sum + (tb.capacity || 0), 0);
      if (guests > chairs) {
        toast.error(t('tables.errors.tooManyGuests', { table: floorModal.table.name, chairs, guests }));
        return;
      }
      const ok = await submitOpenOrder({
        tableId: floorModal.table._id,
        orderType: 'dine_in',
        guestCount: floorModalForm.guestCount || undefined,
        seats: floorModalForm.chairs.length ? floorModalForm.chairs : undefined,
        customerName: floorModalForm.customerName.trim() || undefined,
        customerPhone: floorModalForm.customerPhone.trim() || undefined,
        joinTableIds: floorModalForm.joinIds.length ? floorModalForm.joinIds : undefined,
      });
      if (ok) setFloorModal(null);
      return;
    }
    if (!floorModalForm.time) {
      toast.error(t('tables.reservationTime'));
      return;
    }
    setBusy('reserve');
    try {
      await apiFetch(`/api/seller/floor-tables/${floorModal.table._id}/reserve`, {
        method: 'POST',
        body: JSON.stringify({
          customerName: floorModalForm.customerName.trim() || undefined,
          customerPhone: floorModalForm.customerPhone.trim() || undefined,
          guestCount: floorModalForm.guestCount || undefined,
          time: new Date(floorModalForm.time).toISOString(),
          note: floorModalForm.note.trim() || undefined,
        }),
      });
      await loadFloorTables();
      setFloorModal(null);
    } catch (err) {
      toast.error(tableErrorText(err, t));
    } finally {
      setBusy('');
    }
  }

  async function handleSeatReservation(table) {
    setBusy(`seat-${table._id}`);
    try {
      const data = await apiFetch(`/api/seller/floor-tables/${table._id}/reserve/seat`, { method: 'POST', body: JSON.stringify({}) });
      await Promise.all([load(), loadFloorTables()]);
      setActiveId(data.order._id);
    } catch (err) {
      toast.error(tableErrorText(err, t));
    } finally {
      setBusy('');
    }
  }

  async function handleCancelReservation(table) {
    if (!(await confirm({ tone: 'danger', title: t('tables.cancelReservation'), cancelLabel: t('common.goBack'), body: table.name, confirmLabel: t('tables.cancelReservation') }))) return;
    try {
      await apiFetch(`/api/seller/floor-tables/${table._id}/reserve/cancel`, { method: 'POST', body: JSON.stringify({}) });
      await loadFloorTables();
    } catch (err) {
      toast.error(tableErrorText(err, t));
    }
  }

  async function addItem(product, modifiers, quantity = 1) {
    if (!active) return;
    if (blockExpiredProduct(product)) return;
    // Whole plates, 1–99 — the search box is the only place a count is typed.
    const qty = Math.min(99, Math.max(1, Math.round(Number(quantity)) || 1));
    try {
      const data = await apiFetch(`/api/seller/table-orders/${active._id}/items`, {
        method: 'POST',
        body: JSON.stringify({ items: [{ productId: product._id, quantity: qty, modifiers, ...seatingPayload() }] }),
      });
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
      bumpMenuTally(String(product._id), qty);
      if (qty > 1) toast.success(t('tables.msearch.addedQty', { qty, name: product.name }));
    } catch (err) {
      if (!markExpiredError(err)) toast.error(tableErrorText(err, t));
    }
  }

  // A product with modifierGroups opens the picker instead of landing on the table at
  // once — same split as billing's handleProductAdd/addToCart.
  function productIsExpired(product) {
    return isExpiredProduct(product) || expiredProductIds.includes(String(product?._id));
  }

  function markExpiredError(err) {
    const stockProductId = stockErrorProductId(err, products, active?.items);
    if (stockProductId) {
      setErrorTarget({ orderId: activeId, productId: stockProductId });
      const key = `${activeId}:${stockProductId}`;
      setStockRejections((previous) => ({ ...previous, [key]: qtyOnTable.get(stockProductId) || 0 }));
      apiFetch('/api/seller/products')
        .then((data) => setProducts(data.products || []))
        .catch(() => {});
      return true;
    }
    if (err.code !== 'EXPIRED_PRODUCT' || !err.data?.productId) return false;
    const id = String(err.data.productId);
    setErrorTarget({ orderId: activeId, productId: id });
    setExpiredProductIds((ids) => ids.includes(id) ? ids : [...ids, id]);
    return true;
  }

  function blockExpiredProduct(product) {
    if (!productIsExpired(product)) return false;
    setErrorTarget({ orderId: activeId, productId: String(product._id) });
    return true;
  }

  function shortageFor(item) {
    const product = products.find((entry) => String(entry._id) === String(item.product));
    if (productIsExpired(product)) return null;
    const ordered = qtyOnTable.get(String(item.product)) || 0;
    const shortage = tableStockShortage(product, ordered);
    if (shortage) return shortage;
    const rejectedQuantity = stockRejections[`${activeId}:${item.product}`];
    if (rejectedQuantity !== undefined && ordered >= rejectedQuantity) {
      return { available: null, ordered, unit: product?.unit || item.unit || '' };
    }
    return null;
  }

  function handleAddItem(product, quantity = 1) {
    if (blockExpiredProduct(product)) return;
    if (product.modifierGroups?.length > 0) {
      pendingQtyRef.current = quantity;
      setModifierPickFor(product);
      return;
    }
    addItem(product, undefined, quantity);
  }

  function openNoteEditor(item) {
    setNoteEditingId(item._id);
    setNoteDraft(item.note || '');
  }

  async function saveNote(item) {
    try {
      const data = await apiFetch(`/api/seller/table-orders/${active._id}/items/${item._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ note: noteDraft }),
      });
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
      setNoteEditingId(null);
      setNoteDraft('');
      if (data.amended) {
        toast.info(t('tables.change.sentToKitchen', { name: item.name }));
        printCorrection(item, data.amended, data.order);
      }
    } catch (err) {
      toast.error(tableErrorText(err, t));
    }
  }

  // Saved on blur rather than per keystroke — a note is typed once and left, and a PATCH
  // per character would fight the socket refresh coming back the other way.
  async function saveOrderNote() {
    if (!active || (active.note || '') === orderNoteDraft) return;
    try {
      const data = await apiFetch(`/api/seller/table-orders/${active._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ note: orderNoteDraft }),
      });
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
    } catch (err) {
      toast.error(tableErrorText(err, t));
    }
  }

  async function saveGuestCount(next) {
    const guests = Math.max(0, Number(next) || 0);
    try {
      const data = await apiFetch(`/api/seller/table-orders/${active._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ guestCount: guests }),
      });
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
    } catch (err) {
      toast.error(tableErrorText(err, t));
    }
  }

  /**
   * A dish the kitchen has but has not started, changed at the counter. The kitchen screen
   * shows the change on its own; this prints the correction slip for a kitchen that works
   * off paper — "KOT 14 correction: Naan 2 → 1".
   */
  function printCorrection(item, amended, order) {
    if (!amended || !kotAutoPrint) return;
    handlePrintKot(
      {
        number: amended.kot,
        amended: true,
        sentAt: new Date().toISOString(),
        items: [{
          name: item.name,
          quantity: amended.to.quantity,
          prevQuantity: amended.from.quantity !== amended.to.quantity ? amended.from.quantity : undefined,
          note: amended.to.note || undefined,
          noteChanged: amended.from.note !== amended.to.note,
        }],
      },
      order
    );
  }

  async function changeQuantity(item, quantity) {
    if (!active || !(quantity > 0)) return;
    try {
      const data = await apiFetch(`/api/seller/table-orders/${active._id}/items/${item._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity }),
      });
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
      if (data.amended) {
        toast.info(t('tables.change.sentToKitchen', { name: item.name }));
        printCorrection(item, data.amended, data.order);
      }
    } catch (err) {
      toast.error(tableErrorText(err, t));
    }
  }

  /**
   * Taking a dish off — and what that means depends on the kitchen:
   *   not sent     → just gone
   *   sent, not started → cancelled; the kitchen screen flashes it and a slip prints
   *   on the pan   → the KITCHEN is asked; the dish stays until they answer
   *   made         → owner/manager only, written off as wasted with its price
   * The void and its reason are one popup — a second popup asking why gets dismissed unread.
   */
  async function removeItem(item) {
    if (!active) return;
    const stage = !item.sentToKitchen ? 'unsent' : item.kitchenStatus === 'preparing' ? 'cooking' : ['ready', 'served'].includes(item.kitchenStatus) ? 'made' : 'queued';
    if (stage === 'made' && !canEditFloor) {
      toast.error(t('tables.change.madeManagerOnly', { name: item.name }));
      return;
    }
    let reason = '';
    // Money leaving the table is always asked about — including a dish that never reached
    // the kitchen, which used to vanish on one tap. The popup says the amount and that the
    // line stays on the ticket, struck through, with the person's name.
    if (stage === 'unsent') {
      const ok = await confirm({
        tone: 'warning',
        title: t('tables.removeTitle', { name: item.name }),
        body: `${t('tables.removeBody', { value: formatRupees(lineTotal(item), lang) })} ${t('tables.removedNote')}`,
        confirmLabel: t('tables.removeAction'),
        cancelLabel: t('common.goBack'),
      });
      if (!ok) return;
    }
    if (stage !== 'unsent') {
      const answer = await confirm({
        tone: stage === 'made' ? 'danger' : 'warning',
        title: t(`tables.change.${stage}Title`, { name: item.name }),
        body: `${t(`tables.change.${stage}Body`, { name: item.name, value: formatRupees(lineTotal(item), lang) })} ${t('tables.removedNote')}`,
        input: { label: t('tables.voidReasonPrompt'), placeholder: t('tables.voidReasonPlaceholder') },
        confirmLabel: t(`tables.change.${stage}Action`),
        cancelLabel: t('common.goBack'),
      });
      if (!answer) return;
      reason = (answer.value || '').trim();
    }
    try {
      const data = await apiFetch(
        `/api/seller/table-orders/${active._id}/items/${item._id}${stage !== 'unsent' ? '?force=true' : ''}`,
        { method: 'DELETE', body: JSON.stringify({ reason: reason || undefined }) }
      );
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
      if (data.requested) {
        toast.info(t('tables.change.askedKitchen', { name: item.name }));
      } else if (stage === 'queued') {
        toast.info(t('tables.change.cancelledInKitchen', { name: item.name }));
        if (kotAutoPrint) {
          handlePrintKot({
            number: null,
            amended: true,
            sentAt: new Date().toISOString(),
            items: [{ name: item.name, quantity: item.quantity, cancelled: true, note: reason || undefined }],
          }, active);
        }
      } else if (stage === 'made') {
        toast.info(t('tables.change.writtenOff', { name: item.name, value: formatRupees(lineTotal(item), lang) }));
      }
    } catch (err) {
      toast.error(tableErrorText(err, t));
    }
  }

  async function handleSendKot() {
    if (!active) return;
    setBusy('kot');
    try {
      const data = await apiFetch(`/api/seller/table-orders/${active._id}/kot`, { method: 'POST' });
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
      toast.success(t('tables.kotSent', { number: data.kot.number }));
      if (kotAutoPrint) handlePrintKot(data.kot, data.order);
    } catch (err) {
      toast.error(tableErrorText(err, t));
    } finally {
      setBusy('');
    }
  }

  function handlePrintKot(kot, order = active) {
    // flushSync so the slip is in the DOM before print() — the auto-print after a fired
    // round runs outside a click handler, where React would otherwise commit it later.
    flushSync(() => setKotToPrint({ kot, order }));
    // The kitchen printer when one is set (Settings → Printers; falls back to the counter
    // printer), otherwise the Print screen.
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

  // "Food is on the table" — every dish the kitchen marked ready, in one tap from the
  // waiter's own screen, so the table moves on to its bill without a trip to the KDS.
  async function handleServeReady() {
    if (!active) return;
    const itemIds = active.items.filter((item) => item.sentToKitchen && item.kitchenStatus === 'ready').map((item) => item._id);
    if (itemIds.length === 0) return;
    setBusy('serve');
    try {
      const data = await apiFetch(`/api/seller/table-orders/${active._id}/kitchen-bump`, {
        method: 'POST',
        body: JSON.stringify({ itemIds, status: 'served' }),
      });
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
      toast.success(t('tables.visual.served', { count: itemIds.length }));
    } catch (err) {
      toast.error(tableErrorText(err, t));
    } finally {
      setBusy('');
    }
  }

  function handleJourneyAction(stageKey) {
    if (stageKey === 'ordering') return handleSendKot();
    if (stageKey === 'ready') return handleServeReady();
    if (stageKey === 'cooking') return router.push('/seller/kitchen');
    if (stageKey === 'seated') {
      const search = document.getElementById('menuSearch');
      search?.scrollIntoView({ block: 'center' });
      search?.focus();
      return undefined;
    }
    // eating: the bill. The settle button is pinned at the foot of the ticket.
    const settle = document.querySelector('.ticket-settle-btn') || document.querySelector('.pos-paybar .btn-primary');
    settle?.scrollIntoView({ block: 'center' });
    settle?.focus();
    return undefined;
  }

  async function handleAssign(staffId) {
    if (!active) return;
    try {
      const data = await apiFetch(`/api/seller/table-orders/${active._id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ staffId: staffId || undefined }),
      });
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
    } catch (err) {
      toast.error(tableErrorText(err, t));
    }
  }

  async function handleTransfer() {
    if (!active || !transferTarget) return;
    setBusy('transfer');
    try {
      const data = await apiFetch(`/api/seller/table-orders/${active._id}/transfer`, {
        method: 'POST',
        body: JSON.stringify({ toTableId: transferTarget }),
      });
      await Promise.all([load(), loadFloorTables()]);
      toast.success(t('tables.transferred', { table: data.order.tableName }));
      setTransferPicking(false);
      setTransferTarget('');
    } catch (err) {
      toast.error(tableErrorText(err, t));
    } finally {
      setBusy('');
    }
  }

  async function handleMerge() {
    if (!active || !mergeTarget) return;
    setBusy('merge');
    try {
      const data = await apiFetch(`/api/seller/table-orders/${active._id}/merge`, {
        method: 'POST',
        body: JSON.stringify({ intoOrderId: mergeTarget }),
      });
      await Promise.all([load(), loadFloorTables()]);
      setActiveId(data.order._id);
      toast.success(t('tables.merged', { table: data.order.tableName }));
      setMergePicking(false);
      setMergeTarget('');
    } catch (err) {
      toast.error(tableErrorText(err, t));
    } finally {
      setBusy('');
    }
  }

  function splitLines() {
    return Object.entries(split)
      .filter(([, v]) => Number(v) > 0)
      .map(([mode, v]) => ({ mode, amount: round2(Number(v)) }));
  }

  // Every line on the table as a { item, quantity } pair — the same shape a split group's
  // lines take, so one function turns either into a bill.
  function wholeTableLines() {
    return (active?.items || []).map((item) => ({ item, quantity: item.quantity }));
  }

  // The POST /api/seller/bills items for a set of lines, plus the section charge line when
  // this table's section has one switched on, plus the parcel/delivery charge on the one
  // bill that carries it (`withTakeaway`) — a flat charge is paid once per order, not once
  // per guest's share of it.
  function billItemsFor(lines, { withTakeaway = true } = {}) {
    const items = lines.map(({ item, quantity }) => ({ productId: item.product, quantity, modifiers: item.modifiers }));
    const charge = chargeActive ? sectionChargeLine(chargeLabel, chargePercent, lines) : null;
    if (charge) items.push(charge);
    const flat = withTakeaway && takeawayAmount > 0 ? flatChargeLine(takeawayLabel, takeawayAmount, takeawayBase?.gstRate) : null;
    if (flat) items.push(flat);
    return items;
  }

  // Part of the idempotency key, so a retry after a charge was changed is a new bill.
  const chargeKey = `${chargeActive ? `c${chargePercent}` : ''}${takeawayAmount > 0 ? `t${takeawayAmount}` : ''}`;

  function groupLabel(index) {
    return (groupNames[index] || '').trim() || `${t('tables.bill')} ${index + 1}`;
  }

  // A typed discount the server would refuse anyway, caught before any bill is made.
  // `total` is the pre-discount bill the ₹ figure is taken off.
  function discountInvalid() {
    const pctText = String(billDiscountPercent).trim();
    const amtText = String(billDiscountAmount).trim();
    const pct = Number(pctText);
    const amt = Number(amtText);
    if (pctText && (!Number.isFinite(pct) || pct < 0 || pct > 100)) return true;
    if (amtText && (!Number.isFinite(amt) || amt < 0 || amt > total + 0.001)) return true;
    return false;
  }

  // "2 × Naan (₹80) were added after the bill — still on the table, bill them."
  function leftoverText(leftover) {
    const what = leftover.map((l) => `${l.quantity} × ${l.name}`).join(', ');
    const amount = leftover.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
    return t('tables.leftoverAfterBill', { items: what, amount: formatRupees(amount, lang) });
  }

  async function handleSettle() {
    if (!active || active.items.length === 0) return;
    if (discountInvalid()) {
      toast.error(t('tables.discountInvalid'));
      return;
    }
    if (settleMode === 'khata' && !settleCustomerId) {
      toast.error(t('tables.khataCustomerHint'));
      return;
    }
    // Picked earlier, then closed or merged away on another screen: the server would refuse
    // the bill with a bare "Customer not found". Ask again instead.
    if (settleCustomerId && !billableCustomers.some((c) => c.id === settleCustomerId)) {
      setSettleCustomerId('');
      toast.error(t('seller.selectCustomer'));
      return;
    }
    if (settleMode === 'split' && Math.abs(splitEntered - payable) > 0.01) {
      toast.error(t('seller.splitMismatch', { entered: splitEntered.toFixed(2), due: payable.toFixed(2) }));
      return;
    }
    const lines = wholeTableLines();
    setBusy('settle');
    try {
      const billData = await apiFetch('/api/seller/bills', {
        method: 'POST',
        body: JSON.stringify({
          clientBillId: tableBillKey(active._id, 'full', lines, chargeKey),
          items: billItemsFor(lines),
          paymentMode: settleMode,
          // Bills a parcel/delivery on its own price list — see backend/utils/orderPricing.js.
          orderType: active.orderType,
          counter: active.tableLabel || active.tableName,
          // On any mode, not only khata: a UPI or cash bill with a customer on it can be
          // sent to them, and shows up in their history.
          customerId: settleCustomerId || undefined,
          payments: settleMode === 'split' ? splitLines() : undefined,
          billDiscountPercent: Number(billDiscountPercent) || undefined,
          billDiscount: !Number(billDiscountPercent) && Number(billDiscountAmount) ? Number(billDiscountAmount) : undefined,
        }),
      });
      const settled = await apiFetch(`/api/seller/table-orders/${active._id}/settle`, {
        method: 'POST',
        body: JSON.stringify({ billId: billData.bill._id }),
      });
      // Something was added to the table after this bill was made. The bill is paid, the
      // extra stays open on the table — say exactly what, so it gets billed, never lost.
      if (settled?.leftover?.length) {
        toast.error(leftoverText(settled.leftover));
        await Promise.all([load(), loadFloorTables()]);
        return;
      }
      toast.success(t('tables.settled', { table: active.tableLabel || active.tableName, number: billData.bill.billNumber }));
      setSplitSettledReceipts([]);
      showSettled({ bill: billData.bill, customer: customerById(settleCustomerId) });
      setActiveId(null);
      setSettleMode('cash');
      setSettleCustomerId('');
      setSplit({ cash: '', upi: '', card: '' });
      setBillDiscountPercent('');
      setBillDiscountAmount('');
      await Promise.all([load(), loadFloorTables()]);
    } catch (err) {
      if (!markExpiredError(err)) toast.error(tableErrorText(err, t));
      // Reload either way: the bill may well have been created before the failure, and
      // the floor must show the truth rather than what we hoped happened.
      await Promise.all([load(), loadFloorTables()]);
    } finally {
      setBusy('');
    }
  }

  function openGuestSplit() {
    if (!active) return;
    setAllocation({});
    setGroupNames({});
    setGuestModes({ 0: 'cash', 1: 'cash' });
    setGuestCustomers({});
    setSplitGuestCount(2);
    setGuestSplitOpen(true);
  }

  function changeSplitGuestCount(next) {
    const n = Math.max(2, Math.min(8, next));
    setSplitGuestCount(n);
    // A bill removed by shrinking the count hands its items back to Bill 1 rather than
    // leaving them on a bill that no longer has a card to show them on.
    setAllocation((map) => {
      const copy = {};
      for (const [itemId, rule] of Object.entries(map)) {
        if (Array.isArray(rule.qty)) {
          const qty = rule.qty.slice(0, n);
          qty[0] = (Number(qty[0]) || 0) + rule.qty.slice(n).reduce((sum, v) => sum + (Number(v) || 0), 0);
          copy[itemId] = { qty };
        } else if (Number.isInteger(rule.to) && rule.to >= n) {
          copy[itemId] = { to: 0 };
        } else {
          copy[itemId] = rule;
        }
      }
      return copy;
    });
    setGuestModes((modes) => {
      const copy = { ...modes };
      for (let i = 0; i < n; i++) if (!copy[i]) copy[i] = 'cash';
      return copy;
    });
  }

  // Everything on the table split evenly — "sab barabar baant do", the most common ask.
  function shareEverything() {
    if (!active) return;
    const map = {};
    for (const item of active.items) map[item._id] = { share: true };
    setAllocation(map);
  }

  /**
   * One bill per chair — what each person ordered from their own seat is theirs, and what
   * was ordered "for the table" is shared evenly between them.
   */
  function splitBySeat() {
    if (!active) return;
    // Every chair that ordered anything — on its own or as part of a shared dish.
    const seats = Array.from(new Set(active.items.flatMap(seatsOf))).sort((a, b) => a - b).slice(0, 8);
    if (seats.length === 0) return;
    const count = Math.max(2, seats.length);
    const map = {};
    for (const item of active.items) {
      const mine = seatsOf(item).map((seat) => seats.indexOf(seat)).filter((i) => i >= 0);
      // One chair: theirs. Several: split between just those chairs. None: everyone's.
      map[item._id] = mine.length === 1 ? { to: mine[0] } : mine.length > 1 ? { shareAmong: mine } : { share: true };
    }
    setSplitGuestCount(count);
    setAllocation(map);
    const names = {};
    seats.forEach((seat, i) => { names[i] = t('tables.seat.chair', { seat }); });
    setGroupNames(names);
    setGuestModes(Object.fromEntries(Array.from({ length: count }, (_, i) => [i, 'cash'])));
  }

  function setItemRule(item, rule) {
    setAllocation((map) => ({ ...map, [item._id]: rule }));
  }

  // Switching a line to a hand split starts with everything on the bill it was already on,
  // so the counts add up from the first tap and only need moving.
  function startQuantitySplit(item) {
    const current = allocation[item._id] || {};
    const qty = Array.from({ length: splitGuestCount }, () => 0);
    qty[Number.isInteger(current.to) && current.to < splitGuestCount ? current.to : 0] = item.quantity;
    setItemRule(item, { qty });
  }

  function stepQuantity(item, index, delta) {
    const rule = allocation[item._id];
    if (!rule || !Array.isArray(rule.qty)) return;
    const qty = Array.from({ length: splitGuestCount }, (_, i) => Number(rule.qty[i]) || 0);
    const next = qty[index] + delta;
    if (next < 0) return;
    const assigned = qty.reduce((sum, v) => sum + v, 0) + delta;
    if (assigned > item.quantity) {
      // Moving a piece here takes it from the first other bill that has one, so a single
      // tap moves a roti across instead of first having to take it off somewhere else.
      const donor = qty.findIndex((v, i) => i !== index && v > 0);
      if (donor === -1) return;
      qty[donor] -= delta;
    }
    qty[index] = next;
    setItemRule(item, { qty });
  }

  const guestSplit = useMemo(() => {
    if (!active || !guestSplitOpen) return { groups: [], unbalanced: [] };
    const { groups, unbalanced } = buildGroups(active.items, allocation, splitGuestCount);
    // The parcel/delivery charge rides on the first bill that has food on it.
    const takeawayIndex = groups.find((g) => g.lines.length > 0)?.index;
    return {
      unbalanced,
      groups: groups.map((g) => {
        const charge = chargeActive ? sectionCharge(g.lines, chargePercent).amount : 0;
        const takeaway = g.index === takeawayIndex ? takeawayAmount : 0;
        // Each group's own bill, rounded the way that bill will be saved.
        const money = billMoney({
          lines: [
            ...g.lines.map(({ item, quantity }) => ({ price: item.price, quantity })),
            ...(charge > 0 ? [{ price: charge, quantity: 1 }] : []),
            ...(takeaway > 0 ? [{ price: takeaway, quantity: 1 }] : []),
          ],
          discountPercent: Number(billDiscountPercent) || 0,
          roundOff: user?.billingSettings?.roundOff !== false,
        });
        return { ...g, charge, takeaway, payable: money.payable };
      }),
    };
  }, [active, guestSplitOpen, allocation, splitGuestCount, chargeActive, chargePercent, takeawayAmount, billDiscountPercent]);
  const guestGroups = guestSplit.groups;

  // Every piece of every dish must be on some bill before anything is charged.
  function splitProblem() {
    if (guestSplit.unbalanced.length === 0) return null;
    const item = active.items.find((it) => it._id === guestSplit.unbalanced[0]);
    const rule = allocation[item?._id] || {};
    const assigned = (rule.qty || []).reduce((sum, v) => sum + (Number(v) || 0), 0);
    return t('tables.splitUnbalanced', { name: item?.name || '', assigned, total: item?.quantity || 0 });
  }

  function groupNeedsCustomer(g) {
    return (guestModes[g.index] || 'cash') === 'khata' && !guestCustomers[g.index];
  }

  // A customer picked on a split bill who has since been closed or merged on another screen.
  function groupCustomerGone(g) {
    const id = guestCustomers[g.index];
    return Boolean(id) && !billableCustomers.some((c) => c.id === id);
  }

  function createGroupBill(g, kind, { withTakeaway = g.takeaway > 0 } = {}) {
    const mode = guestModes[g.index] || 'cash';
    return apiFetch('/api/seller/bills', {
      method: 'POST',
      body: JSON.stringify({
        clientBillId: tableBillKey(active._id, kind, g.lines, `${g.index}${chargeKey}${withTakeaway ? '' : 'n'}`),
        items: billItemsFor(g.lines, { withTakeaway }),
        paymentMode: mode,
        orderType: active.orderType,
        counter: `${active.tableLabel || active.tableName} · ${groupLabel(g.index)}`,
        customerId: guestCustomers[g.index] || undefined,
        billDiscountPercent: Number(billDiscountPercent) || undefined,
      }),
    });
  }

  async function handleGuestSplitSettle() {
    if (!active) return;
    if (discountInvalid()) {
      toast.error(t('tables.discountInvalid'));
      return;
    }
    const problem = splitProblem();
    if (problem) {
      toast.error(problem);
      return;
    }
    const nonEmptyGroups = guestGroups.filter((g) => g.lines.length > 0);
    if (nonEmptyGroups.length < 2) {
      toast.error(t('tables.splitNeedsTwo'));
      return;
    }
    const missing = nonEmptyGroups.find(groupNeedsCustomer);
    if (missing) {
      toast.error(t('tables.splitGuestNeedsCustomer', { guest: groupLabel(missing.index) }));
      return;
    }
    const gone = nonEmptyGroups.find(groupCustomerGone);
    if (gone) {
      setGuestCustomers((map) => ({ ...map, [gone.index]: '' }));
      toast.error(t('tables.splitGuestNeedsCustomer', { guest: groupLabel(gone.index) }));
      return;
    }
    setBusy('settle');
    try {
      // Sequential, not Promise.all — each POST is a real bill (stock moves, an invoice
      // number is spent), and firing eight of those at once against the same shop's
      // counters is asking for exactly the race the billNumber sequence exists to avoid.
      const createdBills = [];
      const billCustomers = [];
      for (const g of nonEmptyGroups) {
        const billData = await createGroupBill(g, 'split');
        createdBills.push(billData.bill);
        billCustomers.push(customerById(guestCustomers[g.index]));
      }
      const settled = await apiFetch(`/api/seller/table-orders/${active._id}/settle`, {
        method: 'POST',
        body: JSON.stringify({ billIds: createdBills.map((b) => b._id) }),
      });
      if (settled?.leftover?.length) {
        toast.error(leftoverText(settled.leftover));
        await Promise.all([load(), loadFloorTables()]);
        return;
      }
      toast.success(t('tables.splitSettled', { table: active.tableLabel || active.tableName, count: createdBills.length }));
      setSettledReceipt(null);
      setSplitSettledReceipts(createdBills.map((bill, i) => ({ bill, customer: billCustomers[i] })));
      createdBills.forEach((bill) => {
        receiptExtras(bill._id).then((extras) => {
          setSplitSettledReceipts((list) => list.map((e) => (e.bill._id === bill._id ? { ...e, ...extras } : e)));
        });
      });
      setActiveId(null);
      setGuestSplitOpen(false);
      setBillDiscountPercent('');
      setBillDiscountAmount('');
      await Promise.all([load(), loadFloorTables()]);
    } catch (err) {
      if (!markExpiredError(err)) toast.error(tableErrorText(err, t));
      // Same reasoning as the single-bill settle above: reload regardless, because some of
      // these bills may already be real. A guest or two settled and a step in the middle
      // failing is exactly the case where the floor screen showing the truth matters most.
      await Promise.all([load(), loadFloorTables()]);
    } finally {
      setBusy('');
    }
  }

  /**
   * One group pays and leaves; the table stays open for the rest.
   *
   * The person who came alone finishes first — their bill is made now, and only their
   * lines (or their share of a line) come off the table. The friends carry on ordering.
   */
  async function handlePartSettle(g) {
    if (!active || g.lines.length === 0) return;
    if (discountInvalid()) {
      toast.error(t('tables.discountInvalid'));
      return;
    }
    const problem = splitProblem();
    if (problem) {
      toast.error(problem);
      return;
    }
    if (groupNeedsCustomer(g)) {
      toast.error(t('tables.splitGuestNeedsCustomer', { guest: groupLabel(g.index) }));
      return;
    }
    if (groupCustomerGone(g)) {
      setGuestCustomers((map) => ({ ...map, [g.index]: '' }));
      toast.error(t('tables.splitGuestNeedsCustomer', { guest: groupLabel(g.index) }));
      return;
    }
    const label = groupLabel(g.index);
    setBusy('settle');
    try {
      // One guest leaving early does not pay the whole order's parcel/delivery charge; it
      // stays on the table for its final bill — unless this group IS the rest of the
      // order, in which case this is that final bill.
      const takesAll = active.items.every((it) => {
        const onBill = g.lines.filter((l) => l.item._id === it._id).reduce((sum, l) => sum + l.quantity, 0);
        return onBill >= it.quantity - 1e-9;
      });
      const billData = await createGroupBill(g, 'part', { withTakeaway: takesAll });
      const data = await apiFetch(`/api/seller/table-orders/${active._id}/settle-part`, {
        method: 'POST',
        body: JSON.stringify({
          billId: billData.bill._id,
          label,
          lines: g.lines.map(({ item, quantity }) => ({ itemId: item._id, quantity })),
        }),
      });
      const amount = billData.bill.payableTotal ?? billData.bill.total;
      setSplitSettledReceipts([]);
      showSettled({ bill: billData.bill, customer: customerById(guestCustomers[g.index]) });
      setGuestSplitOpen(false);
      if (data.closed) {
        toast.success(t('tables.settled', { table: active.tableLabel || active.tableName, number: billData.bill.billNumber }));
        setActiveId(null);
        setBillDiscountPercent('');
        setBillDiscountAmount('');
      } else {
        toast.success(t('tables.partPaid', { label, amount: formatRupees(amount, lang), table: active.tableLabel || active.tableName }));
        setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
      }
      await Promise.all([load(), loadFloorTables()]);
    } catch (err) {
      if (!markExpiredError(err)) toast.error(tableErrorText(err, t));
      await Promise.all([load(), loadFloorTables()]);
    } finally {
      setBusy('');
    }
  }

  /**
   * The settled bill, on the customer's WhatsApp — the message is the server's, shown
   * before it goes (components/WhatsappSheet.js). `entry` is { bill, customer }.
   */
  async function handleSendBill(entry) {
    if (!entry?.bill?._id || !entry.customer?.phone) return;
    try {
      const data = await apiFetch(`/api/seller/bills/${entry.bill._id}/share`);
      setWaSheet({
        title: t('wa.sendBill'),
        to: { name: entry.customer.name, phone: entry.customer.phone },
        message: data.smsText,
        link: data.whatsappLink,
        auto: data.whatsappAuto,
        appLink: data.appLink,
        endpoint: `/api/seller/bills/${entry.bill._id}/whatsapp`,
      });
    } catch (err) {
      toast.error(err.message);
    }
  }

  /**
   * The customer link and UPI pay link for a bill (both minted by receipt-text). `upiLink`
   * stays undefined while loading and becomes null when the shop has no UPI ID, so the
   * panel can tell "loading" from "set up UPI in Settings".
   */
  async function receiptExtras(billId) {
    try {
      const r = await apiFetch(`/api/seller/bills/${billId}/receipt-text`);
      return { upiLink: r.upiLink || null, billLink: r.billLink || null };
    } catch {
      return { upiLink: null, billLink: null };
    }
  }

  // A settled bill on screen, its links filled in as soon as they arrive.
  function showSettled({ bill, customer }) {
    setSettledReceipt({ bill, customer: customer || null, upiLink: undefined, billLink: undefined });
    receiptExtras(bill._id).then((extras) => {
      setSettledReceipt((cur) => (cur?.bill?._id === bill._id ? { ...cur, ...extras } : cur));
    });
  }

  /**
   * Prints one settled bill's slip and resolves with what happened ('direct' | 'system' |
   * 'skipped'), which the print button turns into "Printing…" / "Printed".
   */
  async function printSettled(entry) {
    const extras = entry.billLink === undefined ? await receiptExtras(entry.bill._id) : entry;
    // flushSync so the slip is in the DOM before printSlip reads it.
    flushSync(() => setSlip({ bill: entry.bill, upiLink: extras.upiLink || null, billLink: extras.billLink || null }));
    return printSlip({
      shop: user,
      role: 'receipt',
      selector: '.thermal-receipt',
      bodyClass: 'printing-receipt',
      ready: qrSlotsReady,
      onFallback: (message) => toast.info(message),
      t,
    });
  }

  // The customer's own link to the bill, on the clipboard — for a chat that isn't WhatsApp.
  async function copySettledLink(entry) {
    try {
      const url = entry.billLink || (await apiFetch(`/api/seller/bills/${entry.bill._id}/link`)).url;
      if (!url) return;
      await navigator.clipboard.writeText(url);
      toast.success(t('seller.billLinkCopied'));
    } catch (err) {
      toast.error(err?.status ? err.message : t('seller.billLinkCopyFailed'));
    }
  }

  /**
   * A bill settled without a customer — paid by UPI, say — and they now want it sent.
   * The number goes onto the bill (an existing khata customer on that number is used, a
   * new one is made otherwise; see attachBillCustomer). Throws so the form can show why.
   */
  async function attachSettledCustomer(phone, name) {
    if (!settledReceipt?.bill?._id) return;
    const data = await apiFetch(`/api/seller/bills/${settledReceipt.bill._id}/customer`, {
      method: 'PATCH',
      body: JSON.stringify({ phone, name: name || undefined }),
    });
    const customer = data.customer;
    if (customer?.id) setCustomers((list) => (list.some((c) => c.id === customer.id) ? list : [customer, ...list]));
    setSettledReceipt((cur) => (cur ? { ...cur, customer } : cur));
    toast.success(t('seller.captureSaved', { name: customer?.name || phone }));
  }

  async function handleJoin() {
    if (!active || joinPick.length === 0) return;
    setBusy('join');
    try {
      const data = await apiFetch(`/api/seller/table-orders/${active._id}/join`, {
        method: 'POST',
        body: JSON.stringify({ tableIds: joinPick }),
      });
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
      toast.success(t('tables.joined', { table: data.order.tableLabel }));
      setJoinPicking(false);
      setJoinPick([]);
      await loadFloorTables();
    } catch (err) {
      toast.error(tableErrorText(err, t));
    } finally {
      setBusy('');
    }
  }

  async function handleUnjoin(joined) {
    if (!active) return;
    try {
      const data = await apiFetch(`/api/seller/table-orders/${active._id}/unjoin`, {
        method: 'POST',
        body: JSON.stringify({ tableId: joined.table }),
      });
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
      toast.success(t('tables.released', { table: joined.name }));
      await loadFloorTables();
    } catch (err) {
      toast.error(tableErrorText(err, t));
    }
  }

  async function handleCancel() {
    if (!active) return;
    if (!(await confirm({ tone: 'danger', title: t('tables.cancelOrderTitle'), cancelLabel: t('common.goBack'), body: t('tables.confirmCancel', { table: active.tableName }), confirmLabel: t('tables.cancelOrderTitle') }))) return;
    try {
      await apiFetch(`/api/seller/table-orders/${active._id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setActiveId(null);
      await Promise.all([load(), loadFloorTables()]);
    } catch (err) {
      toast.error(tableErrorText(err, t));
    }
  }

  const itemsTotal = active ? active.items.reduce((sum, item) => sum + lineTotal(item), 0) : 0;
  // The section charge rides on the bill as its own line, so the discount (which the server
  // applies to the whole bill) is worked on dishes + charge here too — the number on this
  // screen has to be the number on the printed bill.
  const chargeAmount = active && chargeActive ? sectionCharge(wholeTableLines(), chargePercent).amount : 0;
  const total = round2(itemsTotal + chargeAmount + takeawayAmount);
  const pendingCount = active ? active.items.filter((i) => !i.sentToKitchen).length : 0;
  // Worked out exactly as the saved bill will be — line by line, the discount, and the round
  // to the rupee this shop bills in — so the number the waiter reads out is the number printed.
  const roundOffOn = user?.billingSettings?.roundOff !== false;
  const tableMoney = billMoney({
    lines: [
      ...(active?.items || []).map((item) => ({ price: item.price, quantity: item.quantity })),
      ...(chargeAmount > 0 ? [{ price: chargeAmount, quantity: 1 }] : []),
      ...(takeawayAmount > 0 ? [{ price: takeawayAmount, quantity: 1 }] : []),
    ],
    discountPercent: Number(billDiscountPercent) || 0,
    discountAmount: Number(billDiscountAmount) || 0,
    roundOff: roundOffOn,
  });
  const billDiscountValue = tableMoney.discount;
  const payable = tableMoney.payable;
  const splitEntered = splitLines().reduce((sum, l) => sum + l.amount, 0);

  /**
   * A kirana has no tables, and the sidebar already hides this link for it. But the page is
   * still reachable by URL — and the server's rule is that a hidden link comes back the
   * moment the shop has real data in it. So a kirana owner who lands here out of curiosity
   * and taps "Open a table" once would get a Tables link in his sidebar forever, from a
   * single stray tap. Explaining the screen instead of offering the form is what stops that.
   *
   * Any shop that already has a table on the floor sees the real screen, whatever its trade —
   * nothing is ever locked away from a shop that is genuinely using it.
   */
  const runsTables = businessType(user?.businessType || DEFAULT_BUSINESS_TYPE).runsTables;
  const belongsHere = runsTables || orders.length > 0 || floorTables.length > 0;

  if (user && !loading && !belongsHere) {
    return (
      <>
        <div className="page-head">
          <div className="page-head-text">
            <h1>{t('tables.title')}</h1>
            <p className="page-head-sub">{t('tables.subtitle')}</p>
          </div>
        </div>
        <div className="panel">
          <div className="empty-state-rich">
            <div className="empty-icon"><TableIcon size={26} /></div>
            <p>{t('tables.notYourTrade')}</p>
            <Link href="/seller/settings" className="btn btn-secondary btn-small btn-inline">
              {t('tables.changeBusinessType')}
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      {/*
        Two modes, never both. Before this, the takeaway form, the floor and the whole
        order-taking panel were one endless column: a waiter working a table scrolled past
        a form and every other table to reach the menu, then scrolled again to reach the
        ticket, then again for the total. Serving one table is its own screen now, and it
        borrows the billing terminal's own two-pane shape (.pos-layout / .pos-ticket) so
        the menu and the running bill are visible at the same time.
      */}
      {loading ? (
        <>
          <div className="page-head">
            <div className="page-head-text">
              <h1>{t('tables.title')}</h1>
              <p className="page-head-sub">{t('tables.subtitle')}</p>
            </div>
          </div>
          <SkeletonStats count={4} />
        </>
      ) : active ? (
        <>
          <div className="order-bar">
            <button type="button" className="order-bar__back" onClick={() => setActiveId(null)}>
              <ChevronLeftIcon size={18} />
              <span>{t('tables.backToFloor')}</span>
            </button>

            <div className="order-bar__id">
              <strong>{active.tableLabel || active.tableName}</strong>
              <span className="order-bar__meta">
                <span>{t(`tables.type.${active.orderType}`)}</span>
                {active.orderType === 'dine_in' && (
                  <>
                    <span className="order-bar__dot" />
                    {guestEditing ? (
                      <span className="qty-control">
                        <button type="button" onClick={() => saveGuestCount((active.guestCount || 0) - 1)}>−</button>
                        <input
                          type="number"
                          min="0"
                          value={active.guestCount || 0}
                          onChange={(e) => saveGuestCount(e.target.value)}
                          onBlur={() => setGuestEditing(false)}
                          autoFocus
                        />
                        <button type="button" onClick={() => saveGuestCount((active.guestCount || 0) + 1)}>+</button>
                      </span>
                    ) : (
                      <button type="button" className="order-bar__chip" onClick={() => setGuestEditing(true)} data-tip={t('tables.guests')}>
                        <UsersIcon size={12} /> {active.guestCount || '—'}
                      </button>
                    )}
                  </>
                )}
                <span className="order-bar__dot" />
                <span className="order-bar__chip is-static">
                  <ClockIcon size={12} /> {formatElapsed(active.createdAt, now)}
                </span>
              </span>
            </div>

            <div className="order-bar__actions">
              {staffList.length > 0 && (
                <Dropdown
                  className="dropdown-field order-bar__waiter"
                  value={active.assignedStaff || ''}
                  onChange={handleAssign}
                  options={[{ value: '', label: t('tables.unassigned') }, ...staffList.map((s) => ({ value: s.id, label: s.name }))]}
                />
              )}
              {/* A dine-in table's "send to kitchen" lives in the journey strip right below —
                  one loud button per screen. Parcel/delivery has no strip, so it stays here. */}
              {!(activeStage && active.orderType === 'dine_in') && (
                <button
                  type="button"
                  className="btn btn-primary btn-small btn-inline"
                  disabled={busy !== '' || pendingCount === 0}
                  onClick={handleSendKot}
                >
                  <KitchenIcon size={15} /> {busy === 'kot' ? t('common.saving') : t('tables.sendKot', { count: pendingCount })}
                </button>
              )}
              {active.kots.length > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-inline"
                  data-tip={t('tables.reprintKotTip', { number: active.kots[active.kots.length - 1].number })}
                  onClick={() => handlePrintKot(active.kots[active.kots.length - 1])}
                >
                  <PrinterIcon size={15} /> {t('tables.printKot')}
                </button>
              )}
              <PrinterStatusChip role="kot" />
              {/* Moving, merging, pushing tables together and cancelling happen a few times an
                  evening, not every minute — one menu instead of four buttons on the bar. */}
              <RowMenu
                tip={t('common.moreActions')}
                className="order-bar__more"
                items={[
                  { label: t('tables.transfer'), icon: <SwapIcon size={15} />, onClick: () => { setMergePicking(false); setJoinPicking(false); setTransferPicking((v) => !v); }, hidden: active.orderType !== 'dine_in' },
                  { label: t('tables.merge'), icon: <LayersIcon size={15} />, onClick: () => { setTransferPicking(false); setJoinPicking(false); setMergePicking((v) => !v); }, hidden: active.orderType !== 'dine_in' },
                  { label: t('tables.joinTables'), icon: <PlusIcon size={15} />, onClick: () => { setTransferPicking(false); setMergePicking(false); setJoinPicking((v) => !v); setJoinPick([]); }, hidden: active.orderType !== 'dine_in' || !active.table },
                  { label: t('tables.cancelTable'), icon: <TrashIcon size={15} />, onClick: handleCancel, danger: true },
                ]}
              />
            </div>
          </div>

          {transferPicking && (
            <div className="pos-extra-panel">
              <Dropdown
                value={transferTarget}
                onChange={setTransferTarget}
                options={[{ value: '', label: '—' }, ...transferableTables.map((tb) => ({ value: tb._id, label: `${tb.name} (${tb.zone})` }))]}
              />
              <button type="button" className="btn btn-primary btn-small btn-inline" disabled={!transferTarget || busy !== ''} onClick={handleTransfer}>
                {t('tables.moveHere')}
              </button>
            </div>
          )}
          {mergePicking && (
            <div className="pos-extra-panel">
              <Dropdown
                value={mergeTarget}
                onChange={setMergeTarget}
                options={[{ value: '', label: '—' }, ...mergeableOrders.map((o) => ({ value: o._id, label: o.tableLabel || o.tableName }))]}
              />
              <button type="button" className="btn btn-primary btn-small btn-inline" disabled={!mergeTarget || busy !== ''} onClick={handleMerge}>
                {t('tables.mergeHere')}
              </button>
            </div>
          )}

          {/* Tables pushed together for this party — each with its own release, because
              the extra two friends leaving should give T5 back to the floor without
              touching the bill. */}
          {/* Order → Kitchen → Serve → Bill, with this table's own counts and the one button
              that moves it on. The same four steps the floor tile shows, large. */}
          {activeStage && active.orderType === 'dine_in' && (
            <TableJourney stage={activeStage} total={payable} onAction={handleJourneyAction} busy={busy !== ''} t={t} lang={lang} />
          )}

          {/* Strangers sharing this table: every group one tap away, each in its chair
              colour, and the way to seat one more while a chair is free. */}
          {(() => {
            if (!active.table || active.orderType !== 'dine_in') return null;
            const siblings = ordersByTable.get(String(active.table)) || [];
            const table = floorTables.find((tb) => String(tb._id) === String(active.table));
            if (siblings.length < 2 || !table) return null;
            const info = seatsAtTable(table.capacity, siblings);
            return (
              <div className="pos-extra-panel group-switch">
                <span className="group-switch__label">{t('tables.visual.atThisTable', { table: table.name })}</span>
                {siblings.map((o, i) => (
                  <button
                    type="button"
                    key={o._id}
                    className={`group-switch__chip${o._id === active._id ? ' is-current' : ''}`}
                    aria-pressed={o._id === active._id}
                    onClick={() => setActiveId(o._id)}
                  >
                    <span className={`gchip g-${i % 5}`}>{groupLetter(o, i)}</span>
                    <span>{o.customerName || t('tables.visual.groupName', { letter: groupLetter(o, i) })}</span>
                    {(o.toPay ?? o.subtotal) > 0 && <strong>{formatRupees(o.toPay ?? o.subtotal, lang)}</strong>}
                  </button>
                ))}
                {info.free > 0 && (
                  <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => openShare(table)}>
                    <PlusIcon size={15} /> {t('tables.visual.newGroupFree', { count: info.free })}
                  </button>
                )}
              </div>
            );
          })()}

          {(joinPicking || active.joinedTables?.length > 0) && (
            <div className="pos-extra-panel join-panel">
              {active.joinedTables?.length > 0 && (
                <div className="join-chip-row">
                  <span className="join-panel__label">{t('tables.joinedWith')}</span>
                  {active.joinedTables.map((joined) => (
                    <span className="join-chip is-joined" key={joined.table}>
                      {joined.name}
                      <button type="button" aria-label={t('tables.releaseTable', { table: joined.name })} data-tip={t('tables.releaseTable', { table: joined.name })} onClick={() => handleUnjoin(joined)}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {joinPicking && (
                <>
                  <p className="field-hint" style={{ margin: 0 }}>{t('tables.joinTablesHint')}</p>
                  {joinableTables.length === 0 ? (
                    <p className="field-hint" style={{ margin: 0 }}>{t('tables.noFreeTables')}</p>
                  ) : (
                    <div className="join-chip-row">
                      {joinableTables.map((tb) => {
                        const picked = joinPick.includes(tb._id);
                        return (
                          <button
                            type="button"
                            key={tb._id}
                            className={`join-chip${picked ? ' active' : ''}`}
                            aria-pressed={picked}
                            onClick={() => setJoinPick((list) => (picked ? list.filter((id) => id !== tb._id) : [...list, tb._id]))}
                          >
                            {tb.name}
                            <small>{tb.zone} · <UsersIcon size={11} /> {tb.capacity}</small>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <button type="button" className="btn btn-primary btn-small btn-inline" disabled={joinPick.length === 0 || busy !== ''} onClick={handleJoin}>
                    {busy === 'join' ? t('common.saving') : t('tables.joinNow', { count: joinPick.length })}
                  </button>
                </>
              )}
            </div>
          )}

          <div className="pos-layout tables-pos">
            {/* Left: the menu. */}
            <div className="pos-main">
              <div className="panel">
                {/* One clean box: icon inside, a count while searching, one tap to clear, and
                    Enter adds the first match — the fastest way to ring up "2 chai" at a rush. */}
                {active.orderType === 'dine_in' && active.table && (() => {
                  const table = floorTables.find((tb) => String(tb._id) === String(active.table));
                  if (!table) return null;
                  const groupsHere = ordersByTable.get(String(active.table)) || [active];
                  const others = groupsHere.filter((o) => o._id !== active._id);
                  // Other groups' chairs at a shared table can't take this group's dishes.
                  const lockedSeats = others.flatMap((o) => o.occupiedSeats || []);
                  return (
                    <SeatPicker
                      compact
                      table={table}
                      selectedSeats={seatPicks}
                      seatCounts={seatCounts}
                      onToggle={toggleSeat}
                      onClear={() => setSeatPicks([])}
                      seatClasses={seatClassesFor(groupsHere, table.capacity) || undefined}
                      lockedSeats={lockedSeats}
                      t={t}
                    />
                  );
                })()}
                <MenuSearchBox
                  value={menuQuery}
                  onChange={setMenuQuery}
                  search={menuSearch}
                  qtyOnTable={qtyOnTable}
                  onPick={(product, qty) => handleAddItem(product, qty)}
                  onCategory={setCategoryFilter}
                  isExpired={productIsExpired}
                  t={t}
                  lang={lang}
                />

                {categories.length > 0 && (
                  <CategoryRail
                    categories={categories}
                    value={categoryFilter}
                    onChange={setCategoryFilter}
                    counts={categoryCounts}
                    searching={menuSearching}
                    t={t}
                  />
                )}

                {/* What is on screen, and how it is ordered — one quiet line. */}
                {products.length > 0 && (
                  <div className="menu-results-bar">
                    <span className="menu-results-bar__count">
                      {menuSearching || categoryFilter
                        ? t('tables.msearch.showing', { count: menuSearch.total })
                        : t('tables.msearch.allDishes', { count: menuSearch.total })}
                      {menuSearching && menuSearch.parsed.qty > 1 && (
                        <span className="menu-results-bar__chip">{t('tables.msearch.qtyChip', { qty: menuSearch.parsed.qty })}</span>
                      )}
                      {(categoryFilter || menuSearching) && (
                        <button type="button" className="link-btn" onClick={() => { setMenuQuery(''); setCategoryFilter(''); }}>
                          {t('tables.msearch.reset')}
                        </button>
                      )}
                    </span>
                    <span className="menu-results-bar__sort">
                      <Dropdown
                        id="menuSort"
                        value={menuSort}
                        onChange={setMenuSort}
                        options={MENU_SORTS.map((key) => ({ value: key, label: t(`tables.msearch.sort.${key}`) }))}
                      />
                    </span>
                  </div>
                )}

                {menu.length === 0 ? (
                  /* "Kuch nahi mila" is the wrong sentence for a kitchen that has not
                     entered its menu yet — nothing was searched for. A new restaurant
                     opening a table and finding that line has no idea the dishes live on
                     another screen, so the empty catalog says so and links there. */
                  products.length === 0 ? (
                    <div className="empty-state-rich">
                      <div className="empty-icon"><PackageIcon size={24} /></div>
                      <p>{t('tables.menuEmpty')}</p>
                      <Link href="/seller/products?new=1" className="btn btn-primary btn-small btn-inline" style={{ textDecoration: 'none' }}>
                        <PlusIcon size={15} /> {t('tables.addDish')}
                      </Link>
                    </div>
                  ) : (
                    <div className="empty-state menu-no-match">
                      <p>{t('tables.menuNoMatch')}</p>
                      {menuSearch.didYouMean && (
                        <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => setMenuQuery(menuSearch.didYouMean)}>
                          <SearchIcon size={15} /> {t('tables.msearch.didYouMean')} {menuSearch.didYouMean}?
                        </button>
                      )}
                      {categoryFilter && (
                        <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => setCategoryFilter('')}>
                          {t('tables.msearch.searchAll')}
                        </button>
                      )}
                      <small>{t('tables.msearch.tips')}</small>
                    </div>
                  )
                ) : (
                  <div className="menu-grid">
                    {menu.map((product) => {
                      const onTable = qtyOnTable.get(String(product._id)) || 0;
                      return (
                        <button
                          key={product._id}
                          ref={(node) => { if (node) menuItemRefs.current.set(String(product._id), node); else menuItemRefs.current.delete(String(product._id)); }}
                          type="button"
                          className={`menu-tile ${onTable > 0 ? 'is-on-table' : ''}${productIsExpired(product) ? ' is-expired' : ''}`}
                          aria-label={productIsExpired(product) ? t('seller.expiredCannotBill', { names: product.name }) : product.name}
                          onClick={() => handleAddItem(product)}
                        >
                          {onTable > 0 && <span className="menu-tile__count">{onTable}</span>}
                          {product.photoUrl && <img src={product.photoUrl} alt="" className="menu-tile__photo" />}
                          <span className="menu-tile__name">{product.name}</span>
                          <span className="menu-tile__foot">
                            <span className="menu-tile__price">{formatRupees(product.price, lang)}</span>
                            <span className="menu-tile__add"><PlusIcon size={14} /></span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right: the running bill, pinned. */}
            <div className="pos-checkout">
              <div className="panel pos-ticket">
                <div className="ticket-head">
                  <h3>{t('tables.orderTicket')}</h3>
                  <span className="ticket-head__count">
                    {t('tables.itemCount', { count: active.items.length })}
                  </span>
                </div>

                <div className="pos-ticket__body">
                  {/* The order's own note and who it is for. Both have been on the model
                      since Round 1 and were writable only in the seat-a-table modal. */}
                  <div className="order-note-row">
                    <input
                      value={orderNoteDraft}
                      onChange={(e) => setOrderNoteDraft(e.target.value)}
                      onBlur={saveOrderNote}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      placeholder={t('tables.orderNotePlaceholder')}
                    />
                  </div>

                  {active.items.length === 0 ? (
                    <p className="empty-state">{t('tables.noItemsYet')}</p>
                  ) : (
                    <div className="ticket-lines">
                      {ticketGroups.map((group) => (
                      <Fragment key={group.seats.join('+') || 'table'}>
                      {!group.plain && (() => {
                        const key = group.seats.join('+');
                        const picked = key && key === seatPicks.join('+');
                        return (
                          <button
                            type="button"
                            className={`ticket-seat-head${picked ? ' is-picked' : ''}${group.seats.length > 1 ? ' is-shared' : ''}`}
                            // Tapping a chair's heading picks that chair (or that set of chairs)
                            // for the next dish — "one more of these for chair 2".
                            onClick={() => group.seats.length && setSeatPicks(picked ? [] : group.seats)}
                            disabled={!group.seats.length}
                          >
                            <span className="ticket-seat-head__chip">{group.seats.length ? group.seats.join('+') : '∗'}</span>
                            {group.seats.length === 0
                              ? t('tables.seat.forTableLabel')
                              : group.seats.length === 1
                                ? t('tables.seat.chair', { seat: group.seats[0] })
                                : t('tables.seat.sharedChairs', { seats: group.seats.join(' + ') })}
                            <small>{formatRupees(group.items.reduce((sum, it) => sum + lineTotal(it), 0), lang)}</small>
                          </button>
                        );
                      })()}
                      {group.items.map((item) => (
                        <div className={`ticket-line${shortageFor(item) ? ' is-stock-short' : ''} ${item.sentToKitchen ? 'is-fired' : ''}${productIsExpired(products.find((product) => String(product._id) === String(item.product))) || expiredProductIds.includes(String(item.product)) ? ' is-expired' : ''}`} key={item._id}
                          tabIndex={-1}
                          ref={(node) => { if (node) orderItemRefs.current.set(String(item.product), node); else orderItemRefs.current.delete(String(item.product)); }}
                        >
                          <div className="ticket-line__qty">
                            {shortageFor(item) && (
                              <span className="ticket-line__stock" role="status">
                                {t('seller.stock')}: {shortageFor(item).available ?? '\u2014'} {shortageFor(item).unit}
                                {' \u00b7 '}{t('tables.orderTicket')}: {shortageFor(item).ordered} {shortageFor(item).unit}
                              </span>
                            )}
                            {/* Changeable until the kitchen starts it — after the KOT too. */}
                            {item.sentToKitchen && !['queued', 'pending'].includes(item.kitchenStatus) ? (
                              <span className="ticket-line__qty-fixed">{item.quantity}×</span>
                            ) : (
                              <div className="qty-control">
                                <button type="button" onClick={() => changeQuantity(item, Math.max(1, item.quantity - 1))}>−</button>
                                <input
                                  type="number"
                                  min="0.001"
                                  step="1"
                                  value={item.quantity}
                                  onChange={(e) => changeQuantity(item, Number(e.target.value))}
                                />
                                <button type="button" onClick={() => changeQuantity(item, item.quantity + 1)}>+</button>
                              </div>
                            )}
                          </div>
                          <div className="ticket-line__body">
                            <span className="ticket-line__name">
                              {active.orderType === 'dine_in' && active.table && (
                                <button
                                  type="button"
                                  className={`seat-chip${seatsOf(item).length ? '' : ' is-table'}`}
                                  data-tip={seatPicks.length ? t('tables.seat.moveHere', { seat: seatPicks.join(' + ') }) : t('tables.seat.moveToTable')}
                                  aria-label={seatPicks.length ? t('tables.seat.moveHere', { seat: seatPicks.join(' + ') }) : t('tables.seat.moveToTable')}
                                  onClick={() => seatsOf(item).join('+') !== seatPicks.join('+') && moveToSeat(item)}
                                >
                                  {seatsOf(item).length ? seatsOf(item).join('+') : '∗'}
                                </button>
                              )}
                              {item.name}
                            </span>
                            {noteEditingId === item._id ? (
                              <span className="ticket-line__noteedit">
                                <input
                                  value={noteDraft}
                                  onChange={(e) => setNoteDraft(e.target.value)}
                                  placeholder={t('tables.notePlaceholder')}
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveNote(item);
                                    if (e.key === 'Escape') setNoteEditingId(null);
                                  }}
                                />
                                <button type="button" className="icon-btn" onClick={() => saveNote(item)}>
                                  <CheckIcon size={17} />
                                </button>
                              </span>
                            ) : (
                              <span className="ticket-line__submeta">
                                {/* Where the kitchen has got to with this dish — which is also
                                    what decides whether it can still be changed. */}
                                <span className={`ticket-line__status kstate-${!item.sentToKitchen ? 'unsent' : item.kitchenStatus}`}>
                                  {!item.sentToKitchen
                                    ? t('tables.notSentYet')
                                    : t(`tables.change.state.${['queued', 'pending'].includes(item.kitchenStatus) ? 'queued' : item.kitchenStatus}`)}
                                </span>
                                {item.cancelRequest && (
                                  <span className="ticket-line__status kstate-asked">{t('tables.change.waitingKitchen')}</span>
                                )}
                                {item.amendedAt && <span className="ticket-line__status kstate-changed">{t('tables.change.changedTag')}</span>}
                                {item.note && <span className="ticket-line__note">{item.note}</span>}
                                {(!item.sentToKitchen || ['queued', 'pending'].includes(item.kitchenStatus)) && (
                                  <button type="button" className="link-btn ticket-line__notebtn" onClick={() => openNoteEditor(item)}>
                                    {item.note ? t('common.edit') : t('tables.addNote')}
                                  </button>
                                )}
                              </span>
                            )}
                          </div>
                          <strong className="ticket-line__money">{formatRupees(lineTotal(item), lang)}</strong>
                          {(() => {
                            const made = item.sentToKitchen && ['ready', 'served'].includes(item.kitchenStatus);
                            const tip = !item.sentToKitchen
                              ? t('common.delete')
                              : item.cancelRequest
                                ? t('tables.change.waitingKitchen')
                                : item.kitchenStatus === 'preparing'
                                  ? t('tables.change.cookingAction')
                                  : made
                                    ? (canEditFloor ? t('tables.change.madeAction') : t('tables.change.madeManagerOnly', { name: item.name }))
                                    : t('tables.change.queuedAction');
                            return (
                              <button
                                type="button"
                                className="icon-btn danger"
                                data-tip={tip}
                                aria-label={tip}
                                disabled={!!item.cancelRequest || (made && !canEditFloor)}
                                onClick={() => removeItem(item)}
                              >
                                <TrashIcon size={17} />
                              </button>
                            );
                          })()}
                        </div>
                      ))}
                      </Fragment>
                      ))}
                    </div>
                  )}

                  {/* What was taken off this table before billing — struck through, in red,
                      with the amount, who and when. The table total and the bill can then
                      never disagree without the difference being right here on the ticket. */}
                  {active.removedItems?.length > 0 && (
                    <div className="ticket-removed">
                      <p className="ticket-removed-title">
                        {t('tables.removedTitle', { amount: formatRupees(active.removedTotal || 0, lang) })}
                      </p>
                      {active.removedItems.map((r, i) => (
                        <div className="ticket-removed-line" key={`${r.at}-${i}`}>
                          <span className="ticket-removed-what">
                            {r.name} × {r.quantity}
                          </span>
                          <span className="ticket-removed-amount">{formatRupees(r.amount || 0, lang)}</span>
                          <span className="ticket-removed-who">
                            {t(r.kind === 'reduced' ? 'tables.reducedBy' : 'tables.removedBy', {
                              name: r.byName || '—',
                              time: r.at ? new Date(r.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '',
                            })}
                            {r.reason ? ` · ${r.reason}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Every round fired so far, each reprintable — the screen could only ever
                      reprint the newest one, which is no use when it is the first round's
                      ticket that got lost on the way to the kitchen. */}
                  <div className="kot-autoprint">
                    <Switch
                      id="kot-autoprint"
                      checked={kotAutoPrint}
                      onChange={changeKotAutoPrint}
                      label={t('tables.kotAutoPrint')}
                    />
                    <label htmlFor="kot-autoprint">
                      <strong>{t('tables.kotAutoPrint')}</strong>
                      <small>{t('tables.kotAutoPrintHint')}</small>
                    </label>
                  </div>

                  {active.kots.length > 0 && (
                    <div className="kot-history">
                      <button type="button" className="kot-history__toggle" onClick={() => setKotHistoryOpen((v) => !v)}>
                        {kotHistoryOpen ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
                        {t('tables.kotsSoFar', { count: active.kots.length })}
                      </button>
                      {kotHistoryOpen && (
                        <ul className="kot-history__list">
                          {active.kots.slice().reverse().map((kot) => (
                            <li key={kot.number}>
                              <span>
                                <strong>{t('tables.kot')} {kot.number}</strong>
                                <small>{new Date(kot.sentAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · {kot.items.length}</small>
                              </span>
                              <button type="button" className="icon-btn" data-tip={t('tables.printKot')} onClick={() => handlePrintKot(kot)}>
                                <PrinterIcon size={17} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {active.events && active.events.length > 0 && (
                    <details>
                      <summary>{t('tables.activity')}</summary>
                      <ul className="table-activity">
                        {active.events.slice().reverse().map((event, i) => (
                          <li key={i}>
                            <span>{describeEvent(event, t)}</span>
                            <span>{new Date(event.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {/* A group that already paid and left — so nobody asks the friends still
                      sitting here for the same money twice. */}
                  {active.paidParts?.length > 0 && (
                    <div className="paid-parts">
                      <span className="paid-parts__head">{t('tables.alreadyPaid')}</span>
                      {active.paidParts.map((part) => (
                        <div className="paid-parts__row" key={String(part.bill)}>
                          <span>
                            <CheckIcon size={13} /> {part.label || t('tables.bill')} · #{part.billNumber}
                          </span>
                          <strong>{formatRupees(part.amount, lang)}</strong>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* The section's charge as its own line, with the switch that takes it off
                      when a customer asks — it is never a charge the counter can't remove. */}
                  {chargePercent > 0 && active.items.length > 0 && (
                    <div className="section-charge-row">
                      <Switch id="section-charge" checked={chargeOn} onChange={setChargeOn} label={chargeLabel} />
                      <label htmlFor="section-charge">
                        <strong>{chargeLabel} ({chargePercent}%)</strong>
                        <small>{t('tables.sectionChargeHint')}</small>
                      </label>
                      <span className="section-charge-row__amount">
                        {chargeOn ? formatRupees(chargeAmount, lang) : '—'}
                      </span>
                    </div>
                  )}

                  {/* The parcel/delivery charge — its own line on the bill, off with one switch
                      for a regular, and the amount typed for this order when the trip is
                      longer or shorter than usual. Free delivery says so instead of vanishing. */}
                  {takeawayBase && active.items.length > 0 && (
                    <div className="section-charge-row">
                      {!takeawayBase.free && (
                        <Switch id="takeaway-charge" checked={takeawayOn} onChange={setTakeawayOn} label={takeawayLabel} />
                      )}
                      <label htmlFor={takeawayBase.free ? undefined : 'takeaway-charge'}>
                        <strong>{takeawayLabel}</strong>
                        <small>
                          {takeawayBase.free
                            ? t('tables.freeDeliveryApplied', { amount: formatRupees(takeawaySettings.freeDeliveryAbove, lang) })
                            : t('tables.takeawayChargeHint')}
                        </small>
                      </label>
                      {takeawayBase.free ? (
                        <span className="section-charge-row__amount is-free">{t('tables.free')}</span>
                      ) : takeawayOn ? (
                        <span className="takeaway-charge-input">
                          <span aria-hidden="true">₹</span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            inputMode="decimal"
                            value={takeawayDraft}
                            placeholder={String(takeawayBase.amount)}
                            onChange={(e) => setTakeawayDraft(e.target.value)}
                            aria-label={takeawayLabel}
                          />
                        </span>
                      ) : (
                        <span className="section-charge-row__amount">—</span>
                      )}
                    </div>
                  )}

                  {/* A parcel with no packing charge set anywhere: say where it is set, once,
                      quietly — to the people who can set it. */}
                  {!takeawayBase && active.orderType !== 'dine_in' && active.items.length > 0 && canEditFloor && (
                    <div className="section-charge-row is-unset">
                      <span className="takeaway-unset">
                        {t(active.orderType === 'delivery' ? 'tables.deliveryChargeUnset' : 'tables.parcelChargeUnset')}
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small btn-inline"
                        onClick={() => { setManageStart('takeaway'); setManageOpen(true); }}
                      >
                        {t('tables.takeawayChargeSetUp')}
                      </button>
                    </div>
                  )}

                  {guestSplitOpen && (
                    <div className="guest-split-panel">
                      <div className="guest-split-top">
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>{t('tables.splitGuestCount')}</label>
                          <div className="qty-control">
                            <button type="button" onClick={() => changeSplitGuestCount(splitGuestCount - 1)}>−</button>
                            <span className="guest-count-value">{splitGuestCount}</span>
                            <button type="button" onClick={() => changeSplitGuestCount(splitGuestCount + 1)}>+</button>
                          </div>
                        </div>
                        <span className="row-actions">
                          {active.items.some((it) => it.seat || it.seats?.length) && (
                            <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={splitBySeat}>
                              {t('tables.seat.splitBySeat')}
                            </button>
                          )}
                          <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={shareEverything}>
                            {t('tables.splitAllEqually')}
                          </button>
                        </span>
                      </div>
                      <p className="field-hint">{t('tables.splitHint')}</p>

                      <div className="guest-split-items">
                        {active.items.map((item) => {
                          const rule = allocation[item._id] || {};
                          const whole = !rule.share && !rule.shareAmong && !Array.isArray(rule.qty);
                          const wholeTo = whole && Number.isInteger(rule.to) && rule.to < splitGuestCount ? rule.to : 0;
                          const assigned = Array.isArray(rule.qty) ? rule.qty.reduce((sum, v) => sum + (Number(v) || 0), 0) : item.quantity;
                          const off = Array.isArray(rule.qty) && assigned !== item.quantity;
                          return (
                            <div className={`guest-split-item${off ? ' is-off' : ''}`} key={item._id}>
                              <span className="guest-split-item-name">
                                {item.quantity}× {item.name}
                                <span className="guest-split-item-price">{formatRupees(lineTotal(item), lang)}</span>
                              </span>
                              <span className="guest-chip-row">
                                {Array.from({ length: splitGuestCount }, (_, i) => (
                                  <button
                                    key={i}
                                    type="button"
                                    className={`guest-chip ${whole && wholeTo === i ? 'active' : ''}`}
                                    data-tip={groupLabel(i)}
                                    onClick={() => setItemRule(item, { to: i })}
                                  >
                                    {i + 1}
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  className={`guest-chip guest-chip--wide ${rule.share ? 'active' : ''}`}
                                  onClick={() => setItemRule(item, { share: true })}
                                >
                                  {t('tables.share')}
                                </button>
                                {canSplitQuantity(item) && (
                                  <button
                                    type="button"
                                    className={`guest-chip guest-chip--wide ${Array.isArray(rule.qty) ? 'active' : ''}`}
                                    onClick={() => startQuantitySplit(item)}
                                  >
                                    {t('tables.splitQty')}
                                  </button>
                                )}
                              </span>
                              {rule.share && (
                                <span className="guest-split-item-note">
                                  {t('tables.sharedNote', { share: formatShareQuantity(item.quantity / splitGuestCount), count: splitGuestCount })}
                                </span>
                              )}
                              {Array.isArray(rule.qty) && (
                                <span className="guest-qty-row">
                                  {Array.from({ length: splitGuestCount }, (_, i) => (
                                    <span className="guest-qty" key={i}>
                                      <small>{groupLabel(i)}</small>
                                      <span className="qty-control">
                                        <button type="button" onClick={() => stepQuantity(item, i, -1)}>−</button>
                                        <span className="guest-count-value">{Number(rule.qty[i]) || 0}</span>
                                        <button type="button" onClick={() => stepQuantity(item, i, 1)}>+</button>
                                      </span>
                                    </span>
                                  ))}
                                  {off && (
                                    <span className="guest-split-item-warn">
                                      {t('tables.splitUnbalanced', { name: item.name, assigned, total: item.quantity })}
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="guest-summary-grid">
                        {guestGroups.map((g) => {
                          const payingGroups = guestGroups.filter((x) => x.lines.length > 0).length;
                          return (
                            <div className="guest-summary-card" key={g.index}>
                              <div className="guest-summary-head">
                                <input
                                  className="guest-name-input"
                                  value={groupNames[g.index] || ''}
                                  onChange={(e) => setGroupNames((names) => ({ ...names, [g.index]: e.target.value }))}
                                  placeholder={`${t('tables.bill')} ${g.index + 1}`}
                                  aria-label={t('tables.billName')}
                                  maxLength={30}
                                />
                                <strong>{formatRupees(g.payable, lang)}</strong>
                              </div>
                              {g.lines.length === 0 ? (
                                <p className="field-hint" style={{ margin: 0 }}>{t('tables.splitNoItems')}</p>
                              ) : (
                                <>
                                  <ul className="guest-summary-lines">
                                    {g.lines.map(({ item, quantity }) => (
                                      <li key={item._id}>
                                        <span>{formatShareQuantity(quantity)}× {item.name}</span>
                                        <span>{formatRupees(item.price * quantity, lang)}</span>
                                      </li>
                                    ))}
                                    {g.charge > 0 && (
                                      <li className="is-charge">
                                        <span>{chargeLabel} ({chargePercent}%)</span>
                                        <span>{formatRupees(g.charge, lang)}</span>
                                      </li>
                                    )}
                                    {g.takeaway > 0 && (
                                      <li className="is-charge">
                                        <span>{takeawayLabel}</span>
                                        <span>{formatRupees(g.takeaway, lang)}</span>
                                      </li>
                                    )}
                                  </ul>
                                  <div className="segmented-mini" role="group">
                                    {['cash', 'upi', 'card', 'khata'].map((mode) => (
                                      <button
                                        key={mode}
                                        type="button"
                                        className={(guestModes[g.index] || 'cash') === mode ? 'active' : ''}
                                        onClick={() => setGuestModes((m) => ({ ...m, [g.index]: mode }))}
                                      >
                                        {mode === 'khata' ? t('nav.khata') : t(`seller.${mode}`)}
                                      </button>
                                    ))}
                                  </div>
                                  {/* Every mode, like the whole-table bill: needed for
                                      khata, optional otherwise so this bill can be sent. */}
                                  <div className="customer-picker">
                                    <Dropdown
                                      value={guestCustomers[g.index] || ''}
                                      onChange={(v) => setGuestCustomers((c) => ({ ...c, [g.index]: v }))}
                                      searchable={billableCustomers.length > 8}
                                      searchPlaceholder={t('seller.customerSearchHint')}
                                      emptyLabel={t('seller.customerSearchNone')}
                                      options={[
                                        {
                                          value: '',
                                          label: (guestModes[g.index] || 'cash') === 'khata'
                                            ? t('seller.selectCustomer')
                                            : t('tables.billCustomer'),
                                        },
                                        ...customerOptions,
                                      ]}
                                    />
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-small btn-inline"
                                      onClick={() => setCustomerAddFor({ target: g.index })}
                                      data-tip={t('seller.quickCustomerAdd')}
                                      aria-label={t('seller.quickCustomerAdd')}
                                    >
                                      {/* Icon only: a split card can be 190px, and a worded
                                          button left the name in the picker as "Custo…". */}
                                      <PlusIcon size={15} />
                                    </button>
                                  </div>
                                  {/* The picker truncates in a narrow card; the number being
                                      sent to has to be readable in full. */}
                                  {customerById(guestCustomers[g.index]) && (
                                    <span className="cell-sub">
                                      {customerLine(customerById(guestCustomers[g.index]))}
                                    </span>
                                  )}
                                  {groupNeedsCustomer(g) && (
                                    <p className="field-hint" style={{ margin: 0 }}>{t('tables.khataCustomerHint')}</p>
                                  )}
                                  {/* Only when someone else is still on the table — paying the
                                      only bill with food on it is just settling the table. */}
                                  {payingGroups > 1 && (
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-small btn-inline"
                                      disabled={busy !== ''}
                                      onClick={() => handlePartSettle(g)}
                                    >
                                      <ReceiptIcon size={15} /> {t('tables.payThisOnly')}
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {!guestSplitOpen && (
                    <>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>{t('seller.paymentMode')}</label>
                        <div className="segmented" role="group">
                          {[
                            { id: 'cash', label: t('seller.cash'), icon: RupeeIcon },
                            { id: 'upi', label: t('seller.upi'), icon: WalletIcon },
                            { id: 'card', label: t('seller.card'), icon: CreditCardIcon },
                            { id: 'khata', label: t('nav.khata'), icon: LedgerIcon },
                            { id: 'split', label: t('seller.splitPayment'), icon: SwapIcon },
                          ].map(({ id, label, icon: ModeIcon }) => (
                            <button key={id} type="button" className={settleMode === id ? 'active' : ''} onClick={() => setSettleMode(id)}>
                              <ModeIcon size={15} /> {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* On every mode: required for khata, optional otherwise — a UPI
                          or cash bill with a customer on it can be sent to them. */}
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label htmlFor="settle-customer">
                          {settleMode === 'khata' ? t('seller.selectCustomer') : `${t('tables.billCustomer')} (${t('seller.optional')})`}
                        </label>
                        <div className="customer-picker">
                          <Dropdown
                            id="settle-customer"
                            value={settleCustomerId}
                            onChange={setSettleCustomerId}
                            searchable={billableCustomers.length > 8}
                            searchPlaceholder={t('seller.customerSearchHint')}
                            emptyLabel={t('seller.customerSearchNone')}
                            options={[{ value: '', label: t('seller.noKhataCustomer') }, ...customerOptions]}
                          />
                          <button
                            type="button"
                            className="btn btn-secondary btn-small btn-inline"
                            onClick={() => setCustomerAddFor({ target: 'settle' })}
                            data-tip={t('seller.quickCustomerAdd')}
                          >
                            <PlusIcon size={15} /> {t('seller.newCustomerShort')}
                          </button>
                        </div>
                        <p className="field-hint" style={{ margin: '0.3rem 0 0' }}>
                          {settleMode === 'khata' ? t('tables.khataCustomerHint') : t('tables.billCustomerHint')}
                        </p>
                      </div>

                      {settleMode === 'split' && (
                        <div className="split-panel">
                          <div className="split-head">
                            <strong>{t('seller.splitPayment')}</strong>
                            <button type="button" className="link-btn" onClick={() => setSplit({ cash: '', upi: '', card: '' })}>
                              {t('seller.splitClear')}
                            </button>
                          </div>
                          {SPLIT_MODES.map((mode) => (
                            <div className="split-row" key={mode}>
                              <label htmlFor={`split-${mode}`}>{t(`expenses.mode.${mode}`)}</label>
                              <input
                                id={`split-${mode}`}
                                type="number"
                                min="0"
                                step="0.01"
                                inputMode="decimal"
                                value={split[mode]}
                                onChange={(e) => setSplit((s) => ({ ...s, [mode]: e.target.value }))}
                              />
                            </div>
                          ))}
                          <div className="split-row split-remaining">
                            <span>{t('common.total')}</span>
                            <strong>{formatRupees(splitEntered, lang)} / {formatRupees(payable, lang)}</strong>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="billDiscountPercent">{t('seller.discount')} (%)</label>
                      <input id="billDiscountPercent" type="number" min="0" max="100" value={billDiscountPercent} onChange={(e) => { setBillDiscountPercent(e.target.value); setBillDiscountAmount(''); }} placeholder="0" />
                    </div>
                    <div className="field">
                      <label htmlFor="billDiscountAmount">{t('seller.discount')} (₹)</label>
                      <input
                        id="billDiscountAmount"
                        type="number"
                        min="0"
                        value={billDiscountAmount}
                        onChange={(e) => { setBillDiscountAmount(e.target.value); setBillDiscountPercent(''); }}
                        placeholder="0"
                        disabled={!!Number(billDiscountPercent) || guestSplitOpen}
                        data-tip={guestSplitOpen ? t('tables.splitFlatDiscountDisabled') : undefined}
                      />
                    </div>
                  </div>
                </div>

                {/* Pinned: the total and the one button that ends the table are never
                    scrolled off, however long the order gets. */}
                <div className="pos-ticket__foot">
                  <div className="ticket-total-row">
                    <span>{t('tables.toPay')}</span>
                    <strong>{formatRupees(payable, lang)}</strong>
                  </div>
                  {billDiscountValue > 0 && (
                    <p className="ticket-total-note">
                      {t('seller.discount')} −{formatRupees(billDiscountValue, lang)}
                    </p>
                  )}
                  {/* The paise the bill rounds away (or adds), shown so "why ₹105 when the dishes
                      add up to ₹104.50" is never a question at the table. */}
                  {Math.abs(tableMoney.roundOff) >= 0.005 && (
                    <p className="ticket-total-note">
                      {t('seller.roundOff')} {tableMoney.roundOff > 0 ? '+' : '−'}{formatRupees(Math.abs(tableMoney.roundOff), lang)}
                    </p>
                  )}
                  <div className="ticket-foot-actions">
                    {active.orderType === 'dine_in' && active.items.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-inline"
                        onClick={() => (guestSplitOpen ? setGuestSplitOpen(false) : openGuestSplit())}
                      >
                        <LayersIcon size={17} /> {guestSplitOpen ? t('common.cancel') : t('tables.splitByGuest')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-primary btn-inline ticket-settle-btn"
                      disabled={busy !== '' || active.items.length === 0}
                      onClick={guestSplitOpen ? handleGuestSplitSettle : handleSettle}
                    >
                      <ReceiptIcon size={17} />
                      {busy === 'settle'
                        ? t('common.saving')
                        : guestSplitOpen
                          ? t('tables.splitSettleAction', { count: guestGroups.filter((g) => g.lines.length > 0).length })
                          : t('tables.settle')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* ===================== The floor ===================== */
        <>
          <div className="page-head">
            <div className="page-head-text">
              <h1>{t('tables.title')}</h1>
              <p className="page-head-sub">{t('tables.subtitle')}</p>
            </div>
            <div className="row-actions">
              {/* The kitchen is the other half of this screen and had no way in from it.
                  Carries its own count, so the number that matters — how much food is
                  actually on the fire — is readable without leaving the floor. */}
              <Link href="/seller/kitchen" className="btn btn-secondary btn-inline">
                <KitchenIcon size={17} /> {t('nav.kitchen')}
                {floorStats.onFire > 0 && <span className="link-count">{floorStats.onFire}</span>}
              </Link>
              {/* The raw stock the floor runs on — how much paneer is left, how long it
                  lasts. Lived only behind a button on the Products page, where an owner on
                  the floor never went. */}
              {!hiddenNav.includes('inventory') && (user?.role !== 'staff' || user?.permissions?.includes('inventory')) && (
                <Link href="/seller/products?view=kitchen" className="btn btn-secondary btn-inline">
                  <LayersIcon size={17} /> {t('kitchenStock.open')}
                </Link>
              )}
              {/* Every settled bill — table, takeaway or counter — is in the one register;
                  this lands on it rather than on the empty counter above it. */}
              {canSeeBills && (
                <Link href="/seller/billing#bills" className="btn btn-secondary btn-inline">
                  <ReceiptIcon size={17} /> {t('seller.recentBills')}
                </Link>
              )}
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setTakeawayOpen(true)}>
                <PlusIcon size={17} /> {t('tables.newTakeaway')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => { setManageStart(null); setManageOpen(true); }}>
                <EditIcon size={17} /> {t('tables.manageTables')}
              </button>
              {!guideOpen && (
                <button type="button" className="icon-btn" data-tip={t('tables.visual.guideOpen')} aria-label={t('tables.visual.guideOpen')} onClick={() => setGuideOpen(true)}>
                  <InfoIcon size={17} />
                </button>
              )}
            </div>
          </div>

          {guideOpen && <HowItWorks onClose={closeGuide} t={t} />}

          {(floorStats.total > 0 || takeawayOrders.length > 0) && (
            <FloorLegend counts={legendCounts} running={floorStats.running} active={stageFilter} onPick={setStageFilter} t={t} lang={lang} />
          )}
          <ActionStrip entries={needsAction} onOpen={setActiveId} t={t} />

          {takeawayOrders.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <h2>{t('tables.takeaway')}</h2>
              </div>
              <div className="floor-grid">
                {takeawayOrders.map((order) => {
                  const stage = tableStage(order, null, now);
                  return (
                    <FloorTableCard
                      key={order._id}
                      takeaway
                      table={{ _id: order._id, name: order.tableName, capacity: order.guestCount || 0 }}
                      orders={[order]}
                      stage={stage}
                      now={now}
                      t={t}
                      lang={lang}
                      dimmed={!!stageFilter && legendKey(stage.key) !== stageFilter}
                      onOpen={() => setActiveId(order._id)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          <div className="panel">
            {zones.length === 0 ? (
              <div className="empty-state-rich">
                <Illustration scene="board" />
                <p>{t('tables.noTablesConfigured')}</p>
                <p className="field-hint">{t('tables.setupHint')}</p>
                <button type="button" className="btn btn-primary btn-small btn-inline" onClick={() => { setManageStart('add'); setManageOpen(true); }}>
                  <PlusIcon size={15} /> {t('tables.addTable')}
                </button>
                <form onSubmit={handleQuickOpen} className="form-grid" style={{ marginTop: '1rem', width: '100%' }}>
                  <div className="field">
                    <label htmlFor="quickName">{t('tables.orQuickOpen')}</label>
                    <input id="quickName" value={quickName} onChange={(e) => setQuickName(e.target.value)} placeholder={t('tables.tableNamePlaceholder')} />
                  </div>
                  <div className="field" style={{ alignSelf: 'flex-end' }}>
                    <button type="submit" className="btn btn-secondary btn-inline" disabled={busy === 'open'}>
                      {t('tables.openTable')}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <>
              {/* One tap to see only your own section — the AC-hall waiter does not need
                  the terrace on their phone. Remembered per device. */}
              {zones.length > 1 && (
                <div className="category-tabs zone-tabs">
                  <button type="button" className={`filter-pill ${!zoneFilter || visibleZones.length === zones.length ? 'active' : ''}`} onClick={() => changeZoneFilter('')}>
                    {t('tables.allSections')}
                  </button>
                  {zones.map(([zone, tables]) => (
                    <button key={zone} type="button" className={`filter-pill ${zoneFilter === zone && visibleZones.length !== zones.length ? 'active' : ''}`} onClick={() => changeZoneFilter(zone)}>
                      {zone} <span className="zone-tab-count">{freeIn(tables)}/{tables.length}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="floor-view-toggle segmented-mini" role="group" aria-label={t('tables.visual.viewAria')}>
                <button type="button" className={floorView === 'grid' ? 'active' : ''} onClick={() => changeFloorView('grid')}>
                  <GridIcon size={14} /> {t('tables.visual.viewTiles')}
                </button>
                <button type="button" className={floorView === 'map' ? 'active' : ''} onClick={() => changeFloorView('map')}>
                  <LayersIcon size={14} /> {t('tables.visual.viewMap')}
                </button>
              </div>
              {floorView === 'map' && (
                <>
                  {/* One card above the map, for everyone: what this view is, what to do on it, and —
                      for the owner or a manager — the switch to arrange the tables. */}
                  <div className={`fmap-bar${mapEdit ? ' is-on' : ''}`}>
                    <span className="fmap-bar__icon"><LayersIcon size={18} /></span>
                    <span className="fmap-bar__text">
                      <strong>{mapEdit ? t('tables.visual.arrangeTitle') : t('tables.visual.mapTitle')}</strong>
                      <small>{mapEdit ? t('tables.visual.arrangeOn') : canEditFloor ? t('tables.visual.arrangeOff') : t('tables.visual.mapHint')}</small>
                    </span>
                    {canEditFloor && (
                      <button
                        type="button"
                        className={`btn btn-small btn-inline ${mapEdit ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setMapEdit((v) => !v)}
                      >
                        {mapEdit ? <><CheckIcon size={15} /> {t('tables.visual.arrangeDone')}</> : <><EditIcon size={15} /> {t('tables.visual.arrange')}</>}
                      </button>
                    )}
                  </div>
                  <FloorMap
                    entries={visibleZones.flatMap(([, tables]) => tables).map((table) => floorEntries.get(String(table._id)) || { table, orders: [], joinedOrder: null, stage: tableStage(null, table, now) })}
                    stageFilter={stageFilter}
                    onOpen={(table) => openTableFrom(table, floorEntries.get(String(table._id)))}
                    editable={mapEdit && canEditFloor}
                    onMove={moveTableOnMap}
                    t={t}
                    lang={lang}
                  />
                </>
              )}
              {floorView === 'grid' && visibleZones.map(([zone, tables]) => (
                <div className="floor-zone" key={zone}>
                  <h3 className="floor-zone-title">
                    {zone}
                    <span className="floor-zone-title__meta">{t('tables.freeOfTotal', { free: freeIn(tables), total: tables.length })}</span>
                    {zoneConfig.get(zone)?.chargePercent > 0 && (
                      <span className="badge badge-pending">+{zoneConfig.get(zone).chargePercent}% {chargeLabelFor(zone)}</span>
                    )}
                  </h3>
                  <div className="floor-grid">
                    {tables.map((table) => {
                      const entry = floorEntries.get(String(table._id)) || { orders: [], joinedOrder: null, stage: tableStage(null, table, now), seatInfo: seatsAtTable(table.capacity, []) };
                      return (
                      <FloorTableCard
                        key={table._id}
                        table={table}
                        orders={entry.orders || []}
                        joinedOrder={entry.joinedOrder || null}
                        stage={entry.stage}
                        stagesByOrder={stagesByOrder}
                        seatInfo={entry.seatInfo}
                        now={now}
                        t={t}
                        lang={lang}
                        dimmed={!!stageFilter && legendKey(entry.stage.key) !== stageFilter}
                        onNewGroup={() => openShare(table)}
                        onOpen={() => openTableFrom(table, entry)}
                        onSeat={() => handleSeatReservation(table)}
                        onCancelReserve={() => handleCancelReservation(table)}
                      />
                      );
                    })}
                  </div>
                </div>
              ))}
              </>
            )}
          </div>
        </>
      )}

      {/* Below 1100px the two panes stack, so the ticket — and with it the total and the
          Settle button — sits under the whole menu. That is the same "scroll past
          everything to finish" problem the two-pane layout fixed on desktop, reappearing
          on the phone a waiter actually carries. Same fixed bar the billing screen uses. */}
      {active && active.items.length > 0 && !guestSplitOpen && !modifierPickFor && !manageOpen && !takeawayOpen && (
        <div className="pos-paybar">
          <div className="pos-paybar__total">
            <span>{t('tables.itemCount', { count: active.items.length })}</span>
            <strong>{formatRupees(payable, lang)}</strong>
          </div>
          <div className="row-actions">
            {pendingCount > 0 && (
              // "KOT 2", not "Send 2 to kitchen" — two full-length buttons plus the total
              // do not fit a 390px phone, and KOT is what the staff who use this bar call
              // it anyway. The long label stays on the order bar, where there is room.
              <button type="button" className="btn btn-secondary" disabled={busy !== ''} onClick={handleSendKot}>
                {t('tables.kot')} {pendingCount}
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy !== ''}
              onClick={handleSettle}
            >
              {busy === 'settle' ? t('common.saving') : t('tables.settle')}
            </button>
          </div>
        </div>
      )}

      {/* Opening a parcel/delivery order — a modal now, not a four-field form parked
          permanently above the floor. It is the least-used thing on this screen and it
          was taking the most prominent space on it. */}
      {takeawayOpen && (
        <Modal
          as="form"
          onSubmit={handleTakeawayOpen}
          onClose={() => setTakeawayOpen(false)}
          title={t('tables.newTakeaway')}
          footer={
            <button type="submit" className="btn btn-primary btn-inline" disabled={busy === 'open'}>
              <PlusIcon size={17} />
              {busy === 'open' ? t('common.saving') : t('tables.openTable')}
            </button>
          }
        >
          <div className="form-grid">
              <div className="field">
                <label>{t('tables.orderType')}</label>
                <Dropdown
                  value={takeawayForm.orderType}
                  onChange={(v) => setTakeawayForm((f) => ({ ...f, orderType: v }))}
                  options={TAKEAWAY_TYPES.map((key) => ({ value: key, label: t(`tables.type.${key}`) }))}
                />
                {/* Said before the order is opened, so the charge on the bill is never news. */}
                {(() => {
                  const isParcel = takeawayForm.orderType === 'parcel';
                  const amount = isParcel ? takeawaySettings?.parcelCharge : takeawaySettings?.deliveryCharge;
                  if (!(amount > 0)) return null;
                  const label = isParcel
                    ? takeawaySettings.parcelLabel || t('tables.parcelChargeDefault')
                    : takeawaySettings.deliveryLabel || t('tables.deliveryChargeDefault');
                  return (
                    <p className="field-hint" style={{ margin: '0.3rem 0 0' }}>
                      {t('tables.takeawayChargeWillAdd', { label, amount: formatRupees(amount, lang) })}
                    </p>
                  );
                })()}
              </div>
              <div className="field">
                <label htmlFor="takeawayLabel">{t('tables.orderLabel')}</label>
                <input
                  id="takeawayLabel"
                  value={takeawayForm.label}
                  onChange={(e) => setTakeawayForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder={t('tables.orderLabelPlaceholder')}
                  autoFocus
                />
              </div>
              <div className="field">
                <label htmlFor="takeawayName">{t('common.name')}</label>
                <input
                  id="takeawayName"
                  value={takeawayForm.customerName}
                  onChange={(e) => setTakeawayForm((f) => ({ ...f, customerName: e.target.value }))}
                  placeholder={t('seller.optional') || ''}
                />
              </div>
              <div className="field">
                <label htmlFor="takeawayPhone">{t('common.phone')}</label>
                <input
                  id="takeawayPhone"
                  value={takeawayForm.customerPhone}
                  onChange={(e) => setTakeawayForm((f) => ({ ...f, customerPhone: e.target.value }))}
                  placeholder={t('seller.optional') || ''}
                />
              </div>
          </div>
        </Modal>
      )}

      {splitSettledReceipts.length > 0 && (
        <SplitSettledBills
          entries={splitSettledReceipts}
          t={t}
          lang={lang}
          whatsappOn={whatsappOn}
          onPrint={printSettled}
          onSend={handleSendBill}
          onCopyLink={copySettledLink}
          onClose={() => setSplitSettledReceipts([])}
        />
      )}

      {settledReceipt && (
        <SettledBill
          key={settledReceipt.bill._id}
          entry={settledReceipt}
          t={t}
          lang={lang}
          whatsappOn={whatsappOn}
          onPrint={printSettled}
          onSend={handleSendBill}
          onCopyLink={copySettledLink}
          onAttachCustomer={attachSettledCustomer}
          onClose={() => setSettledReceipt(null)}
        />
      )}

      {customerAddFor && (
        <CustomerQuickAdd
          prefill={customerPrefill(customerAddFor.target)}
          onCreated={handleCustomerAdded}
          onClose={() => setCustomerAddFor(null)}
        />
      )}

      {waSheet && <WhatsappSheet {...waSheet} onClose={() => setWaSheet(null)} />}

      {/* Manage the floor plan — its own component, one job on screen at a time. */}
      {manageOpen && (
        <ManageTables
          floorTables={floorTables}
          setFloorTables={setFloorTables}
          zoneSettings={zoneSettings}
          takeawaySettings={takeawaySettings}
          busyTableIds={new Set(orderByTableId.keys())}
          canEdit={canEditFloor}
          startWith={manageStart}
          onReload={loadFloorTables}
          onZoneRenamed={(from, to) => { if (zoneFilter === from) changeZoneFilter(to); }}
          onClose={() => setManageOpen(false)}
        />
      )}

      {/* A table two or more groups share: pick which one to open. */}
      {groupPickFor && floorEntries.get(groupPickFor) && (
        <GroupPicker
          table={floorEntries.get(groupPickFor).table}
          orders={floorEntries.get(groupPickFor).orders}
          stagesByOrder={stagesByOrder}
          seatInfo={floorEntries.get(groupPickFor).seatInfo}
          onPick={(id) => { setGroupPickFor(null); setActiveId(id); }}
          onNewGroup={() => openShare(floorEntries.get(groupPickFor).table)}
          onClose={() => setGroupPickFor(null)}
          t={t}
          lang={lang}
          now={now}
        />
      )}

      {/* Seat a new group of strangers at a table that already has people at it. */}
      {shareFor && (() => {
        const groups = ordersByTable.get(String(shareFor._id)) || [];
        const fixed = groups.map((o) => (Number(shareForm.fix[o._id]) > 0 ? { ...o, guestCount: Number(shareForm.fix[o._id]) } : o));
        const info = seatsAtTable(shareFor.capacity, fixed);
        const unknown = groups.filter((o) => !(Number(o.guestCount) > 0));
        const guests = Math.max(1, Math.min(Number(shareForm.guests) || 1, Math.max(1, info.free)));
        const counts = [...fixed.map((o) => (Number(o.guestCount) > 0 ? Number(o.guestCount) : 1)), guests];
        // Chairs the groups already there are on: drawn in their colours, not choosable.
        const othersMap = seatClassesFor(fixed, shareFor.capacity) || {};
        const locked = Object.keys(othersMap).map(Number);
        const chairsPicked = shareForm.chairs || [];
        const toggleShareChair = (chair) => setShareForm((fm) => {
          const list = fm.chairs || [];
          const chairs = list.includes(chair) ? list.filter((c) => c !== chair) : [...list, chair].sort((a, b) => a - b);
          return { ...fm, chairs, guests: Math.max(Number(fm.guests) || 1, chairs.length) };
        });
        return (
          <Modal
            as="form"
            onSubmit={submitShare}
            onClose={() => setShareFor(null)}
            title={t('tables.visual.shareTitle', { table: shareFor.name })}
            maxWidth={480}
            footer={
              <button type="submit" className="btn btn-primary btn-inline" disabled={busy === 'open' || info.free < 1}>
                <PlusIcon size={17} /> {busy === 'open' ? t('common.saving') : t('tables.visual.shareAction', { count: guests })}
              </button>
            }
          >
            <div className="share-preview">
              <TableSeats
                large
                capacity={shareFor.capacity}
                shape={shareFor.shape}
                sides={shareFor.shape === 'square' || shareFor.shape === 'long' ? shareFor.sides : undefined}
                occupied
                groups={counts}
                seatClasses={Object.keys(othersMap).length ? othersMap : undefined}
                picker={{
                  selectedSeats: chairsPicked,
                  seatCounts: {},
                  lockedSeats: locked,
                  onSeat: toggleShareChair,
                  groupLabel: t('tables.seat.whereSeated'),
                  label: (seat) => (locked.includes(seat) ? t('tables.seat.chairTaken', { seat }) : t('tables.seat.chair', { seat })),
                }}
              />
              <p className="share-preview__free">
                {chairsPicked.length ? t('tables.seat.seatedOn', { seats: chairsPicked.join(', '), count: chairsPicked.length }) : t('tables.seat.shareChairsHint')}
              </p>
              <div className="share-preview__legend">
                {fixed.map((o, i) => (
                  <span key={o._id}>
                    <span className={`gchip g-${i % 5}`}>{groupLetter(o, i)}</span>
                    {o.customerName || t('tables.visual.groupName', { letter: groupLetter(o, i) })} · {Number(o.guestCount) > 0 ? o.guestCount : '?'}
                  </span>
                ))}
                <span className="is-new">
                  <span className={`gchip g-${fixed.length % 5}`}>{groupLetter({}, fixed.length)}</span>
                  {t('tables.visual.newGroupLabel')} · {guests}
                </span>
              </div>
              <p className="share-preview__free">
                {info.free > 0 ? t('tables.visual.chairsFree', { count: info.free, total: shareFor.capacity }) : t('tables.visual.noChairs')}
              </p>
            </div>

            {unknown.map((o) => (
              <div className="field" key={o._id}>
                <label htmlFor={`fix-${o._id}`}>{t('tables.visual.howManyAlready', { group: o.customerName || o.tableName })}</label>
                <input
                  id={`fix-${o._id}`}
                  type="number"
                  min="1"
                  max={shareFor.capacity}
                  inputMode="numeric"
                  value={shareForm.fix[o._id] ?? ''}
                  placeholder="?"
                  onChange={(e) => setShareForm((fm) => ({ ...fm, fix: { ...fm.fix, [o._id]: e.target.value } }))}
                />
              </div>
            ))}

            <div className="field">
              <label>{t('tables.visual.newGroupPeople')}</label>
              <div className="qty-control share-count">
                <button type="button" onClick={() => setShareForm((fm) => ({ ...fm, guests: Math.max(1, guests - 1) }))} disabled={guests <= 1}>−</button>
                <span className="guest-count-value">{guests}</span>
                <button type="button" onClick={() => setShareForm((fm) => ({ ...fm, guests: Math.min(info.free, guests + 1) }))} disabled={guests >= info.free}>+</button>
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="share-name">{t('common.name')}</label>
                <input id="share-name" value={shareForm.name} maxLength={40} onChange={(e) => setShareForm((fm) => ({ ...fm, name: e.target.value }))} placeholder={t('seller.optional')} />
              </div>
              <PhoneField
                id="share-phone"
                label={t('common.phone')}
                value={shareForm.phone}
                onChange={(value) => setShareForm((fm) => ({ ...fm, phone: value }))}
              />
            </div>
            <p className="field-hint" style={{ margin: 0 }}>{t('tables.visual.shareHint')}</p>
          </Modal>
        );
      })()}

      {/* Seat or reserve an available table. */}
      {floorModal && (
        <Modal
          as="form"
          onSubmit={submitFloorModal}
          onClose={() => setFloorModal(null)}
          title={
            floorModal.mode === 'seat'
              ? t('tables.seatTitle', { table: floorModal.table.name })
              : t('tables.reserveTitle', { table: floorModal.table.name })
          }
          footer={
            <button
              type="submit"
              className="btn btn-primary btn-inline"
              disabled={busy === 'open' || busy === 'reserve'}
            >
              {floorModal.mode === 'seat' ? t('tables.seatNow') : t('tables.reserve')}
            </button>
          }
        >
            <div className="segmented" role="group" style={{ marginBottom: '0.9rem' }}>
              <button type="button" className={floorModal.mode === 'seat' ? 'active' : ''} onClick={() => setFloorModal((m) => ({ ...m, mode: 'seat' }))}>
                {t('tables.seatNow')}
              </button>
              <button type="button" className={floorModal.mode === 'reserve' ? 'active' : ''} onClick={() => setFloorModal((m) => ({ ...m, mode: 'reserve' }))}>
                {t('tables.reserve')}
              </button>
            </div>
            <div className="form-grid">
              {floorModal.mode === 'reserve' && (
                <div className="field">
                  <label htmlFor="fm-time">{t('tables.reservationTime')}</label>
                  <input id="fm-time" type="datetime-local" value={floorModalForm.time} onChange={(e) => setFloorModalForm((f) => ({ ...f, time: e.target.value }))} required />
                </div>
              )}
              <div className="field">
                <label htmlFor="fm-guests">{t('tables.guests')}</label>
                <input id="fm-guests" type="number" min="0" value={floorModalForm.guestCount} onChange={(e) => setFloorModalForm((f) => ({ ...f, guestCount: e.target.value }))} />
              </div>
              <div className="field">
                <label htmlFor="fm-name">{t('common.name')}</label>
                <input id="fm-name" value={floorModalForm.customerName} onChange={(e) => setFloorModalForm((f) => ({ ...f, customerName: e.target.value }))} placeholder={t('seller.optional')} />
              </div>
              <PhoneField
                id="fm-phone"
                label={t('common.phone')}
                value={floorModalForm.customerPhone}
                onChange={(value) => setFloorModalForm((f) => ({ ...f, customerPhone: value }))}
              />
              {floorModal.mode === 'reserve' && (
                <div className="field">
                  <label htmlFor="fm-note">{t('tables.reservationNote')}</label>
                  <input id="fm-note" value={floorModalForm.note} onChange={(e) => setFloorModalForm((f) => ({ ...f, note: e.target.value }))} placeholder={t('seller.optional')} />
                </div>
              )}
            </div>
            {/* Which chairs they sat on — optional, and it fills the head-count in. */}
            {floorModal.mode === 'seat' && (
              <div className="field seat-choose">
                <label>{t('tables.seat.whereSeated')} <small className="field-hint">({t('seller.optional')})</small></label>
                <div className="seat-choose__row">
                  <TableSeats
                    large
                    scale={1.5}
                    capacity={floorModal.table.capacity}
                    shape={floorModal.table.shape}
                    sides={floorModal.table.shape === 'square' || floorModal.table.shape === 'long' ? floorModal.table.sides : undefined}
                    picker={{
                      selectedSeats: floorModalForm.chairs,
                      seatCounts: {},
                      onSeat: toggleSeatingChair,
                      groupLabel: t('tables.seat.whereSeated'),
                      label: (seat) => t('tables.seat.chair', { seat }),
                    }}
                  />
                  <span className="seat-choose__text">
                    {floorModalForm.chairs.length
                      ? t('tables.seat.seatedOn', { seats: floorModalForm.chairs.join(', '), count: floorModalForm.chairs.length })
                      : t('tables.seat.seatedHint')}
                  </span>
                </div>
              </div>
            )}
            {/* A party of eight on four-seaters: push the tables together right here, so
                every one of them reads occupied from the moment they sit down. */}
            {floorModal.mode === 'seat' && joinableTables.length > 0 && (
              <div className="field join-seat-field">
                <label>{t('tables.joinTables')} <small className="field-hint">({t('seller.optional')})</small></label>
                <div className="join-chip-row">
                  {joinableTables.map((tb) => {
                    const picked = floorModalForm.joinIds.includes(tb._id);
                    return (
                      <button
                        type="button"
                        key={tb._id}
                        className={`join-chip${picked ? ' active' : ''}`}
                        aria-pressed={picked}
                        onClick={() => setFloorModalForm((f) => ({ ...f, joinIds: picked ? f.joinIds.filter((id) => id !== tb._id) : [...f.joinIds, tb._id] }))}
                      >
                        {tb.name}
                        <small>{tb.zone} · <UsersIcon size={11} /> {tb.capacity}</small>
                      </button>
                    );
                  })}
                </div>
                {floorModalForm.joinIds.length > 0 && (
                  <p className="field-hint" style={{ margin: 0 }}>
                    {t('tables.seatsTotal', {
                      tables: [floorModal.table.name, ...joinableTables.filter((tb) => floorModalForm.joinIds.includes(tb._id)).map((tb) => tb.name)].join(' + '),
                      count: (floorModal.table.capacity || 0) + joinableTables.filter((tb) => floorModalForm.joinIds.includes(tb._id)).reduce((sum, tb) => sum + (tb.capacity || 0), 0),
                    })}
                  </p>
                )}
              </div>
            )}
        </Modal>
      )}

      {modifierPickFor && (
        <ModifierPicker
          product={modifierPickFor}
          onCancel={() => { pendingQtyRef.current = 1; setModifierPickFor(null); }}
          onConfirm={(modifiers) => {
            addItem(modifierPickFor, modifiers, pendingQtyRef.current);
            pendingQtyRef.current = 1;
            setModifierPickFor(null);
          }}
        />
      )}

      <ThermalReceipt receipt={slip?.bill} shop={user} upiLink={slip?.upiLink} billLink={slip?.billLink} t={t} />
      <KotTicket kot={kotToPrint?.kot} order={kotToPrint?.order} shop={user} t={t} />
    </>
  );
}
