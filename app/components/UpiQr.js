'use client';

import { useEffect, useState } from 'react';

// Renders a UPI deep link (upi://pay?...) as a scannable QR image. Any UPI app the
// customer has installed can scan it directly off this screen.
export default function UpiQr({ link, size = 180, onLoad }) {
  const [dataUrl, setDataUrl] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!link) {
      setDataUrl(null);
      return;
    }
    let active = true;
    import('qrcode')
      // Drawn at several times the size it is shown, never smaller than 512px: a QR is
      // printed far larger than its on-screen pixels (a 104px code becomes 30mm on paper),
      // and a small bitmap stretched that far prints with soft edges a phone camera
      // struggles with. Error correction M survives a thermal head's faint dots.
      .then((QRCode) => QRCode.toDataURL(link, { width: Math.max(512, size * 4), margin: 1, errorCorrectionLevel: 'M' }))
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [link, size]);

  if (!link) return null;
  if (error) return <p className="empty-state">QR generate nahi ho paaya.</p>;
  if (!dataUrl) return null;

  return (
    <img
      src={dataUrl}
      onLoad={onLoad}
      width={size}
      height={size}
      alt="UPI QR code"
      style={{ borderRadius: '10px', background: '#fff', padding: '8px', imageRendering: 'pixelated' }}
    />
  );
}
