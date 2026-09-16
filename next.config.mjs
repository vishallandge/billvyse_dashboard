import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';
/**
 * Two builds out of one codebase: the website, and the app that goes on Google Play.
 *
 * The website is unchanged by this file. `npm run build` still produces exactly what it
 * produced before — a Next server, with middleware, with the `[id]` routes rendered on
 * demand — because everything below is behind `BUILD_TARGET=mobile` and nothing else.
 * That is the point: the web deployment is live and earning, and a mobile wrapper is not a
 * good enough reason to touch how it is served.
 *
 * `npm run build:mobile` produces a folder of static files for Capacitor to carry inside the
 * Android app instead.
 *
 * WHY STATIC RATHER THAN POINTING CAPACITOR AT THE LIVE SITE
 *
 * Capacitor will happily load a remote URL, which needs no build changes at all. It also
 * means the app can do nothing without a connection — and this app's offline billing exists
 * precisely because a kirana counter's network drops in the middle of a sale. Trading that
 * away to save a config file would be selling the wrong thing.
 */
const mobile = process.env.BUILD_TARGET === 'mobile';

/** @type {import('next').NextConfig} */
const config = {
  ...(process.env.NEXT_BUILD_DIR ? { distDir: process.env.NEXT_BUILD_DIR } : {}),
  /**
   * Declared for BOTH builds, and that is the whole point of it being here.
   *
   * `buildMobile.mjs` exports this in the environment, so the mobile build would work
   * without this line. The web build would not: with the variable simply absent, Next
   * compiles `process.env.NEXT_PUBLIC_BUILD_TARGET === 'mobile'` into a RUNTIME read of an
   * env object — verified in the output, it came out as
   * `"mobile"===n(40257).env.NEXT_PUBLIC_BUILD_TARGET`. That evaluates to false and behaves
   * correctly, but the guarded code is still shipped to every browser.
   *
   * That matters for one guard in particular. lib/session.js keeps the Play build's Bearer
   * token in localStorage, which the comment at the top of that file explains the website
   * must never do — one XSS would be a seven-day login for the whole shop. "The branch is
   * false at runtime" and "the branch is not in the file" are different promises, and the
   * second is the one worth having.
   *
   * Naming the value explicitly lets Next substitute a literal, so `'web' === 'mobile'`
   * folds at build time and the minifier drops what it guards.
   */
  env: { NEXT_PUBLIC_BUILD_TARGET: mobile ? 'mobile' : 'web' },
  ...(mobile
    ? {
        // A folder of HTML/JS Capacitor can copy into the app. It lands in `out/`.
        output: 'export',
        /**
         * No custom `distDir`. A separate one was tried first, to keep the web build's
         * `.next` untouched, and Next 14's export could not resolve its own chunks out of
         * it — the build failed on a missing `./1682.js`, which is a message that leads
         * nowhere. Both builds share `.next` as scratch space instead; the outputs never
         * collide, because an export writes to `out/` and the server build does not.
         */
        /**
         * The optimiser is a server that resizes images on request, and there is no server
         * inside a phone app. Without this the export refuses to run. Nothing is lost here:
         * the dashboard does not use next/image anywhere — this is a guard for the day
         * somebody adds one and gets a build error they cannot place.
         */
        images: { unoptimized: true },
        /**
         * Every route becomes `route/index.html`, so a WebView asking for `/seller` finds a
         * file. Without it the export emits `seller.html`, which nothing requests.
         */
        trailingSlash: true,
      }
    : {}),
};

// Keep builds from replacing a running dev server's CSS and chunks.
export default (phase) => ({
  ...config,
  distDir: process.env.NEXT_BUILD_DIR || (phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next'),
});
