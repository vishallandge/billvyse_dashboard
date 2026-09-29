/**
 * Stickers straight to a label printer.
 *
 * Each sticker is drawn by the same <LabelPreview> the Labels screen shows — which is
 * itself built from the same spec as the PDF — so what comes off the roll is the preview,
 * not a third interpretation of the layout. One render per product; copies are the
 * printer's own `PRINT 1,n`, so 200 copies of one sticker is one image sent once.
 */

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import LabelPreview from '../../app/components/LabelPreview';
import { getPrinter, printBitmap } from './index';
import { rasterizeElement, waitFrame } from './raster';

const PX_PER_MM = 96 / 25.4;
const DPMM = 8;

function waitForQr(element) {
  // LabelPreview draws a dashed placeholder until the QR image has been encoded.
  return !element.querySelector('div[style*="dashed"]');
}

/**
 * @param {string} printerId
 * @param {Array<{ product: object, copies: number, qrValue: string|null }>} items
 * @param {{ shop: object, template: string, fields: object, fontScale: number }} look
 * @param {(done: number) => void} [onProgress]
 */
export async function printLabelsDirect(printerId, items, look, onProgress) {
  const printer = getPrinter(printerId);
  const widthMm = Number(printer.label?.widthMm) || 50;
  const heightMm = Number(printer.label?.heightMm) || 25;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;pointer-events:none';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    let done = 0;
    for (const item of items) {
      await new Promise((resolve) => {
        root.render(createElement(LabelPreview, {
          product: item.product,
          shop: look.shop,
          template: look.template,
          fields: look.fields,
          fontScale: look.fontScale,
          widthMm,
          heightMm,
          qrValue: item.qrValue,
          maxWidth: widthMm * PX_PER_MM,
          maxHeight: heightMm * PX_PER_MM,
        }));
        waitFrame().then(waitFrame).then(resolve);
      });
      const sticker = host.firstElementChild;
      sticker.style.boxShadow = 'none';
      sticker.style.borderRadius = '0';
      const bitmap = await rasterizeElement(sticker, {
        widthDots: Math.round(widthMm * DPMM),
        heightDots: Math.round(heightMm * DPMM),
        padBottomMm: 0,
        ready: waitForQr,
      });
      await printBitmap(printerId, bitmap, { copies: Math.max(1, Number(item.copies) || 1) });
      done += 1;
      onProgress?.(done);
    }
  } finally {
    root.unmount();
    host.remove();
  }
}
