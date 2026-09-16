'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { useToast } from './Toast';
import { formatQty } from '../../lib/format';
import { AlertIcon, CheckCircleIcon, PlusIcon, PackageIcon, ZapIcon } from './Icons';
import Modal from './Modal';
import CatalogQuickAdd from './CatalogQuickAdd';

/**
 * The goods that arrived and are on no shelf, put where they belong.
 *
 * A purchase line can only move stock if it names a product in the shop's own list. A bill
 * photographed at the counter routinely carries something the shop has never stocked, and a
 * line typed by hand can be left unlinked without noticing. Receiving such an order bills
 * for the goods, owes the wholesaler for them and files them for input tax credit — and no
 * shelf in the app ever hears about it. "Maal aa gaya par stock mein dikh nahi raha" is
 * exactly that, and until this screen existed the only way out was to count the godown and
 * adjust the stock by hand, losing the cost price, the batch, the expiry and the purchase
 * history with it.
 *
 * Each line gets the two answers a shopkeeper actually has: it IS something on my list and
 * the app just didn't know (pick it), or it is genuinely new (create it). Either way the
 * server then moves exactly what the line is short — never the whole quantity — so a second
 * tap can't double the stock.
 *
 * Used from two places on purpose: before confirming a delivery, where fixing it costs
 * nothing, and afterwards on the order, which is where the shopkeeper lands when the stock
 * list turns out to be short.
 */
export default function StockGapFixer({ order, lines: given, onClose, onOrderChange }) {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const [products, setProducts] = useState([]);
  const [picked, setPicked] = useState({});
  const [busyIndex, setBusyIndex] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState('');
  // The line being created as a brand-new product, in the shape CatalogQuickAdd wants.
  const [creating, setCreating] = useState(null);

  useEffect(() => {
    apiFetch('/api/seller/products')
      .then((data) => setProducts((data.products || []).filter((p) => p.kind !== 'service')))
      .catch(() => setProducts([]));
  }, []);

  /**
   * Which lines this screen is here to fix.
   *
   * The order's own `unstockedLines` is deliberately empty until goods have arrived — on an
   * order still in the van every line is "not in stock" and saying so would be alarming and
   * useless. So the delivery screen, which is the one place worth fixing this BEFORE the
   * mistake, passes its own list of lines that are about to arrive unlinked.
   */
  const lines = given || order?.unstockedLines || [];

  /**
   * Every line in one tap.
   *
   * A scanned chemist bill turns up with twenty rows and eleven of them are things the shop
   * has never stocked. Fixing those one at a time is eleven searches and eleven taps, and a
   * job that long does not get done — which leaves the stock wrong for exactly the reason
   * this screen exists. So the button does what the shopkeeper would: applies whatever he
   * has already typed, then matches the rest against his own catalogue by name.
   *
   * The matching runs on the server against the same threshold the bill scan uses. Anything
   * it will not swear to is left on screen, named, for him to answer — which is the honest
   * shape of "sab add karo": everything the app can be sure about, and a shorter list of
   * what it cannot.
   */
  async function addAll() {
    setBulkBusy(true);
    setError('');
    try {
      const data = await apiFetch(`/api/seller/suppliers/purchase-orders/${order._id}/items/link-all`, {
        method: 'POST',
        body: JSON.stringify({
          // His own picks go first and always beat the app's guess — he is looking at the
          // carton and the app is looking at a string.
          links: lines
            .map((line) => ({ index: line.index, product: matchProduct(products, picked[line.index]) }))
            .filter((row) => row.product)
            .map((row) => ({ index: row.index, productId: row.product._id })),
          auto: true,
        }),
      });
      onOrderChange(data.order);
      setPicked({});
      if (data.linkedCount > 0) {
        toast.success(
          data.leftCount > 0
            ? t('purchase.stockGapBulkSome', { done: data.linkedCount, left: data.leftCount })
            : t('purchase.stockGapBulkAll', { count: data.linkedCount })
        );
      } else {
        // Nothing matched. Said plainly rather than as a silent no-op, and it points at the
        // button that does work — these are genuinely new things and have to be created.
        toast.error(t('purchase.stockGapBulkNone'));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkBusy(false);
    }
  }

  /** Everything still unmatched, straight into the create-products form in one go. */
  function createAll() {
    setCreating(
      lines.map((line) => {
        const item = order.items?.[line.index] || {};
        return {
          index: line.index,
          name: line.name,
          unit: line.unit,
          mrp: item.mrp,
          costPrice: item.costPrice,
          gstRate: item.gstRate,
          hsnCode: item.hsnCode,
          packLabel: item.packLabel,
          company: item.company,
        };
      })
    );
  }

  async function link(index, productId) {
    if (!productId) return;
    setBusyIndex(index);
    setError('');
    try {
      const data = await apiFetch(`/api/seller/suppliers/purchase-orders/${order._id}/items/${index}/link`, {
        method: 'POST',
        body: JSON.stringify({ productId }),
      });
      onOrderChange(data.order);
      // The number is the point. "Linked" says a field changed; "12 packets went into
      // stock" is what the shopkeeper came here to be told.
      toast.success(
        data.added > 0
          ? t('purchase.stockGapAdded', { qty: formatQty(data.added, lang), name: data.productName })
          : t('purchase.stockGapLinked')
      );
      setPicked((current) => ({ ...current, [index]: '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyIndex(null);
    }
  }

  /**
   * A new product made from the line, then linked in the same breath.
   *
   * Creating it and leaving the linking to a second tap is where this would lose people:
   * the product appears in the list, the stock still says zero, and nothing explains why.
   */
  async function onCreated(created) {
    setCreating(null);
    for (const entry of created) {
      await link(entry.index, entry.product._id || entry.product.id);
    }
  }

  function startCreate(line) {
    const item = order.items?.[line.index] || {};
    setCreating([
      {
        index: line.index,
        name: line.name,
        unit: line.unit,
        mrp: item.mrp,
        costPrice: item.costPrice,
        gstRate: item.gstRate,
        hsnCode: item.hsnCode,
        packLabel: item.packLabel,
        company: item.company,
      },
    ]);
  }

  return (
    <>
      <Modal
        onClose={onClose}
        maxWidth={640}
        title={t('purchase.stockGapTitle')}
        hint={t('purchase.stockGapHint')}
        footer={
          <button type="button" className="btn btn-secondary btn-inline" onClick={onClose}>
            {t('common.close')}
          </button>
        }
      >
        {error && <div className="error-banner">{error}</div>}

        {lines.length === 0 ? (
          <div className="stock-gap-clear">
            <CheckCircleIcon size={28} />
            <p>{t('purchase.stockGapAllFixed')}</p>
          </div>
        ) : (
          <>
          {/* The one-tap path, above the list rather than under it: on a bill with eleven
              unlinked rows the shopkeeper must meet the button that does all eleven before
              he starts doing them one at a time. */}
          <div className="stock-gap-bulk">
            <button
              type="button"
              className="btn btn-primary btn-inline"
              disabled={bulkBusy || busyIndex !== null}
              onClick={addAll}
            >
              <ZapIcon size={17} />
              {bulkBusy ? t('common.saving') : t('purchase.stockGapAddAll', { count: lines.length })}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-inline"
              disabled={bulkBusy || busyIndex !== null}
              onClick={createAll}
            >
              <PlusIcon size={17} />
              {t('purchase.stockGapCreateAll', { count: lines.length })}
            </button>
            <p>{t('purchase.stockGapBulkHint')}</p>
          </div>

          <ul className="stock-gap-list">
            {lines.map((line) => (
              <li className="stock-gap-row" key={line.index}>
                <div className="stock-gap-head">
                  <div className="cell-stack">
                    <span className="cell-strong">{line.name}</span>
                    <span className="cell-sub">
                      {formatQty(line.quantity, lang)} {line.unit} ·{' '}
                      {t(line.reason === 'productGone' ? 'purchase.stockGapProductGone' : 'purchase.stockGapNoProduct')}
                    </span>
                  </div>
                </div>

                <div className="stock-gap-fix">
                  {/* A datalist rather than a dropdown: a chemist has four thousand products
                      and typing three letters is faster than any list can be scrolled. Same
                      control the purchase form itself uses to link a line. */}
                  <input
                    type="text"
                    list="stock-gap-products"
                    className="stock-gap-input"
                    placeholder={t('purchase.stockGapPick')}
                    value={picked[line.index] || ''}
                    onChange={(e) => setPicked((current) => ({ ...current, [line.index]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-small btn-inline"
                    disabled={busyIndex === line.index || !matchProduct(products, picked[line.index])}
                    onClick={() => link(line.index, matchProduct(products, picked[line.index])?._id)}
                  >
                    <PackageIcon size={15} />
                    {t('purchase.stockGapLink')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small btn-inline"
                    disabled={busyIndex === line.index}
                    onClick={() => startCreate(line)}
                  >
                    <PlusIcon size={15} />
                    {t('purchase.stockGapCreate')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          </>
        )}

        <datalist id="stock-gap-products">
          {products.map((product) => (
            <option key={product._id} value={product.name} />
          ))}
        </datalist>

        <div className="bill-scan-note">
          <AlertIcon size={14} />
          <span>{t('purchase.stockGapMoneyNote')}</span>
        </div>
      </Modal>

      {creating && (
        <CatalogQuickAdd lines={creating} onClose={() => setCreating(null)} onCreated={onCreated} />
      )}
    </>
  );
}

/** The typed name, resolved to a product only on an exact match — the same rule the purchase
 *  form uses, so a half-typed name can never link the wrong thing. */
function matchProduct(products, typed) {
  const name = String(typed || '').trim().toLowerCase();
  if (!name) return null;
  return products.find((product) => product.name.toLowerCase() === name) || null;
}
