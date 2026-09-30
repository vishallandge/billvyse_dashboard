'use client';

import { useEffect, useState } from 'react';
import { useRouteId } from '../../../../../lib/routeId';
import { apiFetch } from '../../../../../lib/api';
import { useLanguage } from '../../../../components/LanguageProvider';
import { SkeletonCards } from '../../../../components/Skeleton';
import PurchaseOrderDocument from '../../../../components/PurchaseOrderDocument';
import InvoicePreviewStage from '../../../../components/InvoicePreviewStage';
import { PrinterIcon } from '../../../../components/Icons';

/**
 * The order copy the wholesaler takes to the godown — on the same paper the shop printed.
 *
 * `PurchaseOrderDocument` is the app's own purchase order, and it needs no reversing here:
 * the shop issued this order and he received it, so the shop signs the head and he is the
 * party it is addressed to, exactly as on the shop's own print at
 * /seller/purchase-orders/[id]/print. He was the one person seeing a different document
 * from everybody else looking at the same order.
 */
export default function SupplyOrderPrintPage() {
  const id = useRouteId();
  const { t } = useLanguage();

  const [order, setOrder] = useState(null);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([apiFetch(`/api/seller/supply/orders/${id}`), apiFetch('/api/seller/supply/me')])
      .then(([data, me]) => {
        setOrder(data.order);
        setAccount(me?.account || null);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  // Money comes from the order as the shop wrote it — nothing is recomputed on this page,
  // so the copy he carries totals exactly what the shop's copy totals.
  const docOrder = order && {
    ...order,
    totalAmount: order.totalAmount ?? order.total,
    supplier: {
      name: account?.name || account?.company,
      company: account?.company,
      gstin: account?.gstin,
      phone: account?.phone,
    },
  };
  const docShop = order && {
    shopName: order.shopName,
    address: order.shopAddress,
    phone: order.shopPhone,
    gstin: order.shopGstin,
  };

  return (
    <>
      <style>{'@page { size: A4; margin: 8mm; }'}</style>

      <div className="content-header invoice-noprint">
        <h1>{t('supply.orderPrintTitle')}</h1>
        <p>{t('supply.orderPrintHint')}</p>
      </div>

      {error && <div className="error-banner invoice-noprint">{error}</div>}

      <div className="invoice-actionbar invoice-noprint">
        {/* `data-trail` names this document in the breadcrumb (PageTrail.js): the heading
            above says what KIND of page this is, and the trail wants which one. */}
        <span
          className="invoice-actionbar-doc"
          data-trail={[order?.label, order?.shopName].filter(Boolean).join(' · ') || undefined}
        >
          {order?.label || ''}
          {order?.shopName && <em>{order.shopName}</em>}
        </span>
        <div className="invoice-actionbar-right">
          <button type="button" className="btn btn-primary btn-small" onClick={() => window.print()} disabled={!order}>
            <PrinterIcon size={15} /> {t('supply.printSave')}
          </button>
        </div>
      </div>

      <div className="invoice-canvas">
        {loading ? (
          <div className="invoice-noprint">
            <SkeletonCards count={1} height={520} />
          </div>
        ) : !order ? (
          <div className="empty-state invoice-noprint">{t('supply.empty')}</div>
        ) : (
          <div className="invoice-print-area">
            {/* Fitted by measurement — a wholesaler reads this on his phone far more often
                than on a desktop, and it has no zoom control of its own. */}
            <InvoicePreviewStage paper="a4">
              <PurchaseOrderDocument order={docOrder} shop={docShop} />
            </InvoicePreviewStage>
          </div>
        )}
      </div>
    </>
  );
}
