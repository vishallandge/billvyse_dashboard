/**
 * What counts as a valid entry on the Settings screen, and the sentence to show when it
 * isn't — in the shopkeeper's own language.
 *
 * Mirrors backend/utils/shopProfileRules.js. That file is the enforcement; this one is the
 * explanation, and it exists because a refusal that arrives from the server lands as one
 * line at the top of a page eight panels long, with no way to tell which of forty boxes it
 * meant. The two files must change together.
 *
 * The bug that prompted it: FSSAI showed a quiet "that isn't 14 digits" note under the box,
 * saved anyway, and the shop's next bill carried the wrong number in its header. A warning
 * that does not block is not validation — so every rule here refuses the save and points at
 * the field.
 *
 * Blank always passes except for the shop name. These are optional fields, and a rule that
 * fired on an empty box would make clearing one impossible.
 */

import { addressProblem, addressErrorText, partyNameProblem } from './addressRules';

const digits = (value) => String(value ?? '').replace(/\D/g, '');
const text = (value) => String(value ?? '').trim();

export const SHOP_NAME_MIN = 2;

// Same caps as the server, so the character counters on screen agree with what gets stored.
export const TEXT_LIMITS = Object.freeze({
  shopName: 80,
  shopAddress: 200,
  legalName: 100,
  tagline: 80,
  signatoryName: 60,
  jurisdiction: 60,
  bankName: 60,
  bankAccountName: 80,
  bankBranch: 60,
  terms: 600,
  footerNote: 200,
});

export const isValidPincode = (v) => /^[1-9]\d{5}$/.test(text(v));
export const isValidFssai = (v) => /^\d{14}$/.test(digits(v));
export const isValidIfsc = (v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(text(v).toUpperCase());
export const isValidBankAccountNumber = (v) => /^\d{9,18}$/.test(digits(v));
export const isValidInvoicePrefix = (v) => /^[A-Za-z0-9-]{1,10}$/.test(text(v));
export const isLikelyEmail = (v) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(text(v));
// Indian mobile numbers are exactly 10 digits starting 6-9. Mirrors utils/phone.js.
export const isIndianMobile = (v) => /^[6-9]\d{9}$/.test(digits(v).replace(/^(0091|91|0)(?=\d{10}$)/, ''));

/**
 * Every problem on the form, as `{ fieldId, message }`.
 *
 * Returns them all rather than stopping at the first, because a shopkeeper who fixes one
 * box, presses Save, and is told about a second one has been made to do the work twice.
 * `fieldId` is the input's DOM id, which is what lets the screen scroll to it and flash it.
 */
export function validateShopProfile(profile, t) {
  const inv = profile.invoiceProfile || {};
  const problems = [];
  const add = (fieldId, message) => problems.push({ fieldId, message });

  if (text(profile.shopName).length < SHOP_NAME_MIN) add('shopName', t('seller.errShopName'));
  if (text(profile.shopPincode) && !isValidPincode(profile.shopPincode)) add('shopPincode', t('seller.errPincode'));
  /* The address prints on every bill. Its rules live in ./addressRules.js because the server
     enforces the identical file (backend/utils/addressRules.js) — this only turns the code
     that comes back into a sentence, and names the box to flash. `shopAddress` is the id of
     the PIN box inside the address field, which is where the eye should land. */
  {
    const addr = addressProblem(profile.shopAddress, { maxLength: TEXT_LIMITS.shopAddress });
    if (addr) add('shopAddress', addressErrorText(addr.code, t));
  }
  if (text(profile.shopPhone) && !isIndianMobile(profile.shopPhone)) add('shopPhone', t('seller.errPhone'));
  if (text(profile.shopEmail) && !isLikelyEmail(profile.shopEmail)) add('shopEmail', t('seller.errEmail'));
  if (text(profile.fssaiNumber) && !isValidFssai(profile.fssaiNumber)) add('fssaiNumber', t('seller.errFssai'));
  if (text(inv.bankIfsc) && !isValidIfsc(inv.bankIfsc)) add('bankIfsc', t('seller.errIfsc'));
  if (text(inv.bankAccountNumber) && !isValidBankAccountNumber(inv.bankAccountNumber)) {
    add('bankAccountNumber', t('seller.errAccountNumber'));
  }
  if (text(inv.prefix) && !isValidInvoicePrefix(inv.prefix)) add('prefix', t('seller.errInvoicePrefix'));
  {
    // The name printed at the top of every bill — same rule the API refuses it with.
    const legal = partyNameProblem(inv.legalName);
    if (legal) add('legalName', addressErrorText(legal, t));
  }

  return problems;
}
