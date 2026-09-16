'use client';

/**
 * The Indian tricolour, drawn.
 *
 * Not the 🇮🇳 emoji. The app bans emoji standing in for a glyph (see
 * backend/tests/stateArtAndGlyphs.test.js) and this is the case that shows why: a flag
 * emoji inherits the DEVICE's artwork, renders as the two letters "IN" in a box on most of
 * Windows, and as a tofu square on older Android. It is the one mark here that has to be
 * recognised at 18px by someone who cannot read the label beside it.
 *
 * 3:2, the flag's own ratio, in three equal bands with the navy chakra centred. Twinned in
 * frontend/app/components/IndiaFlag.js — the customer app and the supplier portal are a
 * separate build and cannot import across; the two files must change together.
 */
export default function IndiaFlag({ size = 18, className = '' }) {
  return (
    <svg
      width={size}
      height={(size * 2) / 3}
      viewBox="0 0 36 24"
      className={`india-flag${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="36" height="8" fill="#FF9933" />
      <rect y="8" width="36" height="8" fill="#FFFFFF" />
      <rect y="16" width="36" height="8" fill="#138808" />
      <circle cx="18" cy="12" r="3.2" fill="none" stroke="#000080" strokeWidth="0.7" />
      <circle cx="18" cy="12" r="0.7" fill="#000080" />
      {/* The chakra has 24 spokes. All 24 at this size is a smudge, so it is the wheel plus
          eight marks — which is what the eye actually resolves at 18px. */}
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (i * Math.PI) / 4;
        return (
          <line
            key={i}
            x1={18 + Math.cos(angle) * 1}
            y1={12 + Math.sin(angle) * 1}
            x2={18 + Math.cos(angle) * 3.2}
            y2={12 + Math.sin(angle) * 3.2}
            stroke="#000080"
            strokeWidth="0.45"
          />
        );
      })}
      {/* A hairline, or the white middle band dissolves into a light card. */}
      <rect width="36" height="24" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="1" />
    </svg>
  );
}
