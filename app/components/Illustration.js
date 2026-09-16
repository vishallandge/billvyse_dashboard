'use client';

/* =============================================================================
   Illustrations

   ORIGINAL ARTWORK. Every path below was drawn for this app; nothing here is
   traced, imported, or licensed from anyone. No stock image, no Freepik/Unsplash
   download, no AI-generated raster. That matters for one practical reason: a
   licence is not ownership. A downloaded illustration can be relicensed, pulled,
   or bought by a competitor next week, and an AI-generated one has no clean human
   author to register in India. Geometry we typed is ours outright.

   It is also the cheapest option that survives contact with a real shop's phone:
   the whole set below is a few KB of geometry that scales to any density, tints
   itself from the active theme, and never blurs — where one photographic
   empty-state image would be ~80KB each and wrong in dark mode.

   ---------------------------------------------------------------------------
   TWO AXES, and keeping them apart is the whole design.

     SCENE  — what is empty. A shelf with nothing on it, a khata with no lines, a
              carton with no order in it. Chosen by the CALLER, because only the
              screen knows what its own emptiness means.

     MOTIF  — who the shopkeeper is: a PERSON plus the trade's own object. A
              kirana's basket, a tailor's spool, a gym's dumbbell — each behind
              the figure of somebody who works with it. Chosen AUTOMATICALLY from
              the signed-in shop's businessType, because no caller should have to
              remember 22 trades.

   8 scenes x 22 motifs is 176 pictures out of 30 drawings. That is the only
   reason per-trade artwork is affordable at all: draw the chassis once, drop the
   trade's own object into the slot it leaves.

   THE PERSON IS THE POINT. The first version drew the tool alone and it was
   correct and cold — a rack of implements. A shop is people, and a shopkeeper
   opening a screen for the first time should see somebody in it, not inventory.
   So one figure is drawn ONCE, shared by all 22, and the trade's object sits
   behind them, dimmed by .art-figure-prop so the human reads first.

   ---------------------------------------------------------------------------
   WHERE THESE BELONG — and where they must never go.

   Empty states, onboarding, upgrade sheets, celebrations. Screens where nothing
   has happened yet and the shopkeeper needs a reason to take the first step.

   NOT the billing counter, not the inventory table, not khata's list of names.
   Those are places a person works for six hours a day; a picture there is
   charming on day one and an irritation by day three — the same rule that keeps
   ambient motion out of billing/inventory/khata. The dashed `search` scene is the
   one that does appear mid-work, and it is deliberately the plainest here.

   These are NOT icons. Icons.js is Phosphor, drawn at 16-26px, and carries no
   accent colour by rule. An illustration is 120-200px, carries the accent on
   purpose, and says something rather than labelling something. Never mix the two
   vocabularies in one slot.
   ============================================================================= */

import { useDashboardUser } from './DashboardShell';
import { DEFAULT_BUSINESS_TYPE, BUSINESS_TYPE_KEYS } from '../../lib/businessTypes';

/* ---------------------------------------------------------------------------
   PROPS — one per business type, drawn on a 64x64 grid.

   Deliberately 3-5 shapes each. A prop is read at about 30px behind the figure,
   so detail past that is bytes nobody sees; what has to survive that size is the
   SILHOUETTE. A tailor should know the spool is a spool from across the counter.

   Every key in BUSINESS_TYPE_KEYS must exist here — see the guard below, which
   is the same drift check businessTypes.js puts on its nav flags, for a sharper
   reason: a trade added there and forgotten here does not draw a blank, it draws
   SOMEBODY ELSE'S trade, which is worse than no picture at all.
   --------------------------------------------------------------------------- */
const PROPS = {
  // Basket — the thing a kirana customer actually carries to the counter.
  kirana: (
    <>
      <path className="art-wash-2" d="M10 26h44l-5 25a5 5 0 0 1-5 4H20a5 5 0 0 1-5-4Z" />
      <path className="art-line" d="M21 26a11 11 0 0 1 22 0" />
      <path className="art-line-soft" d="M24 34l2 14M32 34v14M40 34l-2 14" />
    </>
  ),
  dairy: (
    <>
      <path className="art-wash-2" d="M24 12h16v7l7 9v27a4 4 0 0 1-4 4H21a4 4 0 0 1-4-4V28l7-9Z" />
      <path className="art-line" d="M17 36h30" />
      <circle className="art-brand" cx="32" cy="46" r="5" />
    </>
  ),
  bakery: (
    <>
      <path className="art-wash-2" d="M16 34h32l-4 20a4 4 0 0 1-4 3H24a4 4 0 0 1-4-3Z" />
      <path className="art-brand" d="M16 34c0-9 7-15 16-15s16 6 16 15Z" />
      <path className="art-line" d="M32 12v7" />
      <circle className="art-gold" cx="32" cy="9" r="3" />
    </>
  ),
  // Two leaves off one stem. The first attempt was two rotated ellipses and it read
  // as a mushroom — a leaf needs the point at its tip to be a leaf at all.
  vegetable: (
    <>
      <path className="art-line" d="M32 58V34" />
      <path className="art-wash-2" d="M32 36C17 36 11 25 13 12c13-2 21 9 19 24Z" />
      <path className="art-brand" d="M32 36c15 0 21-11 19-24-13-2-21 9-19 24Z" />
    </>
  ),
  stationery: (
    <>
      <path className="art-wash-2" d="M15 50l4-15 22-22 11 11-22 22Z" />
      <path className="art-brand" d="M41 13l11 11 4-4a7.8 7.8 0 0 0-11-11Z" />
      <path className="art-ink" d="M15 50l3-11 8 8Z" />
    </>
  ),
  cosmetics: (
    <>
      <rect className="art-wash-2" x="14" y="27" width="15" height="28" rx="3" />
      <path className="art-brand" d="M16 27V16a5 5 0 0 1 11 0v11Z" />
      <rect className="art-wash-2" x="35" y="31" width="15" height="24" rx="4" />
      <rect className="art-line" x="39" y="21" width="7" height="10" rx="2" />
    </>
  ),
  // A hammer, not the hex nut this used to be: at 40px a nut with a hole in it is a
  // spoon. A hammer survives being small because its silhouette is asymmetric.
  hardware: (
    <>
      <path className="art-wash-2" d="M9 13h31a5 5 0 0 1 5 5v11a5 5 0 0 1-5 5H9Z" />
      <path className="art-brand" d="M22 34h9v22a4.5 4.5 0 0 1-9 0Z" />
    </>
  ),
  // A cord, not the dangling dot that was there: the dot read as a drip coming off a
  // light bulb.
  electronics: (
    <>
      <path className="art-wash-2" d="M17 27h30v8a15 15 0 0 1-30 0Z" />
      <path className="art-line" d="M25 27V11M39 27V11" />
      <path className="art-line" d="M32 50c0 9 9 5 9 9" />
    </>
  ),
  // Teeth are short and fat. Long thin ones turned the gear into a flower.
  autoparts: (
    <>
      <circle className="art-wash-2" cx="32" cy="32" r="19" />
      <rect className="art-wash-2" x="26" y="10" width="12" height="44" rx="3" />
      <rect className="art-wash-2" x="26" y="10" width="12" height="44" rx="3" transform="rotate(60 32 32)" />
      <rect className="art-wash-2" x="26" y="10" width="12" height="44" rx="3" transform="rotate(120 32 32)" />
      <circle className="art-brand" cx="32" cy="32" r="8" />
    </>
  ),
  // Three cartons, because "wholesale" is a QUANTITY of the same thing — one box is a
  // delivery, a stack is a business.
  wholesale: (
    <>
      <rect className="art-wash-2" x="7" y="12" width="25" height="21" rx="2" />
      <path className="art-brand" d="M16 12h7v21h-7z" />
      <rect className="art-wash-2" x="5" y="35" width="27" height="23" rx="2" />
      <rect className="art-wash-2" x="34" y="29" width="25" height="29" rx="2" />
      <path className="art-line" d="M5 35h27M34 43h25" />
    </>
  ),
  // The hanger went: at this size its hook read as a stray blob on top of the shirt.
  // The collar carries the accent instead, which is the part of a shirt you recognise.
  garments: (
    <>
      <path className="art-wash-2" d="M24 11h16l16 11-7 11-5-3v26H20V30l-5 3-7-11Z" />
      <path className="art-brand" d="M24 11h16a8 8 0 0 1-16 0Z" />
    </>
  ),
  medical: (
    <>
      <rect className="art-wash-2" x="9" y="17" width="31" height="31" rx="8" />
      <path className="art-brand" d="M21 23h7v6h6v7h-6v6h-7v-6h-6v-7h6z" />
      <rect className="art-wash-2" x="37" y="35" width="23" height="13" rx="6.5" />
      <path className="art-line" d="M48 35v13" />
    </>
  ),
  jewellery: (
    <>
      <circle className="art-line" cx="32" cy="41" r="14" />
      <path className="art-brand" d="M32 7l10 10-10 12-10-12Z" />
      <path className="art-line-soft" d="M22 17h20" />
    </>
  ),
  restaurant: (
    <>
      <path className="art-wash-2" d="M12 43a20 20 0 0 1 40 0Z" />
      <path className="art-line" d="M7 47h50" />
      <path className="art-line" d="M32 23v-4" />
      <circle className="art-brand" cx="32" cy="17" r="4" />
    </>
  ),
  teastall: (
    <>
      <path className="art-wash-2" d="M20 27h24l-4 26a4 4 0 0 1-4 3h-8a4 4 0 0 1-4-3Z" />
      <path className="art-brand" d="M21 35h22l-1 9H22Z" />
      <path className="art-line-soft" d="M25 22c0-5 5-5 5-11M37 22c0-5 5-5 5-11" />
    </>
  ),
  services: (
    <>
      <path className="art-wash-2" d="M13 51 33 31l6 6-20 20a4.2 4.2 0 0 1-6-6Z" />
      <path className="art-brand" d="M47 11a11 11 0 0 0-13 14l-5 5 6 6 5-5a11 11 0 0 0 14-13l-7 7-7-1-1-7Z" />
    </>
  ),
  // Scissors need BOTH handle loops and a visible pivot. With one loop faint and the
  // other filled, this read as an X with a dot next to it.
  salon: (
    <>
      <path className="art-line" d="M18 9 46 44M46 9 18 44" />
      <circle className="art-line" cx="18" cy="50" r="7" />
      <circle className="art-line" cx="46" cy="50" r="7" />
      <circle className="art-brand" cx="32" cy="26" r="4.5" />
    </>
  ),
  // A thread spool. Drawn as a real cylinder — the flat rectangle it used to be read
  // as a milk jug, which a tailor would find baffling.
  tailor: (
    <>
      <path className="art-wash-2" d="M18 16c0-3 6-5 14-5s14 2 14 5v32c0 3-6 5-14 5s-14-2-14-5Z" />
      <ellipse className="art-line" cx="32" cy="16" rx="14" ry="5" />
      <path className="art-brand" d="M19 26c8 3 18 3 26 0v13c-8 3-18 3-26 0Z" />
      {/* Wound thread. Without these the cylinder was a paint can. */}
      <path className="art-line-soft" d="M22 31h20M22 36h20" />
    </>
  ),
  // The control panel across the top is what separates a washing machine from a camera.
  laundry: (
    <>
      <rect className="art-line" x="12" y="9" width="40" height="47" rx="6" />
      <path className="art-line" d="M12 22h40" />
      <circle className="art-wash-2" cx="32" cy="39" r="13" />
      <circle className="art-brand" cx="32" cy="39" r="6" />
      <circle className="art-ink" cx="19" cy="16" r="2.5" />
      <circle className="art-ink" cx="27" cy="16" r="2.5" />
    </>
  ),
  // An open book needs its OUTLINE: two faint wash shapes alone merged into one blob
  // and all that showed was the spine.
  tuition: (
    <>
      <path className="art-wash-2" d="M7 17c8-4 17-4 25 4v33c-8-8-17-8-25-4Z" />
      <path className="art-wash-2" d="M57 17c-8-4-17-4-25 4v33c8-8 17-8 25-4Z" />
      <path className="art-line" d="M7 17c8-4 17-4 25 4 8-8 17-8 25-4v33c-8-4-17-4-25 4-8-8-17-8-25-4Z" />
      <path className="art-brand-line" d="M32 21v33" />
    </>
  ),
  gym: (
    <>
      <rect className="art-wash-2" x="4" y="19" width="13" height="26" rx="4" />
      <rect className="art-wash-2" x="47" y="19" width="13" height="26" rx="4" />
      <rect className="art-brand" x="17" y="27" width="30" height="10" rx="5" />
      <path className="art-line" d="M2 25v14M62 25v14" />
    </>
  ),
  // The catch-all: a shopfront. An awning alone read as a box, so it gets the shutter
  // and the doorway too — the one silhouette every shop on the street shares.
  other: (
    <>
      <path className="art-wash-2" d="M8 14h48l6 13H2Z" />
      <path className="art-line" d="M2 27h60M9 27v31h46V27" />
      <path className="art-brand" d="M25 58V40h14v18Z" />
    </>
  ),
};

if (process.env.NODE_ENV !== 'production') {
  const missing = BUSINESS_TYPE_KEYS.filter((key) => !PROPS[key]);
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.warn(`[Illustration] no prop drawn for: ${missing.join(', ')}`);
  }
}

/**
 * The shopkeeper. One figure, drawn once, shared by all 22 trades.
 *
 * Head and shoulders only, and no face. Both are deliberate. A face at 40px is
 * four grey dots that read as a smudge, and any face at any size is a specific
 * person — an age, a gender, a community — which is exactly what a picture shown
 * to every shop in the country must not pick. A silhouette is everybody.
 *
 * Solid --brand while the prop behind is dimmed, because the human is what the
 * eye should land on first. That ordering is the whole change: the tool alone was
 * a rack of implements, the tool plus a person is a shop.
 */
function Person() {
  return (
    <>
      <circle className="art-brand" cx="16" cy="22" r="10" />
      <path className="art-brand" d="M2 62c0-16 6-24 14-24s14 8 14 24Z" />
    </>
  );
}

/**
 * The shopkeeper standing beside their work: person on the left, the trade's own
 * object on the right, both at full strength. 96 wide x 64 tall.
 *
 * The first attempt tucked a small dimmed prop BEHIND the figure, and rendering it
 * killed the idea: at that size a kirana, a dairy and a garments shop were three
 * identical avatars with a grey smudge each. Per-trade artwork that cannot be told
 * apart by trade is not per-trade artwork. So they are peers now — the person says
 * "a shop", the object says "which shop", and neither can carry both.
 */
function Motif({ trade, x, y, scale }) {
  const prop = PROPS[trade] || PROPS[DEFAULT_BUSINESS_TYPE];
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <Person />
      <g transform="translate(36 2) scale(0.92)">{prop}</g>
    </g>
  );
}

/* ---------------------------------------------------------------------------
   SCENES — 168x120, each a chassis with a slot for the trade's motif.

   The dashed shapes are load-bearing, not decoration: a dashed outline is the
   visual grammar for "this is where the thing you don't have yet would go". A
   solid empty rectangle just reads as a layout that broke.
   --------------------------------------------------------------------------- */
const SCENES = {
  // Nothing stocked yet — products, catalog, labels, central inventory.
  shelf: (trade) => (
    <>
      <rect className="art-panel" x="10" y="8" width="148" height="104" rx="14" />
      <path className="art-line" d="M22 74h124M22 104h124" />
      <rect className="art-dash" x="28" y="80" width="52" height="20" rx="6" />
      <rect className="art-dash" x="88" y="80" width="52" height="20" rx="6" />
      {/* Sized so the pair fills the top band: the shopkeeper and their goods ARE the
          picture, and anything smaller sits on the rack like a sticker. */}
      <Motif trade={trade} x={40} y={10} scale={0.86} />
    </>
  ),

  // Khata with no entries — the ledger itself, the trade on the cover badge.
  ledger: (trade) => (
    <>
      <rect className="art-panel" x="18" y="16" width="132" height="88" rx="10" />
      <path className="art-line" d="M84 16v88" />
      <path className="art-dash" d="M30 42h40M30 58h40M30 74h28" />
      {/* The badge circle went with the redesign — a 96-wide pair does not fit in a
          26px roundel, and the right-hand page is a better place for it anyway. */}
      <Motif trade={trade} x={86} y={30} scale={0.62} />
    </>
  ),

  // Nothing has come in or gone out — orders, purchases, returns, transfers.
  parcel: (trade) => (
    <>
      <path className="art-line" d="M34 52 24 40h40l-8 12M134 52l10-12h-40l8 12" />
      <rect className="art-panel" x="30" y="52" width="108" height="54" rx="10" />
      <path className="art-line" d="M30 68h108" />
      <rect className="art-dash" x="60" y="78" width="48" height="18" rx="5" />
      <Motif trade={trade} x={44} y={0} scale={0.58} />
    </>
  ),

  // Nothing booked — appointments, memberships, attendance.
  calendar: (trade) => (
    <>
      <rect className="art-panel" x="16" y="24" width="136" height="84" rx="12" />
      <path className="art-line" d="M16 50h136M52 14v16M116 14v16" />
      <rect className="art-dash" x="28" y="60" width="26" height="16" rx="4" />
      <rect className="art-dash" x="28" y="84" width="26" height="16" rx="4" />
      <Motif trade={trade} x={64} y={54} scale={0.6} />
    </>
  ),

  // No work on the board — jobs, my-work, kitchen tickets, tables.
  board: (trade) => (
    <>
      <rect className="art-panel" x="26" y="18" width="116" height="90" rx="10" />
      <rect className="art-wash-2" x="66" y="10" width="36" height="16" rx="6" />
      <path className="art-dash" d="M42 78h84M42 94h60" />
      <Motif trade={trade} x={42} y={28} scale={0.64} />
    </>
  ),

  // No money moved — expenses, daybook, reports, accounting, offers.
  // A note with a rupee on it, not the coin stack this was: three 18px-tall lozenges
  // left no room to draw a legible ₹, and a ₹ squeezed across them read as scribble.
  coins: (trade) => (
    <>
      <ellipse className="art-wash" cx="50" cy="96" rx="42" ry="10" />
      <rect className="art-panel" x="8" y="30" width="84" height="52" rx="8" />
      <circle className="art-wash-2" cx="50" cy="56" r="17" />
      <path className="art-brand-line" d="M42 48h16M42 54h16M52 48c6 0 6 10-5 10l12 10" />
      <Motif trade={trade} x={90} y={32} scale={0.56} />
    </>
  ),

  // Nobody on the list yet — customers, staff, suppliers.
  //
  // Two blank contact cards, NOT the two silhouettes this used to be: now that
  // every motif carries a figure of its own, a scene made of figures put four
  // people on one small picture and none of them meant anything.
  people: (trade) => (
    <>
      <rect className="art-panel" x="10" y="18" width="86" height="32" rx="8" />
      <circle className="art-line" cx="28" cy="34" r="8" />
      <path className="art-dash" d="M44 29h38M44 39h24" />
      <rect className="art-panel" x="10" y="60" width="86" height="32" rx="8" />
      <circle className="art-line" cx="28" cy="76" r="8" />
      <path className="art-dash" d="M44 71h38M44 81h24" />
      <Motif trade={trade} x={100} y={42} scale={0.6} />
    </>
  ),

  // The one that shows up mid-work: a filter matched nothing. Deliberately the
  // plainest scene in the set — a person here is hunting for a row, not for art.
  search: (trade) => (
    <>
      <path className="art-dash" d="M14 20h140M14 38h140" />
      {/* The pair stands OUTSIDE the lens now — it used to sit inside it, which only
          worked while a motif was one small object. Two dashed rows, not three: the
          third ran straight through the shopkeeper's head. */}
      <Motif trade={trade} x={8} y={54} scale={0.56} />
      <circle className="art-panel" cx="122" cy="76" r="28" />
      <circle className="art-line" cx="122" cy="76" r="24" />
      <path className="art-brand-line" d="M140 94 156 110" />
    </>
  ),
};

export const ILLUSTRATION_SCENES = Object.keys(SCENES);

/**
 * One picture for one empty screen.
 *
 * @param scene  which emptiness — see SCENES. An unknown name draws nothing
 *               rather than guessing: a wrong picture is worse than none.
 * @param trade  override the signed-in shop's business type. Only for previews
 *               and for the admin app, which has no shop of its own.
 * @param label  what a screen reader hears. Falsy = decorative, which is the
 *               right default: the <p> underneath already says it in words, and
 *               hearing the same sentence twice is not accessibility.
 */
export default function Illustration({ scene, trade, label, className = '' }) {
  const user = useDashboardUser();
  const key = trade || user?.businessType || DEFAULT_BUSINESS_TYPE;
  const draw = SCENES[scene];
  if (!draw) return null;
  return (
    <svg
      className={`empty-art ${className}`.trim()}
      viewBox="0 0 168 120"
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    >
      {draw(key)}
    </svg>
  );
}
