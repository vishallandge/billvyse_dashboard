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
        <div className="kt-title">{t ? t('tables.kot') : 'KOT'} #{kot.number}</div>
        {shop?.shopName && <div className="kt-line">{shop.shopName}</div>}
      </div>

      <div className="kt-rule" />

      <div className="kt-meta">
        <span>{order.tableName}</span>
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
          <div className="kt-item" key={index}>
            <span className="kt-qty">{item.quantity}×</span>
            <div className="kt-name">
              <div className="kt-item-name">{item.name}</div>
              {item.note && <div className="kt-item-note">{item.note}</div>}
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
