/**
 * Makes `window.print()` work inside the Android app.
 *
 * Android's WebView silently ignores `window.print()` — there is no dialog, no error,
 * nothing. Every Print button in the app (invoice, receipt, KOT, purchase order, quotation)
 * was therefore a dead button on the Play build. The native plugin hands the WebView to
 * Android's own PrintManager, which shows the system print screen: any printer the phone
 * has a print service for (HP, Canon, Epson, Mopria WiFi printers, RawBT for thermal),
 * plus "Save as PDF".
 *
 * `beforeprint`/`afterprint` are fired by hand around it, because every print handler in
 * the app removes its "printing-…" body class on `afterprint`. The event is held back until
 * Android reports the job queued or cancelled — the page is snapshotted while the print
 * screen is open, and removing the class early would print the whole dashboard instead.
 */

import { isNativeShell, nativePrinter } from './nativeTransport';

let installed = false;

export function installNativeSystemPrint() {
  if (installed || typeof window === 'undefined' || !isNativeShell()) return;
  installed = true;
  let busy = false;
  window.print = function nativePrint() {
    if (busy) return;
    busy = true;
    window.dispatchEvent(new Event('beforeprint'));
    const title = (document.title || 'BillVyse').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60);
    nativePrinter()
      .printWebView({ name: title })
      .catch(() => {})
      .finally(() => {
        busy = false;
        window.dispatchEvent(new Event('afterprint'));
      });
  };
}
