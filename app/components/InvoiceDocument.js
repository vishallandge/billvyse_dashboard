'use client';

import UpiQr from './UpiQr';
import { formatRupees, formatQty } from '../../lib/format';
import { labelsFor, docKindById, renumberFor } from '../../lib/invoiceLabels';

// The printed bill. This is the one screen in the app a customer takes home, so it is
// deliberately styled as a paper document rather than as dashboard UI: fixed ink-on-white
// colours (never the dark/light theme — preview must match what leaves the printer),
// tabular figures, and every block a real Indian invoice carries.
//
// One markup tree, many documents. Everything the seller can choose is a class on the
// sheet, never a different component:
//   • format   — "gst" (HSN + rate-wise tax + summary) or "simple" (no tax anywhere)
//   • template — layout: classic / modern / tally / elegant / compact / letterhead
//   • theme    — accent colour, ink-safe on white
//   • paper    — A4 / A5 / 80mm / 58mm
//   • docKind  — invoice / cash memo / estimate / proforma / delivery challan
//   • lang     — the language printed on the paper (not the app's language)
// Adding a look means adding CSS, not a second component — which is the only way six
// layouts stay in sync when the tax block changes.
//
// Money is never recomputed here. Every rupee on this page came off buildInvoice() on the
// server; the component's whole job is where to put it.

function initials(name) {
  return String(name || 'D')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

function money(value) {
  // Latin digits always, in every printed language. A bank, a CA's software and the GST
  // portal all read ₹1,240.00; १,२४०.०० on a tax invoice reads as a novelty.
  return formatRupees(value ?? 0);
}

function invoiceDate(value) {
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function invoiceTime(value) {
  return new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// An expiry is printed as a month, because that is what the strip says — and because a
// medicine is sellable for the whole of its expiry month, a day would read as tighter than
// the truth. "06/28", the way every pharmacy bill in the country writes it.
function formatExpiry(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getFullYear()).slice(-2)}`;
}

const PAYMENT_LABEL = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank: 'Bank',
  khata: 'Khata (Credit)',
  split: 'Split payment',
};

const STAMP_TEXT = {
  paid: 'PAID',
  partial: 'PART PAID',
  unpaid: 'UNPAID',
};

const COPY_KEY = {
  original: 'copyOriginal',
  duplicate: 'copyDuplicate',
  triplicate: 'copyTriplicate',
};

const KIND_NOTE = {
  cashmemo: 'noteCashMemo',
  estimate: 'noteEstimate',
  proforma: 'noteProforma',
  challan: 'noteChallan',
  creditnote: 'noteCreditNote',
  debitnote: 'noteDebitNote',
};

const ORDER_TYPE_KEY = {
  dine_in: 'orderTypeDineIn',
  parcel: 'orderTypeParcel',
  delivery: 'orderTypeDelivery',
};

export default function InvoiceDocument({
  invoice,
  format = 'gst',
  theme = 'marigold',
  paper = 'a4',
  template = 'classic',
  docKind = 'auto',
  lang = 'en',
  density = 'normal',
  inkSaver = false,
  // Either an id ('original' | 'duplicate' | 'triplicate' | 'none') or a literal string to
  // print as-is. The literal form is what the Settings preview has always passed.
  copy = 'original',
  copyLabel = null,
  showStamp = true,
  showSignature = true,
  showBank = true,
  showUpiQr = true,
  showHsn = true,
  showMrp = false,
  showDiscount = true,
  showBatch = true,
  showWatermark = true,
  // The "Powered by BillVyse" credit at the foot. Unlike every other flag on this list
  // it is not the shopkeeper's to choose on the print screen — the server resolves it
  // against the plan and sends it on `meta`. Defaults to on so a caller that hasn't been
  // updated still prints it.
  showAppCredit = true,
  showSavings = true,
  showCustomerSign = false,
  showOutstanding = true,
  showQrPay = true,
  extras = null,
}) {
  if (!invoice) return null;

  const t = labelsFor(lang);
  const kind = docKindById(docKind);
  const { seller, buyer, items, totals, gstSummary, payment, meta, bank, returns } = invoice;

  // GST columns only make sense when the shop is registered *and* the seller asked for
  // the tax format — an unregistered kirana printing a "Tax Invoice" would be illegal.
  const withGst = format === 'gst' && invoice.isGstRegistered && totals.totalGst > 0;

  // The title is the one thing on this page with legal weight. `auto` prints whatever the
  // data earns; every other kind is a deliberate override and carries its own disclaimer
  // below, because a quotation that looks like a tax invoice is how a buyer ends up
  // claiming input credit on a sale that never happened.
  const autoTitle = withGst
    ? t('taxInvoice')
    : invoice.isGstRegistered && format === 'gst'
      ? t('billOfSupply')
      : t('invoice');

  // A credit note is the one kind whose title also depends on registration: an unregistered
  // shop issues a plain return note, because it has no output tax to reduce.
  const creditTitle = invoice.isGstRegistered ? t('creditNote') : t('returnNote');
  // A debit note is not the same case. An unregistered shop still raises one — it is a
  // commercial claim on a wholesaler, and it is the paper that gets the money back — so the
  // title never softens; only the tax columns drop away.
  const debitTitle = t('debitNote');
  // Keyed off the resolved kind, not the raw prop: an unrecognised value falls back to
  // `auto`, which prints a correct document rather than a blank title bar.
  const title =
    kind.id === 'auto'
      ? autoTitle
      : kind.id === 'creditnote'
        ? creditTitle
        : kind.id === 'debitnote'
          ? debitTitle
          : t({ cashmemo: 'cashMemo', estimate: 'estimate', proforma: 'proforma', challan: 'challan' }[kind.id]);
  const documentNumber = renumberFor(invoice.number, kind.id);
  const kindNote = KIND_NOTE[kind.id] ? t(KIND_NOTE[kind.id]) : null;

  // A cancelled bill must never leave the shop looking live. It stays printable — the shop
  // needs the cancelled copy for its own file — but it comes out banded and stamped, which
  // is the entire reason it is printable at all.
  const cancelled = Boolean(meta.isCancelled);
  const hidePayment = Boolean(kind.hidePayment);
  const stamp = cancelled
    ? t('cancelled')
    : !hidePayment && !kind.hideStamp
      ? STAMP_TEXT[payment.status]
      : null;

  const printedCopyLabel =
    copyLabel !== null ? copyLabel : COPY_KEY[copy] ? t(COPY_KEY[copy]) : '';

  const hsnColumn = withGst && showHsn && items.some((item) => item.hsnCode);
  // Goods are classified by HSN, services by SAC — same column, and calling a haircut's
  // 999721 an "HSN" is wrong on its face to the one reader who checks, the buyer's CA.
  const hasService = items.some((item) => item.kind === 'service');
  const hasGoods = items.some((item) => item.kind !== 'service');
  const hsnHeading = hasService && hasGoods ? t('hsnSac') : hasService ? t('sac') : t('hsn');
  const mrpColumn = showMrp && items.some((item) => item.mrp > 0);
  // Only worth a column when something actually sits in it — a discount column of eight
  // em-dashes is column width spent on nothing.
  const discountColumn = showDiscount && items.some((item) => item.discountAmount > 0);

  // A sale that crosses a state border carries one IGST line at the full rate instead of
  // CGST + SGST at half each. The rupees are identical; the presentation is not, and an
  // invoice that splits an interstate sale the wrong way cannot be claimed against by the
  // buyer — which is the entire reason a B2B customer asks for a GST invoice.
  const interState = Boolean(invoice.isInterState);
  const taxColumns = interState
    ? [{ key: 'igst', label: 'IGST', rateOf: (rate) => rate }]
    : [
        { key: 'cgst', label: 'CGST', rateOf: (rate) => rate / 2 },
        { key: 'sgst', label: 'SGST', rateOf: (rate) => rate / 2 },
      ];

  // Column count for the "continued" / spacer rows — kept in one place so a new column can
  // never quietly break the table foot.
  const extraColumns = [hsnColumn, mrpColumn, discountColumn].filter(Boolean).length;

  const note = extras?.notes?.trim();
  const outstanding = buyer.outstanding;
  // Worth printing only when the shop actually runs a khata for this customer and the
  // number says something the bill total doesn't already say.
  const showAccount =
    showOutstanding && !hidePayment && Number(outstanding) > 0 && Number(outstanding) !== Number(totals.balanceDue);

  // The 58mm roll is the 80mm roll, narrower: it wears both classes so it inherits every
  // "restack into one column, drop the tax columns" rule already written for thermal
  // instead of forking a second copy of them that would drift.
  const paperClasses = paper === 'thermal58' ? 'inv-paper-thermal inv-paper-thermal58' : `inv-paper-${paper}`;

  const sheetClasses = [
    'invoice-sheet',
    `inv-theme-${theme}`,
    paperClasses,
    `inv-tpl-${template}`,
    `inv-dens-${density}`,
    cancelled ? 'inv-status-cancelled' : `inv-status-${payment.status}`,
    `inv-lang-${lang}`,
    inkSaver ? 'inv-mono' : '',
    withGst ? 'inv-has-tax' : 'inv-no-tax',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={sheetClasses}>
      {showWatermark && (
        <div className="inv-watermark" aria-hidden="true">
          {seller.shopName}
        </div>
      )}

      <div className="inv-ribbon" aria-hidden="true" />

      <header className="inv-head">
        <div className="inv-brand">
          {/**
           * The shop's logo, zoomed slightly and cropped to fill its box rather than
           * letterboxed inside it — that is deliberate and it is what shops see today.
           *
           * What was not deliberate: the box was a hard-coded inline `100px` square. The
           * `.inv-logo` class carries a size per paper (19mm on A4, 15mm on A5, 10mm on a
           * roll), and an inline pixel value reached by none of those rules meant every
           * shop with a logo printed a 26mm square on an 80mm till roll — wider than the
           * monogram beside it and paid for in roll length on every single bill. The
           * frame is a class again so the paper decides the size; the crop moves to CSS
           * next to it, unchanged.
           */}
          {seller.logoUrl ? (
            <div className="inv-logo inv-logo-frame">
              <img src={seller.logoUrl} alt="" />
            </div>
          ) : (
            <div className="inv-logo inv-monogram">{initials(seller.shopName)}</div>
          )}
          {/* A stray <br> sat here — a blank line above the shop name on every template,
              every paper size and every bill this app has ever printed. */}
          <div className="inv-brand-text">
            <h1 className="inv-shop-name">{seller.shopName}</h1>
            {seller.legalName && seller.legalName !== seller.shopName && (
              <p className="inv-legal-name">{seller.legalName}</p>
            )}
            {seller.tagline && <p className="inv-tagline">{seller.tagline}</p>}
            {(seller.address || seller.storeName) && (
              <p className="inv-address">
                {seller.storeName && <span className="inv-store-tag">{seller.storeName}</span>}
                {seller.address}
                {seller.pincode ? ` — ${seller.pincode}` : ''}
              </p>
            )}
            <p className="inv-contact">
              {seller.phone && <span>☏ {seller.phone}</span>}
              {seller.email && <span>✉ {seller.email}</span>}
              {seller.upiId && <span>UPI: {seller.upiId}</span>}
            </p>
            {(seller.gstin || seller.fssai || seller.pan) && (
              <div className="inv-idents">
                {seller.gstin && (
                  <span>
                    <em>GSTIN</em> {seller.gstin}
                  </span>
                )}
                {seller.pan && (
                  <span>
                    <em>PAN</em> {seller.pan}
                  </span>
                )}
                {seller.fssai && (
                  <span>
                    <em>FSSAI</em> {seller.fssai}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="inv-doc">
          <div className="inv-doc-type">{title}</div>
          {/* Rule 49: a composition dealer's Bill of Supply carries this declaration, and it
              has to be at the top rather than buried in the footer. It is what tells the
              buyer no input credit can be claimed against this document — the single most
              important sentence on a composition dealer's paper. */}
          {meta.composition && <div className="inv-composition-note">{t('compositionDeclaration')}</div>}
          {printedCopyLabel && <div className="inv-copy-label">{printedCopyLabel}</div>}
          <table className="inv-doc-meta">
            <tbody>
              <tr>
                <th>{kind.isTax ? t('invoiceNo') : t('documentNo')}</th>
                <td className="inv-strong">{documentNumber}</td>
              </tr>
              <tr>
                <th>{t('date')}</th>
                <td>
                  {invoiceDate(invoice.date)} · {invoiceTime(invoice.date)}
                </td>
              </tr>
              {/* The reference an accountant matches a credit note on. Without it the note
                  is a loose piece of paper that reduces nothing. */}
              {invoice.against && (
                <tr>
                  <th>{t('againstInvoice')}</th>
                  <td className="inv-strong">
                    {invoice.against.invoiceNumber}
                    {invoice.against.invoiceDate ? ` · ${invoiceDate(invoice.against.invoiceDate)}` : ''}
                  </td>
                </tr>
              )}
              {invoice.reason && (
                <tr>
                  <th>{t('reason')}</th>
                  <td>{invoice.reason}</td>
                </tr>
              )}
              {/* The date the customer themselves named at the counter. A due date agreed
                  and written nowhere is a due date nobody remembers. */}
              {!hidePayment && meta.dueDate && totals.balanceDue > 0 && (
                <tr>
                  <th>{t('dueDate')}</th>
                  <td className="inv-strong">{invoiceDate(meta.dueDate)}</td>
                </tr>
              )}
              {/* Restaurant / dhaba floor. Absent for the twenty verticals with no tables. */}
              {meta.table && (
                <tr>
                  <th>{t('tableNo')}</th>
                  <td>
                    {meta.table.name}
                    {meta.table.orderType ? ` · ${t(ORDER_TYPE_KEY[meta.table.orderType] || 'orderTypeDineIn')}` : ''}
                    {meta.table.guests ? ` · ${meta.table.guests} ${t('guests')}` : ''}
                  </td>
                </tr>
              )}
              {/* A quotation without an expiry date is a price the shop is bound to forever.
                  Only estimates carry it, and only when the seller filled one in. */}
              {kind.validity && extras?.validUntil && (
                <tr>
                  <th>{t('validUntil')}</th>
                  <td>{invoiceDate(extras.validUntil)}</td>
                </tr>
              )}
              {withGst && meta.placeOfSupply && (
                <tr>
                  <th>{t('placeOfSupply')}</th>
                  <td>
                    {meta.placeOfSupply}
                    {seller.stateCode ? ` (${seller.stateCode})` : ''}
                  </td>
                </tr>
              )}
              {/* Wholesale/transport fields. Typed on the print screen for this one print —
                  a kirana counter never sees them, a distributor sending a truck always
                  needs them, and neither has to be configured. */}
              {extras?.poNumber && (
                <tr>
                  <th>{t('poNumber')}</th>
                  <td>{extras.poNumber}</td>
                </tr>
              )}
              {extras?.transport && (
                <tr>
                  <th>{t('transport')}</th>
                  <td>{extras.transport}</td>
                </tr>
              )}
              {extras?.vehicleNo && (
                <tr>
                  <th>{t('vehicleNo')}</th>
                  <td>{extras.vehicleNo}</td>
                </tr>
              )}
              {extras?.ewayBill && (
                <tr>
                  <th>{t('ewayBill')}</th>
                  <td>{extras.ewayBill}</td>
                </tr>
              )}
              {meta.counter && (
                <tr>
                  <th>{t('counter')}</th>
                  <td>{meta.counter}</td>
                </tr>
              )}
              {meta.cashier && (
                <tr>
                  <th>{t('billedBy')}</th>
                  <td>{meta.cashier}</td>
                </tr>
              )}
              {/* Who actually did the work, as opposed to who rang it up. A salon customer
                  asks for the same stylist next time by reading this off their bill. */}
              {meta.servedBy && meta.servedBy !== meta.cashier && (
                <tr>
                  <th>{t('servedBy')}</th>
                  <td>{meta.servedBy}</td>
                </tr>
              )}
              {/* Rule 46(p): a tax invoice has to state whether tax is payable on reverse
                  charge. This app never bills under RCM, so it is always "No" — but printed
                  "No" is compliant and silence is not. */}
              {withGst && (
                <tr>
                  <th>{t('reverseCharge')}</th>
                  <td>{t('no')}</td>
                </tr>
              )}
              {/* The Schedule H1/X register entry. Printed on the document because that is
                  the copy a drug inspector asks to see. */}
              {meta.prescription && (
                <tr>
                  <th>{t('prescription')}</th>
                  <td>
                    {meta.prescription.doctorName}
                    {meta.prescription.patientName ? ` · ${meta.prescription.patientName}` : ''}
                    {meta.prescription.number ? ` · ${meta.prescription.number}` : ''}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Modern template only (CSS-hidden elsewhere): the number the reader is actually
              looking for, at the top of the page instead of the bottom. */}
          <div className="inv-head-total">
            <span>{t('grandTotal')}</span>
            <strong>{money(totals.grandTotal)}</strong>
          </div>
        </div>
      </header>

      {cancelled && (
        <p className="inv-cancel-band">
          {t('cancelled')} — {meta.cancelReason || t('cancelledNote')}
        </p>
      )}

      {kindNote && <p className="inv-kind-note">{kindNote}</p>}

      <section className="inv-parties">
        <div className="inv-party">
          <h2>{t('billTo')}</h2>
          <p className="inv-party-name">{buyer.name === 'Cash Customer' ? t('cashCustomer') : buyer.name}</p>
          {/* The person behind the firm. `name` above is the entity the document is made
              out to — a customer's own legal name, or a wholesaler's company on a debit
              note — and this is who to ask for when the shop rings the number below. The
              debit note has been sending this field since it shipped and nothing rendered
              it, so the contact was quietly dropped off every one of those documents. */}
          {buyer.contactName && <p className="inv-party-contact">{t('attn')}: {buyer.contactName}</p>}
          {buyer.phone && <p>☏ {buyer.phone}</p>}
          {buyer.address && <p>{buyer.address}</p>}
          {buyer.gstin && (
            <p>
              <em>GSTIN</em> {buyer.gstin}
              {buyer.state ? ` · ${buyer.state}` : ''}
            </p>
          )}
        </div>
        {!hidePayment && (
          <div className="inv-party inv-party-pay">
            {/* On a credit note this block answers "how did the money go back", not "how
                did it come in" — same place on the page, opposite direction. */}
            <h2>{invoice.against ? t('refundMode') : t('payment')}</h2>
            <p className="inv-party-name">{PAYMENT_LABEL[payment.mode] || payment.mode}</p>
            {/* A split bill's tender breakup — without it the invoice says "Split payment"
                and leaves the reader to guess how much came in which way. */}
            {payment.breakup?.length > 0 && payment.mode === 'split' && (
              <p className="inv-pay-breakup">
                {payment.breakup.map((line) => `${PAYMENT_LABEL[line.mode] || line.mode} ${money(line.amount)}`).join(' · ')}
              </p>
            )}
            {/* A credit note has no payment status of its own — "Paid in full" against a
                refund reads as though the customer still owed something. */}
            {!invoice.against && (
              <p>
                {t('status')}:{' '}
                <span className={`inv-pill inv-pill-${payment.status}`}>
                  {payment.status === 'paid'
                    ? t('paidInFull')
                    : payment.status === 'partial'
                      ? t('partiallyPaid')
                      : t('paymentDue')}
                </span>
              </p>
            )}
            {totals.balanceDue > 0 && (
              <p className="inv-due-line">
                {t('balanceDue')} <strong>{money(totals.balanceDue)}</strong>
              </p>
            )}
            {payment.couponCode && (
              <p>
                {t('coupon')}: {payment.couponCode}
              </p>
            )}
          </div>
        )}
      </section>

      <table className="inv-items">
        <thead>
          <tr>
            <th className="inv-col-sr">{t('sr')}</th>
            <th className="inv-col-item">{t('itemDescription')}</th>
            {hsnColumn && <th className="inv-col-hsn">{hsnHeading}</th>}
            {mrpColumn && <th className="inv-col-mrp">{t('mrp')}</th>}
            <th className="inv-col-qty">{t('qty')}</th>
            <th className="inv-col-rate">{t('rate')}</th>
            {discountColumn && <th className="inv-col-disc">{t('disc')}</th>}
            {withGst && <th className="inv-col-taxable">{t('taxable')}</th>}
            {withGst && taxColumns.map((col) => <th key={col.key} className="inv-col-tax">{col.label}</th>)}
            <th className="inv-col-amount">{t('amount')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.sr}>
              <td className="inv-col-sr">{item.sr}</td>
              <td className="inv-col-item">
                <span className="inv-item-name">{item.name}</span>
                {/* A line the document itself has something to say about. Only a debit note
                    sets this today — "Expired stock", "Rate difference" — and it has to sit
                    beside the line rather than in a covering note, because a wholesaler
                    settles each reason under a different policy and his clerk reads down
                    the column. Absent on every other document, which is why it is a plain
                    per-line string and not a block of its own. */}
                {item.note && <span className="inv-item-note">{item.note}</span>}
                {item.returnedQuantity > 0 && (
                  <span className="inv-item-note">
                    {t('returned')}: {formatQty(item.returnedQuantity)} {item.unit}
                  </span>
                )}
                {/* The line a jewellery bill is actually read for: what it weighed, at what
                    purity, at what rate, and what the labour came to. Sits under the item
                    name rather than in columns of its own so an ordinary invoice — every
                    other trade in the app — is untouched. */}
                {item.weightPricing && (
                  <span className="inv-item-note inv-weight">
                    {item.weightPricing.purity ? `${item.weightPricing.purity} · ` : ''}
                    {item.weightPricing.netWeight}g net
                    {item.weightPricing.grossWeight ? ` (gross ${item.weightPricing.grossWeight}g)` : ''}
                    {' · '}₹{item.weightPricing.rate}/g
                    {item.weightPricing.wastagePercent > 0 ? ` · wastage ${item.weightPricing.wastagePercent}%` : ''}
                    {item.weightPricing.makingCharge > 0 ? ` · making ₹${item.weightPricing.makingCharge}` : ''}
                    {item.weightPricing.hallmarkNumber ? ` · HUID ${item.weightPricing.hallmarkNumber}` : ''}
                  </span>
                )}
                {/* The two things an electronics, mobile, autoparts or appliance bill is
                    kept for after the customer walks out. A warranty claim is refused
                    without the serial number on the bill, and a warranty printed as
                    "12 months" makes the customer do the arithmetic eleven months later
                    while arguing at the counter — so it prints as a date. */}
                {(item.serialNumber || item.warrantyUntil) && (
                  <span className="inv-item-note inv-serial">
                    {item.serialNumber ? `${t('serialNo')} ${item.serialNumber}` : ''}
                    {item.serialNumber && item.warrantyUntil ? ' · ' : ''}
                    {item.warrantyUntil ? t('warrantyTill', { date: invoiceDate(item.warrantyUntil) }) : ''}
                  </span>
                )}
                {/* Which lots this line went out of. A chemist's bill is read for exactly
                    this — it is what a returned strip is checked against and what a recall
                    is traced through — and every pharmacy package in the country prints it.
                    A line can span two lots when the older one runs out mid-sale, so each
                    gets its own row with the quantity that came from it. Absent entirely
                    for products that don't track batches, which is every kirana line. */}
                {showBatch && item.batches?.length > 0 && (
                  <span className="inv-item-note inv-batches">
                    {item.batches.map((lot) => (
                      <span className="inv-batch" key={lot.batchNumber}>
                        {t('batch')} <b>{lot.batchNumber}</b>
                        {lot.expiryDate ? ` · ${t('expiry')} ${formatExpiry(lot.expiryDate)}` : ''}
                        {item.batches.length > 1 ? ` · ${formatQty(lot.quantity)} ${item.unit}` : ''}
                      </span>
                    ))}
                  </span>
                )}
              </td>
              {hsnColumn && <td className="inv-col-hsn">{item.hsnCode || '—'}</td>}
              {mrpColumn && <td className="inv-col-mrp">{item.mrp > 0 ? money(item.mrp) : '—'}</td>}
              <td className="inv-col-qty">
                {formatQty(item.quantity)} <span className="inv-unit">{item.unit}</span>
              </td>
              {/* `price` is what the customer was actually charged per unit; `rate` is the
                  pre-tax figure the tax columns are built from. `mrp` is neither — it is
                  the printed maximum, present only when the shop sold below it, and shown
                  struck through beside the rate rather than in place of it (unless MRP has
                  a column of its own, where repeating it would be noise). */}
              <td className="inv-col-rate">
                {money(withGst ? item.rate : item.price ?? item.mrp)}
                {!mrpColumn && item.mrp > 0 && item.mrp > item.price && (
                  <span className="inv-mrp-struck">{money(item.mrp)}</span>
                )}
              </td>
              {discountColumn && (
                <td className="inv-col-disc">
                  {item.discountAmount > 0 ? `− ${money(item.discountAmount)}` : '—'}
                  {item.discountPercent > 0 && <span className="inv-rate-tag">{item.discountPercent}%</span>}
                </td>
              )}
              {withGst && <td className="inv-col-taxable">{money(item.taxableValue)}</td>}
              {withGst &&
                taxColumns.map((col) => (
                  <td key={col.key} className="inv-col-tax">
                    {money(item[col.key] || 0)}
                    <span className="inv-rate-tag">{col.rateOf(item.gstRate).toFixed(1)}%</span>
                  </td>
                ))}
              <td className="inv-col-amount">{money(item.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="inv-col-sr" />
            <td className="inv-col-item">
              {t('total')} · {totals.itemCount} {totals.itemCount === 1 ? t('item') : t('items')}
            </td>
            {/* These carry their column class even though they are empty. Thermal paper
                hides whole columns by class, and an unclassed placeholder would survive
                the hide and shunt every cell after it one column to the left. */}
            {hsnColumn && <td className="inv-col-hsn" />}
            {mrpColumn && <td className="inv-col-mrp" />}
            <td className="inv-col-qty">{formatQty(totals.totalQuantity)}</td>
            <td className="inv-col-rate" />
            {discountColumn && (
              <td className="inv-col-disc">{totals.itemDiscount > 0 ? `− ${money(totals.itemDiscount)}` : ''}</td>
            )}
            {withGst && <td className="inv-col-taxable">{money(totals.taxableValue)}</td>}
            {withGst && taxColumns.map((col) => <td key={col.key} className="inv-col-tax">{money(totals[col.key] || 0)}</td>)}
            <td className="inv-col-amount">{money(totals.grossTotal)}</td>
          </tr>
        </tfoot>
      </table>

      <section className="inv-lower">
        <div className="inv-lower-left">
          {withGst && gstSummary.length > 0 && (
            <div className="inv-block">
              <h2>{t('taxSummary')}</h2>
              <table className="inv-tax-summary">
                <thead>
                  <tr>
                    <th>{t('gstPercent')}</th>
                    <th>{t('taxable')}</th>
                    {taxColumns.map((col) => <th key={col.key}>{col.label}</th>)}
                    <th>{t('totalTax')}</th>
                  </tr>
                </thead>
                <tbody>
                  {gstSummary.map((row) => (
                    <tr key={row.gstRate}>
                      <td>{row.gstRate}%</td>
                      <td>{money(row.taxableValue)}</td>
                      {taxColumns.map((col) => <td key={col.key}>{money(row[col.key] || 0)}</td>)}
                      <td>{money(row.gstAmount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>{t('total')}</td>
                    <td>{money(totals.taxableValue)}</td>
                    {taxColumns.map((col) => <td key={col.key}>{money(totals[col.key] || 0)}</td>)}
                    <td>{money(totals.totalGst)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="inv-block inv-words">
            <h2>{t('amountInWords')}</h2>
            <p>{invoice.amountInWords}</p>
            {!hidePayment && invoice.balanceInWords && (
              <p className="inv-words-due">
                {t('balanceInWords')}: {invoice.balanceInWords}
              </p>
            )}
          </div>

          {/* What this customer owes across every bill, not just this one. On a khata sale
              the bill total answers "what did I buy today"; this answers the question the
              customer actually asks at the counter — "mera total kitna hua?" */}
          {showAccount && (
            <div className="inv-block inv-account">
              <h2>{t('accountSummary')}</h2>
              <table className="inv-kv">
                <tbody>
                  <tr>
                    <th>{t('thisBill')}</th>
                    <td>{money(totals.balanceDue > 0 ? totals.balanceDue : 0)}</td>
                  </tr>
                  <tr className="inv-account-total">
                    <th>{t('totalOutstanding')}</th>
                    <td>{money(outstanding)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {showBank && bank && (
            <div className="inv-block">
              <h2>{t('bankDetails')}</h2>
              <table className="inv-kv">
                <tbody>
                  {bank.accountName && (
                    <tr>
                      <th>{t('acName')}</th>
                      <td>{bank.accountName}</td>
                    </tr>
                  )}
                  {bank.name && (
                    <tr>
                      <th>{t('bank')}</th>
                      <td>
                        {bank.name}
                        {bank.branch ? ` · ${bank.branch}` : ''}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <th>{t('acNo')}</th>
                    <td>{bank.accountNumber}</td>
                  </tr>
                  {bank.ifsc && (
                    <tr>
                      <th>{t('ifsc')}</th>
                      <td>{bank.ifsc}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {returns.length > 0 && (
            <div className="inv-block inv-returns">
              <h2>{t('returnsAdjusted')}</h2>
              {returns.map((entry, index) => (
                <p key={index}>
                  {entry.items.map((line) => `${line.name} × ${formatQty(line.quantity)}`).join(', ')} —{' '}
                  <strong>{money(entry.amount)}</strong>
                  {entry.reason ? ` (${entry.reason})` : ''}
                </p>
              ))}
            </div>
          )}

          {note && (
            <div className="inv-block inv-notes">
              <h2>{t('notes')}</h2>
              <p>{note}</p>
            </div>
          )}

          {meta.terms && (
            <div className="inv-block inv-terms">
              <h2>{t('terms')}</h2>
              <p>{meta.terms}</p>
            </div>
          )}
        </div>

        <div className="inv-lower-right">
          <table className="inv-totals">
            <tbody>
              <tr>
                <th>{withGst ? t('taxableValue') : t('subTotal')}</th>
                <td>{money(withGst ? totals.taxableValue : totals.grossTotal)}</td>
              </tr>
              {/* A trade discount taken off the lines themselves — it reduced the taxable
                  value above, so it belongs here, before the tax rows. */}
              {totals.itemDiscount > 0 && (
                <tr className="inv-discount">
                  <th>{t('itemDiscount')}</th>
                  <td>− {money(totals.itemDiscount)}</td>
                </tr>
              )}
              {/* Anything else that came off BEFORE the tax split — a wholesaler's cash
                  discount, which reduces the taxable value and therefore the credit the
                  buyer may claim. Absent on a counter bill, where every reduction is
                  either on the line or after the tax. */}
              {(totals.preTaxLines || []).map((line, index) => (
                <tr className="inv-discount" key={`pretax-${index}`}>
                  <th>{line.label}</th>
                  <td>− {money(Math.abs(line.amount))}</td>
                </tr>
              ))}
              {/* The shelf scheme named on the document. Its rupees are already inside the
                  row above — an offer IS a line discount, which is exactly what makes the
                  tax on it correct under Circular 92/11/2019 — so this row carries no
                  amount of its own. It is here because a customer checks the invoice
                  against what the shelf card promised, and a number cannot answer that. */}
              {(invoice.offers || []).map((entry, index) => (
                <tr className="inv-discount" key={index}>
                  <th>{entry.name}</th>
                  <td>{entry.freeUnits > 0 ? `${formatQty(entry.freeUnits)} ${t('free')}` : `− ${money(entry.discount)}`}</td>
                </tr>
              ))}
              {withGst && (
                <>
                  {taxColumns.map((col) => (
                    <tr key={col.key}>
                      <th>{col.label}</th>
                      <td>{money(totals[col.key] || 0)}</td>
                    </tr>
                  ))}
                  <tr>
                    <th>{t('totalInclGst')}</th>
                    {/* Taxable plus the tax rows immediately above — which on a counter
                        bill IS `grossTotal`, and on a bill carrying a pre-tax discount is
                        not. Printing the pre-discount gross here made the row read one
                        discount larger than the two lines it is supposed to total, and a
                        column a reader cannot add up is a column they stop trusting. */}
                    <td>{money(totals.totalInclGst ?? totals.grossTotal)}</td>
                  </tr>
                </>
              )}
              {/* Charges added after the tax block — freight, hamali, other charges.
                  A counter sale never has any and never sends this, so nothing on a kirana
                  bill changes. A wholesaler's bill always does, and without a row for them
                  the column stops adding up: the reader follows taxable + tax = total, then
                  the reductions, and lands on a grand total that is silently ₹150 larger
                  than everything above it. They carry no tax of their own here — see
                  backend/utils/purchaseTotals.js on why inventing a rate for freight would
                  put a made-up number into somebody's input-credit claim. */}
              {(totals.chargeLines || []).map((line, index) => (
                <tr key={`charge-${index}`}>
                  <th>{line.label}</th>
                  <td>+ {money(line.amount)}</td>
                </tr>
              ))}
              {/* Everything below the tax block is a post-tax reduction on the total. */}
              {totals.billDiscount > 0 && (
                <tr className="inv-discount">
                  <th>
                    {t('discount')}
                    {totals.billDiscountPercent > 0 ? ` (${totals.billDiscountPercent}%)` : ''}
                  </th>
                  <td>− {money(totals.billDiscount)}</td>
                </tr>
              )}
              {totals.couponDiscount > 0 && (
                <tr className="inv-discount">
                  <th>{t('couponDiscount')}</th>
                  <td>− {money(totals.couponDiscount)}</td>
                </tr>
              )}
              {totals.pointsDiscount > 0 && (
                <tr className="inv-discount">
                  <th>{t('loyaltyPoints')}</th>
                  <td>− {money(totals.pointsDiscount)}</td>
                </tr>
              )}
              {/* The paise the shop and the customer agreed to stop arguing about. Signed,
                  and printed as its own line — a grand total that silently differs from the
                  sum above it is the fastest way to lose a customer's trust in a bill. */}
              {Math.abs(totals.roundOff || 0) >= 0.005 && (
                <tr>
                  <th>{t('roundOff')}</th>
                  <td>
                    {totals.roundOff > 0 ? '+ ' : '− '}
                    {money(Math.abs(totals.roundOff))}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="inv-grand">
            <span>{t('grandTotal')}</span>
            <strong>{money(totals.grandTotal)}</strong>
          </div>

          {!hidePayment && (totals.balanceDue > 0 || payment.mode === 'khata') && (
            <table className="inv-totals inv-totals-settle">
              <tbody>
                <tr>
                  <th>{t('amountPaid')}</th>
                  <td>{money(totals.amountPaid)}</td>
                </tr>
                {totals.returnedAmount > 0 && (
                  <tr>
                    <th>{t('returnsCredited')}</th>
                    <td>− {money(totals.returnedAmount)}</td>
                  </tr>
                )}
                <tr className="inv-balance-row">
                  <th>{t('balanceDue')}</th>
                  <td>{money(totals.balanceDue)}</td>
                </tr>
              </tbody>
            </table>
          )}

          {/* Two different savings, and a customer cares about both: what the shop knocked
              off, and how far below the printed MRP they were already buying. */}
          {showSavings && totals.discount > 0 && (
            <p className="inv-savings">{t('youSaved', { amount: money(totals.discount) })} 🎉</p>
          )}
          {showSavings && totals.totalSavedAgainstMrp > 0 && (
            <p className="inv-savings">{t('belowMrp', { amount: money(totals.totalSavedAgainstMrp) })}</p>
          )}
          {showSavings && payment.pointsEarned > 0 && (
            <p className="inv-points">
              {t('pointsEarned')}: {payment.pointsEarned}
            </p>
          )}
        </div>
      </section>

      <footer className="inv-foot">
        <div className="inv-foot-pay">
          {showUpiQr && showQrPay && !hidePayment && payment.upiLink && meta.showUpiQr && (
            <div className="inv-qr">
              <UpiQr link={payment.upiLink} size={104} />
              <span>
                {t('scanToPay', {
                  amount: totals.balanceDue > 0 ? money(totals.balanceDue) : money(totals.grandTotal),
                })}
              </span>
            </div>
          )}
          {meta.jurisdiction && <p className="inv-jurisdiction">{t('jurisdiction', { place: meta.jurisdiction })}</p>}
          <p className="inv-eoe">{t('eoe')}</p>
        </div>

        {showStamp && stamp && (
          <div className="inv-stamp" aria-hidden="true">
            <div className="inv-stamp-inner">
              <span className="inv-stamp-text">{stamp}</span>
              <span className="inv-stamp-sub">{invoiceDate(invoice.date)}</span>
              <span className="inv-stamp-shop">{seller.shopName}</span>
            </div>
          </div>
        )}

        {/* A delivery challan is only worth the paper once somebody has signed for the
            goods, so the challan kind turns this on by itself. */}
        {(showCustomerSign || kind.receiverSign) && (
          <div className="inv-sign inv-sign-receiver">
            <span className="inv-sign-for">{t('receivedBy')}</span>
            <div className="inv-sign-space">
              <span className="inv-sign-line" />
            </div>
            <span className="inv-sign-role">{t('receiverSign')}</span>
          </div>
        )}

        {showSignature && (
          <div className="inv-sign">
            <span className="inv-sign-for">{t('forShop', { shop: seller.legalName || seller.shopName })}</span>
            <div className="inv-sign-space">
              {seller.signatureUrl ? <img src={seller.signatureUrl} alt="" /> : <span className="inv-sign-line" />}
            </div>
            <span className="inv-sign-role">
              {seller.signatoryName ? `${seller.signatoryName} · ` : ''}
              {t('authorisedSignatory')}
            </span>
          </div>
        )}
      </footer>

      <div className="inv-strip">
        <span>{meta.footerNote || t('thankYou')}</span>
        {showAppCredit && <span className="inv-strip-brand">{t('appCredit')}</span>}
      </div>
    </div>
  );
}
