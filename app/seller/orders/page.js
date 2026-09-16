'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { getShopSocket } from '../../../lib/socket';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { useConfirm } from '../../components/ConfirmDialog';
import { useDashboardUser } from '../../components/DashboardShell';
import {
  OrdersIcon, XIcon, RupeeIcon, WalletIcon, CreditCardIcon, LedgerIcon, PlusIcon, EditIcon, TrashIcon, RefreshIcon, CopyIcon,
  CheckCircleIcon, ReceiptIcon, ClockIcon, ScooterIcon, BagIcon,
} from '../../components/Icons';
import RowMenu from '../../components/RowMenu';
import { SkeletonTable } from '../../components/Skeleton';
import { Pagination, usePagination } from '../../components/Pagination';
import Dropdown from '../../components/Dropdown';
import CustomerQuickAdd from '../../components/CustomerQuickAdd';
import Modal from '../../components/Modal';
import { recordHref } from '../../../lib/routeId';

const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';

function emptyStandingForm() {
  return { customerId: '', items: [{ productId: '', quantity: '' }], notes: '' };
}

const NEXT_STATUS = {
  received: 'packed',
  packed: 'ready',
  ready: 'delivered',
};

// "Pack it", "Ready", "Delivered" — the word for whatever this order's next stage is.
// It used to be built inline at each call site; now that the word is a tooltip rather
// than a label it is needed in more than one place, and it must be the same word in all
// of them.
function nextStageLabel(order, t) {
  const next = NEXT_STATUS[order.status];
  if (!next) return '';
  return t(`seller.order${next.charAt(0).toUpperCase()}${next.slice(1)}`);
}

const STATUS_BADGE = {
  received: 'badge-pending',
  packed: 'badge-expiring',
  ready: 'badge-active',
  delivered: 'badge-active',
  rejected: 'badge-inactive',
};

export default function OrdersPage() {
  const { t } = useLanguage();
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
  const [justBilled, setJustBilled] = useState(null);
  const [rejectingOrder, setRejectingOrder] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const page = usePagination(orders, { pageSize: 25, resetKey: statusFilter });

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

  function load() {
    setLoading(true);
    apiFetch(`/api/seller/orders${statusFilter ? `?status=${statusFilter}` : ''}`)
      .then((data) => setOrders(data.orders))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [statusFilter]);

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

  async function advance(order, paymentMode) {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    // Handing the goods over is the moment the sale becomes money, so delivery needs to
    // say how it was paid — that is what turns the order into a real bill in the day
    // book, the reports and GST. Every other step is just a status change.
    if (next === 'delivered' && !paymentMode) {
      setDeliveringOrder(order);
      return;
    }
    try {
      const data = await apiFetch(`/api/seller/orders/${order._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next, paymentMode }),
      });
      setDeliveringOrder(null);
      if (data.bill) setJustBilled(data.bill);
      load();
    } catch (err) {
      setError(err.message);
      setDeliveringOrder(null);
    }
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

      <div className="segmented" role="group" style={{ marginBottom: '0.9rem', maxWidth: '360px' }}>
        <button type="button" className={view === 'orders' ? 'active' : ''} onClick={() => setView('orders')}>
          {t('nav.orders')}
        </button>
        <button type="button" className={view === 'standing' ? 'active' : ''} onClick={() => setView('standing')}>
          <RefreshIcon size={14} /> {t('seller.standingOrders')}
        </button>
      </div>

      {view === 'orders' && (
      <div className="data-panel">
        <div className="data-filters">
          <div className="chip-row">
            {[
              ['', t('seller.all')],
              ['received', t('seller.orderReceived')],
              ['packed', t('seller.orderPacked')],
              ['ready', t('seller.orderReady')],
              ['delivered', t('seller.orderDelivered')],
              ['rejected', t('seller.orderRejected')],
            ].map(([value, label]) => (
              <button
                key={value || 'all'}
                type="button"
                className={`chip chip-sm${statusFilter === value ? ' active' : ''}`}
                onClick={() => setStatusFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="data-panel-body"><SkeletonTable rows={6} cols={6} /></div>
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
              <table className="data-table sticky-actions" style={{ minWidth: '820px' }}>
                <thead>
                  <tr>
                    <th className="tight">#</th>
                    <th>{t('common.name')}</th>
                    <th>{t('seller.items')}</th>
                    <th className="num">{t('seller.total')}</th>
                    <th>{t('common.status')}</th>
                    <th className="tight" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.pageItems.map((order) => (
                    <tr
                      key={order._id}
                      className={freshIds.has(String(order._id)) ? 'moment-arrive moment-new-flag' : undefined}
                    >
                      <td className="tight cell-strong">{order.orderNumber}</td>
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
                            {order.fulfillmentType === 'delivery' && order.address && (
                              <span>{t('seller.orderAddress')}: {order.address}</span>
                            )}
                            {order.note && <span>{t('seller.orderNote')}: {order.note}</span>}
                          </span>
                        </div>
                      </td>
                      <td className="num cell-strong">₹{order.totalAmount}</td>
                      <td>
                        <div className="cell-stack">
                          <span className={`badge ${STATUS_BADGE[order.status] || 'badge-pending'}`}>
                            {t(`seller.order${order.status.charAt(0).toUpperCase()}${order.status.slice(1)}`)}
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
                          {NEXT_STATUS[order.status] && (
                            <button
                              type="button"
                              className="icon-btn primary"
                              data-tip={nextStageLabel(order, t)}
                              onClick={() => advance(order)}
                            >
                              <CheckCircleIcon size={17} />
                            </button>
                          )}
                          {order.bill && (
                            <Link href={recordHref('/seller/invoice/[id]', order.bill)} className="icon-btn" data-tip={t('seller.invoiceAction')}>
                              <ReceiptIcon size={17} />
                            </Link>
                          )}
                          <RowMenu
                            items={[
                              {
                                label: t('common.cancel'),
                                icon: <XIcon size={15} />,
                                danger: true,
                                hidden: !NEXT_STATUS[order.status],
                                onClick: () => setRejectingOrder(order),
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
                      <span className="record-card-price">₹{order.totalAmount}</span>
                    </div>
                    <span className="cell-sub order-items-line">
                      {order.items.map((i) => `${i.name} x${i.quantity}`).join(', ')}
                    </span>
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
                      {NEXT_STATUS[order.status] && (
                        <button className="btn btn-secondary btn-small btn-inline" onClick={() => advance(order)}>
                          {nextStageLabel(order, t)}
                        </button>
                      )}
                      {NEXT_STATUS[order.status] && (
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
            <div className="segmented" role="group" style={{ marginBottom: '0.9rem' }}>
              {[
                { id: 'cash', label: t('seller.cash'), icon: RupeeIcon },
                { id: 'upi', label: t('seller.upi'), icon: WalletIcon },
                { id: 'card', label: t('seller.card'), icon: CreditCardIcon },
                { id: 'khata', label: t('nav.khata'), icon: LedgerIcon },
              ].map(({ id, label, icon: ModeIcon }) => (
                <button key={id} type="button" onClick={() => advance(deliveringOrder, id)}>
                  <ModeIcon size={15} /> {label}
                </button>
              ))}
            </div>
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
