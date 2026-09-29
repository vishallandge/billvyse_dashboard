'use client';

import { useEffect } from 'react';
import { reconnectAll } from '../../lib/printer';
import { installNativeSystemPrint } from '../../lib/printer/nativeSystemPrint';

/**
 * Mounted once in the root layout. Two jobs, both invisible:
 *
 *   - Inside the Android app, make `window.print()` open Android's print screen (the
 *     WebView otherwise ignores it — every Print button was dead in the app).
 *   - Reconnect this device's saved printers, so the first bill of the day prints without
 *     anyone visiting Settings. A printer that is off stays "not connected" and the chip
 *     at the counter says so; nothing here blocks the page.
 */
export default function PrinterBoot() {
  useEffect(() => {
    installNativeSystemPrint();
    const timer = setTimeout(() => {
      reconnectAll().catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
