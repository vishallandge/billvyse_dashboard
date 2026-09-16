/**
 * Regenerates the ACCENT THEMES block at the end of BOTH apps' globals.css from
 * lib/themes.js.  Run from the repo root:
 *
 *     node dashboard/scripts/genThemeTokens.mjs           # write
 *     node dashboard/scripts/genThemeTokens.mjs --check   # report only, exit 1 on drift
 *
 * It rewrites ONLY the region between the "ACCENT THEMES (generated ...)" marker
 * line and the matching "END ACCENT THEMES (generated)" one, and both must be
 * present. An earlier version replaced everything from the
 * opening marker to end-of-file, which was true when the accent layer WAS the
 * end of the file and stopped being true the day the SCENES layer was appended
 * after it. Running it then deleted 22,000 lines of hand-written CSS. A closing
 * marker is the whole fix: a generator that owns a region must be told where the
 * region stops, not left to assume it runs to the end.
 *
 * ---------------------------------------------------------------------------
 * Why this script lives in the repo and not in a scratchpad
 * ---------------------------------------------------------------------------
 * The first version of it was a throwaway, and the generated CSS then drifted
 * from lib/themes.js with no way to prove it: the storefront's primary-button
 * ink was hardcoded white for every accent, so a shop on Haldi shipped a button
 * whose label measured 1.86:1 against its own fill. Nobody could see that by
 * reading the CSS, because the number was never computed anywhere. Now it is,
 * every time, and --check fails if the file has drifted from the palettes.
 *
 * ---------------------------------------------------------------------------
 * The two DERIVED tokens, and why derived rather than authored
 * ---------------------------------------------------------------------------
 * --brand-text   the accent used as TEXT (links, active tab labels, the small
 *                brand-coloured figures on a card). A fill only has to clear 3:1
 *                as a UI component; a word has to clear 4.5:1, and the app used
 *                --brand for both. On a white card that is 2.37:1 for Haldi and
 *                2.60:1 for Marigold — those words were genuinely hard to read.
 *                Derived by moving the accent's LIGHTNESS in OKLCH only as far
 *                as it takes to clear the target, so the hue survives; an accent
 *                that already passes is emitted unchanged, which is why the
 *                eleven do not collapse onto one contrast value and start
 *                looking alike.
 *
 * --on-brand     the ink ON a brand fill: white where white clears the bar, and a
 *                deep tone of the accent's OWN hue where it does not, so a Haldi
 *                button reads as dark-on-gold rather than as a black slab.
 *                Measured against --brand, and that is only meaningful because
 *                the primary button is now a FLAT --brand fill. It used to be a
 *                two-stop gradient under a 28%-white gloss, i.e. four different
 *                surfaces under one hardcoded label colour, and 17 of the 22
 *                accent/mode combinations failed AA somewhere on it — Haldi in
 *                light mode measured 1.77:1. A flat fill is one surface, so the
 *                token can actually be guaranteed.
 *
 * Targets sit above the 4.5:1 floor on purpose. The floor is where text stops
 * being a failure; it is not where it becomes comfortable to read for the ten
 * hours a shop is open.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES } from '../lib/themes.js';
import { hexToRgb, contrast, ensureContrast, inkOn } from './color.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MARK = '/* ==== ACCENT THEMES (generated from lib/themes.js) ==== */';
const END_MARK = '/* ==== END ACCENT THEMES (generated) ==== */';

/* The surfaces the derived tokens are measured against — the WORST case in each
   mode, so a token that passes here passes on every scene.

   Light: pure white, which is what a card is in four of the five light scenes.
   Dark:  the LIGHTEST dark card in the set (classic's #1c2028). Aurora and
          Mehfil composite darker than that and Noir is darker still, so
          measuring against classic covers all five. */
const CARD_LIGHT = '#ffffff';
const CARD_DARK = '#1c2028';

/* 5.0 for body-sized accent text — half a point of headroom over AA, so a scene
   whose card is a shade off white cannot push a token back under the floor. */
const TEXT_TARGET = 5.0;
/* 4.5 exactly for button ink: a button label is 15-16px semibold sitting on a
   large block of solid colour, and pushing this higher drives every accent's
   primary button toward black, which is what makes an app look cheap. */
const INK_TARGET = 4.5;

/** Bespoke notes worth keeping; every other accent gets "Label — hint". */
const NOTES = {
  billvyse: [
    'BillVyse — the house navy, and the default a shop opens on. The interactive blue is',
    "NOT the logo's #011d46: that colour on a dark page is a button nobody can see. Same",
    'hue, lifted to the ramp all eleven accents share. The mark’s own navy still leads',
    '--brand-ink, which is what prints.',
  ].join('\n   '),
  marigold: [
    'Marigold — Genda — the accent the app shipped with for its first year, kept so a shop',
    'that picked it sees the same orange. Only its derived --brand-text moves, and only',
    'because #ff7a29 as a WORD on a white card measured 2.60:1.',
  ].join('\n   '),
};

function paletteFor(app, theme, mode) {
  if (mode === 'dark') return theme.dark;
  // The dashboard's light page is cool grey and the storefront's is warm cream, so
  // the two apps deepen the accent by different amounts. That difference predates
  // this script; it is preserved, not invented.
  return app === 'dash' ? { ...theme.light, ...theme.dashLight } : theme.light;
}

function accentCss(app, theme, mode) {
  const p = paletteFor(app, theme, mode);
  const card = mode === 'dark' ? CARD_DARK : CARD_LIGHT;
  const lines = [
    `--brand: ${p.brand};`,
    app === 'front' ? `--brand-strong: ${p.strong};` : null,
    `--brand-dark: ${p.brandDark};`,
    `--brand-light: ${p.brandLight};`,
    `--brand-rgb: ${p.rgb};`,
    `--brand-text: ${ensureContrast(p.brand, card, TEXT_TARGET)};`,
    `--on-brand: ${inkOn(p.brand, INK_TARGET)};`,
    `--brand-ink: ${theme.ink};`,
    app === 'front' ? `--brand-grad: ${p.grad || theme.dark.grad};` : null,
    app === 'front' ? `--badge-hot: ${theme.badge};` : null,
    app === 'front' ? `--badge-hot-ink: ${theme.badgeInk};` : null,
  ].filter(Boolean);
  return lines.map((l) => `  ${l}`).join('\n');
}

function header(app) {
  return `${MARK}
/* -----------------------------------------------------------------------------
   Accent themes — ${app === 'dash' ? 'seller dashboard' : 'customer storefront'}

   GENERATED. Do not hand-edit: run

       node dashboard/scripts/genThemeTokens.mjs

   after changing lib/themes.js, which is the single source of truth for all
   ${THEMES.length} palettes. The script owns everything between the marker above and the
   matching END marker below, and nothing outside them.

   Two dimensions live on <html>, and they are deliberately independent:

       data-theme="dark|light"     the MODE  — page, text, borders, contrast
       data-accent="<theme id>"    the THEME — brand hue only

   An accent block NEVER touches --bg, --text, --surface or --border. That is
   the whole safety property: adding an accent cannot break light mode, and
   every existing [data-theme='light'] rule above keeps working as-is.

   Specificity note, load-bearing:
     :root[data-accent='x']                    (0,2,0)
     :root[data-theme='light']                 (0,2,0)  — declared earlier
     :root[data-theme='light'][data-accent='x'](0,3,0)  — always wins
   The plain accent block sits after the light block, so it would otherwise
   leak dark-mode brand values into light mode. The combined block is what
   pulls them back. Every accent defines BOTH blocks — never just one.

   THREE brand tokens, three different jobs. Reaching for the wrong one is the
   bug this layer was rebuilt to make impossible:

     --brand        a FILL. Buttons, bars, the active pill, a progress track.
                    Needs 3:1 as a UI component, which every accent clears.
                    Never set it as \`color\` on a word.
     --brand-text   the accent as TEXT or as a small icon. Derived, >= ${TEXT_TARGET.toFixed(1)}:1
                    against a card in its own mode, hue preserved.
     --on-brand     the ink that goes ON a --brand fill. >= ${INK_TARGET.toFixed(1)}:1 against it.
                    Only well-defined because .btn-primary is a flat --brand fill
                    in both apps now; a gradient under a gloss has no single
                    surface for an ink token to be measured against.

   If data-accent is missing or unrecognised, no block matches and the app falls
   back to the BillVyse values declared at the top of this file.
   ----------------------------------------------------------------------------- */
`;
}

function build(app) {
  const out = [header(app)];
  for (const t of THEMES) {
    out.push(`\n/* ${NOTES[t.id] || `${t.label} — ${t.hint}`} */`);
    out.push(`:root[data-accent='${t.id}'] {\n${accentCss(app, t, 'dark')}\n}`);
    out.push(`:root[data-theme='light'][data-accent='${t.id}'] {\n${accentCss(app, t, 'light')}\n}`);
  }
  return `${out.join('\n')}\n`;
}

const TARGETS = [
  { app: 'dash', file: 'dashboard/app/globals.css' },
  { app: 'front', file: 'frontend/app/globals.css' },
];

const check = process.argv.includes('--check');
let drift = 0;

for (const { app, file } of TARGETS) {
  const full = path.join(ROOT, file);
  const css = fs.readFileSync(full, 'utf8');
  const at = css.indexOf(MARK);
  const end = css.indexOf(END_MARK);
  if (at < 0 || end < 0 || end < at) {
    throw new Error(`ACCENT THEMES markers missing or out of order in ${file}`);
  }
  /* Emit whatever the file already uses. These two stylesheets are CRLF on this
     checkout; writing an LF-only region into them left the block permanently
     "drifted" against --check and turned every regeneration into a 500-line
     diff of invisible characters. */
  const eol = css.includes('\r\n') ? '\r\n' : '\n';
  const body = build(app).replace(/\r?\n/g, eol);
  const next = css.slice(0, at) + body + css.slice(end);
  if (next === css) {
    console.log(`ok     ${file}`);
    continue;
  }
  drift += 1;
  if (check) console.log(`DRIFT  ${file}`);
  else {
    fs.writeFileSync(full, next);
    console.log(`wrote  ${file}`);
  }
}

/* The report is half the reason to run this by hand: it is the only place the
   derived numbers show up AS numbers rather than as hexes nobody can measure. */
console.log('\naccent      mode    --brand-text        --on-brand');
for (const t of THEMES) {
  for (const mode of ['dark', 'light']) {
    const p = paletteFor('dash', t, mode);
    const card = mode === 'dark' ? CARD_DARK : CARD_LIGHT;
    const bt = ensureContrast(p.brand, card, TEXT_TARGET);
    const ink = inkOn(p.brand, INK_TARGET);
    const was = contrast(hexToRgb(p.brand), hexToRgb(card)).toFixed(2);
    console.log(
      `${t.id.padEnd(11)} ${mode.padEnd(6)}  ${bt} ${contrast(hexToRgb(bt), hexToRgb(card)).toFixed(2).padStart(5)}:1` +
      ` (was ${was.padStart(5)})   ${ink} ${contrast(hexToRgb(ink), hexToRgb(p.brand)).toFixed(2).padStart(5)}:1`,
    );
  }
}

if (check && drift) process.exit(1);
