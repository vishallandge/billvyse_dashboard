'use client';

import { formatRupees, formatQty } from '../../lib/format';

/**
 * The bill the wholesaler made in his own portal, printed.
 *
 * Reuses the `inv-*` classes for exactly the reason PurchaseOrderDocument does: that set is
 * the app's whole print system — paper geometry, print-media rules, marigold styling — and a
 * fourth private copy of it is how the four quietly drift. Fixed look, no template picker: a
 * supplier's bill is a document the shop received, not one it gets to style.
 *
 * The parties are the other way round from a purchase order, and that is the point. Here the
 * supplier is the one issuing and the shop is the one billed, so "For <supplier>" signs the
 * foot. Nothing on this page is the shop's own record — the strip at the bottom says so,
 * because a printed page that looks like the shop's own invoice would eventually be filed
 * as one.
 */

function money(value) {
  return formatRupees(value ?? 0);
}

function billDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function initials(name) {
  return String(name || 'S')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

export default function SupplierBillDocument({ bill, order, shop }) {
  if (!bill) return null;

  const lines = bill.lines || [];
  const supplier = order?.supplier || {};
  const supplierName = bill.byName || supplier.company || supplier.name || 'Supplier';
  const shopName = shop?.shopName || 'Dukaan';
  const withGst = Number(bill.gstAmount) > 0;
  const showBatch = lines.some((line) => line.batchNumber);
  const showMrp = lines.some((line) => line.mrp > 0);
  // Split for display only — the rupees are the server's, this just puts them in the two
  // boxes GSTR-3B asks for, the same way the purchase order document does.
  const half = Math.round(((bill.gstAmount || 0) / 2) * 100) / 100;

  return (
    <div
      className={`invoice-sheet inv-theme-marigold inv-paper-a4 inv-tpl-classic inv-dens-normal inv-lang-en ${withGst ? 'inv-has-tax' : 'inv-no-tax'}`}
    >
      <div className="inv-ribbon" aria-hidden="true" />

      <header className="inv-head">
        <div className="inv-brand">
          <div className="inv-logo inv-monogram">{initials(supplierName)}</div>
          <div className="inv-brand-text">
            <h1 className="inv-shop-name">{supplierName}</h1>
            {supplier.name && supplier.name !== supplierName && <p className="inv-legal-name">{supplier.name}</p>}
            {supplier.address && <p className="inv-address">{supplier.address}</p>}
            <p className="inv-contact">{supplier.phone && <span>☏ {supplier.phone}</span>}</p>
            {supplier.gstin && (
              <div className="inv-idents">
                <span>
                  <em>GSTIN</em> {supplier.gstin}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="inv-doc">
          <div className="inv-doc-type">Supplier Bill</div>
          <table className="inv-doc-meta">
            <tbody>
              <tr>
                <th>Bill No</th>
                <td className="inv-strong">{bill.number}</td>
              </tr>
              <tr>
                <th>Bill date</th>
                <td>{billDate(bill.date)}</td>
              </tr>
              {order?.label && (
                <tr>
                  <th>Against</th>
                  <td>{order.label}</td>
                </tr>
              )}
              <tr>
                <th>Sent</th>
                <td>{billDate(bill.submittedAt)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </header>

      <section className="inv-parties">
        <div className="inv-party">
          <h2>Billed to</h2>
          <p className="inv-party-name">{shopName}</p>
          {shop?.address && <p>{shop.address}</p>}
          {shop?.phone && <p>☏ {shop.phone}</p>}
          {shop?.gstin && (
            <p>
              <em>GSTIN</em> {shop.gstin}
            </p>
          )}
        </div>
        <div className="inv-party inv-party-pay">
          <h2>Issued by</h2>
          <p className="inv-party-name">{supplierName}</p>
          {supplier.phone && <p>☏ {supplier.phone}</p>}
          <p>Sent from the supplier portal</p>
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
          {lines.map((line, index) => (
            <tr key={index}>
              <td className="inv-col-sr">{index + 1}</td>
              <td className="inv-col-item">
                <span className="inv-item-name">{line.name}</span>
                {line.freeQuantity > 0 && <span className="inv-item-note">+{formatQty(line.freeQuantity)} free</span>}
                {line.discountPercent > 0 && <span className="inv-item-note">{line.discountPercent}% off</span>}
              </td>
              {showBatch && (
                <td className="inv-col-hsn">
                  {line.batchNumber || '—'}
                  {line.expiryDate ? ` · ${billDate(line.expiryDate)}` : ''}
                </td>
              )}
              {showMrp && <td className="inv-col-mrp">{line.mrp > 0 ? money(line.mrp) : '—'}</td>}
              <td className="inv-col-qty">
                {formatQty(line.quantity)} {line.unit}
              </td>
              <td className="inv-col-rate">{money(line.costPrice)}</td>
              {withGst && <td className="inv-col-tax">{line.gstRate || 0}%</td>}
              <td className="inv-col-amount">{money(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="inv-lower">
        <div className="inv-lower-left">
          {bill.note && (
            <div className="inv-block inv-notes">
              <h2>Supplier's note</h2>
              <p>{bill.note}</p>
            </div>
          )}
        </div>

        <div className="inv-lower-right">
          <table className="inv-totals">
            <tbody>
              <tr>
                <th>Gross amount</th>
                <td>{money(bill.grossAmount)}</td>
              </tr>
              {bill.lessTotal > 0 && (
                <tr className="inv-discount">
                  <th>Less (discount)</th>
                  <td>− {money(bill.lessTotal)}</td>
                </tr>
              )}
              <tr>
                <th>Taxable value</th>
                <td>{money(bill.taxableAmount)}</td>
              </tr>
              {withGst &&
                (order?.isInterState ? (
                  <tr>
                    <th>IGST</th>
                    <td>{money(bill.gstAmount)}</td>
                  </tr>
                ) : (
                  <>
                    <tr>
                      <th>CGST</th>
                      <td>{money(half)}</td>
                    </tr>
                    <tr>
                      <th>SGST</th>
                      <td>{money((bill.gstAmount || 0) - half)}</td>
                    </tr>
                  </>
                ))}
              {bill.charges?.freight > 0 && (
                <tr>
                  <th>Freight</th>
                  <td>+ {money(bill.charges.freight)}</td>
                </tr>
              )}
              {bill.charges?.otherCharges > 0 && (
                <tr>
                  <th>Other charges</th>
                  <td>+ {money(bill.charges.otherCharges)}</td>
                </tr>
              )}
              {Math.abs(bill.charges?.roundOff || 0) >= 0.005 && (
                <tr>
                  <th>Round off</th>
                  <td>
                    {bill.charges.roundOff > 0 ? '+ ' : '− '}
                    {money(Math.abs(bill.charges.roundOff))}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="inv-grand">
            <span>Bill total</span>
            <strong>{money(bill.totalAmount)}</strong>
          </div>
        </div>
      </section>

      <footer className="inv-foot">
        <div className="inv-foot-pay">
          <p className="inv-eoe">E. &amp; O.E.</p>
        </div>

        <div className="inv-sign">
          <span className="inv-sign-for">For {supplierName}</span>
          <div className="inv-sign-space">
            <span className="inv-sign-line" />
          </div>
          <span className="inv-sign-role">Authorised Signatory</span>
        </div>
      </footer>

      {/* Said on the paper itself, because a printed page filed in a drawer loses whatever
          the screen around it explained: these are the supplier's figures, not the shop's. */}
      <div className="inv-strip">
        <span>Supplier's own statement of this consignment — not the shop's purchase record.</span>
      </div>
    </div>
  );
}
