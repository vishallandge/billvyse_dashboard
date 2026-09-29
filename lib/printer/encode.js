/**
 * Turns a 1-bit picture into the bytes a printer understands.
 *
 * Everything is sent as a picture, never as text. A ₹40 thermal printer's built-in font
 * has no ₹, no Devanagari and no QR code, and every brand's font table is different — so
 * text mode is where "works on my printer, garbage on yours" comes from. A raster image
 * is the one command every ESC/POS printer since the 1990s agrees on, which is what makes
 * one code path serve every brand.
 *
 * Three dialects:
 *   - ESC/POS `GS v 0` raster: the modern, fast one. Almost every printer sold in India.
 *   - ESC/POS `ESC *` column mode: the old one. Slower, but the handful of printers that
 *     print garbage for `GS v 0` understand this. It is the "compat" switch in settings.
 *   - TSPL `BITMAP`: label/barcode printers (TSC, Xprinter label models, most Chinese
 *     sticker printers). They do not speak ESC/POS at all.
 */

const ESC = 0x1b;
const GS = 0x1d;

/** Concatenates byte arrays (and plain number arrays) into one Uint8Array. */
export function concatBytes(parts) {
  const arrays = parts.map((part) => (part instanceof Uint8Array ? part : Uint8Array.from(part)));
  const total = arrays.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  arrays.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

function asciiBytes(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/**
 * ESC/POS job for one bitmap.
 *
 * @param {{ width: number, height: number, bytesPerRow: number, data: Uint8Array }} bitmap
 *   rows packed MSB-first, 1 = black.
 * @param {{ compat?: boolean, cut?: boolean, drawer?: boolean, band?: number }} options
 */
export function escposImageJob(bitmap, { compat = false, cut = true, drawer = false, band = 96 } = {}) {
  const parts = [[ESC, 0x40]]; // initialise: clears whatever a previous job left half-set
  // Centre the image. A 58mm picture on an 80mm head would otherwise sit against the left edge.
  parts.push([ESC, 0x61, 0x01]);
  parts.push(compat ? columnMode(bitmap) : rasterMode(bitmap, band));
  parts.push([ESC, 0x61, 0x00]);
  // Feed past the tear bar. Four lines clears the cutter on every head we have seen; less
  // and the last line of the slip is torn through.
  parts.push([ESC, 0x64, 0x04]);
  if (cut) parts.push([GS, 0x56, 0x42, 0x00]); // partial cut after feed; ignored by cutter-less printers
  if (drawer) parts.push([ESC, 0x70, 0x00, 0x19, 0xfa]); // kick the cash drawer on pin 2
  return concatBytes(parts);
}

/**
 * `GS v 0`, sent in horizontal bands.
 *
 * One command for the whole slip is legal, but cheap printers have a 4–8 KB receive buffer
 * and a long receipt overflows it: the tail of the bill comes out as noise. Bands of 96
 * rows (72 bytes × 96 = 6.9 KB on an 80mm head) keep each command inside it.
 */
function rasterMode(bitmap, band) {
  const rows = Math.max(8, Math.min(band, 255));
  const parts = [];
  for (let y = 0; y < bitmap.height; y += rows) {
    const h = Math.min(rows, bitmap.height - y);
    parts.push([
      GS, 0x76, 0x30, 0x00,
      bitmap.bytesPerRow & 0xff, (bitmap.bytesPerRow >> 8) & 0xff,
      h & 0xff, (h >> 8) & 0xff,
    ]);
    parts.push(bitmap.data.subarray(y * bitmap.bytesPerRow, (y + h) * bitmap.bytesPerRow));
  }
  return concatBytes(parts);
}

/**
 * `ESC * 33` — 24-dot double-density columns, the mode older firmware understands.
 * Each stripe is 24 rows tall; line spacing is set to exactly 24 dots so stripes butt up
 * against each other without white lines between them.
 */
function columnMode(bitmap) {
  const { width, height, bytesPerRow, data } = bitmap;
  const parts = [[ESC, 0x33, 24]];
  for (let top = 0; top < height; top += 24) {
    const stripe = new Uint8Array(5 + width * 3 + 1);
    stripe.set([ESC, 0x2a, 33, width & 0xff, (width >> 8) & 0xff], 0);
    let offset = 5;
    for (let x = 0; x < width; x += 1) {
      const byteIndex = x >> 3;
      const mask = 0x80 >> (x & 7);
      for (let k = 0; k < 3; k += 1) {
        let slice = 0;
        for (let b = 0; b < 8; b += 1) {
          const y = top + k * 8 + b;
          if (y < height && data[y * bytesPerRow + byteIndex] & mask) slice |= 0x80 >> b;
        }
        stripe[offset] = slice;
        offset += 1;
      }
    }
    stripe[offset] = 0x0a;
    parts.push(stripe);
  }
  parts.push([ESC, 0x32]); // back to default line spacing
  return concatBytes(parts);
}

/**
 * TSPL job: one sticker image, printed `copies` times.
 *
 * TSPL's BITMAP is the opposite polarity to ESC/POS — a 1 bit is a WHITE dot — so the
 * data is inverted on the way out. Getting this backwards prints a solid black sticker
 * with a white barcode, which is the classic first-day bug with these printers.
 */
export function tsplImageJob(bitmap, { widthMm, heightMm, gapMm = 2, copies = 1 } = {}) {
  const inverted = new Uint8Array(bitmap.data.length);
  for (let i = 0; i < inverted.length; i += 1) inverted[i] = ~bitmap.data[i] & 0xff;
  const head = [
    `SIZE ${round1(widthMm)} mm,${round1(heightMm)} mm`,
    `GAP ${round1(gapMm)} mm,0 mm`,
    'DIRECTION 1,0',
    'REFERENCE 0,0',
    'CLS',
    `BITMAP 0,0,${bitmap.bytesPerRow},${bitmap.height},0,`,
  ].join('\r\n');
  return concatBytes([
    asciiBytes(head),
    inverted,
    asciiBytes(`\r\nPRINT 1,${Math.max(1, Math.round(copies))}\r\n`),
  ]);
}

function round1(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

/** Base64 for the native bridge — Capacitor passes strings, not byte arrays. */
export function bytesToBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}
