/**
 * "Print this slip" for a screen: straight to the role's printer when one is set, and the
 * browser's Print dialog when not — or when the direct print fails.
 *
 * The fallback is the whole point. A counter with a queue cannot have a bill stuck because
 * Bluetooth dropped; the dialog still reaches whatever printer the phone or laptop has
 * installed, and the person is told in one line why the fast path did not run.
 */

import { errorKey, getRolePrinter, getSettings, getTextScale, printElement } from './index';

const PX_PER_MM = 96 / 25.4;

/**
 * The paper the shop chose in Settings → Invoice look (invoiceProfile.paper) — the ONE
 * setting every print follows. A roll (80 / 58mm) means receipts, KOTs and invoices are laid
 * out at that width and cut to their own length; a sheet (A4/A5/A6) means the Print screen's
 * own paper is left alone.
 */
export function shopPaper(shop) {
  // /auth/me carries it as invoicePaper; invoiceProfile.paper is the full profile's name.
  const paper = shop?.invoicePaper || shop?.invoiceProfile?.paper;
  if (paper === 'thermal58') return { roll: true, widthMm: 58 };
  if (paper === 'thermal') return { roll: true, widthMm: 80 };
  return { roll: false, widthMm: 80 };
}

/**
 * How tall a slip really is, in mm, laid out at the roll's width.
 *
 * Paper is the whole point. `@page { size: 80mm auto }` is not valid CSS — Chrome drops it
 * and falls back to the printer's own paper, which for an Epson/TVS driver is an 80 × 297mm
 * "page": a bill's worth of print followed by twenty centimetres of blank roll. Measuring
 * the slip and asking for exactly that height is what makes the paper stop where the bill does.
 */
export function measureSlipMm(element, { widthMm = 80, padding = '4mm 3.5mm 6mm', scale = 1 } = {}) {
  if (!element) return null;
  // At text size `scale` the slip is laid out on a box 1/scale as wide, then zoomed up.
  widthMm /= scale;
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${widthMm}mm;visibility:hidden;pointer-events:none;font-family:'Segoe UI',system-ui,sans-serif`;
  if (getSettings().compact !== false) host.classList.add('bv-print-compact');
  const clone = element.cloneNode(true);
  clone.style.display = 'block';
  clone.style.width = '100%';
  clone.style.boxSizing = 'border-box';
  clone.style.margin = '0';
  if (padding != null) clone.style.padding = padding;
  host.appendChild(clone);
  document.body.appendChild(host);
  const px = clone.getBoundingClientRect().height;
  host.remove();
  return px > 0 ? Math.ceil((px * scale) / PX_PER_MM) : null;
}

/**
 * Pins the printed page to an exact size until the dialog closes. Appended at the END of
 * <body>, so it comes after every other @page rule (the app's global one, and the invoice
 * screen's own) and wins the cascade.
 */
export function pinPageSize(widthMm, heightMm, marginMm = 0) {
  const style = document.createElement('style');
  style.setAttribute('data-bv-page', '');
  style.textContent = `@page { size: ${widthMm}mm ${Math.max(20, Math.ceil(heightMm))}mm; margin: ${marginMm}mm; }`;
  document.body.appendChild(style);
  return () => style.remove();
}

/**
 * The browser's Print dialog for a portalled slip. `bodyClass` is what the @media print
 * rules in globals.css key on to hide everything else. With `selector`, the page is sized
 * to the slip (see measureSlipMm) — a few mm of slack so a font that renders slightly taller
 * on paper never pushes the last line onto a second page.
 */
export function systemPrint(bodyClass, { selector, widthMm = 80, roll = true, slackMm = 6 } = {}) {
  let unpin = null;
  // The slip's printed width follows the roll and its text the chosen size (globals.css
  // reads --bv-roll-width and --bv-text-scale).
  const scale = getTextScale();
  document.documentElement.style.setProperty('--bv-roll-width', `${widthMm}mm`);
  document.documentElement.style.setProperty('--bv-text-scale', String(scale));
  // The logo's chosen width, as a share of the roll (globals.css: .tr-logo img).
  const logoLook = getSettings().logo || { widthPct: 55, darkness: 0, align: 'center' };
  document.documentElement.style.setProperty('--bv-logo-w', `${((widthMm - 8) * logoLook.widthPct) / 100}mm`);
  document.documentElement.style.setProperty('--bv-logo-align', logoLook.align === 'left' ? '0' : 'auto');
  document.documentElement.style.setProperty('--bv-logo-filter', ['grayscale(1) contrast(1.2) brightness(1.25)', 'grayscale(1) contrast(1.4)', 'grayscale(1) contrast(1.8) brightness(0.8)'][(logoLook.darkness || 0) + 1]);
  if (selector && roll) {
    const heightMm = measureSlipMm(document.querySelector(selector), { widthMm, scale });
    if (heightMm) unpin = pinPageSize(widthMm, heightMm + slackMm);
  }
  if (bodyClass) document.body.classList.add(bodyClass);
  const compact = getSettings().compact !== false;
  if (compact) document.body.classList.add('bv-print-compact');
  const cleanup = () => {
    if (bodyClass) document.body.classList.remove(bodyClass);
    document.body.classList.remove('bv-print-compact');
    unpin?.();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

/**
 * @param {object} options
 * @param {'receipt'|'kot'} options.role
 * @param {string} options.selector the portalled slip, e.g. '.thermal-receipt'
 * @param {string} options.bodyClass the class the print stylesheet keys on
 * @param {string} [options.fallbackText] plain-text copy, printed if the snapshot fails
 * @param {(el: Element) => boolean} [options.ready] true once the slip is fully drawn
 * @param {boolean} [options.directOnly] never open the dialog (auto-print after a bill)
 * @param {(message: string) => void} [options.onFallback] told why the direct path failed
 * @param {(key: string, vars?: object) => string} options.t
 * @returns {Promise<'direct'|'system'|'skipped'>}
 */
// Slips being printed right now. A second press while the first is still on its way is
// ignored — each press used to print, and a slow printer turned one bill into three.
const inFlight = new Set();

export async function printSlip(options) {
  const key = `${options.role}|${options.selector}`;
  if (inFlight.has(key)) return 'skipped';
  inFlight.add(key);
  try {
    return await printSlipOnce(options);
  } finally {
    inFlight.delete(key);
  }
}

async function printSlipOnce({ role, selector, bodyClass, fallbackText, ready, directOnly = false, onFallback, t, shop }) {
  const printer = getRolePrinter(role);
  if (printer) {
    try {
      // From a click, a browser that forgot the printer may show its chooser again; an
      // automatic print never pops anything up.
      await printElement(printer.id, document.querySelector(selector), { fallbackText, ready, interactive: !directOnly });
      return 'direct';
    } catch (err) {
      // A job that timed out may still come out of the printer; opening the Print screen
      // on top of it is how the same bill gets printed twice. Say so and stop.
      if (err?.code === 'timeout') {
        onFallback?.(t('printer.directFailedOnly', { name: printer.name, reason: t('printer.errTimeout') }));
        return 'skipped';
      }
      onFallback?.(
        t(directOnly ? 'printer.directFailedOnly' : 'printer.directFailed', {
          name: printer.name,
          reason: t(errorKey(err)),
        })
      );
    }
  }
  if (directOnly) return 'skipped';
  // The Print screen copies the page as it stands this instant, so it waits for the QR too —
  // otherwise a slip printed straight after a bill came out with no code, or a half-drawn one.
  const slip = document.querySelector(selector);
  if (ready && slip) await waitFor(() => ready(slip));
  const paper = shopPaper(shop);
  systemPrint(bodyClass, { selector, widthMm: paper.widthMm, roll: paper.roll });
  return 'system';
}

/**
 * The Print screen for an InvoiceDocument page (invoice, credit note, quotation, supply bill),
 * following the paper chosen for it. Sheet paper (A4/A5/A6) keeps its screen's own @page.
 * A roll gets a page exactly as long as the document — measured at true size, because the
 * on-screen preview is zoomed to fit its column.
 */
export function printInvoiceSheet({ paper, marginMm = 0 }) {
  let unpin = null;
  if (paper === 'thermal' || paper === 'thermal58') {
    const zoomBox = document.querySelector('.invoice-zoom');
    const sheet = document.querySelector('.invoice-sheet');
    if (sheet) {
      const previousZoom = zoomBox?.style.zoom;
      if (zoomBox) zoomBox.style.zoom = '1';
      const heightMm = sheet.getBoundingClientRect().height / PX_PER_MM;
      if (zoomBox) zoomBox.style.zoom = previousZoom;
      if (heightMm > 0) unpin = pinPageSize(paper === 'thermal58' ? 58 : 80, heightMm + marginMm * 2 + 8, marginMm);
    }
  }
  const cleanup = () => {
    unpin?.();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

/**
 * The receipt's QR codes are drawn asynchronously; wait until every QR box has its image,
 * fully decoded. UpiQr only ever renders the image for its CURRENT link (an old bill's code
 * is never left standing in), so "an image is there and loaded" now means "this bill's QR".
 */
export function qrSlotsReady(element, slotSelector = '.tr-qr') {
  return Array.from(element.querySelectorAll(slotSelector)).every((slot) => {
    const img = slot.querySelector('img');
    return Boolean(img && img.complete && img.naturalWidth > 0);
  });
}

/** The invoice sheet's QR boxes (pay / download), same rule as the slip's. */
export function invoiceQrReady(element) {
  return qrSlotsReady(element, '.inv-qr');
}

/** Polls `check` until it passes or `timeoutMs` runs out — never throws. */
export async function waitFor(check, timeoutMs = 2500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (check()) return;
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}
