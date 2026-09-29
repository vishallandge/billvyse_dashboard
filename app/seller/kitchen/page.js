'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { tableErrorText } from '../../../lib/tableErrors';
import { getActiveStoreId } from '../../../lib/session';
import { getShopSocket } from '../../../lib/socket';
import { useDashboardUser } from '../../components/DashboardShell';
import { businessType, DEFAULT_BUSINESS_TYPE } from '../../../lib/businessTypes';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { useToast } from '../../components/Toast';
import { SkeletonStats } from '../../components/Skeleton';
import {
  ClockIcon,
  CheckIcon,
  TableIcon,
  UndoIcon,
  BellIcon,
  MaximizeIcon,
  RowsIcon,
  GridIcon,
} from '../../components/Icons';

// The Kitchen Display Screen. Reads the same TableOrder items the floor screen does and
// writes only `item.kitchenStatus` (see backend/models/TableOrder.js) — nothing here bills
// or moves stock.
//
// Two ways to look at the same food, because a kitchen genuinely needs both:
//
//   Tickets — grouped by table. This is the default and it is what actually gets served:
//     one table's food goes out together, so the kitchen bumps a whole ticket rather than
//     letting three dishes sit under a lamp while the fourth is still on the pan.
//
//   Items — every dish as its own card in queued/preparing/ready lanes. What one cook at
//     one station works off.
//
// Plus the all-day strip: "12 × Butter Naan" totalled across every open table, so the
// tandoor makes twelve at once instead of twelve times.

const COLUMNS = ['queued', 'preparing', 'ready'];
const NEXT_STATUS = { queued: 'preparing', preparing: 'ready', ready: 'served' };
const ACTION_KEY = { queued: 'kitchen.start', preparing: 'kitchen.markReady', ready: 'kitchen.markServed' };

// Three tiers, not one. A dish two minutes old and a dish fourteen minutes old are both
// "not late yet", but only one of them is about to be — and a board that only turns red at
// the end gives a kitchen no warning it could have acted on.
const WARN_MINUTES = 6;
const LATE_MINUTES = 15;

const SOUND_KEY = 'dukaan_kds_sound';
const VIEW_KEY = 'dukaan_kds_view';

function minutesSince(from, now) {
  return Math.floor((now - new Date(from).getTime()) / 60000);
}

function formatElapsed(from, now) {
  const mins = Math.max(0, minutesSince(from, now));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function ageClass(from, now) {
  const mins = minutesSince(from, now);
  if (mins >= LATE_MINUTES) return 'is-late';
  if (mins >= WARN_MINUTES) return 'is-warn';
  return '';
}

/**
 * A short beep, synthesised rather than shipped as an audio file — a kitchen is loud and
 * nobody is watching the screen, so a new ticket has to make a noise, but that is not worth
 * an asset, a download or a licence.
 *
 * Browsers refuse to play audio until the page has been interacted with, which is exactly
 * why this is behind a button the cook presses once rather than on by default.
 */
function playBeep(ctxRef) {
  try {
    if (!ctxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      ctxRef.current = new Ctx();
    }
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1180, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.34);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // A kitchen screen that cannot beep still has to show the food.
  }
}

export default function KitchenPage() {
  const user = useDashboardUser();
  const { t } = useLanguage();
  const toast = useToast();

  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [busyId, setBusyId] = useState('');
  const [view, setView] = useState('tickets');
  const [station, setStation] = useState('');
  const [soundOn, setSoundOn] = useState(false);
  // The last thing bumped off the board, so a mis-tap is one tap to undo rather than a
  // dish that has silently left the kitchen's screen forever.
  const [lastBumped, setLastBumped] = useState(null);
  const [voidAlerts, setVoidAlerts] = useState([]);
  const audioRef = useRef(null);
  const soundRef = useRef(false);

  function load() {
    return apiFetch('/api/seller/table-orders')
      .then((data) => { setOrders(data.orders || []); setLoadError(''); })
      .catch((err) => setLoadError(tableErrorText(err, t)));
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
    apiFetch('/api/seller/products').then((d) => setProducts(d.products || [])).catch(() => {});
    try {
      setSoundOn(localStorage.getItem(SOUND_KEY) === '1');
      const savedView = localStorage.getItem(VIEW_KEY);
      if (savedView === 'items' || savedView === 'tickets') setView(savedView);
    } catch {
      // Private mode / storage disabled — the defaults are fine.
    }
  }, []);

  // Read inside the socket handler, which is registered once and would otherwise close over
  // whatever `soundOn` was at mount.
  useEffect(() => {
    soundRef.current = soundOn;
  }, [soundOn]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const socket = getShopSocket();
    if (!socket) return undefined;
    const refresh = () => load();
    const onKot = () => {
      refresh();
      if (soundRef.current) playBeep(audioRef);
    };
    // A dish the kitchen is already cooking, cancelled at the counter. It has to interrupt.
    const alertOf = (kind) => (payload) => {
      if (payload.store && getActiveStoreId() && String(payload.store) !== String(getActiveStoreId())) return;
      refresh();
      if (soundRef.current) playBeep(audioRef);
      setVoidAlerts((list) => [{ ...payload, kind, at: Date.now(), key: `${kind}-${payload.id}-${Date.now()}` }, ...list].slice(0, 8));
    };
    const onVoid = alertOf('voided');
    // The counter changed a dish the kitchen has not started: "Naan 2 → 1".
    const onChanged = alertOf('changed');
    // The counter wants a dish on the pan cancelled — only the kitchen can say if it's too late.
    const onCancelAsk = alertOf('asked');
    const events = ['connect', 'table:opened', 'table:updated', 'table:settled', 'table:transferred', 'table:merged'];
    events.forEach((e) => socket.on(e, refresh));
    socket.on('kot:sent', onKot);
    socket.on('kitchen:voided', onVoid);
    socket.on('kitchen:changed', onChanged);
    socket.on('kitchen:cancel-request', onCancelAsk);
    return () => {
      events.forEach((e) => socket.off(e, refresh));
      socket.off('kot:sent', onKot);
      socket.off('kitchen:voided', onVoid);
      socket.off('kitchen:changed', onChanged);
      socket.off('kitchen:cancel-request', onCancelAsk);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const refresh = () => { if (!document.hidden) load(); };
    const interval = setInterval(refresh, 15000);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    try { localStorage.setItem(SOUND_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    // Played immediately so the cook hears what they just switched on — and, more to the
    // point, so the browser gets its user gesture and will allow the later ones.
    if (next) playBeep(audioRef);
  }

  function switchView(next) {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* ignore */ }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  }

  // A dish's station comes from its product's category, joined here rather than snapshotted
  // onto the order line — a shop that renames "Tandoor" should not have to re-fire every
  // running table to see it.
  const categoryByProduct = useMemo(() => {
    const map = new Map();
    for (const p of products) map.set(String(p._id), p.category || '');
    return map;
  }, [products]);

  const allTickets = useMemo(() => {
    const list = [];
    for (const order of orders) {
      for (const item of order.items || []) {
        if (!item.sentToKitchen || item.kitchenStatus === 'served') continue;
        list.push({
          order,
          item,
          firedAt: item.firedAt || order.createdAt,
          station: categoryByProduct.get(String(item.product)) || '',
        });
      }
    }
    list.sort((a, b) => new Date(a.firedAt) - new Date(b.firedAt));
    return list;
  }, [orders, categoryByProduct]);

  const stations = useMemo(
    () => Array.from(new Set(allTickets.map((tk) => tk.station).filter(Boolean))).sort(),
    [allTickets]
  );

  const tickets = useMemo(
    () => (station ? allTickets.filter((tk) => tk.station === station) : allTickets),
    [allTickets, station]
  );

  const columns = useMemo(() => {
    const map = { queued: [], preparing: [], ready: [] };
    for (const ticket of tickets) {
      const status = ticket.item.kitchenStatus === 'pending' ? 'queued' : ticket.item.kitchenStatus;
      (map[status] || map.queued).push(ticket);
    }
    return map;
  }, [tickets]);

  // One card per table, oldest first — the order the kitchen should be working in.
  const byOrder = useMemo(() => {
    const map = new Map();
    for (const tk of tickets) {
      const key = String(tk.order._id);
      if (!map.has(key)) map.set(key, { order: tk.order, items: [], firedAt: tk.firedAt });
      const group = map.get(key);
      group.items.push(tk);
      if (new Date(tk.firedAt) < new Date(group.firedAt)) group.firedAt = tk.firedAt;
    }
    return Array.from(map.values()).sort((a, b) => new Date(a.firedAt) - new Date(b.firedAt));
  }, [tickets]);

  /**
   * The same dish totalled across every open table — "12 × Butter Naan".
   *
   * The single most useful number in a kitchen and the one no per-table view can show: a
   * tandoor that knows twelve naan are pending makes twelve, instead of making one, reading
   * the next ticket, and making one more.
   */
  const allDay = useMemo(() => {
    const map = new Map();
    for (const tk of tickets) {
      if (tk.item.kitchenStatus === 'ready') continue;
      const key = tk.item.note ? `${tk.item.name} (${tk.item.note})` : tk.item.name;
      map.set(key, (map.get(key) || 0) + tk.item.quantity);
    }
    return Array.from(map.entries())
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty);
  }, [tickets]);

  const stats = useMemo(() => {
    const oldest = tickets.length ? minutesSince(tickets[0].firedAt, now) : 0;
    return {
      active: tickets.length,
      tables: byOrder.length,
      oldest,
      late: tickets.filter((tk) => minutesSince(tk.firedAt, now) >= LATE_MINUTES).length,
    };
  }, [tickets, byOrder, now]);

  async function advance(ticket) {
    if (busyId || loadError) return;
    const current = ticket.item.kitchenStatus === 'pending' ? 'queued' : ticket.item.kitchenStatus;
    const nextStatus = NEXT_STATUS[current];
    const key = `${ticket.order._id}-${ticket.item._id}`;
    setBusyId(key);
    try {
      const data = await apiFetch(
        `/api/seller/table-orders/${ticket.order._id}/items/${ticket.item._id}/kitchen-status`,
        { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) }
      );
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
      if (nextStatus === 'served') {
        setLastBumped({ orderId: ticket.order._id, itemIds: [ticket.item._id], from: current, label: ticket.item.name });
      }
    } catch (err) {
      toast.error(tableErrorText(err, t));
    } finally {
      setBusyId('');
    }
  }

  // The whole table at once — what actually happens when a ticket is called away.
  async function bumpGroup(group, status) {
    if (busyId || loadError) return;
    const key = `group-${group.order._id}`;
    setBusyId(key);
    const itemIds = group.items.map((tk) => tk.item._id);
    const from = group.items[0]?.item.kitchenStatus === 'pending' ? 'queued' : group.items[0]?.item.kitchenStatus;
    try {
      const data = await apiFetch(`/api/seller/table-orders/${group.order._id}/kitchen-bump`, {
        method: 'POST',
        body: JSON.stringify({ itemIds, status }),
      });
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
      if (status === 'served') {
        setLastBumped({ orderId: group.order._id, itemIds, from: from || 'ready', label: group.order.tableLabel || group.order.tableName });
      }
    } catch (err) {
      toast.error(tableErrorText(err, t));
    } finally {
      setBusyId('');
    }
  }

  // "Can you still stop it?" — the kitchen's answer goes straight back to the waiter.
  async function answerCancel(ticket, decision) {
    if (busyId || loadError) return;
    const key = `ask-${ticket.item._id}`;
    setBusyId(key);
    try {
      const data = await apiFetch(`/api/seller/table-orders/${ticket.order._id}/items/${ticket.item._id}/cancel-answer`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
      setVoidAlerts((list) => list.filter((a) => !(a.kind === 'asked' && String(a.id) === String(ticket.order._id) && a.name === ticket.item.name)));
    } catch (err) {
      toast.error(tableErrorText(err, t));
    } finally {
      setBusyId('');
    }
  }

  async function undoBump() {
    if (!lastBumped || busyId || loadError) return;
    setBusyId('undo');
    try {
      const data = await apiFetch(`/api/seller/table-orders/${lastBumped.orderId}/kitchen-bump`, {
        method: 'POST',
        body: JSON.stringify({ itemIds: lastBumped.itemIds, status: lastBumped.from }),
      });
      setOrders((list) => list.map((o) => (o._id === data.order._id ? data.order : o)));
      setLastBumped(null);
    } catch (err) {
      toast.error(tableErrorText(err, t));
    } finally {
      setBusyId('');
    }
  }

  const runsTables = businessType(user?.businessType || DEFAULT_BUSINESS_TYPE).runsTables;
  const belongsHere = runsTables || orders.length > 0;

  if (user && !loading && !belongsHere) {
    return (
      <>
        <div className="page-head">
          <div className="page-head-text">
            <h1>{t('kitchen.title')}</h1>
            <p className="page-head-sub">{t('kitchen.subtitle')}</p>
          </div>
        </div>
        <div className="panel">
          <div className="empty-state-rich">
            <Illustration scene="board" />
            <p>{t('tables.notYourTrade')}</p>
            <Link href="/seller/settings" className="btn btn-secondary btn-small btn-inline">
              {t('tables.changeBusinessType')}
            </Link>
          </div>
        </div>
      </>
    );
  }

  // What changed since the kitchen last looked: the old quantity struck through, the new
  // one loud, and a changed note marked as new.
  function ChangeMark({ item }) {
    if (!item.amendedAt) return null;
    const qtyChanged = item.prevQuantity != null && item.prevQuantity !== item.quantity;
    const noteChanged = (item.prevNote || '') !== (item.note || '');
    return (
      <span className="kds-change">
        <strong>{t('kitchen.changed')}</strong>
        {qtyChanged && (
          <span>
            <s>{item.prevQuantity}</s> → <b>{item.quantity}</b>
          </span>
        )}
        {noteChanged && <span>{t('kitchen.newNote')}: {item.note || '—'}</span>}
      </span>
    );
  }

  function CancelAsk({ ticket }) {
    const ask = ticket.item.cancelRequest;
    if (!ask) return null;
    return (
      <div className="kds-cancel-ask" role="alert">
        <span>
          <strong>{t('kitchen.cancelAsked')}</strong>
          {ask.reason ? ` — ${ask.reason}` : ''}
        </span>
        <span className="kds-cancel-ask__actions">
          <button type="button" className="btn btn-danger btn-small btn-inline" disabled={!!busyId} onClick={() => answerCancel(ticket, 'stopped')}>
            {t('kitchen.cancelStopped')}
          </button>
          <button type="button" className="btn btn-secondary btn-small btn-inline" disabled={!!busyId} onClick={() => answerCancel(ticket, 'made')}>
            {t('kitchen.cancelMade')}
          </button>
        </span>
      </div>
    );
  }

  function ItemCard({ ticket, showTable = true }) {
    const key = `${ticket.order._id}-${ticket.item._id}`;
    const status = ticket.item.kitchenStatus === 'pending' ? 'queued' : ticket.item.kitchenStatus;
    return (
      <div className={`kds-card ${ageClass(ticket.firedAt, now)}${ticket.item.amendedAt ? ' is-changed' : ''}${ticket.item.cancelRequest ? ' is-asked' : ''}`}>
        <div className="kds-card-head">
          {showTable && <span className="kds-card-table">{ticket.order.tableLabel || ticket.order.tableName}</span>}
          <span className="kds-timer">
            <ClockIcon size={11} /> {formatElapsed(ticket.firedAt, now)}
          </span>
        </div>
        <div className="kds-card-name">
          <span className="kds-card-qty">{ticket.item.quantity}×</span>
          {ticket.item.seat || ticket.item.seats?.length ? <span className="kds-seat" title={t('tables.seat.chair', { seat: ticket.item.seats?.length ? ticket.item.seats.join(' + ') : ticket.item.seat })}>{ticket.item.seats?.length ? ticket.item.seats.join('+') : ticket.item.seat}</span> : null}{' '}
          {ticket.item.name}
        </div>
        <ChangeMark item={ticket.item} />
        {ticket.order.note && <div className="kds-card-note">{ticket.order.note}</div>}
        {ticket.item.note && <div className="kds-card-note">{ticket.item.note}</div>}
        <CancelAsk ticket={ticket} />
        <button
          type="button"
          className="btn btn-primary btn-small kds-card-action"
          disabled={!!busyId || !!loadError}
          onClick={() => advance(ticket)}
        >
          {t(ACTION_KEY[status])}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="kds-topbar">
        <div className="kds-topbar__title">
          <h1>{t('kitchen.title')}</h1>
          <span className="kds-topbar__stats">
            {t('kitchen.statActive', { count: stats.active })}
            {stats.tables > 0 && <> · {t('kitchen.statTables', { count: stats.tables })}</>}
            {stats.oldest > 0 && <> · {t('kitchen.statOldest', { mins: stats.oldest })}</>}
            {stats.late > 0 && <span className="kds-topbar__late"> · {t('kitchen.statLate', { count: stats.late })}</span>}
          </span>
        </div>

        <div className="kds-topbar__controls">
          <div className="segmented-mini" role="group">
            <button type="button" className={view === 'tickets' ? 'active' : ''} onClick={() => switchView('tickets')}>
              <RowsIcon size={14} /> {t('kitchen.viewTickets')}
            </button>
            <button type="button" className={view === 'items' ? 'active' : ''} onClick={() => switchView('items')}>
              <GridIcon size={14} /> {t('kitchen.viewItems')}
            </button>
          </div>
          <button
            type="button"
            className={`icon-btn ${soundOn ? 'is-on' : ''}`}
            data-tip={soundOn ? t('kitchen.soundOn') : t('kitchen.soundOff')}
            onClick={toggleSound}
          >
            <BellIcon size={17} />
          </button>
          <button type="button" className="icon-btn" data-tip={t('kitchen.fullscreen')} onClick={toggleFullscreen}>
            <MaximizeIcon size={17} />
          </button>
          <Link href="/seller/tables" className="btn btn-secondary btn-inline">
            <TableIcon size={17} /> {t('tables.title')}
          </Link>
        </div>
      </div>

      {/* A dish cancelled after the kitchen already had it. Stays until dismissed — the
          cook has to see it even if they were at the pass when it happened. */}
      {loadError && <div className="panel" role="alert"><p>{loadError}</p><button type="button" className="btn btn-secondary" onClick={load}>{t('moduleOpening.retry')}</button></div>}

      {voidAlerts.map((alert) => (
        <div className={`kds-void-alert is-${alert.kind || 'voided'}`} key={alert.key}>
          <span>
            {alert.kind === 'changed' ? (
              <>
                <strong>{t('kitchen.changedAlert', { table: alert.tableName })}</strong>{' '}
                {alert.name}
                {alert.from && alert.to && alert.from.quantity !== alert.to.quantity && <> · <s>{alert.from.quantity}</s> → <b>{alert.to.quantity}</b></>}
                {alert.from && alert.to && alert.from.note !== alert.to.note && <> · {t('kitchen.newNote')}: {alert.to.note || '—'}</>}
                {alert.kot ? ` · ${t('tables.kot')} ${alert.kot}` : ''}
              </>
            ) : alert.kind === 'asked' ? (
              <>
                <strong>{t('kitchen.cancelAskedAlert', { table: alert.tableName })}</strong> {alert.quantity}× {alert.name}
                {alert.reason ? ` — ${alert.reason}` : ''}
              </>
            ) : (
              <>
                <strong>{t('kitchen.voided')}</strong> {alert.quantity}× {alert.name} · {alert.tableName}
                {alert.reason ? ` — ${alert.reason}` : ''}
              </>
            )}
          </span>
          <button type="button" onClick={() => setVoidAlerts((list) => list.filter((a) => a.key !== alert.key))}>×</button>
        </div>
      ))}

      {(stations.length > 1 || station) && (
        <div className="category-tabs">
          <button type="button" className={`filter-pill ${!station ? 'active' : ''}`} onClick={() => setStation('')}>
            {t('kitchen.allStations')}
          </button>
          {stations.map((s) => (
            <button key={s} type="button" className={`filter-pill ${station === s ? 'active' : ''}`} onClick={() => setStation(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {allDay.length > 0 && (
        <div className="kds-allday">
          <span className="kds-allday__label">{t('kitchen.allDay')}</span>
          <div className="kds-allday__items">
            {allDay.map((row) => (
              <span className="kds-allday__chip" key={row.name}>
                <strong>{row.qty}×</strong> {row.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {lastBumped && (
        <div className="kds-undo">
          <span>{t('kitchen.bumped', { name: lastBumped.label })}</span>
          <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={undoBump} disabled={!!busyId || !!loadError}>
            <UndoIcon size={15} /> {t('kitchen.undo')}
          </button>
        </div>
      )}

      {loading ? (
        <SkeletonStats count={3} />
      ) : loadError && orders.length === 0 ? null : tickets.length === 0 ? (
        <div className="panel">
          <div className="empty-state-rich">
            <div className="empty-icon"><CheckIcon size={26} /></div>
            <p>{station ? t('kitchen.stationClear') : t('kitchen.allCaughtUp')}</p>
          </div>
        </div>
      ) : view === 'tickets' ? (
        <div className="kds-ticket-grid">
          {byOrder.map((group) => {
            const groupKey = `group-${group.order._id}`;
            const allReady = group.items.every((tk) => tk.item.kitchenStatus === 'ready');
            return (
              <div className={`kds-ticket ${ageClass(group.firedAt, now)}`} key={group.order._id}>
                <div className="kds-ticket__head">
                  <div>
                    <strong>{group.order.tableLabel || group.order.tableName}</strong>
                    <small>{t('kitchen.itemsCount', { count: group.items.length })}</small>
                  </div>
                  <span className="kds-timer">
                    <ClockIcon size={11} /> {formatElapsed(group.firedAt, now)}
                  </span>
                </div>

                {group.order.note && <p className="kds-card-note">{group.order.note}</p>}
                <ul className="kds-ticket__items">
                  {group.items.map((tk) => {
                    const key = `${tk.order._id}-${tk.item._id}`;
                    const status = tk.item.kitchenStatus === 'pending' ? 'queued' : tk.item.kitchenStatus;
                    return (
                      <li key={tk.item._id} className={`kds-ticket__item is-${status}${tk.item.amendedAt ? ' is-changed' : ''}${tk.item.cancelRequest ? ' is-asked' : ''}`}>
                        <button
                          type="button"
                          className="kds-ticket__tap"
                          disabled={!!busyId || !!loadError}
                          onClick={() => advance(tk)}
                          data-tip={t(ACTION_KEY[status])}
                        >
                          <span className="kds-ticket__qty">{tk.item.quantity}×</span>
                          <span className="kds-ticket__name">
                            {tk.item.seat || tk.item.seats?.length ? <span className="kds-seat" title={t('tables.seat.chair', { seat: tk.item.seats?.length ? tk.item.seats.join(' + ') : tk.item.seat })}>{tk.item.seats?.length ? tk.item.seats.join('+') : tk.item.seat}</span> : null}
                            {tk.item.name}
                            {tk.item.note && <em className="kds-ticket__note">{tk.item.note}</em>}
                            <ChangeMark item={tk.item} />
                          </span>
                          <span className={`kds-ticket__state is-${status}`}>{t(`kitchen.${status}`)}</span>
                        </button>
                        <CancelAsk ticket={tk} />
                      </li>
                    );
                  })}
                </ul>

                <div className="kds-ticket__foot">
                  {allReady ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-small kds-card-action"
                      disabled={!!busyId || !!loadError}
                      onClick={() => bumpGroup(group, 'served')}
                    >
                      {t('kitchen.serveTable')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-small kds-card-action"
                      disabled={!!busyId || !!loadError}
                      onClick={() => bumpGroup(group, 'ready')}
                    >
                      {t('kitchen.readyAll')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="kds-board">
          {COLUMNS.map((status) => (
            <div className="kds-column" key={status}>
              <div className="kds-column-head">
                <h3>{t(`kitchen.${status}`)}</h3>
                <span className="kds-count">{columns[status].length}</span>
              </div>
              {columns[status].length === 0 ? (
                <p className="kds-empty">{t('kitchen.columnEmpty')}</p>
              ) : (
                columns[status].map((ticket) => (
                  <ItemCard key={`${ticket.order._id}-${ticket.item._id}`} ticket={ticket} />
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
