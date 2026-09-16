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
 * the machinery it already has.
 */
export function validateStorefront(storefront, t) {
  const s = storefront || {};
  const problems = [];
  const add = (fieldId, message) => problems.push({ fieldId, message });

  for (const [key, id] of [
    ['minOrderValue', 'sfMinOrderValue'],
    ['deliveryCharge', 'sfDeliveryCharge'],
    ['freeDeliveryAbove', 'sfFreeDeliveryAbove'],
  ]) {
    const value = amount(s[key]);
    if (Number.isNaN(value) || value < 0 || value > 100000) add(id, t('seller.errStorefrontAmount'));
  }

  const prep = s.prepTimeMinutes === '' || s.prepTimeMinutes === null ? 0 : Number(s.prepTimeMinutes);
  if (!Number.isFinite(prep) || prep < 0 || prep > 1440) add('sfPrepTime', t('seller.errStorefrontPrepTime'));

  // Half a window decides nothing, so it is refused rather than silently ignored — a shop
  // that typed an opening time and left the closing one blank believes it has set hours.
  const hasOpen = String(s.openTime || '').trim() !== '';
  const hasClose = String(s.closeTime || '').trim() !== '';
  if (hasOpen && !isValidClock(s.openTime)) add('sfOpenTime', t('seller.errStorefrontTime'));
  if (hasClose && !isValidClock(s.closeTime)) add('sfCloseTime', t('seller.errStorefrontTime'));
  if (hasOpen !== hasClose) add(hasOpen ? 'sfCloseTime' : 'sfOpenTime', t('seller.errStorefrontHalfWindow'));

  if ((s.weeklyOffDays || []).length >= 7) add('sfWeeklyOff', t('seller.errStorefrontAllDaysOff'));

  if (!s.allowPickup && !s.allowDelivery && !s.allowDineIn && s.acceptingOrders !== false) add('sfAllowPickup', t('seller.errStorefrontNoFulfilment'));

  // ---- the pairs ----
  const charge = amount(s.deliveryCharge);
  const free = amount(s.freeDeliveryAbove);
  const min = amount(s.minOrderValue);
  if (free > 0 && charge <= 0) add('sfFreeDeliveryAbove', t('seller.errStorefrontFreeWithoutCharge'));
  if (min > 0 && free > 0 && free < min) add('sfFreeDeliveryAbove', t('seller.errStorefrontFreeBelowMin'));

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
