import { resetShopIdentityReminder } from './shopIdentityReminder.js';

// Client-side session state.
//
// There is deliberately no token here any more, and no user object either.
//
// Both used to live in localStorage, which any script running on the page can read: one
// XSS anywhere in the dashboard — a rendered product name, a pasted customer note, a
// third-party tag — was a 7-day login for the whole shop, silently exfiltratable. The
// session is now an httpOnly cookie the server sets and the browser attaches by itself;
// JavaScript here cannot read it, which is exactly the point, and the API no longer
// returns a token in any response body so there is nothing left to accidentally store.
//
// Worse than the storage was what `saveSession` used to do next: it wrote its own `token`
// cookie with document.cookie. A cookie written by script is by definition not httpOnly,
// so that line quietly replaced the server's protected cookie with an unprotected one of
// the same name — the protection was present in the code and absent in the browser.
//
// What is left below is preference state: which store the user is looking at. It is not a
// credential, it grants nothing, and the server re-checks ownership of that store on every
// request (see attachStoreScope) — a tampered value gets a 403, not someone else's data.

/**
 * Is this the exported bundle that ships inside the Android app, rather than the website?
 *
 * Read straight from the inlined build flag rather than imported from lib/routeId.js, which
 * exports the same question. That module is `'use client'` and pulls in React navigation
 * hooks; making session storage depend on the routing layer to answer a build question would
 * be a coupling with no upside. It is one expression, and it is a compile-time constant, not
 * a list that can drift.
 *
 * Next inlines `NEXT_PUBLIC_*` at build time, so in the website's bundle this is the literal
 * `false` — every branch guarded by it is deleted by the minifier rather than merely skipped.
 * See the note above saveNativeToken for why that matters.
 */
const IS_STATIC_BUNDLE = process.env.NEXT_PUBLIC_BUILD_TARGET === 'mobile';

const STORE_KEY = 'dukaan_active_store';

// Read by lib/api.js on every request, so a plain cookie rather than localStorage: it
// keeps the last piece of per-session state in the same place as the rest of it, and
// nothing in this file needs storage the server cannot see.
function readCookie(name) {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getActiveStoreId() {
  return readCookie(STORE_KEY);
}

export function setActiveStoreId(storeId) {
  if (typeof document === 'undefined') return;
  if (!storeId) {
    document.cookie = `${STORE_KEY}=; path=/; max-age=0; SameSite=Lax`;
    return;
  }
  document.cookie = `${STORE_KEY}=${encodeURIComponent(storeId)}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`;
}

/**
 * The CSRF token, which is the one cookie the server sets WITHOUT httpOnly.
 *
 * That is intentional, not an oversight: the double-submit check works because this page
 * can read the value and echo it in a header, while a page on another origin can do
 * neither. It carries no authority on its own.
 */
export function getCsrfToken() {
  return readCookie('csrfToken');
}

/**
 * Signed in? The honest answer is "ask the server" — the session cookie is unreadable
 * here by design, so the only way to know is a request that either succeeds or 401s.
 *
 * This exists for the cheap negative case only: the CSRF cookie is set alongside the
 * session, so its absence saves a pointless round trip on the login page. Its presence is a
 * hint, never a guarantee — the session can have expired underneath it, and the cookie is
 * now shared with the storefront and the supplier portal on the same host, so it can also
 * belong to one of those rather than to this dashboard. (It is deliberately no longer
 * cleared while any of those sessions is alive: doing so used to leave the survivor unable
 * to save anything. See backend/utils/authCookies.js.)
 */
export function looksSignedIn() {
  return Boolean(getCsrfToken());
}

/**
 * ---------------------------------------------------------------------------
 * The one exception to everything said at the top of this file
 * ---------------------------------------------------------------------------
 * Everything above is right, and none of it is being undone: on the WEBSITE there is still
 * no token here, and an XSS still steals nothing that outlives the page.
 *
 * The Google Play build cannot have that. Capacitor serves the app from its own origin
 * (`https://localhost`) and the API answers from the real domain, so the session cookie is
 * cross-site; `COOKIE_SAMESITE` is `lax` and a lax cookie is simply not sent. Login would
 * return 200 and every request after it would be anonymous — a login screen the shopkeeper
 * can never get past, with no error to explain it. The only way to keep the cookie is
 * `SameSite=none` for everybody, which weakens the website to fix a problem the website
 * does not have. So the app carries a Bearer token, and a Bearer token has to be readable
 * by the script that puts it in the header.
 *
 * What keeps that honest is the gate: `isStaticBundle()` reads
 * `process.env.NEXT_PUBLIC_BUILD_TARGET`, which Next inlines at build time. In the web
 * bundle these become `if (false)` and the minifier deletes them — the shipped website does
 * not merely avoid this path, it does not CONTAIN it. That is a stronger guarantee than a
 * runtime check, and it is why the gate is the build flag rather than `isNativeApp()`.
 */
const NATIVE_TOKEN_KEY = 'dukaan_native_token';

export function saveNativeToken(token) {
  if (!IS_STATIC_BUNDLE || typeof window === 'undefined' || !token) return;
  try {
    window.localStorage.setItem(NATIVE_TOKEN_KEY, token);
  } catch {
    // A WebView with storage disabled. The session then lasts exactly as long as the
    // process, which is a bad day, not a broken app.
  }
}

export function getNativeToken() {
  if (!IS_STATIC_BUNDLE || typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(NATIVE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearLocalSessionState() {
  resetShopIdentityReminder();
  setActiveStoreId(null);
  if (IS_STATIC_BUNDLE && typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(NATIVE_TOKEN_KEY);
    } catch {
      /* nothing to clear */
    }
  }
}

/**
 * The "somebody just signed in" hand-off, between the login page and the dashboard shell.
 *
 * sessionStorage, not localStorage, and consumed on read: the welcome moment must fire on
 * an actual sign-in and never on a refresh, a restored tab or ordinary navigation — and it
 * must not survive the tab, or a shared shop computer would greet the next person by the
 * last one's name.
 */
const JUST_SIGNED_IN_KEY = 'dukaan_just_signed_in';

export function markJustSignedIn() {
  resetShopIdentityReminder();
  try {
    sessionStorage.setItem(JUST_SIGNED_IN_KEY, '1');
  } catch {
    // Private-mode browsers block sessionStorage — the welcome simply doesn't play.
  }
}

export function takeJustSignedIn() {
  try {
    const found = sessionStorage.getItem(JUST_SIGNED_IN_KEY) === '1';
    if (found) sessionStorage.removeItem(JUST_SIGNED_IN_KEY);
    return found;
  } catch {
    return false;
  }
}
