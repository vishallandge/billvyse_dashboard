'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouteId } from '../../../../lib/routeId';
import Link from 'next/link';
import { apiFetch } from '../../../../lib/api';
import { formatRupees, formatDate, formatDateTime, formatQty, toDateInput } from '../../../../lib/format';
import { useLanguage } from '../../../components/LanguageProvider';
import { useToast } from '../../../components/Toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { SkeletonCards, SkeletonTable } from '../../../components/Skeleton';
import Dropdown from '../../../components/Dropdown';
import Modal from '../../../components/Modal';
import {
  TruckIcon,
  RupeeIcon,
  CheckCircleIcon,
  AlertIcon,
  ClockIcon,
  CopyIcon,
  ClipboardIcon,
  MailIcon,
  PackageIcon,
  WhatsappIcon,
} from '../../../components/Icons';
import InvoiceAttachments from '../../../components/InvoiceAttachments';
import StockGapFixer from '../../../components/StockGapFixer';
import WhatsappSheet from '../../../components/WhatsappSheet';
import { recordHref } from '../../../../lib/routeId';

const PAYMENT_MODES = ['cash', 'upi', 'card', 'bank'];

// The order a purchase actually moves through. Cancelled is deliberately not on the line:
// it is an exit, not a step.
//
// "Aadha aaya" is only shown on an order that is actually sitting there. Printing it on
// every purchase would put a step on the line that the overwhelming majority never touch,
// and a progress bar that always has a stage nobody reaches stops being read.
function timelineFor(status) {
  return status === 'partial' ? ['draft', 'ordered', 'partial'] : ['draft', 'ordered', 'received'];
}

// A quantity box, as it comes back off a form: blank means zero, and a stray letter must not
// become NaN and take the whole total down with it.
function qtyNum(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export default function PurchaseOrderDetailPage() {
  const id = useRouteId();
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [shareLink, setShareLink] = useState(null);
  const [sharing, setSharing] = useState(false);
  // The open WhatsApp send sheet, or null. See components/WhatsappSheet.js.
  const [waSheet, setWaSheet] = useState(null);
  const [emailing, setEmailing] = useState(false);
  const [payment, setPayment] = useState({ amount: '', mode: 'cash', date: toDateInput(), note: '', reference: '' });
  // How to actually pay him — resolved by the server per request, never stored on the order,
  // because a wholesaler who changes his VPA has changed it for the orders already on screen.
  const [pay, setPay] = useState(null);
  // The delivery screen: one row per line, held as strings because they are form inputs and
  // a half-typed "1." is not a number yet.
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveLines, setReceiveLines] = useState([]);
  // 'pending' — he still owes the balance. 'close' — it is never coming. The app must never
  // pick between these on the shopkeeper's behalf; see models/PurchaseOrder.js.
  const [receiveBalance, setReceiveBalance] = useState('pending');
  const [receiveNote, setReceiveNote] = useState('');
  const [receiving, setReceiving] = useState(false);
  // The screen that puts arrived-but-unshelved goods where they belong. Opened from the
  // banner on a received order, and from the delivery screen before the mistake is made.
  const [stockGapOpen, setStockGapOpen] = useState(false);
  const [multiStore, setMultiStore] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/seller/suppliers/purchase-orders/${id}`)
      .then((data) => {
        setOrder(data.order);
        setPay(data.pay || null);
        // Only true for a shop with more than one branch. On a single dukaan naming the
        // store on every purchase forever is noise; on a two-branch shop it is the answer
        // to "maal receive dikha raha hai par stock mein nahi hai" — it went to the other
        // branch, and the register is shop-wide while stock is not.
        setMultiStore(Boolean(data.multiStore));
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  /**
   * Open the delivery screen with what SHOULD have come already filled in.
   *
   * Pre-filled rather than blank, because the common delivery is the complete one and a
   * shopkeeper made to type fourteen quantities that were already on his own order will
   * stop using the screen by Thursday. He changes the two lines that came up short and
   * signs for the rest — which is exactly the shape of the job at the counter.
   */
  function openReceive() {
    const first = (order.receipts?.length || 0) === 0;
    setReceiveLines(
      order.items.map((item) => ({
        // On the first delivery the whole order is expected; after that, only the balance
        // the wholesaler still owes.
        quantity: String(first ? item.quantity ?? 0 : item.pendingQuantity ?? 0),
        // A scheme is printed on the bill, so it only belongs on the delivery that carries
        // that bill. Re-offering it on the balance would silently double the free units.
        freeQuantity: first && item.freeQuantity > 0 ? String(item.freeQuantity) : '',
        // Blank exactly when the rate is still a placeholder — that is the box the screen
        // is asking him to fill from the bill in his hand.
        costPrice: item.rateUnknown ? '' : String(item.costPrice ?? ''),
        mrp: item.mrp > 0 ? String(item.mrp) : '',
        batchNumber: item.batchNumber || '',
        expiryDate: item.expiryDate ? toDateInput(item.expiryDate) : '',
      }))
    );
    setReceiveBalance('pending');
    setReceiveNote('');
    setReceiveOpen(true);
  }

  /**
   * Lines about to arrive with no product behind them.
   *
   * Read off the delivery form rather than off the order, because a line the shopkeeper has
   * just zeroed is not arriving and warning about it would be noise. Shaped like the
   * server's own `unstockedLines` so one screen fixes both cases.
   */
  const unlinkedLines = !order
    ? []
    : order.items
        .map((item, index) => ({ item, index }))
        .filter(({ item, index }) => {
          if (item.product) return false;
          const row = receiveLines[index] || {};
          return qtyNum(row.quantity) + qtyNum(row.freeQuantity) > 0;
        })
        .map(({ item, index }) => ({
          index,
          name: item.name,
          unit: item.unit,
          quantity: qtyNum(receiveLines[index]?.quantity) + qtyNum(receiveLines[index]?.freeQuantity),
          reason: 'noProduct',
        }));

  function setReceiveLine(index, patch) {
    setReceiveLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function submitReceive() {
    setReceiving(true);
    try {
      const data = await apiFetch(`/api/seller/suppliers/purchase-orders/${id}/receive`, {
        method: 'POST',
        body: JSON.stringify({
          lines: receiveLines.map((row, index) => ({
            index,
            quantity: qtyNum(row.quantity),
            freeQuantity: qtyNum(row.freeQuantity),
            // Only sent when the shopkeeper actually put something in the box. An empty
            // string here would read as a genuine zero and price the line at nothing.
            costPrice: row.costPrice === '' ? undefined : Number(row.costPrice),
            mrp: row.mrp === '' ? undefined : Number(row.mrp),
            batchNumber: row.batchNumber || undefined,
            expiryDate: row.expiryDate || undefined,
          })),
          balance: receiveBalance,
          note: receiveNote || undefined,
        }),
      });
      setOrder(data.order);
      setReceiveOpen(false);
      // What actually happened, in the sentence the shopkeeper would say — "poora maal aa
      // gaya" and "4 item abhi baaki hain" are different days, and "Stock updated" is
      // neither of them.
      const stillPending = data.order.pendingLines || 0;
      toast.success(
        stillPending > 0
          ? t('purchase.receivedPartialToast', { count: stillPending })
          : t('purchase.receivedToast')
      );
      /**
       * Goods that came in and reached no shelf get said out loud, at the one moment the
       * shopkeeper still has the crate open and knows what these things are.
       *
       * This used to be silent: the line was skipped, the money was booked, and the hole in
       * the stock list turned up weeks later with nothing to trace it to. The fixer is
       * opened rather than merely announced — a warning about stock that did not move, with
       * no way to move it, is the complaint this whole round started from.
       */
      if (data.notStocked?.length > 0) {
        toast.error(t('purchase.stockGapToast', { count: data.notStocked.length }));
        setStockGapOpen(true);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setReceiving(false);
    }
  }

  async function handleStatusChange(status) {
    if (status === 'cancelled') {
      const ok = await confirm({
        tone: 'danger',
        title: t('purchase.cancelOrder'), cancelLabel: t('common.goBack'),
        body: t('purchase.confirmCancel'),
        confirmLabel: t('purchase.cancelOrder'),
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const data = await apiFetch(`/api/seller/suppliers/purchase-orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setOrder(data.order);
      toast.success(status === 'received' ? t('purchase.receivedToast') : t('purchase.statusUpdated'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Opens the send sheet for this order.
   *
   * It used to open a WhatsApp tab straight off the fetch, which a popup blocker eats
   * silently — the shopkeeper saw nothing happen and had no way to tell whether the
   * wholesaler had been sent anything. It is also the one message in the app that changes
   * meaning after a short delivery (`purchaseOrderText` quotes what ARRIVED, and adds a
   * "abhi aana baaki hai" block), which is a good enough reason on its own to put it in
   * front of the shopkeeper before it goes.
   */
  async function handleShare() {
    setSharing(true);
    try {
      const data = await apiFetch(`/api/seller/suppliers/purchase-orders/${id}/share`);
      setShareLink(data);
      setWaSheet({
        title: t('wa.sendOrder'),
        to: { name: order?.supplier?.company || order?.supplier?.name, phone: order?.supplier?.phone },
        message: data.message,
        link: data.whatsappLink,
        auto: data.whatsappAuto,
        // Unlike every customer link in the app this one never depends on a storefront
        // slug — it is minted per order — so it is here even for a shop with no catalogue.
        appLink: data.appLink,
        appLinkLabel: t('purchase.supplierOpensHere'),
        endpoint: `/api/seller/suppliers/purchase-orders/${id}/whatsapp`,
      });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSharing(false);
    }
  }

  async function handleEmail() {
    setEmailing(true);
    try {
      const data = await apiFetch(`/api/seller/suppliers/purchase-orders/${id}/email`, { method: 'POST' });
      if (data.delivered) {
        toast.success(t('seller.emailSent'));
      } else {
        toast.error(data.reason === 'no mail provider configured' ? t('seller.emailNotConfigured') : t('seller.emailFailed'));
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setEmailing(false);
    }
  }

  /**
   * The shop's answer to a supplier bill that disagrees with the order.
   *
   * One dialog per decision, with the money on its own rows. This used to be two
   * `window.confirm`s fired back to back — which reads as the app asking the same question
   * twice — and a `window.prompt` for the settled amount, which cannot be validated or even
   * show what range is allowed.
   */
  async function resolveBill(state) {
    const bill = order.supplierBill;
    let agreedAmount;
    let updateCostPrices = false;

    if (state === 'settled') {
      const low = Math.min(order.totalAmount, bill.totalAmount);
      const high = Math.max(order.totalAmount, bill.totalAmount);
      const answer = await confirm({
        tone: 'info',
        title: t('purchase.decideSettle'),
        body: t('purchase.decideSettleBody'),
        details: [
          { label: t('purchase.ourTotal'), value: formatRupees(order.totalAmount, lang) },
          { label: t('purchase.supplierBillTotal'), value: formatRupees(bill.totalAmount, lang) },
        ],
        input: {
          label: t('purchase.decideSettleLabel'),
          type: 'number',
          inputMode: 'decimal',
          min: low,
          max: high,
          defaultValue: String(bill.totalAmount),
          required: true,
          hint: t('purchase.decideSettleRange', {
            low: formatRupees(low, lang),
            high: formatRupees(high, lang),
          }),
        },
        confirmLabel: t('purchase.decideSettleConfirm'),
      });
      if (!answer) return;
      agreedAmount = Number(answer.value);
      if (!(agreedAmount > 0)) {
        toast.error(t('purchase.decideSettleBad'));
        return;
      }
    } else if (state === 'accepted') {
      const difference = bill.totalAmount - order.totalAmount;
      const answer = await confirm({
        tone: 'warning',
        title: t('purchase.decideAcceptTitle'),
        body: t('purchase.decideAcceptBody'),
        details: [
          { label: t('purchase.ourTotal'), value: formatRupees(order.totalAmount, lang) },
          { label: t('purchase.supplierBillTotal'), value: formatRupees(bill.totalAmount, lang) },
          {
            label: difference > 0 ? t('purchase.decideAddsToOwed') : t('purchase.decideTakesOffOwed'),
            value: formatRupees(Math.abs(difference), lang),
            tone: difference > 0 ? 'danger' : 'success',
          },
        ],
        // The second question, asked in the same breath instead of as a second popup. Only
        // offered on 'accepted' — on a negotiated settlement neither side's line rates are
        // what was agreed, so writing his onto the shelf would record a number nobody signed
        // up to.
        checkbox: {
          label: t('purchase.decideAcceptCosts'),
          hint: t('purchase.decideAcceptCostsHint'),
        },
        confirmLabel: t('purchase.decideAcceptConfirmBtn'),
      });
      if (!answer) return;
      updateCostPrices = Boolean(answer.checked);
    }

    setSaving(true);
    try {
      const data = await apiFetch(`/api/seller/suppliers/purchase-orders/${id}/bill-resolution`, {
        method: 'POST',
        body: JSON.stringify({ state, agreedAmount, updateCostPrices }),
      });
      setOrder(data.order);
      toast.success(t('purchase.decideDone'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * "Check again — the UTR is this."
   *
   * The shop's side of a disputed payment. Collected in the app's own dialog, with the
   * amount and date on their own rows: the shopkeeper is answering about one entry out of
   * several and needs to see which. The reference is asked for separately from the sentence
   * because it lands on the payment itself — next month nobody reads the note, but the
   * wholesaler will still be searching his statement for that number.
   */
  async function replyToDispute(p) {
    const answer = await confirm({
      tone: 'warning',
      title: t('purchase.payReplyTitle'),
      body: t('purchase.payReplyBody'),
      details: [
        { label: t('seller.amount'), value: formatRupees(p.amount, lang), tone: 'danger' },
        { label: t('expenses.date'), value: formatDate(p.date, lang) },
        { label: t('purchase.supplierSaid'), value: p.supplierAck?.note || t('purchase.supplierGotNo') },
      ],
      input: {
        label: t('purchase.payReplyLabel'),
        placeholder: t('purchase.payReplyPh'),
        required: true,
        hint: p.reference ? t('purchase.payReplyHasRef', { reference: p.reference }) : t('purchase.payReplyHint'),
      },
      confirmLabel: t('purchase.payReplySend'),
    });
    if (!answer) return;

    setSaving(true);
    try {
      const data = await apiFetch(`/api/seller/suppliers/purchase-orders/${id}/payments/${p.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ note: answer.value }),
      });
      setOrder(data.order);
      toast.success(t('purchase.payReplySent'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePayment(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const data = await apiFetch(`/api/seller/suppliers/purchase-orders/${id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(payment.amount),
          mode: payment.mode,
          date: payment.date || undefined,
          note: payment.note || undefined,
          reference: payment.reference || undefined,
        }),
      });
      setOrder(data.order);
      setPayment({ amount: '', mode: 'cash', date: toDateInput(), note: '', reference: '' });
      toast.success(t('purchase.paymentRecorded'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <SkeletonCards count={1} height={80} />
        <SkeletonTable rows={4} cols={4} />
      </>
    );
  }

  if (error) {
    return (
      <>
        <div className="error-banner">{error}</div>
      </>
    );
  }

  if (!order) return null;

  // What is still OWED, which stops being the order total once a supplier bill has been
  // accepted or settled — the server sends both, and `pending` is already computed off the
  // agreed figure. The fallback only exists for a response from an older build.
  const outstanding = order.pending ?? Math.max(0, (order.payableAmount ?? order.totalAmount) - order.amountPaid);
  const isClosed = order.status === 'cancelled';
  // Two extra columns that only mean something on a bill that came in lot-wise. A hardware
  // shop's purchase would just get two columns of dashes.
  const showLots = order.items.some((item) => item.batchNumber || item.mrp > 0);
  // Only shown once there is something to show. An order nobody has taken delivery of yet
  // has no shortfall to report, and a "Baaki" column of dashes on every purchase is noise.
  const showBalance = (order.pendingLines || 0) > 0 || (order.shortClosedLines || 0) > 0;
  // The totals footer spans everything except the amount column, so it has to know how many
  // columns the header actually rendered.
  const footSpan = (showLots ? 6 : 4) + (showBalance ? 1 : 0);
  const canEditStatus = order.status === 'draft' || order.status === 'ordered';
  const isPartial = order.status === 'partial';
  const timeline = timelineFor(order.status);
  // The first delivery is measured against the whole order; every one after it against what
  // is still owed. Asked of the receipt log, because until goods move a line's quantity is
  // still the shop's ask and cannot tell the two apart.
  const firstDelivery = (order.receipts?.length || 0) === 0;
  // What the open delivery screen currently adds up to, recomputed as he types. Free units
  // are excluded on purpose: they arrive but the bill does not charge for them, so folding
  // them in here would quote him a figure his own paper disagrees with.
  const receiveValue = order.items.reduce((sum, item, index) => {
    const row = receiveLines[index] || {};
    const rate = Number(row.costPrice);
    const discount = Math.min(100, Number(item.discountPercent) || 0);
    if (!Number.isFinite(rate) || rate < 0) return sum;
    return sum + qtyNum(row.quantity) * rate * (1 - discount / 100);
  }, 0);
  const shortLineCount = order.items.filter((item, index) => {
    const expected = firstDelivery ? item.quantity || 0 : item.pendingQuantity || 0;
    return qtyNum(receiveLines[index]?.quantity) < expected;
  }).length;

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{order.label}</h1>
          <p>
            {order.supplier?.name}
            {order.supplier?.company ? ` · ${order.supplier.company}` : ''}
            {' · '}
            {formatDate(order.createdAt, lang)}
          </p>
          {/* The sideways link only. The way UP from this screen is the shell's, in
              the breadcrumb on the sticky bar — see app/components/PageTrail.js. */}
          {order.supplier?.id && (
            <div className="head-links">
              <Link href="/seller/suppliers/ledger" className="nav-link">{t('seller.supplierLedgerTitle')} →</Link>
            </div>
          )}
        </div>
        <span className={`badge ${order.status === 'received' ? 'badge-active' : isClosed ? 'badge-inactive' : 'badge-pending'}`}>
          {t(`purchase.status.${order.status}`)}
        </span>
      </div>

      <div className="stat-grid">
        {/* The order's own total, and — only when a settled bill has moved it — what the
            shop actually agreed to pay. Both, because they answer different questions: the
            first is what the GST return was filed on, the second is what is owed. */}
        <div className="stat-card">
          <div className="stat-icon"><ClipboardIcon size={16} /></div>
          <div className="stat-value">{formatRupees(order.totalAmount, lang)}</div>
          <div className="stat-label">{t('seller.total')}</div>
          {order.payableAmount != null && order.payableAmount !== order.totalAmount && (
            <div className="cell-sub">
              {t('purchase.agreedPayable', { amount: formatRupees(order.payableAmount, lang) })}
            </div>
          )}
        </div>
        <div className="stat-card accent-success">
          <div className="stat-icon"><CheckCircleIcon size={16} /></div>
          <div className="stat-value">{formatRupees(order.amountPaid, lang)}</div>
          <div className="stat-label">{t('seller.paid')}</div>
        </div>
        <div className={`stat-card ${outstanding > 0 ? 'accent-danger' : 'accent-success'}`}>
          <div className="stat-icon"><RupeeIcon size={16} /></div>
          <div className="stat-value">{formatRupees(outstanding, lang)}</div>
          <div className="stat-label">{t('seller.outstanding')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><TruckIcon size={16} /></div>
          <div className="stat-value">{formatRupees(order.gstAmount || 0, lang)}</div>
          <div className="stat-label">{t('purchase.inputGst')}</div>
        </div>
      </div>

      <div className="panel">
        <h2>{t('purchase.progress')}</h2>
        {isClosed ? (
          <p className="empty-state">{t('purchase.cancelledOn', { date: formatDate(order.cancelledAt, lang) })}</p>
        ) : (
          <ol className="po-timeline">
            {timeline.map((step) => {
              const reachedIndex = timeline.indexOf(order.status);
              const stepIndex = timeline.indexOf(step);
              const done = stepIndex <= reachedIndex;
              const at =
                step === 'ordered'
                  ? order.orderedAt
                  : step === 'received' || step === 'partial'
                    ? order.receivedAt
                    : order.createdAt;
              return (
                <li key={step} className={done ? 'done' : ''}>
                  <span className="dot" />
                  <div>
                    <strong>{t(`purchase.step.${step}`)}</strong>
                    <small>{done && at ? formatDateTime(at, lang) : '—'}</small>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="row-actions" style={{ marginTop: '0.8rem' }}>
          {order.status === 'draft' && (
            <button className="btn btn-primary btn-small btn-inline" disabled={saving} onClick={() => handleStatusChange('ordered')}>
              {t('purchase.place')}
            </button>
          )}
          {/* One button, and it opens the screen that asks how much actually came. It used to
              fire a yes/no confirm, which is the whole reason short supply was unrecordable:
              at the counter the only thing on offer said the entire order had arrived, so
              that is what got tapped, and the register drifted away from the godown one
              delivery at a time. */}
          {(order.status === 'ordered' || isPartial) && (
            <button className="btn btn-primary btn-small btn-inline" disabled={saving} onClick={openReceive}>
              <TruckIcon size={15} /> {isPartial ? t('purchase.receiveBalance') : t('purchase.receive')}
            </button>
          )}
          {canEditStatus && (
            <button className="btn btn-danger btn-small btn-inline" disabled={saving} onClick={() => handleStatusChange('cancelled')}>
              {t('purchase.cancelOrder')}
            </button>
          )}
          <button className="btn btn-secondary btn-small btn-inline" onClick={handleShare} disabled={sharing}>
            <WhatsappIcon size={17} /> {t('seller.shareWhatsapp')}
          </button>
          <button
            className="btn btn-secondary btn-small btn-inline"
            onClick={handleEmail}
            disabled={emailing || !order.supplier?.email}
            data-tip={!order.supplier?.email ? t('seller.noSupplierEmail') : undefined}
          >
            <MailIcon size={15} /> {emailing ? t('common.saving') : t('seller.emailPO')}
          </button>
          <Link href={recordHref('/seller/purchase-orders/[id]/print', id)} className="btn btn-secondary btn-small btn-inline">
            {t('purchase.printPo')}
          </Link>
        </div>
        {/* A draft is invisible to the wholesaler by design (see listSupplierOrders) — but
            nothing said so, so a shopkeeper could sit waiting on a reply to an order that was
            never sent. The one state where "why has he not answered" has a real answer. */}
        {order.status === 'draft' && (
          <div className="info-banner" style={{ marginTop: '0.6rem', marginBottom: 0 }}>
            {t('purchase.draftInvisible')}
          </div>
        )}
        {order.status === 'received' && (
          <p className="field-hint" style={{ marginTop: '0.5rem' }}>{t('purchase.receivedLocked')}</p>
        )}
        {/* The one thing a shopkeeper looking at a half-delivered order needs told: it is not
            stuck, and it is not editable either — the way it moves is another delivery. */}
        {isPartial && (
          <div className="info-banner" style={{ marginTop: '0.6rem', marginBottom: 0 }}>
            {t('purchase.partialBanner', { count: order.pendingLines || 0 })}
          </div>
        )}
        {/* Goods this order took in that are on no shelf.
            Loud, and above everything else about the order, because it is the one thing here
            that makes the shop's own stock figures wrong — every reorder level, every margin
            and every day's closing stock is short by exactly this. It stays until the last
            line is fixed, and the button is the fix rather than an explanation of it. */}
        {/* Which branch the goods went to. Shown only on a shop that has branches, and only
            once they have actually arrived — before that it is a plan, not a fact. */}
        {multiStore && order.store?.name && ['partial', 'received'].includes(order.status) && (
          <p className="field-hint" style={{ marginTop: '0.5rem' }}>
            {t('purchase.stockWentTo', { store: order.store.name })}
          </p>
        )}
        {order.unstockedLines?.length > 0 && (
          <div className="error-banner banner-with-action" style={{ marginTop: '0.6rem', marginBottom: 0 }}>
            <span>{t('purchase.stockGapBanner', { count: order.unstockedLines.length })}</span>
            <button type="button" className="btn btn-primary btn-small btn-inline" onClick={() => setStockGapOpen(true)}>
              <PackageIcon size={15} /> {t('purchase.stockGapFix')}
            </button>
          </div>
        )}
        {shareLink && !shareLink.whatsappLink && <p className="empty-state">{t('seller.noSupplierPhone')}</p>}
        {/* What the link will actually do when he taps it.
            Worth stating because the two outcomes look identical from here and feel very
            different at his end: a wholesaler with an account lands in his own dashboard with
            every shop and his ledger, and one without lands on this order alone. The third
            line is the only one with a job for the shopkeeper — a supplier row with no phone
            can never be recognised, and can never be sent a verification code either. */}
        {shareLink?.supplierPortal && (
          <p className="field-hint" style={{ marginTop: '0.5rem' }}>
            {shareLink.supplierPortal.registered
              ? t('purchase.linkRegistered')
              : shareLink.supplierPortal.canRegister
                ? t('purchase.linkGuest')
                : t('purchase.linkNoPhone')}
          </p>
        )}
        {!order.supplier?.email && <p className="empty-state">{t('seller.noSupplierEmail')}</p>}
        {order.expectedAt && order.status === 'ordered' && (
          <p className="field-hint" style={{ marginTop: '0.4rem' }}>
            <ClockIcon size={13} /> {t('purchase.expectedOn', { date: formatDate(order.expectedAt, lang) })}
          </p>
        )}
      </div>

      {(order.supplierInvoiceNumber || order.supplierInvoiceDate || order.dueDate || order.notes) && (
        <div className="panel">
          <h2>{t('purchase.billDetails')}</h2>
          <div className="detail-grid">
            {/* Put next to the wholesaler's number on purpose. Seeing "PO-13" and
                "A/2526/1183" in the same block, each under its own label, answers the
                question of whether they were supposed to match better than a paragraph
                would. */}
            <div>
              <span>{t('purchase.ourOrderNo')}</span>
              <strong>{order.label}</strong>
            </div>
            {order.supplierInvoiceNumber && (
              <div>
                <span>{t('purchase.supplierInvoiceNo')}</span>
                <strong>{order.supplierInvoiceNumber}</strong>
              </div>
            )}
            {order.supplierInvoiceDate && (
              <div>
                <span>{t('purchase.supplierInvoiceDate')}</span>
                <strong>{formatDate(order.supplierInvoiceDate, lang)}</strong>
              </div>
            )}
            {order.dueDate && (
              <div>
                <span>{t('purchase.dueDate')}</span>
                <strong>{formatDate(order.dueDate, lang)}</strong>
              </div>
            )}
            {order.supplier?.gstin && (
              <div>
                <span>{t('seller.gstin')}</span>
                <strong>
                  {order.supplier.gstin}
                  {/* Why this bill's tax is a single IGST line rather than two. Worth
                      saying: it is the one thing on the register an accountant will query. */}
                  {order.isInterState && <span className="cell-sub">{t('purchase.interStateNote')}</span>}
                </strong>
              </div>
            )}
            {order.createdByName && (
              <div>
                <span>{t('purchase.raisedBy')}</span>
                <strong>{order.createdByName}</strong>
              </div>
            )}
            {order.notes && (
              <div style={{ gridColumn: '1 / -1' }}>
                <span>{t('purchase.notes')}</span>
                <strong>{order.notes}</strong>
              </div>
            )}
          </div>
          <p className="field-hint" style={{ marginTop: '0.5rem' }}>{t('purchase.twoNumbersNote')}</p>
        </div>
      )}

      {/* What the wholesaler said back from his own login. Only shown once he has actually
          answered — a "pending" line on every order of a shop whose suppliers have never
          signed in would be a column of nothing. */}
      {order.supplierResponse?.state && order.supplierResponse.state !== 'pending' && (
        <div className="panel">
          <h2>{t('purchase.supplierSaid')}</h2>
          <div className="detail-grid">
            <div>
              <span>{t('common.status')}</span>
              <strong>
                <span
                  className={`badge ${order.supplierResponse.state === 'rejected' ? 'badge-inactive' : 'badge-active'}`}
                  style={{ width: 'fit-content' }}
                >
                  {t(`purchase.supplierState.${order.supplierResponse.state}`)}
                </span>
              </strong>
            </div>
            {order.supplierResponse.at && (
              <div>
                <span>{t('common.date')}</span>
                <strong>{formatDateTime(order.supplierResponse.at, lang)}</strong>
              </div>
            )}
            {order.supplierResponse.note && (
              <div style={{ gridColumn: '1 / -1' }}>
                <span>{t('purchase.notes')}</span>
                <strong>{order.supplierResponse.note}</strong>
              </div>
            )}
          </div>
          {/* Said plainly so nobody reads "dispatched" as "in stock": this is his claim
              about the road, and the shop still decides when goods actually arrived. */}
          <p className="field-hint" style={{ marginTop: '0.5rem' }}>{t('purchase.supplierSaidHint')}</p>
        </div>
      )}

      {/* The bill the wholesaler made in his own portal.
          A claim, never applied — the shop's own items and totals above are untouched by it.
          Led with the difference rather than the total, because a bill that matches needs no
          attention and a bill that does not is money about to leave the drawer wrongly. */}
      {order.supplierBill && (
        <div className={`panel${order.supplierBillDiff && !order.supplierBillDiff.matches ? ' accent-danger' : ''}`}>
          <div className="panel-head">
            <h2>{t('purchase.supplierBillTitle')}</h2>
            <Link
              href={recordHref('/seller/purchase-orders/[id]/supplier-bill', id)}
              className="btn btn-secondary btn-small btn-inline"
            >
              {t('purchase.supplierBillPrint')}
            </Link>
          </div>

          {order.supplierBillDiff?.matches ? (
            <div className="info-banner" style={{ background: 'var(--success-soft, rgba(34,197,94,0.12))' }}>
              <CheckCircleIcon size={15} /> {t('purchase.supplierBillMatches')}
            </div>
          ) : (
            <div className="info-banner">
              <strong>
                {order.supplierBillDiff?.difference > 0
                  ? t('purchase.supplierBillMore', { amount: formatRupees(Math.abs(order.supplierBillDiff.difference), lang) })
                  : order.supplierBillDiff?.difference < 0
                    ? t('purchase.supplierBillLess', { amount: formatRupees(Math.abs(order.supplierBillDiff.difference), lang) })
                    : t('purchase.supplierBillLinesDiffer')}
              </strong>
              <p style={{ margin: '0.3rem 0 0' }}>{t('purchase.supplierBillClaimHint')}</p>
            </div>
          )}

          <div className="detail-grid">
            <div>
              <span>{t('purchase.supplierBillNo')}</span>
              <strong>{order.supplierBill.number}</strong>
            </div>
            <div>
              <span>{t('purchase.supplierInvoiceDate')}</span>
              <strong>{formatDate(order.supplierBill.date, lang)}</strong>
            </div>
            <div>
              <span>{t('purchase.supplierBillTotal')}</span>
              <strong>{formatRupees(order.supplierBill.totalAmount, lang)}</strong>
            </div>
            <div>
              <span>{t('purchase.ourTotal')}</span>
              <strong>{formatRupees(order.totalAmount, lang)}</strong>
            </div>
            {order.supplierBill.note && (
              <div style={{ gridColumn: '1 / -1' }}>
                <span>{t('purchase.notes')}</span>
                <strong>{order.supplierBill.note}</strong>
              </div>
            )}
          </div>

          {/* His bill number against the one the shop typed. These two are supposed to be the
              same string, and when they are not, one of them was mistyped — which is exactly
              the field GST returns are matched on. */}
          {order.supplierBillDiff?.invoiceNumberDiffers && (
            <p className="field-hint">
              <AlertIcon size={13} /> {t('purchase.supplierBillNumberDiffers', {
                ours: order.supplierInvoiceNumber,
                theirs: order.supplierBill.number,
              })}
            </p>
          )}

          {/* The half of a rate dispute nobody thinks about. He will file his figure in
              GSTR-1; the shop has claimed credit on its own. GSTR-2B matches the two invoice
              by invoice, so this surfaces months later as a notice unless it is settled at
              the counter. Never applied — credit needs a document, and the document is the
              thing the shopkeeper has to go and ask for. */}
          {order.supplierBillDiff?.gstDifference !== 0 && order.supplierBillDiff?.itcDocumentNeeded && (
            <p className="field-hint">
              <AlertIcon size={13} />{' '}
              {t('purchase.itcGap', {
                ours: formatRupees(order.supplierBillDiff.ourGst, lang),
                theirs: formatRupees(order.supplierBillDiff.theirGst, lang),
                gap: formatRupees(Math.abs(order.supplierBillDiff.gstDifference), lang),
              })}{' '}
              {t(
                order.supplierBillDiff.itcDocumentNeeded === 'supplementary'
                  ? 'purchase.itcNeedSupplementary'
                  : 'purchase.itcNeedCreditNote'
              )}
            </p>
          )}

          {order.supplierBillDiff?.lines?.length > 0 && (
            <div className="table-wrap auto-height">
              <table className="data-table" style={{ minWidth: '520px' }}>
                <thead>
                  <tr>
                    <th>{t('seller.productName')}</th>
                    <th>{t('purchase.difference')}</th>
                    {/* Headed as RATES, because the same words sit above the two TOTALS a few
                        rows up and one pair was being read as the other. */}
                    <th className="num">{t('purchase.weOrderedRate')}</th>
                    <th className="num">{t('purchase.heBilledRate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {order.supplierBillDiff.lines.map((line, index) => (
                    <tr key={`${line.name}-${line.kind}-${index}`}>
                      <td className="cell-strong">{line.name}</td>
                      <td>
                        <span className="badge badge-pending">{t(`purchase.diffKind.${line.kind}`)}</span>
                      </td>
                      <td className="num">
                        {line.kind === 'rate' ? formatRupees(line.ordered, lang) : `${line.ordered} ${line.unit || ''}`}
                      </td>
                      <td className="num">
                        {line.kind === 'rate' ? formatRupees(line.billed, lang) : `${line.billed} ${line.unit || ''}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* The three answers a shopkeeper actually gives. Without these the panel above
              said "correct your own entry if you agree" while the order sat frozen with no
              way to correct anything — a dead end the app itself had created.

              None of them touches the order. The money moves as a supplier-ledger
              adjustment, which is what one is for and how it would be done on paper. */}
          {order.supplierBillResolution ? (
            <div className="info-banner" style={{ background: 'var(--success-soft, rgba(34,197,94,0.12))' }}>
              <CheckCircleIcon size={15} />{' '}
              {t(`purchase.resolved.${order.supplierBillResolution.state}`, {
                amount: formatRupees(order.supplierBillResolution.agreedAmount, lang),
              })}
              {order.supplierBillResolution.ledgerDelta !== 0 && (
                <span>
                  {' '}
                  {t(
                    order.supplierBillResolution.ledgerDelta > 0
                      ? 'purchase.resolvedLedgerUp'
                      : 'purchase.resolvedLedgerDown',
                    { amount: formatRupees(Math.abs(order.supplierBillResolution.ledgerDelta), lang) }
                  )}
                </span>
              )}
              {order.supplierBillResolution.costPricesUpdated && <span> {t('purchase.resolvedCostsUpdated')}</span>}
            </div>
          ) : (
            !order.supplierBillDiff?.matches && (
              <>
                <h3 className="section-sub">{t('purchase.decideTitle')}</h3>
                <p className="field-hint" style={{ marginTop: 0 }}>{t('purchase.decideHint')}</p>
                <div className="row-actions" style={{ marginTop: '0.6rem' }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-inline"
                    disabled={saving}
                    onClick={() => resolveBill('accepted')}
                  >
                    {t('purchase.decideAccept', {
                      amount: formatRupees(order.supplierBill.totalAmount, lang),
                    })}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-inline"
                    disabled={saving}
                    onClick={() => resolveBill('rejected')}
                  >
                    {t('purchase.decideReject', { amount: formatRupees(order.totalAmount, lang) })}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-inline"
                    disabled={saving}
                    onClick={() => resolveBill('settled')}
                  >
                    {t('purchase.decideSettle')}
                  </button>
                </div>
                <p className="field-hint">{t('purchase.decideNoOrderChange')}</p>
              </>
            )
          )}
        </div>
      )}

      <InvoiceAttachments
        orderId={id}
        attachments={order.attachments || []}
        onChange={load}
        hasSupplierBill={Boolean(order.supplierBill)}
      />

      <div className="panel">
        <h2>{t('seller.items')}</h2>
        <div className="table-wrap auto-height">
          <table className="data-table" style={{ minWidth: showLots ? '900px' : '640px' }}>
            <thead>
              <tr>
                <th>{t('seller.productName')}</th>
                {showLots && <th>{t('purchase.batchNo')}</th>}
                <th className="num">{t('seller.quantity')}</th>
                {showBalance && <th className="num">{t('purchase.stillDue')}</th>}
                <th className="num">{t('purchase.rate')}</th>
                {showLots && <th className="num">{t('purchase.mrp')}</th>}
                <th className="num">GST</th>
                <th className="num">{t('seller.total')}</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item, idx) => (
                <tr key={idx}>
                  <td>
                    <div className="cell-stack">
                      <span className="cell-strong">{item.name}</span>
                      <span className="cell-sub">
                        {item.company ? `${item.company} · ` : ''}
                        {item.packLabel ? `${item.packLabel} · ` : ''}
                        {item.discountPercent > 0 ? `${t('purchase.discPercent')} ${item.discountPercent}% · ` : ''}
                        {item.hsnCode ? `HSN ${item.hsnCode} · ` : ''}
                        {item.product ? t('purchase.linked') : t('purchase.notLinked')}
                      </span>
                      {/* "Not linked" states a fact about a field; this states what it cost
                          the shop. The two are not the same sentence and only one of them
                          sends anybody to fix it. */}
                      {item.stockGap > 0 && (
                        <span className="tag-nostock">
                          {t('purchase.stockGapTag', { qty: formatQty(item.stockGap, lang), unit: item.unit })}
                        </span>
                      )}
                    </div>
                  </td>
                  {showLots && (
                    <td>
                      {item.batchNumber ? (
                        <div className="cell-stack">
                          <code className="cell-strong">{item.batchNumber}</code>
                          {item.expiryDate && (
                            <span className="cell-sub">{t('purchase.expShort', { date: formatDate(item.expiryDate, lang) })}</span>
                          )}
                        </div>
                      ) : (
                        <span className="cell-muted">—</span>
                      )}
                    </td>
                  )}
                  <td className="num">
                    <div className="cell-stack">
                      <span>{formatQty(item.quantity, lang)} {item.unit}</span>
                      {/* Free units cost nothing and arrive anyway, so the quantity column
                          would otherwise under-report what actually reached the shelf. */}
                      {item.freeQuantity > 0 && (
                        <span className="cell-sub amount-in">
                          {t('purchase.plusFree', { free: formatQty(item.freeQuantity, lang), received: formatQty(item.receivedQuantity, lang) })}
                        </span>
                      )}
                      {/* What was asked for, whenever it is not what came. Shown here rather
                          than in a column of its own because the two numbers only mean
                          anything side by side — "6" is a fact, "6 of 10" is the problem. */}
                      {showBalance && item.orderedQuantity > item.quantity && (
                        <span className="cell-sub">
                          {t('purchase.orderedWas', { qty: formatQty(item.orderedQuantity, lang) })}
                        </span>
                      )}
                    </div>
                  </td>
                  {showBalance && (
                    <td className="num">
                      {item.pendingQuantity > 0 ? (
                        <span className="cell-strong amount-out">
                          {formatQty(item.pendingQuantity, lang)} {item.unit}
                        </span>
                      ) : item.shortClosed ? (
                        // Written off, and said so — a blank here would read as "nothing was
                        // short", which is the opposite of what happened.
                        <span className="cell-sub">{t('purchase.shortClosedLine')}</span>
                      ) : (
                        <span className="cell-muted">—</span>
                      )}
                    </td>
                  )}
                  <td className="num">
                    <div className="cell-stack">
                      <span>{formatRupees(item.costPrice, lang)}</span>
                      {/* What a unit really cost once the free ones are counted — the
                          number every margin in the app is computed from. */}
                      {item.freeQuantity > 0 && (
                        <span className="cell-sub">{t('purchase.effectiveRate', { rate: formatRupees(item.effectiveCost, lang) })}</span>
                      )}
                    </div>
                  </td>
                  {showLots && <td className="num cell-muted">{item.mrp > 0 ? formatRupees(item.mrp, lang) : '—'}</td>}
                  <td className="num cell-muted">{item.gstRate || 0}%</td>
                  <td className="num cell-strong">{formatRupees(item.lineTotal, lang)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {/* Only shown on a bill that actually had charges, and laid out in the order
                  a wholesaler's bill prints them so the two can be read side by side. */}
              {order.hasCharges && (
                <>
                  <tr>
                    <td colSpan={footSpan} className="num cell-muted">{t('purchase.grossAmount')}</td>
                    <td className="num">{formatRupees(order.grossAmount || 0, lang)}</td>
                  </tr>
                  {order.charges?.cashDiscount > 0 && (
                    <tr>
                      <td colSpan={footSpan} className="num cell-muted">
                        {t('purchase.cashDiscount')}
                        {order.charges.cashDiscountPercent > 0 ? ` (${order.charges.cashDiscountPercent}%)` : ''}
                      </td>
                      <td className="num amount-in">− {formatRupees(order.charges.cashDiscount, lang)}</td>
                    </tr>
                  )}
                  {order.charges?.lineDiscount > 0 && (
                    <tr>
                      <td colSpan={footSpan} className="num cell-muted">{t('purchase.lineDiscount')}</td>
                      <td className="num amount-in">− {formatRupees(order.charges.lineDiscount, lang)}</td>
                    </tr>
                  )}
                  {order.charges?.freight > 0 && (
                    <tr>
                      <td colSpan={footSpan} className="num cell-muted">{t('purchase.freight')}</td>
                      <td className="num">+ {formatRupees(order.charges.freight, lang)}</td>
                    </tr>
                  )}
                  {order.charges?.otherCharges > 0 && (
                    <tr>
                      <td colSpan={footSpan} className="num cell-muted">{t('purchase.otherCharges')}</td>
                      <td className="num">+ {formatRupees(order.charges.otherCharges, lang)}</td>
                    </tr>
                  )}
                </>
              )}
              <tr>
                <td colSpan={footSpan} className="num cell-muted">{t('purchase.taxableValue')}</td>
                <td className="num">{formatRupees(order.taxableAmount || 0, lang)}</td>
              </tr>
              {/* The tax in the two boxes GSTR-3B actually asks for. Which one applies was
                  decided from the supplier's GSTIN against the shop's when the order was
                  raised, and frozen onto it — a supplier's GSTIN can be corrected after a
                  return has already been filed. */}
              {order.isInterState ? (
                <tr>
                  <td colSpan={footSpan} className="num cell-muted">IGST</td>
                  <td className="num">{formatRupees(order.igstAmount || 0, lang)}</td>
                </tr>
              ) : (
                <>
                  <tr>
                    <td colSpan={footSpan} className="num cell-muted">CGST</td>
                    <td className="num">{formatRupees(order.cgstAmount || 0, lang)}</td>
                  </tr>
                  <tr>
                    <td colSpan={footSpan} className="num cell-muted">SGST</td>
                    <td className="num">{formatRupees(order.sgstAmount || 0, lang)}</td>
                  </tr>
                </>
              )}
              {order.charges?.roundOff ? (
                <tr>
                  <td colSpan={footSpan} className="num cell-muted">{t('purchase.roundOff')}</td>
                  <td className="num">{formatRupees(order.charges.roundOff, lang)}</td>
                </tr>
              ) : null}
              <tr>
                <td colSpan={footSpan} className="num cell-strong">{t('seller.total')}</td>
                <td className="num cell-strong">{formatRupees(order.totalAmount, lang)}</td>
              </tr>
              {/* What this load is worth on the shelf against what it cost — the margin on
                  the whole delivery, before a single strip is sold. */}
              {order.mrpValue > 0 && (
                <tr>
                  <td colSpan={footSpan} className="num cell-muted">{t('purchase.shelfValueLabel')}</td>
                  <td className="num">
                    <div className="cell-stack">
                      <span>{formatRupees(order.mrpValue, lang)}</span>
                      <span className="cell-sub amount-in">
                        {t('purchase.marginOnLoad', { amount: formatRupees(order.mrpValue - order.totalAmount, lang) })}
                      </span>
                    </div>
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
        {order.status !== 'received' && order.items.some((item) => !item.product) && (
          <p className="field-hint" style={{ marginTop: '0.5rem' }}>
            <AlertIcon size={13} /> {t('purchase.unlinkedWarning')}
          </p>
        )}
      </div>

      {/* Every delivery this order took, in the order they came.
          Only rendered once there has been more than one — a purchase that arrived in a
          single load already says everything this panel would, in its own dates. The moment
          there are two, the lines above can only report where the order ENDED UP, and the
          question a shopkeeper actually has ("kab kya aaya?") has nowhere else to be
          answered. It is also the record the wholesaler gets read back to him. */}
      {(order.receipts?.length || 0) > 1 && (
        <div className="panel">
          <h2>{t('purchase.deliveries')}</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="sr">#</th>
                  <th>{t('common.date')}</th>
                  <th>{t('purchase.whatCame')}</th>
                  <th className="num">{t('purchase.addedToUdhaar')}</th>
                </tr>
              </thead>
              <tbody>
                {order.receipts.map((receipt, idx) => (
                  <tr key={idx}>
                    <td className="sr">{idx + 1}</td>
                    <td>
                      <div className="cell-stack">
                        <span className="cell-strong">{formatDateTime(receipt.at, lang)}</span>
                        {receipt.byName && <span className="cell-sub">{receipt.byName}</span>}
                        {receipt.closedShort && (
                          <span className="cell-sub amount-out">{t('purchase.closedShortHere')}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="cell-stack">
                        {receipt.lines.map((line, lineIdx) => (
                          <span key={lineIdx} className={lineIdx === 0 ? 'cell-strong' : 'cell-sub'}>
                            {line.name} — {formatQty(line.quantity, lang)} {line.unit}
                            {line.freeQuantity > 0 ? ` + ${formatQty(line.freeQuantity, lang)} ${t('purchase.freeShort')}` : ''}
                          </span>
                        ))}
                        {receipt.note && <span className="cell-sub">{receipt.note}</span>}
                      </div>
                    </td>
                    <td className="num cell-strong">
                      {receipt.ledgerAmount > 0 ? formatRupees(receipt.ledgerAmount, lang) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>{t('seller.supplierPayment')}</h2>
        {/* A payment button that offers the shop's own total while an unanswered claim for a
            different amount sits above it is the app confidently handing over the wrong
            number. Said before the form, not after it. */}
        {order.supplierBill && !order.supplierBillResolution && !order.supplierBillDiff?.matches && (
          <div className="info-banner">
            <AlertIcon size={15} />{' '}
            {t('purchase.payDisputed', {
              ours: formatRupees(order.totalAmount, lang),
              theirs: formatRupees(order.supplierBill.totalAmount, lang),
            })}
          </div>
        )}
        {/* "UPI" was a label and nothing more: the mode existed, no UPI id was stored
            anywhere on the platform, and the shopkeeper still had to find the VPA in
            WhatsApp and type it into a payment app by hand — which is exactly where a wrong
            digit becomes "paisa nahi mila" three days later. Shown only when that mode is
            chosen, so it never crowds a cash entry. */}
        {!isClosed && outstanding > 0 && payment.mode === 'upi' && (
          <div className="pay-upi">
            {pay ? (
              <>
                <div className="pay-upi-id">
                  <span className="cell-sub">{t('purchase.payUpiTo')}</span>
                  <strong>{pay.upiId}</strong>
                  {pay.source === 'shop' && <span className="cell-sub">{t('purchase.payUpiFromShopNote')}</span>}
                </div>
                <div className="row-actions">
                  {/* An intent link, not a QR: this is a shopkeeper on his own phone, and the
                      app that opens is his own. Nothing comes back from it — no callback, no
                      webhook — which is why the reference field above is the other half. */}
                  <a className="btn btn-primary btn-small btn-inline" href={pay.link}>
                    <RupeeIcon size={15} /> {t('purchase.payUpiOpen')}
                  </a>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small btn-inline"
                    onClick={() => {
                      navigator.clipboard?.writeText(pay.upiId);
                      toast.success(t('purchase.payUpiCopied'));
                    }}
                  >
                    <CopyIcon size={15} /> {t('purchase.payUpiCopy')}
                  </button>
                </div>
              </>
            ) : (
              // Nothing to pay into. Said plainly with the fix attached, because the
              // shopkeeper can add it himself in one place and never think about it again.
              <p className="field-hint">
                {t('purchase.payUpiMissing')}{' '}
                <Link className="link-btn" href="/seller/suppliers">
                  {t('purchase.payUpiAdd')}
                </Link>
              </p>
            )}
          </div>
        )}

        {isClosed ? (
          <p className="empty-state">{t('purchase.cancelledNoPayments')}</p>
        ) : outstanding > 0 ? (
          <form className="form-grid" onSubmit={handlePayment}>
            <div className="field">
              <label>{t('seller.amount')}</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                max={outstanding}
                value={payment.amount}
                onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))}
                required
              />
              <button
                type="button"
                className="link-btn"
                onClick={() => setPayment((p) => ({ ...p, amount: String(outstanding) }))}
              >
                {t('purchase.payFull', { amount: formatRupees(outstanding, lang) })}
              </button>
            </div>
            <div className="field">
              <label>{t('seller.paymentMode')}</label>
              <Dropdown
                value={payment.mode}
                onChange={(v) => setPayment((p) => ({ ...p, mode: v }))}
                options={PAYMENT_MODES.map((mode) => ({ value: mode, label: t(`expenses.mode.${mode}`) }))}
              />
            </div>
            <div className="field">
              <label>{t('expenses.date')}</label>
              <input type="date" value={payment.date} max={toDateInput()} onChange={(e) => setPayment((p) => ({ ...p, date: e.target.value }))} />
            </div>
            {/* The UTR off the payment app. Optional — a shopkeeper recording last week's
                cash has none, and refusing the entry would mean the payment goes unrecorded,
                which is worse. But it is the one field that ends the "paisa nahi mila"
                argument later, because it is what the wholesaler can look up himself. */}
            <div className="field">
              <label>{t('purchase.payReference')}</label>
              <input
                value={payment.reference}
                maxLength={30}
                placeholder={t('purchase.payReferencePh')}
                onChange={(e) => setPayment((p) => ({ ...p, reference: e.target.value }))}
              />
              <span className="field-hint">{t('purchase.payReferenceHint')}</span>
            </div>
            <div className="field">
              <label>{t('expenses.note')}</label>
              <input value={payment.note} onChange={(e) => setPayment((p) => ({ ...p, note: e.target.value }))} />
            </div>
            <div className="field" style={{ alignSelf: 'flex-end' }}>
              <button type="submit" className="btn btn-primary btn-inline" disabled={saving || !payment.amount}>
                <RupeeIcon size={17} /> {saving ? t('common.saving') : t('seller.recordSupplierPayment')}
              </button>
            </div>
          </form>
        ) : (
          <p className="empty-state">{t('purchase.fullySettled')}</p>
        )}

        {order.payments?.length > 0 && (
          <div className="table-wrap auto-height" style={{ marginTop: '0.8rem' }}>
            <table className="data-table" style={{ minWidth: "620px" }}>
              <thead>
                <tr>
                  <th>{t('expenses.date')}</th>
                  <th>{t('expenses.modeLabel')}</th>
                  <th>{t('expenses.note')}</th>
                  {/* The other half of the sentence: the shop's book says the cash left,
                      and this says whether the wholesaler has confirmed it arrived. Only
                      he can write it, and it moves no money — see the PurchaseOrder model.
                      Worth a column of its own because "unconfirmed for two weeks" is the
                      thing a shopkeeper wants to spot before it becomes an argument. */}
                  <th>{t('purchase.supplierGot')}</th>
                  <th className="num">{t('seller.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {[...order.payments].reverse().map((p, idx) => (
                  <tr key={p.id || idx}>
                    <td className="cell-muted">{formatDate(p.date, lang)}</td>
                    <td>{t(`expenses.mode.${p.mode}`)}</td>
                    <td>
                      {p.note && <div className="cell-sub">{p.note}</div>}
                      {/* The UTR, on the row that claims the money moved. It was captured by
                          the form and shown nowhere, so the one number either side can look
                          up lived only in the database. */}
                      {p.reference && <div className="cell-strong">{p.reference}</div>}
                      {p.by && <div className="cell-sub">{p.by}</div>}
                    </td>
                    <td>
                      {!p.supplierAck ? (
                        <span className="badge badge-pending">{t('purchase.supplierGotWaiting')}</span>
                      ) : p.supplierAck.state === 'received' ? (
                        <>
                          <span className="badge badge-active">{t('purchase.supplierGotYes')}</span>
                          <div className="cell-sub">{formatDate(p.supplierAck.at, lang)}</div>
                        </>
                      ) : (
                        <>
                          <span className="badge badge-inactive">{t('purchase.supplierGotNo')}</span>
                          <div className="cell-sub">
                            {formatDate(p.supplierAck.at, lang)}
                            {p.supplierAck.note ? ` · ${p.supplierAck.note}` : ''}
                          </div>
                          {p.shopReply && (
                            <div className="cell-sub">
                              {t('purchase.payRepliedOn', { date: formatDate(p.shopReply.at, lang) })}
                              {p.shopReply.note ? ` · ${p.shopReply.note}` : ''}
                            </div>
                          )}
                          {/**
                           * Whose turn it is, off the server's own flag — never off "has he
                           * replied before".
                           *
                           * The first version showed the reply button only while `shopReply`
                           * was empty, so the loop dead-ended one step further along than the
                           * one it fixed: the shop answered once, the wholesaler looked again
                           * and said no a second time, and the screen still showed last
                           * week's reply with no way to say anything back. And in between,
                           * a row that read "Says not received" while the ball was actually
                           * in HIS court — the shopkeeper chasing something already chased.
                           */}
                          {/* Always answerable, exactly as his side is always changeable.
                              Gating this on `needsShop` dead-ended the loop one step further
                              along: he says no a second time, and the shop sees last week's
                              reply with no way to say anything back. The flag still earns
                              its keep as the hint below — whose turn it is is worth SAYING,
                              and worth nobody's screen going quiet over. */}
                          {!p.needsShop && <div className="cell-sub">{t('purchase.payWaitingOnHim')}</div>}
                          <button type="button" className="link-btn" onClick={() => replyToDispute(p)}>
                            {p.shopReply ? t('purchase.payReplyAgain') : t('purchase.payReply')}
                          </button>
                        </>
                      )}
                    </td>
                    <td className="num cell-strong amount-out">{formatRupees(p.amount, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── The delivery screen ──────────────────────────────────────────────────────────
          The counter is the only place and the only moment this can be got right: the crate
          is open, the bill is in the shopkeeper's hand, and the wholesaler's man is standing
          there waiting to be told what to write on his copy. Everything the app needs to
          know about this load has to be asked here, because five minutes later nobody
          remembers whether it was six dabbe or seven.

          Deliberately NOT a confirm dialog. What it replaced was one, and that single yes/no
          is what made short supply unrecordable — the only thing on offer said the whole
          order had arrived, so that is what got tapped, and stock, udhaar and GST all went
          in for goods still sitting in the wholesaler's godown. */}
      {receiveOpen && (
        <Modal
          className="modal-wide"
          onClose={() => setReceiveOpen(false)}
          closeOnBackdrop={!receiving}
          closeOnEscape={!receiving}
          title={t('purchase.receiveTitle')}
          hint={t('purchase.receiveHint')}
          footer={
            <>
              <button type="button" className="btn btn-primary btn-inline" disabled={receiving} onClick={submitReceive}>
                <PackageIcon size={17} /> {receiving ? t('common.saving') : t('purchase.confirmDelivery')}
              </button>
              <button type="button" className="btn btn-secondary btn-inline" disabled={receiving} onClick={() => setReceiveOpen(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
            {/* Said before the delivery, not after it.
                A line with no product in the catalogue takes the goods in and moves no
                stock, and the counter is the only moment fixing that is free — the crate is
                open and the shopkeeper knows what the thing is. Afterwards it is still
                fixable, but he has to be told his stock list is wrong first, which is a
                worse day for everyone. */}
            {unlinkedLines.length > 0 && (
              <div className="error-banner banner-with-action">
                <span>{t('purchase.stockGapPreWarn', { count: unlinkedLines.length })}</span>
                <button
                  type="button"
                  className="btn btn-primary btn-small btn-inline"
                  disabled={receiving}
                  onClick={() => setStockGapOpen(true)}
                >
                  <PackageIcon size={15} /> {t('purchase.stockGapFixNow')}
                </button>
              </div>
            )}

            <div className="table-wrap auto-height" style={{ maxHeight: '46vh' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('seller.productName')}</th>
                    <th className="num">{t('purchase.orderedCol')}</th>
                    <th className="num">{t('purchase.arrivedCol')}</th>
                    <th className="num">{t('purchase.freeCol')}</th>
                    <th className="num">{t('purchase.rate')}</th>
                    <th className="num">{t('purchase.stillDue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item, index) => {
                    const row = receiveLines[index] || {};
                    const expected = firstDelivery ? item.quantity || 0 : item.pendingQuantity || 0;
                    const short = Math.max(0, expected - qtyNum(row.quantity));
                    return (
                      <tr key={index} className={short > 0 ? 'grn-short' : undefined}>
                        <td>
                          <div className="cell-stack">
                            <span className="cell-strong">{item.name}</span>
                            {item.company && <span className="cell-sub">{item.company}</span>}
                            {/* On the row itself, where the eye already is. The banner says
                                how many; this says which. */}
                            {!item.product && (
                              <span className="tag-nostock">{t('purchase.stockGapWillNotStock')}</span>
                            )}
                          </div>
                        </td>
                        <td className="num cell-muted">
                          {formatQty(expected, lang)} {item.unit}
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            inputMode="decimal"
                            className="grn-qty"
                            value={row.quantity ?? ''}
                            onChange={(e) => setReceiveLine(index, { quantity: e.target.value })}
                          />
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            inputMode="decimal"
                            className="grn-qty"
                            placeholder="0"
                            value={row.freeQuantity ?? ''}
                            onChange={(e) => setReceiveLine(index, { freeQuantity: e.target.value })}
                          />
                        </td>
                        <td className="num">
                          {/* The rate is normally already known and simply confirmed here. When
                              the order went out on the phone with no rates at all it is blank
                              and required, because receiving writes it into the product's cost,
                              the batch ledger and the wholesaler's udhaar — a zero there
                              reports 100% margin on the item forever. */}
                          <input
                            type="number"
                            min="0"
                            step="any"
                            inputMode="decimal"
                            className="grn-qty"
                            placeholder={item.rateUnknown ? t('purchase.rateNeeded') : ''}
                            value={row.costPrice ?? ''}
                            onChange={(e) => setReceiveLine(index, { costPrice: e.target.value })}
                          />
                        </td>
                        <td className="num">
                          {short > 0 ? (
                            <span className="cell-strong amount-out">
                              {formatQty(short, lang)} {item.unit}
                            </span>
                          ) : (
                            <span className="cell-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* What the shopkeeper is about to sign for, in rupees, before he signs for it.
                A count of short lines is a statistic; "₹1,240 kam ka maal" is the number he
                would have argued with the wholesaler's man about. */}
            <div className="info-banner" style={{ marginTop: '0.8rem' }}>
              {shortLineCount > 0
                ? t('purchase.receiveShortSummary', {
                    count: shortLineCount,
                    amount: formatRupees(receiveValue, lang),
                  })
                : t('purchase.receiveFullSummary', { amount: formatRupees(receiveValue, lang) })}
            </div>

            {/* The question the whole feature turns on, and the one the app must never answer
                by itself: is the balance coming or not? Assume "pending" and a load nobody is
                chasing sits open forever; assume "closed" and the shop quietly writes off
                goods it may have already paid an advance on. So it is asked, in the two
                sentences a shopkeeper would actually say, and only when there IS a shortfall
                — on a complete delivery the question does not exist and must not be shown.

                cols-2 rather than the grid's own auto-fit: unequal tracks would give the
                longer sentence more of the row than the other, and a pair of unequal cards
                reads as a recommendation this screen is not allowed to make. */}
            {shortLineCount > 0 && (
              <div className="form-grid cols-2" style={{ marginTop: '0.8rem' }}>
                <label className={`grn-choice${receiveBalance === 'pending' ? ' selected' : ''}`}>
                  <input
                    type="radio"
                    name="po-balance"
                    checked={receiveBalance === 'pending'}
                    onChange={() => setReceiveBalance('pending')}
                  />
                  <span>
                    <strong>{t('purchase.balancePendingLabel')}</strong>
                    <small>{t('purchase.balancePendingHint')}</small>
                  </span>
                </label>
                <label className={`grn-choice${receiveBalance === 'close' ? ' selected' : ''}`}>
                  <input
                    type="radio"
                    name="po-balance"
                    checked={receiveBalance === 'close'}
                    onChange={() => setReceiveBalance('close')}
                  />
                  <span>
                    <strong>{t('purchase.balanceCloseLabel')}</strong>
                    <small>{t('purchase.balanceCloseHint')}</small>
                  </span>
                </label>
              </div>
            )}

            <div className="form-grid" style={{ marginTop: '0.8rem' }}>
              <div className="field field-span2">
                <label>{t('purchase.deliveryNote')}</label>
                <input
                  type="text"
                  maxLength={300}
                  value={receiveNote}
                  placeholder={t('purchase.deliveryNotePlaceholder')}
                  onChange={(e) => setReceiveNote(e.target.value)}
                />
              </div>
            </div>

            <p className="field-hint" style={{ marginTop: '0.6rem' }}>{t('purchase.receiveIrreversible')}</p>
            {/* `.modal-actions`, not `.row-actions` — on a delivery of thirty items the
                table scrolls and the confirm button has to stay in reach. That is what
                `.modal-tall` on the card above sticks to the bottom. */}
        </Modal>
      )}

      {/* Opens over the delivery screen and leaves it mounted underneath — the quantities the
          shopkeeper has already typed into it are not thrown away to go and fix a link.
          Before the delivery it takes the lines the form says are arriving; after it, the
          order's own list of goods that reached no shelf. */}
      {stockGapOpen && (
        <StockGapFixer
          order={order}
          lines={receiveOpen ? unlinkedLines : undefined}
          onOrderChange={setOrder}
          onClose={() => setStockGapOpen(false)}
        />
      )}

      {waSheet && <WhatsappSheet {...waSheet} onClose={() => setWaSheet(null)} />}
    </>
  );
}
