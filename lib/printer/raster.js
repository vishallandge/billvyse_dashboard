/**
 * Draws a piece of the page into a 1-bit bitmap at the printer's own resolution.
 *
 * The receipt and KOT already exist as DOM (ThermalReceipt.js, KotTicket.js) for the
 * browser's Print dialog. Printing that same node to a direct printer — instead of keeping
 * a second, hand-drawn copy of the receipt layout — is what stops the two from drifting:
 * a line added to the receipt shows up on both without anyone remembering to.
 *
 * How: the node is cloned into an off-screen box as wide as the paper's printable area,
 * every computed style is copied inline, and the clone is drawn through an SVG
 * <foreignObject> onto a canvas. System fonts render inside the SVG, which is exactly what
 * gives Devanagari and ₹ on printers whose own fonts have neither.
 *
 * If that fails (an old WebView that taints the canvas, say), the caller's plain-text
 * version of the same slip is drawn line by line instead. Uglier, but still a bill.
 */

const DPMM = 8; // 203 dpi — every thermal head in this price range
const PX_PER_MM = 96 / 25.4;
const FONT_STACK = "'Segoe UI', Roboto, 'Noto Sans', 'Nirmala UI', 'Noto Sans Devanagari', 'Mangal', system-ui, sans-serif";

/** Printable width in dots for a paper roll. The head is narrower than the paper. */
export function dotsForPaper(paperMm) {
  if (Number(paperMm) <= 58) return 384; // 48mm printable
  return 576; // 72mm printable on 80mm paper
}

// A frame for layout to settle — but never only a frame: a background tab gets no
// animation frames at all, and an auto-print must not hang because the cashier switched tabs.
export function waitFrame() {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 60);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits (briefly) for the caller's readiness check — e.g. a QR image still encoding. */
async function waitUntil(check, timeoutMs = 1500) {
  if (!check) return;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (check()) return;
    } catch {
      return;
    }
    await sleep(60);
  }
}

// Sizes are NOT frozen from the page. The snapshot renders with system fonts, which are
// never exactly as tall as the page's web fonts; a height copied from the page then clips
// the text that no longer fits — which is how the "thank you" footer vanished off the end
// of the slip. Sizes the markup states for itself (the sticker's absolute boxes, image
// sizes) are kept.
const FLOW_SIZES = new Set(['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'inline-size', 'block-size', 'min-inline-size', 'min-block-size', 'max-inline-size', 'max-block-size']);

function inlineStyles(element, keepSizes) {
  const computed = getComputedStyle(element);
  const own = element.style;
  const sized = keepSizes || element.tagName === 'IMG' || element.tagName === 'svg';
  let css = '';
  for (let i = 0; i < computed.length; i += 1) {
    const prop = computed[i];
    // Transitions and animations would be frozen mid-way in the snapshot; skip them.
    if (prop.startsWith('transition') || prop.startsWith('animation')) continue;
    if (FLOW_SIZES.has(prop) && !sized) {
      const stated = own.getPropertyValue(prop);
      if (stated) css += `${prop}:${stated};`;
      continue;
    }
    css += `${prop}:${computed.getPropertyValue(prop)};`;
  }
  const children = Array.from(element.children);
  children.forEach((child) => inlineStyles(child, false));
  element.setAttribute('style', css);
}

// The last row with any ink, so a slip ends where its content ends.
function lastInkRow(bitmap) {
  const { bytesPerRow, data, height } = bitmap;
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let b = 0; b < bytesPerRow; b += 1) {
      if (data[y * bytesPerRow + b]) return y;
    }
  }
  return -1;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function imageToDataUrl(img) {
  if (!img.src || img.src.startsWith('data:')) return img.src;
  // The shop's logo and signature live on the API's origin. Drawing a cross-origin <img>
  // onto a canvas taints it, so fetch the bytes instead (the API sends CORS headers for
  // our origins); the canvas route below is only for same-origin pictures.
  try {
    // The session cookie goes only to our own servers — never to whatever host a logo URL
    // happens to name.
    const host = new URL(img.src, window.location.href).hostname;
    const ours = host === window.location.hostname || host === 'billvyse.com' || host.endsWith('.billvyse.com');
    const response = await fetch(img.src, { credentials: ours ? 'include' : 'omit' });
    if (response.ok) return await blobToDataUrl(await response.blob());
  } catch {
    // fall through
  }
  try {
    if (!img.complete) await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = src;
  });
}

/**
 * Packs RGBA pixels into 1-bit rows. The threshold is a little above mid-grey on purpose:
 * the receipt's "muted" lines are 70–80% black on screen, and on thermal paper anything
 * that is not printed solid fades to nothing within weeks.
 */
function packBitmap(ctx, width, height, threshold = 190) {
  const { data } = ctx.getImageData(0, 0, width, height);
  const bytesPerRow = Math.ceil(width / 8);
  const out = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3] / 255;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * alpha + 255 * (1 - alpha);
      if (lum < threshold) out[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width, height, bytesPerRow, data: out };
}

/**
 * Rasterises a DOM node.
 *
 * @param {Element} element the node to print (it may be display:none on screen).
 * @param {{ widthDots: number, heightDots?: number, padBottomMm?: number, ready?: () => boolean }} options
 *   `heightDots` fixes the height (a sticker); otherwise the node's own height is used.
 */
export async function rasterizeElement(element, { widthDots, heightDots, padBottomMm = 2, ready, scale = 1, compact = false } = {}) {
  if (!element) throw new Error('nothing to print');
  await waitUntil(ready ? () => ready(element) : null);

  const widthMm = widthDots / DPMM;
  // Text size: the slip is laid out on a narrower box and then stretched to the paper, so
  // every letter comes out `scale` times bigger. The screen's 11px reads fine on a monitor,
  // but on thermal paper it is 2.8mm — smaller than the printer's own font. A sticker has a
  // fixed size and is never scaled.
  const textScale = heightDots ? 1 : Math.min(2.2, Math.max(0.8, Number(scale) || 1));
  const cssWidth = (widthMm * PX_PER_MM) / textScale;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = [
    'position:fixed', 'left:-20000px', 'top:0', `width:${cssWidth}px`,
    heightDots ? `height:${(heightDots / DPMM) * PX_PER_MM}px` : '',
    'background:#fff', 'color:#000', `font-family:${FONT_STACK}`,
    'pointer-events:none', 'z-index:-1', 'overflow:hidden', 'box-sizing:border-box',
  ].filter(Boolean).join(';');

  const clone = element.cloneNode(true);
  clone.style.display = 'block';
  clone.style.width = '100%';
  clone.style.margin = '0';
  // 1mm each side: some heads lose the outermost dots, and text drawn to the very edge of
  // the image ("PRICE", "pm") came out clipped. A sticker keeps its full width.
  clone.style.padding = heightDots ? '0' : `0 1mm ${padBottomMm}mm`;
  clone.style.boxSizing = 'border-box';
  clone.style.color = '#000';
  clone.style.background = '#fff';
  clone.style.position = 'static';
  if (heightDots) clone.style.height = '100%';
  // Compact: globals.css tightens the slip's spacing under this class — the paper saver.
  if (compact) host.classList.add('bv-print-compact');
  // Pictures that must keep a real-world size whatever the text size — a QR code bigger
  // than it needs to be is paper, one smaller than ~20mm stops scanning.
  clone.querySelectorAll('[data-print-mm]').forEach((box) => {
    const mm = Number(box.getAttribute('data-print-mm'));
    const img = box.querySelector('img');
    if (mm > 0 && img) {
      const px = (mm * PX_PER_MM) / textScale;
      img.style.width = `${px}px`;
      img.style.height = `${px}px`;
    }
  });
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    await waitFrame();
    // Images: the snapshot is a self-contained SVG, so every picture must be inlined.
    const images = Array.from(clone.querySelectorAll('img'));
    await Promise.all(images.map(async (img) => {
      const url = await imageToDataUrl(img);
      if (url) img.setAttribute('src', url);
      else img.remove();
    }));

    // A slip is drawn into a generously tall box and trimmed to its ink afterwards; a
    // sticker is exactly its own size.
    const pageHeight = Math.ceil(clone.getBoundingClientRect().height);
    // Capped under the browser's canvas limit (32767px): a 300-line bill still prints; a
    // longer one is cut at ~4 metres of paper rather than failing outright.
    const cssHeight = heightDots
      ? ((heightDots / DPMM) * PX_PER_MM) / textScale
      : Math.min(Math.ceil(pageHeight * 1.3 + 300), Math.floor(30000 / (widthDots / cssWidth)));
    inlineStyles(clone, Boolean(heightDots));
    clone.style.display = 'block';
    clone.style.width = `${cssWidth}px`;
    if (heightDots) clone.style.height = `${cssHeight}px`;

    const markup = new XMLSerializer().serializeToString(clone);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${cssWidth}" height="${cssHeight}">` +
      `<foreignObject x="0" y="0" width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${cssWidth}px;background:#fff;color:#000;font-family:${FONT_STACK.replace(/"/g, "'")}">${markup}</div>` +
      `</foreignObject></svg>`;
    const picture = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);

    const scale = widthDots / cssWidth;
    const width = widthDots;
    const height = heightDots || Math.max(8, Math.ceil(cssHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(picture, 0, 0, width, height);
    const bitmap = packBitmap(ctx, width, height); // throws SecurityError if the WebView tainted it
    if (heightDots) return bitmap;
    const last = lastInkRow(bitmap);
    if (last < 0) throw new Error('blank snapshot');
    const trimmed = Math.min(height, last + 1 + Math.round(padBottomMm * DPMM));
    return { ...bitmap, height: trimmed, data: bitmap.data.subarray(0, trimmed * bitmap.bytesPerRow) };
  } finally {
    host.remove();
  }
}

/**
 * Plain text, drawn line by line. The fallback when the DOM snapshot cannot be taken —
 * still an image, so ₹ and Devanagari still print.
 */
export function rasterizeText(text, { widthDots, scale = 1 }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const fontPx = Math.round((widthDots >= 576 ? 22 : 18) * Math.min(2.2, Math.max(0.8, Number(scale) || 1)));
  const lineH = Math.round(fontPx * 1.35);
  const canvas = document.createElement('canvas');
  canvas.width = widthDots;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const font = `${fontPx}px ui-monospace, Consolas, 'Noto Sans Mono', 'Nirmala UI', 'Noto Sans Devanagari', monospace`;
  ctx.font = font;

  // Wrap long lines to the paper instead of letting them run off the edge.
  const wrapped = [];
  lines.forEach((line) => {
    let rest = line;
    if (!rest) {
      wrapped.push('');
      return;
    }
    while (rest.length) {
      let cut = rest.length;
      while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > widthDots - 4) cut -= 1;
      wrapped.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
  });

  canvas.height = Math.max(lineH, wrapped.length * lineH + lineH);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.font = font; // resizing the canvas reset it
  ctx.textBaseline = 'top';
  wrapped.forEach((line, index) => ctx.fillText(line, 2, index * lineH + 4));
  return packBitmap(ctx, canvas.width, canvas.height);
}
