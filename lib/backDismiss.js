'use client';

import { useEffect, useRef } from 'react';

/**
 * The Android back button, taught what an overlay is.
 *
 * In a browser tab, back means "leave this page" and the address bar makes that obvious.
 * Inside an installed app there is no address bar, and back stops meaning that: it means
 * "close whatever just opened". A shopkeeper opens the add-product sheet, types half of it,
 * presses back to dismiss it — and the whole app closes, taking the half-filled form with it.
 * That is not a rare edge; it is what back is FOR on Android, and it happens every day.
 *
 * The mechanism is one shared history entry — the "guard" — not one per dialog:
 *
 *   First overlay opens   push a guard entry (same URL, no navigation).
 *   Back pressed          the guard pops; the TOP overlay closes; if others are still open
 *                         the guard is pushed again, so the next back closes the next one.
 *   Closed some other way (Escape, backdrop, Save) — the guard is popped back off, so the
 *                         history stack ends exactly where it started and back still means
 *                         "leave this page".
 *
 * Three details that are not optional:
 *
 * `pushState` is called with NO url. Next's app-router patches pushState and only dispatches
 * a router update when a url is passed — omitting it means the guard costs nothing and never
 * re-renders the route. The patch also copies Next's own `__NA` internals onto our state,
 * without which Next's popstate handler does a full `location.reload()`.
 *
 * Ownership is checked against `history.state`, never against a boolean we keep. If the
 * shopkeeper taps a link inside a dialog, the route changes and OUR entry is no longer the
 * current one — popping then would silently undo their navigation. Reading the real state is
 * what makes that case a no-op instead of a bug.
 *
 * The release is deferred by a microtask because React StrictMode mounts every effect twice
 * in development: mount, unmount, mount again, synchronously. An immediate pop on that first
 * unmount would fire a popstate that the re-mounted listener reads as a real back press, and
 * every dialog in the app would shut itself the instant it opened. Deferring lets the second
 * mount re-register first, so the release sees the overlay is still open and stands down.
 */

// Every open overlay, oldest first. The last one is what back closes.
const stack = [];

// The token on the guard entry we pushed, so we can tell our own entry apart from any other
// history entry that happens to be current.
let guardToken = null;
let listening = false;
let releaseScheduled = false;

function newToken() {
  return `bv-ov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function guardIsCurrent() {
  try {
    return Boolean(guardToken) && window.history.state?.__bvOverlay === guardToken;
  } catch {
    return false;
  }
}

function pushGuard() {
  if (guardIsCurrent()) return;
  try {
    guardToken = newToken();
    window.history.pushState({ __bvOverlay: guardToken }, '');
  } catch {
    guardToken = null;
  }
}

function onPopState() {
  // Not our entry — some other back press. Leave it entirely alone.
  if (stack.length === 0) return;
  guardToken = null;

  const top = stack[stack.length - 1];
  // React unmounts on its own schedule, so `stack` still holds `top` here. Anything left
  // underneath needs the guard back, or the second back press would leave the page with a
  // dialog still on screen.
  if (stack.length > 1) pushGuard();
  try {
    top.close?.();
  } catch {
    /* A dialog whose close handler throws must not also break the back button. */
  }
}

function scheduleRelease() {
  if (releaseScheduled) return;
  releaseScheduled = true;
  Promise.resolve().then(() => {
    releaseScheduled = false;
    if (stack.length > 0) return;
    if (!guardIsCurrent()) return;
    guardToken = null;
    try {
      window.history.back();
    } catch {
      /* no-op */
    }
  });
}

/**
 * True when the app is running as an installed app rather than in a browser tab — a TWA on
 * Android, an installed PWA on desktop, or a home-screen app on iOS.
 *
 * The back guard is deliberately scoped to this. In a tab the address bar is right there and
 * back plainly means "go back"; taking that over would be us overriding a control the
 * shopkeeper can see. Without the bar, there is no other meaning left for it to have.
 */
export function isInstalledApp() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    if (window.matchMedia?.('(display-mode: fullscreen)').matches) return true;
    // Chrome hands a TWA its launch referrer; this is also how the app tells itself apart
    // from the same site opened in Chrome on the same phone.
    if (typeof document !== 'undefined' && document.referrer.startsWith('android-app://')) return true;
    // iOS home-screen apps, which report neither of the above.
    if (window.navigator.standalone === true) return true;
  } catch {
    return false;
  }
  return false;
}

/**
 * Register an open overlay with the back button.
 *
 * @param onClose  called when back is pressed while this overlay is the topmost one
 * @param enabled  pass false for an overlay that must not be dismissable this way
 */
export default function useBackDismiss(onClose, enabled = true) {
  // Held in a ref so a dialog re-rendering with a fresh arrow function does not tear the
  // guard down and rebuild it — which would push a second history entry every keystroke in
  // a dialog whose parent re-renders as you type.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof window === 'undefined') return undefined;
    if (!isInstalledApp()) return undefined;

    if (!listening) {
      window.addEventListener('popstate', onPopState);
      listening = true;
    }

    const entry = { close: () => onCloseRef.current?.() };
    stack.push(entry);
    pushGuard();

    return () => {
      const at = stack.indexOf(entry);
      if (at > -1) stack.splice(at, 1);
      scheduleRelease();
    };
  }, [enabled]);
}
