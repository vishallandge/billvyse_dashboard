'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRouteId } from '../../../../lib/routeId';
import { apiFetch } from '../../../../lib/api';
import { useLanguage } from '../../../components/LanguageProvider';
import { useDashboardUser } from '../../../components/DashboardShell';
import { useToast } from '../../../components/Toast';
import { SkeletonStats } from '../../../components/Skeleton';
import {
  PackageIcon,
  RupeeIcon,
  TrendUpIcon,
  ClockIcon,
  AlertIcon,
  StoreIcon,
  EditIcon,
  BarcodeIcon,
} from '../../../components/Icons';
import { packSizeOf, subUnitPriceOf, formatSubUnitPrice } from '../../../../lib/catalog';

const money = (value) =>
  `₹${(Number(value) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The saved branch prices as a form draft.
 *
 * A branch with no override becomes an EMPTY box, never the catalog number. That is the
 * whole safety of this form: if the catalog price were prefilled, opening the page and
 * pressing Save would silently pin today's price onto every branch for ever, and nobody
 * would notice until head office changed the catalog and nothing moved.
 */
function draftFromStores(stores = []) {
  const draft = {};
  for (const store of stores) {
    draft[store.id] = {
      price: store.price == null ? '' : String(store.price),
      mrp: store.mrp == null ? '' : String(store.mrp),
    };
  }
  return draft;
}

function DetailStat({ icon, tone, value, label }) {
  return (
    <div className="stat-card">
      <div className="stat-card-top">
        <div className={`stat-card-icon ${tone}`}>{icon}</div>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

/**
 * One product's own page.
 *
 * Everything about a product used to live in modals stacked over the inventory list, which
 * meant it could not be linked to, sent to a partner, kept open on a second screen while on
 * the phone to a wholesaler, or reached at all from a search result. And the list could only
 * ever say what a product *is* — price, stock — never how it is *doing*, so the two
 * questions that decide a reorder had no home anywhere in the app:
 *
 *   does it sell, and does it earn?
 *
 * Both are answered above the fold here, in the sentence form the rest of the app uses:
 * not "quantity: 38" but "at this rate the shelf lasts 9 more days".
 */
export default function ProductDetailPage() {
  const { t } = useLanguage();
  const params = { id: useRouteId() };
  const router = useRouter();
  const user = useDashboardUser();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // Branch prices are edited in place, so the draft is kept as its own map keyed by branch
  // rather than folded into `data` — the saved answer has to stay around to compare against.
  const [priceDraft, setPriceDraft] = useState({});
  const [savingPrices, setSavingPrices] = useState(false);

  const productId = params?.id;

  useEffect(() => {
    if (!productId) return;
    setLoading(true);
    apiFetch(`/api/seller/products/${productId}`)
      .then((result) => {
        setData(result);
        setPriceDraft(draftFromStores(result.stores));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // The movement list is the second half of the page but nothing above it waits on it,
    // so it is fetched alongside rather than after.
    apiFetch(`/api/seller/products/${productId}/ledger?days=90`)
      .then(setLedger)
      .catch(() => {});
  }, [productId]);

  if (loading) {
    return (
      <>
        <div className="page-head">
          <div className="page-head-text">
            <h1>{t('common.loading')}</h1>
          </div>
        </div>
        <SkeletonStats count={4} />
      </>
    );
  }

  if (error || !data) {
    return (
      <div className="empty-state-rich">
        <div className="empty-icon"><PackageIcon size={26} /></div>
        <p>{error || t('seller.productNotFound')}</p>
        <Link href="/seller/products" className="btn btn-secondary btn-small btn-inline">
          {t('seller.backToProducts')}
        </Link>
      </div>
    );
  }

  const { product, performance, stores } = data;

  function setPriceField(storeId, field, value) {
    setPriceDraft((prev) => ({ ...prev, [storeId]: { ...prev[storeId], [field]: value } }));
  }

  const pricesDirty = JSON.stringify(priceDraft) !== JSON.stringify(draftFromStores(stores));

  async function saveBranchPrices() {
    setSavingPrices(true);
    try {
      const result = await apiFetch(`/api/seller/products/${productId}/branch-prices`, {
        method: 'PUT',
        body: JSON.stringify({
          stores: stores.map((store) => ({
            storeId: store.id,
            price: priceDraft[store.id]?.price ?? '',
            mrp: priceDraft[store.id]?.mrp ?? '',
          })),
        }),
      });
      setData((prev) => ({ ...prev, stores: result.stores }));
      setPriceDraft(draftFromStores(result.stores));
      toast.success(t('seller.branchPricesSaved'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingPrices(false);
    }
  }
  const packSize = packSizeOf(product);
  const stock = Number(product.stock) || 0;
  const isLow = product.kind !== 'service' && stock <= (Number(product.lowStockThreshold) || 0);

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <h1>{product.name}</h1>
          <p className="page-head-sub">
            {[product.category, product.hsnCode && `HSN ${product.hsnCode}`, product.barcode]
              .filter(Boolean)
              .join(' · ') || t('seller.noProductMeta')}
          </p>
        </div>
        <div className="page-head-actions">
          {/* Editing still belongs to the list's form — one form, one set of validation
              rules. This is the link back to it rather than a second copy of it. */}
          <Link href={`/seller/products?edit=${product._id}`} className="btn btn-primary btn-inline">
            <EditIcon size={17} /> {t('common.edit')}
          </Link>
        </div>
      </div>

      {/* The sentence a reorder decision is actually made on. "38 in stock" means nothing
          until you know whether that is a fortnight's supply or tomorrow's. */}
      {product.kind !== 'service' && (
        <div className={`product-detail__verdict${isLow ? ' warn' : ''}`}>
          {isLow ? <AlertIcon size={16} /> : <TrendUpIcon size={16} />}
          <span>
            {performance.quantitySold === 0
              ? t('seller.detailNoSales', { days: performance.days })
              : performance.daysOfCover === null
              ? t('seller.detailSoldNoCover', { qty: performance.quantitySold, days: performance.days })
              : t('seller.detailCover', {
                  qty: performance.quantitySold,
                  days: performance.days,
                  cover: performance.daysOfCover,
                })}
          </span>
        </div>
      )}

      {/* Same markup the inventory list's cards use (.stat-card-top / .stat-value /
          .stat-label) so the two screens read as one system. */}
      <div className="stat-grid">
        <DetailStat icon={<PackageIcon size={17} />} tone="icon-brand" value={`${stock} ${product.unit}`} label={t('seller.stock')} />
        <DetailStat
          icon={<RupeeIcon size={17} />}
          tone="icon-success"
          value={money(performance.stockValue)}
          label={t('seller.stats.inventoryValue')}
        />
        <DetailStat
          icon={<TrendUpIcon size={17} />}
          tone="icon-gold"
          value={money(performance.revenue)}
          label={t('seller.detailRevenue', { days: performance.days })}
        />
        <DetailStat
          icon={<ClockIcon size={17} />}
          tone="icon-muted"
          value={
            performance.lastSoldAt
              ? new Date(performance.lastSoldAt).toLocaleDateString('en-IN')
              : t('seller.detailNeverSold')
          }
          label={t('seller.detailLastSold')}
        />
      </div>

      <div className="product-detail__grid">
        <div className="panel">
          <div className="section-title"><h2>{t('seller.detailPricing')}</h2></div>
          <dl className="kv-list">
            <div>
              <dt>{t('seller.price')}</dt>
              <dd>{money(product.price)} <small>/ {product.unit}</small></dd>
            </div>
            {product.mrp > 0 && (
              <div>
                <dt>{t('seller.mrp')}</dt>
                <dd>{money(product.mrp)}</dd>
              </div>
            )}
            <div>
              <dt>{t('seller.costPrice')}</dt>
              <dd>{product.costPrice > 0 ? money(product.costPrice) : <span className="cell-sub">{t('seller.detailNoCost')}</span>}</dd>
            </div>
            {/* Margin is the number that decides whether stocking this is worth the shelf
                space, and it is simply absent — not zero — until a cost price exists.
                Showing 100% for an unrecorded cost is the most expensive lie inventory
                software can tell. */}
            <div>
              <dt>{t('seller.detailMargin')}</dt>
              <dd>
                {performance.marginPercent === null ? (
                  <span className="cell-sub">{t('seller.detailMarginUnknown')}</span>
                ) : (
                  <strong className={performance.marginPercent < 0 ? 'text-danger' : 'text-success'}>
                    {performance.marginPercent}%
                  </strong>
                )}
              </dd>
            </div>
            {performance.profit !== null && (
              <div>
                <dt>{t('seller.detailProfit', { days: performance.days })}</dt>
                <dd>
                  <strong className={performance.profit < 0 ? 'text-danger' : 'text-success'}>
                    {money(performance.profit)}
                  </strong>
                </dd>
              </div>
            )}
            {packSize > 0 && (
              <div>
                <dt>{t('pack.sellBy')}</dt>
                <dd>
                  {t('pack.summary', {
                    unit: t(`units.${product.unit}`),
                    size: packSize,
                    subUnit: t(`units.${product.subUnit}`),
                    price: formatSubUnitPrice(subUnitPriceOf(product)),
                  })}
                </dd>
              </div>
            )}
            {Number(product.gstRate) > 0 && (
              <div>
                <dt>{t('seller.gst')}</dt>
                <dd>{product.gstRate}%</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="panel">
          <div className="section-title"><h2>{t('seller.detailWhereItIs')}</h2></div>
          {/* "We have 12" is useless to a two-shop owner when all 12 are at the other
              branch. A single-store shop sees one row and loses nothing. */}
          {stores.length > 0 ? (
            <ul className="store-stock-list">
              {stores.map((store) => (
                <li key={store.id} className={store.quantity <= (store.lowStockThreshold || 0) ? 'low' : ''}>
                  <StoreIcon size={14} />
                  <span>{store.name}</span>
                  <strong>{store.quantity} {product.unit}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">{t('seller.detailNoStores')}</p>
          )}

          {/* What each branch charges.
              Only for a shop that HAS branches — on one shop this is the price box on the
              edit form, said twice. The catalog price is the placeholder, never the value:
              a shopkeeper who never touches a box must not accidentally freeze today's
              catalog price onto every branch for ever. */}
          {stores.length > 1 && (
            <div className="branch-price-block">
              <div className="section-title"><h2>{t('seller.branchPrices')}</h2></div>
              <p className="cell-sub">{t('seller.branchPricesHint')}</p>
              <div className="table-wrap auto-height">
                <table className="data-table" style={{ minWidth: '360px' }}>
                  <thead>
                    <tr>
                      <th>{t('seller.storeName')}</th>
                      <th>{t('seller.sellingPrice')}</th>
                      <th>{t('seller.mrpLabel')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stores.map((store) => (
                      <tr key={store.id}>
                        <td>{store.name}</td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="branch-price-input"
                            placeholder={String(product.price ?? '')}
                            value={priceDraft[store.id]?.price ?? ''}
                            onChange={(e) => setPriceField(store.id, 'price', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="branch-price-input"
                            placeholder={String(product.mrp ?? '')}
                            value={priceDraft[store.id]?.mrp ?? ''}
                            onChange={(e) => setPriceField(store.id, 'mrp', e.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-small btn-inline"
                style={{ marginTop: '0.6rem' }}
                disabled={savingPrices || !pricesDirty}
                onClick={saveBranchPrices}
              >
                {savingPrices ? t('common.saving') : t('common.save')}
              </button>
            </div>
          )}

          {product.barcode && (
            <p className="product-detail__barcode">
              <BarcodeIcon size={14} /> {product.barcode}
            </p>
          )}
          {product.expiryDate && (
            <p className="product-detail__barcode">
              <ClockIcon size={14} /> {t('seller.expiryDate')}: {new Date(product.expiryDate).toLocaleDateString('en-IN')}
            </p>
          )}
        </div>
      </div>

      {/* The report this whole feature exists for — "10 packet the, ab 3 kyun?" — on the
          page rather than behind a modal that could not be linked to. */}
      <div className="panel">
        <div className="section-title has-actions">
          <div className="section-title__label">
            <div className="icon-badge icon-muted"><ClockIcon size={16} /></div>
            <h2>{t('seller.stockLedger')}</h2>
          </div>
          {ledger && (
            <span className="cell-sub">
              {t('seller.ledgerIn')} {ledger.totals.in} · {t('seller.ledgerOut')} {ledger.totals.out}
            </span>
          )}
        </div>
        {!ledger ? (
          <p className="empty-state">{t('common.loading')}</p>
        ) : ledger.rows.length === 0 ? (
          <p className="empty-state">{t('seller.ledgerEmpty')}</p>
        ) : (
          <div className="table-wrap auto-height">
            <table className="data-table" style={{ minWidth: '560px' }}>
              <thead>
                <tr>
                  <th>{t('seller.ledgerWhen')}</th>
                  <th>{t('seller.ledgerWhat')}</th>
                  <th className="num">{t('seller.ledgerChange')}</th>
                  <th className="num">{t('seller.ledgerBalance')}</th>
                </tr>
              </thead>
              <tbody>
                {/* Already newest-first from the server — see getProductStockLedger. */}
                {ledger.rows.map((row, index) => (
                  <tr key={`${row.at}-${index}`}>
                    <td className="cell-muted">{new Date(row.at).toLocaleDateString('en-IN')}</td>
                    <td>{row.note}</td>
                    <td className={`num ${row.delta < 0 ? 'text-danger' : 'text-success'}`}>
                      {row.delta > 0 ? '+' : ''}{row.delta}
                    </td>
                    <td className="num cell-strong">{row.balanceAfter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
