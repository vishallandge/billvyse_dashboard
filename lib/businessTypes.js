import { UNITS } from './catalog';

/**
 * What each kind of shop should see by default.
 *
 * The app was built assuming every dukaan is a kirana: kilos, 0% GST, expiry on
 * everything. That is wrong for a hardware shop selling wire by the metre at 18%, and
 * useless for a repair counter whose "stock" is an hour of someone's time. Rather than
 * building separate apps, one field on the shop picks the defaults every form starts from.
 *
 * Three rules keep this honest:
 *   1. These are only *defaults*. Every field stays editable, and no vertical hides a
 *      capability another one has — a kirana that starts selling delivery can still add a
 *      charge line, it just isn't the first thing it sees.
 *   2. Changing type never rewrites saved data. It changes what the next blank form
 *      opens with, nothing else.
 *   3. An unset type behaves exactly like `kirana`, which is what every existing shop
 *      already had.
 *
 * `key` must stay in step with backend/config/businessTypes.js, which validates it.
 *
 * So must the FIVE NAV FLAGS — `runsTables`, `booksAppointments`, `usesJobBoard`,
 * `usesMemberships`, `givesEstimates`. Unlike everything around them these are not form
 * defaults at all: they are the menu rule, the screens a trade exists for and nobody else is
 * shown (backend/utils/navRelevance.js owns the decision). `tradeHiddenNav` in DashboardShell
 * reads them off THIS file so a kirana never sees Tables flash into its sidebar before
 * /api/seller/modules has answered — and because that list is UNIONED with the server's, a
 * flag missing here is not a flicker, it is a screen the shop can never see.
 *
 * Which is exactly what happened: `usesJobBoard` and `usesMemberships` were only ever added
 * to the backend copy, so `!trade.usesJobBoard` was true for all 22 trades and a tailor's
 * Jobs board and a gym's Memberships were hidden from the sidebar permanently, whatever the
 * server said. backend/tests/configSync.test.js now fails on any of the five drifting.
 */
const TYPES = {
  kirana: {
    icon: '🛒',
    defaultUnit: 'kg',
    defaultGstRate: 0,
    preferredUnits: ['kg', 'gram', 'litre', 'ml', 'piece', 'packet', 'box', 'dozen'],
    tracksExpiry: true,
    usesCharges: false,
    categories: ['Atta & Rice', 'Dal & Pulses', 'Oil & Ghee', 'Masala', 'Snacks', 'Beverages', 'Personal Care', 'Cleaning', 'Dairy'],
    quickActions: ['billing', 'khata', 'inventory', 'orders', 'daybook', 'expenses', 'reports'],
  },
  dairy: {
    icon: '🥛',
    defaultUnit: 'litre',
    defaultGstRate: 0,
    preferredUnits: ['litre', 'ml', 'kg', 'gram', 'piece', 'packet'],
    tracksExpiry: true,
    usesCharges: false,
    categories: ['Milk', 'Curd & Lassi', 'Paneer', 'Ghee & Butter', 'Sweets'],
    quickActions: ['billing', 'khata', 'inventory', 'orders', 'daybook', 'expenses', 'reports'],
  },
  bakery: {
    icon: '🍰',
    defaultUnit: 'kg',
    defaultGstRate: 5,
    preferredUnits: ['kg', 'gram', 'piece', 'dozen', 'packet', 'box'],
    tracksExpiry: true,
    usesCharges: true,
    givesEstimates: true,
    categories: ['Bread & Buns', 'Cakes', 'Biscuits', 'Namkeen', 'Mithai', 'Dry Fruits'],
    quickActions: ['billing', 'khata', 'inventory', 'orders', 'daybook', 'expenses', 'reports'],
  },
  vegetable: {
    icon: '🥬',
    defaultUnit: 'kg',
    defaultGstRate: 0,
    preferredUnits: ['kg', 'gram', 'piece', 'dozen', 'bundle', 'bag'],
    tracksExpiry: true,
    usesCharges: false,
    categories: ['Vegetables', 'Fruits', 'Leafy', 'Exotic', 'Seasonal'],
    quickActions: ['billing', 'khata', 'inventory', 'orders', 'daybook', 'expenses', 'reports'],
  },
  stationery: {
    icon: '📚',
    defaultUnit: 'piece',
    // Was 12% — a slab that no longer exists. Most stationery now sits at 5%, and school
    // exercise books and pencils are nil, which is one tap away.
    defaultGstRate: 5,
    preferredUnits: ['piece', 'packet', 'box', 'dozen', 'set', 'bundle'],
    tracksExpiry: false,
    usesCharges: true,
    givesEstimates: true,
    categories: ['Notebooks', 'Pens & Pencils', 'Files & Folders', 'Art Supplies', 'Office', 'Printing'],
    quickActions: ['billing', 'khata', 'inventory', 'orders', 'daybook', 'expenses', 'reports'],
  },
  cosmetics: {
    icon: '💄',
    defaultUnit: 'piece',
    defaultGstRate: 18,
    preferredUnits: ['piece', 'ml', 'gram', 'packet', 'box', 'set'],
    tracksExpiry: true,
    usesCharges: false,
    categories: ['Skin Care', 'Hair Care', 'Makeup', 'Fragrance', 'Bath & Body', 'Grooming'],
    quickActions: ['billing', 'khata', 'inventory', 'orders', 'daybook', 'expenses', 'reports'],
  },
  hardware: {
    icon: '🔧',
    defaultUnit: 'piece',
    defaultGstRate: 18,
    // Wire by the metre, pipe by the foot, tiles by the square foot — the units this
    // trade actually quotes in, which the app simply did not have before.
    preferredUnits: ['piece', 'metre', 'feet', 'sqft', 'kg', 'litre', 'set', 'bundle', 'roll', 'bag'],
    tracksExpiry: false,
    usesCharges: true,
    givesEstimates: true,
    categories: ['Plumbing', 'Electrical', 'Paint', 'Tools', 'Fittings', 'Cement & Sand', 'Tiles', 'Sanitary'],
    quickActions: ['billing', 'khata', 'inventory', 'orders', 'daybook', 'expenses', 'reports'],
  },
  electronics: {
    icon: '🔌',
    defaultUnit: 'piece',
    defaultGstRate: 18,
    preferredUnits: ['piece', 'set', 'pair', 'metre', 'box'],
    tracksExpiry: false,
    usesCharges: true,
    givesEstimates: true,
    categories: ['Mobile Accessories', 'Cables & Chargers', 'Audio', 'Batteries', 'Lighting', 'Appliances'],
    quickActions: ['billing', 'khata', 'inventory', 'orders', 'daybook', 'expenses', 'reports'],
  },
  autoparts: {
    icon: '🛞',
    defaultUnit: 'piece',
    // Was 28%, a slab that no longer exists — tyres, batteries and the bulk of auto parts
    // now sit at 18%. The 40% demerit rate exists for the few luxury-vehicle lines that
    // carry it and is one tap away.
    defaultGstRate: 18,
    preferredUnits: ['piece', 'set', 'pair', 'litre', 'ml', 'metre'],
    tracksExpiry: false,
    usesCharges: true,
    givesEstimates: true,
    categories: ['Tyres & Tubes', 'Batteries', 'Engine Oil', 'Filters', 'Brakes', 'Electricals', 'Body Parts'],
    quickActions: ['billing', 'khata', 'inventory', 'orders', 'daybook', 'expenses', 'reports'],
  },
  wholesale: {
    icon: '📦',
    defaultUnit: 'box',
    defaultGstRate: 18,
    preferredUnits: ['box', 'packet', 'bag', 'quintal', 'kg', 'dozen', 'bundle', 'piece'],
    tracksExpiry: true,
    usesCharges: true,
    givesEstimates: true,
    categories: ['FMCG', 'Grocery', 'Personal Care', 'Household', 'Beverages'],
    quickActions: ['billing', 'khata', 'inventory', 'orders', 'daybook', 'expenses', 'reports'],
  },
  // ---- Trades unlocked by variants and batch stock ---------------------------------
  // Each of these was previously being asked to pretend it was a kirana: a saree shop
  // with no size/colour, a chemist with one expiry date for two different lots, a sunar
  // with no 3% slab. `suggestsVariants` and `suggestsBatches` only nudge the product form
  // toward the tool this trade will need — neither hides anything from anyone else.
  garments: {
    icon: '👕',
    defaultUnit: 'piece',
    defaultGstRate: 5,
    preferredUnits: ['piece', 'set', 'pair', 'metre', 'dozen'],
    tracksExpiry: false,
    usesCharges: true,
    suggestsVariants: true,
    givesEstimates: true,
    categories: ['Shirts', 'T-Shirts', 'Trousers & Jeans', 'Kurta & Ethnic', 'Sarees', 'Kids', 'Innerwear', 'Footwear'],
    quickActions: ['billing', 'khata', 'inventory', 'orders', 'daybook', 'expenses', 'reports'],
  },
  medical: {
    icon: '💊',
    // A chemist's shelf is counted in strips, not in vague "pieces" — and the single
    // tablet a customer actually asks for is the strip's sub-unit, not its own product.
    // See the loose-sale block in the product form and utils/packs.js on the server.
    defaultUnit: 'strip',
    // Was 12%, a slab that no longer exists. Most medicines now sit at 5%, and a list of
    // life-saving drugs is nil — both one tap away. Getting the common case right is what
    // this default is for; the chemist still confirms each item with their CA.
    defaultGstRate: 5,
    preferredUnits: ['strip', 'tablet', 'capsule', 'packet', 'bottle', 'box', 'piece', 'ml', 'sachet', 'tube', 'vial', 'gram'],
    tracksExpiry: true,
    usesCharges: false,
    suggestsBatches: true,
    categories: ['Tablets', 'Syrups', 'Injections', 'Ointments', 'Surgical', 'Baby Care', 'OTC & General'],
    quickActions: ['billing', 'khata', 'inventory', 'orders', 'daybook', 'expenses', 'reports'],
  },
  jewellery: {
    icon: '💍',
    // Gold is quoted and billed by the gram; the making charge rides the same ad-hoc
    // charge line a repair counter already uses, so it needs nothing new.
    defaultUnit: 'gram',
    defaultGstRate: 3,
    preferredUnits: ['gram', 'piece', 'pair', 'set', 'kg'],
    tracksExpiry: false,
    usesCharges: true,
    givesEstimates: true,
    categories: ['Gold', 'Silver', 'Diamond', 'Imitation', 'Making Charges', 'Repair & Polish'],
    quickActions: ['billing', 'khata', 'inventory', 'orders', 'daybook', 'expenses', 'reports'],
  },
  // ---- Table-led trades --------------------------------------------------------------
  // A tab opened, added to over an hour, fired to the kitchen in rounds, settled once.
  // `runsTables` is what puts the floor screen in front of them. `sellsServices` is set
  // here but deliberately NOT in the backend copy: it opens the product form on a dish
  // (no stock, never "out of stock"), while the backend uses the same flag to hide
  // Suppliers — which a kitchen buying raw material every week very much needs.
  restaurant: {
    icon: '🍽️',
    defaultUnit: 'piece',
    defaultGstRate: 5,
    preferredUnits: ['piece', 'service', 'packet', 'litre', 'ml', 'gram'],
    // True for the raw material, not the menu — milk and paneer go off, a paneer butter
    // masala does not. Every expiry control is gated on kind !== 'service', so the dish
    // is never asked and the crate of milk is.
    tracksExpiry: true,
    usesCharges: true,
    chargesFirst: true,
    sellsServices: true,
    runsTables: true,
    categories: ['Starters', 'Main Course', 'Roti & Rice', 'Chinese', 'South Indian', 'Beverages', 'Desserts', 'Combos'],
    quickActions: ['tables', 'kitchen', 'billing', 'inventory', 'expenses', 'daybook', 'reports'],
  },
  teastall: {
    icon: '🫖',
    defaultUnit: 'piece',
    defaultGstRate: 5,
    preferredUnits: ['piece', 'service', 'ml', 'litre', 'packet'],
    tracksExpiry: true,
    usesCharges: true,
    chargesFirst: true,
    sellsServices: true,
    runsTables: true,
    categories: ['Chai & Coffee', 'Juice & Shakes', 'Snacks', 'Sandwich', 'Cold Drinks'],
    quickActions: ['tables', 'kitchen', 'billing', 'khata', 'inventory', 'expenses', 'daybook', 'reports'],
  },
  services: {
    icon: '🛠️',
    // A repair counter's line is time, not stock — so the form opens on a charge, not a
    // product, and GST defaults to the 18% most services carry.
    defaultUnit: 'service',
    defaultGstRate: 18,
    preferredUnits: ['service', 'hour', 'day', 'piece', 'set'],
    tracksExpiry: false,
    usesCharges: true,
    chargesFirst: true,
    booksAppointments: true,
    sellsServices: true,
    givesEstimates: true,
    usesJobBoard: true,
    categories: ['Repair', 'Service Charge', 'Spare Parts', 'Consumables', 'AMC'],
    quickActions: ['jobs', 'billing', 'khata', 'appointments', 'inventory', 'expenses', 'reports'],
  },
  // ---- Appointment-led trades ------------------------------------------------------
  // These run on a diary, not a shelf: `booksAppointments` is what puts the appointment
  // book in front of them and makes a new catalog entry default to a service.
  salon: {
    icon: '💇',
    defaultUnit: 'service',
    defaultGstRate: 18,
    preferredUnits: ['service', 'hour', 'piece', 'ml', 'gram'],
    tracksExpiry: false,
    usesCharges: true,
    chargesFirst: true,
    booksAppointments: true,
    sellsServices: true,
    usesMemberships: true,
    categories: ['Hair', 'Skin & Facial', 'Threading & Waxing', 'Spa & Massage', 'Bridal', 'Products'],
    quickActions: ['appointments', 'memberships', 'billing', 'khata', 'inventory', 'expenses', 'reports'],
  },
  tailor: {
    icon: '🧵',
    defaultUnit: 'piece',
    defaultGstRate: 5,
    preferredUnits: ['piece', 'set', 'metre', 'service', 'pair'],
    tracksExpiry: false,
    usesCharges: true,
    chargesFirst: true,
    booksAppointments: true,
    sellsServices: true,
    givesEstimates: true,
    usesJobBoard: true,
    categories: ['Stitching', 'Alteration', 'Fabric', 'Embroidery', 'Urgent'],
    quickActions: ['jobs', 'appointments', 'billing', 'khata', 'inventory', 'expenses', 'reports'],
  },
  laundry: {
    icon: '🧺',
    defaultUnit: 'piece',
    defaultGstRate: 18,
    preferredUnits: ['piece', 'kg', 'pair', 'set', 'service'],
    tracksExpiry: false,
    usesCharges: true,
    chargesFirst: true,
    booksAppointments: true,
    sellsServices: true,
    usesJobBoard: true,
    categories: ['Wash & Fold', 'Dry Clean', 'Ironing', 'Starch', 'Express'],
    quickActions: ['jobs', 'billing', 'khata', 'appointments', 'inventory', 'expenses', 'reports'],
  },
  tuition: {
    icon: '📖',
    defaultUnit: 'hour',
    defaultGstRate: 0,
    preferredUnits: ['hour', 'day', 'service', 'piece'],
    tracksExpiry: false,
    usesCharges: true,
    chargesFirst: true,
    booksAppointments: true,
    sellsServices: true,
    usesMemberships: true,
    categories: ['Monthly Fee', 'Admission', 'Test Series', 'Books & Notes', 'Extra Class'],
    quickActions: ['memberships', 'appointments', 'billing', 'khata', 'inventory', 'expenses', 'reports'],
  },
  gym: {
    icon: '🏋️',
    defaultUnit: 'day',
    defaultGstRate: 18,
    preferredUnits: ['day', 'hour', 'service', 'piece'],
    tracksExpiry: false,
    usesCharges: true,
    chargesFirst: true,
    booksAppointments: true,
    sellsServices: true,
    usesMemberships: true,
    categories: ['Membership', 'Personal Training', 'Diet Plan', 'Supplements', 'Day Pass'],
    quickActions: ['memberships', 'appointments', 'billing', 'khata', 'inventory', 'expenses', 'reports'],
  },
  other: {
    icon: '🏪',
    defaultUnit: 'piece',
    defaultGstRate: 0,
    preferredUnits: UNITS,
    tracksExpiry: true,
    usesCharges: true,
    givesEstimates: true,
    categories: [],
    quickActions: ['billing', 'khata', 'inventory', 'orders', 'daybook', 'expenses', 'reports'],
  },
};

// Order shown in the picker: the trades most likely to sign up first.
export const BUSINESS_TYPE_KEYS = [
  'kirana',
  'dairy',
  'bakery',
  'vegetable',
  'stationery',
  'cosmetics',
  'hardware',
  'electronics',
  'autoparts',
  'wholesale',
  'garments',
  'medical',
  'jewellery',
  'restaurant',
  'teastall',
  'services',
  'salon',
  'tailor',
  'laundry',
  'tuition',
  'gym',
  'other',
];

// Every shop that registered before this field existed behaves exactly as it did.
export const DEFAULT_BUSINESS_TYPE = 'kirana';

export function businessType(key) {
  return TYPES[key] || TYPES[DEFAULT_BUSINESS_TYPE];
}

/**
 * Which trades each optional tool belongs to.
 *
 * The reason this matters is trust, not tidiness. A kirana owner who opens Inventory and
 * is offered "Add with sizes and colours" concludes the app was built for a clothes shop
 * and that nobody thought about him — and he is right to. Every entry below is a control
 * that is genuinely meaningless to most trades and essential to a few.
 *
 * Written as lists rather than a flag on each of the 22 types because the question a
 * reader actually has is "who sees price tiers?", and a list answers it on one line
 * instead of twenty-two lookups.
 *
 * Nothing here is a lock — see tradeUses() for the escape hatch that brings a tool back
 * the moment a shop has real data in it, the same rule utils/navRelevance.js uses on the
 * server for sidebar links.
 */
const TRADE_TOOLS = {
  // Size, colour, shade, capacity, gauge — one item that exists in several forms.
  variants: ['garments', 'cosmetics', 'stationery', 'electronics', 'autoparts', 'hardware', 'tailor', 'jewellery', 'wholesale', 'other'],
  // Warranty only means something where a unit can fail and be brought back.
  warranty: ['electronics', 'autoparts', 'hardware', 'services'],
  // "Stocked by the roll, sold by the metre." Nobody else buys and sells in two units.
  secondaryUnit: ['hardware', 'wholesale', 'vegetable'],
  // "Stocked by the strip, sold by the tablet." The other direction, and by far the
  // longest list here — breaking open a pack is what a counter does all day, in almost
  // every trade that sells things. An electronics shop sells one battery out of a pack of
  // four, an auto-parts counter one bulb out of a box of ten, a salon one sachet out of a
  // strip. Only the trades that sell time rather than goods are left off, because an hour
  // does not come in a packet.
  looseSale: [
    'medical', 'kirana', 'vegetable', 'dairy', 'bakery', 'cosmetics', 'stationery',
    'hardware', 'wholesale', 'teastall', 'electronics', 'autoparts', 'garments',
    'salon', 'restaurant', 'other',
  ],
  // Quantity price breaks are a wholesaler's whole business model and no one else's.
  priceTiers: ['wholesale', 'hardware'],
  // A dish or a cake costs what its ingredients cost.
  recipe: ['bakery', 'restaurant', 'teastall'],
  // A service that uses up stock: shampoo per haircut, detergent per wash, thread and
  // buttons per blouse, parts per repair. Same recipe lines, on a service.
  // Restaurants too: a catering or party service uses plates, oil and gas like a dish does.
  serviceMaterials: ['salon', 'laundry', 'tailor', 'services', 'other', 'restaurant', 'teastall', 'bakery'],
  // Size, spice level, add-ons — the choices a menu item offers beyond quantity. Same
  // trades as recipe: a kirana's stock has no such thing as "make it spicier".
  modifiers: ['bakery', 'restaurant', 'teastall'],
  // A separate price for parcel and delivery. Only a trade that hands the same item over
  // in more than one way has two prices for it — a box and a bag cost money, and an
  // aggregator takes a cut on top.
  channelPricing: ['restaurant', 'teastall', 'bakery'],
  // A cut of each bill, paid to the person who did the work — chair-wise at a salon,
  // trainer-wise at a gym. A kirana's helper is on a salary.
  commission: ['salon', 'gym', 'tuition', 'services', 'tailor'],
};

/**
 * Does this trade use this tool — or does this shop already have data that proves it does?
 *
 * `hasData` is the escape hatch and it is not optional politeness: a shop can change its
 * business type in Settings at any time, and a hardware shop that switches to "other"
 * must not find its price tiers gone. Pass whatever fact means "this shop is already
 * using it" and the tool stays put.
 *
 * Batches deliberately have no list of their own: a batch is a lot with its own expiry, so
 * the trades that need one are exactly the trades that track expiry. Deriving it means the
 * two can never drift apart.
 */
export function tradeUses(key, tool, hasData = false) {
  if (hasData) return true;
  if (tool === 'batches') return Boolean(businessType(key).tracksExpiry);
  return (TRADE_TOOLS[tool] || []).includes(key);
}

export function businessTypeOptions(t) {
  return BUSINESS_TYPE_KEYS.map((key) => ({
    key,
    icon: TYPES[key].icon,
    label: t(`businessType.${key}`),
  }));
}

/**
 * Units for the picker, with this trade's own units lifted to the top. Nothing is
 * removed — a hardware shop that also sells one thing by the kilo can still find it, it
 * just scrolls past metre and sq ft first.
 */
export function unitsForBusiness(key) {
  const preferred = businessType(key).preferredUnits;
  return [...preferred, ...UNITS.filter((unit) => !preferred.includes(unit))];
}
