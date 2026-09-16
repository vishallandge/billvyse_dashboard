/**
 * The 402 → offer signal, on its own with no imports.
 *
 * It lives apart from lib/growth.js for one structural reason: `lib/api.js` has to raise
 * this event, and lib/growth.js has to call `apiFetch`. Putting the signal in growth.js
 * would make those two files import each other, and a cycle between the module every screen
 * fetches through and the module that sells upgrades is not a cycle worth risking for the
 * sake of one file fewer.
 */

/** The 402 codes that mean "this can be bought", as opposed to any other payment error. */
export const UPGRADE_CODES = new Set(['PLAN_UPGRADE_REQUIRED', 'PLAN_LIMIT_REACHED', 'USAGE_LIMIT_REACHED']);

export function isUpgradeError(error) {
  const code = error?.code || error?.data?.code;
  return error?.status === 402 && UPGRADE_CODES.has(code);
}

/**
 * The one place a refused feature becomes an offer.
 *
 * `lib/api.js` fires this for every 402 the app receives, which is what makes the upgrade
 * path appear at all of the call sites without any of them being edited. That was the
 * actual complaint: the message said "upgrade your dukaan" and there was nowhere to press.
 */
export function announceUpgradeNeeded(error) {
  if (typeof window === 'undefined' || !isUpgradeError(error)) return;
  const data = { ...(error.data || {}) };
  window.dispatchEvent(
    new CustomEvent('dukaan:upgradeNeeded', {
      detail: {
        code: error.code || data.code,
        feature: data.feature || data.metric || '',
        module: data.module || '',
        currentPlan: data.currentPlan || '',
        requiredPlan: data.requiredPlan || null,
        requiredPlanName: data.requiredPlanName || null,
        priceMonthly: data.priceMonthly ?? null,
        priceYearly: data.priceYearly ?? null,
        limit: data.limit ?? null,
        used: data.used ?? null,
        upgradeLimit: data.upgradeLimit ?? null,
      },
    })
  );
}

/** Opens the same sheet from a button rather than from a refusal (a lock in the sidebar). */
export function requestUpgrade(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('dukaan:upgradeNeeded', { detail }));
}
