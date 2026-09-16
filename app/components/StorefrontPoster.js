'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from './LanguageProvider';
import { activeThemeOnWhite } from '../../lib/themes';
import { PrinterIcon } from './Icons';

// Generates a scannable QR for the shop's public storefront and lets the seller
// print a counter poster ("Scan to order online"). Reuses the `qrcode` dep already
// bundled for UPI QRs.
export default function StorefrontPoster({ url, shopName }) {
  const { t } = useLanguage();
  const [dataUrl, setDataUrl] = useState(null);

  useEffect(() => {
    if (!url) return;
    let active = true;
    import('qrcode')
      .then((QRCode) => QRCode.toDataURL(url, { width: 320, margin: 1 }))
      .then((u) => active && setDataUrl(u))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [url]);

  function printPoster() {
    if (!dataUrl) return;
    const w = window.open('', '_blank', 'width=520,height=720');
    if (!w) return;
    const scan = t('seller.qrPosterScan');
    // A window.open popup inherits none of our stylesheet, so the shop's colour has to
    // be resolved to real hex here. The light ramp, not --brand: this is ink on white
    // paper, where a dark-mode tint would print almost invisible.
    const { brand, ink } = activeThemeOnWhite();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${shopName || 'BillVyse'}</title>
      <style>
        body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;color:#1a0d03}
        .poster{width:420px;text-align:center;border:3px solid ${brand};border-radius:24px;padding:36px 28px}
        .brand{font-size:14px;letter-spacing:.2em;text-transform:uppercase;color:${ink};font-weight:800}
        .shop{font-size:30px;font-weight:800;margin:10px 0 20px}
        img{width:300px;height:300px}
        .scan{font-size:20px;font-weight:700;margin-top:20px}
        .foot{margin-top:14px;font-size:12px;color:#888}
      </style></head><body onload="window.print()">
      <div class="poster">
        <div class="brand">BillVyse</div>
        <div class="shop">${shopName || ''}</div>
        <img src="${dataUrl}" alt="QR" />
        <div class="scan">📱 ${scan}</div>
        <div class="foot">${url}</div>
      </div></body></html>`);
    w.document.close();
  }

  return (
    <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
      {dataUrl ? (
        <img
          src={dataUrl}
          width={140}
          height={140}
          alt="Storefront QR code"
          style={{ borderRadius: '12px', background: '#fff', padding: '8px' }}
        />
      ) : (
        <div className="skeleton" style={{ width: 140, height: 140, borderRadius: 12 }} />
      )}
      <div style={{ flex: 1, minWidth: '180px' }}>
        <p style={{ margin: '0 0 0.75rem' }}>{t('seller.qrPosterHint')}</p>
        <button type="button" className="btn btn-secondary" style={{ width: 'auto' }} onClick={printPoster} disabled={!dataUrl}>
          <PrinterIcon size={17} /> {t('seller.qrPosterPrint')}
        </button>
      </div>
    </div>
  );
}
