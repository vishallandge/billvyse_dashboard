/**
 * Mirror of backend/utils/labelSpec.js. The dashboard cannot import from the backend, so
 * the one rule is: change that file and this one together.
 *
 * This duplication is the whole reason the label studio can show a REAL preview. The
 * browser lays a sticker out with this code and the PDF draws it with the same code, so
 * what a shopkeeper sees on screen is what the printer puts on the shelf — including the
 * line that gets dropped because it did not fit.
 *
 * Nothing here draws anything. `buildLabelItems()` returns positioned boxes in points
 * relative to the sticker's top-left corner; absolutely-positioned divs paint them in
 * app/components/LabelPreview.js and pdfkit paints them in the backend controller.
 */

export const MM = 72 / 25.4; // points per millimetre — pdfkit works in points

const A4 = [210, 297];

/**
 * Sheets and rolls a shopkeeper can actually buy. Each entry is defined by the NOMINAL
 * sticker size printed on the packet (that is how they are sold — "48×25mm, 40 up") and
 * the margins are derived by centring the grid on the page, which is how the sheets are
 * actually die-cut. Defining it the other way round — margins first — is what made the
 * old A4-40 layout quietly print 47mm stickers onto 48.5mm die-cuts.
 */
export const LABEL_LAYOUTS = {
  'a4-24': { kind: 'sheet', pageMm: A4, cols: 3, rows: 8, cellWmm: 63.5, cellHmm: 33.9, gapXmm: 2.5, gapYmm: 0, note: 'Sabse common sheet' },
  'a4-40': { kind: 'sheet', pageMm: A4, cols: 4, rows: 10, cellWmm: 48.5, cellHmm: 25.4, gapXmm: 0, gapYmm: 0 },
  'a4-65': { kind: 'sheet', pageMm: A4, cols: 5, rows: 13, cellWmm: 38.1, cellHmm: 21.2, gapXmm: 2.5, gapYmm: 0 },
  'a4-21': { kind: 'sheet', pageMm: A4, cols: 3, rows: 7, cellWmm: 70, cellHmm: 42.3, gapXmm: 0, gapYmm: 0 },
  'a4-8': { kind: 'sheet', pageMm: A4, cols: 2, rows: 4, cellWmm: 99.1, cellHmm: 67.7, gapXmm: 0, gapYmm: 0, note: 'Shelf talker' },
  'a4-4': { kind: 'sheet', pageMm: A4, cols: 2, rows: 2, cellWmm: 105, cellHmm: 148.5, gapXmm: 0, gapYmm: 0, note: 'Bada price card' },
  // Rolls: one sticker IS the page, so the printer's own gap between labels does the rest.
  'roll-50x25': { kind: 'roll', cols: 1, rows: 1, cellWmm: 50, cellHmm: 25, gapXmm: 0, gapYmm: 0, note: 'Thermal roll' },
  'roll-38x25': { kind: 'roll', cols: 1, rows: 1, cellWmm: 38, cellHmm: 25, gapXmm: 0, gapYmm: 0 },
  'roll-50x38': { kind: 'roll', cols: 1, rows: 1, cellWmm: 50, cellHmm: 38, gapXmm: 0, gapYmm: 0 },
  'roll-75x50': { kind: 'roll', cols: 1, rows: 1, cellWmm: 75, cellHmm: 50, gapXmm: 0, gapYmm: 0 },
  'roll-100x50': { kind: 'roll', cols: 1, rows: 1, cellWmm: 100, cellHmm: 50, gapXmm: 0, gapYmm: 0 },
  // Two-across on a 100mm roll — the cheapest way to double a thermal printer's output.
  'roll-100x25-2': { kind: 'roll', cols: 2, rows: 1, cellWmm: 50, cellHmm: 25, gapXmm: 0, gapYmm: 0 },
};

export const DEFAULT_LAYOUT = 'a4-24';

/**
 * Resolves a layout id (or a custom sheet the seller typed in) into full geometry.
 * `custom` is `{ cellWmm, cellHmm, cols, rows, gapXmm, gapYmm, kind }` — the escape hatch
 * for the hundred odd sticker sheets sold in local stationery shops that no fixed list
 * will ever cover.
 */
export function resolveLayout(id, custom) {
  let base;
  if (id === 'custom' && custom) {
    const cols = clamp(Math.round(Number(custom.cols) || 1), 1, 20);
    const rows = clamp(Math.round(Number(custom.rows) || 1), 1, 40);
    const cellWmm = clamp(Number(custom.cellWmm) || 50, 12, 210);
    const cellHmm = clamp(Number(custom.cellHmm) || 25, 8, 297);
    const kind = custom.kind === 'roll' ? 'roll' : 'sheet';
    base = {
      kind,
      pageMm: kind === 'roll' ? null : A4,
      cols,
      rows,
      cellWmm,
      cellHmm,
      gapXmm: clamp(Number(custom.gapXmm) || 0, 0, 30),
      gapYmm: clamp(Number(custom.gapYmm) || 0, 0, 30),
    };
  } else {
    base = LABEL_LAYOUTS[id] || LABEL_LAYOUTS[DEFAULT_LAYOUT];
  }

  const perPage = base.cols * base.rows;
  if (base.kind === 'roll') {
    // A roll "page" is exactly the labels across it — no margins, nothing to centre.
    const pageMm = [base.cellWmm * base.cols + base.gapXmm * (base.cols - 1), base.cellHmm * base.rows + base.gapYmm * (base.rows - 1)];
    return { ...base, id, pageMm, marginXmm: 0, marginYmm: 0, perPage };
  }

  const [pageW, pageH] = base.pageMm;
  const usedW = base.cols * base.cellWmm + base.gapXmm * (base.cols - 1);
  const usedH = base.rows * base.cellHmm + base.gapYmm * (base.rows - 1);
  return {
    ...base,
    id,
    marginXmm: Math.max(0, (pageW - usedW) / 2),
    marginYmm: Math.max(0, (pageH - usedH) / 2),
    perPage,
  };
}

/** Where sticker `slot` sits on its page, in points. */
export function slotBox(geometry, slot) {
  const col = slot % geometry.cols;
  const row = Math.floor(slot / geometry.cols) % geometry.rows;
  return {
    x: (geometry.marginXmm + col * (geometry.cellWmm + geometry.gapXmm)) * MM,
    y: (geometry.marginYmm + row * (geometry.cellHmm + geometry.gapYmm)) * MM,
    w: geometry.cellWmm * MM,
    h: geometry.cellHmm * MM,
  };
}

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

/**
 * A template is not a different renderer — it is an order of blocks plus a set of base
 * font sizes. Everything else (scaling to the sticker, dropping what does not fit) is
 * common, which is why adding a sixth template is a dozen lines rather than a project.
 *
 * Base sizes are tuned for the 63×34mm sticker and scaled from there, so the same
 * template stays readable on a 21mm strip and genuinely large on a 148mm price card —
 * the old renderer used one hardcoded 7.5pt name on every size.
 */
const TEMPLATES = {
  classic: {
    order: ['custom', 'shop', 'name', 'pack', 'mrp', 'price', 'savings', 'lot', 'tax', 'barcode', 'printedOn'],
    sizes: { name: 7.5, price: 11, mrp: 6, shop: 5, pack: 5.2, savings: 5.4, lot: 4.8, tax: 4.6, custom: 5.6, printedOn: 4.2, code: 4.6 },
    barcode: { min: 9, max: 20 },
    align: 'left',
    justify: 'start',
  },
  pricePop: {
    order: ['custom', 'shop', 'name', 'mrp', 'price', 'savings', 'pack', 'barcode'],
    sizes: { name: 6.8, price: 21, mrp: 7.5, shop: 4.8, pack: 5.2, savings: 6.2, custom: 6, code: 4.4 },
    barcode: { min: 0, max: 12 },
    align: 'center',
    justify: 'center',
  },
  scan: {
    order: ['name', 'lot', 'price', 'barcode', 'shop'],
    sizes: { name: 6.6, price: 8, lot: 4.8, shop: 4.4, code: 5 },
    barcode: { min: 14, max: 36 },
    align: 'left',
    justify: 'start',
  },
  minimal: {
    order: ['name', 'mrp', 'price', 'barcode'],
    sizes: { name: 8.5, price: 13.5, mrp: 6.5, code: 4.4 },
    barcode: { min: 0, max: 14 },
    align: 'center',
    justify: 'center',
  },
  talker: {
    order: ['shop', 'name', 'pack', 'mrp', 'price', 'savings', 'custom', 'lot', 'tax', 'barcode', 'printedOn'],
    sizes: { name: 11, price: 26, mrp: 9, shop: 6, pack: 7, savings: 8, custom: 8, lot: 5.5, tax: 5, printedOn: 4.5, code: 5 },
    barcode: { min: 0, max: 22 },
    align: 'center',
    justify: 'center',
  },
};

export const LABEL_TEMPLATES = [
  { id: 'classic', label: 'Classic', hint: 'Naam, rate, barcode — rozana ka shelf sticker' },
  { id: 'pricePop', label: 'Big price', hint: 'Rate sabse bada — offer aur shelf edge ke liye' },
  { id: 'scan', label: 'Scan-first', hint: 'Bada barcode — billing tez karne ke liye' },
  { id: 'minimal', label: 'Minimal', hint: 'Sirf naam aur rate, saaf-suthra' },
  { id: 'talker', label: 'Shelf talker', hint: 'Poster jaisa card — bachat badge aur QR ke saath' },
];

/** Every switch the studio offers, in the order the settings panel shows them. */
export const LABEL_FIELDS = [
  'shopName',
  'pack',
  'mrp',
  'savings',
  'barcode',
  'barcodeText',
  'qr',
  'batch',
  'expiry',
  'hsn',
  'category',
  'customLine',
  'printedOn',
  'border',
];

const TEMPLATE_FIELD_DEFAULTS = {
  classic: { shopName: true, mrp: true, savings: false, barcode: true, barcodeText: true, pack: true, border: false },
  pricePop: { shopName: true, mrp: true, savings: true, barcode: false, barcodeText: false, pack: true, border: false },
  scan: { shopName: false, mrp: false, savings: false, barcode: true, barcodeText: true, pack: false, batch: true, expiry: true, border: false },
  minimal: { shopName: false, mrp: true, savings: false, barcode: false, barcodeText: false, pack: false, border: false },
  talker: { shopName: true, mrp: true, savings: true, barcode: false, barcodeText: false, qr: true, pack: true, border: true },
};

export function defaultFields(templateId) {
  const base = Object.fromEntries(LABEL_FIELDS.map((field) => [field, false]));
  return { ...base, ...(TEMPLATE_FIELD_DEFAULTS[templateId] || TEMPLATE_FIELD_DEFAULTS.classic) };
}

/* ------------------------------------------------------------------ *
 * Building one sticker
 * ------------------------------------------------------------------ */

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function money(value) {
  // "Rs." and not "₹": pdfkit's built-in Helvetica is WinAnsi-encoded and has no rupee
  // glyph, so a ₹ prints as a black box on the sticker. The on-screen preview shows the
  // same string on purpose — a preview that flatters the print is worse than no preview.
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

function shortDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${month}/${String(date.getFullYear()).slice(-2)}`;
}

function dayDate(value) {
  const date = value ? new Date(value) : new Date();
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${String(date.getFullYear()).slice(-2)}`;
}

/**
 * How much a pack tells you about itself: "1 kg", "Strip of 15", "Size: M · Blue".
 * A price sticker without this is the single most common complaint at the counter —
 * two sizes of the same atta on one shelf and no way to tell which rate is which.
 */
function packLine(product) {
  const parts = [];
  if (product.subUnit && product.subUnitsPerUnit > 1) {
    parts.push(`${product.unit || 'pack'} of ${product.subUnitsPerUnit} ${product.subUnit}`);
  } else if (product.unit && product.unit !== 'piece') {
    parts.push(`per ${product.unit}`);
  }
  if (Array.isArray(product.variantAttributes)) {
    product.variantAttributes.forEach((attribute) => parts.push(`${attribute.name}: ${attribute.value}`));
  }
  return parts.join(' · ');
}

/**
 * The one function both renderers call.
 *
 * @returns {{ items: Array, scale: number, border: boolean, pad: number }} items carry
 *   `kind` ('text' | 'price' | 'barcode' | 'qr' | 'badge') and a box in points measured
 *   from the sticker's top-left corner.
 */
export function buildLabelItems({ product, shop, template = 'classic', fields = {}, fontScale = 1, widthPt, heightPt, qrValue, now }) {
  const tmpl = TEMPLATES[template] || TEMPLATES.classic;
  const widthMm = widthPt / MM;
  const heightMm = heightPt / MM;

  // Area-based so a sticker twice as big gets type roughly √2 bigger — linear scaling on
  // width alone made 100mm rolls print absurd 18pt shop names.
  const scale = clamp(Math.sqrt((widthMm * heightMm) / (63.5 * 33.9)), 0.62, 3.2) * clamp(Number(fontScale) || 1, 0.7, 1.6);
  const size = (role) => (tmpl.sizes[role] || 5) * scale;

  const mrp = Number(product.mrp) || 0;
  const price = Number(product.price) || 0;
  const hasSeparateMrp = mrp > 0 && mrp > price;
  const saving = hasSeparateMrp ? mrp - price : 0;

  const blocks = [];
  const push = (block) => {
    if (block && (block.text || block.value)) blocks.push(block);
  };

  const make = {
    custom: () =>
      fields.customLine && String(fields.customLine).trim()
        ? { kind: 'text', role: 'custom', text: String(fields.customLine).trim().slice(0, 40), size: size('custom'), weight: 'bold', tone: 'ink', priority: 45 }
        : null,
    shop: () => (fields.shopName && shop?.shopName ? { kind: 'text', role: 'shop', text: shop.shopName, size: size('shop'), tone: 'muted', priority: 35 } : null),
    name: () => ({ kind: 'text', role: 'name', text: product.name || '', size: size('name'), weight: 'bold', tone: 'ink', priority: 100 }),
    pack: () => {
      const text = fields.pack ? packLine(product) : '';
      return text ? { kind: 'text', role: 'pack', text, size: size('pack'), tone: 'muted', priority: 30 } : null;
    },
    mrp: () =>
      fields.mrp && hasSeparateMrp
        ? { kind: 'text', role: 'mrp', text: `MRP ${money(mrp)}`, size: size('mrp'), tone: 'muted', strike: true, priority: 50 }
        : null,
    price: () => ({
      kind: 'price',
      role: 'price',
      text: money(price),
      suffix: product.unit && product.unit !== 'piece' ? `/${product.unit}` : '',
      size: size('price'),
      weight: 'bold',
      tone: 'ink',
      priority: 95,
    }),
    savings: () =>
      fields.savings && saving > 0
        ? { kind: 'badge', role: 'savings', text: `Bachat ${money(saving)}`, size: size('savings'), priority: 40 }
        : null,
    lot: () => {
      const bits = [];
      if (fields.batch && product.batchNumber) bits.push(`B.No ${product.batchNumber}`);
      if (fields.expiry && product.expiryDate) bits.push(`Exp ${shortDate(product.expiryDate)}`);
      return bits.length ? { kind: 'text', role: 'lot', text: bits.join('  '), size: size('lot'), tone: 'muted', priority: 55 } : null;
    },
    tax: () => {
      const bits = [];
      if (fields.hsn && product.hsnCode) bits.push(`HSN ${product.hsnCode}`);
      if (fields.hsn && product.gstRate > 0) bits.push(`GST ${product.gstRate}%`);
      if (fields.category && product.category) bits.push(product.category);
      return bits.length ? { kind: 'text', role: 'tax', text: bits.join(' · '), size: size('tax'), tone: 'muted', priority: 20 } : null;
    },
    barcode: () => {
      const value = String(product.barcode || '').trim();
      if (!fields.barcode || !isPrintableCode(value)) return null;
      return {
        kind: 'barcode',
        role: 'barcode',
        value,
        showText: fields.barcodeText !== false,
        textSize: size('code'),
        min: tmpl.barcode.min * scale,
        max: tmpl.barcode.max * scale,
        flex: true,
        priority: 60,
      };
    },
    printedOn: () =>
      fields.printedOn ? { kind: 'text', role: 'printedOn', text: dayDate(now), size: size('printedOn'), tone: 'muted', priority: 10 } : null,
  };

  tmpl.order.forEach((role) => {
    if (make[role]) push(make[role]());
  });

  const wantsQr = Boolean(fields.qr && qrValue);
  return layoutBlocks(blocks, {
    widthPt,
    heightPt,
    scale,
    align: tmpl.align,
    justify: tmpl.justify,
    qr: wantsQr ? { kind: 'qr', role: 'qr', value: qrValue, priority: 58 } : null,
    border: Boolean(fields.border),
  });
}

/** Code 128-B covers ASCII 32–126, which is every barcode a shop will ever hold. */
export function isPrintableCode(value) {
  return typeof value === 'string' && value.length > 0 && /^[\x20-\x7E]+$/.test(value);
}

/**
 * Stacks the blocks top-down inside the sticker and, when they do not fit, drops the
 * least important one and tries again. Deterministic on both sides — the browser drops
 * exactly the same line the PDF does, so a preview never over-promises.
 */
function layoutBlocks(blocks, { widthPt, heightPt, scale, align, justify, qr, border }) {
  const pad = Math.max(1.8, 2.8 * Math.min(scale, 2));
  const innerX = pad;
  const innerY = pad;
  const innerW = Math.max(4, widthPt - pad * 2);
  const innerH = Math.max(4, heightPt - pad * 2);

  const items = [];
  let textW = innerW;

  // A QR sits in a square on the right and the text column simply gets narrower. One rule,
  // every template — a second placement rule is a second way for the two renderers to
  // disagree.
  if (qr) {
    const qrSize = Math.min(innerH, innerW * 0.34);
    if (qrSize >= 12) {
      items.push({ ...qr, x: innerX + innerW - qrSize, y: innerY + (innerH - qrSize) / 2, w: qrSize, h: qrSize });
      textW = innerW - qrSize - pad;
    }
  }

  const lineHeight = (block) => {
    if (block.kind === 'barcode') {
      const bars = clamp(block.max, block.min, block.max);
      return bars + (block.showText ? block.textSize * 1.25 : 0) + 1;
    }
    if (block.kind === 'badge') return block.size * 1.75;
    return block.size * 1.28;
  };

  let visible = blocks.slice();
  const totalFixed = () => visible.reduce((sum, block) => sum + lineHeight(block), 0);

  // Drop by priority until it fits. Name and price are effectively never dropped — a
  // sticker without a rate is not a sticker.
  while (visible.length > 1 && totalFixed() > innerH) {
    let weakest = 0;
    visible.forEach((block, index) => {
      if (block.priority < visible[weakest].priority) weakest = index;
    });
    if (visible[weakest].priority >= 95) break;
    visible.splice(weakest, 1);
  }

  // Whatever height is left over goes to the barcode, which is the one block happy to
  // stretch. Everything else keeps its size.
  const barcode = visible.find((block) => block.kind === 'barcode');
  let barHeight = 0;
  if (barcode) {
    const others = visible.filter((block) => block !== barcode).reduce((sum, block) => sum + lineHeight(block), 0);
    const spare = innerH - others - (barcode.showText ? barcode.textSize * 1.25 + 1 : 1);
    barHeight = clamp(spare, 0, barcode.max);
    if (barHeight < Math.max(barcode.min, 7)) {
      visible = visible.filter((block) => block !== barcode);
      barHeight = 0;
    }
  }

  const heightOf = (block) => (block.kind === 'barcode' ? barHeight + (block.showText ? block.textSize * 1.25 : 0) + 1 : lineHeight(block));
  const used = visible.reduce((sum, block) => sum + heightOf(block), 0);
  let cursorY = innerY + (justify === 'center' ? Math.max(0, (innerH - used) / 2) : 0);

  visible.forEach((block) => {
    const height = heightOf(block);
    items.push({
      ...block,
      align,
      x: innerX,
      y: cursorY,
      w: textW,
      h: height,
      barHeight: block.kind === 'barcode' ? barHeight : undefined,
    });
    cursorY += height;
  });

  return { items, scale, pad, border, widthPt, heightPt };
}
