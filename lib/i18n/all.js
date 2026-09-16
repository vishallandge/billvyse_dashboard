/**
 * Every language pack in one object — the shape lib/i18n.js used to export as `strings`.
 *
 * FOR TOOLING ONLY. NOTHING THE BROWSER LOADS MAY IMPORT THIS FILE.
 *
 * The whole point of splitting the dictionary into packs is that a shop downloads one
 * language instead of ten; a single static import of this barrel from anywhere inside
 * app/ would undo that silently and put roughly a megabyte back into every page load,
 * with nothing failing to tell anyone. The app reads strings through translate() in
 * lib/i18n.js, which loads packs on demand — there is no case in the UI for this file.
 *
 * What it exists for is the checks that have to see all ten at once: the backend tests
 * that assert the server and the dashboard agree on a piece of copy, and any script that
 * audits translation coverage. Those run in Node, where loading everything is free.
 */
import en from './packs/en.js';
import hi from './packs/hi.js';
import mr from './packs/mr.js';
import bn from './packs/bn.js';
import ta from './packs/ta.js';
import te from './packs/te.js';
import gu from './packs/gu.js';
import kn from './packs/kn.js';
import pa from './packs/pa.js';
import ur from './packs/ur.js';

export const strings = { en, hi, mr, bn, ta, te, gu, kn, pa, ur };

export default strings;
