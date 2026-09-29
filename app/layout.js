import { Inter, Noto_Sans_Devanagari, Sora } from 'next/font/google';
import './globals.css';
import StartupStyles from './components/StartupStyles';
import PwaRegister from './components/PwaRegister';
import PrinterBoot from './components/PrinterBoot';
import AutofillGuard from './components/AutofillGuard';

/**
 * The typeface.
 *
 * Until now the stack was `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, …`,
 * which on the machine a shop actually runs — a Windows laptop — resolves to Segoe UI.
 * Inter was listed, but fourth and with no @font-face behind it, so it only ever
 * applied on the handful of machines that happened to have it installed locally. The
 * practical effect was that the app looked like a different product on every OS, and
 * on the most common one it looked like a Windows utility.
 *
 * Inter is the right answer for this specific job rather than a fashionable one: it
 * was drawn for user interfaces at small sizes, its digits are unambiguous, and it has
 * proper tabular figures — which is the whole ballgame in an app where columns of rupee
 * amounts are compared down a page.
 *
 * `next/font` downloads at BUILD time and self-hosts the result. No runtime request to
 * Google, nothing to block first paint, no layout shift, and no third-party call from a
 * shopkeeper's browser. (It does mean the first build on a machine needs network to
 * fetch the files; after that they are cached.)
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-latin',
  // Inter's disambiguation set: a tailed lowercase l, so "1", "l" and "I" stop looking
  // alike. In an app full of quantities, batch codes and UPI references that is not a
  // stylistic preference — it is the difference between 1 kg and l kg.
  axes: [],
});

/**
 * Inter has NO Devanagari coverage, and this dashboard ships in ten languages —
 * two of which (Hindi, Marathi) are Devanagari and are the default for most of the
 * shops using it. Without this, Hindi fell through to whatever the OS had (Nirmala UI
 * on Windows), which is a different weight and colour on the page: the Hindi UI read
 * as a worse-made version of the same app.
 *
 * Font-family fallback resolves per GLYPH, not per element, so listing both in one
 * stack gives Latin from Inter and Devanagari from Noto automatically — including on
 * a line that mixes them, which every screen here does ("आज की बिक्री ₹8,240").
 *
 * The other seven scripts (Bengali, Tamil, Telugu, Urdu…) still fall to the system
 * font. Shipping seven more webfonts to every shop to serve a minority of them is the
 * wrong trade; those scripts have good system coverage on both Windows and Android.
 */
const devanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari'],
  display: 'swap',
  variable: '--font-devanagari',
  weight: ['400', '500', '600', '700'],
});
/**
 * The brand face — the name BillVyse and its tagline, and nothing else.
 *
 * The wordmark used to be set in Inter, which is also the face of every button, table
 * cell and label in the app. A name set in the same type as the furniture around it does
 * not read as a name; it reads as another label. Sora is drawn for technology brands —
 * flat-sided curves, squared terminals — so the word reads as software rather than as a
 * shop sign, and it is different enough from Inter that the eye registers it as the one
 * proper noun on the screen.
 *
 * Scope is deliberately tiny: `--font-brand` is referenced by the wordmark rules and by
 * nothing else. Body copy, numbers and every control stay on Inter, which is the face
 * built for interfaces at small sizes and the one carrying the tabular figures that make
 * columns of rupees line up.
 *
 * Two weights only. A display face that ships eight weights nobody uses is bytes on a
 * shopkeeper's connection for no gain.
 */
const brand = Sora({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-brand',
  weight: ['600', '700'],
});

import { LanguageProvider } from './components/LanguageProvider';
import { ThemeProvider } from './components/ThemeProvider';
import { MotionProvider } from './components/MotionProvider';
import { DensityProvider } from './components/DensityProvider';
import { TextSizeProvider } from './components/TextSizeProvider';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/ConfirmDialog';
// The anti-flash script below needs the accent ids and the default. Imported rather than
// re-typed: this file used to carry its own hand-written copy of the ten ids, which made
// it the SIXTH place that list lived, and it was the one nobody remembered to update.
import { THEME_IDS, DEFAULT_THEME } from '../lib/themes';
// Same import-don't-retype rule for the scene ids — see the note beside the accent
// list in the script below, which went stale exactly once by being hand-written.
import { SCENE_IDS, DEFAULT_SCENE } from '../lib/scenes';

export const metadata = {
  title: 'BillVyse – Dashboard',
  description: 'Platform admin and business dashboard for BillVyse.',
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: '/apple-touch-icon.png',
  },
};

export const viewport = {
  // Declaring both explicitly stops some browsers' "auto dark mode for web content"
  // heuristic from repainting the page itself dark on top of our own light theme —
  // that heuristic specifically kicks in when a page doesn't declare color-scheme
  // support, second-guessing the colors it renders.
  colorScheme: 'dark light',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef0f4' },
    // Tracks --bg in globals.css. Lifted off pure black with the reading-comfort
    // pass; if that token moves again, this moves with it or the phone's status
    // bar sits a visibly different shade to the page under it.
    { media: '(prefers-color-scheme: dark)', color: '#101014' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

// The script inside stamps data-theme/accent/motion/density onto <html> before React
// hydrates — deliberately, so the page never paints in the wrong theme or density. React
// then compares its own attribute-free <html> against the DOM and warns about "extra
// attributes from the server". suppressHydrationWarning is exactly the escape hatch for
// that case; it covers this element's own attributes only, one level deep, so a genuine
// hydration mismatch anywhere inside the app still shouts.
export default function RootLayout({ children }) {
  return (
    <html lang="en" data-accent={DEFAULT_THEME} className={`${inter.variable} ${devanagari.variable} ${brand.variable}`} suppressHydrationWarning>
      <head><StartupStyles /></head>
      <body>
        <script
          // Set both theme attributes before hydration so there's no flash of the wrong
          // theme. The accent is validated against a literal id list rather than written
          // through: it goes straight into an attribute selector, and localStorage is
          // writable by anything else served from this origin.
          dangerouslySetInnerHTML={{
            __html:
              "try{var d=document.documentElement;" +
              // 'auto' resolves against the device here too, not just in the provider —
              // otherwise a phone set to light mode paints the whole app dark for the
              // first frame and then flips, which is the exact flash this script exists
              // to prevent. Anything else (including nothing stored) stays dark.
              "var t=localStorage.getItem('dukaan_theme');" +
              "if(t==='auto')t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';" +
              "if(t==='light')d.setAttribute('data-theme','light');" +
              "var a=localStorage.getItem('dukaan_accent');" +
              // Both the valid list and the fallback come from lib/themes.js. When they
              // were typed out here by hand they went stale the moment an accent was
              // added: 'billvyse' was missing from the list and the fallback still said
              // 'marigold', so a shop on the house navy got a frame of the OLD ORANGE
              // brand on every single page load before the provider corrected it.
              "var ok=" + JSON.stringify(THEME_IDS) + ";" +
              "d.setAttribute('data-accent',ok.indexOf(a)>-1?a:" + JSON.stringify(DEFAULT_THEME) + ");" +
              // The scene decides the page background, the card surface and the corner
              // radii — i.e. most of the first paint. Setting it after hydration would
              // show a frame of one material and then repaint the entire app in another,
              // which is a far louder flash than the accent's ever was.
              "var sc=localStorage.getItem('dukaan_scene');" +
              "var oks=" + JSON.stringify(SCENE_IDS) + ";" +
              "d.setAttribute('data-scene',oks.indexOf(sc)>-1?sc:" + JSON.stringify(DEFAULT_SCENE) + ");" +
              // Set before paint too, otherwise a shopkeeper who turned motion off still
              // sees the first frame of every entrance animation on each page load.
              "var m=localStorage.getItem('dukaan_motion');" +
              "d.setAttribute('data-motion',['full','reduced','off'].indexOf(m)>-1?m:'full');" +
              // Display density, same reason: the whole page's spacing hangs off this, so
              // setting it after hydration would lay the dashboard out at one size and then
              // visibly reflow it. Only the two explicit choices are written — 'auto' is the
              // attribute being ABSENT, which is what the stylesheet's :not([data-density])
              // bands match on, so writing it would turn automatic off.
              "var dn=localStorage.getItem('dukaan_density');" +
              "if(dn==='compact'||dn==='comfortable'||dn==='small')d.setAttribute('data-density',dn);" +
              // Text size is a root font-size, so every rem in the app hangs off it —
              // applying it after hydration would lay the whole dashboard out at one
              // size and then visibly re-flow it. 'normal' is the attribute being
              // absent, same convention as density's 'auto'.
              "var ts=localStorage.getItem('dukaan_textsize');" +
              "if(ts==='large'||ts==='xlarge')d.setAttribute('data-textsize',ts);" +
              // The sidebar rail, for the same no-flash reason: the sidebar is 232px
              // of the first paint, and collapsing it a tick later shoves the entire
              // page sideways in front of the shopkeeper.
              "if(localStorage.getItem('dukaan_sidebar_rail')==='1')d.setAttribute('data-rail','1');" +
              /**
               * The Google Play build, stamped before the first paint.
               *
               * The server is what actually keeps prices out of the Play app — it never
               * sends them (backend/middleware/nativeClient.js) — so this attribute is not
               * the protection. It closes the one gap the server cannot: a page restored
               * from the service worker's cache still holds the last WEB response, prices
               * and all, and paints it while the fresh request is in flight. A price on
               * screen for 300ms is a price a shopkeeper reads and a reviewer records, and
               * "it corrected itself" is not an answer to either. `[data-native]` in
               * globals.css suppresses anything money-shaped from frame one.
               *
               * The detection mirrors lib/platform.js and must keep mirroring it. It cannot
               * import from there — this runs as a string, before any bundle — so the two
               * are checked against each other by scripts/verifyNative.mjs.
               *
               * sessionStorage, not localStorage, is load-bearing: a TWA shares Chrome's
               * storage for this origin, so a persistent latch would follow the shopkeeper
               * into the browser on the same phone and hide prices from them there too —
               * silently costing the sale. Capacitor has its own storage and does not have
               * this problem, but the same code covers both.
               */
              "var nat=window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform();" +
              "if(!nat){try{" +
              "if(sessionStorage.getItem('bv_native')==='1')nat=true;" +
              "else if(document.referrer.indexOf('android-app://')===0||location.search.indexOf('src=twa')>-1){" +
              "sessionStorage.setItem('bv_native','1');nat=true;}" +
              "}catch(e2){}}" +
              "if(nat)d.setAttribute('data-native','1');}catch(e){}",
          }}
        />
        <PwaRegister />
        <PrinterBoot />
        {/* Keeps the browser's own saved-value dropdown from opening over our forms.
            Mounted at the top of <body> rather than inside a page, because every dialog
            in the app portals to <body> and it has to see those too. */}
        <AutofillGuard />
        <ThemeProvider>
          <MotionProvider>
            <DensityProvider>
              <TextSizeProvider>
                <LanguageProvider>
                  {/* Inside ToastProvider so a dialog that ends in a toast has one to
                      reach, and inside LanguageProvider because its default button labels
                      are translated. */}
                  <ToastProvider>
                    <ConfirmProvider>{children}</ConfirmProvider>
                  </ToastProvider>
                </LanguageProvider>
              </TextSizeProvider>
            </DensityProvider>
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
