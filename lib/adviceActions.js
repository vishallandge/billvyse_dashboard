/**
 * WHAT THE BUTTON SAYS — one verb per piece of advice.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 * The advice screen used to end every card with a button labelled "Open". Forty-two
 * different problems, one word, and that word said nothing about what happened next: a
 * shopkeeper reading "₹4,200 udhaar 38 din se — [Open]" has to decide whether tapping it
 * is going to send a message, show a list, or lose his place.
 *
 * An assistant that offers to do something has to name the something. "Reminder bhejo" is a
 * promise; "Open" is a shrug. The label is also the only thing on the card that says what
 * KIND of work is waiting — one tap versus twenty minutes — and that is most of how a
 * shopkeeper decides which of five jobs to do before the shop fills up.
 *
 * ---------------------------------------------------------------------------
 * The rule these labels obey
 * ---------------------------------------------------------------------------
 * THE VERB DESCRIBES THE SCREEN THAT OPENS, NOT THE OUTCOME WE WANT.
 *
 * `href` in backend/config/advisories.js navigates — it does not perform. So "Reminder
 * bhejo" is honest for a rule whose href is the reminders screen with the composer on it,
 * and would be a lie on one that merely lands on a list where the shopkeeper still has to
 * find the customer. Where the destination is genuinely just a list, the label says so.
 *
 * That is also why nothing here fires an API call. The assistant hands over a screen and
 * stops; the decision, and the doing, stay with the owner. Same posture as the rest of this
 * feature — *"malik ko dikha de, wo decide karega"*.
 *
 * Anything not named here falls back to `advice.act.open`, which is the old "Open" and is
 * the correct answer for a rule whose destination really is just a screen to look at.
 */

/**
 * ruleKey -> the i18n suffix under `advice.act.*`.
 *
 * Grouped in the registry's own order so this file can be read beside
 * backend/config/advisories.js. A rule with no entry is not a mistake — see above.
 */
export const ADVICE_ACTIONS = {
  /* ---------------------------------------------------------------- stuck */
  heldBills: 'finishBill',
  pendingOrders: 'answerOrders',
  paymentClaims: 'checkPayment',
  staleKhata: 'sendReminder',
  khataAging: 'sendReminder',
  unstockedPurchase: 'shelveStock',
  supplierDues: 'openSupplier',
  pendingDebitNotes: 'sendDebitNote',
  coldEstimates: 'followEstimate',
  recurringDue: 'makeBills',
  staffSalaryDue: 'paySalary',
  unbilledAppointments: 'makeBill',
  unbilledJobs: 'makeBill',

  /* --------------------------------------------------------------- profit */
  costRoseKeepPrice: 'fixPrice',
  sellingAtLoss: 'fixPrice',
  noCostPrice: 'addCost',
  discountLeak: 'seeDiscounts',
  expiryLoss: 'seeExpiry',
  expensesEatProfit: 'seeExpenses',

  /* ----------------------------------------------------------------- sell */
  slowMovers: 'seeList',
  deadStock: 'seeList',
  lowStock: 'orderStock',
  expiringSoon: 'seeExpiry',
  outOfStockSelling: 'orderStock',
  reorderDue: 'orderStock',
  atRiskCustomers: 'callCustomers',
  idleLoyaltyPoints: 'seeCustomers',
  catalogNoPhotos: 'addPhotos',
  noUpcomingBookings: 'openBookings',
  manyNoShows: 'openBookings',

  /* ---------------------------------------------------------------- legal */
  gstFilingDue: 'fileGst',
  gstPayable: 'fileGst',
  b2bMissingGstin: 'fixCustomers',
  missingHsn: 'fixProducts',
  billNumberGap: 'openRegister',
  deletedBills: 'openRegister',

  /* ---------------------------------------------------------------- habit */
  backupOld: 'runBackup',
  duplicateCustomers: 'mergeCustomers',
  planExpiring: 'renewPlan',
  noBillsYet: 'openCounter',
  dayNotClosed: 'closeDay',
  attendanceMissing: 'markAttendance',
};

/** The label key for one advisory's primary button. */
export function adviceActionKey(item) {
  return `advice.act.${ADVICE_ACTIONS[item?.key] || 'open'}`;
}

/**
 * Rules whose `href` points back at this very screen.
 *
 * "Slow movers" and "dead stock" ARE the advice page — the registry sends
 * `/seller/advice?focus=slowMovers` so the dashboard's one-line version lands on the list.
 * Read literally that produced a button that navigated to the page you were standing on:
 * the URL changed and nothing moved. Here the button opens the rows instead.
 */
export function isSelfLink(item) {
  return Boolean(item?.href?.startsWith('/seller/advice'));
}
