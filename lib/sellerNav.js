/**
 * The seller sidebar's items, and the two questions other screens ask of them.
 *
 * Lived inline in app/seller/layout.js until the support shortcut needed to know "which
 * module is this page" — a layout file cannot safely export anything but its component, so
 * the list moved here and the layout imports it. Order and grouping are still decided by
 * NAV_GROUPS in DashboardShell; this is only the href/key/permission table.
 */
export const SELLER_NAV_ITEMS = [
  { href: '/seller', key: 'overview' },
  { href: '/seller/notifications', key: 'notifications', staffVisible: true },
  // The Smart Reminder Centre. staffVisible and behind no permission: a reminder is written
  // for whoever is standing at the counter when it comes due, and that is usually not the
  // owner. What a staff login can SEE inside a derived reminder is governed where it is
  // governed everywhere else — the alert computation itself — not by hiding this row.
  { href: '/seller/reminders', key: 'reminders', staffVisible: true },
  // "Do This Today" — the whole advice list (backend/config/advisories.js). No staffVisible: it
  // puts cost prices, supplier dues, staff salary and the shop's GST position on one
  // screen, and the server refuses a staff token anyway (sellerRoutes.js), so showing the
  // row to a cashier would only ever be a dead end.
  { href: '/seller/advice', key: 'advice' },
  { href: '/seller/products', key: 'inventory', staffVisible: true, permission: 'inventory' },
  // "Paisa Bachao" — the same shelf, read as money. No staffVisible: two of its three
  // sections are built out of cost prices, and the server refuses a staff token anyway
  // (sellerRoutes.js), so showing the row to a cashier would only ever be a dead end.
  { href: '/seller/savings', key: 'savings' },
  { href: '/seller/labels', key: 'labels' },
  { href: '/seller/billing', key: 'billing', staffVisible: true, permission: 'billing' },
  // The restaurant floor rides the billing permission — a waiter taking orders is taking
  // something that becomes a bill, and a two-person dhaba would never set up a waiter role.
  { href: '/seller/tables', key: 'tables', staffVisible: true, permission: 'billing' },
  { href: '/seller/kitchen', key: 'kitchen', staffVisible: true, permission: 'billing' },
  { href: '/seller/counters', key: 'counters', staffVisible: true, permission: 'billing' },
  // Quotations ride the billing permission for the same reason the floor does: a quote is
  // what a counter gives before there is a sale, and it is the same cart either way.
  { href: '/seller/estimates', key: 'estimates', staffVisible: true, permission: 'billing' },
  // Repeating bills. Same permission and the same reasoning as the two above — it is the
  // counter's cart, given on a schedule instead of at a till. Writing a schedule is still
  // owner-only, but that is enforced on the server (recurringInvoiceRoutes.js), not by
  // hiding the screen: a cashier has to be able to see and run what is already due.
  { href: '/seller/recurring', key: 'recurring', staffVisible: true, permission: 'billing' },
  // Every credit note the shop has issued. Rides the billing permission because it is
  // the counter's own paperwork — the person who took the goods back is the person a
  // customer asks about the note a week later.
  { href: '/seller/credit-notes', key: 'creditNotes', staffVisible: true, permission: 'billing' },
  { href: '/seller/appointments', key: 'appointments', staffVisible: true, permission: 'appointments' },
  { href: '/seller/jobs', key: 'jobs', staffVisible: true, permission: 'appointments' },
  { href: '/seller/memberships', key: 'memberships', staffVisible: true, permission: 'appointments' },
  { href: '/seller/khata', key: 'khata', staffVisible: true, permission: 'khata' },
  { href: '/seller/expenses', key: 'expenses', staffVisible: true, permission: 'expenses' },
  { href: '/seller/daybook', key: 'daybook', staffVisible: true, permission: 'expenses' },
  { href: '/seller/orders', key: 'orders', staffVisible: true, permission: 'orders' },
  { href: '/seller/catalog', key: 'catalog' },
  { href: '/seller/suppliers', key: 'suppliers', staffVisible: true, permission: 'suppliers' },
  { href: '/seller/suppliers/ledger', key: 'supplierLedger', staffVisible: true, permission: 'suppliers' },
  { href: '/seller/purchase-orders', key: 'purchaseOrders', staffVisible: true, permission: 'purchases' },
  { href: '/seller/purchase-returns', key: 'purchaseReturns', staffVisible: true, permission: 'purchases' },
  // The other direction of the same relationship: orders OTHER shops have sent to THIS one,
  // for an owner who is also somebody's wholesaler. No staffVisible — it opens his identity
  // as a supplier and other shops' rates and balances, which is nothing to do with the dukaan
  // a counter boy works at.
  { href: '/seller/supply', key: 'supply' },
  { href: '/seller/loyalty', key: 'loyalty' },
  // Deciding what the shop gives away is the owner's call, so no staffVisible — a cashier
  // who could create a "buy 1 get 1" could hand the shelf to a friend. The counter still
  // *applies* them, it just cannot write them.
  { href: '/seller/offers', key: 'offers' },
  // Same rule and the same reason: this screen sends the shop's own words to every customer
  // whose number it has, and there is no taking that back off their phones.
  { href: '/seller/campaigns', key: 'campaigns' },
  { href: '/seller/stores', key: 'stores' },
  { href: '/seller/stores/central', key: 'centralInventory' },
  { href: '/seller/stores/transfer', key: 'transfers' },
  { href: '/seller/staff', key: 'staff' },
  // The mirror of the line above, for the person on the other side of it: their own
  // attendance and their own pagaar. staffOnly, because an owner reading it would just be
  // reading a worse copy of the Staff screen they already have.
  { href: '/seller/my-work', key: 'myWork', staffOnly: true },
  // Both open to a BRANCH MANAGER — staff carrying the `reports` permission — and to nobody
  // else on the counter. What they get back is pinned to their own branch by the server
  // (branchScope in middleware/auth.js), not by hiding anything here.
  { href: '/seller/analytics', key: 'analytics', staffVisible: true, permission: 'reports' },
  { href: '/seller/reports', key: 'reports', staffVisible: true, permission: 'reports' },
  // Its own entry rather than a tab inside Reports: this is the screen a shopkeeper opens
  // once a month with their CA on the phone, and nobody finds it by browsing a list of
  // nineteen reports.
  //
  // Visible to a munshi too — keeping the books IS their job, and the accountant preset
  // grants `expenses`. The other reports stay owner-only (see reportRoutes.js).
  { href: '/seller/accounting', key: 'accounting', staffVisible: true, permission: 'expenses' },
  { href: '/seller/backup', key: 'backup' },
  // Refer & Earn. No staffVisible, and the reason is the same one that keeps Plan off a
  // cashier's menu: the balance on that screen turns into free plan days and, where the
  // operator allows it, into a UPI transfer. It is the owner's money.
  //
  // The server hides this key entirely (via hiddenNav) whenever the operator has not
  // switched the programme on for sellers — see backend/middleware/modules.js. It is not a
  // plan lock, so it never appears behind a padlock either: there is nothing a shop could
  // buy that would open it.
  { href: '/seller/refer', key: 'refer' },
  { href: '/seller/plan', key: 'plan' },
  { href: '/seller/settings', key: 'settings' },
  // The shop's side of Admin -> Support: every question it sent and every answer. staffVisible
  // because staff write in too; the server shows a staff login only the tickets it wrote.
  { href: '/seller/support', key: 'support', staffVisible: true },
];

/**
 * The nav item a pathname belongs to — the longest href that prefixes it, so
 * /seller/suppliers/ledger is Supplier Ledger and not Suppliers. The bare dashboard root
 * (/seller) only matches itself, or every page would be "Overview".
 */
export function navItemForPath(items, pathname) {
  if (!pathname) return null;
  let best = null;
  for (const item of items || []) {
    const exact = pathname === item.href;
    const nested = item.href !== '/seller' && item.href !== '/admin' && pathname.startsWith(`${item.href}/`);
    if ((exact || nested) && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

/**
 * Which support topic a module's question most likely is — preselected when the shopkeeper
 * asks from that screen, so the operator's queue is already sorted before anyone reads it.
 * A module with no obvious bucket gets none, and the shopkeeper picks.
 */
const TOPIC_FOR_NAV = {
  billing: 'billing', tables: 'billing', kitchen: 'billing', counters: 'billing', estimates: 'billing',
  recurring: 'billing', creditNotes: 'billing', orders: 'billing',
  inventory: 'stock', savings: 'stock', labels: 'stock', centralInventory: 'stock', transfers: 'stock',
  khata: 'khata',
  suppliers: 'purchase', supplierLedger: 'purchase', purchaseOrders: 'purchase', purchaseReturns: 'purchase', supply: 'purchase',
  plan: 'plan', refer: 'plan',
  backup: 'data', reports: 'data', accounting: 'data', daybook: 'data', expenses: 'data',
};

export function supportTopicForNav(key) {
  return TOPIC_FOR_NAV[key] || '';
}

/**
 * Where a support question gets FIXED — the module the shop's support page sends him to.
 *
 * Support's own choice (`ticket.fixScreen`) wins. Without one, the topic decides, and only
 * for topics that clearly belong to one screen; "something is broken" or "an idea" get no
 * button at all rather than a guess. Never the page he asked from: asking about printing
 * while standing on Reminders must not produce an "Open Reminders" button.
 */
const FIX_SCREEN_FOR_TOPIC = {
  billing: 'billing',
  stock: 'inventory',
  khata: 'khata',
  purchase: 'purchaseOrders',
  plan: 'plan',
  data: 'backup',
};

// Screens it makes sense to send a shopkeeper to for a fix — not his inbox, not this page.
const NOT_A_FIX_SCREEN = ['overview', 'notifications', 'support', 'myWork'];

export const FIX_SCREEN_ITEMS = SELLER_NAV_ITEMS.filter((item) => !NOT_A_FIX_SCREEN.includes(item.key));

export function fixScreenFor(ticket) {
  if (!ticket) return null;
  const chosen = ticket.fixScreen && FIX_SCREEN_ITEMS.find((item) => item.key === ticket.fixScreen);
  if (chosen) return { item: chosen, bySupport: true };
  const fallback = FIX_SCREEN_ITEMS.find((item) => item.key === FIX_SCREEN_FOR_TOPIC[ticket.topic]);
  return fallback ? { item: fallback, bySupport: false } : null;
}
