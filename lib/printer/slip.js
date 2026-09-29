/**
 * "Print this slip" for a screen: straight to the role's printer when one is set, and the
 * browser's Print dialog when not — or when the direct print fails.
 *
 * The fallback is the whole point. A counter with a queue cannot have a bill stuck because
 * Bluetooth dropped; the dialog still reaches whatever printer the phone or laptop has
 * installed, and the person is told in one line why the fast path did not run.
 */

import { errorKey, getRolePrinter, printElement } from './index';

/**
 * The browser's Print dialog for a portalled slip. `bodyClass` is what the @media print
 * rules in globals.css key on to hide everything else.
 */
export function systemPrint(bodyClass) {
  if (bodyClass) document.body.classList.add(bodyClass);
  const cleanup = () => {
    if (bodyClass) document.body.classList.remove(bodyClass);
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
export async function printSlip({ role, selector, bodyClass, fallbackText, ready, directOnly = false, onFallback, t }) {
  const printer = getRolePrinter(role);
  if (printer) {
    try {
      // From a click, a browser that forgot the printer may show its chooser again; an
      // automatic print never pops anything up.
      await printElement(printer.id, document.querySelector(selector), { fallbackText, ready, interactive: !directOnly });
      return 'direct';
    } catch (err) {
      onFallback?.(
        t(directOnly ? 'printer.directFailedOnly' : 'printer.directFailed', {
          name: printer.name,
          reason: t(errorKey(err)),
        })
      );
    }
  }
  if (directOnly) return 'skipped';
  systemPrint(bodyClass);
  return 'system';
}

/** The receipt's QR codes are drawn asynchronously; wait until every QR box has its image. */
export function qrSlotsReady(element) {
  return Array.from(element.querySelectorAll('.tr-qr')).every((slot) => slot.querySelector('img'));
}
