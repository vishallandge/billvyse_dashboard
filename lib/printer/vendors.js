/**
 * A readable name for a USB printer from its vendor id, for the two cases where the browser
 * gives us nothing better: a printer reached as a COM port (Web Serial exposes no name at
 * all) and a USB printer whose firmware left its product string empty.
 *
 * Only vendors we are sure of. Several ids here are chip makers, not printer brands — the
 * generic Chinese POS printers sold under a dozen labels all use the same few USB chips —
 * so those say "POS printer" rather than guessing a brand that may be wrong.
 *
 * Mirrored in android/.../printer/PrinterPlugin.java (usbBrandName) — change the two together.
 */

const BRANDS = {
  0x04b8: 'Epson',
  0x0519: 'Star',
  0x1504: 'Bixolon',
  0x1d90: 'Citizen',
  0x154f: 'SNBC',
  0x0a5f: 'Zebra',
  0x1203: 'TSC',
};

// USB chips inside unbranded POS printers.
const GENERIC_POS = new Set([0x0416, 0x0483, 0x1fc9, 0x28e9, 0x0fe6, 0x6868]);

// USB-to-serial adapter chips: the printer itself is on the other end of a cable.
const SERIAL_ADAPTERS = new Set([0x1a86, 0x067b, 0x0403, 0x10c4]);

/** e.g. "Epson printer (USB)", "POS printer (USB)", or null when the vendor is unknown. */
export function usbPrinterName(vendorId) {
  const id = Number(vendorId);
  if (!id) return null;
  if (BRANDS[id]) return `${BRANDS[id]} printer (USB)`;
  if (GENERIC_POS.has(id)) return 'POS printer (USB)';
  if (SERIAL_ADAPTERS.has(id)) return 'Serial printer (USB adapter)';
  return null;
}
