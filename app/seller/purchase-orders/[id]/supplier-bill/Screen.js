'use client';

import { useEffect, useState } from 'react';
import { useRouteId } from '../../../../../lib/routeId';
import { apiFetch } from '../../../../../lib/api';
import { useLanguage } from '../../../../components/LanguageProvider';
import { SkeletonCards } from '../../../../components/Skeleton';
import SupplierBillDocument from '../../../../components/SupplierBillDocument';
import InvoicePreviewStage from '../../../../components/InvoicePreviewStage';
import { PrinterIcon } from '../../../../components/Icons';

/**
 * The supplier's own bill, on paper.
 *
 * Same shell as the purchase-order print page next door — actionbar, canvas, `@page` A4 —
 * because they are the same job and a second layout for it would only diverge. What differs
 * is the warning at the top: this is a document the shop received, not one it issued, and an
 * A4 page in a file drawer stops looking like anybody's in particular.
 */
export default function SupplierBillPrintPage() {
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

  const bill = order?.supplierBill || null;

  return (
    <>
      <style>{'@page { size: A4; margin: 8mm; }'}</style>

      <div className="content-header invoice-noprint">
        <h1>{t('purchase.supplierBillTitle')}</h1>
        <p>{t('purchase.supplierBillClaimHint')}</p>
      </div>

      {error && <div className="error-banner invoice-noprint">{error}</div>}

      <div className="invoice-actionbar invoice-noprint">
        <span className="invoice-actionbar-doc">
          {bill ? bill.number : ''}
          {order?.supplier?.name && <em>{order.supplier.name}</em>}
        </span>
        <div className="invoice-actionbar-right">
          <button type="button" className="btn btn-primary btn-small" onClick={() => window.print()} disabled={!bill}>
            <PrinterIcon size={15} /> {t('purchase.supplierBillPrint')}
          </button>
        </div>
      </div>

      <div className="invoice-canvas">
        {loading ? (
          <div className="invoice-noprint">
            <SkeletonCards count={1} height={520} />
          </div>
        ) : !bill ? (
          <div className="empty-state invoice-noprint">{t('purchase.supplierBillNone')}</div>
        ) : (
          <div className="invoice-print-area">
            {/* Fitted by measurement — same reasoning as the print page next door. */}
            <InvoicePreviewStage paper="a4">
              <SupplierBillDocument bill={bill} order={order} shop={shop} />
            </InvoicePreviewStage>
          </div>
        )}
      </div>
    </>
  );
}
