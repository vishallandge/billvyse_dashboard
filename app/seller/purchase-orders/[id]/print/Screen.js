'use client';

import { useEffect, useState } from 'react';
import { useRouteId } from '../../../../../lib/routeId';
import { apiFetch } from '../../../../../lib/api';
import { useLanguage } from '../../../../components/LanguageProvider';
import { SkeletonCards } from '../../../../components/Skeleton';
import PurchaseOrderDocument from '../../../../components/PurchaseOrderDocument';
import InvoicePreviewStage from '../../../../components/InvoicePreviewStage';
import { PrinterIcon } from '../../../../components/Icons';

export default function PurchaseOrderPrintPage() {
  const id = useRouteId();
  const { t } = useLanguage();

  const [order, setOrder] = useState(null);
  const [shop, setShop] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    apiFetch(`/api/seller/suppliers/purchase-orders/${id}`)
      .then((data) => {
        setOrder(data.order);
        setShop(data.shop);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <>
      <style>{'@page { size: A4; margin: 8mm; }'}</style>

      <div className="content-header invoice-noprint">
        <h1>{t('purchase.printPo')}</h1>
        <p>{t('purchase.poPrintHint')}</p>
      </div>

      {error && <div className="error-banner invoice-noprint">{error}</div>}

      <div className="invoice-actionbar invoice-noprint">
        <span className="invoice-actionbar-doc">
          {order ? order.label : ''}
          {order?.supplier?.name && <em>{order.supplier.name}</em>}
        </span>
        <div className="invoice-actionbar-right">
          <button type="button" className="btn btn-primary btn-small" onClick={() => window.print()} disabled={!order}>
            <PrinterIcon size={15} /> {t('purchase.printPo')}
          </button>
        </div>
      </div>

      <div className="invoice-canvas">
        {loading ? (
          <div className="invoice-noprint">
            <SkeletonCards count={1} height={520} />
          </div>
        ) : (
          order && (
            <div className="invoice-print-area">
              {/* Fitted by measurement. A 210mm sheet is 793 CSS pixels and this column is
                  about 320 on a phone; this screen has no zoom control of its own, so until
                  now it depended on a blanket `transform: scale(0.46)` in globals.css that
                  neither fitted nor reclaimed the space it left behind. */}
              <InvoicePreviewStage paper="a4">
                <PurchaseOrderDocument order={order} shop={shop} />
              </InvoicePreviewStage>
            </div>
          )
        )}
      </div>
    </>
  );
}
