'use client';

// The BillVyse mark, as drawn: the real logo asset, never a redrawn lookalike.
//
// public/billvyse-mark.png is that asset trimmed of its transparent padding and
// resampled once to 256px (60 KB, down from 877 KB). Both of those mattered and neither
// was cosmetic: the untrimmed original was ~11% empty margin, so the glyph rendered
// smaller than the box it was given, and asking the browser to squeeze 1254px into a
// 30px sidebar icon is a 40:1 downscale it does badly. 256px covers every size this
// component is used at (16-62px) including on a 2x display.
//
// A flat SVG redraw was tried here and reverted: it lost the receipt, the depth and the
// character, and looked worse at every single size than the real thing does. The
// full-resolution original is kept beside it as billvyse-mark-full.png.
export default function BrandLogo({ size = 30, className = '' }) {
  return (
    <img
      src="/billvyse-mark.png"
      width={size}
      height={size}
      alt="BillVyse"
      className={className}
    />
  );
}
