'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import Illustration from '../../components/Illustration';
import { PhoneIcon, WhatsappIcon, MapPinIcon, ScooterIcon, CheckCircleIcon, UndoIcon, ListIcon, ClockIcon } from '../../components/Icons';

// A 10-digit Indian mobile, in the form tel: and wa.me want it.
function dialable(phone) {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  return /^[6-9][0-9]{9}$/.test(digits) ? digits : '';
}

function money(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function payableOf(order) {
  return Number(order?.payableTotal ?? order?.totalAmount) || 0;
}

/**
 * Where Maps should take the person carrying the bag.
 *
 * The pin the customer's own phone gave at checkout when there is one — it lands on the
 * door. Otherwise the typed address as a search, which in a mohalla lands on the street
 * at best, and is still better than retyping it.
 */
export function mapHref(order) {
  const point = order?.deliveryPoint;
  if (Number.isFinite(point?.lat) && Number.isFinite(point?.lng)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}`;
  }
  if (order?.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`;
  return '';
}

/**
 * The window the customer was promised, in the shop's own words: "Today 6:00 PM – 9:00 PM".
 *
 * `late` is the whole reason this is a function and not a template string — a bag still on
 * the shelf at 9pm for an 8pm window is the one row in the list that has already broken a
 * promise, and it has to be able to say so.
 */
export function slotOf(order, t) {
  const start = new Date(order?.deliverySlot?.startAt);
  const end = new Date(order?.deliverySlot?.endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const clock = (at) => at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const time = `${clock(start)} – ${clock(end)}`;
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(start).setHours(0, 0, 0, 0) - midnight.getTime()) / 86400000);
  const now = Date.now();
  return {
    text: days === 0 ? t('seller.orderSlotToday', { time }) : days === 1
      ? t('seller.orderSlotTomorrow', { time })
      : `${start.toLocaleDateString()} ${time}`,
    startAt: start.getTime(),
    late: end.getTime() < now,
    running: start.getTime() <= now && end.getTime() >= now,
  };
}

/**
 * The delivery run — the Orders screen for the person on the scooter.
 *
 * The orders table is written for the counter: every status, every filter, eight columns.
 * Somebody standing at a gate with a bag in one hand needs four things per order and
 * nothing else — who, where, how much, and the one button that moves it on — in buttons a
 * thumb can hit. Only delivery orders that are packed or on the road are here; anything
 * still being picked is a count, because it is not his yet.
 *
 * A staff login starts on "only mine": the owner's view of everybody's bags is the owner's.
 */
export default function DeliveryRun({ t, refreshKey, myId, hasTeam, isOwner, onAdvance, onBringBack, onOpenDetail }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tally, setTally] = useState(null);
  // Null until somebody picks: the staff list arrives after first paint, so the default
  // has to be worked out from it every render rather than frozen at mount.
  const [mineChoice, setMineOnly] = useState(null);
  const mineOnly = hasTeam && (mineChoice ?? !isOwner);
  const seq = useRef(0);

  useEffect(() => {
    const mine = seq.current + 1;
    seq.current = mine;
    apiFetch('/api/seller/orders?type=delivery&status=open&sort=oldest')
      .then((data) => {
        if (mine !== seq.current) return;
        setOrders(data.orders || []);
        setError('');
      })
      .catch((err) => mine === seq.current && setError(err.message))
      .finally(() => mine === seq.current && setLoading(false));
    // The evening count comes from its own endpoint: it is an aggregation over the day's
    // delivered orders, which the open-orders list by definition does not contain.
    apiFetch('/api/seller/orders/delivery-tally')
      .then((data) => mine === seq.current && setTally(data))
      .catch(() => {});
  }, [refreshKey]);

  const { out, toSend, packing } = useMemo(() => {
    const visible = orders.filter((o) => !mineOnly || !o.assignedTo || String(o.assignedTo) === myId);
    return {
      out: visible.filter((o) => o.status === 'dispatched'),
      // By the window that was promised, soonest first — a bag for the 6pm round has to
      // come off this list before one for tomorrow morning, whatever order they arrived in.
      // Orders with no window keep the list's own oldest-first order behind the timed ones.
      toSend: visible
        .filter((o) => o.status === 'ready')
        .sort((a, b) => (slotOf(a, t)?.startAt ?? Infinity) - (slotOf(b, t)?.startAt ?? Infinity)),
      packing: visible.filter((o) => o.status === 'received' || o.status === 'packed').length,
    };
  }, [orders, mineOnly, myId, t]);

  // What the bags on the road add up to — the money that should come back through the door.
  const onRoadValue = out.reduce((sum, o) => sum + payableOf(o), 0);

  function card(order) {
    const phone = dialable(order.contactPhone) || dialable(order.customer?.phone);
    const map = mapHref(order);
    const carrier = order.assignedToName
      ? (String(order.assignedTo) === myId ? t('seller.orderAssignedYou') : order.assignedToName)
      : '';
    return (
      <div className="delivery-card" key={order._id}>
        <div className="delivery-card-head">
          <button type="button" className="delivery-card-title" onClick={() => onOpenDetail(order)}>
            #{order.orderNumber} · {order.customer?.name || '—'}
          </button>
          <span className="delivery-card-amount">{t('seller.deliveryRunCollect', { amount: money(payableOf(order)) })}</span>
        </div>
        {order.address && (
          <p className="delivery-card-address">
            <MapPinIcon size={15} />
            <span>
              {order.address}
              {order.deliveryDistanceKm > 0 && <small> · {t('seller.orderDistance').replace('{km}', order.deliveryDistanceKm)}</small>}
              {Number.isFinite(order.deliveryPoint?.lat) && <small> · {t('seller.deliveryRunPin')}</small>}
            </span>
          </p>
        )}
        <p className="delivery-card-meta">
          {(() => {
            const slot = slotOf(order, t);
            if (!slot) return null;
            return (
              <span className={`delivery-card-slot${slot.late ? ' is-late' : slot.running ? ' is-now' : ''}`}>
                <ClockIcon size={13} /> {slot.text}
                {slot.late && ` · ${t('seller.orderSlotLate')}`}
                {!slot.late && slot.running && ` · ${t('seller.orderSlotNow')}`}
              </span>
            );
          })()}
          {t('seller.items')}: {order.items.length}
          {hasTeam && carrier && <span className="delivery-card-carrier">· <ScooterIcon size={13} /> {carrier}</span>}
          {order.note && <span className="delivery-card-note">{t('seller.orderNote')}: {order.note}</span>}
        </p>
        <div className="delivery-card-actions">
          {phone && (
            <a className="btn btn-secondary btn-small btn-inline" href={`tel:+91${phone}`}>
              <PhoneIcon size={15} /> {t('seller.deliveryRunCall')}
            </a>
          )}
          {map && (
            <a className="btn btn-secondary btn-small btn-inline" href={map} target="_blank" rel="noopener noreferrer">
              <MapPinIcon size={15} /> {t('seller.orderOpenMap')}
            </a>
          )}
          {phone && (
            <a className="btn btn-secondary btn-small btn-inline" href={`https://wa.me/91${phone}`} target="_blank" rel="noopener noreferrer">
              <WhatsappIcon size={15} />
            </a>
          )}
          <button type="button" className="icon-btn" data-tip={t('seller.orderDetails')} onClick={() => onOpenDetail(order)}>
            <ListIcon size={17} />
          </button>
        </div>
        <div className="delivery-card-main">
          {order.status === 'ready' ? (
            <button type="button" className="btn btn-primary btn-inline" onClick={() => onAdvance(order)}>
              <ScooterIcon size={17} /> {t('seller.orderSendOut')}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-primary btn-inline" onClick={() => onAdvance(order)}>
                <CheckCircleIcon size={17} /> {t('seller.orderDelivered')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => onBringBack(order)}>
                <UndoIcon size={17} /> {t('seller.orderBroughtBack')}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  /**
   * "Pappu, aaj kitna cash laya?"
   *
   * One line per person: what they handed over, split by how it was paid, because only the
   * cash column is money that has to physically come back into the box. UPI already landed
   * in the account and khata is not coming back at all — a single total would have the
   * shopkeeper looking for notes that were never taken.
   */
  function tallyStrip() {
    const rows = tally?.rows || [];
    const totals = tally?.totals;
    if (!rows.length) {
      return (
        <div className="delivery-tally">
          <h3>{t('seller.deliveryTallyTitle')}</h3>
          <p className="field-hint">{t('seller.deliveryTallyEmpty')}</p>
        </div>
      );
    }
    const line = (row, key, isTotal) => (
      <div className={`delivery-tally-row${isTotal ? ' is-total' : ''}`} key={key}>
        <span className="delivery-tally-who">
          {isTotal
            ? t('seller.deliveryTallyEveryone')
            : row.id && row.id === myId
              ? t('seller.deliveryTallySelf')
              : row.name || t('seller.orderUnassigned')}
        </span>
        <span className="delivery-tally-count">{t('seller.deliveryTallyCount', { n: row.count })}</span>
        <span className="delivery-tally-cash">{t('seller.deliveryTallyCash', { amount: money(row.cash) })}</span>
        {row.upi > 0 && <span>{t('seller.deliveryTallyUpi', { amount: money(row.upi) })}</span>}
        {row.khata > 0 && <span>{t('seller.deliveryTallyKhata', { amount: money(row.khata) })}</span>}
        {row.outCount > 0 && (
          <span className="delivery-tally-out">
            {t('seller.deliveryTallyOut', { n: row.outCount, amount: money(row.outValue) })}
          </span>
        )}
      </div>
    );
    return (
      <div className="delivery-tally">
        <h3>{t('seller.deliveryTallyTitle')}</h3>
        {rows.map((row, i) => line(row, row.id || `none-${i}`, false))}
        {rows.length > 1 && totals && line(totals, 'all', true)}
        <p className="field-hint">{t('seller.deliveryTallyCashHint')}</p>
      </div>
    );
  }

  return (
    <div className="data-panel delivery-run">
      <div className="data-filters delivery-run-bar">
        <p className="field-hint">{t('seller.deliveryRunHint')}</p>
        {hasTeam && (
          <div className="segmented" role="group">
            <button type="button" className={mineOnly ? 'active' : ''} onClick={() => setMineOnly(true)}>
              {t('seller.deliveryRunMine')}
            </button>
            <button type="button" className={!mineOnly ? 'active' : ''} onClick={() => setMineOnly(false)}>
              {t('seller.deliveryRunEveryone')}
            </button>
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {tally && tallyStrip()}

      {loading && orders.length === 0 ? (
        <p className="field-hint delivery-run-note">{t('common.loading')}</p>
      ) : out.length === 0 && toSend.length === 0 ? (
        <div className="empty-state-rich">
          <Illustration scene="parcel" />
          <p>{t('seller.deliveryRunEmpty')}</p>
          {packing > 0 && <p className="field-hint">{t('seller.deliveryRunPacking', { n: packing })}</p>}
        </div>
      ) : (
        <div className="delivery-run-body">
          {out.length > 0 && (
            <section className="delivery-run-group">
              <h3>
                {t('seller.deliveryRunOut')} <span className="chip-count">{out.length}</span>
                <small>{money(onRoadValue)}</small>
              </h3>
              {out.map(card)}
            </section>
          )}
          {toSend.length > 0 && (
            <section className="delivery-run-group">
              <h3>
                {t('seller.deliveryRunToSend')} <span className="chip-count">{toSend.length}</span>
              </h3>
              {toSend.map(card)}
            </section>
          )}
          {packing > 0 && <p className="field-hint delivery-run-note">{t('seller.deliveryRunPacking', { n: packing })}</p>}
        </div>
      )}
    </div>
  );
}
