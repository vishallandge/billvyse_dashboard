/**
 * Mirror of the encoder half of backend/utils/barcode.js. The dashboard cannot import from
 * the backend, so the one rule is: change that file and this one together.
 *
 * Only the encoder is mirrored — the backend's `drawBarcode` paints into a pdfkit document,
 * and the browser paints the same run-lengths as plain divs (see app/components/LabelPreview.js).
 * Sharing the encoder is what makes the on-screen bars the SAME bars the printer lays down:
 * same modules, same widths, so a barcode that is too narrow to scan looks too narrow on
 * screen instead of being discovered on a printed sheet of 200.
 *
 * Code 128-B covers ASCII 32–126, which is every barcode a kirana store will ever type or
 * scan: EAN/UPC digits, alphanumeric SKUs, and the shop's own codes.
 */

// Each entry is six run-lengths (bar, space, bar, space, bar, space) in narrow-module
// units; the stop pattern has a seventh. This is the standard Code 128 table.
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

export function isEncodable(value) {
  return typeof value === 'string' && value.length > 0 && /^[\x20-\x7E]+$/.test(value);
}

/**
 * @returns {{ runs: number[], modules: number }} alternating bar/space widths starting
 * with a bar, and the total width in narrow modules (useful for scaling to a box).
 */
export function encodeCode128B(value) {
  if (!isEncodable(value)) return null;

  const codes = [START_B];
  for (const char of value) {
    codes.push(char.charCodeAt(0) - 32);
  }

  // Checksum: start value plus each symbol weighted by its 1-based position, mod 103.
  let checksum = START_B;
  for (let i = 1; i < codes.length; i += 1) {
    checksum += codes[i] * i;
  }
  codes.push(checksum % 103);
  codes.push(STOP);

  const runs = [];
  for (const code of codes) {
    for (const digit of PATTERNS[code]) {
      runs.push(Number(digit));
    }
  }

  return { runs, modules: runs.reduce((sum, run) => sum + run, 0) };
}

/**
 * The bars as `{ left, width }` fractions of the symbol's total width, spaces omitted.
 *
 * Fractions rather than pixels so the caller can render the same symbol at any size —
 * a 120px preview and a 38mm thermal sticker are the same list scaled differently.
 */
export function barcodeBars(value) {
  const encoded = encodeCode128B(String(value ?? ''));
  if (!encoded) return null;

  const bars = [];
  let cursor = 0;
  let isBar = true;
  for (const run of encoded.runs) {
    if (isBar) bars.push({ left: cursor / encoded.modules, width: run / encoded.modules });
    cursor += run;
    isBar = !isBar;
  }
  return bars;
}
