'use client';

/* =============================================================================
   Category art — the drawing a product shows when the shop never photographed it.

   TWIN OF frontend/app/components/CategoryArt.js. The two apps cannot import from
   each other (same arrangement as lib/purchaseTotals.js and lib/themes.js), so the
   drawings live in both and MUST CHANGE TOGETHER. backend/tests/categoryArtSync.test.js
   fails the build if they drift.

   Why the dashboard needed it at all: on a real kirana storefront roughly 48 of every
   50 products have no photo, so the no-photo tile is not an edge case, it IS the
   catalog. The customer's app has shown a sack for atta and a strip for tablets since
   the storefront round — but the SHOPKEEPER's own catalog and product list were still
   drawing one identical grey PackageIcon for every single row. He was looking at a
   page of grey boxes while his customer looked at a shelf.

   Every path is hand-drawn geometry, so the artwork is ours outright — no stock, no
   AI raster. See THIRD-PARTY-LICENSES.txt.

   This is a MOTIF, not an icon: it fills a large shape and carries colour on purpose.
   Do not reach for it in a 16px slot, and do not put an Icons.js glyph in a tile.
   ============================================================================= */

const ART = {
  // Atta, rice, dal, sugar — anything that comes out of a sack.
  sack: (
    <>
      <path className="ca-fill" d="M17 19c-3 4-4 10-4 15a4 4 0 0 0 4 4h14a4 4 0 0 0 4-4c0-5-1-11-4-15Z" />
      <path className="ca-line" d="M17 19c-3 4-4 10-4 15a4 4 0 0 0 4 4h14a4 4 0 0 0 4-4c0-5-1-11-4-15Z" />
      {/* The gathered, folded-over top. This — not the body — is what says "sack" instead
          of "jar"; a neat rectangular neck turns the whole drawing into a pickle bottle. */}
      <path className="ca-line" d="M17 19l-3-6 8 3 2-4 2 4 8-3-3 6" />
      <path className="ca-line" d="M14 29h20" />
    </>
  ),
  // Oil, ghee, cold drinks, sauces.
  bottle: (
    <>
      <path className="ca-fill" d="M20 19c0-2 1-3 1-5v-3h6v3c0 2 1 3 1 5 2 2 2 4 2 7v11a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3V26c0-3 0-5 2-7Z" />
      <path className="ca-line" d="M20 19c0-2 1-3 1-5v-3h6v3c0 2 1 3 1 5 2 2 2 4 2 7v11a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3V26c0-3 0-5 2-7Z" />
      <path className="ca-line" d="M21 11h6" />
      <rect className="ca-line" x="19" y="27" width="10" height="7" rx="1.5" />
    </>
  ),
  // Milk, curd, paneer, buttermilk — the gable-top carton every Indian fridge has.
  carton: (
    <>
      <path className="ca-fill" d="M17 20l7-7 7 7v17a2 2 0 0 1-2 2H19a2 2 0 0 1-2-2V20Z" />
      <path className="ca-line" d="M17 20l7-7 7 7v17a2 2 0 0 1-2 2H19a2 2 0 0 1-2-2V20Z" />
      <path className="ca-line" d="M17 20h14M24 13v7" />
      <path className="ca-line" d="M21 27h6" />
    </>
  ),
  // Biscuits, namkeen, chips — a pillow pack with crimped ends.
  packet: (
    <>
      <path className="ca-fill" d="M14 17h20l-2 4 2 4-2 4 2 4-2 4H14l2-4-2-4 2-4-2-4 2-4Z" />
      <path className="ca-line" d="M14 17h20l-2 4 2 4-2 4 2 4-2 4H14l2-4-2-4 2-4-2-4 2-4Z" />
      <path className="ca-line" d="M20 24h8M20 30h5" />
    </>
  ),
  // Haldi, mirchi, garam masala — a squat jar with a screw lid.
  spice: (
    <>
      <rect className="ca-line" x="18" y="12" width="12" height="4" rx="1.5" />
      <path className="ca-fill" d="M17 18h14v17a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3V18Z" />
      <path className="ca-line" d="M17 18h14v17a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3V18Z" />
      <path className="ca-line" d="M21 25h6M21 30h6" />
    </>
  ),
  // Sabzi — leafy greens tied in a bunch.
  veg: (
    <>
      <path className="ca-fill" d="M24 38c-6-4-10-9-10-15 0-4 3-7 6-6 1-3 5-4 7-2 3-1 6 1 6 4 3 0 5 3 4 6-1 6-6 10-13 13Z" />
      <path className="ca-line" d="M24 38c-6-4-10-9-10-15 0-4 3-7 6-6 1-3 5-4 7-2 3-1 6 1 6 4 3 0 5 3 4 6-1 6-6 10-13 13Z" />
      <path className="ca-line" d="M24 38V20M24 27l-5-4M24 30l5-4" />
    </>
  ),
  // Fruit — an apple silhouette with a leaf.
  fruit: (
    <>
      <path className="ca-fill" d="M24 16c4-3 11-1 11 8 0 8-5 15-8 15-1 0-2-1-3-1s-2 1-3 1c-3 0-8-7-8-15 0-9 7-11 11-8Z" />
      <path className="ca-line" d="M24 16c4-3 11-1 11 8 0 8-5 15-8 15-1 0-2-1-3-1s-2 1-3 1c-3 0-8-7-8-15 0-9 7-11 11-8Z" />
      <path className="ca-line" d="M24 16v-5M24 12c3-3 7-2 7-2s0 4-4 4" />
    </>
  ),
  // Soap, detergent, cleaners — a bottle with a trigger neck.
  clean: (
    <>
      <path className="ca-line" d="M22 10h5v4h-5z" />
      <path className="ca-fill" d="M19 18a5 5 0 0 1 5-4h1a5 5 0 0 1 5 4l1 18a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3l1-18Z" />
      <path className="ca-line" d="M19 18a5 5 0 0 1 5-4h1a5 5 0 0 1 5 4l1 18a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3l1-18Z" />
      <path className="ca-line" d="M19 24h11" />
    </>
  ),
  // Tablets and capsules — a blister strip, the unit a chemist actually sells.
  medicine: (
    <>
      <rect className="ca-fill" x="13" y="15" width="22" height="18" rx="3" />
      <rect className="ca-line" x="13" y="15" width="22" height="18" rx="3" />
      <circle className="ca-line" cx="20" cy="21" r="2.4" />
      <circle className="ca-line" cx="28" cy="21" r="2.4" />
      <circle className="ca-line" cx="20" cy="28" r="2.4" />
      <circle className="ca-line" cx="28" cy="28" r="2.4" />
    </>
  ),
  // Bread, pav, buns.
  bread: (
    <>
      <path className="ca-fill" d="M13 24c0-6 5-9 11-9s11 3 11 9v11a2 2 0 0 1-2 2H15a2 2 0 0 1-2-2V24Z" />
      <path className="ca-line" d="M13 24c0-6 5-9 11-9s11 3 11 9v11a2 2 0 0 1-2 2H15a2 2 0 0 1-2-2V24Z" />
      <path className="ca-line" d="M13 26h22M21 15v11M27 15v11" />
    </>
  ),
  // Chai, coffee — a cup on a saucer with steam.
  chai: (
    <>
      <path className="ca-fill" d="M15 20h16v8a8 8 0 0 1-16 0v-8Z" />
      <path className="ca-line" d="M15 20h16v8a8 8 0 0 1-16 0v-8Z" />
      <path className="ca-line" d="M31 22h2a3 3 0 0 1 0 6h-2M12 38h24" />
      <path className="ca-line" d="M20 16c1-2-1-3 0-5M26 16c1-2-1-3 0-5" />
    </>
  ),
  // Eggs.
  egg: (
    <>
      <path className="ca-fill" d="M20 38c-4 0-7-3-7-8 0-7 4-15 7-15s7 8 7 15c0 5-3 8-7 8Z" />
      <path className="ca-line" d="M20 38c-4 0-7-3-7-8 0-7 4-15 7-15s7 8 7 15c0 5-3 8-7 8Z" />
      <path className="ca-line" d="M31 38c-3 0-5-2-5-6 0-5 3-11 5-11s5 6 5 11c0 4-2 6-5 6Z" />
    </>
  ),
  // Mithai — a laddu box, the thing a sweet shop actually hands over.
  sweet: (
    <>
      <path className="ca-fill" d="M12 22h24v13a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3V22Z" />
      <path className="ca-line" d="M12 22h24v13a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3V22Z" />
      <circle className="ca-line" cx="19" cy="17" r="4" />
      <circle className="ca-line" cx="29" cy="17" r="4" />
      <path className="ca-line" d="M12 27h24" />
    </>
  ),
  // Cosmetics, creams, toothpaste — a crimped tube.
  tube: (
    <>
      <rect className="ca-line" x="21" y="10" width="6" height="4" rx="1" />
      <path className="ca-fill" d="M18 16h12v18l-2 4h-8l-2-4V16Z" />
      <path className="ca-line" d="M18 16h12v18l-2 4h-8l-2-4V16Z" />
      <path className="ca-line" d="M18 16c3 2 9 2 12 0" />
    </>
  ),
  // Notebooks, copies, files — a stationer's stack.
  book: (
    <>
      <path className="ca-fill" d="M14 12h16a4 4 0 0 1 4 4v20H18a4 4 0 0 0-4 4V12Z" />
      <path className="ca-line" d="M14 12h16a4 4 0 0 1 4 4v20H18a4 4 0 0 0-4 4V12Z" />
      <path className="ca-line" d="M14 36a4 4 0 0 1 4-4h16" />
      <path className="ca-line" d="M20 19h8M20 24h6" />
    </>
  ),
  // Readymade, saree, uniforms.
  cloth: (
    <>
      <path className="ca-fill" d="M19 12h10l7 5-4 5-2-1v16a2 2 0 0 1-2 2H20a2 2 0 0 1-2-2V21l-2 1-4-5 7-5Z" />
      <path className="ca-line" d="M19 12h10l7 5-4 5-2-1v16a2 2 0 0 1-2 2H20a2 2 0 0 1-2-2V21l-2 1-4-5 7-5Z" />
      <path className="ca-line" d="M19 12c1 3 9 3 10 0" />
    </>
  ),
  // Hardware, electricals, spares.
  tool: (
    <>
      <path className="ca-fill" d="M29 12a7 7 0 0 0-6 10l-11 11 4 4 11-11a7 7 0 0 0 9-9l-4 4-4-1-1-4 4-4a7 7 0 0 0-2 0Z" />
      <path className="ca-line" d="M29 12a7 7 0 0 0-6 10l-11 11 4 4 11-11a7 7 0 0 0 9-9l-4 4-4-1-1-4 4-4a7 7 0 0 0-2 0Z" />
    </>
  ),
  // Jewellery — a ring with a stone.
  jewel: (
    <>
      <path className="ca-line" d="m24 11 6 6-6 7-6-7 6-6Z" />
      <path className="ca-fill" d="m24 11 6 6-6 7-6-7 6-6Z" />
      <path className="ca-line" d="M18 17h12M24 11l-3 6 3 7 3-7-3-6" />
      <path className="ca-line" d="M16 27a9 9 0 1 0 16 0" />
    </>
  ),
  // Everything else: a taped carton. Neutral on purpose — a product we cannot place must
  // not be given somebody else's trade.
  box: (
    <>
      <path className="ca-fill" d="M13 18l11-5 11 5v17l-11 5-11-5V18Z" />
      <path className="ca-line" d="M13 18l11-5 11 5v17l-11 5-11-5V18Z" />
      <path className="ca-line" d="M13 18l11 5 11-5M24 23v17" />
    </>
  ),
};

/**
 * Which drawing a product gets.
 *
 * Ordered most specific first, and matched against the product's name AND its category, so
 * "Amul Taaza" lands on the carton through its Dairy category while "Doodh 500ml" lands
 * there through its name. Hindi and Marathi spellings sit beside the English ones because
 * that is genuinely how a shopkeeper types a catalog — "haldi", "sabun", "chawal".
 *
 * Matched at the START of a word, never anywhere inside one. Plain substring matching looks
 * like it would be more forgiving and is in fact wrong in a way that is hard to spot: "Kanda
 * (Onion)" drew two EGGS, because "k-anda" contains "anda". The same trap catches "dal" in
 * "sandalwood", "oil" in "toilet cleaner" and "tel" in "steel". A suffix is still allowed —
 * "atta" matches "attawala" — because that is how these names actually vary.
 */
const RULES = [
  ['medicine', ['tablet', 'capsule', 'syrup', 'medicine', 'dawa', 'davaa', 'pharma', 'ointment', 'injection', 'drops', 'strip']],
  ['sack', ['atta', 'rice', 'chawal', 'basmati', 'dal', 'daal', 'pulse', 'sugar', 'cheeni', 'shakkar', 'flour', 'maida', 'besan', 'suji', 'rava', 'poha', 'grain', 'anaj', 'wheat', 'gehu', 'bajra', 'jowar', 'rajma', 'chana']],
  ['spice', ['masala', 'haldi', 'turmeric', 'mirch', 'chilli', 'chili', 'jeera', 'cumin', 'dhaniya', 'coriander', 'spice', 'garam', 'hing', 'elaichi', 'pickle', 'achar', 'salt', 'namak']],
  // Before `carton`, not after: a kirana files eggs under Dairy, so a rule that matched the
  // category first would draw a milk packet on every tray of eggs in the shop.
  ['egg', ['egg', 'anda']],
  ['carton', ['milk', 'doodh', 'dahi', 'curd', 'paneer', 'butter', 'makhan', 'cheese', 'dairy', 'lassi', 'chaas', 'cream', 'ghee', 'amul']],
  ['chai', ['tea', 'chai', 'coffee', 'kaapi', 'green tea']],
  ['bread', ['bread', 'pav', 'bun', 'toast', 'rusk', 'bakery', 'cake', 'pastry']],
  ['sweet', ['sweet', 'mithai', 'laddu', 'ladoo', 'barfi', 'burfi', 'jalebi', 'halwa', 'rasgulla', 'gulab jamun', 'chocolate', 'candy', 'toffee']],
  ['packet', ['biscuit', 'cookie', 'namkeen', 'chips', 'wafer', 'snack', 'kurkure', 'mixture', 'sev', 'bhujia', 'noodle', 'maggi', 'pasta', 'papad', 'parle', 'britannia']],
  ['veg', ['sabzi', 'vegetable', 'veg', 'onion', 'pyaz', 'kanda', 'potato', 'aloo', 'tomato', 'tamatar', 'palak', 'spinach', 'methi', 'dhania', 'bhindi', 'gobi', 'lauki', 'baingan', 'mirchi', 'adrak', 'ginger', 'garlic', 'lehsun']],
  ['fruit', ['fruit', 'phal', 'apple', 'seb', 'banana', 'kela', 'mango', 'aam', 'orange', 'santra', 'grape', 'angoor', 'papaya', 'anar', 'pomegranate']],
  ['clean', ['soap', 'sabun', 'detergent', 'surf', 'washing', 'phenyl', 'cleaner', 'harpic', 'lizol', 'bleach', 'dishwash', 'vim', 'toilet', 'floor']],
  ['tube', ['toothpaste', 'colgate', 'cream', 'lotion', 'shampoo', 'oil hair', 'cosmetic', 'lipstick', 'kajal', 'powder', 'deodorant', 'perfume', 'face', 'beauty', 'gel']],
  ['bottle', ['oil', 'tel', 'refined', 'sunflower', 'mustard', 'sarso', 'juice', 'cold drink', 'soft drink', 'pepsi', 'coca', 'thums', 'sprite', 'water', 'pani', 'bottle', 'syrup', 'sauce', 'ketchup', 'vinegar', 'honey', 'shahad']],
  ['cloth', ['shirt', 'saree', 'sari', 'kurta', 'dress', 'cloth', 'kapda', 'garment', 'jeans', 'trouser', 'uniform', 'towel', 'bedsheet', 'blouse', 'lehenga', 'dupatta']],
  ['jewel', ['gold', 'sona', 'silver', 'chandi', 'ring', 'chain', 'necklace', 'bangle', 'earring', 'jewel', 'ornament', 'mangalsutra']],
  ['tool', ['tool', 'hardware', 'nail', 'screw', 'pipe', 'wire', 'switch', 'bulb', 'led', 'electric', 'paint', 'cement', 'hammer', 'plier', 'battery', 'charger']],
  ['book', ['book', 'copy', 'notebook', 'register', 'pen', 'pencil', 'stationery', 'file', 'paper', 'eraser', 'sharpener', 'chart', 'diary']],
];

/**
 * The motif key for a product. Exported so a caller can vary something else by it — the
 * detail sheet uses the same key so a product does not change species when it is opened.
 */
export function motifFor({ name, category } = {}) {
  // Every run of non-letters/digits becomes a single space and the whole string is wrapped
  // in one, so testing for " needle" is exactly "this word starts with the needle" — no
  // lookbehind, which older Safari cannot parse and which would throw at match time on a
  // customer's phone rather than in a build.
  const haystack = ` ${`${String(name || '')} ${String(category || '')}`
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ]+/g, ' ')
    .trim()} `;
  for (const [key, needles] of RULES) {
    for (const needle of needles) {
      if (haystack.includes(` ${needle}`)) return key;
    }
  }
  return 'box';
}

/**
 * The drawing itself.
 *
 * `size` is a CSS length, not a pixel count, because the two places this appears want very
 * different things: a grid tile gives it a percentage of a square that is itself fluid,
 * while a list row gives it a fixed 56px. Stroke width is fixed in user units so the line
 * weight stays honest at every one of those sizes.
 */
export default function CategoryArt({ name, category, motif, size = '56%', className = '' }) {
  const key = motif || motifFor({ name, category });
  return (
    <svg
      className={`category-art ${className}`.trim()}
      viewBox="0 0 48 48"
      width={size}
      height={size}
      role="presentation"
      aria-hidden="true"
      fill="none"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ART[key] || ART.box}
    </svg>
  );
}

/**
 * The whole no-photo tile: the category's hue, and the drawing that goes with it.
 *
 * One component rather than two copies, because the grid card and the detail sheet were
 * already drifting — the sheet had its own markup for the same idea, so a change to the
 * fallback had to be made twice or it was made once and looked wrong on the second screen.
 *
 * The hue still comes from the CATEGORY, not the motif: two motifs can share a hue and two
 * hues can share a motif, and keeping them independent is what lets a whole category read
 * as one colour family down the grid while each item still looks like what it is.
 */
/**
 * The category's hue. Copied from frontend/lib/catalogPrefs.js rather than imported, for the
 * same reason the drawings are: four pure lines, and the alternative is a second cross-app
 * dependency. Must stay identical or one product is a different colour in the shopkeeper's
 * catalog than in his customer's.
 */
export function hueFor(text) {
  const s = String(text || '').trim().toLowerCase() || 'item';
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) % 360;
  return hash;
}

export function PhotoFallback({ item, className = '', size }) {
  return (
    <div
      className={`product-thumb product-thumb-fallback ${className}`.trim()}
      style={{ '--tile-h': hueFor(item?.category || item?.name) }}
      aria-hidden="true"
    >
      <CategoryArt name={item?.name} category={item?.category} size={size} />
    </div>
  );
}
