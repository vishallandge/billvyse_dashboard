'use client';

/**
 * A real sticker, on screen, at the size it will be printed.
 *
 * Not a drawing of one. `buildLabelItems()` in lib/labelSpec.js is the same function the
 * PDF renderer calls, and it is mirrored from backend/utils/labelSpec.js byte for byte —
 * so the line that gets dropped because it does not fit is dropped HERE too, the barcode
 * is the same Code 128 symbol at the same module width, and the QR sits in the same square.
 * Printing a sheet of 200 to find out the shop name pushed the rate off the sticker is the
 * exact failure this exists to prevent.
 *
 * Renders one box. Everything inside is absolutely positioned against it, in points scaled
 * to pixels by a single factor, which is why nothing here re-implements any layout rule.
 */

import { useEffect, useMemo, useState } from 'react';
import { MM, buildLabelItems } from '../../lib/labelSpec';
import { barcodeBars } from '../../lib/barcode';

// Same two inks the PDF uses. Paper is white in every theme — a sticker previewed in dark
// mode that prints on white paper would be lying about the only thing this screen is for.
const TONES = { ink: '#000000', muted: '#666666' };

export default function LabelPreview({
  product,
  shop,
  template = 'classic',
  fields = {},
  fontScale = 1,
  widthMm,
  heightMm,
  qrValue = null,
  maxWidth = 320,
  maxHeight = 260,
}) {
  const [qrImage, setQrImage] = useState(null);

  useEffect(() => {
    if (!qrValue) {
      setQrImage(null);
      return undefined;
    }
    let active = true;
    import('qrcode')
      .then((module) => (module.default || module).toDataURL(qrValue, { margin: 0, width: 320, errorCorrectionLevel: 'M' }))
      .then((url) => {
        if (active) setQrImage(url);
      })
      .catch(() => {
        if (active) setQrImage(null);
      });
    return () => {
      active = false;
    };
  }, [qrValue]);

  const widthPt = Math.max(1, (Number(widthMm) || 50) * MM);
  const heightPt = Math.max(1, (Number(heightMm) || 25) * MM);

  const spec = useMemo(
    () => buildLabelItems({ product, shop, template, fields, fontScale, widthPt, heightPt, qrValue }),
    [product, shop, template, fields, fontScale, widthPt, heightPt, qrValue]
  );

  // One factor, points to pixels. A 21mm strip and a 148mm price card both land inside the
  // same frame, and the caption under it carries the real millimetres so the scale is never
  // a guess.
  const k = Math.min(maxWidth / widthPt, maxHeight / heightPt);

  return (
    <div
      className="label-sticker"
      style={{ width: `${widthPt * k}px`, height: `${heightPt * k}px` }}
      aria-label={product?.name ? `Label preview: ${product.name}` : 'Label preview'}
    >
      {spec.border && <div className="label-sticker-cut" />}
      {spec.items.map((item, index) => renderItem(item, index, k, qrImage))}
    </div>
  );
}

function renderItem(item, index, k, qrImage) {
  const box = {
    position: 'absolute',
    left: `${item.x * k}px`,
    top: `${item.y * k}px`,
    width: `${item.w * k}px`,
    height: `${item.h * k}px`,
    overflow: 'hidden',
  };
  const align = item.align === 'center' ? 'center' : 'left';

  if (item.kind === 'text') {
    return (
      <div
        key={`${item.role}-${index}`}
        style={{
          ...box,
          fontSize: `${item.size * k}px`,
          // The block's own height IS the line box, which is how the PDF stacks them.
          lineHeight: `${item.h * k}px`,
          fontWeight: item.weight === 'bold' ? 700 : 400,
          color: TONES[item.tone] || TONES.ink,
          textAlign: align,
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          textDecoration: item.strike ? 'line-through' : 'none',
        }}
      >
        {item.text}
      </div>
    );
  }

  if (item.kind === 'price') {
    // Two spans in one line box: the browser baseline-aligns them, which is what the PDF
    // draws by hand (`y + size - suffixSize * 1.15`).
    const suffixSize = Math.max(3.6, item.size * 0.38);
    return (
      <div
        key={`price-${index}`}
        // Ellipsis, not a hard clip: the PDF shortens a too-wide price with truncate() and
        // draws '…', so a half-cut glyph here would be the preview inventing its own failure.
        style={{ ...box, lineHeight: `${item.h * k}px`, textAlign: align, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
      >
        <span style={{ fontSize: `${item.size * k}px`, fontWeight: 700, color: TONES.ink }}>{item.text}</span>
        {item.suffix ? (
          <span style={{ fontSize: `${suffixSize * k}px`, color: TONES.muted, marginInlineStart: `${2 * k}px` }}>{item.suffix}</span>
        ) : null}
      </div>
    );
  }

  if (item.kind === 'badge') {
    return (
      <div key={`badge-${index}`} style={{ ...box, textAlign: align }}>
        <span
          style={{
            display: 'inline-block',
            maxWidth: '100%',
            background: '#000000',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: `${item.size * k}px`,
            lineHeight: `${item.size * 1.5 * k}px`,
            padding: `0 ${item.size * 0.55 * k}px`,
            borderRadius: '999px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {item.text}
        </span>
      </div>
    );
  }

  if (item.kind === 'barcode') {
    const bars = barcodeBars(item.value);
    return (
      <div key={`barcode-${index}`} style={box}>
        <div style={{ position: 'relative', width: '100%', height: `${item.barHeight * k}px` }}>
          {bars?.map((bar, barIndex) => (
            <div
              key={barIndex}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${bar.left * 100}%`,
                width: `${bar.width * 100}%`,
                background: '#000000',
              }}
            />
          ))}
        </div>
        {item.showText && (
          <div
            style={{
              marginTop: `${k}px`,
              fontSize: `${item.textSize * k}px`,
              lineHeight: `${item.textSize * 1.25 * k}px`,
              textAlign: 'center',
              color: TONES.ink,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {item.value}
          </div>
        )}
      </div>
    );
  }

  if (item.kind === 'qr') {
    // The square is reserved whether or not the image has finished encoding — the printed
    // sticker reserves it, so a preview that reflows once the PNG lands would be showing a
    // layout that never gets printed.
    return (
      <div key={`qr-${index}`} style={{ ...box, background: '#ffffff' }}>
        {qrImage ? (
          <img src={qrImage} alt="" style={{ display: 'block', width: '100%', height: '100%' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', border: '1px dashed #bbbbbb' }} />
        )}
      </div>
    );
  }

  return null;
}

/**
 * The sheet, not the sticker: which slots this job will land on.
 *
 * "Skip used stickers" is a number with no meaning until you can see it. A half-used A4
 * sheet is the normal case, not the exception, and getting the number wrong wastes the
 * whole sheet — so the grid shows the blanks being skipped, the slots this job fills, and
 * what is left over on the last page.
 */
export function LabelSheetMap({ cols, rows, skip = 0, filled = 0, cellWmm = 2, cellHmm = 1 }) {
  const perPage = Math.max(1, cols * rows);
  const cells = [];
  for (let slot = 0; slot < perPage; slot += 1) {
    const state = slot < skip ? 'skip' : slot < skip + filled ? 'fill' : 'free';
    cells.push(<span key={slot} className={`sheet-slot is-${state}`} />);
  }
  return (
    <div className="sheet-map" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, '--slot-ratio': String((Number(cellWmm) || 2) / (Number(cellHmm) || 1)) }} aria-hidden="true">
      {cells}
    </div>
  );
}
