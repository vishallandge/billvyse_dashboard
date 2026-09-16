#!/usr/bin/env node
/**
 * Did the webfonts actually download?
 *
 * `next/font` fetches from Google at BUILD time and self-hosts the result. When that fetch
 * fails — no network, a proxy, a blocked host — it does not fail the build. It emits a
 * metric-adjusted *fallback* face instead and carries on, so the app renders in the
 * system font and looks, on the most common shop machine, like a Windows utility. Nothing
 * anywhere says so.
 *
 * That is not hypothetical. On 2026-08-21 this app had been shipping with Inter and Noto
 * Sans Devanagari as fallback-only for an unknown length of time: two @font-face blocks
 * each, both named `__Inter_Fallback_*`, and zero real font files on disk. The whole
 * dashboard was Segoe UI. It surfaced only because someone said the design "doesn't look
 * designed" and the build output got read by hand.
 *
 * Worse, it is sticky: next caches the resolved font, so once a build has failed over to
 * the fallback it keeps using it until the cache is cleared, even after the network is
 * back. The fix is `rm -rf .next` and rebuild WITH network.
 *
 * This script reads the built CSS and asserts every family has a real face. Run it after
 * a build (`npm run check:fonts`); it exits non-zero when a font silently fell back.
 */

const fs = require('fs');
const path = require('path');

// The families layout.js asks next/font for. Keep in step with that file.
const EXPECTED = ['Inter', 'Noto_Sans_Devanagari', 'Sora'];

const cssDir = path.join(__dirname, '..', '.next', 'static', 'css');

function findCss(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findCss(full);
    return entry.name.endsWith('.css') ? [full] : [];
  });
}

const files = findCss(cssDir);
if (files.length === 0) {
  console.error('check:fonts — no built CSS found. Run `npm run build` (or start dev) first.');
  process.exit(2);
}

const css = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

let failed = false;
for (const family of EXPECTED) {
  // A real face is `__Inter_<hash>`. A fallback is `__Inter_Fallback_<hash>` — same prefix,
  // so the check has to exclude "Fallback" explicitly or every fallback counts as a pass.
  const real = new RegExp(`font-family:\\s*'__${family}_(?!Fallback)[0-9a-f]+'`, 'g');
  const count = (css.match(real) || []).length;
  if (count > 0) {
    console.log(`  ok    ${family} — ${count} face(s) self-hosted`);
  } else {
    failed = true;
    console.error(`  FAIL  ${family} — no real face; the app is rendering this in the system font`);
  }
}

if (failed) {
  console.error(
    '\nA font fell back silently. Delete the build cache and rebuild with network access:\n' +
      '    rm -rf .next && npm run build\n' +
      'next/font caches the failure, so rebuilding without clearing .next changes nothing.'
  );
  process.exit(1);
}

console.log('\ncheck:fonts — every family is self-hosted.');
