'use client';

import { useEffect, useRef, useState } from 'react';
import { fitZoomFor, isRollPaper } from '../../lib/invoiceLabels';
import { useLanguage } from './LanguageProvider';

/**
 * A sheet of paper, shrunk to fit the box it is standing in.
 *
 * `.invoice-sheet` is `width: 210mm` — 793 CSS pixels — because a page has a physical width
 * and does not negotiate. On a phone that is more than twice the column it sits in, so
 * something has to give. Squeezing the sheet is not an option: every column compresses and
 * it stops being a preview of what will print. The whole page is scaled instead.
 *
 * What was there before was a flat `transform: scale(0.46)` inside a `max-width: 900px`
 * media query, and it was wrong three times over:
 *
 *   1. It did not fit. 0.46 of A4 is 365px, and the panel on a 390px phone is about 320 —
 *      so the sheet ran off the right edge and the stage scrolled sideways.
 *   2. It hit every sheet on a narrow screen, including the invoice screen's own sheet,
 *      which had ALREADY been fitted by its zoom control. Two shrinks on one page: a
 *      thumbnail with a toolbar above it.
 *   3. `transform` does not affect layout, so the empty space had to be clawed back with
 *      `margin-bottom: calc(-297mm * 0.54)` — a number that is only correct while the bill
 *      is exactly one page long. A longer bill left a gap; a shorter one overlapped.
 *
 * So: measure the container, compute the zoom, and use `zoom` rather than `transform`.
 * `zoom` re-lays-out, which means the container's height comes out right on its own and
 * there is no negative margin to get wrong. It is what the invoice screen's zoom control
 * already uses, so this is the codebase's existing answer rather than a second one.
 */
export default function InvoicePreviewStage({ paper = 'a4', children, className = '' }) {
  const { t } = useLanguage();
  const boxRef = useRef(null);
  // 1 until measured. Starting at a guess would render the sheet at the wrong size for one
  // frame and visibly snap, which reads worse than arriving a frame late.
  const [fit, setFit] = useState(1);
  // null = follow the fit. Set only when the shopkeeper asks for life size.
  const [zoom, setZoom] = useState(null);

  useEffect(() => {
    const node = boxRef.current;
    if (!node) return undefined;

    const measure = () => {
      // A few pixels are held back for the sheet's drop shadow — without it the shadow is
      // the thing that overflows, and the page grows a scrollbar for eight pixels of blur.
      setFit(fitZoomFor(paper, node.clientWidth - 12));
    };

    measure();
    // ResizeObserver rather than a window resize listener: this box also changes width when
    // the sidebar collapses, when the preview panel is toggled, and when a phone's keyboard
    // opens — none of which fire a window resize on every browser.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [paper]);

  const effective = zoom ?? fit;

  /**
   * The Fit / 100% switch, offered only when fitting actually shrank the page.
   *
   * On a phone the fit works out around 0.39, and at 0.39 an invoice is a picture rather
   * than a document: you can check that the logo, the accent colour and the stamp land in
   * the right places, which is what this preview is FOR — but you cannot read a line of it.
   * That is a fair trade only if there is a way to look closer, so there is one. At 100%
   * the stage scrolls, which is the honest behaviour for a page wider than the screen.
   *
   * Hidden on a desktop, where the sheet already fits at or near life size and a control
   * that changes nothing is worse than no control.
   */
  const canZoom = fit < 0.85;

  return (
    <div className="invoice-preview-box">
      {canZoom && (
        <div className="invoice-fit-switch invoice-noprint">
          <button
            type="button"
            className={zoom === null ? 'is-active' : ''}
            onClick={() => setZoom(null)}
          >
            {t('seller.invoiceZoomFit')}
          </button>
          <button
            type="button"
            className={zoom === 1 ? 'is-active' : ''}
            onClick={() => setZoom(1)}
          >
            100%
          </button>
        </div>
      )}

      <div ref={boxRef} className={`invoice-stage invoice-stage-fit${className ? ` ${className}` : ''}`}>
        {/* `zoom` on the wrapper, never on the sheet itself — the sheet's stylesheet is
            written in millimetres and a zoom applied there would compound with the print
            rules. `flex: 0 0 auto` (from .invoice-zoom) is what stops the stage's flex row
            squeezing the paper instead of scrolling it. */}
        <div className="invoice-zoom" style={{ zoom: effective }} data-roll={isRollPaper(paper) ? 'true' : undefined}>
          {children}
        </div>
      </div>
    </div>
  );
}
