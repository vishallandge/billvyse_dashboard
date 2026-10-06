/**
 * "Not now" for the self-update in components/AppUpdater.js.
 *
 * A tab running an old build reloads itself, but only at a moment nobody loses anything.
 * Most of that the updater can see on its own (an open dialog, a focused field). What it
 * cannot see is a screen whose work lives in page state — the billing counter with eleven
 * items scanned and a customer waiting. Such a screen holds the update while it is busy:
 *
 *   useEffect(() => holdAppUpdate('billing-cart', cart.length > 0), [cart.length]);
 *
 * and the reload happens the moment the hold is released — the bill is saved, the cart
 * is empty, and the next customer gets the new screen.
 */

const holds = new Set();
const listeners = new Set();

export function holdAppUpdate(key, held) {
  const had = holds.has(key);
  if (held) holds.add(key);
  else holds.delete(key);
  if (had !== Boolean(held)) listeners.forEach((fn) => fn());
  // Cleanup form, so a screen that unmounts never leaves its hold behind.
  return () => {
    if (holds.delete(key)) listeners.forEach((fn) => fn());
  };
}

export function appUpdateHeld() {
  return holds.size > 0;
}

export function onAppUpdateHoldChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
