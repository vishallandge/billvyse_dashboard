/**
 * Colour maths for the theme generator — sRGB <-> OKLab/OKLCH plus WCAG contrast.
 *
 * Why OKLCH and not "just pick a darker hex": every derived token in this app has
 * to keep its accent recognisable while moving to a measured contrast. Nudging a
 * hex by eye moves hue and chroma too, which is how a marigold link ends up
 * looking brown and a tulsi one olive. In OKLCH lightness moves on its own axis,
 * so the derived tone is the SAME colour, just legible.
 *
 * Ported from Björn Ottosson's reference implementation (public domain).
 */

export function hexToRgb(h) {
  h = String(h).trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

export function rgbToOklab([r, g, b]) {
  const R = srgbToLinear(r / 255), G = srgbToLinear(g / 255), B = srgbToLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255,
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255,
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * 255,
  ];
}

export const toLch = (rgb) => { const [L, a, b] = rgbToOklab(rgb); return [L, Math.hypot(a, b), Math.atan2(b, a)]; };
export const fromLch = ([L, C, h]) => oklabToRgb([L, C * Math.cos(h), C * Math.sin(h)]);

/** True when a converted colour actually survives the round trip into 8-bit sRGB. */
const inGamut = (rgb) => rgb.every((v) => v >= -0.6 && v <= 255.6);

export function relLuminance([r, g, b]) {
  return 0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255);
}

export function contrast(a, b) {
  const l1 = relLuminance(a), l2 = relLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Flatten a translucent colour onto what is behind it, so the ratio is the real one. */
export const composite = (fg, alpha, bg) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));

/**
 * The same colour, moved along lightness ONLY as far as it has to be, until it
 * clears `target` against `bg`. A colour that already passes comes back
 * untouched — the point is to fix the tones that fail, not to flatten all
 * eleven accents onto one contrast value, which would make them look alike.
 *
 * Direction comes from the background: lift on a dark ground, deepen on a light
 * one. Chroma is pulled in only as far as the sRGB gamut forces, because an
 * out-of-gamut OKLCH triple clips to a colour of a DIFFERENT hue — exactly the
 * drift this function exists to avoid.
 */
export function ensureContrast(hex, bgHex, target) {
  const bg = typeof bgHex === 'string' ? hexToRgb(bgHex) : bgHex;
  const start = hexToRgb(hex);
  if (contrast(start, bg) >= target) return hex.toLowerCase();
  const [L0, C0, h] = toLch(start);
  const up = relLuminance(bg) < 0.18;
  for (let i = 1; i <= 220; i++) {
    const L = up ? L0 + i * 0.003 : L0 - i * 0.003;
    if (L > 0.995 || L < 0.02) break;
    for (let cs = 1; cs >= 0.3; cs -= 0.05) {
      const rgb = fromLch([L, C0 * cs, h]);
      if (!inGamut(rgb)) continue;
      const out = rgbToHex(rgb);
      if (contrast(hexToRgb(out), bg) >= target) return out;
      break;
    }
  }
  return up ? '#ffffff' : '#000000';
}

/**
 * The ink that goes ON a brand fill. Tries pure white first because that is what a
 * primary button wants to be; falls back to a very dark tone of the brand's OWN
 * hue rather than plain black, so a haldi button reads as dark-on-gold instead of
 * as a black rectangle with a yellow border.
 */
export function inkOn(fillHex, target = 4.5) {
  const fill = hexToRgb(fillHex);
  if (contrast([255, 255, 255], fill) >= target) return '#ffffff';
  const [, C, h] = toLch(fill);
  for (let L = 0.34; L >= 0.06; L -= 0.01) {
    for (let cs = 1; cs >= 0.3; cs -= 0.1) {
      const rgb = fromLch([L, C * cs, h]);
      if (!inGamut(rgb)) continue;
      if (contrast(hexToRgb(rgbToHex(rgb)), fill) >= target) return rgbToHex(rgb);
      break;
    }
  }
  return '#000000';
}
