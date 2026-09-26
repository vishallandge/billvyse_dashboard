import {
  getActiveStoreId,
  getCsrfToken,
  clearLocalSessionState,
  getNativeToken,
  saveNativeToken,
} from './session';
import { isNativeApp } from './platform';
import { announceUpgradeNeeded } from './upgradeSignal';
import { resilientFetch, newIdempotencyKey } from './net';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Everything every request needs: the session (a cookie the browser attaches by itself),
 * the active store, and — on state-changing calls — the CSRF token echoed from its cookie
 * into a header. That echo is the whole double-submit check: a page on another origin can
 * neither read our cookie nor set this header without our CORS policy letting it.
 */
function buildRequest(options = {}) {
  const headers = { ...options.headers };
  const method = (options.method || 'GET').toUpperCase();

  const storeId = getActiveStoreId();
  if (storeId) headers['X-Store-Id'] = storeId;

  /**
   * The one place the app tells the server which shell it is running in.
   *
   * Everything that keeps us inside Google's Payments policy hangs off this header. A
   * request carrying it gets no prices, no purchase URLs and no upsell campaigns back — the
   * server strips them (backend/middleware/nativeClient.js), so a Play build cannot render a
   * price it was never sent, and a screen written next year inherits that without its author
   * knowing this rule exists.
   *
   * It belongs HERE, beside the store and CSRF headers, precisely because this function is
   * the only way out of the app: apiFetch funnels every call through it. Thirty scattered
   * `if (native)` checks would each be a chance to forget the thirty-first; this is one line
   * that cannot be forgotten because nothing else can reach the network.
   *
   * The server cannot verify the claim — the client asserts it. That is fine: the only lie
   * available is a browser hiding its own prices, which harms nobody. The dangerous
   * direction, a Play build showing prices, needs this single line to fail, not a habit.
   */
  if (isNativeApp()) headers['X-BV-Client'] = 'native';

  /**
   * The session, for the Google Play build only.
   *
   * On the website this is `null` and always will be — `getNativeToken` is compiled out of
   * the web bundle entirely (lib/session.js), so the browser keeps its httpOnly cookie and
   * nothing here can read or leak it.
   *
   * The app has no such option: Capacitor serves it from `https://localhost`, the API
   * answers from the real domain, and a `SameSite=lax` cookie is never sent across that
   * boundary. Without this header the app logs in successfully and is anonymous on every
   * request afterwards — a loop back to the login screen with no error to explain it.
   *
   * middleware/auth.js already prefers this header over the cookie and csrfProtection
   * already exempts Bearer requests, so nothing new is being trusted on the server.
   */
  const nativeToken = getNativeToken();
  if (nativeToken && !headers.Authorization) headers.Authorization = `Bearer ${nativeToken}`;

  if (UNSAFE_METHODS.has(method)) {
    const csrf = getCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;

    /**
     * What makes a retry safe.
     *
     * Every write carries a key the caller minted once and every retry of it reuses. A
     * request that reached the server but whose ANSWER was lost — the everyday shape of a
     * 4G dropout, and the reason a counter ends the day with two identical bills — is
     * recognised on its second arrival and answered with the original result. See
     * backend/middleware/idempotency.js.
     *
     * Minted here only as a fallback; apiFetch mints it before the first attempt so the
     * CSRF repair below re-sends the SAME key rather than a fresh one.
     */
    if (!headers['Idempotency-Key']) headers['Idempotency-Key'] = newIdempotencyKey();
  }

  return {
    ...options,
    headers,
    // Without this the browser sends no cookies to a different origin, and since the token
    // now lives ONLY in a cookie, every request would be anonymous. This one line is what
    // authenticates the entire dashboard.
    credentials: 'include',
  };
}

// A 401 means the cookie is gone or expired. There is no token to clear any more — the
// server owns that — so this only drops local preference state and sends the user to the
// login screen rather than leaving them on a page that will never load.
//
// Never from a signed-out screen. A stale cookie left behind on localhost (or by the
// storefront on the same host) makes a background call — the push re-sync that runs on
// every window focus — 401 there, and the visitor who just clicked into the signup form
// was thrown to /login?next=/register-seller before typing a letter. Those screens need
// no session, so a 401 behind them means nothing to act on.
const SIGNED_OUT_PATHS = ['/login', '/register-seller', '/forgot-password', '/reset-password'];

function handleUnauthenticated() {
  clearLocalSessionState();
  if (typeof window === 'undefined') return;
  const path = window.location.pathname;
  if (path === '/' || SIGNED_OUT_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return;
  window.location.href = `/login?next=${encodeURIComponent(path)}`;
}

/**
 * Re-mints the CSRF cookie for a session that still has one.
 *
 * A browser can end up logged in with no CSRF cookie in several ordinary ways — signing out
 * of the storefront on the same host, a cleared cookie jar, a restored tab. Until the server
 * learned to re-issue it (middleware/csrf.js refreshCsrfCookie), that state was permanent:
 * every save answered "This page has gone stale. Please refresh and try again", and
 * refreshing did not help either, so the only way out was logging back in.
 *
 * One cheap GET is all it takes. Shared through a single in-flight promise so a screen that
 * fires four saves at once repairs the cookie once, not four times.
 *
 * Returns whether the cookie actually changed. If it did not — no session left, or a cookie
 * this page genuinely cannot read — there is nothing to retry with and the caller lets the
 * original error through rather than looping.
 */
let csrfRepair = null;

async function repairCsrfToken() {
  const before = getCsrfToken();
  if (!csrfRepair) {
    csrfRepair = resilientFetch(`${API_URL}/api/health`, { credentials: 'include' }, { retries: 1, timeoutMs: 8000 })
      .catch(() => null)
      .finally(() => {
        csrfRepair = null;
      });
  }
  await csrfRepair;
  const after = getCsrfToken();
  return Boolean(after) && after !== before;
}

function sendJson(path, options) {
  return resilientFetch(
    `${API_URL}${path}`,
    buildRequest({ ...options, headers: { 'Content-Type': 'application/json', ...options.headers } }),
    // A screen that passes `timeoutMs` or `retries` (a long-running import, say) overrides
    // the defaults; everything else gets the standard deadline and backoff.
    { timeoutMs: options.timeoutMs, retries: options.retries }
  );
}

/**
 * The one error the app raises when the server could not be reached at all.
 *
 * Given a `code` like every other failure in the app so screens can branch on it, and a
 * message written for the shopkeeper rather than the browser's "Failed to fetch" — which is
 * read, every time, as "this app is broken".
 */
function unreachableError(cause) {
  const error = new Error(
    cause?.offline
      ? 'You are offline. This will be sent as soon as the internet is back.'
      : 'Could not reach the server. Please check your internet and try again.'
  );
  error.code = 'NETWORK_UNREACHABLE';
  error.status = 0;
  error.offline = Boolean(cause?.offline);
  return error;
}

export async function apiFetch(path, options = {}) {
  /**
   * Minted once, here, before anything is sent.
   *
   * Every retry of this call — the automatic ones inside resilientFetch, and the CSRF repair
   * below — reuses it, which is precisely what makes them safe. A key generated per attempt
   * would defeat the whole mechanism: the server would see three different requests and
   * write three bills.
   */
  const method = (options.method || 'GET').toUpperCase();
  const request = UNSAFE_METHODS.has(method)
    ? { ...options, headers: { 'Idempotency-Key': newIdempotencyKey(), ...options.headers } }
    : options;

  let res;
  try {
    res = await sendJson(path, request);
  } catch (error) {
    if (error?.code === 'NETWORK_UNREACHABLE') throw unreachableError(error);
    throw error;
  }
  let data = await res.json().catch(() => ({}));

  /**
   * A refused CSRF check is repaired and retried once, silently.
   *
   * Retrying is safe in a way almost no other retry is: `csrfProtection` is mounted ahead of
   * every route, so a request it refuses never reached a handler and nothing was executed.
   * There is no half-saved bill to worry about — the POST simply did not happen.
   *
   * Exactly once, and only when the repair produced a genuinely new token, so a real failure
   * still surfaces instead of spinning.
   */
  if (res.status === 403 && data.code === 'CSRF_FAILED' && (await repairCsrfToken())) {
    res = await sendJson(path, request);
    data = await res.json().catch(() => ({}));
  }

  /**
   * Catch the session on its way past, in the Play build.
   *
   * The server attaches `token` to the body of any response that established a session, and
   * only for a request that stamped itself as the app (backend/middleware/nativeClient.js).
   * That covers all nine ways in — password, Google, e-mail OTP, staff, admin — without any
   * login screen knowing this exists, which is the point: a tenth one added next year is
   * signed in too, and nobody has to remember why.
   *
   * `saveNativeToken` is a no-op anywhere but the exported bundle, and is compiled out of
   * the website's entirely, so this line costs the browser nothing.
   */
  if (data?.token) saveNativeToken(data.token);

  if (res.status === 401) {
    handleUnauthenticated();
  }
  if (!res.ok) {
    // Carry the status and body along. Some endpoints answer with more than a message —
    // e.g. the profile save replies `requiresPassword` when the payout UPI ID is being
    // changed — and a bare `new Error(message)` threw all of that away, so the caller
    // could never react to anything but the text.
    const error = new Error(data.message || 'Request failed');
    error.status = res.status;
    error.data = data;
    // Lifted out of the body because a machine-readable reason is the thing callers
    // branch on, and `err.data?.code` at every call site is easy to get subtly wrong.
    // Endpoints that answer with one (EXPIRED_PRODUCT, BELOW_COST) rely on this.
    error.code = data.code;
    /* Which box the refusal is about, when the server knows. Many controllers already send
       it (`field: 'shopPhone'` on a duplicate number, `field: 'newPassword'`, and so on)
       and nothing on the client was reading it — so a message about ONE field arrived as a
       banner over a form of six, and the reader had to guess. See lib/focusField.js. */
    error.field = data.field;
    error.lines = data.lines;
    // Free text a platform admin wrote (a suspension note). Carried separately so screens
    // can append it to a translated sentence instead of showing the server's English one.
    error.reason = data.reason;
    // Seconds, on a 429 or a 503. The retry layer already waited out anything short; what
    // reaches here is a limit long enough that the shopkeeper has to be told the number
    // rather than left watching a spinner.
    error.retryAfter = data.retryAfter;
    // The id of the exact request that failed, minted by the API. Worth showing on a
    // hard error: it is the one thing that turns "it broke" into something support can
    // look up in the logs.
    error.requestId = data.requestId;
    /**
     * A refusal that can be bought out of becomes an offer, everywhere, from here.
     *
     * This one line is the answer to "the message says upgrade your dukaan and there is
     * nothing to press". Every 402 in the app now raises an event the shell listens for and
     * answers with the upgrade sheet — which plan, what it costs, one button. Doing it at
     * the call sites instead would have meant editing every screen that can hit a plan
     * wall, and missing the ones added next month.
     *
     * The error is still thrown exactly as before, so any screen that already handles a 402
     * its own way keeps working untouched.
     */
    /**
     * A caller that is only checking whether a feature is available — to decide if a
     * chip should render at all, say — passes `silentUpgrade: true` to opt out of the
     * global sheet. Without this, a background probe that a `.catch(() => {})` was
     * written to shrug off still popped the full-screen upgrade sheet on top of whatever
     * the shopkeeper was doing, because the event fires inside apiFetch itself, before the
     * caller's own catch ever runs. See the loyalty check on the billing screen: it was
     * meant to silently decide whether to show the loyalty chip, and instead greeted every
     * Pro-plan shop mid-bill with "upgrade to Premium".
     */
    if (res.status === 402 && !options.silentUpgrade) announceUpgradeNeeded(error);
    throw error;
  }
  return data;
}

/**
 * The pre-session endpoints: login, signup, forgot/reset password.
 *
 * They cannot use `apiFetch`, because a 401 there means "wrong password", not "your session
 * expired" — and `apiFetch` answers a 401 by bouncing to /login, which on the reset-password
 * screen throws the shopkeeper off the page they were mid-way through.
 *
 * They should not use bare `fetch` either, which is what they did until now: no CSRF header
 * went out, so these calls depended entirely on the server's exemption list to get through.
 * When that list broke (the middleware compared a mount-stripped path), login itself started
 * answering 403 and there was nothing on this side making it work anyway. Sending the header
 * costs one cookie read and means the login POST is valid on its own merits.
 */
export async function authFetch(path, options = {}) {
  const request = buildRequest({
    ...options,
    method: options.method || 'POST',
    // Sign-up is the write that matters most here: a resent registration must not create
    // two shops. buildRequest stamps the key; it is minted once for this call and reused by
    // every retry inside resilientFetch.
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey(), ...options.headers },
  });

  let res;
  try {
    res = await resilientFetch(`${API_URL}${path}`, request);
  } catch (error) {
    if (error?.code === 'NETWORK_UNREACHABLE') throw unreachableError(error);
    throw error;
  }
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = new Error(data.message || 'Request failed');
    error.status = res.status;
    error.data = data;
    // What the screens translate on. Rate limiters answer from middleware rather than a
    // controller, so this is the only thing those responses have in common with the rest.
    error.code = data.code;
    // Same as the path above: the box the refusal is about, when the server names one.
    error.field = data.field;
    error.reason = data.reason;
    error.retryAfter = data.retryAfter;
    error.requestId = data.requestId;
    throw error;
  }
  return data;
}

/**
 * A file request, which is sometimes a POST.
 *
 * Downloads used to be GET-only, and mostly still are. The exception is a print job: label
 * printing sends per-product copies and a dozen field switches, and that is a body, not a
 * query string. Everything else — the session cookie, the active store, the CSRF header on
 * an unsafe method — is exactly what buildRequest already does; this only adds the JSON
 * content type when there is something to send.
 */
function buildFileRequest(options = {}) {
  const body = options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body;
  return buildRequest({
    ...options,
    body,
    headers: body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
  });
}

function filenameFromDisposition(header) {
  if (!header) return null;
  // RFC 5987 form wins when present (handles non-ASCII names).
  const encoded = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ''));
    } catch {
      // fall through to the plain form
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

// Downloads a file from an authenticated endpoint.
//
// These used to be plain `<a href={API_URL + ...}>` links, which only worked because the
// session also existed as a cookie — and that cookie is host-only, so the moment the API
// lives on a different host (api.x.com vs app.x.com) the browser stopped sending it and
// every download 401'd. It survived locally only because cookies ignore the port.
//
// Fetching it here is now the only way it can work at all: there is no token to put in a
// URL even if we wanted to, and `credentials: 'include'` sends the session cookie
// explicitly rather than hoping the browser volunteers it. It also turns a 401 into a real
// error the page can show instead of dumping JSON into a new tab.
export async function downloadFile(path, fallbackName = 'download', options = {}) {
  // A longer deadline than a normal call and no retry on a POST-shaped print job: an export
  // is slow by design (the server exempts these routes from its own request timeout), and
  // re-sending a half-received 20 MB file over a struggling connection makes things worse,
  // not better. A dropped download is also the one failure a shopkeeper can simply retry by
  // pressing the button again, with nothing lost either way.
  let res;
  try {
    res = await resilientFetch(`${API_URL}${path}`, buildFileRequest(options), {
      timeoutMs: 120000,
      retries: 1,
    });
  } catch (error) {
    if (error?.code === 'NETWORK_UNREACHABLE') throw unreachableError(error);
    throw error;
  }

  if (res.status === 401) handleUnauthenticated();
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const error = new Error(data.message || 'Download failed');
    error.status = res.status;
    error.code = data.code;
    error.data = data;
    throw error;
  }

  const blob = await res.blob();
  const name = filenameFromDisposition(res.headers.get('Content-Disposition')) || fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously cancels the save in some browsers — let it settle first.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return name;
}

/**
 * An authenticated file, as an object URL that can go straight into `src` or `href`.
 *
 * Needed for the same reason `downloadFile` is: the session is an httpOnly cookie, and a
 * plain `<img src={API_URL + path}>` is a cross-origin request that carries no credentials
 * unless the server and the tag both opt in — so a supplier invoice rendered that way works
 * on localhost (where the ports share a host and the cookie leaks across) and 401s the
 * moment the API lives anywhere else. See [[authed downloads]] in lib/api.js above.
 *
 * The caller owns the returned URL and MUST revoke it when the view goes away; an object
 * URL pins its blob in memory until it does, and a page of bill photos left un-revoked is
 * a real leak rather than a theoretical one.
 */
export async function fetchBlobUrl(path, options = {}) {
  let res;
  try {
    res = await resilientFetch(`${API_URL}${path}`, buildFileRequest(options), { timeoutMs: 60000 });
  } catch (error) {
    if (error?.code === 'NETWORK_UNREACHABLE') throw unreachableError(error);
    throw error;
  }

  if (res.status === 401) handleUnauthenticated();
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const error = new Error(data.message || 'Could not open this file');
    error.status = res.status;
    error.code = data.code;
    throw error;
  }

  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: blob.type };
}

/** Turns a picked file into the `data:` URL the attachment endpoints accept. */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

export { API_URL };
