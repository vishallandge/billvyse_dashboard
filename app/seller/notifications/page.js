'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { notificationHeadline } from '../../../lib/notifications';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { SkeletonCards } from '../../components/Skeleton';
import Dropdown from '../../components/Dropdown';
import PushSettings from '../../components/PushSettings';
import {
  AlertIcon, ClockIcon, InfoIcon, ChevronRightIcon, CheckIcon,
  ReceiptIcon, LedgerIcon, PackageIcon, OrdersIcon, CalendarIcon, ShieldIcon, WalletIcon,
} from '../../components/Icons';
import { recordHref } from '../../../lib/routeId';

const TONE_ICONS = { urgent: AlertIcon, warn: ClockIcon, info: InfoIcon };

// Which icon best represents each category's *subject*, separate from the tone icon that
// already carries urgency — a shopkeeper scanning the page recognises "khata" or "stock"
// by shape before they've read a word.
const CATEGORY_ICONS = {
  unbilledAppointments: ReceiptIcon,
  coldEstimates: ReceiptIcon,
  paymentClaims: LedgerIcon,
  promisesDue: LedgerIcon,
  khataDue: LedgerIcon,
  lowStock: PackageIcon,
  pendingOrders: OrdersIcon,
  unconfirmedSoon: CalendarIcon,
  expiringSoon: PackageIcon,
  expired: PackageIcon,
  backupReminder: ShieldIcon,
  staffPagaarDue: WalletIcon,
};

export default function NotificationsPage() {
  const { t } = useLanguage();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmingId, setConfirmingId] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dateRange, setDateRange] = useState('this_month');

  // Use a safe translator that falls back to a provided label when the i18n
  // function returns the key itself (missing translation).
  function safeT(key, fallback) {
    try {
      const out = t(key);
      // If the translator returns the key unchanged, treat as missing.
      if (!out || out === key) return fallback;
      return out;
    } catch (e) {
      return fallback;
    }
  }

  function load() {
    setLoading(true);
    apiFetch('/api/seller/notifications')
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function confirmClaim(id) {
    setConfirmingId(id);
    try {
      await apiFetch(`/api/seller/khata/claims/${id}/confirm`, { method: 'POST' });
      toast.success(t('notifications.claimConfirmed'));
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setConfirmingId(null);
    }
  }

  async function markRead(keys) {
    try {
      const payload = Array.isArray(keys) ? keys : [keys];
      const resp = await apiFetch('/api/seller/notifications/read', { method: 'POST', body: JSON.stringify({ keys: payload }) });
      // server returns updated readKeys/unreadCount — refresh local data accordingly
      setData((prev) => ({ ...(prev || {}), readKeys: resp.readKeys || [], unreadCount: resp.unreadCount ?? prev?.unreadCount }));
      try {
        window.dispatchEvent(new CustomEvent('dukaan:notificationsChanged'));
      } catch (e) {
        // ignore (server-side render or older browsers)
      }
      // optional: refresh full data to get any backend-derived changes
      // load();
    } catch (err) {
      toast.error(err.message || 'Failed to mark read');
    }
  }

  function filterFeed(feed) {
    if (!feed) return [];
    let out = feed;
    if (categoryFilter && categoryFilter !== 'all') {
      out = out.filter((f) => f.category === categoryFilter);
    }
    // dateRange currently client-side only (placeholder for future server filter)
    return out;
  }

  // Per-category detail rows — the specific customers/products behind the headline, each
  // still a click straight to where it's handled. Payment claims also get a real inline
  // action: confirming one shouldn't require leaving this page to find it again on Khata.
  function renderDetails(item) {
    switch (item.key) {
      case 'khataDue':
        return data.khataDue.map((c) => (
          <Link key={c.id} href={recordHref('/seller/khata/[id]', c.id)} className="notif-detail-row">
            <span>{c.name}</span>
            <span className="notif-detail-meta">₹{c.balance} · {c.daysSince} {t('notifications.daysOverdue')}</span>
          </Link>
        ));
      // Which quotes have gone cold, and how stale each one is — the list a shopkeeper
      // works down with the phone in his hand.
      case 'coldEstimates':
        return (data.coldEstimates || []).map((row) => (
          <Link key={row.id} href="/seller/estimates" className="notif-detail-row">
            <span>{row.name || `#${row.number}`}</span>
            <span className="notif-detail-meta">
              ₹{row.amount} · {row.daysOld} {t('notifications.daysOverdue')}
            </span>
          </Link>
        ));
      case 'promisesDue':
        return data.promisesDue.map((c) => (
          <Link key={c.id} href={recordHref('/seller/khata/[id]', c.id)} className="notif-detail-row">
            <span>{c.name}</span>
            <span className="notif-detail-meta">₹{c.balance} · {new Date(c.promiseToPayDate).toLocaleDateString()}</span>
          </Link>
        ));
      case 'paymentClaims':
        return data.paymentClaims.map((claim) => (
          <div key={claim._id} className="notif-detail-row">
            <span>{claim.customer?.name || t('seller.unknownCustomer')}</span>
            <span className="notif-detail-meta">
              ₹{claim.amount}
              {claim.utr && <> · <code className="claim-utr-inline">{claim.utr}</code></>}
            </span>
            <button
              type="button"
              className="btn btn-primary btn-small btn-inline"
              disabled={confirmingId === claim._id}
              onClick={() => confirmClaim(claim._id)}
            >
              <CheckIcon size={15} />
              {t('seller.confirmClaim')}
            </button>
          </div>
        ));
      case 'lowStock':
        return data.lowStock.map((p) => (
          <Link key={p._id} href="/seller/products?stock=refill" className="notif-detail-row">
            <span>{p.name}{data.multiStore && p.storeName ? ` — ${p.storeName}` : ''}</span>
            <span className="notif-detail-meta">{p.stock} {p.unit}</span>
          </Link>
        ));
      case 'expiringSoon':
        return data.expiringSoon.map((p) => (
          <Link key={p._id} href="/seller/products?expiry=expiring" className="notif-detail-row">
            <span>{p.name}</span>
            <span className="notif-detail-meta">{new Date(p.expiryDate).toLocaleDateString()}</span>
          </Link>
        ));
      case 'expired':
        return data.expired.map((p) => (
          <Link key={p._id} href="/seller/products?expiry=expired" className="notif-detail-row">
            <span>{p.name}</span>
            <span className="notif-detail-meta">{new Date(p.expiryDate).toLocaleDateString()}</span>
          </Link>
        ));
      case 'unbilledAppointments':
        return data.unbilledAppointments.map((a) => (
          <Link key={a._id} href="/seller/appointments" className="notif-detail-row">
            <span>{a.customerName || t('seller.unknownCustomer')}</span>
            <span className="notif-detail-meta">₹{a.estimatedTotal}</span>
          </Link>
        ));
      case 'unconfirmedSoon':
        return data.unconfirmedSoon.map((a) => (
          <Link key={a._id} href="/seller/appointments" className="notif-detail-row">
            <span>{a.customerName || t('seller.unknownCustomer')}</span>
            <span className="notif-detail-meta">{new Date(a.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </Link>
        ));
      default:
        return null;
    }
  }

  return (
    <>
      <div className="content-header">
        <h1>{t('nav.notifications')}</h1>
        <p>{t('notifications.pageSubtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* The one place a staff login can turn phone alerts on — Settings is owner-only, and
          the person actually standing at the counter when an online order lands is usually
          not the owner. Renders nothing once this device is already subscribed. */}
      <PushSettings compact />

      {/* Two hand-rolled inline flex rows used to live here, neither of which could wrap.
          On a 360px phone the four chips, the category dropdown and "Mark all read" ask for
          about 430px of a 336px screen, so the button simply hung off the right edge of the
          viewport — half a control, unreachable, on the screen whose entire job is telling
          the shopkeeper what needs doing.
          `.panel-head` + `.chip-row` + `.panel-tools` are the app's own three classes for
          exactly this shape and every one of them wraps. Written out rather than styled
          inline for the reason the form-layout rule already gives: an inline style cannot
          carry a breakpoint, so it is a layout that can only ever be right at one width. */}
      <div className="panel-head notif-toolbar">
        <div className="chip-row">
          <button type="button" className={`chip ${dateRange === 'today' ? 'active' : ''}`} onClick={() => setDateRange('today')}>{safeT('date.today', 'Today')}</button>
          <button type="button" className={`chip ${dateRange === '7_days' ? 'active' : ''}`} onClick={() => setDateRange('7_days')}>{safeT('date.7_days', '7 days')}</button>
          <button type="button" className={`chip ${dateRange === 'this_month' ? 'active' : ''}`} onClick={() => setDateRange('this_month')}>{safeT('date.this_month', 'This month')}</button>
          <button type="button" className={`chip ${dateRange === 'all' ? 'active' : ''}`} onClick={() => setDateRange('all')}>{safeT('date.all', 'All time')}</button>
        </div>
        <div className="panel-tools">
          <Dropdown
            value={categoryFilter}
            onChange={setCategoryFilter}
            className="notif-category-filter"
            options={[
              { value: 'all', label: 'All' },
              { value: 'billing', label: 'Billing' },
              { value: 'inventory', label: 'Inventory' },
              { value: 'khata', label: 'Khata' },
              { value: 'appointments', label: 'Appointments' },
              { value: 'backup', label: 'Backup' },
              { value: 'staff', label: 'Staff' },
            ]}
          />
          <button type="button" className="btn btn-secondary btn-small" onClick={() => markRead((data?.feed || []).map((i) => i.key))}>{safeT('notifications.markAllRead', 'Mark all read')}</button>
        </div>
      </div>

      {loading ? (
        <SkeletonCards count={3} height={90} />
      ) : !data?.feed?.length ? (
        <div className="empty-state-rich">
          <div className="empty-icon"><CheckIcon size={26} /></div>
          <p>{t('notifications.empty')}</p>
        </div>
      ) : (
        <div className="notif-feed-list">
          {filterFeed(data.feed).map((item) => {
            const ToneIcon = TONE_ICONS[item.tone] || InfoIcon;
            const CategoryIcon = CATEGORY_ICONS[item.key] || InfoIcon;
            return (
              <div key={item.key} className={`notif-feed-card notif-tone-${item.tone} ${item.isRead ? 'read' : 'unread'}`}>
                <div className="notif-feed-head">
                  <span className="notif-feed-icon"><CategoryIcon size={18} /></span>
                  <p className="notif-feed-headline">{notificationHeadline(t, item)}</p>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    {!item.isRead && (
                      <button type="button" className="btn btn-link btn-small" onClick={() => markRead(item.key)}>{safeT('notifications.markRead', 'Mark read')}</button>
                    )}
                  </div>
                  <span className={`notif-feed-tone-icon notif-tone-${item.tone}`}><ToneIcon size={15} /></span>
                </div>
                {item.key !== 'backupReminder' && item.key !== 'pendingOrders' && (
                  <div className="notif-feed-details">{renderDetails(item)}</div>
                )}
                {(item.key === 'backupReminder' || item.key === 'pendingOrders') && (
                  <Link href={item.href} className="notif-detail-row">
                    <span>{t('seller.viewDetails')}</span>
                    <ChevronRightIcon size={15} />
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
