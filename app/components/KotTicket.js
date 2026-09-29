'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// The kitchen's actual copy of a KOT — same portal + `printing-kot` body-class + @media
// print mechanism as ThermalReceipt.js, because a kitchen without a screen still needs a
// slip of paper in hand. No prices: the kitchen cooks off names, quantities and notes, and
// a price on that slip is one more thing that could leak to the wrong side of the counter.

export default function KotTicket({ kot, order, shop, t }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!kot || !order || !mounted) return null;

  const date = new Date(kot.sentAt || Date.now());

  return createPortal(
    <div className="kot-ticket" aria-hidden="true">
      <div className="kt-head">
        {/* A correction slip says so in the biggest type on the paper — a cook who reads it
            as a fresh order makes the dish twice. */}
        <div className="kt-title">
          {kot.amended ? (t ? t('tables.change.slipTitle') : 'KOT CORRECTION') : (t ? t('tables.kot') : 'KOT')}
          {kot.number != null ? ` #${kot.number}` : ''}
        </div>
        {shop?.shopName && <div className="kt-line">{shop.shopName}</div>}
      </div>

      <div className="kt-rule" />

      <div className="kt-meta">
        <span>{order.tableLabel || order.tableName}</span>
        <span>
          {date.toLocaleDateString('en-IN')} · {date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {order.guestCount > 0 && (
        <div className="kt-meta">
          <span>{t ? t('tables.guests') : 'Guests'}</span>
          <span>{order.guestCount}</span>
        </div>
      )}

      <div className="kt-rule kt-dashed" />

      <div className="kt-items">
        {(kot.items || []).map((item, index) => (
          <div className={`kt-item${item.cancelled ? ' is-cancelled' : ''}`} key={index}>
            <span className="kt-qty">
              {item.cancelled ? '✕' : item.prevQuantity != null ? `${item.prevQuantity}→${item.quantity}` : `${item.quantity}×`}
            </span>
            <div className="kt-name">
              <div className="kt-item-name">
                {item.cancelled && <strong>{t ? t('tables.change.slipCancel') : 'CANCEL'} </strong>}
                {/* Which chair it is for, first — whoever carries it out reads this before the dish. */}
                {item.seat || item.seats?.length ? (
                  <strong className="kt-seat">[{t ? t('tables.seat.slip', { seat: item.seats?.length ? item.seats.join('+') : item.seat }) : `S${item.seats?.length ? item.seats.join('+') : item.seat}`}] </strong>
                ) : null}
                {item.name}
              </div>
              {item.note && (
                <div className="kt-item-note">
                  {item.noteChanged && <strong>{t ? t('tables.change.slipNewNote') : 'NEW NOTE'}: </strong>}
                  {item.note}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="kt-rule kt-dashed" />
      <div className="kt-foot">Powered by BillVyse</div>
    </div>,
    document.body
  );
}
