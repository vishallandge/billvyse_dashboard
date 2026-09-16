/**
 * Which screens a shop is asked about in Settings → Screens.
 *
 * Pure and React-free on purpose: this is the rule that decides whether a pharmacy owner is
 * shown a tick box labelled "Kitchen", and a rule like that has to be readable and testable
 * on its own rather than buried in a component. The first version of that panel listed every
 * optional screen in the app, which put "Tables" and "Kitchen" in a medical store's settings —
 * the exact thing the panel exists to remove, moved one screen sideways.
 */

/**
 * The catalogue, grouped the way the sidebar groups them.
 *
 * Overview, Billing, Notifications, Plan and Settings are deliberately absent: they are how a
 * shopkeeper gets anywhere at all, including back to this panel. A menu you can empty is a
 * menu that can trap someone.
 */
export const SCREEN_GROUPS = [
  { id: 'sell', keys: ['estimates', 'recurring', 'tables', 'kitchen', 'counters', 'analytics'] },
  { id: 'customers', keys: ['khata', 'orders', 'appointments', 'jobs', 'memberships', 'catalog', 'loyalty', 'offers', 'campaigns'] },
  { id: 'stock', keys: ['inventory', 'savings', 'labels', 'suppliers', 'supplierLedger', 'purchaseOrders', 'purchaseReturns', 'supply'] },
  { id: 'money', keys: ['expenses', 'daybook', 'reports', 'accounting'] },
  { id: 'business', keys: ['stores', 'centralInventory', 'transfers', 'staff', 'backup'] },
];

/**
 * The screens this particular shop gets a choice about.
 *
 * Only what it actually has. A screen its trade does not run, or its plan does not include, is
 * not a decision the shopkeeper has to make — it is a row that makes him ask why his app
 * thinks he runs a restaurant. Both of those are changed where they are really decided: the
 * business type in shop details, and the plan.
 *
 *   byTrade   — keys the shop's trade (or its current state) takes away; never listed
 *   moduleOff — keys the plan or the platform admin has switched off; never listed
 *   hidden    — keys the OWNER switched off; still listed, unchecked, so the tick that hid a
 *               screen is also the tick that brings it back
 *
 * Groups that end up empty are dropped, because an empty heading is its own small "why is
 * this here".
 */
export function listedScreenGroups({ byTrade = [], moduleOff = [], groups = SCREEN_GROUPS } = {}) {
  const excluded = new Set([...byTrade, ...moduleOff]);
  return groups
    .map((group) => ({ id: group.id, keys: group.keys.filter((key) => !excluded.has(key)) }))
    .filter((group) => group.keys.length > 0);
}

/**
 * Which keys the plan or the platform admin has taken away, separated out of the one list the
 * server sends.
 *
 * `hiddenNav` is the union of every reason a screen is not on the menu. Subtracting the two
 * reasons we can name — the trade and the owner's own choice — leaves the ones neither of them
 * explains, which is exactly the set this panel must not offer as a choice.
 */
export function moduleOffKeys({ hiddenNav = [], byTrade = [], hidden = [] } = {}) {
  const known = new Set([...byTrade, ...hidden]);
  return hiddenNav.filter((key) => !known.has(key));
}
