import { MOBILE_ROUTE_ID, recordHref } from './routeId';

/**
 * Where "up" goes from any screen in the dashboard.
 *
 * ---------------------------------------------------------------------------
 * Why this is a rule and not a prop on 60 pages
 * ---------------------------------------------------------------------------
 * Until now the way out of a screen was whatever each screen had remembered to build.
 * Five detail pages carried a `PageBack` link; five print pages carried a `router.back()`
 * button; the admin shop page carried a hand-typed "← Shops"; the other fifty screens
 * carried nothing at all. So the answer to "how do I get out of here" was different on
 * every screen, and on most screens the answer was "there isn't one" — which is exactly
 * what a shopkeeper means by "back button hi nahi hai".
 *
 * One rule, applied by the shell to every screen, is the only version of this that cannot
 * drift: a page added next week gets its way out without anybody remembering to add one.
 *
 * ---------------------------------------------------------------------------
 * The rule
 * ---------------------------------------------------------------------------
 * Up is NOT history. `router.back()` on the invoice screen returned you to the day book,
 * or to the bell, or to the khata, depending on how you arrived — the same button on the
 * same screen with a different answer each time. This walks the URL instead, so the
 * destination is a property of the SCREEN and can be named on the button before it is
 * pressed. "← Khata" is a promise; "← Back" is a lottery.
 *
 * Walking up the path, the first ancestor that is a real sidebar module wins:
 *
 *     /seller/khata/<id>                 → /seller/khata            ("Khata")
 *     /seller/khata/reminders            → /seller/khata            ("Khata")
 *     /seller/stores/transfer            → /seller/stores           ("Stores")
 *     /seller/reports                    → /seller                  ("Overview")
 *
 * `navItems` is the authority on what a module is, and the list handed in is already
 * filtered to what THIS user may open — so up never points a cashier at a screen that
 * would 403, and never at a module the operator has switched off.
 *
 * Three routes need an exception because the URL's own parent is not the screen a person
 * came from; they are listed below, with their reasons.
 */

/**
 * Routes where walking the path gives the wrong door.
 *
 * `parent` is a route PATTERN written the way the folder is named (so it may carry an
 * `[id]`), or a function of the current query when the same screen serves several kinds of
 * document. `labelKey` is used only when the destination is not itself a sidebar module —
 * a module labels itself, and a second copy of that label is a copy that drifts.
 *
 * A rule whose destination turns out to be unreachable for this user (a hidden module, a
 * revoked permission) falls through to the ordinary walk-up rather than offering a door
 * that opens onto a 403.
 */
const EXCEPTIONS = [
  // The two print screens hang off a purchase order, and the order — not the list — is
  // what the shopkeeper was reading ten seconds ago. Walking the path would skip it.
  {
    route: '/seller/purchase-orders/[id]/print',
    parent: '/seller/purchase-orders/[id]',
    labelKey: 'purchase.poBackLabel',
  },
  {
    route: '/seller/purchase-orders/[id]/supplier-bill',
    parent: '/seller/purchase-orders/[id]',
    labelKey: 'purchase.poBackLabel',
  },
  // One screen, four documents. `/seller/invoice` is not a module and never was — the
  // register a bill belongs to depends on what the document IS, which the screen already
  // reads out of the query string to decide what to print.
  {
    route: '/seller/invoice/[id]',
    parent: ({ src }) => {
      if (src === 'estimate') return '/seller/estimates';
      if (src === 'debitnote') return '/seller/purchase-returns';
      return '/seller/billing';
    },
  },
];

function segmentsOf(pathname) {
  // The mobile export is built with `trailingSlash: true`, so every path there arrives
  // with an empty last segment.
  return String(pathname || '')
    .split('?')[0]
    .split('/')
    .filter(Boolean);
}

function routeMatches(route, segments) {
  const parts = route.split('/').filter(Boolean);
  if (parts.length !== segments.length) return false;
  return parts.every((part, i) => part === '[id]' || part === segments[i]);
}

/**
 * The record id this URL is about, for a rule whose destination carries an `[id]`.
 *
 * Inside the Android bundle the path segment is the `view` sentinel and the real id
 * travels in the query string — see lib/routeId.js — so the caller's `id` (which came from
 * `useRouteId()`) wins whenever the path segment is that placeholder.
 */
function idFor(route, segments, queryId) {
  const parts = route.split('/').filter(Boolean);
  const at = parts.indexOf('[id]');
  if (at === -1) return '';
  const fromPath = segments[at];
  if (!fromPath || fromPath === MOBILE_ROUTE_ID) return queryId || '';
  return fromPath;
}

/**
 * @param pathname  the current route
 * @param navItems  the modules THIS user can open (already permission-filtered)
 * @param home      the role's first screen — `/seller` or `/admin`
 * @param id        the record on screen, from `useRouteId()`
 * @param src       the `?src=` of the invoice screen, ignored everywhere else
 * @returns {{ href: string, item?: object, labelKey?: string }|null}
 *          `item` set when the destination is a sidebar module, and then the caller
 *          labels it exactly as the sidebar does. null means there is nothing above this
 *          screen — the home screen itself, and anything outside the two consoles.
 */
export function parentOf(pathname, { navItems = [], home = '/seller', id = '', src = '' } = {}) {
  const segments = segmentsOf(pathname);
  if (!segments.length) return null;

  const path = `/${segments.join('/')}`;
  const root = `/${segments[0]}`;
  // The home screen has nothing above it, and neither has a screen outside the console
  // this shell is wrapping (login, the landing page).
  if (path === home || root !== home) return null;

  for (const rule of EXCEPTIONS) {
    if (!routeMatches(rule.route, segments)) continue;
    const target = typeof rule.parent === 'function' ? rule.parent({ src }) : rule.parent;
    const href = target.includes('[id]')
      ? recordHref(target, idFor(rule.route, segments, id))
      : target;
    const item = navItems.find((navItem) => navItem.href === target);
    if (item) return { href, item };
    if (rule.labelKey) return { href, labelKey: rule.labelKey };
    // Destination unreachable for this user — fall through and walk the path instead.
    break;
  }

  for (let depth = segments.length - 1; depth > 0; depth -= 1) {
    const candidate = `/${segments.slice(0, depth).join('/')}`;
    const item = navItems.find((navItem) => navItem.href === candidate);
    if (item) return { href: candidate, item };
  }

  // Nothing on the way up is open to this user, so the one screen that always is.
  return { href: home, labelKey: 'nav.overview' };
}
