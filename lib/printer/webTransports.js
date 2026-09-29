/**
 * The browser's own ways of reaching a printer — Chrome and Edge on a laptop or on Android.
 *
 *   ble     Web Bluetooth: Bluetooth Low Energy printers. The browser shows its own list.
 *   serial  Web Serial: USB-to-serial printers, and on desktop Chrome also Bluetooth
 *           "Classic" printers the laptop has already paired (they appear as COM ports).
 *   usb     WebUSB: printers that plug in over USB. Windows often hands the device to its
 *           own printer driver first; then the browser cannot claim it and the answer is
 *           the System Print path (the printer is installed in Windows anyway).
 *
 * Every transport has the same shape — `pick()` asks the person to choose (needs a click),
 * `reopen(record)` reconnects to a device already granted (no click), `write(bytes)`,
 * `close()` — so the printer service above does not care which one it is talking to.
 */

import { usbPrinterName } from './vendors';

const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';

// Services cheap BLE printers expose their "write here" characteristic under. There is no
// standard; these cover the chips used in essentially every 58/80mm BLE printer sold here.
const BLE_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000ae00-0000-1000-8000-00805f9b34fb',
];

// Name prefixes cheap BLE printers ship with. Matched case-sensitively by Chrome, so the
// common spellings are listed separately.
const PRINTER_NAME_PREFIXES = [
  'Printer', 'printer', 'PRINTER', 'MTP', 'MPT', 'RPP', 'PT-', 'PT2', 'XP-', 'POS', 'Pos',
  'InnerPrinter', 'BlueTooth Printer', 'Bluetooth Printer', 'BT-', 'BT_', 'Goojprt', 'ZJ-',
  'Qsprinter', 'PeriPage', 'T58', 'T80', 'M58', 'P58', 'P80', 'HM-', 'RP', 'TP', 'Thermal',
  'Rongta', 'Xprinter', 'SPP', 'MHT', 'PB', 'Phomemo', 'M02', 'M110', 'M200', 'D30', 'Niimbot',
  'B21', 'B1', 'TSC', 'Epson', 'EPSON', 'TM-', 'Star', 'Bixolon', 'SPP-R', 'Sunmi', 'SUNMI',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function webSupport() {
  if (typeof navigator === 'undefined') return { ble: false, serial: false, usb: false };
  return {
    ble: Boolean(navigator.bluetooth),
    serial: Boolean(navigator.serial),
    usb: Boolean(navigator.usb),
  };
}

/** A person closing the browser's chooser is not an error worth shouting about. */
export function isChooserCancel(err) {
  return err?.name === 'NotFoundError' || /cancel/i.test(err?.message || '');
}

// ---------------------------------------------------------------- Web Bluetooth (BLE) ---

async function openBleDevice(device, onDrop) {
  const server = await device.gatt.connect();
  let target = null;
  for (const uuid of BLE_SERVICES) {
    let service;
    try {
      service = await server.getPrimaryService(uuid);
    } catch {
      continue;
    }
    const characteristics = await service.getCharacteristics();
    target = characteristics.find((c) => c.properties.write) || characteristics.find((c) => c.properties.writeWithoutResponse);
    if (target) break;
  }
  if (!target) {
    server.disconnect();
    const err = new Error('no-writable-characteristic');
    err.code = 'unsupported-printer';
    throw err;
  }
  const handler = () => {
    device.removeEventListener('gattserverdisconnected', handler);
    onDrop?.();
  };
  device.addEventListener('gattserverdisconnected', handler);

  return {
    async write(bytes, { slow } = {}) {
      const withResponse = Boolean(target.properties.write);
      // With-response writes are acknowledged, so the printer cannot be overrun; long
      // writes up to 512 bytes are fine. Without response the only safe size is one MTU.
      const chunk = slow ? 20 : withResponse ? 180 : 20;
      const pause = slow ? 25 : withResponse ? 0 : 8;
      for (let i = 0; i < bytes.length; i += chunk) {
        const part = bytes.slice(i, i + chunk);
        if (withResponse) await (target.writeValueWithResponse ? target.writeValueWithResponse(part) : target.writeValue(part));
        else await target.writeValueWithoutResponse(part);
        if (pause) await sleep(pause);
      }
    },
    async close() {
      device.removeEventListener('gattserverdisconnected', handler);
      if (device.gatt.connected) device.gatt.disconnect();
    },
  };
}

export const bleTransport = {
  kind: 'ble',
  /**
   * Chrome draws this list itself. Asked for "all devices", it fills up with every earbud,
   * watch and TV nearby, and any device that does not broadcast a name is shown as
   * "Unknown or Unsupported Device (MAC)" — nothing a page can relabel. So the list is
   * narrowed to things that look like printers: a printer service, or a printer-ish name.
   * `all` is the escape hatch for the odd printer that matches neither.
   */
  async pick({ all = false } = {}) {
    const options = all
      ? { acceptAllDevices: true, optionalServices: BLE_SERVICES }
      : {
          filters: [
            ...BLE_SERVICES.map((uuid) => ({ services: [uuid] })),
            ...PRINTER_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
          ],
          optionalServices: BLE_SERVICES,
        };
    const device = await navigator.bluetooth.requestDevice(options);
    return { device, draft: { transport: 'ble', address: device.id, name: device.name || 'Bluetooth printer' } };
  },
  async reopen(record, { device, onDrop } = {}) {
    let target = device;
    if (!target && navigator.bluetooth.getDevices) {
      const granted = await navigator.bluetooth.getDevices();
      target = granted.find((d) => d.id === record.address);
    }
    if (!target) {
      const err = new Error('needs-tap');
      err.code = 'needs-tap';
      throw err;
    }
    return openBleDevice(target, onDrop);
  },
};

// ------------------------------------------------------------------------ Web Serial ---

function serialKey(port) {
  const info = port.getInfo?.() || {};
  if (info.bluetoothServiceClassId) return `bt:${info.bluetoothServiceClassId}`;
  return `usb:${info.usbVendorId || 0}:${info.usbProductId || 0}`;
}

/**
 * Serial and USB ports are opened for each job and released straight after, not held.
 * A port can be open in only one tab at a time, and shops keep several tabs of the app
 * open; a port held by the Billing tab would make the Tables tab's KOT fail. Opening a
 * port takes a few milliseconds, so nothing is lost.
 */
async function openSerialPort(port, record, onDrop) {
  const baudRate = Number(record.baud) || 9600;
  // Prove it opens now, so "Connected" means something.
  await port.open({ baudRate, bufferSize: 4096 });
  await port.close();
  const handler = (event) => {
    if (event.target === port || event.port === port) {
      navigator.serial.removeEventListener('disconnect', handler);
      onDrop?.();
    }
  };
  navigator.serial.addEventListener('disconnect', handler);
  return {
    async write(bytes, { slow } = {}) {
      await port.open({ baudRate, bufferSize: 4096 });
      const writer = port.writable.getWriter();
      try {
        const chunk = slow ? 256 : 4096;
        for (let i = 0; i < bytes.length; i += chunk) {
          await writer.write(bytes.slice(i, i + chunk));
          if (slow) await sleep(20);
        }
        await writer.ready;
      } finally {
        writer.releaseLock();
        try {
          await port.close();
        } catch {
          // unplugged mid-job
        }
      }
    },
    async close() {
      navigator.serial.removeEventListener('disconnect', handler);
      try {
        await port.close();
      } catch {
        // not open
      }
    },
  };
}

export const serialTransport = {
  kind: 'serial',
  async pick() {
    let port;
    try {
      port = await navigator.serial.requestPort({ allowedBluetoothServiceClassIds: [SPP_UUID] });
    } catch (err) {
      // Older Chrome rejects the Bluetooth option outright; ask again without it.
      if (err?.name === 'TypeError') port = await navigator.serial.requestPort();
      else throw err;
    }
    const info = port.getInfo?.() || {};
    const viaBluetooth = Boolean(info.bluetoothServiceClassId);
    return {
      port,
      draft: {
        transport: 'serial',
        address: serialKey(port),
        name: viaBluetooth ? 'Bluetooth printer (paired)' : usbPrinterName(info.usbVendorId) || 'USB printer (serial)',
      },
    };
  },
  async reopen(record, { port, onDrop } = {}) {
    let target = port;
    if (!target) {
      const ports = await navigator.serial.getPorts();
      target = ports.find((p) => serialKey(p) === record.address);
    }
    if (!target) {
      const err = new Error('needs-tap');
      err.code = 'needs-tap';
      throw err;
    }
    return openSerialPort(target, record, onDrop);
  },
};

// --------------------------------------------------------------------------- WebUSB ---

function usbKey(device) {
  return `${device.vendorId}:${device.productId}:${device.serialNumber || ''}`;
}

async function claimUsb(device) {
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  let chosen = null;
  for (const iface of device.configuration.interfaces) {
    for (const alt of iface.alternates) {
      const out = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
      if (out && (!chosen || alt.interfaceClass === 7)) chosen = { iface, alt, out };
    }
  }
  if (!chosen) {
    await device.close();
    const err = new Error('no-bulk-endpoint');
    err.code = 'unsupported-printer';
    throw err;
  }
  try {
    await device.claimInterface(chosen.iface.interfaceNumber);
  } catch (cause) {
    await device.close().catch(() => {});
    // Windows' own printer driver (usbprint.sys) holds it, or another tab is printing.
    const err = new Error(cause?.message || 'usb-busy');
    err.code = 'usb-busy';
    throw err;
  }
  if (chosen.alt.alternateSetting) {
    await device.selectAlternateInterface(chosen.iface.interfaceNumber, chosen.alt.alternateSetting);
  }
  return chosen;
}

async function releaseUsb(device, chosen) {
  try {
    await device.releaseInterface(chosen.iface.interfaceNumber);
  } catch {
    // unplugged
  }
  try {
    await device.close();
  } catch {
    // unplugged
  }
}

// Claimed per job and released after, for the same reason as the serial port above.
async function openUsbDevice(device, onDrop) {
  await releaseUsb(device, await claimUsb(device));
  const handler = (event) => {
    if (event.device === device) {
      navigator.usb.removeEventListener('disconnect', handler);
      onDrop?.();
    }
  };
  navigator.usb.addEventListener('disconnect', handler);
  return {
    async write(bytes, { slow } = {}) {
      const chosen = await claimUsb(device);
      try {
        const chunk = slow ? 512 : 16384;
        for (let i = 0; i < bytes.length; i += chunk) {
          await device.transferOut(chosen.out.endpointNumber, bytes.slice(i, i + chunk));
        }
      } finally {
        await releaseUsb(device, chosen);
      }
    },
    async close() {
      navigator.usb.removeEventListener('disconnect', handler);
    },
  };
}

export const usbTransport = {
  kind: 'usb',
  async pick() {
    const device = await navigator.usb.requestDevice({ filters: [] });
    return {
      device,
      draft: {
        transport: 'usb',
        address: usbKey(device),
        name: (device.productName || '').trim() || usbPrinterName(device.vendorId) || 'USB printer',
      },
    };
  },
  async reopen(record, { device, onDrop } = {}) {
    let target = device;
    if (!target) {
      const devices = await navigator.usb.getDevices();
      target = devices.find((d) => usbKey(d) === record.address);
    }
    if (!target) {
      const err = new Error('needs-tap');
      err.code = 'needs-tap';
      throw err;
    }
    return openUsbDevice(target, onDrop);
  },
};

// ------------------------------------------------------------- Print Bridge (network) ---

/**
 * A browser cannot open a raw socket to a WiFi/LAN printer — that is a security rule, not
 * a missing feature. The BillVyse Print Bridge is a small program on the shop's computer
 * that does it for the page (see print-bridge/ in this repo). It only listens on this
 * computer and only answers our own sites.
 */
export const BRIDGE_URL = 'http://127.0.0.1:17777';

async function bridgeFetch(path, body, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetch(`${BRIDGE_URL}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      // Chrome's local-network rules want this said out loud for a public page → loopback.
      targetAddressSpace: 'loopback',
      });
    } catch (cause) {
      // A slow printer job is a timeout; anything else (refused, blocked by the browser's
      // local-network permission) means the bridge cannot be reached from this page.
      const err = new Error(cause?.message || 'bridge-missing');
      err.code = cause?.name === 'AbortError' && path !== '/status' ? 'timeout' : 'bridge-missing';
      throw err;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || `bridge ${response.status}`);
      err.code = data.code || 'bridge-error';
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function bridgeAvailable() {
  try {
    const data = await bridgeFetch('/status', null, 1500);
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

export async function bridgeScan() {
  const data = await bridgeFetch('/scan', {}, 20000);
  return data.printers || [];
}

export const bridgeTransport = {
  kind: 'network',
  async reopen(record) {
    const [host, port] = String(record.address).split(':');
    const probe = await bridgeFetch('/probe', { host, port: Number(port) || 9100 }, 8000);
    this.lastName = probe?.name || null;
    return {
      async write(bytes) {
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        await bridgeFetch('/print', { host, port: Number(port) || 9100, data: btoa(binary) }, 30000);
      },
      async close() {},
    };
  },
};
