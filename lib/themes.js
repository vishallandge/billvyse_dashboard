/**
 * Accent themes — the single source of truth for the 10-theme picker.
 *
 * IMPORTANT: this file is duplicated at frontend/lib/themes.js (same rule as
 * lib/catalog.js). The two copies must change together, because the seller
 * picks a theme in the dashboard and the customer storefront renders it.
 *
 * ---------------------------------------------------------------------------
 * How theming works here
 * ---------------------------------------------------------------------------
 * Two independent dimensions live on <html>:
 *
 *     data-theme="dark|light"      the MODE  — backgrounds, text, contrast
 *     data-accent="marigold|..."   the THEME — brand hue only
 *
 * Keeping them separate is deliberate. Every one of the ~54 existing
 * [data-theme='light'] rules keeps working untouched, and a new accent can
 * never break light-mode contrast, because an accent only ever swaps brand
 * tokens — never --bg, --text, --surface or --border.
 *
 * The lightness ramp is fixed across all 10 themes; only hue and chroma move.
 * That is what makes them feel like one family instead of ten skins, and it is
 * why none of them need contrast re-testing per screen.
 *
 * ---------------------------------------------------------------------------
 * Palette slots
 * ---------------------------------------------------------------------------
 *   brand        the main accent
 *   strong       a deeper press/active state of brand      (storefront only)
 *   brandDark    darker edge — borders, gradient tail
 *   brandLight   in DARK mode a pale tint for text on dark;
 *                in LIGHT mode the deep tone used as text on white
 *   rgb          bare channels of `brand`, for rgba(var(--brand-rgb), .12)
 *   grad         two-stop brand gradient                   (storefront only)
 *
 * Per theme, mode-independent:
 *   ink          brand tone legible on WHITE in BOTH modes (white pills,
 *                the shareable poster, printed surfaces). Never a pale tint.
 *   badge        bright two-stop gradient that carries dark ink on top
 *   badgeInk     the dark ink that sits on `badge`
 *
 * `dark` is shared by both apps. `light` is the storefront's light palette
 * (warm cream page, so the brand deepens). `dashLight` is the dashboard's
 * light palette (cool gray page, so the brand stays vivid) — that difference
 * predates this file; it is preserved, not invented.
 *
 * Marigold's values are byte-for-byte what the app shipped before the picker
 * existed, in both apps and both modes. Switching to Marigold is a no-op.
 */

export const THEMES = [
  /**
   * The BillVyse mark's own navy, available as an optional accent.
   *
   * Sampled from the logo rather than guessed: the wordmark's navy is #011d46 and the
   * rising arrow's green is #2da232 (both read straight off public/billvyse-lockup.png).
   * Those two exact values appear here as `ink` and as the second stop of `badge`.
   *
   * What is NOT here is that navy used as `brand` in dark mode. #0f2a4d on a #0a0a0d page
   * is a button you cannot see — it fails every contrast rule there is. The ramp this file
   * keeps fixed across all ten themes is what solves it: same hue (214°), lifted to the
   * lightness every other dark-mode accent sits at. So the logo navy still leads every
   * printed and white surface (`ink`, brandLight in light mode), while the interactive UI
   * gets the legible blue from the same family. Measured, not eyeballed —
   *   dark  brand #3d86ea → 5.46:1 on --bg, on-brand ink #04142e → 5.06:1 on the fill
   *   light brand #2168cc → 5.36:1 on white, white on-brand → 5.36:1
   *   ink   #0f2a4d       → 14.4:1 on white
   */
  {
    id: 'billvyse',
    label: 'BillVyse',
    hint: 'Navy — the house colour',
    swatch: '#2168cc',
    ink: '#0f2a4d',
    // The logo's own blue-to-green sweep, the one place the two brand colours touch.
    badge: 'linear-gradient(135deg, #3d86ea, #2da232)',
    badgeInk: '#04142e',
    dark: {
      brand: '#3d86ea', strong: '#2f74d6', brandDark: '#245fb8', brandLight: '#9dc4f7',
      rgb: '61, 134, 234', grad: 'linear-gradient(135deg, #4d93ef, #2a6fd0)',
    },
    light: {
      brand: '#1d5fbf', strong: '#1a539f', brandDark: '#164788', brandLight: '#0f2a4d',
      rgb: '29, 95, 191', grad: 'linear-gradient(135deg, #2f7ae0, #1d5fbf)',
    },
    dashLight: { brand: '#2168cc', brandDark: '#1a539f', brandLight: '#0f2a4d', rgb: '33, 104, 204' },
  },
  {
    id: 'marigold',
    label: 'Marigold',
    hint: 'Genda orange',
    swatch: '#ff7a29',
    ink: '#c2410c',
    badge: 'linear-gradient(135deg, #ff7a29, #fbbf24)',
    badgeInk: '#26170a',
    dark: {
      brand: '#ff7a29', strong: '#ff6035', brandDark: '#d65c14', brandLight: '#ffb27a',
      rgb: '255, 122, 41', grad: 'linear-gradient(135deg, #ff8a3d, #ff5f2e)',
    },
    light: {
      brand: '#e8590c', strong: '#d94a08', brandDark: '#b03e06', brandLight: '#c2410c',
      rgb: '234, 88, 12', grad: 'linear-gradient(135deg, #f97316, #ea580c)',
    },
    dashLight: { brand: '#ff7a29', brandDark: '#e0590f', brandLight: '#c2410c', rgb: '255, 122, 41' },
  },
  {
    id: 'indigo',
    label: 'Indigo',
    hint: 'Neel — deep blue',
    swatch: '#6d7cff',
    ink: '#312e81',
    badge: 'linear-gradient(135deg, #818cf8, #c7d2fe)',
    badgeInk: '#0b1033',
    dark: {
      brand: '#6d7cff', strong: '#5a68f0', brandDark: '#4a56d6', brandLight: '#b4bcff',
      rgb: '109, 124, 255', grad: 'linear-gradient(135deg, #7d8bff, #5462e8)',
    },
    light: {
      brand: '#4f5bd5', strong: '#4550c4', brandDark: '#3a44ad', brandLight: '#312e81',
      rgb: '79, 91, 213', grad: 'linear-gradient(135deg, #6366f1, #4f46e5)',
    },
    dashLight: { brand: '#5865e8', brandDark: '#4550c4', brandLight: '#312e81', rgb: '88, 101, 232' },
  },
  {
    id: 'tulsi',
    label: 'Tulsi',
    hint: 'Fresh green',
    swatch: '#2fbf71',
    ink: '#14532d',
    badge: 'linear-gradient(135deg, #34d399, #a7f3d0)',
    badgeInk: '#052e1a',
    dark: {
      brand: '#2fbf71', strong: '#22a862', brandDark: '#199e58', brandLight: '#86efac',
      rgb: '47, 191, 113', grad: 'linear-gradient(135deg, #3ecf7f, #1fa862)',
    },
    light: {
      brand: '#16a34a', strong: '#128a3f', brandDark: '#0f7536', brandLight: '#14532d',
      rgb: '22, 163, 74', grad: 'linear-gradient(135deg, #22c55e, #16a34a)',
    },
    dashLight: { brand: '#17a34a', brandDark: '#12833c', brandLight: '#14532d', rgb: '23, 163, 74' },
  },
  {
    id: 'haldi',
    label: 'Haldi',
    hint: 'Golden yellow',
    swatch: '#f0b429',
    ink: '#713f12',
    badge: 'linear-gradient(135deg, #fbbf24, #fde68a)',
    badgeInk: '#2a1c02',
    dark: {
      brand: '#f0b429', strong: '#e0a316', brandDark: '#c48f10', brandLight: '#fde68a',
      rgb: '240, 180, 41', grad: 'linear-gradient(135deg, #fbc22e, #dc9c0e)',
    },
    light: {
      brand: '#ba7d09', strong: '#a06c07', brandDark: '#855906', brandLight: '#713f12',
      rgb: '186, 125, 9', grad: 'linear-gradient(135deg, #d97706, #b45309)',
    },
    dashLight: { brand: '#d99e0b', brandDark: '#b07d07', brandLight: '#713f12', rgb: '217, 158, 11' },
  },
  {
    id: 'gulab',
    label: 'Gulab',
    hint: 'Rose pink',
    swatch: '#f2568f',
    ink: '#831843',
    badge: 'linear-gradient(135deg, #fb7185, #fbcfe8)',
    badgeInk: '#3f0a20',
    dark: {
      brand: '#f2568f', strong: '#e33f7c', brandDark: '#d13a72', brandLight: '#fbb6ce',
      rgb: '242, 86, 143', grad: 'linear-gradient(135deg, #ff6a9e, #e03a76)',
    },
    light: {
      brand: '#d61f63', strong: '#be1855', brandDark: '#a01447', brandLight: '#831843',
      rgb: '214, 31, 99', grad: 'linear-gradient(135deg, #ec4899, #db2777)',
    },
    dashLight: { brand: '#e11d63', brandDark: '#c01754', brandLight: '#831843', rgb: '225, 29, 99' },
  },
  {
    id: 'neelam',
    label: 'Neelam',
    hint: 'Sapphire cyan (default)',
    swatch: '#22b8d6',
    ink: '#164e63',
    badge: 'linear-gradient(135deg, #22d3ee, #a5f3fc)',
    badgeInk: '#04252e',
    dark: {
      brand: '#22b8d6', strong: '#12a3c0', brandDark: '#0e8fa8', brandLight: '#7dd3e8',
      rgb: '34, 184, 214', grad: 'linear-gradient(135deg, #33c8e4, #0f95b0)',
    },
    light: {
      brand: '#0e7f97', strong: '#0b6d82', brandDark: '#095a6c', brandLight: '#164e63',
      rgb: '14, 127, 151', grad: 'linear-gradient(135deg, #0891b2, #0e7490)',
    },
    dashLight: { brand: '#0891b2', brandDark: '#0b7290', brandLight: '#164e63', rgb: '8, 145, 178' },
  },
  {
    id: 'baingan',
    label: 'Baingan',
    hint: 'Deep violet',
    swatch: '#a86ef0',
    ink: '#4c1d95',
    badge: 'linear-gradient(135deg, #c084fc, #e9d5ff)',
    badgeInk: '#2b0a4d',
    dark: {
      brand: '#a86ef0', strong: '#9757e0', brandDark: '#8a4dd6', brandLight: '#d8b4fe',
      rgb: '168, 110, 240', grad: 'linear-gradient(135deg, #b57ff5, #8f4ed8)',
    },
    light: {
      brand: '#7e22ce', strong: '#6d1cb3', brandDark: '#5b1899', brandLight: '#4c1d95',
      rgb: '126, 34, 206', grad: 'linear-gradient(135deg, #9333ea, #7e22ce)',
    },
    dashLight: { brand: '#9333ea', brandDark: '#7a25c4', brandLight: '#4c1d95', rgb: '147, 51, 234' },
  },
  {
    id: 'chandan',
    label: 'Chandan',
    hint: 'Sandalwood beige',
    swatch: '#c9a37a',
    ink: '#4a3320',
    badge: 'linear-gradient(135deg, #d6b98f, #f0e2cc)',
    badgeInk: '#2e2013',
    dark: {
      brand: '#c9a37a', strong: '#b8905f', brandDark: '#a8825c', brandLight: '#e8d3b8',
      rgb: '201, 163, 122', grad: 'linear-gradient(135deg, #d4b089, #b28857)',
    },
    light: {
      brand: '#8a6440', strong: '#775636', brandDark: '#64482d', brandLight: '#4a3320',
      rgb: '138, 100, 64', grad: 'linear-gradient(135deg, #a1734a, #85603c)',
    },
    dashLight: { brand: '#a1734a', brandDark: '#85603c', brandLight: '#4a3320', rgb: '161, 115, 74' },
  },
  {
    id: 'anaar',
    label: 'Anaar',
    hint: 'Crimson red',
    swatch: '#f0484f',
    ink: '#7f1d1d',
    badge: 'linear-gradient(135deg, #f87171, #fecaca)',
    badgeInk: '#3d0a0a',
    dark: {
      brand: '#f0484f', strong: '#e02f38', brandDark: '#cc2c36', brandLight: '#fca5a5',
      rgb: '240, 72, 79', grad: 'linear-gradient(135deg, #ff5a60, #dc2f38)',
    },
    light: {
      brand: '#c81e26', strong: '#b01a21', brandDark: '#94151b', brandLight: '#7f1d1d',
      rgb: '200, 30, 38', grad: 'linear-gradient(135deg, #dc2626, #b91c1c)',
    },
    dashLight: { brand: '#dc2626', brandDark: '#ba1c1c', brandLight: '#7f1d1d', rgb: '220, 38, 38' },
  },
  {
    id: 'kohl',
    label: 'Kohl',
    hint: 'Monochrome — most formal',
    swatch: '#a8adb8',
    ink: '#1f2937',
    badge: 'linear-gradient(135deg, #cbd5e1, #f1f5f9)',
    badgeInk: '#111827',
    dark: {
      brand: '#a8adb8', strong: '#939aa6', brandDark: '#868b96', brandLight: '#d4d8e0',
      rgb: '168, 173, 184', grad: 'linear-gradient(135deg, #b4b9c4, #8b909c)',
    },
    light: {
      brand: '#4b5563', strong: '#3f4956', brandDark: '#374151', brandLight: '#1f2937',
      rgb: '75, 85, 99', grad: 'linear-gradient(135deg, #52606f, #3f4956)',
    },
    dashLight: { brand: '#52606f', brandDark: '#3f4956', brandLight: '#1f2937', rgb: '82, 96, 111' },
  },
];

// New shops start with Neelam. Existing saved themes remain available and unchanged.
export const DEFAULT_THEME = 'neelam';
export const THEME_IDS = THEMES.map((t) => t.id);

export function getTheme(id) {
  return THEMES.find((t) => t.id === normalizeTheme(id));
}

/** Unknown/absent ids fall back to Neelam rather than rendering an unstyled app. */
export function normalizeTheme(id) {
  return THEME_IDS.includes(id) ? id : DEFAULT_THEME;
}

/**
 * The accent currently on screen, read straight off <html>.
 *
 * For the places that cannot use a CSS variable: a popup window opened with
 * window.open (the printable poster) inherits no stylesheet, and a third-party
 * widget (the Razorpay checkout) wants a plain hex string in its config. Both
 * need a real colour value at call time, not a var() reference.
 *
 * Prefer var(--brand) anywhere that is actually inside our own stylesheet.
 */
export function activeThemeId() {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  return normalizeTheme(document.documentElement.getAttribute('data-accent'));
}

/**
 * The accent's colours for surfaces that are always light — printed paper, a white
 * popup, a third-party modal — regardless of which mode the app is in. Using the
 * light ramp here is the point: the dark-mode tints are pale by design and would
 * come out invisible on white.
 */
export function activeThemeOnWhite() {
  const t = getTheme(activeThemeId());
  return { brand: t.dashLight.brand, ink: t.ink };
}
