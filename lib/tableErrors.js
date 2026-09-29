// Every refusal the table screens can get from the server, in the shop's own language.
//
// The server answers in English ("Chair 2 at T4 is already taken"). A waiter reading
// Hindi or Marathi should read the same thing in their language, with the table name and
// the chair number still in it. Each pattern below matches one server message and pulls
// out its parts (table, chair, count…); the translation lives in the language packs under
// `tables.errors.<key>`, with those parts filled in.
//
// A message with no pattern falls back to the server's own words — never to an empty
// toast — and backend/tests/tableErrors.test.js fails the build if a server message is
// ever added without one here. Import-free so that test can load it as-is.

const P = (key, source) => ({ key, re: new RegExp(`^${source}$`) });
const NAME = '(?<table>.+?)';
const OTHER = '(?<other>.+?)';

export const TABLE_ERROR_PATTERNS = [
  // ---- seating ----
  P('tableNotFound', 'Table not found'),
  P('orderNotFound', 'Table order not found'),
  P('noOpenOrder', 'No open order on this table'),
  P('outOfService', `${NAME} is marked out of service`),
  P('takenBy', `${NAME} is already taken by ${OTHER}`),
  P('joinedTo', `${NAME} is joined to ${OTHER} right now`),
  P('hasGuests', `${NAME} already has guests — seat them as a new group`),
  P('alreadyOpen', `${NAME} already has an open order`),
  P('occupied', `${NAME} is currently occupied`),
  P('pushedWith', `${NAME} is pushed together with ${OTHER} — seat the new group at another table`),
  P('maxGroups', `${NAME} already has (?<count>\\d+) groups`),
  P('onlySeatsFree', `Only (?<count>\\d+) seats? free at ${NAME}`),
  P('noSeatsFree', `Every seat at ${NAME} is taken`),
  P('seatTaken', `Chair (?<seat>\\d+) at ${NAME} is already taken`),
  P('noSuchChair', `${NAME} has no chair (?<seat>.+)`),
  P('pickChairs', 'Pick the chairs they are sitting on'),
  P('newGroupHowMany', 'How many people are in the new group\\?'),
  P('sharedCantJoin', 'A group sharing a table cannot push more tables together'),
  P('nameTheTable', 'Give the table a name — T1, (?:Counter|A4)…'),
  P('tableNeedsName', 'A table needs a name'),
  P('invalidGuests', 'Invalid guest count'),
  P('invalidOrderType', 'Invalid order type'),
  P('invalidStatus', 'Invalid order status'),
  P('maxJoin', 'Join at most 10 tables to one party'),
  P('joinDineInOnly', 'Only a dine-in table can have tables joined to it'),
  P('joinWhileShared', 'Another group is sitting at this table — move this group to a free table first, then join tables'),
  P('pickTableToJoin', 'Pick a free table to join'),
  P('notJoined', 'That table is not joined to this one'),
  P('pickReservationTime', 'Pick a valid reservation time'),

  // ---- items & kitchen ----
  P('needItem', 'At least one item is required'),
  P('invalidQuantity', 'Invalid quantity'),
  P('itemNotFound', 'Item not found: .+'),
  P('itemNotOnTable', 'Item not found on this table'),
  P('expired', '(?<name>.+) is expired and cannot be added to the table order\\.'),
  P('kitchenStarted', 'The kitchen has started (?<name>.+) — ask the kitchen to cancel it instead'),
  P('confirmVoid', 'That round is already with the kitchen — confirm the void'),
  P('alreadyAsked', 'Already asked the kitchen to cancel (?<name>.+)'),
  P('madeManagerOnly', '(?<name>.+) is already made — only the owner or a manager can cancel it'),
  P('nothingToSend', 'Nothing new to send — the kitchen has it all'),
  P('nobodyAsked', 'Nobody asked to cancel this dish'),
  P('answerStoppedOrMade', 'Answer stopped or made'),
  P('notSentYet', 'This item has not been sent to the kitchen yet'),
  P('invalidKitchenStatus', 'Invalid kitchen status'),
  P('nothingToMove', 'Nothing to move'),

  // ---- moving, merging, staff ----
  P('transferDineInOnly', 'Only dine-in orders can be transferred to a table'),
  P('pickTableToMove', 'Pick a table to move to'),
  P('alreadyOn', `Already on ${NAME}`),
  P('bothNeedOrders', 'Both tables must have open orders'),
  P('mergeDineInOnly', 'Only dine-in tables can be merged'),
  P('pickMergeTable', 'Pick another table to merge into'),
  P('staffNotFound', 'Staff member not found'),
  P('changedElsewhere', 'This table changed on another device\\. Refresh and try again\\.'),
  P('invalidDetails', 'Invalid table (?:order )?details'),

  // ---- paying ----
  P('needBillId', 'A valid bill ID is required'),
  P('alreadyClosed', 'This table order is already closed'),
  P('pickWhatPaying', 'Pick what this group is paying for'),
  P('itemGone', 'An item on this bill is no longer on the table — refresh and try again'),
  P('onlyLeft', 'Only (?<count>[\\d.]+) × (?<name>.+) left on the table'),
  P('needGroupBill', 'Settle needs the bill this group was billed on'),
  P('needTableBill', 'Settle needs the bill\\(s\\) this table was billed on'),
  P('billOnOtherTable', 'A bill is already linked to another table'),
  P('distinctBills', 'Valid, distinct bill IDs are required to settle a table'),
  P('billAlreadyHere', 'That bill is already recorded on this table'),

  // ---- floor plan ----
  P('nameExists', `${NAME} already exists on this floor`),
  P('nameExistsGeneric', 'A table with that name already exists on this floor'),
  P('renameWhileSeated', `Guests are sitting at ${NAME} — rename it once they have left`),
  P('runningOrder', `${NAME} has a running order — settle or cancel it first`),
  P('hasBooking', `${NAME} has a booking — cancel it first`),
  P('hasHistory', `${NAME} has (?<count>\\d+) past orders? — take it out of service instead, so its bills stay intact`),
  P('whichSection', 'Which section\\?'),
  P('sectionInUse', `Guests are sitting at ${NAME} — wait until (?<zone>.+) is empty`),
  P('pickOtherSection', 'Pick a different section to move the tables into'),
  P('sectionHasHistory', "(?<names>.+) already have bills — move this section's tables into another section instead"),
  P('sectionBooking', 'A table in (?<zone>.+) has a booking — cancel it first'),
  P('numberRange', 'Give a number range — 1 to 10'),
  P('bulkMax', 'Add at most 50 tables at a time'),
  P('nameTheSection', 'Give the section a name'),
  P('chargeRange', 'Section charge must be between 0% and 30%'),
  P('oneChairMin', 'Put at least one chair at the table'),
  P('ownerOnly', 'Only the owner or a manager can change tables and sections\\. Ask the owner to do it\\.'),
];

/** Which pattern (if any) a server message is, and the parts pulled out of it. */
export function matchTableError(message) {
  const text = String(message || '').trim();
  for (const { key, re } of TABLE_ERROR_PATTERNS) {
    const m = re.exec(text);
    if (m) return { key, params: { ...(m.groups || {}) } };
  }
  return null;
}

/**
 * The message to show for a failed table request, in the current language. `t` returns
 * the key itself when a pack has no entry, which is taken as "no translation" — the
 * server's English is still better than a raw key on screen.
 */
export function tableErrorText(error, t) {
  const message = error?.message || String(error || '');
  const hit = matchTableError(message);
  if (!hit || typeof t !== 'function') return message;
  const key = `tables.errors.${hit.key}`;
  const text = t(key, hit.params);
  return text && text !== key ? text : message;
}
