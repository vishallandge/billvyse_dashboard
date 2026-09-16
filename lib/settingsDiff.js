import { businessTypeOptions } from './businessTypes';
import { WEEKDAY_KEYS } from './storefrontRules';
import {
  INVOICE_TEMPLATES,
  INVOICE_THEMES,
  INVOICE_PAPERS,
  INVOICE_LANGUAGES,
  INVOICE_DENSITIES,
} from './invoiceLabels';

/**
 * What is about to change on the Settings page, in words a shopkeeper recognises.
 *
 * The Settings form is about six hundred lines of fields under one Save button at the very
 * bottom, and two things went wrong with that — the same thing twice. After renaming the shop
 * at the top, the shopkeeper had to scroll past every invoice toggle in the app to reach the
 * button. Then the "Settings saved" banner appeared at the top, where he no longer was. So the
 * page could be edited and saved without ever once showing him that it had worked.
 *
 * The floating bar (components/SaveBar.js) fixes the reach. This file is what makes the bar
 * worth reading: a bar that only ever says "you have unsaved changes" is a nag, and there is
 * nothing the shopkeeper can check it against. Naming WHICH settings changed, and from what to
 * what, turns a prompt into a receipt — and on this page in particular, where one of these rows
 * can move where his customers' UPI money lands or switch off his prescription register, it is
 * the last chance to catch a mis-tap.
 *
 * Kept pure and React-free so the rule can be read and run on its own: it takes the two profile
 * objects and a `t`, and returns rows. No component, no hook, no fetch.
 */

/* --------------------------------------------------------------- value formatting ----- */

// The value the shopkeeper sees on the page, not the value we store. `theme: 'plum'` means
// nothing to him; "Plum" does. And an empty field has to SAY it is empty rather than render as
// a gap the eye slides straight over.
const NAMED = {
  template: (id) => INVOICE_TEMPLATES.find((x) => x.id === id)?.name,
  theme: (id) => INVOICE_THEMES.find((x) => x.id === id)?.name,
  paper: (id) => INVOICE_PAPERS.find((x) => x.id === id)?.name,
  docLang: (id) => INVOICE_LANGUAGES.find((x) => x.id === id)?.native,
  density: (id) => INVOICE_DENSITIES.find((x) => x.id === id)?.name,
};

function formatValue(value, { kind, key, t }) {
  if (kind === 'bool') return value ? t('seller.changeOn') : t('seller.changeOff');
  // An image is never worth printing as forty kilobytes of base64 — the only readable fact
  // about it is whether there is one.
  if (kind === 'image') return value ? t('seller.changeImageSet') : t('seller.changeImageNone');
  if (kind === 'location') {
    return value ? `${Number(value.lat).toFixed(4)}, ${Number(value.lng).toFixed(4)}` : t('seller.changeNotSet');
  }
  if (value === null || value === undefined || value === '') return t('seller.changeNotSet');
  if (kind === 'bankAccount') return `\u2022\u2022\u2022\u2022 ${String(value).slice(-4)}`;
  if (kind === 'named') return NAMED[key]?.(value) || String(value);
  if (kind === 'businessType') {
    const option = businessTypeOptions(t).find((x) => x.key === value);
    return option ? option.label : t('seller.businessTypeUnset');
  }
  if (kind === 'percent') return `${value}%`;
  if (kind === 'days') return t('seller.changeDays', { count: value });
  // A bare "40" in a change list about a delivery charge is the one number a shopkeeper
  // must not have to guess the unit of.
  if (kind === 'money') return `₹${Number(value).toLocaleString('en-IN')}`;
  if (kind === 'minutes') return t('seller.changeMinutes', { count: value });
  if (kind === 'clock') return String(value);
  if (kind === 'when') {
    const at = new Date(value);
    return Number.isNaN(at.getTime())
      ? t('seller.changeNotSet')
      : at.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  // Named days, in week order, not "[0,3]". The whole point of this list is that somebody
  // reads it back and recognises his own shop in it.
  if (kind === 'weekdays') {
    const days = Array.isArray(value) ? [...value].sort((a, b) => a - b) : [];
    if (!days.length) return t('seller.changeNoWeeklyOff');
    return days.map((day) => t(`seller.day_${WEEKDAY_KEYS[day]}`)).join(', ');
  }
  if (kind === 'outsideHours') {
    return value === 'block' ? t('seller.sfOutsideBlock') : t('seller.sfOutsideAccept');
  }
  return String(value);
}

/* --------------------------------------------------------------------- the fields ----- */

/**
 * Every field the form can change, carrying the label the form itself already uses.
 *
 * Deliberately the same `t()` keys as the inputs above them. A change list that invents its own
 * wording for a field is a list the shopkeeper has to translate back to the row he just edited,
 * and the first time the two drift the summary is quietly lying to him.
 *
 * `section` groups the review. `weight: 'heavy'` marks the four rows that do something bigger
 * than change how a bill looks — they move money, change what the shop legally is, or switch a
 * whole trade's screens on and off. Those are said louder (see heavyWarningKey).
 */
const FIELDS = [
  // ---- who the shop is
  { path: 'shopName', label: 'seller.shopName', section: 'identity' },
  { path: 'shopAddress', label: 'seller.shopAddress', section: 'identity' },
  { path: 'businessType', label: 'register.businessType', section: 'identity', kind: 'businessType', weight: 'heavy' },
  { path: 'shopPincode', label: 'seller.pincode', section: 'identity' },
  { path: 'shopPhone', label: 'seller.shopPhone', section: 'identity' },
  { path: 'shopEmail', label: 'seller.shopEmail', section: 'identity' },
  { path: 'invoiceProfile.legalName', label: 'seller.legalName', section: 'identity' },
  { path: 'invoiceProfile.tagline', label: 'seller.tagline', section: 'identity' },

  // ---- the online counter
  //
  // `acceptingOrders` is marked heavy for the same reason `upiId` is: it is not a preference
  // about how something looks, it is the shop's storefront going dark. A shopkeeper who
  // switched it off to fix a price and then saved something else an hour later should be
  // told, in the review, that his online counter is still shut.
  { path: 'storefront.acceptingOrders', label: 'seller.sfAcceptingOrders', section: 'storefront', kind: 'bool', weight: 'heavy' },
  { path: 'storefront.pausedUntil', label: 'seller.sfPausedUntil', section: 'storefront', kind: 'when' },
  { path: 'storefront.pauseNote', label: 'seller.sfPauseNote', section: 'storefront' },
  { path: 'storefront.allowDelivery', label: 'seller.sfAllowDelivery', section: 'storefront', kind: 'bool' },
  { path: 'storefront.allowPickup', label: 'seller.sfAllowPickup', section: 'storefront', kind: 'bool' },
  { path: 'storefront.minOrderValue', label: 'seller.sfMinOrderValue', section: 'storefront', kind: 'money' },
  { path: 'storefront.deliveryCharge', label: 'seller.sfDeliveryCharge', section: 'storefront', kind: 'money' },
  { path: 'storefront.freeDeliveryAbove', label: 'seller.sfFreeDeliveryAbove', section: 'storefront', kind: 'money' },
  { path: 'storefront.prepTimeMinutes', label: 'seller.sfPrepTime', section: 'storefront', kind: 'minutes' },
  { path: 'storefront.openTime', label: 'seller.sfOpenTime', section: 'storefront', kind: 'clock' },
  { path: 'storefront.closeTime', label: 'seller.sfCloseTime', section: 'storefront', kind: 'clock' },
  { path: 'storefront.weeklyOffDays', label: 'seller.sfWeeklyOff', section: 'storefront', kind: 'weekdays' },
  { path: 'storefront.outsideHours', label: 'seller.sfOutsideHours', section: 'storefront', kind: 'outsideHours' },
  { path: 'deliveryRadiusKm', label: 'seller.deliveryRadiusKm', section: 'storefront' },
  { path: 'shopLocation', label: 'seller.captureShopLocation', section: 'storefront', kind: 'location' },

  // ---- what it owes the government
  { path: 'gstin', label: 'seller.gstin', section: 'tax', weight: 'heavy' },
  { path: 'shopState', label: 'seller.state', section: 'tax' },
  { path: 'fssaiNumber', label: 'seller.fssai', section: 'tax' },
  { path: 'isComposition', label: 'seller.compositionTitle', section: 'tax', kind: 'bool', weight: 'heavy' },
  { path: 'compositionRate', label: 'seller.compositionRate', section: 'tax', kind: 'percent' },

  // ---- the jeweller's morning
  { path: 'metalRates.gold24', label: 'seller.rateGold24', section: 'rates' },
  { path: 'metalRates.gold22', label: 'seller.rateGold22', section: 'rates' },
  { path: 'metalRates.gold18', label: 'seller.rateGold18', section: 'rates' },
  { path: 'metalRates.silver', label: 'seller.rateSilver', section: 'rates' },

  // ---- how the counter behaves
  { path: 'confirmBeforeBill', label: 'seller.confirmBeforeBill', section: 'billing', kind: 'bool' },
  { path: 'billingSettings.roundOff', label: 'seller.setRoundOff', section: 'billing', kind: 'bool' },
  { path: 'billingSettings.allowNegativeStock', label: 'seller.setAllowNegativeStock', section: 'billing', kind: 'bool' },
  { path: 'billingSettings.blockBelowCostSale', label: 'seller.setBlockBelowCost', section: 'billing', kind: 'bool' },
  { path: 'billingSettings.showProfitAtCounter', label: 'seller.setShowProfitAtCounter', section: 'billing', kind: 'bool' },
  { path: 'billingSettings.maxStaffDiscountPercent', label: 'seller.setStaffDiscountCap', section: 'billing', kind: 'percent' },
  { path: 'billingSettings.expiryWarningDays', label: 'seller.setExpiryWarningDays', section: 'billing', kind: 'days' },
  // The scale sticker. Only the switch is listed: the three layout numbers underneath it
  // are meaningless read out one at a time ("item digits 5 → 6" tells nobody anything),
  // and they never move on their own — learning a sticker changes all three together, and
  // this line is what says that happened.
  { path: 'billingSettings.scaleBarcode.enabled', label: 'seller.scaleStickerTitle', section: 'billing', kind: 'bool' },

  // ---- where the money lands
  { path: 'upiId', label: 'seller.upiId', section: 'payment', weight: 'heavy' },
  { path: 'invoiceProfile.bankName', label: 'seller.bankName', section: 'payment' },
  { path: 'invoiceProfile.bankAccountName', label: 'seller.bankAccountName', section: 'payment' },
  { path: 'invoiceProfile.bankAccountNumber', label: 'seller.bankAccountNumber', section: 'payment', kind: 'bankAccount', weight: 'heavy' },
  { path: 'invoiceProfile.bankIfsc', label: 'seller.bankIfsc', section: 'payment' },
  { path: 'invoiceProfile.bankBranch', label: 'seller.bankBranch', section: 'payment' },

  // ---- the bill's face
  { path: 'invoiceProfile.template', label: 'seller.invoiceTemplate', section: 'invoice', kind: 'named' },
  { path: 'invoiceProfile.theme', label: 'seller.invoiceAccent', section: 'invoice', kind: 'named' },
  { path: 'invoiceProfile.paper', label: 'seller.invoicePaper', section: 'invoice', kind: 'named' },
  { path: 'invoiceProfile.docLang', label: 'seller.invoiceLang', section: 'invoice', kind: 'named' },
  { path: 'invoiceProfile.density', label: 'seller.invoiceDensity', section: 'invoice', kind: 'named' },
  { path: 'invoiceProfile.prefix', label: 'seller.invoicePrefix', section: 'invoice' },
  { path: 'invoiceProfile.signatoryName', label: 'seller.signatoryName', section: 'invoice' },
  { path: 'invoiceProfile.jurisdiction', label: 'seller.jurisdiction', section: 'invoice' },
  { path: 'invoiceProfile.logoUrl', label: 'seller.invoiceLogo', section: 'invoice', kind: 'image' },
  { path: 'invoiceProfile.signatureUrl', label: 'seller.invoiceSignatureImage', section: 'invoice', kind: 'image' },
  { path: 'invoiceProfile.terms', label: 'seller.invoiceTerms', section: 'invoice' },
  { path: 'invoiceProfile.footerNote', label: 'seller.invoiceFooterNote', section: 'invoice' },
  { path: 'invoiceProfile.showStamp', label: 'seller.invoiceStamp', section: 'invoice', kind: 'bool' },
  { path: 'invoiceProfile.showSignature', label: 'seller.invoiceSignature', section: 'invoice', kind: 'bool' },
  { path: 'invoiceProfile.showBankDetails', label: 'seller.invoiceBank', section: 'invoice', kind: 'bool' },
  { path: 'invoiceProfile.showUpiQr', label: 'seller.invoiceUpiQr', section: 'invoice', kind: 'bool' },
  { path: 'invoiceProfile.showWatermark', label: 'seller.invoiceWatermark', section: 'invoice', kind: 'bool' },
  { path: 'invoiceProfile.showMrp', label: 'seller.invoiceMrpColumn', section: 'invoice', kind: 'bool' },
  { path: 'invoiceProfile.showBatch', label: 'seller.invoiceBatchColumn', section: 'invoice', kind: 'bool' },
  { path: 'invoiceProfile.showSavings', label: 'seller.invoiceSavings', section: 'invoice', kind: 'bool' },
  { path: 'invoiceProfile.showOutstanding', label: 'seller.invoiceOutstanding', section: 'invoice', kind: 'bool' },
  { path: 'invoiceProfile.inkSaver', label: 'seller.invoiceInkSaver', section: 'invoice', kind: 'bool' },
  { path: 'invoiceProfile.showAppCredit', label: 'seller.invoiceAppCredit', section: 'invoice', kind: 'bool' },
];

function read(object, path) {
  return path.split('.').reduce((value, part) => (value === null || value === undefined ? value : value[part]), object);
}

/**
 * Is this the same answer, allowing for the several ways a form says "nothing"?
 *
 * A text input hands back `''` where the server sent `null`. A number input hands back the
 * string `'30'` where the server sent `30`. A checkbox nobody has touched is `undefined` on one
 * side and `false` on the other. Comparing those strictly would light the save bar up on a page
 * nobody has edited, which is the fastest possible way to teach a shopkeeper to ignore it.
 */
function same(a, b, kind) {
  if (kind === 'bool') return Boolean(a) === Boolean(b);
  // Order is not part of the answer — [0,3] and [3,0] are the same two days off, and a
  // stringify comparison would light the save bar up on a page nobody had edited.
  if (kind === 'weekdays') {
    const left = [...(a || [])].map(Number).sort((x, y) => x - y).join(',');
    const right = [...(b || [])].map(Number).sort((x, y) => x - y).join(',');
    return left === right;
  }
  // Two ways of writing the same instant, and one way of writing "never". The form hands
  // back an ISO string; the server may send one with a different millisecond precision.
  if (kind === 'when') {
    const left = a ? new Date(a).getTime() : 0;
    const right = b ? new Date(b).getTime() : 0;
    return left === right;
  }
  if (kind === 'location') {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return Number(a.lat) === Number(b.lat) && Number(a.lng) === Number(b.lng);
  }
  if (kind === 'bankAccount') return String(a || '') === String(b || '');
  const left = a === null || a === undefined ? '' : a;
  const right = b === null || b === undefined ? '' : b;
  // Numbers typed into a text box arrive as strings; '30' and 30 are the same setting. Guarded
  // on both being non-empty, because Number('') is 0 and would call a cleared field unchanged.
  if (left !== '' && right !== '' && !Number.isNaN(Number(left)) && !Number.isNaN(Number(right))) {
    return Number(left) === Number(right);
  }
  return String(left) === String(right);
}

/**
 * The rows to show.
 *
 * Order follows the page rather than the order things were edited, so the list reads
 * top-to-bottom like the form he just scrolled through.
 */
export function diffSettings(baseline, current, t) {
  if (!baseline || !current) return [];
  const rows = [];

  for (const field of FIELDS) {
    const from = read(baseline, field.path);
    const to = read(current, field.path);
    if (same(from, to, field.kind)) continue;
    const key = field.path.split('.').pop();
    rows.push({
      path: field.path,
      section: field.section,
      weight: field.weight || 'normal',
      label: t(field.label),
      from: field.kind === 'bankAccount' && !from && baseline.invoiceProfile?.bankAccountMasked ? baseline.invoiceProfile.bankAccountMasked : formatValue(from, { kind: field.kind, key, t }),
      to: formatValue(to, { kind: field.kind, key, t }),
      // The unformatted value as well as the sentence. `heavyWarningKey` has to be able to
      // ask which WAY a switch moved — "storefront off" is a warning, "storefront on" is
      // not — and it cannot ask that of a translated string.
      toRaw: field.kind === 'bool' ? Boolean(to) : field.kind === 'bankAccount' ? undefined : to,
    });
  }

  return rows;
}

/**
 * The one-line warning above the list, or nothing at all.
 *
 * Only for the rows that do something a shopkeeper would not guess from the field's name:
 * changing the trade takes screens away, changing the UPI id moves where his customers' money
 * lands, and the tax rows change every bill he writes from tomorrow. Everything else on this
 * page is a preference, and warning about preferences is exactly how a warning stops being read.
 *
 * One at a time, worst first — three stacked callouts is a wall, and a wall gets dismissed.
 */
export function heavyWarningKey(rows) {
  if (rows.some((row) => row.path === 'upiId')) return 'seller.changeWarnUpi';
  if (rows.some((row) => row.path === 'businessType')) return 'seller.changeWarnBusinessType';
  if (rows.some((row) => row.path === 'gstin' || row.path === 'isComposition')) return 'seller.changeWarnTax';
  // Only for switching the storefront OFF. Turning it back on needs no warning at all —
  // that is the shop returning to normal, and a caution over good news is how a caution
  // stops being read.
  if (rows.some((row) => row.path === 'storefront.acceptingOrders' && row.toRaw === false)) {
    return 'seller.changeWarnStorefrontOff';
  }
  return null;
}
