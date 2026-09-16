'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { isExpiredProduct } from '../../../lib/productExpiry';
import { tableStockShortage, stockErrorProductId } from '../../../lib/tableStock';
import { getShopSocket } from '../../../lib/socket';
import { useDashboardUser } from '../../components/DashboardShell';
import { businessType, DEFAULT_BUSINESS_TYPE } from '../../../lib/businessTypes';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { SkeletonStats } from '../../components/Skeleton';
import Dropdown from '../../components/Dropdown';
import PhoneField from '../../components/PhoneField';
import Modal from '../../components/Modal';
import ThermalReceipt from '../../components/ThermalReceipt';
import KotTicket from '../../components/KotTicket';
import ModifierPicker from '../../components/ModifierPicker';
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
const URGENT_MINUTES = 20;

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

function minutesSince(from, now) {
  return Math.floor((now - new Date(from).getTime()) / 60000);
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
    case 'settled':
      return t('tables.event.settled', { number: meta.billNumber });
    case 'cancelled':
      return t('tables.event.cancelled');
    default:
      return event.type;
  }
}

// Available is a plain button — one tap seats or reserves it. Reserved carries its own
// action buttons, so it can't be a button itself (nested interactive controls aren't valid
// HTML) — it renders as a div with real buttons inside.
function FloorTile({ table, order, onOpen, onSeat, onCancelReserve, now, t, lang }) {
  const status = order ? 'occupied' : table.reservation ? 'reserved' : 'available';
  const urgent = order && order.pendingItemCount > 0 && minutesSince(order.createdAt, now) > URGENT_MINUTES;
  const statusLabel = t(`tables.status.${status}`);

  const topRow = (
    <div className="tile-top-row">
      <span className="tile-name">{table.name}</span>
      <span className="status-pill">{statusLabel}</span>
    </div>
  );
  const capacityRow = (
    <span className="tile-meta">
      <UsersIcon size={13} /> {table.capacity}
    </span>
  );

  if (status === 'reserved') {
    return (
      <div className="pos-product-tile floor-tile status-reserved">
        {topRow}
        {capacityRow}
        <div className="tile-divider">
          <span className="tile-meta">
            {t('tables.reservedFor', {
              time: new Date(table.reservation.time).toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              }),
            })}
          </span>
          <span className="tile-reserved-actions">
            <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={onSeat}>
              {t('tables.seatNow')}
            </button>
            <button type="button" className="icon-btn danger" data-tip={t('tables.cancelReservation')} onClick={onCancelReserve}>
              <TrashIcon size={17} />
            </button>
          </span>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`pos-product-tile floor-tile status-${status} ${urgent ? 'tile-urgent' : ''}`}
      onClick={onOpen}
    >
      {topRow}
      {capacityRow}
      {order && (
        <div className="tile-divider">
          <div className="tile-amount-row">
            <span className="tile-price">{formatRupees(order.subtotal, lang)}</span>
            <span className="tile-timer">
              <ClockIcon size={11} /> {formatElapsed(order.createdAt, now)}
            </span>
          </div>
          {order.pendingItemCount > 0 && (
            <span className="badge badge-pending">{t('tables.notFired', { count: order.pendingItemCount })}</span>
          )}
          {order.assignedStaffName && (
            <span className="tile-waiter">
              <span className="tile-waiter-avatar">{order.assignedStaffName.trim().charAt(0).toUpperCase()}</span>
              {order.assignedStaffName}
            </span>
          )}
        </div>
      )}
    </button>
  );
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
  const [floorModalForm, setFloorModalForm] = useState({ guestCount: '', customerName: '', customerPhone: '', time: '', note: '' });
  const [quickName, setQuickName] = useState('');
  const [quickGuests, setQuickGuests] = useState('');
  const [takeawayForm, setTakeawayForm] = useState({ orderType: 'parcel', label: '', guestCount: '', customerName: '', customerPhone: '' });

  const [takeawayOpen, setTakeawayOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [tableFormOpen, setTableFormOpen] = useState(false);
  const [editingTableId, setEditingTableId] = useState(null);
  const [tableForm, setTableForm] = useState({ name: '', zone: 'Main', capacity: 4 });
  const [manageView, setManageView] = useState('list'); // 'list' | 'layout'
  const [draggingTableId, setDraggingTableId] = useState(null);
  const [dragPos, setDragPos] = useState(null); // { x, y } percent, while a drag is in flight

  const [transferPicking, setTransferPicking] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [mergePicking, setMergePicking] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');

  const [settleMode, setSettleMode] = useState('cash');
  const [settleCustomerId, setSettleCustomerId] = useState('');
  const [split, setSplit] = useState({ cash: '', upi: '', card: '' });
  const [billDiscountPercent, setBillDiscountPercent] = useState('');
  const [billDiscountAmount, setBillDiscountAmount] = useState('');
  const [settledReceipt, setSettledReceipt] = useState(null);
  const [kotToPrint, setKotToPrint] = useState(null);

  // Splitting the CHECK by guest, not the payment tender — see SPLIT_MODES/settleMode
  // above for that. Each guest here becomes a genuinely separate bill through the same
  // POST /api/seller/bills flow a normal sale uses, so GST/stock/invoice numbering never
  // learn a new code path; this state only decides which items go in which guest's bill.
  const [guestSplitOpen, setGuestSplitOpen] = useState(false);
  const [splitGuestCount, setSplitGuestCount] = useState(2);
  const [itemGuestMap, setItemGuestMap] = useState({}); // itemId -> guest index (0-based)
  const [guestModes, setGuestModes] = useState({}); // guestIndex -> paymentMode
  const [guestCustomers, setGuestCustomers] = useState({}); // guestIndex -> khata customerId
  const [splitSettledReceipts, setSplitSettledReceipts] = useState([]); // [{bill, upiLink}]

  function load() {
    return apiFetch('/api/seller/table-orders')
      .then((data) => setOrders(data.orders || []))
      .catch((err) => setError(err.message));
  }

  function loadFloorTables() {
    return apiFetch('/api/seller/floor-tables')
      .then((data) => setFloorTables(data.tables || []))
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    Promise.all([load(), loadFloorTables()]).finally(() => setLoading(false));
    apiFetch('/api/seller/products').then((d) => setProducts(d.products || [])).catch(() => {});
    apiFetch('/api/seller/staff/list').then((d) => setStaffList(d.staff || [])).catch(() => {});
    apiFetch('/api/seller/khata/customers').then((d) => setCustomers(d.customers || [])).catch(() => {});
  }, []);

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
    const events = ['connect', 'table:opened', 'table:updated', 'table:settled', 'table:transferred', 'table:merged', 'table:assigned', 'table:reserved'];
    events.forEach((e) => socket.on(e, refresh));
    socket.on('kot:sent', onKot);
    return () => {
      events.forEach((e) => socket.off(e, refresh));
      socket.off('kot:sent', onKot);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = useMemo(() => orders.find((o) => o._id === activeId) || null, [orders, activeId]);

  // Keyed on the order id, not on `active`, so a socket refresh arriving mid-typing does
  // not yank the note field out from under whoever is typing in it.
  useEffect(() => {
    const order = orders.find((o) => o._id === activeId);
    setOrderNoteDraft(order?.note || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
  const takeawayOrders = useMemo(() => orders.filter((o) => o.orderType !== 'dine_in'), [orders]);
  const orderByTableId = useMemo(() => {
    const map = new Map();
    for (const o of orders) if (o.table) map.set(String(o.table), o);
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

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort(),
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
      if (order) {
        occupied += 1;
        seatsTaken += order.guestCount || table.capacity || 0;
      } else if (table.reservation) {
        reserved += 1;
      }
    }
    const running = orders.reduce((sum, o) => sum + (o.subtotal || 0), 0);
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
  }, [floorTables, orderByTableId, orders]);

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

  const menu = useMemo(() => {
    const q = menuQuery.trim().toLowerCase();
    let list = products.filter((p) => p.status !== 'archived');
    if (categoryFilter) list = list.filter((p) => p.category === categoryFilter);
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
    return list.slice(0, 60);
  }, [products, menuQuery, categoryFilter]);

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
      toast.error(err.message);
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

  function openFloorModal(table, mode) {
    setFloorModal({ table, mode });
    setFloorModalForm({ guestCount: '', customerName: '', customerPhone: '', time: '', note: '' });
  }

  async function submitFloorModal(event) {
    event.preventDefault();
    if (!floorModal) return;
    if (floorModal.mode === 'seat') {
      const ok = await submitOpenOrder({
        tableId: floorModal.table._id,
        orderType: 'dine_in',
        guestCount: floorModalForm.guestCount || undefined,
        customerName: floorModalForm.customerName.trim() || undefined,
        customerPhone: floorModalForm.customerPhone.trim() || undefined,
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
      toast.error(err.message);
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
      toast.error(err.message);
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
      toast.error(err.message);
    }
  }

  async function addItem(product, modifiers) {
    if (!active) return;
    if (blockExpiredProduct(product)) return;
    try {
      const data = await apiFetch(`/api/seller/table-orders/${active._id}/items`, {
        method: 'POST',
        body: JSON.stringify({ items: [{ productId: product._id, quantity: 1, modifiers }] }),
      });
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
    } catch (err) {
      if (!markExpiredError(err)) toast.error(err.message);
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

  function handleAddItem(product) {
    if (blockExpiredProduct(product)) return;
    if (product.modifierGroups?.length > 0) {
      setModifierPickFor(product);
      return;
    }
    addItem(product);
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
    } catch (err) {
      toast.error(err.message);
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
      toast.error(err.message);
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
      toast.error(err.message);
    }
  }

  async function changeQuantity(item, quantity) {
    if (!active || !(quantity > 0)) return;
    try {
      const data = await apiFetch(`/api/seller/table-orders/${active._id}/items/${item._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity }),
      });
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeItem(item) {
    if (!active) return;
    // A round the kitchen already has is a void, not a correction — the food exists, so
    // the shopkeeper says so out loud rather than the row quietly disappearing.
    const force = item.sentToKitchen;
    let reason = '';
    if (force) {
      // The void and its reason are one decision — a kitchen that already has the food
      // needs to be told why it is coming off, and a second popup asking that gets
      // dismissed without being read.
      const answer = await confirm({
        tone: 'danger',
        title: t('tables.voidTitle'),
        body: t('tables.confirmVoid', { name: item.name }),
        input: { label: t('tables.voidReasonPrompt'), placeholder: t('tables.voidReasonPlaceholder') },
        confirmLabel: t('tables.voidTitle'),
      });
      if (!answer) return;
      reason = (answer.value || '').trim();
    }
    try {
      const data = await apiFetch(
        `/api/seller/table-orders/${active._id}/items/${item._id}${force ? '?force=true' : ''}`,
        { method: 'DELETE', body: JSON.stringify({ reason: reason || undefined }) }
      );
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleSendKot() {
    if (!active) return;
    setBusy('kot');
    try {
      const data = await apiFetch(`/api/seller/table-orders/${active._id}/kot`, { method: 'POST' });
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
      toast.success(t('tables.kotSent', { number: data.kot.number }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  }

  function handlePrintKot(kot) {
    setKotToPrint({ kot, order: active });
    requestAnimationFrame(() => {
      document.body.classList.add('printing-kot');
      const cleanup = () => {
        document.body.classList.remove('printing-kot');
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      window.print();
    });
  }

  function handlePrintReceipt() {
    document.body.classList.add('printing-receipt');
    const cleanup = () => {
      document.body.classList.remove('printing-receipt');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
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
      toast.error(err.message);
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
      toast.error(err.message);
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
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  }

  function splitLines() {
    return Object.entries(split)
      .filter(([, v]) => Number(v) > 0)
      .map(([mode, v]) => ({ mode, amount: round2(Number(v)) }));
  }

  async function handleSettle() {
    if (!active || active.items.length === 0) return;
    if (settleMode === 'khata' && !settleCustomerId) {
      toast.error(t('seller.selectCustomer'));
      return;
    }
    if (settleMode === 'split' && Math.abs(splitEntered - payable) > 0.01) {
      toast.error(t('seller.splitMismatch', { entered: splitEntered.toFixed(2), due: payable.toFixed(2) }));
      return;
    }
    setBusy('settle');
    try {
      const billData = await apiFetch('/api/seller/bills', {
        method: 'POST',
        body: JSON.stringify({
          clientBillId: `table-${active._id}-full`,
          items: active.items.map((item) => ({ productId: item.product, quantity: item.quantity, modifiers: item.modifiers })),
          paymentMode: settleMode,
          // Bills a parcel/delivery on its own price list — see backend/utils/orderPricing.js.
          orderType: active.orderType,
          counter: active.tableName,
          customerId: settleMode === 'khata' ? settleCustomerId : undefined,
          payments: settleMode === 'split' ? splitLines() : undefined,
          billDiscountPercent: Number(billDiscountPercent) || undefined,
          billDiscount: !Number(billDiscountPercent) && Number(billDiscountAmount) ? Number(billDiscountAmount) : undefined,
        }),
      });
      await apiFetch(`/api/seller/table-orders/${active._id}/settle`, {
        method: 'POST',
        body: JSON.stringify({ billId: billData.bill._id }),
      });
      toast.success(t('tables.settled', { table: active.tableName, number: billData.bill.billNumber }));
      setSettledReceipt({ bill: billData.bill, upiLink: null });
      apiFetch(`/api/seller/bills/${billData.bill._id}/receipt-text`)
        .then((r) => setSettledReceipt((cur) => (cur ? { ...cur, upiLink: r.upiLink || null } : cur)))
        .catch(() => {});
      setActiveId(null);
      setSettleMode('cash');
      setSettleCustomerId('');
      setSplit({ cash: '', upi: '', card: '' });
      setBillDiscountPercent('');
      setBillDiscountAmount('');
      await Promise.all([load(), loadFloorTables()]);
    } catch (err) {
      if (!markExpiredError(err)) toast.error(err.message);
      // Reload either way: the bill may well have been created before the failure, and
      // the floor must show the truth rather than what we hoped happened.
      await Promise.all([load(), loadFloorTables()]);
    } finally {
      setBusy('');
    }
  }

  function openGuestSplit() {
    if (!active) return;
    const map = {};
    for (const item of active.items) map[item._id] = 0;
    setItemGuestMap(map);
    setGuestModes({ 0: 'cash', 1: 'cash' });
    setGuestCustomers({});
    setSplitGuestCount(2);
    setGuestSplitOpen(true);
  }

  function changeSplitGuestCount(next) {
    const n = Math.max(2, Math.min(8, next));
    setSplitGuestCount(n);
    // A guest removed by shrinking the count takes their items back to Guest 1 rather than
    // leaving them assigned to a guest that no longer has a column to show them in.
    setItemGuestMap((map) => {
      const copy = { ...map };
      for (const key of Object.keys(copy)) {
        if (copy[key] >= n) copy[key] = 0;
      }
      return copy;
    });
    setGuestModes((modes) => {
      const copy = { ...modes };
      for (let i = 0; i < n; i++) if (!copy[i]) copy[i] = 'cash';
      return copy;
    });
  }

  const guestGroups = useMemo(() => {
    if (!active || !guestSplitOpen) return [];
    const groups = Array.from({ length: splitGuestCount }, (_, i) => ({ guestIndex: i, items: [], subtotal: 0 }));
    for (const item of active.items) {
      const g = groups[itemGuestMap[item._id] ?? 0] || groups[0];
      g.items.push(item);
      g.subtotal += lineTotal(item);
    }
    return groups;
  }, [active, guestSplitOpen, splitGuestCount, itemGuestMap]);

  async function handleGuestSplitSettle() {
    if (!active) return;
    const nonEmptyGroups = guestGroups.filter((g) => g.items.length > 0);
    if (nonEmptyGroups.length < 2) {
      toast.error(t('tables.splitNeedsTwo'));
      return;
    }
    for (const g of nonEmptyGroups) {
      const mode = guestModes[g.guestIndex] || 'cash';
      if (mode === 'khata' && !guestCustomers[g.guestIndex]) {
        toast.error(t('tables.splitGuestNeedsCustomer', { guest: g.guestIndex + 1 }));
        return;
      }
    }
    setBusy('settle');
    try {
      // Sequential, not Promise.all — each POST is a real bill (stock moves, an invoice
      // number is spent), and firing eight of those at once against the same shop's
      // counters is asking for exactly the race the billNumber sequence exists to avoid.
      const createdBills = [];
      for (const g of nonEmptyGroups) {
        const mode = guestModes[g.guestIndex] || 'cash';
        const billData = await apiFetch('/api/seller/bills', {
          method: 'POST',
          body: JSON.stringify({
            clientBillId: `table-${active._id}-guest-${g.guestIndex}`,
            items: g.items.map((item) => ({ productId: item.product, quantity: item.quantity, modifiers: item.modifiers })),
            paymentMode: mode,
            orderType: active.orderType,
            counter: `${active.tableName} · ${t('tables.guest')} ${g.guestIndex + 1}`,
            customerId: mode === 'khata' ? guestCustomers[g.guestIndex] : undefined,
            billDiscountPercent: Number(billDiscountPercent) || undefined,
          }),
        });
        createdBills.push(billData.bill);
      }
      await apiFetch(`/api/seller/table-orders/${active._id}/settle`, {
        method: 'POST',
        body: JSON.stringify({ billIds: createdBills.map((b) => b._id) }),
      });
      toast.success(t('tables.splitSettled', { table: active.tableName, count: createdBills.length }));
      setSplitSettledReceipts(createdBills.map((bill) => ({ bill, upiLink: null })));
      setActiveId(null);
      setGuestSplitOpen(false);
      setBillDiscountPercent('');
      setBillDiscountAmount('');
      await Promise.all([load(), loadFloorTables()]);
    } catch (err) {
      if (!markExpiredError(err)) toast.error(err.message);
      // Same reasoning as the single-bill settle above: reload regardless, because some of
      // these bills may already be real. A guest or two settled and a step in the middle
      // failing is exactly the case where the floor screen showing the truth matters most.
      await Promise.all([load(), loadFloorTables()]);
    } finally {
      setBusy('');
    }
  }

  function printSplitReceipt(entry) {
    setSettledReceipt(entry);
    requestAnimationFrame(() => handlePrintReceipt());
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
      toast.error(err.message);
    }
  }

  function openAddTableForm() {
    setEditingTableId(null);
    setTableForm({ name: '', zone: 'Main', capacity: 4 });
    setTableFormOpen(true);
  }

  function openEditTableForm(table) {
    setEditingTableId(table._id);
    setTableForm({ name: table.name, zone: table.zone || 'Main', capacity: table.capacity || 4 });
    setTableFormOpen(true);
  }

  async function submitTableForm(event) {
    event.preventDefault();
    if (!tableForm.name.trim()) return;
    setBusy('save-table');
    try {
      if (editingTableId) {
        await apiFetch(`/api/seller/floor-tables/${editingTableId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: tableForm.name.trim(), zone: tableForm.zone.trim() || 'Main', capacity: Number(tableForm.capacity) || 4 }),
        });
      } else {
        await apiFetch('/api/seller/floor-tables', {
          method: 'POST',
          body: JSON.stringify({ name: tableForm.name.trim(), zone: tableForm.zone.trim() || 'Main', capacity: Number(tableForm.capacity) || 4 }),
        });
      }
      await loadFloorTables();
      setTableFormOpen(false);
      toast.success(editingTableId ? t('common.saveChanges') : t('common.add'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  }

  async function toggleTableActive(table) {
    if (table.isActive && !(await confirm({ tone: 'warning', title: t('tables.deactivateTable'), body: table.name, confirmLabel: t('tables.deactivateTable') }))) return;
    try {
      if (table.isActive) {
        await apiFetch(`/api/seller/floor-tables/${table._id}`, { method: 'DELETE' });
      } else {
        await apiFetch(`/api/seller/floor-tables/${table._id}`, { method: 'PATCH', body: JSON.stringify({ isActive: true }) });
      }
      await loadFloorTables();
    } catch (err) {
      toast.error(err.message);
    }
  }

  // A table that has never been dragged has no x/y yet — rather than stacking every such
  // table at the canvas's top-left corner, each gets a stable spot from its own position in
  // the active list, so the layout is immediately usable and only needs dragging to refine.
  function fallbackPosition(index) {
    const perRow = 5;
    const col = index % perRow;
    const row = Math.floor(index / perRow);
    return { x: 10 + col * 20, y: 12 + row * 22 };
  }

  function tablePosition(table, index) {
    if (draggingTableId === table._id && dragPos) return dragPos;
    if (table.x !== undefined && table.x !== null && table.y !== undefined && table.y !== null) {
      return { x: table.x, y: table.y };
    }
    return fallbackPosition(index);
  }

  function startDrag(event, table, index) {
    event.preventDefault();
    const canvas = event.currentTarget.closest('.floor-layout-canvas');
    if (!canvas) return;
    setDraggingTableId(table._id);
    setDragPos(tablePosition(table, index));

    function toPercent(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
      return { x, y };
    }

    function onMove(e) {
      const point = e.touches ? e.touches[0] : e;
      setDragPos(toPercent(point.clientX, point.clientY));
    }

    async function onUp(e) {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      const point = e.changedTouches ? e.changedTouches[0] : e;
      const final = toPercent(point.clientX, point.clientY);
      setDraggingTableId(null);
      setDragPos(null);
      setFloorTables((list) => list.map((tb) => (tb._id === table._id ? { ...tb, x: final.x, y: final.y } : tb)));
      try {
        await apiFetch(`/api/seller/floor-tables/${table._id}`, {
          method: 'PATCH',
          body: JSON.stringify({ x: final.x, y: final.y }),
        });
      } catch (err) {
        toast.error(err.message);
        await loadFloorTables();
      }
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }

  const total = active ? active.items.reduce((sum, item) => sum + lineTotal(item), 0) : 0;
  const pendingCount = active ? active.items.filter((i) => !i.sentToKitchen).length : 0;
  const billDiscountValue = (() => {
    const percent = Math.min(Math.max(Number(billDiscountPercent) || 0, 0), 100);
    if (percent > 0) return round2((total * percent) / 100);
    return Math.min(round2(Math.max(0, Number(billDiscountAmount) || 0)), total);
  })();
  const payable = round2(total - billDiscountValue);
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
              <strong>{active.tableName}</strong>
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
              <button
                type="button"
                className="btn btn-primary btn-inline"
                disabled={busy !== '' || pendingCount === 0}
                onClick={handleSendKot}
              >
                {busy === 'kot' ? t('common.saving') : t('tables.sendKot', { count: pendingCount })}
              </button>
              {active.orderType === 'dine_in' && (
                <>
                  <button type="button" className="btn btn-secondary btn-inline" onClick={() => setTransferPicking((v) => !v)}>
                    <SwapIcon size={17} /> {t('tables.transfer')}
                  </button>
                  <button type="button" className="btn btn-secondary btn-inline" onClick={() => setMergePicking((v) => !v)}>
                    <LayersIcon size={17} /> {t('tables.merge')}
                  </button>
                </>
              )}
              <button type="button" className="icon-btn danger" data-tip={t('tables.cancelTable')} onClick={handleCancel}>
                <TrashIcon size={17} />
              </button>
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
                options={[{ value: '', label: '—' }, ...mergeableOrders.map((o) => ({ value: o._id, label: o.tableName }))]}
              />
              <button type="button" className="btn btn-primary btn-small btn-inline" disabled={!mergeTarget || busy !== ''} onClick={handleMerge}>
                {t('tables.mergeHere')}
              </button>
            </div>
          )}

          <div className="pos-layout">
            {/* Left: the menu. */}
            <div className="pos-main">
              <div className="panel">
                <div className="pos-search-bar">
                  <SearchIcon size={16} />
                  <input
                    id="menuSearch"
                    value={menuQuery}
                    onChange={(e) => setMenuQuery(e.target.value)}
                    placeholder={t('tables.searchMenu')}
                  />
                </div>

                {categories.length > 0 && (
                  <div className="category-tabs">
                    <button type="button" className={`filter-pill ${!categoryFilter ? 'active' : ''}`} onClick={() => setCategoryFilter('')}>
                      {t('tables.allCategories')}
                    </button>
                    {categories.map((c) => (
                      <button key={c} type="button" className={`filter-pill ${categoryFilter === c ? 'active' : ''}`} onClick={() => setCategoryFilter(c)}>
                        {c}
                      </button>
                    ))}
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
                    <p className="empty-state">{t('tables.menuNoMatch')}</p>
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
                      {active.items.map((item) => (
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
                            {item.sentToKitchen ? (
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
                            <span className="ticket-line__name">{item.name}</span>
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
                                <span className={`ticket-line__status ${item.sentToKitchen ? 'fired' : 'pending'}`}>
                                  {item.sentToKitchen ? t('tables.withKitchen') : t('tables.notSentYet')}
                                </span>
                                {item.note && <span className="ticket-line__note">{item.note}</span>}
                                {!item.sentToKitchen && (
                                  <button type="button" className="link-btn ticket-line__notebtn" onClick={() => openNoteEditor(item)}>
                                    {item.note ? t('common.edit') : t('tables.addNote')}
                                  </button>
                                )}
                              </span>
                            )}
                          </div>
                          <strong className="ticket-line__money">{formatRupees(lineTotal(item), lang)}</strong>
                          <button type="button" className="icon-btn danger" data-tip={t('common.delete')} onClick={() => removeItem(item)}>
                            <TrashIcon size={17} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Every round fired so far, each reprintable — the screen could only ever
                      reprint the newest one, which is no use when it is the first round's
                      ticket that got lost on the way to the kitchen. */}
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

                  {guestSplitOpen && (
                    <div className="guest-split-panel">
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>{t('tables.splitGuestCount')}</label>
                        <div className="qty-control">
                          <button type="button" onClick={() => changeSplitGuestCount(splitGuestCount - 1)}>−</button>
                          <span className="guest-count-value">{splitGuestCount}</span>
                          <button type="button" onClick={() => changeSplitGuestCount(splitGuestCount + 1)}>+</button>
                        </div>
                      </div>
                      <p className="field-hint">{t('tables.splitHint')}</p>
                      <div className="guest-split-items">
                        {active.items.map((item) => (
                          <div className="guest-split-item" key={item._id}>
                            <span className="guest-split-item-name">
                              {item.quantity}× {item.name}
                              <span className="guest-split-item-price">{formatRupees(lineTotal(item), lang)}</span>
                            </span>
                            <span className="guest-chip-row">
                              {Array.from({ length: splitGuestCount }, (_, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  className={`guest-chip ${(itemGuestMap[item._id] ?? 0) === i ? 'active' : ''}`}
                                  onClick={() => setItemGuestMap((m) => ({ ...m, [item._id]: i }))}
                                >
                                  {i + 1}
                                </button>
                              ))}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="guest-summary-grid">
                        {guestGroups.map((g) => (
                          <div className="guest-summary-card" key={g.guestIndex}>
                            <div className="guest-summary-head">
                              <strong>{t('tables.guest')} {g.guestIndex + 1}</strong>
                              <span>{formatRupees(g.subtotal, lang)}</span>
                            </div>
                            {g.items.length === 0 ? (
                              <p className="field-hint" style={{ margin: 0 }}>{t('tables.splitNoItems')}</p>
                            ) : (
                              <>
                                <div className="segmented-mini" role="group">
                                  {['cash', 'upi', 'card', 'khata'].map((mode) => (
                                    <button
                                      key={mode}
                                      type="button"
                                      className={(guestModes[g.guestIndex] || 'cash') === mode ? 'active' : ''}
                                      onClick={() => setGuestModes((m) => ({ ...m, [g.guestIndex]: mode }))}
                                    >
                                      {mode === 'khata' ? t('nav.khata') : t(`seller.${mode}`)}
                                    </button>
                                  ))}
                                </div>
                                {(guestModes[g.guestIndex] || 'cash') === 'khata' && (
                                  <Dropdown
                                    value={guestCustomers[g.guestIndex] || ''}
                                    onChange={(v) => setGuestCustomers((c) => ({ ...c, [g.guestIndex]: v }))}
                                    searchable={customers.length > 8}
                                    searchPlaceholder={t('seller.customerSearchHint')}
                                    emptyLabel={t('seller.customerSearchNone')}
                                    options={[{ value: '', label: '—' }, ...customers.map((c) => ({ value: c.id, label: `${c.name} (${c.phone})` }))]}
                                  />
                                )}
                              </>
                            )}
                          </div>
                        ))}
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

                      {settleMode === 'khata' && (
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>{t('seller.selectCustomer')}</label>
                          <Dropdown
                            value={settleCustomerId}
                            onChange={setSettleCustomerId}
                            searchable={customers.length > 8}
                            searchPlaceholder={t('seller.customerSearchHint')}
                            emptyLabel={t('seller.customerSearchNone')}
                            options={[{ value: '', label: '—' }, ...customers.map((c) => ({ value: c.id, label: `${c.name} (${c.phone})` }))]}
                          />
                        </div>
                      )}

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
                  <div className="ticket-foot-actions">
                    {active.orderType === 'dine_in' && active.items.length > 1 && (
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
                          ? t('tables.splitSettleAction', { count: guestGroups.filter((g) => g.items.length > 0).length })
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
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setTakeawayOpen(true)}>
                <PlusIcon size={17} /> {t('tables.newTakeaway')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setManageOpen(true)}>
                <EditIcon size={17} /> {t('tables.manageTables')}
              </button>
            </div>
          </div>

          {floorStats.total > 0 && (
            <div className="floor-stats">
              <div className="floor-stat">
                <span className="floor-stat__value">{floorStats.free}</span>
                <span className="floor-stat__label">{t('tables.status.available')}</span>
              </div>
              <div className="floor-stat is-occupied">
                <span className="floor-stat__value">{floorStats.occupied}</span>
                <span className="floor-stat__label">{t('tables.status.occupied')}</span>
              </div>
              <div className="floor-stat is-reserved">
                <span className="floor-stat__value">{floorStats.reserved}</span>
                <span className="floor-stat__label">{t('tables.status.reserved')}</span>
              </div>
              <div className="floor-stat is-money">
                <span className="floor-stat__value">{formatRupees(floorStats.running, lang)}</span>
                <span className="floor-stat__label">{t('tables.runningOnFloor')}</span>
              </div>
              {floorStats.awaitingKitchen > 0 && (
                <div className="floor-stat is-alert">
                  <span className="floor-stat__value">{floorStats.awaitingKitchen}</span>
                  <span className="floor-stat__label">{t('tables.awaitingKitchen')}</span>
                </div>
              )}
            </div>
          )}

          {takeawayOrders.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <h2>{t('tables.takeaway')}</h2>
              </div>
              <div className="floor-grid">
                {takeawayOrders.map((order) => (
                  <button
                    key={order._id}
                    type="button"
                    className="pos-product-tile floor-tile status-occupied"
                    onClick={() => setActiveId(order._id)}
                  >
                    <div className="tile-top-row">
                      <span className="tile-name">{order.tableName}</span>
                      <span className="status-pill">{t(`tables.type.${order.orderType}`)}</span>
                    </div>
                    <div className="tile-divider">
                      <div className="tile-amount-row">
                        <span className="tile-price">{formatRupees(order.subtotal, lang)}</span>
                        <span className="tile-timer">
                          <ClockIcon size={11} /> {formatElapsed(order.createdAt, now)}
                        </span>
                      </div>
                      {order.pendingItemCount > 0 && (
                        <span className="badge badge-pending">{t('tables.notFired', { count: order.pendingItemCount })}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="panel">
            {zones.length === 0 ? (
              <div className="empty-state-rich">
                <Illustration scene="board" />
                <p>{t('tables.noTablesConfigured')}</p>
                <p className="field-hint">{t('tables.setupHint')}</p>
                <button type="button" className="btn btn-primary btn-small btn-inline" onClick={() => { setManageOpen(true); openAddTableForm(); }}>
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
              zones.map(([zone, tables]) => (
                <div className="floor-zone" key={zone}>
                  <h3 className="floor-zone-title">{zone} · {tables.length}</h3>
                  <div className="floor-grid">
                    {tables.map((table) => (
                      <FloorTile
                        key={table._id}
                        table={table}
                        order={orderByTableId.get(String(table._id))}
                        now={now}
                        t={t}
                        lang={lang}
                        onOpen={() => {
                          const order = orderByTableId.get(String(table._id));
                          if (order) setActiveId(order._id);
                          else openFloorModal(table, 'seat');
                        }}
                        onSeat={() => handleSeatReservation(table)}
                        onCancelReserve={() => handleCancelReservation(table)}
                      />
                    ))}
                  </div>
                </div>
              ))
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
        <div className="panel">
          <div className="panel-head">
            <h2>{t('tables.splitSettled', { table: splitSettledReceipts[0].bill.counter.split(' · ')[0], count: splitSettledReceipts.length })}</h2>
            <button type="button" className="btn btn-secondary btn-inline" onClick={() => setSplitSettledReceipts([])}>
              {t('common.close')}
            </button>
          </div>
          <div className="table-wrap auto-height">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th style={{ textAlign: 'right' }}>{t('common.total')}</th>
                  <th className="tight" />
                </tr>
              </thead>
              <tbody>
                {splitSettledReceipts.map((entry) => (
                  <tr key={entry.bill._id}>
                    <td className="cell-strong">{entry.bill.counter} · #{entry.bill.billNumber}</td>
                    <td className="num">{formatRupees(entry.bill.payableTotal ?? entry.bill.total, lang)}</td>
                    <td className="tight">
                      <button type="button" className="icon-btn" data-tip={t('tables.printBill')} onClick={() => printSplitReceipt(entry)}>
                        <PrinterIcon size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {settledReceipt && (
        <div className="panel">
          <div className="panel-head">
            <h2>{t('tables.settled', { table: settledReceipt.bill.counter, number: settledReceipt.bill.billNumber })}</h2>
            <div className="row-actions">
              <button type="button" className="btn btn-secondary btn-inline" onClick={handlePrintReceipt}>
                <PrinterIcon size={17} /> {t('tables.printBill')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setSettledReceipt(null)}>
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage the floor plan: add tables once, edit or take one out of service. */}
      {manageOpen && (
        <Modal onClose={() => setManageOpen(false)} title={t('tables.manageTables')}>

            {floorTables.some((tb) => tb.isActive) && (
              <div className="segmented" role="group" style={{ marginBottom: '0.8rem' }}>
                <button type="button" className={manageView === 'list' ? 'active' : ''} onClick={() => setManageView('list')}>
                  {t('tables.viewList')}
                </button>
                <button type="button" className={manageView === 'layout' ? 'active' : ''} onClick={() => setManageView('layout')}>
                  <LayersIcon size={15} /> {t('tables.viewLayout')}
                </button>
              </div>
            )}

            {manageView === 'layout' && floorTables.some((tb) => tb.isActive) && (
              <>
                <p className="field-hint">{t('tables.layoutHint')}</p>
                <div className="floor-layout-canvas">
                  {floorTables.filter((tb) => tb.isActive).map((table, index) => {
                    const pos = tablePosition(table, index);
                    return (
                      <div
                        key={table._id}
                        className={`floor-layout-chip ${draggingTableId === table._id ? 'dragging' : ''}`}
                        style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                        onMouseDown={(e) => startDrag(e, table, index)}
                        onTouchStart={(e) => startDrag(e, table, index)}
                      >
                        {table.name}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {manageView === 'list' && floorTables.length > 0 && (
              <div className="table-wrap auto-height">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('common.name')}</th>
                      <th>{t('tables.zone')}</th>
                      <th style={{ textAlign: 'right' }}>{t('tables.capacity')}</th>
                      <th>{t('common.status')}</th>
                      <th className="tight" />
                    </tr>
                  </thead>
                  <tbody>
                    {floorTables.map((table) => (
                      <tr key={table._id}>
                        <td className="cell-strong">{table.name}</td>
                        <td>{table.zone}</td>
                        <td className="num">{table.capacity}</td>
                        <td>
                          <span className={`badge ${table.isActive ? 'badge-active' : 'badge-inactive'}`}>
                            {table.isActive ? t('common.active') : t('common.inactive')}
                          </span>
                        </td>
                        <td className="tight">
                          <div className="row-actions">
                            <button type="button" className="icon-btn" data-tip={t('common.edit')} onClick={() => openEditTableForm(table)}>
                              <EditIcon size={17} />
                            </button>
                            <button type="button" className="icon-btn danger" data-tip={table.isActive ? t('tables.deactivateTable') : t('tables.reactivateTable')} onClick={() => toggleTableActive(table)}>
                              <TrashIcon size={17} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tableFormOpen ? (
              <form onSubmit={submitTableForm} className="form-grid" style={{ marginTop: '1rem' }}>
                <div className="field">
                  <label htmlFor="tf-name">{t('common.name')}</label>
                  <input id="tf-name" value={tableForm.name} onChange={(e) => setTableForm((f) => ({ ...f, name: e.target.value }))} placeholder={t('tables.tableNamePlaceholder')} autoFocus />
                </div>
                <div className="field">
                  <label htmlFor="tf-zone">{t('tables.zone')}</label>
                  <input id="tf-zone" list="zone-suggestions" value={tableForm.zone} onChange={(e) => setTableForm((f) => ({ ...f, zone: e.target.value }))} />
                  <datalist id="zone-suggestions">
                    {Array.from(new Set(floorTables.map((tb) => tb.zone).filter(Boolean))).map((z) => <option key={z} value={z} />)}
                  </datalist>
                </div>
                <div className="field">
                  <label htmlFor="tf-capacity">{t('tables.capacity')}</label>
                  <input id="tf-capacity" type="number" min="1" value={tableForm.capacity} onChange={(e) => setTableForm((f) => ({ ...f, capacity: e.target.value }))} />
                </div>
                <div className="row-actions" style={{ alignSelf: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary btn-inline" onClick={() => setTableFormOpen(false)}>{t('common.cancel')}</button>
                  <button type="submit" className="btn btn-primary btn-inline" disabled={busy === 'save-table'}>
                    {editingTableId ? t('common.saveChanges') : t('common.add')}
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" className="btn btn-primary btn-small btn-inline" style={{ marginTop: '1rem' }} onClick={openAddTableForm}>
                <PlusIcon size={15} /> {t('tables.addTable')}
              </button>
            )}
        </Modal>
      )}

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
        </Modal>
      )}

      {modifierPickFor && (
        <ModifierPicker
          product={modifierPickFor}
          onCancel={() => setModifierPickFor(null)}
          onConfirm={(modifiers) => {
            addItem(modifierPickFor, modifiers);
            setModifierPickFor(null);
          }}
        />
      )}

      <ThermalReceipt receipt={settledReceipt?.bill} shop={user} upiLink={settledReceipt?.upiLink} t={t} />
      <KotTicket kot={kotToPrint?.kot} order={kotToPrint?.order} shop={user} t={t} />
    </>
  );
}
