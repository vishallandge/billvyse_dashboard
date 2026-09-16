/**
 * Which shell the dashboard is running inside — a browser tab, or the app we ship on Google
 * Play. Nothing else in the app is allowed to work this out for itself.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * Google's Payments policy names our category word for word — "cloud software and services
 * (data storage services, business productivity software, financial management software)" —
 * and says a Play-distributed app must not take payment for its own features through anyone
 * but Google. Razorpay inside the Android build is a breach; so is a link out to a page that
 * sells. What IS allowed, in Google's own words, is a "consumption-only" app: the shopkeeper
 * buys on the website and the app simply reflects the plan they already have.
 *
 * So the native build must never show a price or a buy button. The interesting question is
 * how to guarantee that a year from now, after fifty commits by people who have never read
 * this comment.
 *
 * THE ANSWER IS NOT `if (isNativeApp())` SPRINKLED EVERYWHERE
 *
 * Thirty call sites means thirty chances to forget the thirty-first. This flag is stamped
 * onto every API request instead (see lib/api.js), and the SERVER decides what to send: a
 * native-stamped request gets no prices, no purchase URLs, no upsell campaigns. A screen
 * cannot render a price it was never given, and a new screen inherits that for free without
 * its author knowing any of this exists.
 *
 * The exports below are for the handful of places that must also change their WORDS —
 * "plans are managed on the website" instead of a checkout — not for hiding numbers.
 */

/**
 * True inside the Play build.
 *
 * Two detectors, because the wrapper is changing. Capacitor is where we are going and is the
 * reliable one: `isNativePlatform()` is a fact about the build, not an inference. The TWA
 * branch is the fallback for as long as a Bubblewrap build might still be in someone's
 * hands, and it is a genuinely worse signal — see the storage note below.
 *
 * Deliberately NOT reused from backDismiss.js's `isInstalledApp()`. That one is true for a
 * desktop installed PWA and an iOS home-screen app as well, neither of which came from Play.
 * Using it here would hide prices from paying web customers — a silent loss of sales that
 * nobody would ever report as a bug.
 */
export function isNativeApp() {
  if (typeof window === 'undefined') return false;
  try {
    // Capacitor: present only in the native shell, and it does not lie.
    if (window.Capacitor?.isNativePlatform?.()) return true;

    /**
     * TWA fallback.
     *
     * Chrome hands a TWA its launch referrer, but ONLY on the first navigation — one reload
     * or one client-side route change and it is gone. So it has to be remembered.
     *
     * It is remembered in `sessionStorage`, and that choice is load-bearing. A TWA runs
     * inside Chrome and SHARES Chrome's storage for this origin, so a `localStorage` latch
     * would leak into the browser on the same phone: the shopkeeper installs the app, then
     * opens billvyse.com in Chrome to pay, and finds no prices there either. They could
     * never buy from that phone again, and the failure is invisible — no error, just no
     * revenue. A session is per-launch, so the app gets the flag and the browser tab does
     * not.
     */
    if (window.sessionStorage?.getItem('bv_native') === '1') return true;
    const fromTwa =
      document.referrer.startsWith('android-app://') ||
      new URLSearchParams(window.location.search).get('src') === 'twa';
    if (fromTwa) {
      window.sessionStorage?.setItem('bv_native', '1');
      return true;
    }
  } catch {
    // Private mode, blocked site data, a locked-down webview — any of these throw rather
    // than return empty. Falling through to "not native" is the safe direction: the web
    // build showing prices is correct behaviour, and the native build's real protection is
    // the server, which has already been told by the header on this same request.
    return false;
  }
  return false;
}

/**
 * Marks the document so CSS can act before React does.
 *
 * Called once from the shell. Without it there is a window — small, but real — where the
 * page has painted from cache with a price on it and hydration has not yet run. That flash
 * is visible to a shopkeeper and capturable by a reviewer, and "it was only 200ms" is not an
 * answer to either. With `data-native` on <html>, the stylesheet suppresses anything
 * money-shaped from the very first paint.
 */
export function markNativeApp() {
  if (typeof document === 'undefined') return false;
  const native = isNativeApp();
  if (native) document.documentElement.setAttribute('data-native', '1');
  return native;
}
