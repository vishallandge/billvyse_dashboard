/**
 * Measures every readable pair in the theme system and fails if one is under the
 * bar. Run from the repo root:
 *
 *     node dashboard/scripts/auditContrast.mjs                 # both apps
 *     node dashboard/scripts/auditContrast.mjs frontend/app/globals.css
 *
 * ---------------------------------------------------------------------------
 * Why a harness and not a review
 * ---------------------------------------------------------------------------
 * The theme system is three independent axes — 2 modes x 5 scenes x 11 accents —
 * which is 110 reachable states per app. Nobody opens 110 screens, so for a long
 * time nobody saw that the seller's primary button failed AA in 17 of its 22
 * accent/mode pairs, or that the customer's "Order karo" label sat at 1.86:1 on
 * a Haldi shop, or that --text-faint (which carries unit prices and timestamps)
 * was under 4.5:1 in the storefront in BOTH modes. Every one of those was a
 * number that had simply never been computed.
 *
 * This resolves the cascade the way a browser does — for each state, collect the
 * :root blocks whose attribute selectors match, order them by specificity then
 * source order, and read the winning token values — then measures:
 *
 *   body / muted / faint     against the page AND against a card
 *   nav ink                  against the SIDEBAR, per scene per mode
 *   success / danger / warning against a card
 *   --brand-text             against a card          (>= 4.5, text)
 *   --on-brand               against --brand         (>= 4.5, button label)
 *   the button's boundary    against a card          (>= 3.0, WCAG 1.4.11 —
 *                            satisfied by EITHER the fill or its 1px border)
 *
 * Translucent values are composited onto what sits behind them first, because a
 * card at 78% over an aurora field is not the colour its hex says it is.
 *
 * The dark-mode upper bound is deliberate and is not a WCAG rule: past roughly
 * 16.5:1 on a dark ground, light text blooms into the background (halation), so
 * a dark body ramp that is TOO high fails here the same way a light one that is
 * too low does. See the READING COMFORT block in dashboard/app/globals.css.
 */

import fs from 'node:fs';
import { parseColor, resolveColor } from './cssColor.mjs';

const TARGETS = ['dashboard/app/globals.css', 'frontend/app/globals.css'];
const SCENES = ['classic', 'aurora', 'noir', 'kagaz', 'mehfil', 'prism'];
const ACCENTS = [
  'billvyse', 'marigold', 'indigo', 'tulsi', 'haldi', 'gulab',
  'neelam', 'baingan', 'chandan', 'anaar', 'kohl',
];

const MIN_BODY = 4.5;
const MIN_TEXT = 4.5;
const MIN_BOUNDARY = 3.0;
/* Halation ceiling for dark mode only. */
const MAX_DARK_BODY = 16.5;



const over = (f, b) => f.slice(0, 3).map((v, i) => v * f[3] + b[i] * (1 - f[3])).concat(1);
const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
function ratio(a, b) {
  if (!a || !b) return null;
  const l1 = lum(a), l2 = lum(b);
  return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
}

/* The sidebar is styled by descendant rules (`... .sidebar`), not by :root, so the
   token walk above cannot see it. It is collected separately — and it has to be,
   because this is the exact class of bug that shipped: four scenes swapped the rail
   to a dark slab in LIGHT mode and left the nav ink on the page's dark foreground,
   so the whole navigation went unreadable and nothing here noticed. */
function sidebarBlocks(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  // Split on '}' and keep any rule whose FIRST selector targets .sidebar. A single
  // regex over the whole sheet proved brittle here; this is dull and it works.
  for (const chunk of stripped.split('}')) {
    const at = chunk.indexOf('{');
    if (at < 0) continue;
    const sel = chunk.slice(0, at).split(',')[0].trim().replace(/\s+/g, ' ');
    if (!/(^|\s)\.sidebar$/.test(sel)) continue;
    const decls = {};
    for (const d of chunk.slice(at + 1).split(';')) {
      const k0 = d.indexOf(':');
      if (k0 < 0) continue;
      const k = d.slice(0, k0).trim();
      if (k.startsWith('--nav-')) decls[k] = d.slice(k0 + 1).trim();
    }
    if (Object.keys(decls).length) out.push({ sel: chunk.slice(0, at).trim(), decls, spec: (sel.match(/\[data-/g) || []).length });
  }
  return out;
}

function rootBlocks(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /(^|\n)\s*(:root[^{;]*?)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(stripped))) {
    const sel = m[2].trim();
    // Only bare :root blocks with attribute/:not() qualifiers — a descendant
    // selector styles an element, not the token set this walk is resolving.
    if (!/^:root(\[[^\]]+\]|:not\([^)]*\))*$/.test(sel)) continue;
    const decls = {};
    for (const d of m[3].split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      const k = d.slice(0, i).trim();
      if (k.startsWith('--')) decls[k] = d.slice(i + 1).trim();
    }
    if (Object.keys(decls).length) {
      out.push({ sel, decls, spec: (sel.match(/\[data-/g) || []).length, at: m.index });
    }
  }
  return out;
}

function matches(sel, state) {
  for (const x of sel.matchAll(/:not\(\[data-(\w+)='([^']+)'\]\)/g)) if (state[x[1]] === x[2]) return false;
  const bare = sel.replace(/:not\([^)]*\)/g, '');
  for (const x of bare.matchAll(/\[data-(\w+)='([^']+)'\]/g)) if (state[x[1]] !== x[2]) return false;
  for (const x of bare.matchAll(/\[data-(\w+)\](?!=)/g)) if (!state[x[1]]) return false;
  return true;
}

/* Specificity first, then source order — the same order the browser applies. An
   earlier version of this walk used source order alone and reported a dark page
   in light mode, because the reading-comfort :root block sits later in the file
   than :root[data-theme='light'] but loses to it. */
const resolve = (blocks, state) => blocks
  .filter((b) => matches(b.sel, state))
  .sort((a, b) => a.spec - b.spec || a.at - b.at)
  .reduce((acc, b) => Object.assign(acc, b.decls), {});

const pick = (tok, vars, bg) => {
  const c = parseColor(vars[tok]);
  if (!c) return null;
  return c[3] < 1 && bg ? over(c, bg) : c;
};

function auditFile(file) {
  const css = fs.readFileSync(file, 'utf8');
  const blocks = rootBlocks(css);
  const sbBlocks = sidebarBlocks(css).sort((a, b) => a.spec - b.spec);
  const problems = [];
  const surfaces = [];

  for (const mode of ['dark', 'light']) {
    for (const scene of SCENES) {
      const v = resolve(blocks, { theme: mode, scene, accent: 'billvyse' });
      const page = pick('--bg', v);
      // The dashboard calls its card --surface-card, the storefront --card-bg.
      const card = pick('--surface-card', v, page) || pick('--card-bg', v, page) || page;
      const row = { mode, scene };
      for (const [name, tok, floor] of [
        ['body', '--text', MIN_BODY],
        ['muted', '--text-muted', MIN_BODY],
        ['faint', '--text-faint', MIN_BODY],
      ]) {
        const onPage = ratio(pick(tok, v, page), page);
        const onCard = ratio(pick(tok, v, card), card);
        row[`${name}/page`] = onPage;
        row[`${name}/card`] = onCard;
        for (const [where, val] of [['page', onPage], ['card', onCard]]) {
          if (val !== null && val < floor) problems.push(`${mode}/${scene}: ${tok} on ${where} = ${val} (< ${floor})`);
        }
        if (name === 'body' && mode === 'dark' && onPage !== null && onPage > MAX_DARK_BODY) {
          problems.push(`${mode}/${scene}: --text on page = ${onPage} (> ${MAX_DARK_BODY}, halation)`);
        }
      }
      /* --- the rail, and the ink on it --- */
      const navVars = { ...v };
      for (const b of sbBlocks) if (matches(b.sel.split(',')[0].trim(), { theme: mode, scene, accent: 'billvyse' })) Object.assign(navVars, b.decls);
      /* The scene's own --nav-bg if it set one, resolved for real. */
      const rail = resolveColor(navVars['--nav-bg'], { ...v, ...navVars }) || page;
      row['nav/rail'] = null;
      for (const [name, tok] of [['navText', '--nav-text'], ['navMuted', '--nav-text-muted'], ['navFaint', '--nav-text-faint']]) {
        // --nav-* usually points at a page token; resolve one hop.
        let raw = navVars[tok];
        if (raw && raw.startsWith('var(')) raw = v[raw.slice(4, -1).trim()];
        const ink = parseColor(raw);
        const val = ink ? ratio(ink[3] < 1 ? over(ink, rail) : ink, rail) : null;
        if (name === 'navMuted') row['nav/rail'] = val;
        if (val !== null && val < MIN_BODY) problems.push(`${mode}/${scene}: ${tok} on the sidebar = ${val} (< ${MIN_BODY})`);
      }
      surfaces.push(row);
    }
  }

  let combos = 0;
  const stats = { boundary: [], brandText: [], onBrand: [] };
  for (const mode of ['dark', 'light']) {
    for (const scene of SCENES) {
      for (const accent of ACCENTS) {
        const v = resolve(blocks, { theme: mode, scene, accent });
        const page = pick('--bg', v);
        const card = pick('--surface-card', v, page) || pick('--card-bg', v, page) || page;
        const brand = pick('--brand', v, card);
        const bt = ratio(pick('--brand-text', v, card), card);
        const ob = ratio(pick('--on-brand', v, brand), brand);
        // WCAG 1.4.11 wants 3:1 on a control's boundary. .btn-primary has two —
        // its fill and its 1px --brand-dark border — and either one satisfies it.
        const bd = Math.max(ratio(pick('--brand-dark', v, card), card) ?? 0, ratio(brand, card) ?? 0);
        combos += 1;
        if (bt !== null) { stats.brandText.push(bt); if (bt < MIN_TEXT) problems.push(`${mode}/${scene}/${accent}: --brand-text = ${bt}`); }
        if (ob !== null) { stats.onBrand.push(ob); if (ob < MIN_TEXT) problems.push(`${mode}/${scene}/${accent}: --on-brand = ${ob}`); }
        if (bd) { stats.boundary.push(bd); if (bd < MIN_BOUNDARY) problems.push(`${mode}/${scene}/${accent}: button boundary = ${bd}`); }
      }
    }
  }

  console.log(`\n=== ${file} ===`);
  console.table(surfaces);
  const span = (a) => (a.length ? `${Math.min(...a)} – ${Math.max(...a)}` : 'n/a');
  console.log(`${combos} accent combinations`);
  console.log(`  --brand-text  ${span(stats.brandText)}   (floor ${MIN_TEXT})`);
  console.log(`  --on-brand    ${span(stats.onBrand)}   (floor ${MIN_TEXT})`);
  console.log(`  btn boundary  ${span(stats.boundary)}   (floor ${MIN_BOUNDARY})`);

  if (problems.length) {
    console.log(`\n  ${problems.length} PROBLEM(S):`);
    for (const p of problems) console.log('   -', p);
  } else {
    console.log('\n  no contrast problems');
  }
  return problems.length;
}

const files = process.argv.slice(2).filter((a) => !a.startsWith('-'));
let failed = 0;
for (const f of files.length ? files : TARGETS) failed += auditFile(f);
if (failed) process.exit(1);
