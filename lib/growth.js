'use client';

import { apiFetch } from './api';

// Re-exported so a screen only ever needs one growth import. The definitions live in
// upgradeSignal.js because lib/api.js raises the event and this file calls apiFetch — see
// that file's header for why the two are not allowed to import each other.
export { UPGRADE_CODES, isUpgradeError, announceUpgradeNeeded, requestUpgrade } from './upgradeSignal';

/**
 * The dashboard's half of the growth engine.
 *
 * Three jobs: ask the server what it wants to say at a given moment, tell it what the shop
 * did about it, and turn a 402 into an offer instead of a dead end.
 *
 * Every call here is deliberately failure-tolerant. A nudge is the least important thing on
 * any screen it appears on — a campaign request that 500s must never break billing, so
 * everything resolves to "nothing to show" rather than rejecting.
 */

/**
 * What the platform wants to say at this moment.
 *
 * `trigger` is the moment ("app_open", "page_view", "plan_page"); the rest narrows it. The
 * server decides everything else — who, how often, in which language — so the caller never
 * has to know a campaign exists.
 */
export async function fetchCampaigns({ trigger, lang, ...params }) {
  const query = new URLSearchParams({ trigger, lang: lang || 'en' });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  try {
    const data = await apiFetch(`/api/seller/growth?${query.toString()}`);
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    // A campaign that cannot be fetched is a campaign that is not shown. Never a visible
    // error: the shopkeeper did not ask for this and has nothing to do about it.
    return [];
  }
}

export function reportCampaignEvent(id, type, variant) {
  if (!id || id === 'preview') return Promise.resolve();
  return apiFetch('/api/seller/growth/event', {
    method: 'POST',
    body: JSON.stringify({ id, type, variant }),
  }).catch(() => {});
}

/** The offer behind a lock: which plan, what it costs, plus any campaign attached to it. */
export async function fetchUpgradeInfo(feature, lang) {
  const query = new URLSearchParams({ lang: lang || 'en' });
  if (feature) query.set('feature', feature);
  try {
    return await apiFetch(`/api/seller/upgrade-info?${query.toString()}`);
  } catch {
    return null;
  }
}

/**
 * Prices a purchase with a discount code, without starting one.
 *
 * The server does the arithmetic — the same function the checkout itself uses — because a
 * client-side estimate that disagrees with the till by even a rupee is worse than no
 * preview at all.
 */
export function quotePlan({ plan, cycle, promoCode, usePoints }) {
  return apiFetch('/api/seller/payments/quote', {
    method: 'POST',
    // `usePoints` rides along so one call can price both discounts at once. The response
    // reports them on separate lines (discountPaise vs pointsDiscountPaise) because a
    // shopkeeper who cannot see which saving came from where cannot decide whether to spend
    // the points here or save them for free plan days.
    body: JSON.stringify({ plan, cycle, promoCode, usePoints }),
  });
}
