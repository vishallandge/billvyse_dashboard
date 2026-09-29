'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { getShopSocket } from '../../../lib/socket';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { useConfirm } from '../../components/ConfirmDialog';
import { useDashboardUser } from '../../components/DashboardShell';
import { measureSlipMm, pinPageSize, shopPaper } from '../../../lib/printer/slip';
import {
  OrdersIcon, XIcon, RupeeIcon, WalletIcon, CreditCardIcon, LedgerIcon, PlusIcon, EditIcon, TrashIcon, RefreshIcon, CopyIcon,
  CheckCircleIcon, ReceiptIcon, ClockIcon, ScooterIcon, BagIcon, ListIcon, PhoneIcon, WhatsappIcon, MapPinIcon, PrinterIcon,
  SearchIcon, UsersIcon, UndoIcon,
} from '../../components/Icons';
import DateRangeFilter, { rangeToQuery } from '../../components/DateRangeFilter';
import { formatDateTime } from '../../../lib/format';
import RowMenu from '../../components/RowMenu';
import { SkeletonTable } from '../../components/Skeleton';
import { Pagination, usePagination } from '../../components/Pagination';
import Dropdown from '../../components/Dropdown';
import CustomerQuickAdd from '../../components/CustomerQuickAdd';
import Modal from '../../components/Modal';
import { recordHref } from '../../../lib/routeId';
import DeliveryRun, { mapHref, slotOf } from './DeliveryRun';

const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';

function emptyStandingForm() {
  return { customerId: '', items: [{ productId: '', quantity: '' }], notes: '' };
}

const NEXT_STATUS = {
  received: 'packed',
  packed: 'ready',
  ready: 'delivered',
  dispatched: 'delivered',
};

// A delivery order has one more stop between the shelf and the door: the bag leaving the
// shop. Pickup and dine-in go ready → delivered exactly as they always have.
function nextStatus(order) {
  if (order?.status === 'ready' && order.fulfillmentType === 'delivery') return 'dispatched';
  return NEXT_STATUS[order?.status] || '';
}

// "Pack it", "Ready", "Delivered" — the word for whatever this order's next stage is.
// It used to be built inline at each call site; now that the word is a tooltip rather
// than a label it is needed in more than one place, and it must be the same word in all
// of them.
function nextStageLabel(order, t) {
  const next = nextStatus(order);
  if (!next) return '';
  if (next === 'dispatched') return t('seller.orderSendOut');
  /**
   * The first move is an ACCEPTANCE, and it should say so.
   *
   * received → packed is the moment the shop takes the order on, and the customer's screen
   * now says in as many words that his order is "not confirmed yet — waiting for the shop
   * to accept". The button that ends that wait was labelled "Packed", which describes the
   * shopkeeper's next physical act and not the thing the customer is waiting for. The two
   * screens should be talking about the same event.
   *
   * Only the label changes. The status is still `packed` everywhere — the filter chips, the
   * badges and the API are untouched.
   */
  if (order.status === 'received') return t('seller.orderAccept');
  return t(`seller.order${next.charAt(0).toUpperCase()}${next.slice(1)}`);
}

/**
 * What the customer actually owes.
 *
 * `totalAmount` is the GOODS — the delivery charge sits outside it by design (see
 * Order.deliveryCharge), and the coupon and redeemed points come off below it. This screen
 * printed `totalAmount` as "Total" in both the table and the phone card, so a ₹500 basket
 * with ₹40 of delivery read ₹500 to the one person in the transaction who has to collect
 * the money — while the push notification that brought him here had correctly said ₹540.
 * The other direction is worse: a customer who spent 100 points owed ₹400, and the
 * shopkeeper standing at his door was being shown ₹500.
 *
 * `payableTotal` has been on every order since delivery charges existed. Orders written
 * before that carry none, and fall back to the goods total, which for them is the whole of
 * what was owed.
 */
function payableOf(order) {
  return Number(order?.payableTotal ?? order?.totalAmount) || 0;
}

function money(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

// Everything taken off the goods total before the delivery charge was added back on.
function discountOf(order) {
  return Number(
    ((Number(order?.couponDiscount) || 0) + (Number(order?.pointsRedeemedValue) || 0)).toFixed(2)
  );
}

// A 10-digit Indian mobile, in the form tel: and wa.me want it.
function dialable(phone) {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  return /^[6-9][0-9]{9}$/.test(digits) ? digits : '';
}

const OPEN_STATUSES = ['received', 'packed', 'ready', 'dispatched'];
// Same line the server draws for the "late" count in the summary.
const LATE_AFTER_MS = 2 * 60 * 60 * 1000;
const VERY_LATE_AFTER_MS = 24 * 60 * 60 * 1000;
const ALL_TIME = { preset: 'all', from: '', to: '' };

// "12 min", "3 hr", "2 days" — how long, in the words a shopkeeper would say it.
function spanText(ms, t) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return t('seller.orderAgeNow');
  if (minutes < 60) return t('seller.orderAgeMin', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('seller.orderAgeHour', { n: hours });
  return t('seller.orderAgeDay', { n: Math.floor(hours / 24) });
}

/**
 * The second line under an order's date: the fact that date is for.
 *
 * An open order says how long the customer has been waiting, and turns amber past two
 * hours and red past a day — "yeh order kab se pada hai" answered without opening it. A
 * delivered one says how long it took, which over a month is the shop's own service time.
 */
function ageLine(order, now, t) {
  const placed = new Date(order.createdAt).getTime();
  if (!Number.isFinite(placed)) return null;
  if (OPEN_STATUSES.includes(order.status)) {
    const waited = now - placed;
    const tone = waited >= VERY_LATE_AFTER_MS ? ' is-very-late' : waited >= LATE_AFTER_MS ? ' is-late' : '';
    return { text: t('seller.orderWaiting', { age: spanText(waited, t) }), tone };
  }
  if (order.status === 'delivered') {
    const done = order.statusHistory?.find((h) => h.status === 'delivered')?.at;
    const took = done ? new Date(done).getTime() - placed : NaN;
    if (Number.isFinite(took)) return { text: t('seller.orderTook', { age: spanText(took, t) }), tone: '' };
  }
  return { text: t('seller.orderAgo', { age: spanText(now - placed, t) }), tone: '' };
}

function statusLabel(status, t) {
  return t(`seller.order${status.charAt(0).toUpperCase()}${status.slice(1)}`);
}

const STATUS_BADGE = {
  received: 'badge-pending',
  packed: 'badge-expiring',
  ready: 'badge-active',
  dispatched: 'badge-expiring',
  delivered: 'badge-active',
  rejected: 'badge-inactive',
};

export default function OrdersPage() {
  const { t, lang } = useLanguage();
  const confirm = useConfirm();
  const user = useDashboardUser();
  const [orders, setOrders] = useState([]);
  // Order ids that arrived over the socket while this screen was open — see the
  // socket effect below. Not persisted: "new" means new to this sitting.
  const [freshIds, setFreshIds] = useState(() => new Set());
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);
  const [deliveringOrder, setDeliveringOrder] = useState(null);
  // The code the customer reads out at his door, and what the server said about the last
  // wrong one. Only ever filled while the handover modal is open.
  const [otpInput, setOtpInput] = useState('');
  const [otpError, setOtpError] = useState('');
  // The owner has waved the code away for this one handover. Still has to say how it was
  // paid, because that is what writes the bill.
  const [otpSkipped, setOtpSkipped] = useState(false);
  const [justBilled, setJustBilled] = useState(null);
  // Whether the shop's online counter is actually open right now. See the banner below.
  const [storefront, setStorefront] = useState(null);
  const [detailOrder, setDetailOrder] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rejectingOrder, setRejectingOrder] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  // The rest of the list's filters. Status stays the chip row it always was; these sit in
  // the bar under it.
  const [range, setRange] = useState(ALL_TIME);
  const [typeFilter, setTypeFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [sortOrder, setSortOrder] = useState('newest');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState(null);
  const [truncated, setTruncated] = useState(false);
  // Who an order can be handed to. Empty for a one-person shop, and then every
  // assignment control stays off the screen — a column that can only ever say the
  // owner's own name is noise.
  const [staffList, setStaffList] = useState([]);
  const [assigningOrder, setAssigningOrder] = useState(null);
  const [assignTo, setAssignTo] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  // Ticks once a minute so "waiting 12 min" keeps counting while the screen sits open.
  const [now, setNow] = useState(() => Date.now());
  // Bumped on every reload, so the delivery run refetches on the same socket events and
  // after the same button presses the table does.
  const [refreshKey, setRefreshKey] = useState(0);
  const filterKey = JSON.stringify({ statusFilter, range, typeFilter, assignedFilter, sortOrder, search });
  const page = usePagination(orders, { pageSize: 25, resetKey: filterKey });
  const isOwner = user?.role === 'seller';
  const myId = user?.id ? String(user.id) : '';
  const hasTeam = staffList.length > 0;
  const filtersActive = range.preset !== 'all' || !!typeFilter || !!assignedFilter || !!search;
  // Only for a shop that brings goods to the door. A staff login cannot read the storefront
  // settings, so for it the question is whether any delivery order is open right now.
  const showDeliveries = storefront ? storefront.allowDelivery !== false : (summary?.open.delivery || 0) > 0;

  const listQuery = useMemo(() => {
    const params = new URLSearchParams(range.preset === 'all' ? '' : rangeToQuery(range));
    if (statusFilter) params.set('status', statusFilter);
    if (typeFilter) params.set('type', typeFilter);
    if (assignedFilter) params.set('assigned', assignedFilter);
    if (sortOrder === 'oldest') params.set('sort', 'oldest');
    if (search) params.set('q', search);
    return params.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // A dairy/tiffin shop's "same order, every day" list — separate from the one-off orders
  // table above, but built from the same customer/product picker so it never feels like a
  // second app bolted on.
  const [view, setView] = useState('orders');
  const [standingOrders, setStandingOrders] = useState([]);
  const [standingLoading, setStandingLoading] = useState(false);
  const [customers, setCustomers] = useState([]);
  // Adding a customer without losing the standing order already typed into this form.
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [goodsProducts, setGoodsProducts] = useState([]);
  const [standingFormOpen, setStandingFormOpen] = useState(false);
  const [standingForm, setStandingForm] = useState(emptyStandingForm);
  const [editingStandingId, setEditingStandingId] = useState(null);
  const [standingSubmitting, setStandingSubmitting] = useState(false);
  const [standingBusyId, setStandingBusyId] = useState(null);

  // The socket handlers are bound once, so they read the current query from here rather
  // than from a stale closure — otherwise a live refresh would quietly drop the filters.
  const queryRef = useRef(listQuery);
  queryRef.current = listQuery;

  function load() {
    setRefreshKey((k) => k + 1);
    setLoading(true);
    const query = queryRef.current;
    apiFetch(`/api/seller/orders${query ? `?${query}` : ''}`)
      .then((data) => {
        // A slower, older request must not paint over the answer to the newer filters.
        if (query !== queryRef.current) return;
        setOrders(data.orders || []);
        setSummary(data.summary || null);
        setTruncated(!!data.truncated);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [listQuery]);

  // Typing is not a query per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchDraft.trim()), 300);
    return () => clearTimeout(id);
  }, [searchDraft]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    apiFetch('/api/seller/staff/list')
      .then((data) => setStaffList(data?.staff || []))
      .catch(() => {});
  }, []);

  function clearFilters() {
    setRange(ALL_TIME);
    setTypeFilter('');
    setAssignedFilter('');
    setSearchDraft('');
    setSearch('');
  }

  // Everyone this order can go to: the owner first, then the staff. A staff login only
  // ever gets the "take it / leave it" pair, so this list is the owner's.
  const assignOptions = useMemo(() => {
    const options = [{ value: '', label: t('seller.orderAssignNobody') }];
    if (isOwner && myId) options.push({ value: myId, label: t('seller.orderAssignYou', { name: user?.name || '' }) });
    staffList.forEach((s) => options.push({ value: s.id, label: s.jobTitle ? `${s.name} · ${s.jobTitle}` : s.name }));
    return options;
  }, [isOwner, myId, staffList, user?.name, t]);

  function openAssign(order) {
    setAssigningOrder(order);
    setAssignTo(order.assignedTo ? String(order.assignedTo) : '');
  }

  async function assign(order, staffId) {
    setAssignBusy(true);
    try {
      const data = await apiFetch(`/api/seller/orders/${order._id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ staffId: staffId || null }),
      });
      setAssigningOrder(null);
      if (data?.order && detailOrder && String(detailOrder._id) === String(order._id)) setDetailOrder(data.order);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setAssignBusy(false);
    }
  }

  // The row-menu entries for assignment, which differ by who is looking. Empty for a
  // closed order and for a shop with nobody to assign to.
  function assignMenuItems(order) {
    if (!hasTeam || !OPEN_STATUSES.includes(order.status)) return [];
    const holder = order.assignedTo ? String(order.assignedTo) : '';
    if (isOwner) {
      return [{ label: t('seller.orderAssign'), icon: <UsersIcon size={15} />, onClick: () => openAssign(order) }];
    }
    if (!holder) return [{ label: t('seller.orderTakeIt'), icon: <UsersIcon size={15} />, onClick: () => assign(order, myId) }];
    if (holder === myId) return [{ label: t('seller.orderRelease'), icon: <UsersIcon size={15} />, onClick: () => assign(order, '') }];
    return [];
  }

  /**
   * "Koi order hi nahi aa raha."
   *
   * The commonest reason is that the shop's own storefront is shut — paused during a
   * wedding and never un-paused, a weekly off that is still set from last season, or the
   * closing time the owner typed once and forgot. Every one of those is the shopkeeper's
   * own setting, and this screen — the one he opens to ask the question — said nothing
   * about any of them. He sees an empty list, assumes the feature is broken, and calls.
   *
   * Owner-only endpoint, so a staff login simply gets no banner rather than an error: the
   * pause is the owner's switch and the owner is who needs telling.
   */
  useEffect(() => {
    apiFetch('/api/seller/profile')
      .then((data) => setStorefront(data?.profile?.storefront || null))
      .catch(() => {});
  }, []);

  function loadStanding() {
    setStandingLoading(true);
    apiFetch('/api/seller/orders/standing')
      .then((data) => setStandingOrders(data.standingOrders))
      .catch((err) => setError(err.message))
      .finally(() => setStandingLoading(false));
  }

  useEffect(() => {
    if (view !== 'standing') return;
    loadStanding();
    if (customers.length === 0) {
      apiFetch('/api/seller/khata/customers').then((r) => setCustomers(r.customers || [])).catch(() => {});
    }
    if (goodsProducts.length === 0) {
      apiFetch('/api/seller/products').then((r) => setGoodsProducts((r.products || []).filter((p) => p.kind !== 'service'))).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    const socket = getShopSocket();
    if (!socket) return;
    const onOrderEvent = () => load();
    // Moment 4 — an order that arrived while the shopkeeper was looking at this screen
    // gets marked so its row announces itself. Only `order:created` qualifies: a status
    // change on an order they already knew about is not news.
    const onOrderCreated = (payload) => {
      if (payload?.orderId) {
        const id = String(payload.orderId);
        setFreshIds((prev) => new Set(prev).add(id));
        // Let it go quiet again. Without this the row would re-announce itself every
        // time the shopkeeper paged away and back, hours after the order landed.
        setTimeout(() => {
          setFreshIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, 10000);
      }
      load();
    };
    socket.on('order:created', onOrderCreated);
    socket.on('order:updated', onOrderEvent);
    return () => {
      socket.off('order:created', onOrderCreated);
      socket.off('order:updated', onOrderEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function advance(order, paymentMode, options = {}) {
    const next = nextStatus(order);
    if (!next) return;
    // Handing the goods over is the moment the sale becomes money, so delivery needs to
    // say how it was paid — that is what turns the order into a real bill in the day
    // book, the reports and GST. Every other step is just a status change.
    if (next === 'delivered' && !paymentMode) {
      setDeliveringOrder(order);
      setOtpInput('');
      setOtpError('');
      setOtpSkipped(false);
      return;
    }
    try {
      const body = { status: next, paymentMode };
      // The code goes with the handover, not before it: it is checked in the same request
      // that writes the bill, so a right code and a failed bill cannot come apart.
      if (next === 'delivered' && order.otpRequired) {
        if (options.skipOtp) body.skipOtp = true;
        else body.otp = otpInput;
      }
      const data = await apiFetch(`/api/seller/orders/${order._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setDeliveringOrder(null);
      setOtpInput('');
      setOtpError('');
      if (data.bill) setJustBilled(data.bill);
      load();
    } catch (err) {
      // A wrong code is not a failure of the screen — the modal stays open, says how many
      // tries are left and lets the customer read the digits out again.
      if (err.code === 'OTP_WRONG' || err.code === 'OTP_LOCKED') {
        setOtpError(
          err.code === 'OTP_LOCKED'
            ? t('seller.orderOtpLocked')
            : t('seller.orderOtpWrong', { n: err.data?.triesLeft ?? 0 })
        );
        return;
      }
      setError(err.message);
      setDeliveringOrder(null);
    }
  }

  // Nobody was home. The bag is back on the shelf and goes out again later — not a
  // rejection, and not money yet.
  async function bringBack(order) {
    const ok = await confirm({
      title: t('seller.orderBroughtBackTitle', { number: order.orderNumber }),
      body: t('seller.orderBroughtBackBody'),
      confirmLabel: t('seller.orderBroughtBack'),
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/seller/orders/${order._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'ready' }),
      });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  /**
   * The order, in full.
   *
   * `GET /api/seller/orders/:id` has existed since the module was written and nothing in the
   * dashboard had ever called it — so the only view of an order a shopkeeper had was the
   * row, which crushes every line into "Rice x2, Dal x1, Atta x1, …" on one truncated line.
   * That is not something a person can pack from, and it is why the contact number the
   * customer typed at checkout, the distance, the discounts and the timeline were all being
   * stored and never once shown.
   *
   * Opened with the row's own copy so the sheet paints immediately, then replaced with the
   * server's — the list is polled and socket-refreshed, and a stale row must not be what the
   * shopkeeper packs from.
   */
  async function openDetail(order) {
    setDetailOrder(order);
    setDetailLoading(true);
    try {
      const data = await apiFetch(`/api/seller/orders/${order._id}`);
      if (data?.order) setDetailOrder(data.order);
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  /**
   * The order as a picking slip.
   *
   * A bare `window.print()` would have produced a blank sheet: globals.css carries a
   * default `body * { visibility: hidden }` for print, and an `@page` sized to an 80mm
   * receipt roll. So this follows the pattern the billing and tables screens already use —
   * flag the body, let the print stylesheet re-show exactly one thing, clear the flag when
   * the dialog closes.
   */
  function printSlip() {
    // On a shop whose chosen paper is a roll (Settings → Invoice look), the slip follows
    // it: roll width, cut to its own length. On sheet paper it stays an ordinary sheet.
    const paper = shopPaper(user);
    let unpin = null;
    if (paper.roll) {
      const heightMm = measureSlipMm(document.querySelector('.order-detail-sheet'), { widthMm: paper.widthMm, padding: '3mm' });
      if (heightMm) unpin = pinPageSize(paper.widthMm, heightMm + 6);
    }
    document.body.classList.add('printing-order');
    const cleanup = () => {
      document.body.classList.remove('printing-order');
      unpin?.();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  async function confirmReject() {
    if (!rejectingOrder) return;
    setRejecting(true);
    try {
      await apiFetch(`/api/seller/orders/${rejectingOrder._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'rejected', reason: rejectReason.trim() || undefined }),
      });
      setRejectingOrder(null);
      setRejectReason('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRejecting(false);
    }
  }

  function openAddStanding() {
    setStandingForm(emptyStandingForm());
    setEditingStandingId(null);
    setStandingFormOpen(true);
  }

  function openEditStanding(row) {
    setStandingForm({
      customerId: row.customer?.id || '',
      items: row.items.map((i) => ({ productId: i.product, quantity: String(i.quantity) })),
      notes: row.notes || '',
    });
    setEditingStandingId(row._id);
    setStandingFormOpen(true);
  }

  function addStandingItemRow() {
    setStandingForm((f) => ({ ...f, items: [...f.items, { productId: '', quantity: '' }] }));
  }
  function updateStandingItemRow(index, key, value) {
    setStandingForm((f) => ({ ...f, items: f.items.map((row, i) => (i === index ? { ...row, [key]: value } : row)) }));
  }
  function removeStandingItemRow(index) {
    setStandingForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== index) }));
  }

  async function submitStandingForm(event) {
    event.preventDefault();
    const items = standingForm.items.filter((row) => row.productId && Number(row.quantity) > 0);
    if (!standingForm.customerId) {
      setError(t('seller.standingNeedCustomer'));
      return;
    }
    if (items.length === 0) {
      setError(t('seller.standingNeedItems'));
      return;
    }

    setStandingSubmitting(true);
    setError('');
    try {
      const body = JSON.stringify({
        customerId: standingForm.customerId,
        items: items.map((row) => ({ productId: row.productId, quantity: Number(row.quantity) })),
        notes: standingForm.notes || undefined,
      });
      if (editingStandingId) {
        await apiFetch(`/api/seller/orders/standing/${editingStandingId}`, { method: 'PATCH', body });
      } else {
        await apiFetch('/api/seller/orders/standing', { method: 'POST', body });
      }
      setStandingFormOpen(false);
      setEditingStandingId(null);
      loadStanding();
    } catch (err) {
      setError(err.message);
    } finally {
      setStandingSubmitting(false);
    }
  }

  async function toggleStandingActive(row) {
    setStandingBusyId(row._id);
    try {
      await apiFetch(`/api/seller/orders/standing/${row._id}`, { method: 'PATCH', body: JSON.stringify({ active: !row.active }) });
      loadStanding();
    } catch (err) {
      setError(err.message);
    } finally {
      setStandingBusyId(null);
    }
  }

  async function deleteStanding(row) {
    if (!(await confirm({ tone: 'danger', title: t('common.delete'), body: t('seller.standingConfirmDelete'), confirmLabel: t('common.delete') }))) return;
    setStandingBusyId(row._id);
    try {
      await apiFetch(`/api/seller/orders/standing/${row._id}`, { method: 'DELETE' });
      loadStanding();
    } catch (err) {
      setError(err.message);
    } finally {
      setStandingBusyId(null);
    }
  }

  function copyShopLink() {
    if (!user?.shopSlug) return;
    navigator.clipboard.writeText(`${FRONTEND_URL}/c/${user.shopSlug}/catalog`).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <h1>{t('seller.ordersTitle')}</h1>
          <p className="page-head-sub">{t('seller.ordersSubtitle')}</p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Said where the question is asked, with the way to undo it one click away. */}
      {storefront?.status?.open === false && (
        <div className="orders-closed-banner">
          <ClockIcon size={16} />
          <span>
            {storefront.status.reason === 'PAUSED'
              ? t('seller.ordersClosedPaused')
              : storefront.status.reason === 'WEEKLY_OFF'
                ? t('seller.ordersClosedWeeklyOff')
                : t('seller.ordersClosedHours')}
            {storefront.pauseNote ? ` — ${storefront.pauseNote}` : ''}
          </span>
          <Link href="/seller/settings" className="btn btn-secondary btn-small btn-inline">
            {t('seller.ordersClosedFix')}
          </Link>
        </div>
      )}

      <div className="segmented" role="group" style={{ marginBottom: '0.9rem', maxWidth: showDeliveries ? '520px' : '360px' }}>
        <button type="button" className={view === 'orders' ? 'active' : ''} onClick={() => setView('orders')}>
          {t('nav.orders')}
        </button>
        {showDeliveries && (
          <button type="button" className={view === 'deliveries' ? 'active' : ''} onClick={() => setView('deliveries')}>
            <ScooterIcon size={14} /> {t('seller.ordersViewDeliveries')}
          </button>
        )}
        <button type="button" className={view === 'standing' ? 'active' : ''} onClick={() => setView('standing')}>
          <RefreshIcon size={14} /> {t('seller.standingOrders')}
        </button>
      </div>

      {/* The four numbers the screen is opened to find out: how many are waiting and for
          how long, how many go out on a scooter, whether any are nobody's job, and what
          actually got handed over. Every count carries its rupees where it has any. They
          follow the date, type, person and search filters — not the status chip, which
          they sit above and summarise. */}
      {view === 'orders' && summary && (
        <div className="stat-grid orders-stats">
          <div className={`stat-card${summary.open.late > 0 ? ' accent-danger' : ''}`}>
            <div className="stat-icon"><ClockIcon size={16} /></div>
            <div className="stat-value">{summary.open.count}</div>
            <div className="stat-label">{t('seller.statWaiting')}</div>
            <div className="stat-sub">
              {money(summary.open.value)}
              {' · '}
              {summary.open.late > 0 ? t('seller.statWaitingLate', { n: summary.open.late }) : t('seller.statWaitingNoneLate')}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><ScooterIcon size={16} /></div>
            <div className="stat-value">{summary.open.delivery}</div>
            <div className="stat-label">{t('seller.statToDeliver')}</div>
            <div className="stat-sub">{t('seller.statToDeliverSub', { n: summary.open.pickup })}</div>
          </div>
          {hasTeam && (
            <div className={`stat-card${summary.open.unassigned > 0 ? ' accent-gold' : ''}`}>
              <div className="stat-icon"><UsersIcon size={16} /></div>
              <div className="stat-value">{summary.open.unassigned}</div>
              <div className="stat-label">{t('seller.statUnassigned')}</div>
              <div className="stat-sub">{t('seller.statUnassignedSub')}</div>
            </div>
          )}
          <div className="stat-card accent-success">
            <div className="stat-icon"><CheckCircleIcon size={16} /></div>
            <div className="stat-value">{summary.byStatus.delivered.count}</div>
            <div className="stat-label">{t('seller.statDelivered')}</div>
            <div className="stat-sub">
              {money(summary.byStatus.delivered.value)}
              {summary.byStatus.rejected.count > 0 && ` · ${t('seller.statDeliveredSub', { n: summary.byStatus.rejected.count })}`}
            </div>
          </div>
        </div>
      )}

      {view === 'orders' && (
      <div className="data-panel">
        <div className="data-filters">
          <div className="chip-row">
            {[
              ['', t('seller.all'), summary?.all.count],
              ['open', t('seller.ordersOpen'), summary?.open.count],
              ['received', t('seller.orderReceived'), summary?.byStatus.received.count],
              ['packed', t('seller.orderPacked'), summary?.byStatus.packed.count],
              ['ready', t('seller.orderReady'), summary?.byStatus.ready.count],
              ['dispatched', t('seller.orderDispatched'), summary?.byStatus.dispatched?.count],
              ['delivered', t('seller.orderDelivered'), summary?.byStatus.delivered.count],
              ['rejected', t('seller.orderRejected'), summary?.byStatus.rejected.count],
            ].map(([value, label, count]) => (
              <button
                key={value || 'all'}
                type="button"
                className={`chip chip-sm${statusFilter === value ? ' active' : ''}`}
                onClick={() => setStatusFilter(value)}
              >
                {label}
                {Number.isFinite(count) && <span className="chip-count">{count}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="data-filters orders-filter-bar">
          <div className="search-box-inline">
            <SearchIcon size={15} />
            <input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder={t('seller.ordersSearch')}
              maxLength={60}
              aria-label={t('seller.ordersSearch')}
            />
          </div>
          <DateRangeFilter value={range} onChange={setRange} compact />
          <div className="filter-group">
            <Dropdown
              className="filter-select"
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { value: '', label: t('seller.ordersTypeAll') },
                { value: 'delivery', label: t('seller.orderDelivery') },
                { value: 'pickup', label: t('seller.orderPickup') },
                { value: 'dine_in', label: t('tables.type.dine_in') },
              ]}
            />
            {hasTeam && (
              <Dropdown
                className="filter-select"
                value={assignedFilter}
                onChange={setAssignedFilter}
                options={[
                  { value: '', label: t('seller.ordersAssignedAll') },
                  { value: 'me', label: t('seller.ordersAssignedMe') },
                  { value: 'none', label: t('seller.ordersAssignedNone') },
                  ...(isOwner ? staffList.map((s) => ({ value: s.id, label: s.name })) : []),
                ]}
              />
            )}
            <Dropdown
              className="filter-select"
              value={sortOrder}
              onChange={setSortOrder}
              options={[
                { value: 'newest', label: t('seller.ordersSortNewest') },
                { value: 'oldest', label: t('seller.ordersSortOldest') },
              ]}
            />
            {filtersActive && (
              <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={clearFilters}>
                <XIcon size={15} /> {t('seller.ordersClearFilters')}
              </button>
            )}
          </div>
        </div>

        {truncated && !loading && (
          <p className="field-hint orders-truncated">{t('seller.ordersTruncated', { n: orders.length })}</p>
        )}

        {loading && orders.length === 0 ? (
          <div className="data-panel-body"><SkeletonTable rows={6} cols={8} /></div>
        ) : orders.length === 0 && (statusFilter || filtersActive) ? (
          <div className="empty-state-rich">
            <Illustration scene="parcel" />
            <p>{t('seller.ordersNoMatch')}</p>
            <button
              type="button"
              className="btn btn-secondary btn-small btn-inline"
              onClick={() => { clearFilters(); setStatusFilter(''); }}
            >
              {t('seller.ordersClearFilters')}
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="parcel" />
            <p>{t('seller.noOrders')}</p>
            {!statusFilter && user?.shopSlug && (
              <button type="button" className="btn btn-primary btn-small btn-inline" onClick={copyShopLink}>
                <CopyIcon size={15} />
                {linkCopied ? t('gettingStarted.linkCopied') : t('seller.noOrdersShareShop')}
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Six columns need 820px before the Accept/Reject buttons come into view.
                An online order is the one thing a shopkeeper acts on away from the
                counter, phone in hand, so on a handset this becomes the record-card list
                below instead — same handlers, no sideways swipe to reach Accept. */}
            <div className="table-wrap mobile-cards">
              <table className="data-table sticky-actions" style={{ minWidth: hasTeam ? '1060px' : '940px' }}>
                <thead>
                  <tr>
                    <th className="tight">#</th>
                    <th>{t('seller.orderPlaced')}</th>
                    <th>{t('common.name')}</th>
                    <th>{t('seller.items')}</th>
                    <th className="num">{t('seller.total')}</th>
                    {hasTeam && <th>{t('seller.orderAssigned')}</th>}
                    <th>{t('common.status')}</th>
                    <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.pageItems.map((order) => {
                    const age = ageLine(order, now, t);
                    return (
                    <tr
                      key={order._id}
                      className={freshIds.has(String(order._id)) ? 'moment-arrive moment-new-flag' : undefined}
                    >
                      {/* The order number is the handle on the row, so it is what opens
                          the order. */}
                      <td className="tight cell-strong">
                        <button type="button" className="order-open" onClick={() => openDetail(order)}>
                          {order.orderNumber}
                        </button>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span className="order-when">{formatDateTime(order.createdAt, lang)}</span>
                          {age && <span className={`cell-sub order-age${age.tone}`}>{age.text}</span>}
                        </div>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{order.customer?.name}</span>
                          <span className="cell-sub">{order.customer?.phone}</span>
                        </div>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span className="order-items-line">{order.items.map((i) => `${i.name} x${i.quantity}`).join(', ')}</span>
                          <span className="cell-sub" style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <span className={`badge ${order.fulfillmentType === 'delivery' ? 'badge-expiring' : 'badge-active'}`}>
                              {order.fulfillmentType === 'dine_in' ? t('tables.type.dine_in') : order.fulfillmentType === 'delivery'
                                ? <><ScooterIcon size={13} /> {t('seller.orderDelivery')}</>
                                : <><BagIcon size={13} /> {t('seller.orderPickup')}</>}
                            </span>
                            {(() => {
                              const slot = slotOf(order, t);
                              return slot ? (
                                <span className={`order-slot${slot.late ? ' is-late' : ''}`}>
                                  <ClockIcon size={13} /> {slot.text}
                                </span>
                              ) : null;
                            })()}
                            {order.fulfillmentType === 'delivery' && order.address && (
                              <span>{t('seller.orderAddress')}: {order.address}</span>
                            )}
                            {order.note && <span>{t('seller.orderNote')}: {order.note}</span>}
                          </span>
                        </div>
                      </td>
                      {/* What the customer owes, not what the goods came to. The breakdown
                          appears only when the two differ, so an ordinary pickup order
                          gains nothing to read. */}
                      <td className="num cell-strong">
                        <div className="cell-stack">
                          <span>{money(payableOf(order))}</span>
                          {(order.deliveryCharge > 0 || discountOf(order) > 0) && (
                            <span className="cell-sub">
                              {money(order.totalAmount)}
                              {discountOf(order) > 0 && ` − ${money(discountOf(order))}`}
                              {order.deliveryCharge > 0 && ` + ${money(order.deliveryCharge)} ${t('seller.orderDeliveryFee')}`}
                            </span>
                          )}
                        </div>
                      </td>
                      {hasTeam && (
                        <td>
                          {order.assignedToName ? (
                            <span className="order-assignee">
                              <span className="order-assignee-avatar">{order.assignedToName.trim().charAt(0).toUpperCase()}</span>
                              {String(order.assignedTo) === myId ? t('seller.orderAssignedYou') : order.assignedToName}
                            </span>
                          ) : (
                            <span className={`cell-sub${OPEN_STATUSES.includes(order.status) ? ' order-unassigned' : ''}`}>
                              {OPEN_STATUSES.includes(order.status) ? t('seller.orderUnassigned') : '—'}
                            </span>
                          )}
                        </td>
                      )}
                      <td>
                        <div className="cell-stack">
                          <span className={`badge ${STATUS_BADGE[order.status] || 'badge-pending'}`}>
                            {statusLabel(order.status, t)}
                          </span>
                          {order.status === 'rejected' && order.rejectionReason && (
                            <span className="cell-sub">{order.rejectionReason}</span>
                          )}
                        </div>
                      </td>
                      <td className="tight">
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          {/* Moving the order one stage on is the whole job of this screen,
                              so it is the tinted square and it never moves. Cancelling an
                              order a customer placed is not a thing to put a thumb's width
                              away from it. */}
                          {nextStatus(order) && (
                            <button
                              type="button"
                              className="icon-btn primary"
                              data-tip={nextStageLabel(order, t)}
                              onClick={() => advance(order)}
                            >
                              <CheckCircleIcon size={17} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="icon-btn"
                            data-tip={t('seller.orderDetails')}
                            onClick={() => openDetail(order)}
                          >
                            <ListIcon size={17} />
                          </button>
                          {order.bill && (
                            <Link href={recordHref('/seller/invoice/[id]', order.bill)} className="icon-btn" data-tip={t('seller.invoiceAction')}>
                              <ReceiptIcon size={17} />
                            </Link>
                          )}
                          <RowMenu
                            items={[
                              ...assignMenuItems(order),
                              {
                                label: t('seller.orderBroughtBack'),
                                icon: <UndoIcon size={15} />,
                                hidden: order.status !== 'dispatched',
                                onClick: () => bringBack(order),
                              },
                              {
                                label: t('common.cancel'),
                                icon: <XIcon size={15} />,
                                danger: true,
                                hidden: !nextStatus(order),
                                onClick: () => setRejectingOrder(order),
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="record-cards mobile-only">
              {page.pageItems.map((order) => (
                <div
                  className={`record-card order-card${freshIds.has(String(order._id)) ? ' moment-arrive moment-new-flag' : ''}`}
                  key={order._id}
                >
                  <div className="record-card-main">
                    <span className="record-card-title">
                      #{order.orderNumber} · {order.customer?.name}
                    </span>
                    <div className="record-card-meta">
                      <span>{order.customer?.phone}</span>
                      <span className={`badge ${STATUS_BADGE[order.status] || 'badge-pending'}`}>
                        {t(`seller.order${order.status.charAt(0).toUpperCase()}${order.status.slice(1)}`)}
                      </span>
                      <span className={`badge ${order.fulfillmentType === 'delivery' ? 'badge-expiring' : 'badge-active'}`}>
                        {order.fulfillmentType === 'dine_in' ? t('tables.type.dine_in') : order.fulfillmentType === 'delivery'
                          ? <><ScooterIcon size={13} /> {t('seller.orderDelivery')}</>
                          : <><BagIcon size={13} /> {t('seller.orderPickup')}</>}
                      </span>
                      <span className="record-card-price">{money(payableOf(order))}</span>
                    </div>
                    {(() => {
                      const age = ageLine(order, now, t);
                      return (
                        <span className="cell-sub">
                          {formatDateTime(order.createdAt, lang)}
                          {age && <> · <span className={`order-age${age.tone}`}>{age.text}</span></>}
                        </span>
                      );
                    })()}
                    {hasTeam && (order.assignedToName || OPEN_STATUSES.includes(order.status)) && (
                      <span className={`cell-sub${!order.assignedToName ? ' order-unassigned' : ''}`}>
                        {order.assignedToName
                          ? `${t('seller.orderAssigned')}: ${String(order.assignedTo) === myId ? t('seller.orderAssignedYou') : order.assignedToName}`
                          : t('seller.orderUnassigned')}
                      </span>
                    )}
                    <span className="cell-sub order-items-line">
                      {order.items.map((i) => `${i.name} x${i.quantity}`).join(', ')}
                    </span>
                    {(order.deliveryCharge > 0 || discountOf(order) > 0) && (
                      <span className="cell-sub">
                        {money(order.totalAmount)}
                        {discountOf(order) > 0 && ` − ${money(discountOf(order))}`}
                        {order.deliveryCharge > 0 && ` + ${money(order.deliveryCharge)} ${t('seller.orderDeliveryFee')}`}
                      </span>
                    )}
                    {(() => {
                      const slot = slotOf(order, t);
                      return slot ? (
                        <span className={`cell-sub order-slot${slot.late ? ' is-late' : ''}`}>
                          <ClockIcon size={13} /> {slot.text}
                        </span>
                      ) : null;
                    })()}
                    {order.fulfillmentType === 'delivery' && order.address && (
                      <span className="cell-sub">{t('seller.orderAddress')}: {order.address}</span>
                    )}
                    {order.note && <span className="cell-sub">{t('seller.orderNote')}: {order.note}</span>}
                    {order.status === 'rejected' && order.rejectionReason && (
                      <span className="cell-sub">{order.rejectionReason}</span>
                    )}
                    {/* The phone card keeps its words. There is no hover here to reveal a
                        tooltip, and a card has the width a table row does not — the icon
                        rule exists to stop an actions COLUMN from eating a table, which is
                        not a problem a stacked card has. */}
                    <div className="row-actions">
                      {nextStatus(order) && (
                        <button className="btn btn-secondary btn-small btn-inline" onClick={() => advance(order)}>
                          {nextStageLabel(order, t)}
                        </button>
                      )}
                      <button className="btn btn-secondary btn-small btn-inline" onClick={() => openDetail(order)}>
                        {t('seller.orderDetails')}
                      </button>
                      {order.status === 'dispatched' && (
                        <button className="btn btn-secondary btn-small btn-inline" onClick={() => bringBack(order)}>
                          {t('seller.orderBroughtBack')}
                        </button>
                      )}
                      {assignMenuItems(order).map((item) => (
                        <button key={item.label} className="btn btn-secondary btn-small btn-inline" onClick={item.onClick}>
                          {item.label}
                        </button>
                      ))}
                      {nextStatus(order) && (
                        <button className="btn btn-danger btn-small btn-inline" onClick={() => setRejectingOrder(order)}>{t('common.cancel')}</button>
                      )}
                      {order.bill && (
                        <Link href={recordHref('/seller/invoice/[id]', order.bill)} className="btn btn-secondary btn-small btn-inline">
                          {t('seller.invoiceAction')}
                        </Link>
                      )}
                    </div>
                  </div>
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
              label={t('nav.orders')}
            />
          </>
        )}
      </div>
      )}

      {view === 'deliveries' && (
        <DeliveryRun
          t={t}
          refreshKey={refreshKey}
          myId={myId}
          hasTeam={hasTeam}
          isOwner={isOwner}
          onAdvance={(order) => advance(order)}
          onBringBack={bringBack}
          onOpenDetail={openDetail}
        />
      )}

      {view === 'standing' && (
        <div className="data-panel">
          <div className="data-filters" style={{ justifyContent: 'space-between' }}>
            <p className="field-hint" style={{ margin: 0 }}>{t('seller.standingOrdersHint')}</p>
            <button type="button" className="btn btn-primary btn-small btn-inline" onClick={openAddStanding}>
              <PlusIcon size={15} /> {t('seller.newStandingOrder')}
            </button>
          </div>

          {standingLoading ? (
            <div className="data-panel-body"><SkeletonTable rows={4} cols={4} /></div>
          ) : standingOrders.length === 0 ? (
            <div className="empty-state-rich">
              <Illustration scene="calendar" />
              <p>{t('seller.standingOrdersEmpty')}</p>
              <button type="button" className="btn btn-primary btn-small btn-inline" onClick={openAddStanding}>
                <PlusIcon size={15} />
                {t('seller.newStandingOrder')}
              </button>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('common.name')}</th>
                    <th>{t('seller.items')}</th>
                    <th>{t('common.status')}</th>
                    <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {standingOrders.map((row) => (
                    <tr key={row._id}>
                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{row.customer?.name}</span>
                          <span className="cell-sub">{row.customer?.phone}</span>
                        </div>
                      </td>
                      <td>
                        <span className="order-items-line">{row.items.map((i) => `${i.name || ''} x${i.quantity}`).join(', ')}</span>
                      </td>
                      <td>
                        <span className={`badge ${row.active ? 'badge-active' : 'badge-inactive'}`}>
                          {row.active ? t('seller.standingActive') : t('seller.standingPaused')}
                        </span>
                      </td>
                      <td className="tight">
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <button type="button" className="icon-btn" data-tip={t('common.edit')} onClick={() => openEditStanding(row)}>
                            <EditIcon size={17} />
                          </button>
                          {/* Pause and Resume are the same button wearing two words, and
                              which one it is wearing is the thing you have to read — that
                              is exactly the action that belongs in the menu rather than on
                              a square that would show the same glyph either way. */}
                          <RowMenu
                            items={[
                              {
                                label: row.active ? t('seller.standingPause') : t('seller.standingResume'),
                                icon: <ClockIcon size={15} />,
                                disabled: standingBusyId === row._id,
                                onClick: () => toggleStandingActive(row),
                              },
                              {
                                label: t('common.delete'),
                                icon: <TrashIcon size={15} />,
                                danger: true,
                                disabled: standingBusyId === row._id,
                                onClick: () => deleteStanding(row),
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
          )}
        </div>
      )}

      {standingFormOpen && (
        <Modal
          as="form"
          onSubmit={submitStandingForm}
          onClose={() => setStandingFormOpen(false)}
          title={editingStandingId ? t('seller.editStandingOrder') : t('seller.newStandingOrder')}
          hint={t('seller.standingFormHint')}
          maxWidth={560}
          footer={
            <>
              <button type="submit" className="btn btn-primary btn-inline" disabled={standingSubmitting}>
                {standingSubmitting ? t('common.saving') : editingStandingId ? t('common.saveChanges') : t('seller.newStandingOrder')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setStandingFormOpen(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >

            <div className="field">
              <label>{t('seller.selectCustomer')} <span className="field-required">*</span></label>
              {/* Required, and until now with no way to satisfy it from here — a dairy on its
                  first morning could not write "1 litre doodh roz" for the customer standing
                  in front of it. */}
              <div className="input-action">
                <Dropdown
                  value={standingForm.customerId}
                  onChange={(v) => setStandingForm((f) => ({ ...f, customerId: v }))}
                  options={[{ value: '', label: t('memberships.pickCustomer') }, ...customers.map((c) => ({ value: c.id, label: `${c.name} (${c.phone})` }))]}
                />
                <button
                  type="button"
                  className="icon-btn"
                  data-tip={t('customerAdd.title')}
                  onClick={() => setAddingCustomer(true)}
                >
                  <PlusIcon size={17} />
                </button>
              </div>
            </div>

            <div className="field">
              <label>{t('seller.items')}</label>
              {standingForm.items.map((row, index) => (
                <div key={index} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                  <Dropdown
                    className="standing-item-product"
                    value={row.productId}
                    onChange={(v) => updateStandingItemRow(index, 'productId', v)}
                    options={[{ value: '', label: t('seller.selectProduct') }, ...goodsProducts.map((p) => ({ value: p._id, label: `${p.name} (${p.unit})` }))]}
                  />
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    placeholder={t('seller.quantity')}
                    value={row.quantity}
                    onChange={(e) => updateStandingItemRow(index, 'quantity', e.target.value)}
                    style={{ flex: '1 1 100px' }}
                  />
                  <button type="button" className="icon-btn danger" onClick={() => removeStandingItemRow(index)}>
                    <XIcon size={17} />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={addStandingItemRow}>
                <PlusIcon size={15} /> {t('seller.addItem')}
              </button>
            </div>

            <div className="field">
              <label>{t('expenses.note')}</label>
              <input value={standingForm.notes} onChange={(e) => setStandingForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>

        </Modal>
      )}

      {/* The order itself — what to pack, who to call, and what to collect.

          One sheet rather than a page, because this is read standing up with a bag in one
          hand: it opens over the list, it prints as a picking slip, and closing it puts the
          shopkeeper back on the row they opened. */}
      {detailOrder && (
        <Modal
          onClose={() => setDetailOrder(null)}
          title={`#${detailOrder.orderNumber} · ${detailOrder.customer?.name || ''}`}
          maxWidth={560}
          className="order-detail-sheet"
          footer={
            <>
              {nextStatus(detailOrder) && (
                <button
                  type="button"
                  className="btn btn-primary btn-inline"
                  onClick={() => {
                    const order = detailOrder;
                    setDetailOrder(null);
                    advance(order);
                  }}
                >
                  {nextStageLabel(detailOrder, t)}
                </button>
              )}
              {detailOrder.status === 'dispatched' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-inline"
                  onClick={() => {
                    const order = detailOrder;
                    setDetailOrder(null);
                    bringBack(order);
                  }}
                >
                  <UndoIcon size={17} /> {t('seller.orderBroughtBack')}
                </button>
              )}
              <button type="button" className="btn btn-secondary btn-inline" onClick={printSlip}>
                <PrinterIcon size={17} /> {t('seller.orderPrintSlip')}
              </button>
              {detailOrder.bill && (
                <Link
                  href={recordHref('/seller/invoice/[id]', detailOrder.bill)}
                  className="btn btn-secondary btn-inline"
                  style={{ textDecoration: 'none' }}
                >
                  {t('seller.invoiceAction')}
                </Link>
              )}
            </>
          }
        >
          <div className="order-detail">
            <div className="order-detail-badges">
              <span className={`badge ${STATUS_BADGE[detailOrder.status] || 'badge-pending'}`}>
                {t(`seller.order${detailOrder.status.charAt(0).toUpperCase()}${detailOrder.status.slice(1)}`)}
              </span>
              <span className={`badge ${detailOrder.fulfillmentType === 'delivery' ? 'badge-expiring' : 'badge-active'}`}>
                {detailOrder.fulfillmentType === 'dine_in' ? t('tables.type.dine_in') : detailOrder.fulfillmentType === 'delivery'
                  ? <><ScooterIcon size={13} /> {t('seller.orderDelivery')}</>
                  : <><BagIcon size={13} /> {t('seller.orderPickup')}</>}
              </span>
              {detailLoading && <span className="cell-sub">{t('common.loading')}</span>}
            </div>

            <div className="order-detail-when">
              <span>
                {t('seller.orderPlaced')}: {formatDateTime(detailOrder.createdAt, lang)}
                {(() => {
                  const age = ageLine(detailOrder, now, t);
                  return age ? <> · <span className={`order-age${age.tone}`}>{age.text}</span></> : null;
                })()}
              </span>
              {hasTeam && (
                <span className="order-detail-assignee">
                  <UsersIcon size={14} />
                  {detailOrder.assignedToName
                    ? t('seller.orderAssignedTo', { name: detailOrder.assignedToName })
                    : t('seller.orderUnassigned')}
                  {detailOrder.assignedByName && detailOrder.assignedByName !== detailOrder.assignedToName && (
                    <small> · {t('seller.orderAssignedBy', { name: detailOrder.assignedByName })}</small>
                  )}
                  {assignMenuItems(detailOrder).map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className="btn btn-secondary btn-small btn-inline order-detail-noprint"
                      onClick={item.onClick}
                      disabled={assignBusy}
                    >
                      {item.label}
                    </button>
                  ))}
                </span>
              )}
            </div>

            {/* The number the customer gave FOR THIS ORDER, which the model has always
                validated as a real, callable mobile "so the shopkeeper always has a number
                they can actually call" — and which this screen had never once displayed. It
                is not always the account number: a delivery to a relative's house carries
                the relative's phone, and that is the phone the man with the bag needs. */}
            <div className="order-detail-contact order-detail-noprint">
              {(() => {
                const forOrder = dialable(detailOrder.contactPhone);
                const onAccount = dialable(detailOrder.customer?.phone);
                const number = forOrder || onAccount;
                if (!number) return <span className="cell-sub">{detailOrder.customer?.phone || '—'}</span>;
                return (
                  <>
                    <a className="btn btn-secondary btn-small btn-inline" href={`tel:+91${number}`}>
                      <PhoneIcon size={15} /> {number}
                    </a>
                    <a
                      className="btn btn-secondary btn-small btn-inline"
                      href={`https://wa.me/91${number}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <WhatsappIcon size={15} /> WhatsApp
                    </a>
                    {detailOrder.fulfillmentType === 'delivery' && mapHref(detailOrder) && (
                      <a
                        className="btn btn-secondary btn-small btn-inline"
                        href={mapHref(detailOrder)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MapPinIcon size={15} /> {t('seller.orderOpenMap')}
                      </a>
                    )}
                    {/* Said out loud, because a shopkeeper who calls the account number and
                        gets the wrong person will not think to look for a second one. */}
                    {forOrder && onAccount && forOrder !== onAccount && (
                      <span className="cell-sub">{t('seller.orderPhoneDiffers').replace('{phone}', onAccount)}</span>
                    )}
                  </>
                );
              })()}
            </div>
            {/* Print gets the number as ink; a tel: link on paper is nothing. */}
            <div className="order-detail-printonly">
              {t('seller.orderContact')}: {dialable(detailOrder.contactPhone) || detailOrder.customer?.phone || '—'}
            </div>

            {detailOrder.fulfillmentType === 'delivery' && detailOrder.address && (
              <div className="order-detail-address">
                <MapPinIcon size={15} />
                <span>
                  {detailOrder.address}
                  {detailOrder.deliveryDistanceKm > 0 && (
                    <small> · {t('seller.orderDistance').replace('{km}', detailOrder.deliveryDistanceKm)}</small>
                  )}
                </span>
              </div>
            )}

            {(() => {
              const slot = slotOf(detailOrder, t);
              return slot ? (
                <div className="order-detail-address">
                  <ClockIcon size={15} />
                  <span>
                    {t('seller.orderSlot')}: {slot.text}
                    {slot.late && <small> · {t('seller.orderSlotLate')}</small>}
                  </span>
                </div>
              ) : null;
            })()}

            {detailOrder.note && (
              <p className="order-detail-note">{t('seller.orderNote')}: {detailOrder.note}</p>
            )}

            <div className="data-panel">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('seller.items')}</th>
                    <th className="num">{t('seller.orderQty')}</th>
                    <th className="num">{t('seller.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {detailOrder.items.map((item, index) => (
                    <tr key={index}>
                      <td>
                        <div className="cell-stack">
                          <span>{item.name}</span>
                          {/* The scheme that priced this line, named on the line. A packer
                              who does not know the second soap is a freebie puts one in. */}
                          {item.offerName && (
                            <span className="cell-sub">
                              {item.offerName}
                              {item.freeQuantity > 0 && ` · ${t('seller.orderFreeUnits').replace('{n}', item.freeQuantity)}`}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="num">{item.quantity}{item.unit ? ` ${item.unit}` : ''}</td>
                      <td className="num">
                        <div className="cell-stack">
                          <span>{money(item.lineTotal)}</span>
                          {item.discountAmount > 0 && (
                            <span className="cell-sub">− {money(item.discountAmount)}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Every line the customer's own copy shows, in the same order, so the two
                cannot be read side by side and disagree. */}
            <div className="order-detail-money">
              <div>
                <span>{t('seller.orderGoods')}</span>
                <span>{money(detailOrder.totalAmount)}</span>
              </div>
              {detailOrder.couponDiscount > 0 && (
                <div className="is-off">
                  <span>{t('seller.orderCoupon')}{detailOrder.couponCode ? ` (${detailOrder.couponCode})` : ''}</span>
                  <span>− {money(detailOrder.couponDiscount)}</span>
                </div>
              )}
              {detailOrder.pointsRedeemedValue > 0 && (
                <div className="is-off">
                  <span>{t('seller.orderPointsUsed').replace('{n}', detailOrder.pointsRedeemed)}</span>
                  <span>− {money(detailOrder.pointsRedeemedValue)}</span>
                </div>
              )}
              {detailOrder.deliveryCharge > 0 && (
                <div>
                  <span>{t('seller.orderDeliveryFee')}</span>
                  <span>+ {money(detailOrder.deliveryCharge)}</span>
                </div>
              )}
              <div className="is-total">
                <span>{t('seller.orderToCollect')}</span>
                <span>{money(payableOf(detailOrder))}</span>
              </div>
              {detailOrder.status === 'delivered' && detailOrder.paymentMode && (
                <div className="cell-sub">
                  <span>{t('seller.orderPaidBy')}</span>
                  <span>{t(`expenses.mode.${detailOrder.paymentMode}`) === `expenses.mode.${detailOrder.paymentMode}`
                    ? detailOrder.paymentMode
                    : t(`expenses.mode.${detailOrder.paymentMode}`)}</span>
                </div>
              )}
            </div>

            {/* When each step actually happened — the answer to "yeh order kab se pada
                hai", which the row could not give at all. */}
            {detailOrder.statusHistory?.length > 0 && (
              <ol className="order-detail-timeline">
                {detailOrder.statusHistory.map((entry, index) => (
                  <li key={index}>
                    <ClockIcon size={13} />
                    <span>{statusLabel(entry.status, t)}</span>
                    <small>
                      {entry.at ? formatDateTime(entry.at, lang) : ''}
                      {entry.byName ? ` · ${t('seller.orderBy', { name: entry.byName })}` : ''}
                    </small>
                  </li>
                ))}
              </ol>
            )}

            {detailOrder.status === 'rejected' && detailOrder.rejectionReason && (
              <p className="order-detail-note">{detailOrder.rejectionReason}</p>
            )}
          </div>
        </Modal>
      )}

      {/* Delivery = the sale is now money. Picking the mode here is what creates the bill,
          so the order lands in the day book, reports and GST exactly like a counter sale. */}
      {deliveringOrder && (
        <Modal
          onClose={() => setDeliveringOrder(null)}
          title={t('seller.orderCollectPayment')}
          maxWidth={420}
          closeOnBackdrop={false}
          footer={
            <button type="button" className="btn btn-secondary btn-inline" onClick={() => setDeliveringOrder(null)}>
              {t('common.cancel')}
            </button>
          }
        >
            <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
              {t('seller.orderCollectPaymentHint', {
                number: deliveringOrder.orderNumber,
                amount: (deliveringOrder.payableTotal ?? deliveringOrder.totalAmount).toFixed(2),
              })}
            </p>
            {deliveringOrder.otpRequired && (
              <div className="field order-otp-field">
                <label htmlFor="order-otp">{t('seller.orderOtpLabel')}</label>
                <input
                  id="order-otp"
                  className="order-otp-input"
                  value={otpInput}
                  onChange={(e) => { setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 4)); setOtpError(''); }}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder="––––"
                />
                <p className="field-hint">{t('seller.orderOtpHint')}</p>
                {otpError && <p className="field-error-text">{otpError}</p>}
              </div>
            )}
            <div className="segmented" role="group" style={{ marginBottom: '0.9rem' }}>
              {[
                { id: 'cash', label: t('seller.cash'), icon: RupeeIcon },
                { id: 'upi', label: t('seller.upi'), icon: WalletIcon },
                { id: 'card', label: t('seller.card'), icon: CreditCardIcon },
                { id: 'khata', label: t('nav.khata'), icon: LedgerIcon },
              ].map(({ id, label, icon: ModeIcon }) => (
                <button
                  key={id}
                  type="button"
                  disabled={deliveringOrder.otpRequired && !otpSkipped && otpInput.length !== 4}
                  onClick={() => advance(deliveringOrder, id, { skipOtp: otpSkipped })}
                >
                  <ModeIcon size={15} /> {label}
                </button>
              ))}
            </div>
            {/* The customer deleted the notification and cannot find his code. Somebody has
                to be able to close the order, and that somebody is the owner — a helper
                who could wave the code away would be carrying no proof at all. */}
            {deliveringOrder.otpRequired && isOwner && (
              otpSkipped ? (
                <p className="field-hint">{t('seller.orderOtpSkipped')}</p>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-inline"
                  onClick={() => { setOtpSkipped(true); setOtpError(''); }}
                >
                  {t('seller.orderOtpSkip')}
                </button>
              )
            )}
        </Modal>
      )}

      {rejectingOrder && (
        <Modal
          onClose={() => { setRejectingOrder(null); setRejectReason(''); }}
          title={t('seller.orderRejectTitle')}
          maxWidth={420}
          closeOnBackdrop={false}
          footer={
            <>
              <button type="button" className="btn btn-danger btn-inline" onClick={confirmReject} disabled={rejecting}>
                {t('seller.orderRejectConfirm')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-inline"
                onClick={() => { setRejectingOrder(null); setRejectReason(''); }}
                disabled={rejecting}
              >
                {t('common.cancel')}
              </button>
            </>
          }
        >
            <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>{t('seller.orderRejectHint')}</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t('seller.orderRejectPlaceholder')}
              rows={3}
              style={{ width: '100%', marginBottom: '0.9rem', resize: 'vertical' }}
            />
        </Modal>
      )}

      {assigningOrder && (
        <Modal
          onClose={() => setAssigningOrder(null)}
          title={t('seller.orderAssignTitle', { number: assigningOrder.orderNumber })}
          hint={t('seller.orderAssignHint')}
          maxWidth={420}
          footer={
            <>
              <button
                type="button"
                className="btn btn-primary btn-inline"
                disabled={assignBusy || assignTo === (assigningOrder.assignedTo ? String(assigningOrder.assignedTo) : '')}
                onClick={() => assign(assigningOrder, assignTo)}
              >
                {assignBusy ? t('common.saving') : t('common.saveChanges')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setAssigningOrder(null)} disabled={assignBusy}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
          <div className="field">
            <label>{t('seller.orderAssigned')}</label>
            <Dropdown value={assignTo} onChange={setAssignTo} options={assignOptions} />
          </div>
        </Modal>
      )}

      {justBilled && (
        <Modal
          onClose={() => setJustBilled(null)}
          maxWidth={380}
          className="order-billed-card"
          footer={
            <>
              <Link
                href={recordHref('/seller/invoice/[id]', justBilled._id)}
                className="btn btn-primary btn-inline"
                style={{ textDecoration: 'none' }}
              >
                {t('seller.professionalBill')}
              </Link>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => setJustBilled(null)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
          <div className="empty-icon" style={{ margin: '0 auto 0.75rem' }}><OrdersIcon size={26} /></div>
          <h2 style={{ marginTop: 0 }}>{t('seller.orderBilledTitle', { number: justBilled.billNumber })}</h2>
          <p style={{ color: 'var(--text-muted)' }}>{t('seller.orderBilledHint')}</p>
        </Modal>
      )}
      {addingCustomer && (
        <CustomerQuickAdd
          onClose={() => setAddingCustomer(false)}
          onCreated={(customer) => {
            setCustomers((prev) => [customer, ...prev.filter((c) => c.id !== customer.id)]);
            setStandingForm((f) => ({ ...f, customerId: customer.id }));
          }}
        />
      )}

    </>
  );
}
