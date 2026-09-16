'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatRupees, formatDate } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import InvoiceAttachments from '../../components/InvoiceAttachments';
import SupplyBillBuilder from './SupplyBillBuilder';
import { TruckIcon, CheckCircleIcon, AlertIcon, ClipboardIcon, PrinterIcon } from '../../components/Icons';
import Modal from '../../components/Modal';
import { recordHref } from '../../../lib/routeId';

/**
 * One order a shop has sent him, and everything he can do about it.
 *
 * Three things in the order he needs them: what was ordered, his answer, his paperwork. The
 * same three the portal offers, because this screen is not a preview of that one — it is
 * meant to replace it for anyone who already has a login here.
 */

/**
 * Module-level, not built inline in the render.
 *
 * `InvoiceAttachments` memoises its preview loader on this object, so a fresh one per render
 * would re-fetch every thumbnail on every keystroke elsewhere in the modal.
 */
const SUPPLY_PATHS = {
  list: (orderId) => `/api/seller/supply/orders/${orderId}/attachments`,
  // His own bill, not "an attachment" — a different verb on this side of the order, which is
  // why the path is passed in rather than derived.
  upload: (orderId) => `/api/seller/supply/orders/${orderId}/invoice`,
  file: (orderId, fileId) => `/api/seller/supply/orders/${orderId}/attachments/${fileId}`,
};

export default function SupplyOrderModal({ orderId, onClose, onChanged }) {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('view');
  const load = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/seller/supply/orders/${orderId}`);
      setOrder(data.order);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function respond(state) {
    setBusy(true);
    try {
      await apiFetch(`/api/seller/supply/orders/${orderId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ state, note: note.trim() || undefined }),
      });
      toast.success(t('supply.answerSent'));
      setNote('');
      await load();
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  // `ordered` is the whole window: before it there is nothing to answer, and once the shop
  // marks the goods received, stock has moved and the ledger is written against the shop's
  // own figures — a bill that could still change underneath that would be a claim rewriting
  // settled history.
  const canAnswer = order?.status === 'ordered';

  /**
   * Rendered into `document.body`, never in place.
   *
   * This is not tidiness — it is the fix for a real bug. `.panel` carries
   * `animation: fadeInUp ... both`, and `both` leaves the final `transform: translateY(0)`
   * on the element forever. A transform of any value makes that element the containing block
   * for every `position: fixed` descendant, so the overlay stopped being "the viewport" and
   * became "inside this panel": a half-height grey box with the dialog sliced off at its
   * bottom edge and the page's own scrollbar running through it.
   *
   * Every other dialog in this app already portals for the same reason — ConfirmDialog,
   * Dropdown, DateRangeFilter. Nothing rendered inside a panel may position itself against
   * the viewport.
   */
  const modal = (
    <Modal
      className="supply-modal"
      onClose={onClose}
      title={order ? order.shopName : t('common.loading')}
      hint={
        order
          ? `${order.label}${order.expectedAt ? ` · ${t('supply.wantedBy')} ${formatDate(order.expectedAt, lang)}` : ''}`
          : undefined
      }
      headerActions={
        /* The sheet he carries to the godown, on the app's own invoice paper. This used to
           fetch a server-drawn PDF; it now opens the print page, which renders
           `PurchaseOrderDocument` — the same document the shop prints from its side of this
           order. A new tab rather than a route change, because this modal is a place he is
           in the middle of something (an answer half typed, a bill half built) and printing
           must not take that away. */
        order ? (
          <a
            className="btn btn-secondary btn-small btn-inline"
            href={recordHref('/seller/supply/[id]/order', order.id)}
            target="_blank"
            rel="noopener"
          >
            <PrinterIcon size={15} /> {t('supply.orderPdf')}
          </a>
        ) : null
      }
    >

        {error ? (
          <p className="empty-state">{error}</p>
        ) : !order ? (
          <p className="empty-state">{t('common.loading')}</p>
        ) : mode === 'bill' ? (
          <SupplyBillBuilder
            order={order}
            onClose={() => setMode('view')}
            onSaved={async () => {
              setMode('view');
              await load();
              onChanged();
            }}
          />
        ) : (
          <>
            <div className="detail-grid">
              <div>
                <span>{t('supply.orderValue')}</span>
                <strong>{formatRupees(order.total, lang)}</strong>
              </div>
              {/* Only once the goods have actually been delivered. An order still sitting in
                  the godown showed "Still unpaid ₹260" beside "Owed to you ₹0" — two numbers
                  about the same money, disagreeing, because nothing is owed until it is
                  received. The ledger was right and this line was the lie. */}
              {order.status === 'received' && order.pending > 0 && (
                <div>
                  <span>{t('supply.unpaidAmount')}</span>
                  <strong>{formatRupees(order.pending, lang)}</strong>
                </div>
              )}
              {order.shopPhone && (
                <div>
                  <span>{t('supply.shopPhone')}</span>
                  <strong>{order.shopPhone}</strong>
                </div>
              )}
              {order.shopGstin && (
                <div>
                  <span>{t('supply.shopGstin')}</span>
                  <strong>{order.shopGstin}</strong>
                </div>
              )}
            </div>
            {order.shopAddress && <p className="field-hint">{order.shopAddress}</p>}

            <div className="data-panel">
            <div className="table-wrap auto-height">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('supply.item')}</th>
                    <th className="num">{t('supply.qty')}</th>
                    <th className="num">{t('supply.rate')}</th>
                    <th className="num">{t('seller.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(order.items || []).map((item, index) => (
                    <tr key={index}>
                      <td>
                        {item.name}
                        {item.batchNumber && <div className="cell-sub">{item.batchNumber}</div>}
                      </td>
                      <td className="num">
                        {item.quantity} {item.unit || ''}
                        {/* The single most-read line on an order that carried a scheme. */}
                        {item.freeQuantity > 0 && <div className="cell-sub">+{item.freeQuantity} {t('supply.free')}</div>}
                      </td>
                      <td className="num">{formatRupees(item.costPrice, lang)}</td>
                      <td className="num">{formatRupees(item.lineTotal, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>

            {order.notes && (
              <p className="field-hint" style={{ marginBottom: '0.7rem' }}>
                {t('supply.shopNote')}: {order.notes}
              </p>
            )}

            {canAnswer ? (
              <>
                <label className="field" >
                  <span className="field-label">{t('supply.noteLabel')}</span>
                  <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
                </label>
                <div className="row-actions">
                  <button className="btn btn-primary btn-small btn-inline" disabled={busy} onClick={() => respond('dispatched')}>
                    <TruckIcon size={15} /> {t('supply.actDispatched')}
                  </button>
                  <button className="btn btn-secondary btn-small btn-inline" disabled={busy} onClick={() => respond('accepted')}>
                    <CheckCircleIcon size={15} /> {t('supply.actAccepted')}
                  </button>
                  <button className="btn btn-danger btn-small btn-inline" disabled={busy} onClick={() => respond('rejected')}>
                    <AlertIcon size={15} /> {t('supply.actRejected')}
                  </button>
                </div>
              </>
            ) : (
              <p className="field-hint">{t('supply.answerLocked')}</p>
            )}

            <SupplyPayments order={order} onChanged={load} t={t} lang={lang} toast={toast} confirm={confirm} />

            <div className="panel-head" style={{ marginTop: '1rem' }}>
              <h2>{t('supply.yourBill')}</h2>
              {order.bill?.submittedAt && (
                <span className="cell-sub">{t('supply.billSentOn', { date: formatDate(order.bill.submittedAt, lang) })}</span>
              )}
            </div>
            {order.bill?.submittedAt ? (
              <div className="supply-billsummary">
                <div>
                  <span className="cell-strong">{t('supply.billNo', { number: order.bill.number })}</span>
                  <span className="cell-sub">{formatRupees(order.bill.totalAmount, lang)}</span>
                </div>
                <button
                  className="btn btn-secondary btn-small btn-inline"
                  disabled={!canAnswer}
                  data-tip={canAnswer ? undefined : t('supply.billLocked')}
                  onClick={() => setMode('bill')}
                >
                  {t('supply.billEdit')}
                </button>
              </div>
            ) : canAnswer ? (
              // The bill, then the photo — in that order, because a made bill is the better
              // document and a wholesaler offered both will take the first one.
              <button className="btn btn-primary btn-small btn-inline" onClick={() => setMode('bill')}>
                <ClipboardIcon size={15} /> {t('supply.billMake')}
              </button>
            ) : (
              <p className="field-hint">{t('supply.billLocked')}</p>
            )}

            <InvoiceAttachments
              orderId={order.id}
              attachments={order.attachments || []}
              onChange={async () => {
                await load();
                onChanged();
              }}
              canEdit={canAnswer}
              paths={SUPPLY_PATHS}
              title={t('supply.filesTitle')}
              emptyText={t('supply.filesNone')}
            />
          </>
        )}
    </Modal>
  );

  return modal;
}

/**
 * "Dukaandaar ne paisa bhej diya" — what the shop says it has paid, and his answer to it.
 *
 * He could always watch the outstanding figure fall and never see why. The entries were in
 * the shop's cash book, which he cannot reach, so "₹260 kam kyun hai" was a phone call.
 *
 * The two buttons write one field and move no money — see the controller. Nothing here
 * settles a balance; a payment he has not got round to confirming is still a payment, and a
 * ledger that waited for his tap would be wrong for every day he did not open the app. What
 * they buy is a record: three months later, when one side says "maine to bhej diya tha",
 * there is a date and a name instead of two memories.
 */
function SupplyPayments({ order, onChanged, t, lang, toast, confirm }) {
  const [busyId, setBusyId] = useState('');
  const payments = order.payments || [];
  if (payments.length === 0) return null;

  /**
   * Both answers go through the app's own dialog, and both are worth asking twice.
   *
   * "Mil gaya" is a statement the shopkeeper will read and settle his books against, and
   * there is no way to take it back — so the dialog puts the amount, the date and the mode
   * on their own rows first. Tapping the wrong row in a list of four payments is the whole
   * risk, and a list is exactly where that mis-tap happens.
   *
   * "Nahi mila" carries the note, which is the one thing that makes it actionable: "nahi
   * mila" alone tells the shopkeeper nothing about where to look. `useConfirm` collects it
   * — never `window.prompt`, which cannot show the ₹ amount it is about, cannot be
   * validated, and announces to a shopkeeper's customers that this is a web page.
   */
  async function answer(payment, state) {
    const facts = [
      { label: t('seller.amount'), value: formatRupees(payment.amount, lang), tone: state === 'received' ? 'success' : 'danger' },
      { label: t('expenses.modeLabel'), value: t(`supply.payMode.${payment.mode}`) },
      { label: t('expenses.date'), value: formatDate(payment.date, lang) },
    ];

    const answered = await confirm(
      state === 'received'
        ? {
            tone: 'success',
            title: t('supply.payGotTitle'),
            body: t('supply.payGotBody'),
            details: facts,
            confirmLabel: t('supply.payGot'),
          }
        : {
            tone: 'warning',
            title: t('supply.payNotGotTitle'),
            body: t('supply.payNotGotBody'),
            details: facts,
            input: {
              label: t('supply.payNotGotAsk'),
              placeholder: t('supply.payNotGotPh'),
              hint: t('supply.payNotGotHint'),
            },
            confirmLabel: t('supply.payNotGotSend'),
          }
    );
    if (!answered) return;

    setBusyId(payment.id);
    try {
      await apiFetch(`/api/seller/supply/orders/${order.id}/payments/${payment.id}/ack`, {
        method: 'POST',
        body: JSON.stringify({ state, note: answered.value?.trim() || undefined }),
      });
      toast.success(state === 'received' ? t('supply.payThanks') : t('supply.payFlagged'));
      await onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <>
      <div className="panel-head" style={{ marginTop: '1rem' }}>
        <h2>{t('supply.payTitle')}</h2>
        <span className="cell-sub">{t('supply.payHint')}</span>
      </div>

      <div className="record-cards supply-paylist">
        {payments.map((payment) => (
          <div className="record-card" key={payment.id}>
            <div className="record-card-main">
              <span className="record-card-title">
                {formatRupees(payment.amount, lang)} · {t(`supply.payMode.${payment.mode}`)}
              </span>
              <div className="record-card-meta">
                <span>{formatDate(payment.date, lang)}</span>
                {payment.by && <span>{payment.by}</span>}
                {/* The UTR, given its own chip rather than buried in the note: it is the one
                    thing on this row he can act on — search his own statement for it. */}
                {payment.reference && <span className="badge">{payment.reference}</span>}
                {payment.note && <span>{payment.note}</span>}
              </div>

              {/**
               * The whole exchange, oldest first, and always — his answer stays on screen
               * when the turn comes back to him.
               *
               * The first version hid it the moment the shop replied, which is precisely
               * when it matters: he is being asked to look again at something he has
               * already said no to, and a screen that quietly drops what he said is a
               * screen he has to reconstruct from memory. Both lines are sentences rather
               * than badges — `.badge` is a capitalised pill that stretches to this
               * column's width, and a settled note painted as a full-width bar reads as an
               * alert about something new. The colour still carries the answer.
               */}
              {payment.ack && (
                <span className={`cell-sub ${payment.ack.state === 'received' ? 'amount-in' : 'amount-out'}`}>
                  {payment.ack.state === 'received'
                    ? t('supply.payGotOn', { date: formatDate(payment.ack.at, lang) })
                    : t('supply.payNotGotOn', { date: formatDate(payment.ack.at, lang) })}
                  {payment.ack.note ? ` · ${payment.ack.note}` : ''}
                </span>
              )}
              {payment.shopReply && (
                <span className="cell-sub">
                  {t('supply.payShopReplied', { date: formatDate(payment.shopReply.at, lang) })}
                  {payment.shopReply.note ? ` · ${payment.shopReply.note}` : ''}
                </span>
              )}

              {/**
               * Always both buttons. Never gated on a flag.
               *
               * They were hidden unless the server said it was his turn, and a payment whose
               * `needsSupplier` was missing — every one recorded before that field existed —
               * therefore offered him nothing at all. Worse, it made the commonest thing that
               * actually happens impossible: a wholesaler who finds the money in his bank two
               * days after saying he had not, and cannot say so, leaves a cleared payment red
               * on both screens forever.
               *
               * So the answer is always changeable, by design and not by accident. The flags
               * still exist — they drive the badge counts, which is a question about
               * attention. Whether a man may correct himself is not.
               */}
              <div className="row-actions">
                {payment.ack && (
                  <span className="cell-sub">
                    {payment.ack.state === 'not_received' ? t('supply.payAskAgain') : t('supply.payChange')}
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn-primary btn-small btn-inline"
                  disabled={busyId === payment.id}
                  onClick={() => answer(payment, 'received')}
                >
                  <CheckCircleIcon size={15} /> {t('supply.payGot')}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-inline"
                  disabled={busyId === payment.id}
                  onClick={() => answer(payment, 'not_received')}
                >
                  <AlertIcon size={15} /> {t('supply.payNotGot')}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
