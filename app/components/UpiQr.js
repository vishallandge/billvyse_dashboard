'use client';

import { useEffect, useState } from 'react';

// Renders a UPI deep link (upi://pay?...) as a scannable QR image. Any UPI app the
// customer has installed can scan it directly off this screen.
export default function UpiQr({ link, size = 180, onLoad }) {
  // The image is kept together with the link it encodes. Holding the bare image let the
  // PREVIOUS bill's code stay on screen while the next one was being drawn — and the print
  // path, which only waited for "an image is there", printed it: the customer scanned and
  // saw another bill's amount. Now an image is shown only for the link it was drawn from.
  const [drawn, setDrawn] = useState({ link: null, dataUrl: null });
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
    if (!link) return;
    let active = true;
    import('qrcode')
      // Drawn at several times the size it is shown, never smaller than 512px: a QR is
      // printed far larger than its on-screen pixels (a 104px code becomes 30mm on paper),
      // and a small bitmap stretched that far prints with soft edges a phone camera
      // struggles with. Error correction M survives a thermal head's faint dots.
      .then((QRCode) => QRCode.toDataURL(link, { width: Math.max(512, size * 4), margin: 1, errorCorrectionLevel: 'M' }))
      .then((url) => {
        if (active) setDrawn({ link, dataUrl: url });
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
  if (drawn.link !== link || !drawn.dataUrl) return null;

  return (
    <img
      src={drawn.dataUrl}
      data-qr-link={link}
      onLoad={onLoad}
      width={size}
      height={size}
      alt="UPI QR code"
      style={{ borderRadius: '10px', background: '#fff', padding: '8px', imageRendering: 'pixelated' }}
    />
  );
}
