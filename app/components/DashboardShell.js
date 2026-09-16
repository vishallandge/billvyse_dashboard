'use client';

import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { apiFetch } from '../../lib/api';
import { freshFetch, refresh, clearFreshCache } from '../../lib/freshFetch';
import { SkeletonLine, SkeletonCards, SkeletonTable } from './Skeleton';
import { clearLocalSessionState, getActiveStoreId, setActiveStoreId, takeJustSignedIn } from '../../lib/session';
import { getShopSocket } from '../../lib/socket';
import { useLanguage } from './LanguageProvider';
import { LANGUAGES } from '../../lib/i18n/meta';
import { notificationHeadline } from '../../lib/notifications';
import { useTheme } from './ThemeProvider';
import { useToast } from './Toast';
import {
  NavIcon, BellIcon, SearchIcon, SunIcon, MoonIcon, ChevronUpIcon, ChevronDownIcon, ChevronRightIcon, CalculatorIcon,
  ClockIcon, CheckCircleIcon, ListIcon, PanelToggleIcon, LockIcon, MenuIcon, HeadsetIcon,
} from './Icons';
import Calculator from './Calculator';
import Dropdown from './Dropdown';
import FullscreenToggle from './FullscreenToggle';
import PageUp from './PageUp';
import { ModuleNavigationContext } from './ModuleNavigationContext';
import NotificationPopover from './NotificationPopover';
import SupportPopover from './SupportPopover';
import { navItemForPath, supportTopicForNav } from '../../lib/sellerNav';
import AccountMenu from './AccountMenu';
import CommandPalette from './CommandPalette';
import BrandLogo from './BrandLogo';
import TooltipLayer from './Tooltip';
import GrowthProvider from './GrowthProvider';
import { GrowthBanners } from './CampaignCard';
import { requestUpgrade } from '../../lib/upgradeSignal';
import { businessType } from '../../lib/businessTypes';
import { formatDate, formatQty, formatRupees } from '../../lib/format';
import { recordHref } from '../../lib/routeId';

const SidebarTour = dynamic(() => import('./SidebarTour'));
const WelcomeOverlay = dynamic(() => import('./WelcomeOverlay'));
const PlanExpiryModal = dynamic(() => import('./PlanExpiryModal'));
const SupportSheet = dynamic(() => import('./SupportSheet'));
const ShopIdentityReminder = dynamic(() => import('./ShopIdentityReminder'));

// The seller sidebar has grown to 23 links across very different trades — a salon owner
// has no use for Purchase Orders, a kirana owner never opens Appointments. Bucketing them
// lets each group collapse instead of permanently hiding anything (every vertical can
// still reach every capability, per businessTypes.js's own rule).
// Grouped by the question the shopkeeper is answering when he reaches for the sidebar,
// and ordered inside each group by how often he actually taps it.
//
// The headerless group at the top is deliberately short: it is only the screens opened
// many times a day, so the first thing the eye lands on is never a wall of links. It used
// to carry ten entries — everything from Overview to Memberships — which made the busiest
// part of the sidebar the hardest part to scan.
//
// Three things moved for a reason: Catalog is a way of selling to a customer, not a shelf,
// so it sits with the customer screens; Loyalty likewise, since it is about a customer and
// not about cash; and Reports answers a money question, so it belongs beside the day book
// rather than next to Settings.
//
// `keys` is the order shown — see the sidebar render, which sorts by this list rather than
// by the order navItems happen to be declared in, so this is the one place that decides
// both grouping and sequence.
const NAV_GROUPS = [
  // Insights sits beside Overview rather than down in Money on purpose: the two together
  // are "how is the dukaan doing" — Overview answers it for today, Insights for the month —
  // and burying the graphical one under a collapsed group is how a dashboard nobody opens
  // gets built.
  // `estimates` sits right after billing: a quotation is the same cart as a bill, given
  // before the sale rather than at it, and anywhere further down the sidebar it reads as a
  // paperwork screen rather than part of the counter's day.
  // `advice` sits immediately after Overview and Insights, and that adjacency is the
  // point: those two answer "how is the dukaan doing" — today and this month — and Salah
  // answers the only question that follows, which is "so what do I do about it". Anywhere
  // further down and it reads as a report nobody opens.
  { id: 'sell', headerless: true, keys: ['overview', 'analytics', 'advice', 'notifications', 'reminders', 'billing', 'estimates', 'recurring', 'tables', 'kitchen', 'counters'] },
  { id: 'customers', labelKey: 'navGroup.customers', keys: ['khata', 'orders', 'appointments', 'jobs', 'memberships', 'catalog', 'loyalty', 'offers', 'campaigns'] },
  // `supply` sits last in Stock on purpose: the four before it are this shop BUYING, and it
  // is the same relationship seen from the other end — this shop SELLING to other shops on
  // the app. Anywhere else on the sidebar and it reads as a second, unrelated feature.
  //
  // It has to be listed here at all or it does not exist: this array, not navItems, decides
  // what the sidebar renders, so an item missing from it is simply invisible — which is
  // exactly how /seller/supply shipped unreachable except by typing the URL.
  { id: 'stock', labelKey: 'navGroup.stock', keys: ['inventory', 'savings', 'labels', 'suppliers', 'supplierLedger', 'purchaseOrders', 'purchaseReturns', 'supply'] },
  // `creditNotes` sits between the day book and the reports for the same reason
  // `purchaseReturns` sits after `purchaseOrders` in Stock: it is the paperwork side of
  // money that has already moved, and a shopkeeper reaches it while reconciling a month
  // rather than while standing at the till.
  { id: 'money', labelKey: 'navGroup.money', keys: ['expenses', 'daybook', 'creditNotes', 'reports', 'accounting'] },
  { id: 'business', labelKey: 'navGroup.business', keys: ['stores', 'centralInventory', 'transfers', 'staff', 'myWork'] },
  // `refer` sits immediately before `plan`, and that adjacency is the whole point: the
  // balance on the Refer screen is what pays for the plan on the next row. Anywhere else on
  // the sidebar it reads as a marketing page rather than as a way to stop paying.
  { id: 'insights', labelKey: 'navGroup.insights', keys: ['refer', 'plan', 'backup', 'settings', 'support'] },
];

// A salon/tailor/tuition centre runs on a diary, not a shelf — "Inventory" reads as the
// wrong word for what's really a service list. `sellsServices` shops get their own label
// without a second nav item, so nothing else (routing, permissions) has to change.
function navLabel(item, user, t) {
  if (item.key === 'inventory' && user && businessType(user.businessType).sellsServices) {
    return t('nav.inventoryService');
  }
  return t(`nav.${item.key}`);
}

/**
 * How many rows of any one kind the bell shows before it stops.
 *
 * The dropdown renders eleven groups — unbilled appointments, today's bookings, low
 * stock, expired, expiring, promises due, khata due, pending orders, payment claims,
 * backup — and it used to render every one of them in FULL. A shop with forty items
 * running low got forty rows in a 360px box, and the one thing at the top that says
 * what today's most expensive problem is scrolled away instantly. A notification list
 * that has to be scrolled is a notification list nobody reads.
 *
 * Three is enough to show the shape of a problem ("these three are nearly out"); the
 * rest is a job for the screen built for it, which is what the "+N more" row and the
 * View all link at the bottom lead to.
 */
const NOTIF_GROUP_MAX = 3;

function notifOverflow(list) {
  return Array.isArray(list) ? Math.max(0, list.length - NOTIF_GROUP_MAX) : 0;
}

function notifTop(list) {
  return Array.isArray(list) ? list.slice(0, NOTIF_GROUP_MAX) : [];
}

function formatClockTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

const DashboardUserContext = createContext(null);

export function useDashboardUser() {
  return useContext(DashboardUserContext);
}

// A shop's store list + which one is active — kept separate from DashboardUserContext so
// existing `useDashboardUser()` consumers (which expect the bare user object) don't need
// to change shape. Reports/Analytics use this to warn "this is every store combined" when
// there's more than one, since neither screen honors the store switcher (see storeRoutes /
// reportRoutes — attachStoreScope isn't in their middleware chain).
const DashboardStoresContext = createContext({ stores: [], activeStore: null });

/**
 * Widths for the placeholder menu rows in the boot frame. Uneven on purpose — a column of
 * identical bars reads as a loading graphic, while ragged ones read as a list of words,
 * which is what is actually arriving. Percentages rather than pixels so they shrink with
 * the rail when `data-rail` has collapsed the sidebar.
 */
const SHELL_BOOT_NAV = ['74%', '58%', '66%', '48%', '70%', '54%', '62%', '44%', '68%'];

/**
 * How long the brand splash takes to fade off the frame. Must match the transition on
 * `.boot-splash` in globals.css — this timer is only what unmounts the element afterwards,
 * so a shorter value here would cut the fade off halfway.
 */
const SPLASH_FADE_MS = 340;

export function useDashboardStores() {
  return useContext(DashboardStoresContext);
}

// The nav keys this shop cannot reach — a module switched off by the platform or the
// shop's plan, or a link its trade has no use for (see utils/navRelevance.js). The sidebar
// has always filtered on this; it lives in a context so that anything else offering a way
// into a screen — the dashboard's quick-action tiles above all — filters on the same list
// instead of showing a tile that lands on a 403.
const HiddenNavContext = createContext([]);

export function useHiddenNav() {
  return useContext(HiddenNavContext);
}

// The counts the sidebar puts on its own rows — low stock, khata due, pending orders and
// the rest (see backend/utils/navBadges.js for what earns one). Lifted into a context for
// the same reason `hiddenNav` was: the dashboard's quick-action tiles are a second way into
// those same screens, and a tile reading "Khata" while the menu row beside it reads
// "Khata 7" is two answers to one question. One object, so they cannot disagree.
const NavBadgeContext = createContext({});

export function useNavBadges() {
  return useContext(NavBadgeContext);
}

/**
 * Opening the support sheet from anywhere.
 *
 * The sheet itself is mounted once, by the shell, for the same reason the upgrade sheet is:
 * it has to be reachable from a screen that is mid-refusal, and a dialog owned by the page
 * that is failing is a dialog that unmounts with it. Everything else just asks.
 *
 *     const openSupport = useSupport();
 *     openSupport('plan');   // optional: preselects the topic
 *
 * Defaults to a no-op outside the shell (the login screens, the admin console) so a shared
 * component can call it without knowing which app it landed in.
 */
const SupportContext = createContext(() => {});

export function useSupport() {
  return useContext(SupportContext);
}

// A "jump to top" button that only appears once the page has actually scrolled a good
// way down — so it stays out of the way on short screens and only shows up on the long
// modules (inventory, catalog, khata, reports…) where scrolling back up is a chore.
function ScrollToTopButton() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    function onScroll() {
      setShow(window.scrollY > 600);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const { t } = useLanguage();

  return (
    <button
      type="button"
      className={`scroll-top-btn${show ? ' visible' : ''}`}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label={t('common.backToTop') || 'Back to top'}
      data-tip={t('common.backToTop') || 'Back to top'}
    >
      <ChevronUpIcon size={22} />
    </button>
  );
}

// The topbar search only looks through products and customers, so a back-office login
// (purchases / suppliers / kharcha only) has nothing to find there and the API would
// refuse it anyway — better to not show the box than to show one that never answers.
const SEARCH_PERMISSIONS = ['billing', 'inventory', 'khata'];

function canSearch(user) {
  if (!user) return false;
  if (user.role !== 'staff') return true;
  return Array.isArray(user.permissions) && user.permissions.some((p) => SEARCH_PERMISSIONS.includes(p));
}

/**
 * The four destinations that get a permanent tab on a phone, plus More.
 *
 * A drawer you have to open before you can go anywhere is a desktop sidebar wearing a
 * hamburger. On a phone the two or three screens a shopkeeper lives in should be one
 * thumb-reach away, always — that is the single thing that separates an app from a
 * website, and this dashboard did not have it.
 *
 * Which four is a question about the trade, not about us, so it reuses the answer the
 * app already has: `businessType().quickActions` is the per-trade priority list that
 * drives the dashboard's shortcut tiles. A salon leads with the appointment book, a
 * kirana with billing. Overview is pinned first regardless — it is the screen every
 * "where am I" instinct reaches for — and the retail defaults only fill the tail if the
 * trade list runs short or its entries are hidden for this shop.
 *
 * Everything not in the four is still one tap away behind More, which opens the same
 * drawer as the hamburger. Nothing becomes unreachable.
 */
function bottomNavItems(navItems, user, hiddenNav) {
  const trade = businessType(user?.businessType).quickActions || [];
  const order = ['overview', ...trade, 'billing', 'khata', 'inventory', 'orders'];
  const picked = [];
  for (const key of order) {
    if (picked.length >= 4) break;
    if (picked.some((item) => item.key === key)) continue;
    const item = navItems.find((navItem) => navItem.key === key);
    if (item && canSeeNavItem(item, user, hiddenNav)) picked.push(item);
  }
  return picked;
}

/**
 * What this trade would hide, worked out in the browser.
 *
 * The server decides this properly (utils/navRelevance.js — it can also see whether the shop
 * has real data in that category), but the server's answer arrives one request late and
 * `/api/seller/modules` is allowed to fail. Both of those used to end the same way: the
 * sidebar rendered with NOTHING hidden, so a kirana was shown "Tables" and "Kitchen" — on
 * first paint every single time, and permanently if that one request ever failed. A shopkeeper
 * demonstrating the app to a customer saw a KOT screen in a general store's menu.
 *
 * So the trade default is now the starting position rather than "show everything", and the
 * server's fuller answer replaces it when it lands. Worst case is a link briefly missing that
 * the shop does use — recoverable, one second long, and far cheaper than the opposite.
 */
function tradeHiddenNav(user) {
  if (!user || user.role === 'superadmin') return [];
  const trade = businessType(user.businessType);
  const hidden = [];
  if (!trade.runsTables) hidden.push('tables', 'kitchen');
  if (!trade.booksAppointments) hidden.push('appointments');
  if (!trade.usesJobBoard) hidden.push('jobs');
  if (!trade.usesMemberships) hidden.push('memberships');
  if (!trade.givesEstimates) hidden.push('estimates');
  /**
   * Only the trade-exclusive six. The goods screens and the multi-store pair are
   * deliberately NOT decided here, even though the trade hints at them: whether a salon has
   * shampoo on a shelf or a shop has a second branch is something only the server can see,
   * and this list is unioned with the server's — so a blanket rule here would permanently
   * take Inventory and Suppliers away from the salon that actually sells things.
   */
  return hidden;
}

function canSeeNavItem(item, user, hiddenNav) {
  if (!user) return false;
  if (user.role !== 'staff') {
    // The inverse of staffVisible: a screen that only makes sense to the person being
    // recorded, never to the person doing the recording.
    if (item.staffOnly) return false;
    if (hiddenNav?.includes(item.key)) return false;
    return true;
  }
  if (item.staffOnly) return true;
  if (!item.staffVisible) return false;
  if (!item.permission) return true;
  if (hiddenNav?.includes(item.key)) return false;
  return Array.isArray(user.permissions) && user.permissions.includes(item.permission);
}

/**
 * "Yahan, aur itne." — the count on a menu item.
 *
 * Every number here already existed: the shop computes low stock, expiry, khata due,
 * pending orders and the rest for the bell (see backend/utils/navBadges.js). Reading them
 * meant opening the bell and reading eleven groups of prose, so a shopkeeper who had not
 * opened it had no idea which screen wanted him today. This is the cheapest sentence in
 * software — it says where and how many without being read at all.
 *
 * Three decisions worth keeping:
 *
 *  - **Nothing to do renders nothing.** Not a zero. The server strips empties, and this
 *    returns null on anything falsy, so a quiet shop has a plain sidebar.
 *  - **Capped at 99+.** A four-digit badge stops being a number and becomes a shape, and
 *    it is the one element on the sidebar that must not change the width of its row.
 *  - **It carries a label for a screen reader.** "12" next to "Inventory" is meaningless
 *    read aloud; "Inventory, 12 need attention" is the whole point of the badge, in words.
 */
function NavBadge({ count, t }) {
  if (!count || count < 1) return null;
  return (
    <span className="nav-badge" aria-label={t('nav.badgeLabel', { n: count })}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

export default function DashboardShell({ role, navItems, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t, lang, setLang } = useLanguage();
  const { theme, toggleTheme, adoptServerAccent, adoptServerScene } = useTheme();
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);
  const [stores, setStores] = useState([]);
  const [activeStore, setActiveStore] = useState(null);
  // Navigation feedback must not invalidate every page reading the store context.
  const storeContext = useMemo(() => ({ stores, activeStore }), [stores, activeStore]);
  /**
   * The brand splash, which sits OVER the boot frame rather than instead of it.
   *
   * The version of this that was here before was the whole screen: a shopkeeper saw the
   * brand, then the brand was replaced by a skeleton, then the skeleton was replaced by
   * data — three full repaints, nothing surviving any of them. That is what made the app
   * feel like it was hesitating.
   *
   * Now the frame below is drawn and painted first and the splash is a fixed layer on top
   * of it. When the session resolves the splash fades out and what is underneath is already
   * there, in its final position — so the brand moment costs nothing in movement. Nothing
   * jumps, because nothing moves at all; a layer is simply removed.
   */
  const [splashDone, setSplashDone] = useState(false);
  const [splashLeaving, setSplashLeaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navigationPending, startNavigation] = useTransition();
  const [openingModule, setOpeningModule] = useState(null);
  const [loadingRoute, setLoadingRoute] = useState(null);
  const routeLoading = loadingRoute?.pathname === pathname;
  const openingHref = openingModule?.href || (routeLoading ? pathname : null);
  const warmedModules = useRef(new Map());

  useEffect(() => {
    if (!openingModule || routeLoading) return;
    // A newer destination can finish while an older transition is still settling.
    if (pathname === openingModule.href || !navigationPending) setOpeningModule(null);
  }, [pathname, openingModule, navigationPending, routeLoading]);

  const warmModule = useCallback((item) => {
    // Next disables route prefetch in development, where pages compile on first use.
    if (process.env.NODE_ENV === 'development' || !item || !navigator.onLine) return;
    const connection = navigator.connection;
    if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return;
    const now = Date.now();
    if (now - (warmedModules.current.get(item.href) || 0) < 30000) return;
    warmedModules.current.set(item.href, now);
    try {
      router.prefetch(item.href, { kind: 'full' });
    } catch {
      warmedModules.current.delete(item.href);
    }
  }, [router]);

  function openModule(event, item) {
    // Preserve browser shortcuts and opening links in another tab.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.currentTarget.target && event.currentTarget.target !== '_self') return;
    event.preventDefault();
    setMenuOpen(false);
    if (openingModule?.href === item.href) return;
    if (pathname === item.href && !openingModule) return;
    // Clicking the current page while another destination loads cancels that trip.
    setOpeningModule(pathname === item.href ? null : item);
    startNavigation(() => router.push(item.href));
  }

  const [notifications, setNotifications] = useState(null);
  /**
   * The counts the sidebar puts on its own items.
   *
   * Read off the same `/api/seller/notifications` response the bell already loads and
   * already refreshes — on mount, on the socket events that change any of these, and on
   * the app's own `dukaan:notificationsChanged`. So a badge clears the moment the thing
   * behind it is dealt with, without one extra request or one extra listener.
   */
  /**
   * The superadmin's own badge source.
   *
   * Kept apart from `notifications` rather than folded into it, because that object is also
   * the bell's whole feed — unread counts, eleven alert groups, the headline banner — and
   * an admin payload carrying only badges would leave the bell rendering an empty feed as
   * if the shop genuinely had nothing to report. Two shapes, two states.
   */
  const [adminBadges, setAdminBadges] = useState(null);
  // Memoised on the response's own object rather than rebuilt every render: this is a
  // context value now, and a fresh `{}` each time would re-render every consumer of it on
  // every state change anywhere in the shell.
  const navBadges = useMemo(
    () => notifications?.navBadges || adminBadges?.navBadges || {},
    [notifications?.navBadges, adminBadges?.navBadges]
  );
  // Which module this page is — the support shortcut names it and preselects its topic.
  // Prefix-matched (a khata record page is still Khata), unlike `currentNavItem` below, which
  // the mobile title matches exactly.
  const supportNavItem = useMemo(() => navItemForPath(navItems, pathname), [navItems, pathname]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  // null = closed. Otherwise the topic to open on ('' for none) — see useSupport above.
  const [supportTopic, setSupportTopic] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const [cancellingDeletion, setCancellingDeletion] = useState(false);
  const [moduleInfo, setModuleInfo] = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [showTour, setShowTour] = useState(false);
  const [welcome, setWelcome] = useState(null);
  const [planExpiryPopup, setPlanExpiryPopup] = useState(null);
  const [myAttendance, setMyAttendance] = useState(null);
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [railed, setRailed] = useState(false);
  const allowedRoles = Array.isArray(role) ? role : [role];
  /**
   * What this shop does not show, from both ends.
   *
   * A UNION, not a fallback. Reading the server's list "or" the local one was still wrong in
   * the only case that matters: an empty array from the server is a perfectly truthy value, so
   * one stale or partial answer put a kitchen ticket screen back into a pharmacy's sidebar.
   * The trade rule is applied here as well, so a medical store cannot be shown Tables by any
   * combination of server state, cache or race.
   *
   * The one thing that overrides the local rule is the owner's own "show me this" from
   * Settings → Screens, which the server reports back in `screenPrefs.shown`.
   */
  const hiddenNav = useMemo(() => {
    const shown = new Set(moduleInfo?.screenPrefs?.shown || []);
    const merged = new Set(moduleInfo?.hiddenNav || []);
    for (const key of tradeHiddenNav(user)) {
      if (!shown.has(key)) merged.add(key);
    }
    return [...merged];
  }, [moduleInfo, user]);

  /**
   * Screens this shop could have today by paying for them.
   *
   * navKey -> the plan feature that unlocks it, decided entirely by the server (see
   * getMyModules): it applies the trade rule and the owner's own Settings → Screens list
   * FIRST and only then reports what is left standing behind the plan. So this can never put
   * a KOT screen into a pharmacy's menu, whatever the plan says — a lock is only ever drawn
   * on a screen the shop would otherwise be entitled to see.
   *
   * Empty when the operator has switched teasing off in Admin → Growth → Rules, in which
   * case locked screens go back to being hidden outright.
   */
  const lockedNav = moduleInfo?.lockedNav || {};
  const lockedKeys = useMemo(() => Object.keys(lockedNav), [lockedNav]);

  /**
   * The sidebar teases a locked screen; the phone bar and the command palette do not.
   *
   * Those two are pure navigation — four icons under a shopkeeper's thumb mid-sale, and a
   * keyboard jump for someone who already knows where they are going. A lock in either is a
   * tap or a keystroke that lands on a wall, which is not a discovery moment, it is a
   * misfire. The sidebar is where a shop browses what the app can do, so that is where the
   * lock belongs.
   */
  const navHiddenAndLocked = useMemo(() => [...hiddenNav, ...lockedKeys], [hiddenNav, lockedKeys]);

  /*
   * The modules this user can actually open, with the same rule the bottom bar and the
   * palette use — a plan lock or a switched-off module is not a door.
   *
   * Shared by the palette and by the up-link, and that sharing is the point: a second copy
   * of an access check is the copy that drifts, and here the drift would show up as a way
   * out of a screen that lands on a 403.
   */
  const reachableNav = useMemo(
    () => navItems.filter((item) => canSeeNavItem(item, user, navHiddenAndLocked)),
    [navItems, user, navHiddenAndLocked]
  );

  // Opens the same sheet a refused API call would have opened, from a click instead of a
  // 402 — one component, one look, whichever way the shop arrives at the wall.
  function openLock(navKey) {
    requestUpgrade({ feature: lockedNav[navKey] || '', code: 'PLAN_UPGRADE_REQUIRED' });
  }

  /**
   * Everything that needs him and is NOT one of the five icons on the phone's bottom bar.
   *
   * Below `hiddenNav` and not beside `navBadges`, which is where it started: it reads that
   * list, and a `const` read before its own declaration is a ReferenceError that takes the
   * entire shell — every screen behind it — down with it. Caught by rendering the sidebar,
   * never by reading the diff.
   *
   * Computed against the bar's own item list rather than a hand-kept list of "the rest", so
   * a change to `bottomNavItems` can never leave a module silently unbadged on a phone —
   * which is the only place most of these screens are ever opened.
   */
  const onBottomBar = new Set(bottomNavItems(navItems, user, hiddenNav).map((item) => item.key));
  const hiddenBadgeTotal = Object.entries(navBadges).reduce(
    (sum, [key, n]) => (onBottomBar.has(key) ? sum : sum + n),
    0
  );

  // The sidebar, collapsed to a strip of icons.
  //
  // 232px is a tenth of a 1366-wide shop laptop, spent permanently on a menu whose
  // 23 links a shopkeeper who bills all day already knows by heart. Collapsing hands
  // that width back to the tables that were scrolling sideways without it — and,
  // paired with the fullscreen button in the topbar, turns the browser into something
  // that reads as a till rather than a website.
  //
  // The truth lives on <html data-rail>, not in this state, because the pre-hydration
  // script in layout.js has to be able to set it before React exists — otherwise the
  // first paint is 232px wide and the page jumps sideways a tick later. This state is
  // only React's mirror of it, read once on mount.
  //
  // Deliberately not offered below 901px: down there the sidebar is already a drawer
  // that takes no permanent width, so there would be nothing to collapse.
  useEffect(() => {
    setRailed(document.documentElement.getAttribute('data-rail') === '1');
  }, []);

  // Below 901px the same <aside> is a slide-over drawer, where "collapsed to icons"
  // would be meaningless. The CSS is gated on that width already; this mirrors the
  // gate into JS so the handful of decisions React makes about the rail (force the
  // nav groups open, swap the footer for its icon version) agree with what is
  // actually on screen instead of following a preference set on a different device.
  const [wideScreen, setWideScreen] = useState(true);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 901px)');
    function sync() {
      setWideScreen(query.matches);
    }
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  const railActive = railed && wideScreen;

  function toggleRail() {
    setRailed((prev) => {
      const next = !prev;
      const el = document.documentElement;
      if (next) el.setAttribute('data-rail', '1');
      else el.removeAttribute('data-rail');
      try {
        localStorage.setItem('dukaan_sidebar_rail', next ? '1' : '0');
      } catch {
        // localStorage unavailable — the choice just won't survive a reload
      }
      return next;
    });
  }

  useEffect(() => {
    setMenuOpen(false);
    setNotifOpen(false);
    setPaletteOpen(false);
  }, [pathname]);

  // ⌘K / Ctrl-K opens the palette from anywhere in the app, and "/" does too — the
  // shortcut every shopkeeper already knows from WhatsApp Web and YouTube.
  //
  // "/" is guarded on the event target: it is a printable character, so taking it
  // while someone is typing a product name would swallow the slash out of "1/2 kg".
  // The modifier form has no such problem and is left unguarded on purpose, so it
  // works mid-bill without having to click out of the field first.
  useEffect(() => {
    function onKeyDown(event) {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key !== '/' || modifier || event.altKey) return;
      const target = event.target;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      // Not over a dialog: "/" inside an open modal belongs to whatever that modal is
      // doing, and stacking the palette on top of a half-filled form loses the form.
      if (document.querySelector('.modal-overlay, .calc-overlay')) return;
      event.preventDefault();
      setPaletteOpen(true);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Picks which nav groups start collapsed the first time this shop's owner ever opens
  // the dashboard (appointment-led trades start with Stock/Multi-Store tucked away, since
  // they rarely touch purchase orders or supplier ledgers); any manual toggle after that
  // is remembered per shop so the default never overrides a real choice.
  useEffect(() => {
    if (!user || user.role === 'superadmin') return;
    const storageKey = `dukaan_navgroups_${user.id}`;
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(storageKey));
    } catch {
      stored = null;
    }
    if (stored && typeof stored === 'object') {
      setCollapsedGroups(stored);
    } else {
      setCollapsedGroups(businessType(user.businessType).booksAppointments ? { stock: true, business: true } : {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function toggleNavGroup(groupId) {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [groupId]: !prev[groupId] };
      if (user) {
        try {
          localStorage.setItem(`dukaan_navgroups_${user.id}`, JSON.stringify(next));
        } catch {
          // localStorage unavailable (private mode etc.) — collapse state just won't persist
        }
      }
      return next;
    });
  }

  useEffect(() => {
    if (!user || user.role === 'superadmin') return;
    // `pathname` stays in the deps — a count has to clear the moment its queue clears.
    // freshFetch is what makes that affordable: this endpoint runs ~20 reads plus an
    // aggregate over the shop's payment history, and it was doing all of it again on every
    // single click in the sidebar. See lib/freshFetch.js.
    freshFetch('/api/seller/notifications')
      .then(setNotifications)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, pathname]);

  /**
   * The other half of the line above: superadmin has no `/api/seller/notifications` and so
   * had no sidebar numbers at all. It gets exactly one — how many shopkeepers have written
   * in and not been answered — from a two-count endpoint, refreshed on navigation like the
   * seller's feed so it clears the moment the queue is cleared.
   */
  useEffect(() => {
    if (!user || user.role !== 'superadmin') return;
    freshFetch('/api/admin/support/badge')
      .then(setAdminBadges)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, pathname]);

  /**
   * Support screens change the badge's answer without a navigation — a reply sent, a ticket
   * opened — so they fire `support:badge` and this refetches right away. Plain apiFetch, not
   * freshFetch: the whole point is to skip the cached copy.
   */
  useEffect(() => {
    if (!user) return undefined;
    function refresh() {
      if (user.role === 'superadmin') {
        apiFetch('/api/admin/support/badge').then(setAdminBadges).catch(() => {});
      } else {
        apiFetch('/api/seller/notifications').then(setNotifications).catch(() => {});
      }
    }
    window.addEventListener('support:badge', refresh);
    return () => window.removeEventListener('support:badge', refresh);
  }, [user]);

  // Staff logins never reach the Staff page (it's seller-only), so their own check-in/out
  // button lives in the topbar instead — the one surface every staff permission set reaches.
  useEffect(() => {
    if (!user || user.role !== 'staff') return;
    apiFetch('/api/seller/staff/attendance/me')
      .then((data) => setMyAttendance(data.attendance))
      .catch(() => {});
  }, [user]);

  async function toggleMyAttendance() {
    setAttendanceBusy(true);
    const action = myAttendance?.checkIn ? 'check-out' : 'check-in';
    try {
      const data = await apiFetch(`/api/seller/staff/attendance/${action}`, { method: 'POST' });
      setMyAttendance(data.attendance);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAttendanceBusy(false);
    }
  }

  // Pushes a live nudge the moment a customer taps "I've paid" on their khata balance —
  // without this, a shop only finds out on their next page navigation (when the polling
  // effect above re-fires), which could be minutes away if they're mid-billing.
  useEffect(() => {
    if (!user || user.role === 'superadmin') return;
    const socket = getShopSocket();
    if (!socket) return;

    // refresh(), not freshFetch(): a customer just tapped "I've paid", so the cached count
    // is known to be wrong and this is exactly the event the TTL must not swallow.
    function refreshNotifications() {
      refresh('/api/seller/notifications')
        .then(setNotifications)
        .catch(() => {});
    }

    function onClaim(payload) {
      toast.success(t('notifications.paymentClaimToast', { name: payload.customerName, amount: payload.amount }));
      refreshNotifications();
    }

    function onPromise(payload) {
      toast.success(t('notifications.promiseToast', {
        name: payload.customerName,
        date: new Date(payload.date).toLocaleDateString(),
      }));
      refreshNotifications();
    }

    socket.on('paymentClaim:new', onClaim);
    socket.on('paymentPromise:new', onPromise);
    return () => {
      socket.off('paymentClaim:new', onClaim);
      socket.off('paymentPromise:new', onPromise);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Start the fade the moment the session is known, then unmount once it has finished.
  useEffect(() => {
    if (!checked || splashDone) return undefined;
    setSplashLeaving(true);
    const id = setTimeout(() => setSplashDone(true), SPLASH_FADE_MS);
    return () => clearTimeout(id);
  }, [checked, splashDone]);

  // Freeze the page behind any open overlay — a dialog, or the mobile nav drawer.
  //
  // Every dialog in this app is a fixed, full-screen .modal-overlay that scrolls on its
  // own, so while one is open the browser draws two scrollbars side by side — the page's
  // and the dialog's — and the page underneath keeps scrolling once the dialog runs out.
  // Locking the document removes both problems at once. The drawer is in here for the
  // touch half of the same problem: a swipe anywhere beside the open menu dragged the
  // whole app up and down behind it.
  //
  // Driven by a MutationObserver rather than by each dialog, because the ~30 dialogs are
  // rendered inline across two dozen pages and there is no single component they all pass
  // through. The state is recomputed from what is actually in the DOM every time, never
  // incremented and decremented, so it cannot drift out of sync and leave the page
  // permanently unscrollable — the failure a counter-based lock is prone to. Safe because
  // every overlay is conditionally rendered or returns null when closed; none is ever
  // parked in the DOM while hidden.
  useEffect(() => {
    const root = document.documentElement;

    function sync() {
      const open = menuOpen || Boolean(document.querySelector('.modal-overlay, .calc-overlay'));
      const locked = root.classList.contains('modal-open');
      if (open === locked) return;

      if (open) {
        // Hiding the page's overflow takes its scrollbar away with it, and everything
        // underneath would jump sideways by that width. Measure it while it's still there
        // and hand the same width back as padding.
        const barWidth = window.innerWidth - root.clientWidth;
        if (barWidth > 0) document.body.style.paddingRight = `${barWidth}px`;
        root.classList.add('modal-open');
      } else {
        root.classList.remove('modal-open');
        document.body.style.paddingRight = '';
      }
    }

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();

    return () => {
      observer.disconnect();
      root.classList.remove('modal-open');
      document.body.style.paddingRight = '';
    };
    // menuOpen is a dependency rather than a ref: re-running rebuilds one MutationObserver,
    // which is far cheaper than the alternative of widening the observer to watch class
    // attributes across the whole subtree just to notice the drawer opening.
  }, [menuOpen]);

  // Listen for programmatic notification changes from other pages/components
  useEffect(() => {
    // Something in the app changed the feed, so the cached copy is stale by definition.
    function refreshNotifications() {
      refresh('/api/seller/notifications')
        .then(setNotifications)
        .catch(() => {});
    }
    window.addEventListener('dukaan:notificationsChanged', refreshNotifications);
    return () => window.removeEventListener('dukaan:notificationsChanged', refreshNotifications);
  }, []);

  useEffect(() => {
    if (!user || user.role === 'superadmin') return;
    // Drives which sidebar links are hidden (module switched off by the platform admin or by
    // plan, a screen this trade has no use for, or one the shop switched off itself in
    // Settings → Screens) and the maintenance/announcement/plan-expiry banners at the top of
    // the shell.
    function loadModules(force) {
      // A minute, rather than the default twenty seconds: this decides which sidebar links
      // exist, and that only changes when the platform admin, the plan or Settings > Screens
      // changes it — each of which fires the event below and forces a re-read anyway.
      (force ? refresh('/api/seller/modules') : freshFetch('/api/seller/modules', { ttl: 60000 }))
        .then((data) => {
          setModuleInfo(data);
          maybeShowPlanExpiryPopup(data.planExpiry, user);
        })
        // Left deliberately silent, but no longer harmless-by-accident: with no answer the
        // sidebar falls back to this trade's own defaults rather than to "show everything".
        // See tradeHiddenNav.
        .catch(() => {});
    }
    loadModules();
    // Ticking a screen off in Settings has to redraw the menu now, not on the next
    // navigation — the whole point of that panel is watching the link disappear. Hence the
    // forced re-read: this is the one caller that must never be answered from the cache.
    function reloadModules() {
      loadModules(true);
    }
    window.addEventListener('dukaan:screensChanged', reloadModules);
    return () => window.removeEventListener('dukaan:screensChanged', reloadModules);
  }, [user, pathname]);

  // The renewal popup is only worth interrupting the shopkeeper for once a day while the
  // plan is counting down (a per-day localStorage flag), and exactly once the moment it
  // actually lapses (keyed to that expiry's own date, so a later renewal-and-relapse
  // shows it again instead of staying silent forever). After that, the persistent "you're
  // on Free" banner above carries the reminder without popping up over the shopkeeper's
  // work every time they open the app.
  function maybeShowPlanExpiryPopup(info, currentUser) {
    if (!info || !currentUser) return;
    try {
      if (info.status === 'expired') {
        const seenKey = `dukaan_plan_expired_seen_${currentUser.id}_${info.expiresAt}`;
        if (localStorage.getItem(seenKey) === '1') return;
        localStorage.setItem(seenKey, '1');
      } else if (info.status === 'expiring') {
        const dismissKey = `dukaan_plan_expiry_dismissed_${currentUser.id}`;
        if (localStorage.getItem(dismissKey) === new Date().toDateString()) return;
      }
      setPlanExpiryPopup(info);
    } catch {
      // localStorage unavailable — popup just won't show
    }
  }

  function dismissPlanExpiryPopup() {
    try {
      if (planExpiryPopup?.status === 'expiring') {
        localStorage.setItem(`dukaan_plan_expiry_dismissed_${user.id}`, new Date().toDateString());
      }
    } catch {
      // localStorage unavailable — nothing to persist, popup just closes for this load
    }
    setPlanExpiryPopup(null);
  }


  useEffect(() => {
    let active = true;
    apiFetch('/api/auth/me')
      .then(({ user: currentUser, impersonatedBy }) => {
        if (!active) return;
        if (!allowedRoles.includes(currentUser.role)) {
          router.replace(currentUser.role === 'superadmin' ? '/admin' : '/seller');
          return;
        }
        setUser(currentUser);
        setImpersonating(Boolean(impersonatedBy));
        setChecked(true);
        // The shop's colour is authoritative over whatever this device had cached — it
        // follows the shopkeeper to a new phone, and staff inherit the owner's (resolved
        // server-side in /auth/me). No-ops if they've already picked one this session.
        adoptServerAccent(currentUser.appTheme);
        // Same for the scene. A shop that has never met the picker has no appScene on
        // file, so this is called with undefined and the provider keeps the default —
        // which is the point, not an oversight.
        adoptServerScene(currentUser.appScene);

        // One-shot flag set by the register wizard right after signup — consuming it here
        // (rather than a permanent "seen" flag) means only a genuinely brand-new shop ever
        // gets this popup; an existing owner's next login is never interrupted by it.
        try {
          const pendingKey = `dukaan_sidebar_tour_pending_${currentUser.id}`;
          if (localStorage.getItem(pendingKey) === '1') {
            localStorage.removeItem(pendingKey);
            setShowTour(true);
            // A brand-new shop is already getting the tour and the onboarding banner;
            // a third greeting stacked on those is a queue, not a welcome. The flag is
            // still consumed below so it cannot fire on the next navigation instead.
            takeJustSignedIn();
          } else if (takeJustSignedIn()) {
            setWelcome({ name: currentUser.name, shopName: currentUser.shopName });
          }
        } catch {
          // localStorage unavailable — tour just won't show, nothing to fall back to
        }

        if (currentUser.role === 'staff' && pathname === '/seller') {
          const firstAllowed = navItems.find((item) => canSeeNavItem(item, currentUser));
          if (firstAllowed) router.replace(firstAllowed.href);
        }

        // Staff never get the switcher, store-assigned or not — attachStoreScope locks an
        // unassigned staff login to the shop's default store rather than letting them pick,
        // so showing a picker that silently does nothing would just be confusing.
        if (currentUser.role !== 'superadmin' && currentUser.role !== 'staff') {
          apiFetch('/api/seller/stores')
            .then(({ stores: shopStores }) => {
              if (!active) return;
              setStores(shopStores);
              const stored = getActiveStoreId();
              const match = shopStores.find((s) => s._id === stored);
              const fallback = shopStores.find((s) => s.isDefault) || shopStores[0];
              setActiveStore(match || fallback || null);
              if (!match && fallback) setActiveStoreId(fallback._id);
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        clearLocalSessionState();
        router.replace('/login');
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, router]);

  async function handleLogout() {
    // A round trip now, not a localStorage wipe: the session is an httpOnly cookie, so only
    // the server can actually end it. Clearing local state first means a failed or slow
    // logout still leaves the tab in a signed-out state rather than half-signed-in.
    clearLocalSessionState();
    // The next person to sign in at this counter must not inherit this shop's counts.
    clearFreshCache();
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    router.replace('/login');
  }

  async function handleExitImpersonation() {
    // The admin's own session lives in a second httpOnly cookie that only the server can
    // read and swap back. It used to be a client-side exchange of two localStorage strings,
    // which meant a superadmin token sat in readable storage for the whole support session.
    try {
      await apiFetch('/api/admin/stop-impersonation', { method: 'POST' });
      clearLocalSessionState();
      router.replace('/admin/sellers');
      router.refresh();
    } catch {
      // The admin cookie expired underneath us — the server has already cleared what was
      // left, so there is nowhere to return to except a fresh login.
      router.replace('/login');
    }
  }

  /**
   * Stop the account from being deleted.
   *
   * Lives in the shell rather than in Settings on purpose. An owner who marked the dukaan
   * for deletion on Tuesday and changes his mind on Friday will be standing at the billing
   * counter, not in Settings — and a way back that has to be gone looking for is not a way
   * back at all. So the strip is on every screen, and so is this button.
   */
  async function handleCancelDeletion() {
    setCancellingDeletion(true);
    try {
      await apiFetch('/api/auth/account/cancel-deletion', { method: 'POST' });
      // Re-read rather than clearing the date by hand: the server is the one that decides
      // whether the deletion is really off, and a strip that vanishes on an optimistic guess
      // is the worst possible lie to tell about this particular thing.
      const { user: fresh } = await apiFetch('/api/auth/me');
      setUser(fresh);
    } catch {
      // Left standing with the button still live. The account is still marked, which is the
      // truth, and pressing again is the right next move.
    } finally {
      setCancellingDeletion(false);
    }
  }

  // The tail of a capped group: says how many were left out and goes to the screen
  // that shows them all. Renders nothing when the group fitted, so a shop with two
  // low-stock items never sees a "+0 more".
  function notifMore(list, href) {
    const extra = notifOverflow(list);
    if (extra === 0) return null;
    return (
      <button
        type="button"
        className="notif-item notif-more"
        onClick={() => { router.push(href); setNotifOpen(false); }}
      >
        <span>{t('notifications.andMore', { count: extra })}</span>
        <ChevronRightIcon size={14} />
      </button>
    );
  }

  /**
   * Opens the support sheet, optionally on a topic. Handed down through SupportContext, so
   * a screen that has just refused something ("this needs a paid plan", "the printer did
   * not answer") can put a human one tap away without owning a dialog of its own.
   *
   * `useCallback` because it is a context value: without it every shell render would hand
   * every consumer a new function and re-render the lot.
   */
  const openSupport = useCallback((topic = '') => setSupportTopic(typeof topic === 'string' ? topic : ''), []);

  function handleStoreChange(storeId) {
    setActiveStoreId(storeId);
    // A hard reload: every seller page fetches its data in a client-side useEffect that
    // already ran once on mount, and router.refresh() only re-renders server components —
    // it doesn't re-trigger those fetches. Without this, a cashier who switches stores
    // mid-session keeps billing against the OLD store's stock numbers, already loaded in
    // memory, until they happen to navigate away and back.
    window.location.reload();
  }

  /**
   * The splash layer. Rendered in BOTH branches below — over the boot frame while the
   * session is unknown, and then over the real shell for the length of its fade, so it is
   * never torn out mid-transition. `aria-hidden` because it is decoration: the boot frame
   * carries the one line a screen reader should hear.
   */
  const bootSplash = splashDone ? null : (
    <div className={`boot-splash${splashLeaving ? ' is-leaving' : ''}`} aria-hidden="true">
      <div className="splash-loader">
        <div className="splash-badge">
          <BrandLogo size={52} className="splash-mark" />
          <span className="splash-spinner" />
        </div>
        <div className="splash-wordmark">
          {/* wm-enter: the one-shot brand entrance (globals.css, Motion system). The splash
              is a brand moment and is shown once, so it earns the animation; the sidebar
              wordmark deliberately does not carry this class, or the name would re-animate
              on every navigation. */}
          <p className="splash-text wm-enter">
            <span>Bill</span><span className="splash-text-v">V</span><span>yse</span>
          </p>
          <p className="splash-tagline wm-enter-tag">{t('appTagline')}</p>
        </div>
      </div>
    </div>
  );

  if (!checked) {
    /**
     * The app's own frame, drawn before we know who is looking at it.
     *
     * WHAT WAS HERE BEFORE, AND WHY IT WENT
     *
     * A full-screen brand splash: the mark, the wordmark and the tagline, centred in an
     * otherwise empty viewport. Nothing wrong with it as a screen — it was themed, it
     * pulsed, it had a spinner ring. The problem was structural, and it showed up the
     * moment the loading sequence was rendered and looked at rather than reasoned about.
     *
     * A shopkeeper opening the dashboard saw three completely different screens in a row:
     * the brand splash, then the page's own skeleton, then the data. Every one of those
     * transitions repainted the entire viewport. When the splash left, the sidebar
     * appeared on the left, the topbar appeared on top and the content filled the middle —
     * nothing that had been on screen survived. That is the largest visual jump an app can
     * make, and three of them in a row is what "app jerky lagti hai" actually is, even when
     * the total time is short.
     *
     * So the splash is gone and this draws the shell instead. The sidebar and the topbar
     * need NO data to know their own shape, and this is the real `.app-shell`, the real
     * `.sidebar` and the real `.content-area` — same classes, so the same widths, the same
     * rail colour, the same `data-rail` collapse and the same off-canvas behaviour on a
     * phone, for free and without a second set of numbers to keep in step.
     *
     * The load-bearing detail is `.sidebar-brand`: the mark and the wordmark are rendered
     * here exactly as the signed-in shell renders them, so when the session resolves they
     * are ALREADY in their final position and do not move a pixel. Everything else fades
     * from grey bars into real links. The eye sees one layout that gains detail, not three
     * screens that replace each other.
     *
     * The brand moment is not lost. Every signed-out screen opens on AuthShowcase, which is
     * a whole pane of branding — that is where a shopkeeper meets the product, and it is
     * unaffected by this. Inside the app, showing the shop its own working chrome
     * immediately is the stronger signal than a logo on an empty screen.
     *
     * The splash itself is NOT gone — see `bootSplash` above. It moved from being this
     * screen to being a layer over it, so the brand still greets the shop and the frame
     * underneath is already painted and already final when it fades. The whole `.splash-*`
     * block in globals.css is still live; only its wrapper changed.
     */
    return (
      <div className="app-shell shell-boot" aria-busy="true">
        {bootSplash}
        <div className="mobile-topbar">
          <span className="shell-boot-hamburger" aria-hidden="true" />
          <span className="shell-boot-row shell-boot-mobile-title" aria-hidden="true" />
        </div>
        <aside className="sidebar">
          <div className="sidebar-brand">
            <BrandLogo size={28} className="brand-logo sidebar-logo-mark" />
            <span className="sidebar-wordmark">
              <span className="sidebar-wordmark-name"><span>Bill</span><span className="sidebar-wordmark-v">V</span><span>yse</span></span>
            </span>
            {/* Here too, and that is the whole point of this frame: if the tagline only
                appeared once the session resolved, the brand block would grow a second row
                under the shopkeeper and push the entire menu down. */}
            <span className="sidebar-wordmark-tagline">{t('appTagline')}</span>
          </div>
          <nav className="sidebar-nav shell-boot-nav" aria-hidden="true">
            {SHELL_BOOT_NAV.map((width, index) => (
              <span key={index} className="shell-boot-row" style={{ width }} />
            ))}
          </nav>
        </aside>
        <div className="content-area">
          <div className="quick-topbar" aria-hidden="true">
            <SkeletonLine width="min(440px, 100%)" height={38} />
          </div>
          <div className="shell-boot-title" aria-hidden="true">
            <SkeletonLine width={190} height={24} />
          </div>
          <SkeletonCards count={3} height={112} />
          {/* A list under the cards, because that is the shape of most screens in this app —
              products, khata, bills, purchase orders, customers are all a list under a
              header. Filling the fold matters: three cards floating in an empty viewport
              still reads as a loading page, and the whole point of this frame is that it
              reads as the app. */}
          <SkeletonTable rows={6} cols={4} />
          {/* The only part of this a screen reader should hear. Everything above is
              decoration standing in for content that has not arrived. */}
          <p className="sr-only" role="status">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  const currentNavItem = navItems.find((item) => item.href === pathname);

  return (
    <DashboardUserContext.Provider value={user}>
      <DashboardStoresContext.Provider value={storeContext}>
      <HiddenNavContext.Provider value={hiddenNav}>
      <NavBadgeContext.Provider value={navBadges}>
      <SupportContext.Provider value={openSupport}>
      {/* Mounted here, once, so every seller screen inherits both halves of it: the upgrade
          sheet that answers any 402 in the app, and whatever the platform admin has decided
          to say today. Superadmins are outside it — the admin console is where campaigns are
          written, not where they are shown. */}
      <GrowthProvider
        user={user}
        enabled={user.role !== 'superadmin'}
        upsellOnLock={moduleInfo?.growth?.upsellOnLock !== false}
      >
      <div className="app-shell">
        {bootSplash}
        {impersonating && (
          <div className="impersonation-bar">
            <span>{t('admin.impersonating')}</span>
            <button type="button" onClick={handleExitImpersonation}>{t('admin.exitImpersonation')}</button>
          </div>
        )}
        <div className="mobile-topbar">
          <button
            type="button"
            className="hamburger"
            aria-label="Menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MenuIcon size={20} />
          </button>
          <span className="mobile-title">{currentNavItem ? navLabel(currentNavItem, user, t) : t('appName')}</span>
          {/* Identity belongs in the APP BAR on a phone, not in the tool row below it.
              That row wraps by design once it runs out of width, and the chip — being
              last in it — was the thing that dropped onto a line of its own: one
              avatar stranded on an otherwise empty second row.

              Mounted a second time rather than moved, because CSS cannot reparent an
              element and the two bars are siblings, not nested. The app bar is
              display:none above 900px so this copy costs a desktop nothing, and the
              tool-row copy is hidden below it — only ever one of the two is on screen,
              so there is no duplicated menu state to keep in step. */}
          <AccountMenu
            className="account-slot-bar"
            user={user}
            stores={stores}
            activeStore={activeStore}
            onStoreChange={handleStoreChange}
            onLogout={handleLogout}
            onSupport={openSupport}
          />
        </div>
        <div
          className={`sidebar-backdrop${menuOpen ? ' open' : ''}`}
          onClick={() => setMenuOpen(false)}
        />
        <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
          {/* The tagline in the rail.

              It was taken OUT in the professional-look pass, and the reasoning is worth
              keeping on the record because it is not obviously wrong: a positioning line
              printed permanently above the menu of a tool this shopkeeper already bought
              and opens two hundred times a day reads as "we are still selling to you".
              Put back at the owner's explicit request — that is a brand call, and it is
              theirs to make.

              A SIBLING of .sidebar-wordmark, never a child: both are grid items of
              .sidebar-brand ('mark name' / 'tag tag'), and `grid-area: tag` only resolves
              on a direct child. Nesting it would silently drop it into the name row, where
              globals.css records that it does not fit at ANY tracking. The rail's collapse
              rule already lists it explicitly, so a collapsed sidebar still hides it. */}
          <div className="sidebar-brand">
            {/* 28, not 42. BrandLogo writes width/height as ATTRIBUTES, so the
                sidebar-logo-mark rule in globals.css cannot shrink this on its own —
                the two have to move together. Identity does not need to be the
                largest object sitting above a 27-row menu. */}
            <BrandLogo size={28} className="brand-logo sidebar-logo-mark" />
            <span className="sidebar-wordmark">
              <span className="sidebar-wordmark-name"><span>Bill</span><span className="sidebar-wordmark-v">V</span><span>yse</span></span>
            </span>
            <span className="sidebar-wordmark-tagline">{t('appTagline')}</span>
          </div>
          <nav className="sidebar-nav">
            {user.role === 'superadmin' ? (
              navItems.filter((item) => canSeeNavItem(item, user, hiddenNav)).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  onClick={(event) => openModule(event, item)}
                  onPointerEnter={() => warmModule(item)}
                  onFocus={() => warmModule(item)}
                  onTouchStart={() => warmModule(item)}
                  aria-busy={openingHref === item.href || undefined}
                  className={pathname === item.href ? 'active' : ''}
                  aria-current={pathname === item.href ? 'page' : undefined}
                  data-tip={railActive ? navLabel(item, user, t) : undefined}
                >
                  <NavIcon navKey={item.key} size={17} />
                  {/* The label is its own element rather than a bare text node so the
                      rail can hide it. A text node cannot be addressed by CSS, which
                      is the whole reason collapsing used to be impossible here. */}
                  <span className="nav-label">{navLabel(item, user, t)}</span>
                  <NavBadge count={navBadges[item.key]} t={t} />
                </Link>
              ))
            ) : (
              NAV_GROUPS.map((group) => {
                // Ordered by `group.keys`, not by where the item happens to sit in
                // navItems — otherwise NAV_GROUPS looks like it controls the order while
                // the real sequence is decided somewhere else entirely.
                const groupItems = group.keys
                  .map((key) => navItems.find((item) => item.key === key))
                  .filter((item) => item && canSeeNavItem(item, user, hiddenNav));
                if (groupItems.length === 0) return null;
                // In the rail there are no group headers to click, so a group the
                // shopkeeper had collapsed would become unreachable rather than
                // merely tucked away. Collapsing is a full-width affordance; the rail
                // shows every icon it has.
                const collapsed = !railActive && !group.headerless && collapsedGroups[group.id];
                return (
                  <div key={group.id} className="sidebar-nav-group">
                    {!group.headerless && (
                      <button
                        type="button"
                        className="sidebar-nav-group-header"
                        onClick={() => toggleNavGroup(group.id)}
                        aria-expanded={!collapsed}
                      >
                        {/* "Multi-Store & Team" only while branches exist to manage — with the
                            Stores screen hidden (admin switch, or the owner's own choice) the
                            group is just the team, and the header should not promise more. */}
                        <span>{t(group.id === 'business' && hiddenNav.includes('stores') ? 'navGroup.team' : group.labelKey)}</span>
                        {collapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}
                      </button>
                    )}
                    {!collapsed && groupItems.map((item) =>
                      /* A screen behind a paid plan stays in the menu with a padlock rather
                         than vanishing. Hiding it is honest but it also means a shop can use
                         this app for a year without ever discovering it has a khata book —
                         and the shopkeeper who does discover it, by being refused mid-task,
                         meets the feature at its least appealing moment. A button, not a
                         Link: it opens the offer instead of walking into the wall. */
                      lockedNav[item.key] ? (
                        <button
                          key={item.href}
                          type="button"
                          className="nav-locked"
                          onClick={() => openLock(item.key)}
                          data-tip={railActive ? navLabel(item, user, t) : t('growth.lockedTip')}
                        >
                          <NavIcon navKey={item.key} size={17} />
                          <span className="nav-label">{navLabel(item, user, t)}</span>
                          <LockIcon size={13} className="nav-lock-icon" />
                        </button>
                      ) : (
                        <Link
                          key={item.href}
                          href={item.href}
                          prefetch={false}
                          onClick={(event) => openModule(event, item)}
                          onPointerEnter={() => warmModule(item)}
                          onFocus={() => warmModule(item)}
                          onTouchStart={() => warmModule(item)}
                          aria-busy={openingHref === item.href || undefined}
                          className={pathname === item.href ? 'active' : ''}
                          aria-current={pathname === item.href ? 'page' : undefined}
                          data-tip={railActive ? navLabel(item, user, t) : undefined}
                        >
                          <NavIcon navKey={item.key} size={17} />
                          <span className="nav-label">{navLabel(item, user, t)}</span>
                          <NavBadge count={navBadges[item.key]} t={t} />
                        </Link>
                      )
                    )}
                  </div>
                );
              })
            )}
          </nav>
          {/* What is left of the footer once identity moved to the topbar.
              It used to carry the shopkeeper's name, the store switcher and logout as
              well — all three now live in the account chip, where they are visible
              without scrolling a 23-item menu to the bottom. Language stays: it is the
              one preference here that is not about who you are.

              The two <select>s that were in this block were also the last two raw
              native selects left anywhere in the dashboard — every other one in the
              app had already become a Dropdown. The most-looked-at chrome in the
              product was the only part still off the design system. */}
          <div className="sidebar-footer">
            {/* Sidebar size is a navigation preference, so this belongs with the
                sidebar utilities—not beside the brand name. */}
            <button
              type="button"
              className="rail-toggle"
              onClick={toggleRail}
              aria-pressed={railed}
              aria-label={railed ? t('common.expandSidebar') : t('common.collapseSidebar')}
              data-tip={railed ? t('common.expandSidebar') : t('common.collapseSidebar')}
            >
              <PanelToggleIcon collapsed={railed} size={18} />
              <span>{railed ? t('common.expandSidebar') : t('common.collapseSidebar')}</span>
            </button>
            {/* Hidden in the rail by CSS: a 68px column cannot show a language name,
                and the choice is one expand away. */}
            <div className="sidebar-lang-wrap">
              <Dropdown
                className="sidebar-lang"
                value={lang}
                onChange={setLang}
                options={LANGUAGES.map((l) => ({
                  value: l.code,
                  label: `${l.native}${l.native !== l.label ? ` · ${l.label}` : ''}`,
                }))}
              />
            </div>
          </div>
        </aside>
        <div className="content-area">
          {/* The bar now renders for the admin console too. It used to be seller-only,
              which left /admin with no theme toggle, no fullscreen and — once identity
              moved up here — nowhere to sign out from. The admin simply gets the
              subset that means anything there: the palette, the bell and the
              calculator are all shop tools, so they stay behind the role check. */}
          {/* The way out of the current screen no longer lives here. It used to be a
              history back arrow shown only in fullscreen and the installed app, which
              meant the app had no way out at all in a normal browser tab — and where it
              did appear it could not say where it went. It is now a named link on the
              page itself (<PageUp/>, below), on every screen, in one fixed place. */}
          <div className="quick-topbar">
            {user.role !== 'superadmin' && (
              <>
              {/* Not an input. Everything this used to do — and screens and actions,
                  which it never could — now lives in the ⌘K palette; leaving a second
                  live search box on the same bar would just make the shopkeeper guess
                  which one answers their question. It still LOOKS like a field,
                  because that is the shape people aim at when they want to find
                  something. */}
              <button
                type="button"
                className="cmdk-trigger"
                onClick={() => setPaletteOpen(true)}
                aria-label={t('cmdk.title')}
              >
                <SearchIcon size={16} />
                <span className="cmdk-trigger-text">{t('cmdk.triggerLabel')}</span>
                <kbd className="cmdk-trigger-kbd">Ctrl K</kbd>
              </button>
              <button
                type="button"
                className="bell-btn"
                onClick={() => setCalcOpen(true)}
                aria-label={t('calculator.title') || 'Calculator'}
                data-tip={t('calculator.title') || 'Calculator'}
              >
                <CalculatorIcon size={17} />
              </button>
              </>
            )}
              {/* Renders nothing where the browser has no Fullscreen API (iPhone
                  Safari), rather than offering a button that does nothing.

                  `topbar-optional` marks it — with the theme toggle below — as a
                  DESKTOP shortcut. On a phone both are hidden by CSS: a PWA is already
                  fullscreen so the button toggles nothing a shopkeeper can see, and the
                  theme lives in Settings → Appearance beside the accent, scene, text
                  size and density it belongs with. Between them they were the two icons
                  that pushed this row past a phone's width, and a wrapped row put five
                  buttons on a line of their own under the search box — a floating strip
                  that reads as leftovers rather than as anything anybody chose. */}
              <FullscreenToggle className="bell-btn topbar-optional" />
              <button
                type="button"
                className="bell-btn topbar-optional"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                data-tip={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              >
                {theme === 'dark' ? <SunIcon size={17} /> : <MoonIcon size={17} />}
              </button>
              {user.role === 'staff' && (
                myAttendance?.checkOut ? (
                  <span className="attendance-pill done" data-tip={t('seller.myAttendanceCheckedOutAt', { time: formatClockTime(myAttendance.checkOut) })}>
                    <CheckCircleIcon size={15} />
                    {formatClockTime(myAttendance.checkOut)}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={`attendance-pill${myAttendance?.checkIn ? ' active' : ''}`}
                    onClick={toggleMyAttendance}
                    disabled={attendanceBusy}
                    data-tip={myAttendance?.checkIn ? t('seller.myAttendanceCheckedInAt', { time: formatClockTime(myAttendance.checkIn) }) : undefined}
                  >
                    <ClockIcon size={15} />
                    {myAttendance?.checkIn ? t('seller.myAttendanceCheckOut') : t('seller.myAttendanceCheckIn')}
                  </button>
                )
              )}
              {user.role !== 'superadmin' && (
              <NotificationPopover open={notifOpen} setOpen={setNotifOpen} unreadCount={notifications?.unreadCount}>
                    {/* Today's bookings deliberately don't count towards the badge (a busy
                        salon would never see it go quiet), but they're still worth showing
                        when the bell is opened — so "nothing here" has to account for them. */}
                    {!notifications ? (
                      <div className="notif-empty" role="status"><span className="module-opening-spinner" aria-hidden="true" /><p>{t('common.loading')}</p></div>
                    ) : notifications.count === 0 && !notifications.appointmentsToday?.length ? (
                      <div className="notif-empty"><CheckCircleIcon size={32} /><p>{t('notifications.empty')}</p></div>
                    ) : (
                      <>
                        {notifications.feed?.[0] && (
                          <button
                            type="button"
                            className={`notif-headline-banner notif-tone-${notifications.feed[0].tone}`}
                            onClick={() => { router.push('/seller/notifications'); setNotifOpen(false); }}
                          >
                            {notificationHeadline(t, notifications.feed[0])}
                          </button>
                        )}
                        {notifications.unbilledAppointments?.length > 0 && (
                          <>
                            <div className="notif-group-label">{t('notifications.unbilledAppointments')}</div>
                            {notifTop(notifications.unbilledAppointments).map((a) => (
                              <button key={a._id} type="button" className="notif-item" onClick={() => { router.push('/seller/appointments'); setNotifOpen(false); }}>
                                <span>{a.customerName || t('seller.unknownCustomer')}</span>
                                <span className="badge badge-expired">{formatRupees(a.estimatedTotal, lang)}</span>
                              </button>
                            ))}
                            {notifMore(notifications.unbilledAppointments, '/seller/appointments')}
                          </>
                        )}
                        {notifications.unconfirmedSoon?.length > 0 && (
                          <>
                            <div className="notif-group-label">{t('notifications.unconfirmedSoon')}</div>
                            {notifTop(notifications.unconfirmedSoon).map((a) => (
                              <button key={a._id} type="button" className="notif-item" onClick={() => { router.push('/seller/appointments'); setNotifOpen(false); }}>
                                <span>{a.customerName || t('seller.unknownCustomer')}</span>
                                <span className="badge badge-expiring">{new Date(a.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </button>
                            ))}
                            {notifMore(notifications.unconfirmedSoon, '/seller/appointments')}
                          </>
                        )}
                        {notifications.appointmentsToday?.length > 0 && (
                          <>
                            <div className="notif-group-label">{t('notifications.appointmentsToday')}</div>
                            {notifTop(notifications.appointmentsToday).map((a) => (
                              <button key={a._id} type="button" className="notif-item" onClick={() => { router.push('/seller/appointments'); setNotifOpen(false); }}>
                                <span>{a.customerName || t('seller.unknownCustomer')}</span>
                                <span style={{ color: 'var(--text-muted)' }}>{new Date(a.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </button>
                            ))}
                            {notifMore(notifications.appointmentsToday, '/seller/appointments')}
                          </>
                        )}
                        {notifications.lowStock?.length > 0 && (
                          <>
                            <div className="notif-group-label">{t('notifications.lowStock')}</div>
                            {notifTop(notifications.lowStock).map((p) => (
                              <button key={p._id} type="button" className="notif-item" onClick={() => { router.push('/seller/products'); setNotifOpen(false); }}>
                                <span>{p.name}</span>
                                <span style={{ color: 'var(--text-muted)' }}>{formatQty(p.stock, lang)} {p.unit}</span>
                              </button>
                            ))}
                            {notifMore(notifications.lowStock, '/seller/products?stock=refill')}
                          </>
                        )}
                        {notifications.expired?.length > 0 && (
                          <>
                            <div className="notif-group-label">{t('notifications.expired')}</div>
                            {notifTop(notifications.expired).map((p) => (
                              <button key={p._id} type="button" className="notif-item" onClick={() => { router.push('/seller/products?expiry=expired'); setNotifOpen(false); }}>
                                <span>{p.name}</span>
                                <span className="badge badge-expired">{formatDate(p.expiryDate, lang)}</span>
                              </button>
                            ))}
                            {notifMore(notifications.expired, '/seller/products?expiry=expired')}
                          </>
                        )}
                        {notifications.expiringSoon?.length > 0 && (
                          <>
                            <div className="notif-group-label">{t('notifications.expiringSoon')}</div>
                            {notifTop(notifications.expiringSoon).map((p) => {
                              const days = Math.ceil((new Date(p.expiryDate).getTime() - Date.now()) / 86400000);
                              return (
                                <button key={p._id} type="button" className="notif-item" onClick={() => { router.push('/seller/products?expiry=expiring'); setNotifOpen(false); }}>
                                  <span>{p.name}</span>
                                  <span className="badge badge-expiring">{t('expiry.daysLeft', { days })}</span>
                                </button>
                              );
                            })}
                            {notifMore(notifications.expiringSoon, '/seller/products?expiry=expiring')}
                          </>
                        )}
                        {notifications.promisesDue?.length > 0 && (
                          <>
                            <div className="notif-group-label">{t('notifications.promisesDue')}</div>
                            {notifTop(notifications.promisesDue).map((c) => (
                              <button key={c.id} type="button" className="notif-item" onClick={() => { router.push(recordHref('/seller/khata/[id]', c.id)); setNotifOpen(false); }}>
                                <span>{c.name}</span>
                                <span className="badge badge-expiring">{formatRupees(c.balance, lang)} · {formatDate(c.promiseToPayDate, lang)}</span>
                              </button>
                            ))}
                            {notifMore(notifications.promisesDue, '/seller/khata')}
                          </>
                        )}
                        {/* Quotations nobody answered. Sits with the money groups because
                            that is what it is: work already done, waiting on one call. */}
                        {notifications.coldEstimates?.length > 0 && (
                          <>
                            <div className="notif-group-label">{t('notifications.coldEstimates')}</div>
                            {notifTop(notifications.coldEstimates).map((row) => (
                              <button
                                key={row.id}
                                type="button"
                                className="notif-item"
                                onClick={() => { router.push('/seller/estimates'); setNotifOpen(false); }}
                              >
                                <span>{row.name || `#${row.number}`}</span>
                                <span className="badge badge-expiring">{formatRupees(row.amount, lang)} · {row.daysOld}d</span>
                              </button>
                            ))}
                            {notifMore(notifications.coldEstimates, '/seller/estimates')}
                          </>
                        )}
                        {notifications.khataDue?.length > 0 && (
                          <>
                            <div className="notif-group-label">{t('notifications.khataDue')}</div>
                            {notifTop(notifications.khataDue).map((c) => (
                              <button key={c.id} type="button" className="notif-item" onClick={() => { router.push(recordHref('/seller/khata/[id]', c.id)); setNotifOpen(false); }}>
                                <span>{c.name}</span>
                                <span style={{ color: 'var(--text-muted)' }}>{formatRupees(c.balance, lang)} · {c.daysSince} {t('notifications.daysOverdue')}</span>
                              </button>
                            ))}
                            {notifMore(notifications.khataDue, '/seller/khata')}
                          </>
                        )}
                        {notifications.pendingOrders > 0 && (
                          <>
                            <div className="notif-group-label">{t('notifications.pendingOrders')}</div>
                            <button type="button" className="notif-item" onClick={() => { router.push('/seller/orders'); setNotifOpen(false); }}>
                              <span>{t('nav.orders')}</span>
                              <span style={{ color: 'var(--text-muted)' }}>{notifications.pendingOrders}</span>
                            </button>
                          </>
                        )}
                        {notifications.paymentClaims?.length > 0 && (
                          <>
                            <div className="notif-group-label">{t('notifications.paymentClaims')}</div>
                            {notifTop(notifications.paymentClaims).map((claim) => (
                              <button key={claim._id} type="button" className="notif-item" onClick={() => { router.push('/seller/khata'); setNotifOpen(false); }}>
                                <span>{claim.customer?.name || t('seller.unknownCustomer')}</span>
                                <span style={{ color: 'var(--text-muted)' }}>{formatRupees(claim.amount, lang)}</span>
                              </button>
                            ))}
                            {notifMore(notifications.paymentClaims, '/seller/khata')}
                          </>
                        )}
                        {notifications.backupStale && (
                          <>
                            <div className="notif-group-label">{t('notifications.backupReminder')}</div>
                            <button type="button" className="notif-item" onClick={() => { router.push('/seller/backup'); setNotifOpen(false); }}>
                              <span>{t('nav.backup')}</span>
                              <span style={{ color: 'var(--text-muted)' }}>
                                {notifications.daysSinceBackup == null
                                  ? t('backup.never')
                                  : `${notifications.daysSinceBackup} ${t('notifications.daysOverdue')}`}
                              </span>
                            </button>
                          </>
                        )}
                      </>
                    )}
              </NotificationPopover>
              )}
              {/* Support, immediately after the bell.
                  The bell is where the app talks TO the shop; this is the one control that
                  talks BACK, so the pair sits together and reads in that order — first what
                  we have to say, then the way to answer. It is behind no module and no plan
                  (see the route's own note): the shop most likely to press it is the one
                  something has just been taken away from. Staff get it too — they are the
                  ones standing at the counter when it breaks. */}
              {/* Now a chat shortcut that knows which module it is on (see SupportPopover):
                  unread replies on the icon, "ask about this screen" first inside. */}
              {user.role !== 'superadmin' && (
                <SupportPopover
                  unreadCount={navBadges.support}
                  moduleLabel={supportNavItem && supportNavItem.key !== 'support' ? navLabel(supportNavItem, user, t) : ''}
                  topic={supportNavItem ? supportTopicForNav(supportNavItem.key) : ''}
                  onAsk={openSupport}
                />
              )}
              {/* Anchored to the right end of the bar by its own margin, so it stays
                  put whether or not the palette trigger (which is flex: 1) is there —
                  the admin console has no palette. */}
              <AccountMenu
                className="account-slot-tools"
                user={user}
                stores={stores}
                activeStore={activeStore}
                onStoreChange={handleStoreChange}
                onLogout={handleLogout}
                onSupport={openSupport}
              />
            </div>
          {/* Above everything, including a platform outage. Maintenance mode says the app is
              having a bad hour; this says the shop's khata, stock and three years of bills
              stop existing on a named day. Nothing on this screen outranks it. */}
          {user?.deletionDueAt && (
            <div className="platform-banner danger">
              <span>
                {t('seller.delBannerText', { date: formatDate(user.deletionDueAt, lang) })}
              </span>
              <button
                type="button"
                className="btn btn-primary btn-small"
                style={{ marginLeft: 'auto', flexShrink: 0, width: 'auto' }}
                onClick={handleCancelDeletion}
                disabled={cancellingDeletion}
              >
                {cancellingDeletion ? t('common.loading') : t('seller.delBannerCancel')}
              </button>
            </div>
          )}
          {moduleInfo?.maintenance && (
            <div className="platform-banner danger">{moduleInfo.maintenance.message || 'Maintenance mode is on.'}</div>
          )}
          {moduleInfo?.announcement && (
            <div className={`platform-banner ${moduleInfo.announcement.level}`}>{moduleInfo.announcement.text}</div>
          )}
          {/* The operator's own strips, below the platform notices and above the plan
              warning: an outage note and a lapsed plan both outrank a promotion. */}
          <GrowthBanners />
          {moduleInfo?.planExpiry?.status === 'expired' && (
            <div className="platform-banner warning">
              <span>{t('planExpiry.bannerText', { plan: moduleInfo.planExpiry.planName })}</span>
              <Link href="/seller/plan" className="btn btn-primary btn-small" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                {t('planExpiry.bannerRenew')}
              </Link>
            </div>
          )}
          {/* Keyed by route so a fresh page swap always replays the fade-in, instead of
              content just snapping into place — the same polish every card entrance on
              this dashboard already has, applied once at the page level. */}
          <div key={pathname} className="page-transition">
            {/* Above the page's own heading, and rendered by the shell rather than by the
                page, for the reason written at the top of lib/pageParents.js: a way out
                that each screen has to remember to build is a way out that most screens
                do not have. It renders nothing on the home screen, which has nothing
                above it.

                The boundary is Next's requirement, not ours: PageUp reads
                `useSearchParams()` (the invoice screen's `?src=`, and the record id in
                the Android bundle), and a component that does so must sit under a
                Suspense boundary or every statically rendered page under this shell
                fails the build. Keeping the boundary here means no page has to grow one
                on this component's account. */}
            <Suspense fallback={null}>
              <PageUp
                navItems={reachableNav}
                home={user.role === 'superadmin' ? '/admin' : '/seller'}
                labelFor={(item) => navLabel(item, user, t)}
              />
            </Suspense>
            <ModuleNavigationContext.Provider value={setLoadingRoute}>
              {children}
            </ModuleNavigationContext.Provider>
          </div>
        </div>
      </div>
      {/* Phone-only (hidden above 900px in CSS). Superadmin is excluded for the same
          reason it has no quick-topbar: the admin console is a desk tool. */}
      {user.role !== 'superadmin' && (
        <nav className="bottom-nav" aria-label={t('nav.primary')}>
          {bottomNavItems(navItems, user, navHiddenAndLocked).map((item) => (
            <Link
              key={item.key}
              href={item.href}
              prefetch={false}
              onClick={(event) => openModule(event, item)}
              onPointerEnter={() => warmModule(item)}
              onFocus={() => warmModule(item)}
              onTouchStart={() => warmModule(item)}
              aria-busy={openingHref === item.href || undefined}
              className={pathname === item.href ? 'active' : undefined}
              aria-current={pathname === item.href ? 'page' : undefined}
            >
              <NavIcon navKey={item.key} size={20} />
              <span>{navLabel(item, user, t)}</span>
              <NavBadge count={navBadges[item.key]} t={t} />
            </Link>
          ))}
          {/* The five icons on the bar are not the five modules that need him — most of
              what earns a badge (expiry, khata, purchase orders) lives behind "More". A
              phone user tapping nothing but the bar would never learn that, so the dot
              rides up to the button that opens the rest. */}
          <button type="button" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen}>
            <ListIcon size={20} />
            <span>{t('nav.more')}</span>
            <NavBadge count={hiddenBadgeTotal} t={t} />
          </button>
        </nav>
      )}
      <ScrollToTopButton />
      {/* One listener, one bubble, every `data-tip` in the app. Mounted here so it is
          alive on every seller screen without a page having to remember it. */}
      <TooltipLayer />
      <Calculator open={calcOpen} onClose={() => setCalcOpen(false)} />
      {/* Mounted by the shell, once, so it survives the screen that opened it — a page
          erroring out must not take the way of reporting it down with it. */}
      {supportTopic !== null && (
        <SupportSheet user={user} initialTopic={supportTopic} onClose={() => setSupportTopic(null)} />
      )}
      {/* Filtered here, not inside the palette: canSeeNavItem + hiddenNav is this
          component's rule, and a second copy of an access check is the copy that
          drifts and offers a cashier a screen that 403s. */}
      {user.role !== 'superadmin' && (
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          navItems={reachableNav}
          canSearch={canSearch(user)}
        />
      )}
      {showTour && <SidebarTour teamOnly={hiddenNav.includes('stores')} onDone={() => setShowTour(false)} />}
      {welcome && (
        <WelcomeOverlay
          name={welcome.name}
          shopName={welcome.shopName}
          onDone={() => setWelcome(null)}
        />
      )}
      {planExpiryPopup && <PlanExpiryModal info={planExpiryPopup} onDismiss={dismissPlanExpiryPopup} />}
      {/* Incomplete owner profiles can be dismissed for this login/day.
          Completed profiles and support impersonation never receive this reminder. */}
      {checked && user && !impersonating && user.role === 'seller' && (
        <ShopIdentityReminder
          key={user.id}
          user={user}
          onSaved={(profile) => setUser((u) => ({ ...u, ...profile }))}
          onLogout={handleLogout}
        />
      )}
      </GrowthProvider>
      </SupportContext.Provider>
      </NavBadgeContext.Provider>
      </HiddenNavContext.Provider>
      </DashboardStoresContext.Provider>
    </DashboardUserContext.Provider>
  );
}
