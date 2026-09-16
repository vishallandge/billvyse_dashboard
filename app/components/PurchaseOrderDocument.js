'use client';

import { formatRupees, formatQty } from '../../lib/format';

// The printed purchase order — what a shop hands or attaches to a supplier who has no
// account on the portal. Deliberately one fixed look (marigold, A4, classic) rather than
// the invoice's full template/theme/paper picker: a PO is an internal-to-supplier working
// document, not a legal instrument the shop hands to a customer, so it doesn't carry the
// same weight of choice. It reuses the invoice's `inv-*` CSS classes on purpose — that is
// the app's whole print system (paper geometry, print-media rules, marigold styling) and
// forking a second copy of it for one more document type is how the two quietly drift.
//
// Money is never recomputed here — every rupee already came off the purchase order's own
// totals on the server.

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
  return formatRupees(value ?? 0);
}

function poDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PurchaseOrderDocument({ order, shop }) {
  if (!order) return null;

  const supplier = order.supplier || {};
  const items = order.items || [];
  const showBatch = items.some((item) => item.batchNumber);
  // Lines the wholesaler still owes. Summarised under the table as well as marked per line:
  // on a fourteen-line order the per-line notes are easy to skim past, and this is the one
  // sentence the man reading the paper has to leave with.
  const stillDue = items.filter((item) => item.pendingQuantity > 0);
  const showMrp = items.some((item) => item.mrp > 0);
  const withGst = Number(order.gstAmount) > 0;
  const taxColumns = order.isInterState
    ? [{ key: 'igstAmount', label: 'IGST' }]
    : [
        { key: 'cgstAmount', label: 'CGST' },
        { key: 'sgstAmount', label: 'SGST' },
      ];

  const shopName = shop?.shopName || 'Dukaan';

  return (
    <div
      className={`invoice-sheet inv-theme-marigold inv-paper-a4 inv-tpl-classic inv-dens-normal inv-lang-en ${withGst ? 'inv-has-tax' : 'inv-no-tax'}`}
    >
      <div className="inv-ribbon" aria-hidden="true" />

      <header className="inv-head">
        <div className="inv-brand">
          <div className="inv-logo inv-monogram">{initials(shopName)}</div>
          <div className="inv-brand-text">
            <h1 className="inv-shop-name">{shopName}</h1>
            {shop?.legalName && shop.legalName !== shopName && <p className="inv-legal-name">{shop.legalName}</p>}
            {shop?.address && (
              <p className="inv-address">
                {shop.address}
                {shop.pincode ? ` — ${shop.pincode}` : ''}
              </p>
            )}
            <p className="inv-contact">
              {shop?.phone && <span>☏ {shop.phone}</span>}
              {shop?.email && <span>✉ {shop.email}</span>}
            </p>
            {shop?.gstin && (
              <div className="inv-idents">
                <span>
                  <em>GSTIN</em> {shop.gstin}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="inv-doc">
          <div className="inv-doc-type">Purchase Order</div>
          <table className="inv-doc-meta">
            <tbody>
              <tr>
                <th>PO No</th>
                <td className="inv-strong">{order.label}</td>
              </tr>
              <tr>
                <th>Date</th>
                <td>{poDate(order.orderedAt || order.createdAt)}</td>
              </tr>
              {order.expectedAt && (
                <tr>
                  <th>Expected by</th>
                  <td>{poDate(order.expectedAt)}</td>
                </tr>
              )}
              {order.createdByName && (
                <tr>
                  <th>Raised by</th>
                  <td>{order.createdByName}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </header>

      <section className="inv-parties">
        <div className="inv-party">
          <h2>Supplier</h2>
          <p className="inv-party-name">{supplier.name}</p>
          {supplier.company && <p>{supplier.company}</p>}
          {supplier.phone && <p>☏ {supplier.phone}</p>}
          {supplier.address && <p>{supplier.address}</p>}
          {supplier.gstin && (
            <p>
              <em>GSTIN</em> {supplier.gstin}
            </p>
          )}
        </div>
        <div className="inv-party inv-party-pay">
          <h2>Deliver to</h2>
          <p className="inv-party-name">{shopName}</p>
          {shop?.address && <p>{shop.address}</p>}
          {shop?.phone && <p>☏ {shop.phone}</p>}
        </div>
      </section>

      <table className="inv-items">
        <thead>
          <tr>
            <th className="inv-col-sr">Sr</th>
            <th className="inv-col-item">Item</th>
            {showBatch && <th className="inv-col-hsn">Batch / Exp</th>}
            {showMrp && <th className="inv-col-mrp">MRP</th>}
            <th className="inv-col-qty">Qty</th>
            <th className="inv-col-rate">Rate</th>
            {withGst && <th className="inv-col-tax">GST%</th>}
            <th className="inv-col-amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={index}>
              <td className="inv-col-sr">{index + 1}</td>
              <td className="inv-col-item">
                <span className="inv-item-name">{item.name}</span>
                {item.freeQuantity > 0 && (
                  <span className="inv-item-note">+{formatQty(item.freeQuantity)} free</span>
                )}
              </td>
              {showBatch && (
                <td className="inv-col-hsn">
                  {item.batchNumber || '—'}
                  {item.expiryDate ? ` · ${poDate(item.expiryDate)}` : ''}
                </td>
              )}
              {showMrp && <td className="inv-col-mrp">{item.mrp > 0 ? money(item.mrp) : '—'}</td>}
              <td className="inv-col-qty">
                {formatQty(item.quantity)} {item.unit}
                {/* What was asked for, and what is still owed on it.
                    The Qty column stays the quantity the MONEY is for, so Qty × Rate still
                    equals Amount and the sheet reads as a document rather than a broken
                    bill. But after a short delivery that number is what the shop TOOK IN,
                    and this page is handed or emailed to the wholesaler — printing "6"
                    against an order for ten, with nothing else on the paper, is the app
                    telling him he has delivered everything. */}
                {item.orderedQuantity > item.quantity && (
                  <span className="inv-qty-note">
                    Ordered {formatQty(item.orderedQuantity)}
                    {item.pendingQuantity > 0
                      ? ` · ${formatQty(item.pendingQuantity)} still due`
                      : ' · balance closed'}
                  </span>
                )}
              </td>
              <td className="inv-col-rate">{money(item.costPrice)}</td>
              {withGst && <td className="inv-col-tax">{item.gstRate || 0}%</td>}
              <td className="inv-col-amount">{money(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* The sentence the wholesaler has to leave with. Above the notes and the totals,
          because on a paper he glances at once this is the only part that asks him to do
          something. */}
      {stillDue.length > 0 && (
        <div className="inv-block inv-pending">
          <h2>Still to be delivered</h2>
          <ul>
            {stillDue.map((item, index) => (
              <li key={index}>
                {item.name} — {formatQty(item.pendingQuantity)} {item.unit}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="inv-lower">
        <div className="inv-lower-left">
          {order.notes && (
            <div className="inv-block inv-notes">
              <h2>Notes</h2>
              <p>{order.notes}</p>
            </div>
          )}
        </div>

        <div className="inv-lower-right">
          <table className="inv-totals">
            <tbody>
              {order.hasCharges && (
                <tr>
                  <th>Gross amount</th>
                  <td>{money(order.grossAmount)}</td>
                </tr>
              )}
              <tr>
                <th>Taxable value</th>
                <td>{money(order.taxableAmount)}</td>
              </tr>
              {withGst &&
                taxColumns.map((col) => (
                  <tr key={col.key}>
                    <th>{col.label}</th>
                    <td>{money(order[col.key] || 0)}</td>
                  </tr>
                ))}
              {order.charges?.freight > 0 && (
                <tr>
                  <th>Freight</th>
                  <td>+ {money(order.charges.freight)}</td>
                </tr>
              )}
              {order.charges?.otherCharges > 0 && (
                <tr>
                  <th>Other charges</th>
                  <td>+ {money(order.charges.otherCharges)}</td>
                </tr>
              )}
              {order.charges?.cashDiscount > 0 && (
                <tr className="inv-discount">
                  <th>Cash discount</th>
                  <td>− {money(order.charges.cashDiscount)}</td>
                </tr>
              )}
              {order.charges?.lineDiscount > 0 && (
                <tr className="inv-discount">
                  <th>Other discount</th>
                  <td>− {money(order.charges.lineDiscount)}</td>
                </tr>
              )}
              {Math.abs(order.charges?.roundOff || 0) >= 0.005 && (
                <tr>
                  <th>Round off</th>
                  <td>
                    {order.charges.roundOff > 0 ? '+ ' : '− '}
                    {money(Math.abs(order.charges.roundOff))}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="inv-grand">
            <span>Total</span>
            <strong>{money(order.totalAmount)}</strong>
          </div>
        </div>
      </section>

      <footer className="inv-foot">
        <div className="inv-foot-pay">
          <p className="inv-eoe">E. &amp; O.E.</p>
        </div>

        <div className="inv-sign">
          <span className="inv-sign-for">For {shop?.legalName || shopName}</span>
          <div className="inv-sign-space">
            <span className="inv-sign-line" />
          </div>
          <span className="inv-sign-role">Authorised Signatory</span>
        </div>
      </footer>

      <div className="inv-strip">
        <span>This is a purchase order, not a payment.</span>
      </div>
    </div>
  );
}
