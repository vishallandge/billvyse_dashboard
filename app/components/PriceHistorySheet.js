'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { formatRupees, formatDate } from '../../lib/format';
import { useLanguage } from './LanguageProvider';
import { TrendUpIcon, TrendDownIcon, AlertIcon } from './Icons';
import Modal from './Modal';

/**
 * One item's buying history: how the rate moved, and who sells it cheapest.
 *
 * Opened from a purchase line or from the insights panel. Two questions, in the order a
 * shopkeeper asks them — "kitna mehnga hua" and then "kaun sasta deta hai" — with the answer
 * to each stated as a sentence above the table rather than left in the rows for him to work
 * out.
 *
 * Everything here is read-only. Nothing on this screen changes a rate; it exists so the next
 * rate he types is an informed one.
 */
export default function PriceHistorySheet({ productId, onClose }) {
  const { t, lang } = useLanguage();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!productId) return;
    apiFetch(`/api/seller/suppliers/purchase-prices/${productId}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [productId]);

  return (
    <Modal
      onClose={onClose}
      title={data?.product?.name || t('purchase.priceHistory')}
      hint={t('purchase.priceHistoryHint')}
      maxWidth={640}
    >

        {error && <div className="error-banner">{error}</div>}

        {!data && !error && <p className="empty-state">{t('common.loading')}</p>}

        {data && (
          <>
            <div className="detail-grid">
              <div>
                <span>{t('purchase.currentCost')}</span>
                <strong>{formatRupees(data.product.currentCost, lang)}</strong>
              </div>
              <div>
                <span>{t('seller.price')}</span>
                <strong>{formatRupees(data.product.sellingPrice, lang)}</strong>
              </div>
              <div>
                <span>{t('purchase.marginNow')}</span>
                {/* Null rather than a made-up figure when no cost was ever recorded — a
                    margin without a cost price is a 100% margin, and that is a lie. */}
                <strong>{data.product.marginPercent == null ? '—' : `${data.product.marginPercent}%`}</strong>
              </div>
              {data.product.mrp != null && (
                <div>
                  <span>MRP</span>
                  <strong>{formatRupees(data.product.mrp, lang)}</strong>
                </div>
              )}
            </div>

            {/* The trend, as a sentence. A table of twelve rows does not answer "is this
                getting dearer?" until somebody reads all twelve. */}
            {data.trend && (
              <div className={`info-banner${data.trend.changePercent > 0 ? '' : ' is-good'}`}>
                {data.trend.changePercent > 0 ? <TrendUpIcon size={15} /> : <TrendDownIcon size={15} />}{' '}
                {t(data.trend.changePercent > 0 ? 'purchase.trendUp' : 'purchase.trendDown', {
                  pct: Math.abs(data.trend.changePercent),
                  from: formatRupees(data.trend.from, lang),
                  to: formatRupees(data.trend.to, lang),
                  since: formatDate(data.trend.since, lang),
                })}
              </div>
            )}

            {/* Only a *different* supplier who is actually cheaper is a finding. Telling a
                shopkeeper his current supplier is his cheapest one is not advice. */}
            {data.best && data.saving > 0 && (
              <div className="info-banner">
                <AlertIcon size={15} />{' '}
                {t('purchase.cheaperSupplier', {
                  name: data.best.supplierName,
                  saving: formatRupees(data.saving, lang),
                  current: data.currentSupplierName,
                })}
              </div>
            )}

            {data.suppliers?.length > 1 && (
              <>
                <h3 className="section-sub">{t('purchase.bySupplier')}</h3>
                <div className="table-wrap auto-height">
                  <table className="data-table" style={{ minWidth: '520px' }}>
                    <thead>
                      <tr>
                        <th>{t('seller.supplier')}</th>
                        <th className="num">{t('purchase.billedRate')}</th>
                        <th className="num">{t('purchase.realCost')}</th>
                        <th className="num">{t('purchase.timesBought')}</th>
                        <th>{t('purchase.lastBought')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.suppliers.map((row) => (
                        <tr key={String(row.supplierId)}>
                          <td className="cell-strong">
                            {row.supplierName}
                            {row.scheme && <span className="cell-sub">{row.scheme}</span>}
                          </td>
                          <td className="num">{formatRupees(row.costPrice, lang)}</td>
                          {/* The number that decides who is cheaper: a supplier running
                              10+2 at ₹100 beats one at ₹90 flat, and the billed column
                              would say the opposite. */}
                          <td className="num cell-strong">{formatRupees(row.effectiveCost, lang)}</td>
                          <td className="num cell-muted">{row.buyCount}</td>
                          <td className="cell-sub">{formatDate(row.lastBoughtAt, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <h3 className="section-sub">{t('purchase.everyPurchase')}</h3>
            {data.history.length === 0 ? (
              <p className="empty-state">{t('purchase.noHistory')}</p>
            ) : (
              <div className="table-wrap auto-height">
                <table className="data-table" style={{ minWidth: '560px' }}>
                  <thead>
                    <tr>
                      <th>{t('common.date')}</th>
                      <th>{t('seller.supplier')}</th>
                      <th className="num">{t('seller.quantity')}</th>
                      <th className="num">{t('purchase.billedRate')}</th>
                      <th className="num">{t('purchase.realCost')}</th>
                      <th className="num">{t('purchase.marginThen')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((row) => (
                      <tr key={String(row.id)}>
                        <td>{formatDate(row.date, lang)}</td>
                        <td className="cell-sub">{row.supplierName}</td>
                        <td className="num">
                          {row.quantity} {row.unit || ''}
                          {row.scheme && <span className="cell-sub">{row.scheme}</span>}
                        </td>
                        <td className="num">{formatRupees(row.costPrice, lang)}</td>
                        <td className="num cell-strong">{formatRupees(row.effectiveCost, lang)}</td>
                        <td className="num cell-muted">{row.marginPercent == null ? '—' : `${row.marginPercent}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
    </Modal>
  );
}
