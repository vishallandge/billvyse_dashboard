/**
 * The dashboard's copy of the "kaaran likhein" rule.
 *
 * Hand-maintained twin of backend/utils/changeReason.js, and the header there is where the
 * reasoning lives — read that one. This copy exists so the shopkeeper is told what is wrong with
 * his sentence WHILE he types it, instead of pressing Save, waiting, and being refused. The
 * server stays the authority; nothing here can let a bad reason through.
 *
 * Deliberately dependency-free — no React, no imports — so backend/tests/changeReason.test.js can
 * import this exact file and assert both implementations against one shared table of cases. A
 * twin nobody compares is a twin that drifts, and a validator that drifts refuses the shopkeeper
 * on the client for something the server would have accepted.
 */

export const MIN_REASON_LENGTH = 10;

const MIN_DISTINCT_CHARS = 6;

export function validateChangeReason(input) {
  const text = String(input || '').trim().replace(/\s+/g, ' ');

  if (text.length < MIN_REASON_LENGTH) return 'REASON_TOO_SHORT';

  const words = text.split(' ').filter((word) => /[\p{L}\p{N}]/u.test(word));
  if (words.length < 2) return 'REASON_TOO_VAGUE';

  if (new Set(words.map((word) => word.toLowerCase())).size < 2) return 'REASON_TOO_VAGUE';

  const distinct = new Set(text.toLowerCase().replace(/\s/g, ''));
  if (distinct.size < MIN_DISTINCT_CHARS) return 'REASON_TOO_VAGUE';

  return null;
}

export function isValidChangeReason(input) {
  return validateChangeReason(input) === null;
}

/* ------------------------------------------------------------- the actual answers ----- */

/**
 * The answers on offer, built from the change itself.
 *
 * Codes and conditions only — no wording. What the shopkeeper reads comes from
 * `t('seller.btypeReason_<code>')`; the English sentence that lands in the AuditLog is picked by
 * the SERVER from this same code, so the record stays consistent across all ten languages and a
 * client cannot put words in it. The header in backend/utils/changeReason.js is where the
 * reasoning lives — read that one.
 *
 * The short version of why this is not one flat list: a chemist is answering about a drug
 * licence, a dhaba about whether people still sit down to eat, a salon about whether it still
 * does the work or now just sells the shampoo. Showing all three to all three means every shop
 * reads options that are obviously not about it.
 */
export const BUSINESS_TYPE_REASONS = [
  { code: 'licence_surrendered', when: (ctx) => ctx.leavingMedical },
  { code: 'stopped_dine_in', when: (ctx) => ctx.dropsTables },
  { code: 'started_dine_in', when: (ctx) => ctx.takesUpTables },
  { code: 'stopped_services', when: (ctx) => ctx.dropsServices },
  { code: 'started_services', when: (ctx) => ctx.takesUpServices },
  { code: 'started_wholesale', when: (ctx) => ctx.takesUpWholesale },
  {
    code: 'added_new_lines',
    // Never for a chemist: a shop that added FMCG but still sells medicines must not get a
    // one-tap reason to switch off its own prescription register.
    when: (ctx) => ctx.goodsToGoods && !ctx.leavingMedical && !ctx.dropsTables && !ctx.takesUpTables,
  },
  { code: 'shop_changed_trade', when: () => true },
  { code: 'wrong_at_signup', when: () => true },
  { code: 'new_owner', when: () => true },
  { code: 'different_shop', when: () => true },
  { code: 'other', when: () => true },
];

export const BUSINESS_TYPE_REASON_CODES = BUSINESS_TYPE_REASONS.map((entry) => entry.code);

// Trade CONFIGS in, not trade keys — which is what keeps this file import-free so the backend
// test can load it directly and run all 22 x 22 transitions through both copies.
export function changeContext({ from = {}, to = {} } = {}) {
  /**
   * `booksAppointments`, NOT `sellsServices` — and this is a trap, not a preference.
   *
   * The two copies of businessTypes.js disagree about `sellsServices` ON PURPOSE: the dashboard
   * sets it for `restaurant` so the product form opens on a dish, and the backend does not
   * because it also uses that flag to hide Suppliers, which a kitchen needs. Build this rule on
   * it and a dhaba would be OFFERED "we stopped service work" by the dialog and REFUSED it by
   * the server a second later — a save that fails for a reason the shopkeeper cannot see.
   *
   * `booksAppointments` is pinned identical in both files (backend/tests/configSync.test.js) and
   * is the truer question anyway: the trades that run on a diary — repair counter, salon, tailor,
   * laundry, tuition, gym — are exactly the ones where the shop DOES the work rather than selling
   * it off a shelf.
   */
  const fromServices = Boolean(from.booksAppointments);
  const toServices = Boolean(to.booksAppointments);

  return {
    leavingMedical: from.key === 'medical',
    dropsTables: Boolean(from.runsTables) && !to.runsTables,
    takesUpTables: !from.runsTables && Boolean(to.runsTables),
    dropsServices: fromServices && !toServices,
    takesUpServices: !fromServices && toServices,
    takesUpWholesale: to.key === 'wholesale' && from.key !== 'wholesale',
    goodsToGoods: !fromServices && !toServices,
  };
}

export function reasonsFor(change = {}) {
  const ctx = changeContext(change);
  return BUSINESS_TYPE_REASONS.filter((entry) => entry.when(ctx));
}

/**
 * Can this be sent yet?
 *
 * Mirrors resolveChangeReason on the server, minus the recording half — the dialog only needs to
 * know whether to let the button go. Nothing here can let a bad answer through: the server runs
 * the same rule again and is the authority.
 */
export function reasonProblemFor({ code, text }) {
  if (!code) return 'REASON_NOT_CHOSEN';
  if (code !== 'other') return null;
  return validateChangeReason(text);
}
