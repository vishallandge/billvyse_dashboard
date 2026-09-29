/**
 * The Android app's way of reaching a printer: our own native plugin
 * (android/.../printer/PrinterPlugin.java), because Android's WebView has none of the
 * browser's Bluetooth / USB / Serial APIs.
 *
 * Unlike the browser, the app can scan by itself — Bluetooth Classic and BLE, USB (OTG)
 * and the shop's WiFi network — so it gets a real device list instead of a browser popup.
 */

import { registerPlugin } from '@capacitor/core';
import { bytesToBase64 } from './encode';

let plugin = null;

export function isNativeShell() {
  return typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());
}

export function nativePrinter() {
  if (!isNativeShell()) return null;
  if (!plugin) plugin = registerPlugin('BillVysePrinter');
  return plugin;
}

/** Native kinds, as the plugin names them. */
export const NATIVE_KINDS = ['bt', 'ble', 'usb', 'net'];

export async function nativeSupport() {
  const p = nativePrinter();
  if (!p) return null;
  try {
    return await p.getSupport();
  } catch {
    return null;
  }
}

/**
 * Starts a scan and reports each device as it turns up. Returns a stop function.
 * Asks for Bluetooth permission first when Bluetooth is part of the scan.
 */
export async function nativeScan(kinds, { onFound, onDone }) {
  const p = nativePrinter();
  const handles = [];
  handles.push(await p.addListener('deviceFound', (device) => onFound?.(device)));
  handles.push(await p.addListener('scanDone', () => onDone?.()));
  await p.startScan({ kinds });
  return async () => {
    try {
      await p.stopScan();
    } catch {
      // nothing running
    }
    handles.forEach((handle) => handle.remove());
  };
}

export const nativeTransport = {
  kind: 'native',
  async reopen(record, { onDrop } = {}) {
    const p = nativePrinter();
    const target = { kind: record.nativeKind, address: record.address };
    await p.connect(target);
    const listener = await p.addListener('connection', (event) => {
      if (event.address === record.address && !event.connected) {
        listener.remove();
        onDrop?.();
      }
    });
    return {
      async write(bytes, { slow } = {}) {
        await p.write({ ...target, data: bytesToBase64(bytes), slow: Boolean(slow) });
      },
      async close() {
        listener.remove();
        try {
          await p.disconnect(target);
        } catch {
          // already gone
        }
      },
    };
  },
};
