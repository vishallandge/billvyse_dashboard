// Best-effort Web Bluetooth ESC/POS printing for generic thermal receipt printers.
// Only works in browsers with Web Bluetooth (Chrome on Android/desktop). Targets the
// common "Generic/Printer" GATT service UUID used by many cheap 58mm/80mm BT printers —
// hardware varies, so this may need the service/characteristic UUIDs adjusted per model.
const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const PRINTER_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

const ESC = 0x1b;
const GS = 0x1d;

export function isBluetoothPrintingSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

function textToEscPos(text) {
  const encoder = new TextEncoder();
  const body = encoder.encode(text.replace(/₹/g, 'Rs.') + '\n\n\n');
  return new Uint8Array([ESC, 0x40, ...body, GS, 0x56, 0x01]);
}

export async function printViaBluetooth(text) {
  if (!isBluetoothPrintingSupported()) {
    throw new Error('Web Bluetooth is not supported in this browser');
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [PRINTER_SERVICE_UUID] }],
    optionalServices: [PRINTER_SERVICE_UUID],
  });

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
  const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);

  const bytes = textToEscPos(text);
  const chunkSize = 180;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    await characteristic.writeValue(bytes.slice(i, i + chunkSize));
  }

  server.disconnect();
}
