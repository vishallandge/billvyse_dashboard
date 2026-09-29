/**
 * What counts as a sensible rule for the online counter, said before the save is refused.
 *
 * Mirrors backend/utils/storefrontSettings.js — that file is the enforcement, this one is
 * the explanation. The two must change together.
 *
 * The interesting cases here are not the shapes (a rupee amount is a number, a time is a
 * time) but the *pairs*: two perfectly valid numbers that together describe a rule that can
 * never fire. "Free delivery above ₹500" with no delivery charge set is the one that keeps
 * happening — the shopkeeper believes he is charging for delivery, the app charges nothing,
 * and he finds out weeks later from his own takings. A form that saves that silently is not
 * validating anything.
 */

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const isValidClock = (value) => HHMM.test(String(value || '').trim());

export function parseClock(value) {
  const match = HHMM.exec(String(value || '').trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** "18:30" → "6:30 PM". What a shopkeeper reads back, not what the input stores. */
export function formatClock(value) {
  const minutes = parseClock(value);
  if (minutes === null) return '';
  const hour = Math.floor(minutes / 60);
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minutes % 60).padStart(2, '0')} ${suffix}`;
}

const amount = (value) => {
  if (value === '' || value === null || value === undefined) return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
};

/**
 * Every problem with the storefront panel, as `{ fieldId, message }` — the same shape
 * validateShopProfile returns, so the Settings page can flash and scroll to the box with
 * the machinery it already has. Every message says what is wrong AND what to do about it.
 *
 * `ctx` carries what lives outside the storefront block but is edited on the same panel:
 * the delivery radius and the map pin it is measured from, and the pause-until time as it
 * was last saved (so an old, already-passed value is not suddenly an error on an unrelated
 * save — only a newly typed past time is).
 */
export const DELIVERY_RADIUS_MIN = 0.5;
export const DELIVERY_RADIUS_MAX = 100;
export const MAX_DELIVERY_SLOTS = 6;

export function validateStorefront(storefront, t, ctx = {}) {
  const s = storefront || {};
  const problems = [];
  const add = (fieldId, message) => problems.push({ fieldId, message });
  // Delivery's own boxes are greyed out while delivery is off. A refusal pointing at a box
  // nobody can type into is a dead end, so none of them is judged then.
  const delivers = s.allowDelivery !== false;

  for (const [key, id] of [
    ['minOrderValue', 'sfMinOrderValue'],
    ...(delivers ? [['deliveryCharge', 'sfDeliveryCharge'], ['freeDeliveryAbove', 'sfFreeDeliveryAbove']] : []),
  ]) {
    const value = amount(s[key]);
    if (Number.isNaN(value) || value < 0 || value > 100000) add(id, t('seller.errStorefrontAmount'));
  }

  const prep = s.prepTimeMinutes === '' || s.prepTimeMinutes == null ? 0 : Number(s.prepTimeMinutes);
  if (!Number.isFinite(prep) || prep < 0 || prep > 1440) add('sfPrepTime', t('seller.errStorefrontPrepTime'));

  // Half a window decides nothing, so it is refused rather than silently ignored — a shop
  // that typed an opening time and left the closing one blank believes it has set hours.
  const hasOpen = String(s.openTime || '').trim() !== '';
  const hasClose = String(s.closeTime || '').trim() !== '';
  if (hasOpen && !isValidClock(s.openTime)) add('sfOpenTime', t('seller.errStorefrontTime'));
  if (hasClose && !isValidClock(s.closeTime)) add('sfCloseTime', t('seller.errStorefrontTime'));
  if (hasOpen !== hasClose) add(hasOpen ? 'sfCloseTime' : 'sfOpenTime', t('seller.errStorefrontHalfWindow'));
  // "9:00 to 9:00" reads as a typo, and the server would treat it as open round the clock.
  if (hasOpen && hasClose && isValidClock(s.openTime) && parseClock(s.openTime) === parseClock(s.closeTime)) {
    add('sfCloseTime', t('seller.errStorefrontSameTime'));
  }

  if ((s.weeklyOffDays || []).length >= 7) add('sfWeeklyOff', t('seller.errStorefrontAllDaysOff'));

  if (!s.allowPickup && !s.allowDelivery && !s.allowDineIn && s.acceptingOrders !== false) add('sfAllowPickup', t('seller.errStorefrontNoFulfilment'));

  // A "switch back on at" time that has already gone switches nothing back on — the owner
  // believes orders resume tomorrow and they never paused in the first place.
  if (s.acceptingOrders === false && s.pausedUntil) {
    const at = new Date(s.pausedUntil).getTime();
    const saved = ctx.savedPausedUntil ? new Date(ctx.savedPausedUntil).getTime() : null;
    const now = ctx.now ?? Date.now();
    if (Number.isNaN(at)) add('sfPausedUntil', t('seller.errStorefrontPauseInvalid'));
    else if (at <= now && at !== saved) add('sfPausedUntil', t('seller.errStorefrontPausePast'));
  }

  // ---- the pairs ----
  const charge = amount(s.deliveryCharge);
  const free = amount(s.freeDeliveryAbove);
  const min = amount(s.minOrderValue);
  if (delivers && free > 0 && charge <= 0) add('sfFreeDeliveryAbove', t('seller.errStorefrontFreeWithoutCharge'));
  if (delivers && min > 0 && free > 0 && free < min) add('sfFreeDeliveryAbove', t('seller.errStorefrontFreeBelowMin'));

  // ---- how far the shop goes ----
  const rawRadius = String(ctx.deliveryRadiusKm ?? '').trim();
  if (delivers && rawRadius !== '') {
    const km = Number(rawRadius);
    if (!Number.isFinite(km) || km < DELIVERY_RADIUS_MIN || km > DELIVERY_RADIUS_MAX) {
      add('deliveryRadiusKm', t('seller.errStorefrontRadius'));
    } else if (!ctx.shopLocation) {
      // A radius with no pin to measure from never fires. It used to be a grey hint the
      // owner could save straight past; it is the one rule on this panel that silently lies.
      add('deliveryRadiusKm', t('seller.errStorefrontRadiusNoPin'));
    }
  }

  // ---- delivery rounds ----
  // Numbered the way the owner sees them on screen (1, 2, 3 from the top), because "a
  // window overlaps" on a list of five is a riddle.
  if (delivers) {
    const slots = Array.isArray(s.deliverySlots) ? s.deliverySlots : [];
    let slotProblem = '';
    if (slots.length > MAX_DELIVERY_SLOTS) slotProblem = t('seller.errSlotTooMany', { max: MAX_DELIVERY_SLOTS });
    const timed = [];
    slots.forEach((slot, index) => {
      if (slotProblem) return;
      const from = parseClock(slot?.start);
      const to = parseClock(slot?.end);
      if (from === null || to === null) slotProblem = t('seller.errSlotTime', { n: index + 1 });
      else if (to <= from) slotProblem = t('seller.errSlotOrder', { n: index + 1 });
      else timed.push({ n: index + 1, from, to });
    });
    if (!slotProblem) {
      timed.sort((a, b) => a.from - b.from);
      for (let i = 1; i < timed.length; i += 1) {
        if (timed[i].from < timed[i - 1].to) {
          const [a, b] = [timed[i - 1].n, timed[i].n].sort((x, y) => x - y);
          slotProblem = t('seller.errSlotOverlap', { a, b });
          break;
        }
      }
    }
    if (slotProblem) add('deliverySlots', slotProblem);
  }

  return problems;
}

/**
 * The sentence the panel shows the shopkeeper about his own rules, in his own words.
 *
 * Not validation — this is the receipt. A settings panel full of numbers is a form; the same
 * numbers read back as "₹300 se kam ka order nahi, ₹40 delivery, ₹500 ke upar free" is the
 * shopkeeper checking his own shop against what he meant. It is the fastest way anybody has
 * ever found a mis-typed zero.
 */
export function storefrontSummaryKeys(storefront) {
  const s = storefront || {};
  const rows = [];
  const min = amount(s.minOrderValue);
  const charge = amount(s.deliveryCharge);
  const free = amount(s.freeDeliveryAbove);

  if (min > 0) rows.push({ key: 'seller.sfSummaryMin', vars: { amount: min } });
  if (charge > 0 && free > 0) rows.push({ key: 'seller.sfSummaryChargeFree', vars: { amount: charge, free } });
  else if (charge > 0) rows.push({ key: 'seller.sfSummaryCharge', vars: { amount: charge } });
  else rows.push({ key: 'seller.sfSummaryFreeAlways', vars: {} });

  if (!s.allowDineIn && s.allowPickup && !s.allowDelivery) rows.push({ key: 'seller.sfSummaryPickupOnly', vars: {} });
  else if (!s.allowDineIn && s.allowDelivery && !s.allowPickup) rows.push({ key: 'seller.sfSummaryDeliveryOnly', vars: {} });

  if (s.openTime && s.closeTime) {
    rows.push({
      key: s.outsideHours === 'block' ? 'seller.sfSummaryHoursBlock' : 'seller.sfSummaryHoursAccept',
      vars: { open: formatClock(s.openTime), close: formatClock(s.closeTime) },
    });
  }

  return rows;
}
