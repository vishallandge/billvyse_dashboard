/**
 * Scenes — the third axis of the theme system, and the one that changes how the
 * app FEELS rather than what colour its buttons are.
 *
 * ---------------------------------------------------------------------------
 * Three axes, not two
 * ---------------------------------------------------------------------------
 *     data-theme="dark|light"        MODE   — which end of the ramp
 *     data-accent="marigold|..."     ACCENT — the brand hue only  (lib/themes.js)
 *     data-scene="aurora|..."        SCENE  — the material of the whole app
 *
 * The accent picker shipped first and only ever swapped the brand hue: every one
 * of the eleven accents sat on the same near-black page, the same grey card and
 * the same hairline border, so switching theme moved a few percent of the pixels.
 * A scene owns the rest — the page field behind everything, whether a card is
 * glass or paper, how deep its shadow falls, how much film grain sits over the
 * whole thing, and how tight the corners are.
 *
 * ---------------------------------------------------------------------------
 * Where the actual look lives — NOT here
 * ---------------------------------------------------------------------------
 * This file carries only what the PICKER needs. The palettes themselves are
 * hand-written CSS at the end of app/globals.css (search for "SCENES"), which
 * is a deliberate difference from lib/themes.js:
 *
 *   an ACCENT is six tokens of the same six kinds every time  -> generate it
 *   a  SCENE  is ~30 tokens plus its own gradient, grain and radii, and the
 *             whole point is that no two are built the same    -> write it
 *
 * So globals.css is the source of truth for how a scene looks. The one thing
 * that MUST stay in step is the id list, which lives in four places:
 *
 *   1. this file                                (ids + preview swatches)
 *   2. frontend/lib/scenes.js                    (ids ONLY — deliberately not a
 *      byte-identical copy the way lib/themes.js is: the storefront has no
 *      picker to preview into, and its scenes are built on a different token
 *      vocabulary, so copying these hexes there would describe the wrong app)
 *   3. backend/config/scenes.js                 (ids only — server validates)
 *   4. each app's layout.js no-flash script     (both import their ids rather
 *      than re-typing them — see the note there about the accent list that went
 *      stale in BOTH apps when it was hand-written)
 *   5. the CSS blocks at the end of each app's globals.css
 *
 * ---------------------------------------------------------------------------
 * The preview swatches
 * ---------------------------------------------------------------------------
 * Each scene previews itself as a tiny screen — page ground, one card, the rail
 * down the left — rather than as three colour chips, because a scene is not a
 * colour and three chips would make five of them look interchangeable. The
 * values are read off the real CSS blocks; `edge` is the border, which is the
 * one place Mehfil's gold and Noir's white hairline visibly differ.
 *
 * `rail` is written as a plain hex even though the real sidebar mixes in the live
 * accent. The strip is thin and the mix is 5%: a shift that small is invisible
 * there, and hardcoding it keeps the picker from repainting every time the accent
 * changes underneath it.
 *
 * THESE VALUES MUST TRACK `--nav-bg`. They described a dark navy plank in BOTH
 * modes, which is what the rail used to be; the rail now derives from
 * --bg-elevated, so in light mode it is near-white. For a while every preview here
 * was drawing a sidebar the app no longer had — a picker that lies about what you
 * are about to pick, which is worse than no picker. If the sidebar's colour rule
 * changes again, these five pairs change with it.
 *
 * `wash2` is the second corner light. Once the rail stopped being the loud
 * difference between scenes, the FIELD became the only difference — and one wash
 * could not tell Aurora's blue-and-teal night apart from Mehfil's violet-and-gold
 * room. Two washes, at opposite corners, is the smallest thing that can.
 *
 * There is deliberately NO label or hint on these objects. Those are display
 * strings, they live in lib/i18n.js under seller.scene.<id>.*, and that is what
 * gives them all ten languages instead of only English. Keeping an English copy
 * here as well would be two sources of truth for one sentence — and the copy
 * nobody renders is always the one that goes stale.
 */

export const SCENES = [
  {
    id: 'aurora',
    preview: {
      dark: { page: '#0b0f1c', wash: 'rgba(110, 150, 255, 0.60)', wash2: 'rgba(34, 190, 200, 0.34)', card: '#1a2340', rail: '#172139', edge: 'rgba(160, 190, 255, 0.45)' },
      light: { page: '#edf1fb', wash: 'rgba(120, 120, 245, 0.30)', wash2: 'rgba(34, 170, 200, 0.20)', card: '#ffffff', rail: '#f4f7fc', edge: '#d3ddf0' },
    },
  },
  {
    id: 'noir',
    preview: {
      dark: { page: '#0b0b0d', wash: 'rgba(255, 255, 255, 0.14)', wash2: 'transparent', card: '#1b1b1f', rail: '#161a21', edge: 'rgba(255, 255, 255, 0.34)' },
      light: { page: '#f2f3f5', wash: 'rgba(15, 17, 21, 0.10)', wash2: 'transparent', card: '#ffffff', rail: '#f4f7fc', edge: '#c9ccd2' },
    },
  },
  {
    id: 'kagaz',
    preview: {
      dark: { page: '#15120d', wash: 'rgba(196, 140, 62, 0.46)', wash2: 'rgba(150, 96, 40, 0.30)', card: '#2a231a', rail: '#21201f', edge: 'rgba(235, 215, 180, 0.42)' },
      light: { page: '#f4efe4', wash: 'rgba(206, 158, 84, 0.42)', wash2: 'rgba(180, 130, 70, 0.22)', card: '#fffdf8', rail: '#f6f4ee', edge: '#ddd0b6' },
    },
  },
  {
    id: 'mehfil',
    preview: {
      dark: { page: '#120c1e', wash: 'rgba(160, 84, 220, 0.60)', wash2: 'rgba(242, 205, 132, 0.34)', card: '#241a3d', rail: '#1e1a39', edge: 'rgba(242, 205, 132, 0.70)' },
      light: { page: '#f3eef8', wash: 'rgba(150, 80, 215, 0.28)', wash2: 'rgba(214, 168, 84, 0.24)', card: '#ffffff', rail: '#f6f4fa', edge: '#d9c69a' },
    },
  },
  {
    id: 'prism',
    preview: {
      dark: { page: '#0d1518', wash: 'rgba(62, 211, 197, 0.42)', wash2: 'rgba(255, 126, 102, 0.28)', card: '#152327', rail: '#111d21', edge: 'rgba(119, 228, 216, 0.46)' },
      light: { page: '#eef7f6', wash: 'rgba(30, 172, 161, 0.22)', wash2: 'rgba(246, 121, 99, 0.16)', card: '#ffffff', rail: '#f4f9f8', edge: '#c8e3df' },
    },
  },
  {
    /**
     * The way back. Every shop that liked the app as it was on 2026-08-24 can have
     * exactly that, byte for byte — the CSS matches nothing for this id, so not one
     * scene rule applies. Listed last because it is the escape hatch, not the offer.
     */
    id: 'classic',
    preview: {
      dark: { page: '#101217', wash: 'rgba(255, 255, 255, 0.06)', wash2: 'transparent', card: '#1c2028', rail: '#1a202c', edge: 'rgba(255, 255, 255, 0.22)' },
      light: { page: '#eef0f4', wash: 'rgba(17, 24, 39, 0.05)', wash2: 'transparent', card: '#ffffff', rail: '#f4f7fc', edge: '#dfe2e8' },
    },
  },
];

/**
 * Aurora, not Classic.
 *
 * A default is a recommendation, and recommending the look the shopkeeper already
 * told us was flat would be a strange thing to ship. Mongoose defaults are not
 * applied retroactively, so this decides what a NEW shop opens on; an existing
 * shop has no appScene on file and resolves here through normalizeScene(), which
 * means the whole install moves to Aurora on the next load and can move back in
 * one click. That is the intended behaviour, not a side effect.
 */
export const DEFAULT_SCENE = 'aurora';
export const SCENE_IDS = SCENES.map((s) => s.id);

export function getScene(id) {
  return SCENES.find((s) => s.id === id) || SCENES[0];
}

/** Unknown or absent ids resolve to the default rather than rendering an unstyled app. */
export function normalizeScene(id) {
  return SCENE_IDS.includes(id) ? id : DEFAULT_SCENE;
}
