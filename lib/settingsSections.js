/**
 * The map of the Settings screen — what is on it, and what each part is called.
 *
 * Settings had grown to eleven panels and about eighty controls under one long scroll, with
 * no index and no way to search. The observable result was that shopkeepers could not find
 * settings they had already been shown once: "GST wala box kahan tha" is a support question
 * this app was generating for itself. A page that long is not a form, it is a filing
 * cabinet, and a filing cabinet needs labels on the drawers.
 *
 * So this file is the index. It drives three things at once, which is the whole reason it is
 * a data structure rather than markup:
 *
 *   1. The section rail — jump straight to a drawer.
 *   2. The search box — type "gst", "delivery", "password" and only the panels that hold
 *      those controls stay on screen.
 *   3. The rail's own relevance. A kirana does not have metal rates and never will, so the
 *      list is filtered by the same `when` predicate that decides whether the panel renders.
 *
 * `terms` is deliberately generous and deliberately BILINGUAL-BY-KEY: every entry is an i18n
 * key, so a shop running the app in Marathi searches in Marathi and finds the same panel.
 * The raw English words in `aliases` are on top of that, not instead of it — a shopkeeper who
 * has only ever heard the English word "GSTIN" must find it whatever language the UI is in.
 */

export const SETTINGS_SECTIONS = [
  {
    id: 'appearance',
    icon: 'sparkle',
    labelKey: 'seller.appLook',
    hintKey: 'seller.appLookHint',
    terms: [
      'seller.appLook', 'seller.sceneLabel', 'seller.accentLabel', 'seller.themeModeLabel',
      'seller.motionLabel', 'seller.textSizeLabel', 'seller.densityLabel',
    ],
    // Scene names are searchable by name as well as by concept: somebody who saw
    // "Kagaz" once and wants it back will type that word, not "look".
    aliases: [
      'theme colour color dark light mode font size zoom animation motion density display',
      'scene look feel aurora noir kagaz mehfil prism classic glass paper velvet gold invoice billing clean',
    ],
  },
  {
    id: 'screens',
    icon: 'grid',
    labelKey: 'seller.screensTitle',
    hintKey: 'seller.screensHint',
    terms: ['seller.screensTitle', 'seller.screensHint'],
    aliases: ['menu sidebar nav navigation hide show screens modules'],
  },
  {
    id: 'notifications',
    icon: 'bell',
    labelKey: 'seller.pushTitle',
    hintKey: 'seller.pushHint',
    terms: ['seller.pushTitle', 'seller.pushEventsLabel', 'seller.pushDigestLabel', 'seller.pushEveningLabel'],
    aliases: ['push alert notification phone reminder digest summary device'],
  },
  {
    id: 'identity',
    icon: 'shop',
    labelKey: 'seller.shopIdentity',
    hintKey: 'seller.shopIdentityHint',
    terms: [
      'seller.shopName', 'seller.legalName', 'seller.tagline', 'seller.shopAddress',
      'register.businessType', 'seller.pincode', 'seller.shopPhone', 'seller.shopEmail',
    ],
    aliases: ['shop name address business type trade pincode phone email legal tagline rename'],
  },
  {
    id: 'storefront',
    icon: 'orders',
    labelKey: 'seller.storefrontTitle',
    hintKey: 'seller.storefrontHint',
    terms: [
      'seller.storefrontTitle', 'seller.sfAcceptingOrders', 'seller.sfMinOrderValue',
      'seller.sfDeliveryCharge', 'seller.sfFreeDeliveryAbove', 'seller.sfPrepTime',
      'seller.sfOpenTime', 'seller.sfCloseTime', 'seller.sfWeeklyOff',
      'seller.deliveryRadiusKm', 'seller.captureShopLocation',
    ],
    aliases: ['online order storefront delivery pickup charge minimum timing hours closed holiday pause radius location shop open close'],
  },
  {
    id: 'tax',
    icon: 'shield',
    labelKey: 'seller.taxCompliance',
    hintKey: 'seller.taxComplianceHint',
    terms: ['seller.gstin', 'seller.state', 'seller.fssai', 'seller.compositionTitle', 'seller.compositionRate'],
    aliases: ['gst gstin tax composition fssai licence license state hsn registration'],
  },
  {
    id: 'rates',
    icon: 'tag',
    labelKey: 'seller.metalRatesTitle',
    hintKey: 'seller.metalRatesHint',
    // Jewellery only, and shown to anyone who has ever set a rate — a shop that switched
    // trade must still be able to see and clear the numbers it left behind.
    when: (profile) => profile.businessType === 'jewellery' || Boolean(profile.metalRates?.updatedAt),
    terms: ['seller.rateGold24', 'seller.rateGold22', 'seller.rateGold18', 'seller.rateSilver'],
    aliases: ['gold silver rate metal bhav jewellery tola gram'],
  },
  {
    id: 'billing',
    icon: 'sliders',
    labelKey: 'seller.billingPrefs',
    hintKey: 'seller.billingPrefsHint',
    terms: [
      'seller.confirmBeforeBill', 'seller.setRoundOff', 'seller.setAllowNegativeStock',
      'seller.setBlockBelowCost', 'seller.setShowProfitAtCounter',
      'seller.setStaffDiscountCap', 'seller.setExpiryWarningDays',
    ],
    aliases: ['counter billing round off negative stock discount cap staff profit expiry warning confirm'],
  },
  {
    id: 'payment',
    icon: 'card',
    labelKey: 'seller.paymentDetails',
    hintKey: 'seller.paymentDetailsHint',
    terms: [
      'seller.upiId', 'seller.bankName', 'seller.bankAccountName',
      'seller.bankAccountNumber', 'seller.bankIfsc', 'seller.bankBranch',
    ],
    aliases: ['upi vpa bank account ifsc branch payment payout money qr'],
  },
  {
    id: 'invoice',
    icon: 'printer',
    labelKey: 'seller.invoiceLook',
    hintKey: 'seller.invoiceLookHint',
    terms: [
      'seller.invoiceTemplate', 'seller.invoiceAccent', 'seller.invoicePaper',
      'seller.invoiceLang', 'seller.invoiceDensity', 'seller.invoicePrefix',
      'seller.signatoryName', 'seller.jurisdiction', 'seller.invoiceLogo',
      'seller.invoiceSignatureImage', 'seller.invoiceTerms', 'seller.invoiceFooterNote',
      'seller.invoiceStamp', 'seller.invoiceWatermark', 'seller.invoiceAppCredit',
    ],
    aliases: ['invoice bill print template paper thermal a4 a5 logo signature stamp terms footer prefix watermark branding letterhead'],
  },
  {
    id: 'security',
    icon: 'lock',
    labelKey: 'seller.securityTitle',
    hintKey: 'seller.securityHint',
    terms: [
      'seller.securityTitle', 'seller.secChangePassword', 'seller.secSignOutAll',
      'seller.secEmail', 'seller.secSignInMethod', 'seller.secLastLogin',
    ],
    aliases: [
      'password security login account sign out devices google email verify session',
      // "Account band karna" is what a shopkeeper types when they want out, and they type it
      // in Settings' search box rather than scrolling to the bottom of the security panel.
      'delete close account remove data band karna dukaan mitao deactivate quit leave',
    ],
  },
  {
    id: 'data',
    icon: 'shield',
    labelKey: 'seller.dataTitle',
    hintKey: 'seller.dataHint',
    terms: ['seller.dataTitle', 'seller.dataBackupLink', 'seller.dataExportLink', 'seller.dataPrivacyLink'],
    aliases: ['backup restore export download data drive google privacy delete account'],
  },
];

/**
 * Which sections this shop actually has, in page order.
 *
 * A rail that lists a drawer the page does not contain is worse than no rail: it sends
 * somebody scrolling for something that was never there.
 */
export function visibleSections(profile) {
  return SETTINGS_SECTIONS.filter((section) => !section.when || section.when(profile || {}));
}

/**
 * Does this section answer what was typed?
 *
 * Matched on translated labels plus the English aliases, so "gst", "जीएसटी" and "tax" all
 * land on the same panel. Deliberately a plain substring test rather than a fuzzy score:
 * this list is twelve items long, and a clever matcher on twelve items only ever surprises
 * people by finding the wrong one.
 */
export function sectionMatches(section, query, t) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    t(section.labelKey),
    section.hintKey ? t(section.hintKey) : '',
    ...(section.terms || []).map((key) => t(key)),
    ...(section.aliases || []),
    section.id,
  ]
    .join(' ')
    .toLowerCase();
  // Every word has to appear somewhere — "gst rate" should not match a panel that only
  // knows "rate", which is how a search box starts feeling random.
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}
