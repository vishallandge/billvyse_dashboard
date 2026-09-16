// ============================================================================
// MODULE COLOURS — one stable hue per part of the shop
// ============================================================================
//
// The owner's ask, holding up a screenshot of a feature grid: "modern dikhe app
// main". What made that grid read as modern was not the drawing — our glyphs are
// the same Phosphor set — it was that every tile wore its OWN colour. A row of
// seven identical grey chips reads as a settings list; seven coloured ones read
// as software.
//
// The reason this is a file and not a `TONES = [...]` array cycled by index — which
// is exactly what QuickActions.js used to have and what was deleted from it — is
// that colour handed out by POSITION carries no information and changes the moment
// somebody reorders the list. Here the mapping is by MEANING, and it is the same
// mapping everywhere the app draws a module: billing is blue on the dashboard, blue
// in the command palette, blue on its own page header. After a week a shopkeeper
// finds the green tile without reading the word under it. That is the whole return
// on this file, and it only pays out if the map never moves.
//
// WHAT THIS IS NOT
//
//   - It is not the accent theme. A shop on the crimson accent still gets a blue
//     billing chip, for the same reason the chart palette ignores the accent
//     (see the VIZ block in globals.css): identity has to survive a theme switch.
//   - It is not status. Red/amber/green on a stat card mean bad/watch/good and are
//     read as a verdict — `icon-danger`, `icon-gold`, `icon-success` still own that
//     job and are untouched. A module tone is a NAME, not a judgement, which is why
//     no tone here is the app's `--danger` or `--success`.
//   - It is not one hue per module. Eight hues across forty screens means families
//     share: everything about buying from a wholesaler is violet, everything about
//     the shelf is green. Two screens the shopkeeper reaches for in the same breath
//     should look related.
//
// Slots are hues, not ranks — `mod-tone-3` is not "more" than `mod-tone-2`. The
// values live in globals.css (`--mod-1` … `--mod-8`), light and dark, each measured
// against its own wash; see the block there.

// The families, in the order the sidebar groups them. A key that is missing from
// every list falls through to the neutral slate, which is the correct answer for
// chrome (Overview, Settings) and a survivable one for anything new.
const TONES = {
  // 1 — BLUE. The counter. Everything that turns goods into a bill.
  1: ['billing', 'estimates', 'invoice', 'recurring', 'counters', 'tables'],
  // 2 — GREEN. The shelf. What the shop owns and what it is worth.
  2: ['inventory', 'products', 'catalog', 'labels', 'centralInventory', 'transfers', 'savings'],
  // 3 — AMBER. Money the shop is OWED, and the customers who owe it. Amber and not
  //     red on purpose: udhaar is not a failure, it is how a kirana trades.
  3: ['khata', 'loyalty', 'memberships', 'customers'],
  // 4 — VIOLET. The other side of the counter: buying, and the people sold to.
  4: ['suppliers', 'supplierLedger', 'purchaseOrders', 'purchaseReturns', 'supply', 'stores'],
  // 5 — PINK. Looking back at it — the shape of the month rather than today's till.
  5: ['reports', 'analytics', 'accounting'],
  // 6 — TEAL. Work booked and people doing it, as opposed to goods.
  6: ['orders', 'appointments', 'jobs', 'myWork', 'staff'],
  // 7 — RUST. Money going OUT, and anything asking for an answer today.
  //
  //     `kitchen` sits here and not with the counter, which is where it belongs by
  //     meaning. A restaurant's strip opens ['tables', 'kitchen', 'billing', ...] and
  //     all three are the counter, so the family rule would have put three identical
  //     blue chips in the first three slots — the exact "seven grey squares" failure
  //     this file exists to fix, just in blue. A KDS ticket is also honestly a thing
  //     shouting for an answer in the next four minutes, which is what rust means
  //     everywhere else here, so the tie breaks cleanly rather than arbitrarily.
  7: ['expenses', 'notifications', 'reminders', 'campaigns', 'offers', 'kitchen'],
  // 8 — INDIGO. The record and the paperwork around the shop itself.
  8: ['daybook', 'refer', 'growth', 'audit', 'usage', 'revenue', 'advice'],
};

const BY_KEY = {};
for (const [slot, keys] of Object.entries(TONES)) {
  for (const key of keys) BY_KEY[key] = Number(slot);
}

/**
 * The class name to hang on an icon chip for `navKey`.
 *
 * Returns a class and never a colour: the value has to stay in CSS or it cannot
 * follow the theme, the scene or the mode, and a hex chosen in JavaScript is the
 * one kind of colour this app's contrast audit can never see.
 */
export function moduleTone(navKey) {
  return `mod-tone-${BY_KEY[navKey] || 0}`;
}

/** The raw slot (0–8), for the rare caller that needs to compare two modules. */
export function moduleToneSlot(navKey) {
  return BY_KEY[navKey] || 0;
}
