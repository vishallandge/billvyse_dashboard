'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tradeUses, DEFAULT_BUSINESS_TYPE } from '../../lib/businessTypes';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { NavIcon, SearchIcon, PackageIcon, UsersIcon, ZapIcon } from './Icons';
import { moduleTone } from '../../lib/moduleTones';
import { recordHref } from '../../lib/routeId';

/**
 * ⌘K — one box that reaches everything.
 *
 * This app has thirty modules behind a six-group sidebar. That is a lot of software,
 * and until now the only way to reach any of it was to remember which of the six
 * groups a screen lives under, expand it, and read down a list — a cost paid on every
 * single navigation, forever. The topbar search did not help: it searched products
 * and customers only, so the *screens* were the one thing the search box could not
 * find.
 *
 * So this replaces that box rather than sitting next to it. Two search fields on one
 * bar is a worse product than either alone — the shopkeeper has to know which one
 * answers which question before they can type. Everything the old box did, this does,
 * plus screens and actions.
 *
 * Three deliberate decisions:
 *
 * - MATCHING IS BILINGUAL, ALWAYS. A shopkeeper running the app in Hindi still types
 *   "billing" as often as "बिलिंग", because that is the word on the machine they
 *   learned on. Every module is indexed under its translated label AND its English
 *   key AND a list of the words people actually use for it — "udhaar" finds Khata,
 *   "stock" and "maal" find Inventory, "kharcha" finds Expenses. A palette that only
 *   matches the current language is a palette that fails the moment someone switches.
 *
 * - PERMISSIONS ARE THE CALLER'S ANSWER, NOT OURS. The list of reachable modules is
 *   passed in already filtered by DashboardShell, which owns `canSeeNavItem` and the
 *   platform/plan `hiddenNav` list. Re-deriving that here would be a second copy of
 *   an access rule, and the copy that drifts is the one that shows a cashier a screen
 *   that 403s.
 *
 * - IT OPENS EMPTY AND STILL USEFUL. With no query it shows the shop's most-used
 *   screens, so ⌘K is worth pressing before you know what you want. A palette that
 *   opens to a blank list teaches you to stop opening it.
 */

// Words a shopkeeper actually types, per module. Hinglish on purpose — this is what
// gets typed into the box, not what the sidebar is allowed to be labelled. Kept here
// rather than in i18n because these are search aliases, not UI copy: they are additive
// (more of them only ever helps), never rendered, and must match regardless of which
// of the ten languages the app is currently set to.
const ALIASES = {
  overview: 'home dashboard mukhya',
  billing: 'bill invoice sale bikri counter pos cash',
  tables: 'table floor restaurant dining seating',
  kitchen: 'kot kitchen chef rasoi',
  counters: 'counter till register',
  khata: 'udhaar udhari credit ledger customer bahi baki due',
  orders: 'online order delivery',
  appointments: 'booking appointment diary slot',
  jobs: 'job work order repair',
  memberships: 'membership plan validity subscription',
  // A quotation is asked for by its word, not by its screen name — "quote", "bhaav",
  // "rate", "estimate" are four ways the same customer asks, and the palette is now the
  // only search box in the shell, so every one of them has to land here.
  estimates: 'estimate quotation quote bhaav rate kotation pending',
  catalog: 'catalog shop link storefront online',
  loyalty: 'loyalty points reward',
  offers: 'offer discount coupon scheme deal',
  inventory: 'stock product item maal saman goods',
  savings: 'save money paisa bachao expiry date dead stock nahi bik raha rate badha loss',
  labels: 'label barcode price tag print',
  suppliers: 'supplier vendor wholesaler distributor',
  supplierLedger: 'supplier ledger payable vendor account',
  purchaseOrders: 'purchase po buying kharid bill wholesaler',
  purchaseReturns: 'purchase return debit note expired',
  // Searched for by the business it IS, not by the screen's name: a man looks for
  // 'thok', 'wholesale', or the word he uses for the shops that buy from him.
  supply: 'sell to shops wholesale thok supply my buyers orders to me distributor',
  expenses: 'kharcha expense spending cost bill',
  daybook: 'daybook day book roznamcha cash book',
  reports: 'report gst sales tax export',
  accounting: 'accounting ledger balance sheet ca tally',
  stores: 'store branch shop outlet',
  centralInventory: 'central inventory all stores stock',
  transfers: 'transfer stock move branch',
  staff: 'staff employee worker attendance salary',
  analytics: 'insight analytics graph chart trend',
  notifications: 'notification alert bell',
  plan: 'plan upgrade subscription billing pricing',
  backup: 'backup restore export data safety',
  settings: 'setting config profile shop theme language',
};

// Things you DO, as opposed to places you go. A palette that only navigates is a menu
// with a text box; the verbs are what make it feel like a command line for the shop.
// Each one is a deep link the app already supports, so nothing here can rot into a
// dead action — if the route exists the action works.
const ACTIONS = [
  { id: 'newBill', href: '/seller/billing', navKey: 'billing', permission: 'billing', words: 'new bill naya sale bikri start' },
  // Lands on the register rather than on a blank form, because a quotation is built out of a
  // cart: the pending list is where a shopkeeper reaching for "quotation" usually means to
  // go, and "new estimate" from there is one tap to the counter.
  { id: 'quotations', href: '/seller/estimates', navKey: 'estimates', permission: 'billing', words: 'quotation quote estimate bhaav rate pending' },
  { id: 'addProduct', href: '/seller/products?new=1', navKey: 'inventory', permission: 'inventory', words: 'add product naya item stock entry' },
  { id: 'lowStock', href: '/seller/products?stock=refill', navKey: 'inventory', permission: 'inventory', words: 'low stock khatam reorder' },
  // `tool`: offered only to the trades that use it (lib/businessTypes.js) — a kirana typing
  // "stock" must not be handed a "Kitchen stock" it has no kitchen for.
  { id: 'kitchenStock', tool: 'recipe', href: '/seller/products?view=kitchen', navKey: 'inventory', permission: 'inventory', words: 'kitchen stock rasoi saman samaan ingredient recipe paneer khatam kitna bacha' },
  { id: 'expiring', href: '/seller/products?expiry=expiring', navKey: 'inventory', permission: 'inventory', words: 'expiry expiring soon kharab' },
  { id: 'expired', href: '/seller/products?expiry=expired', navKey: 'inventory', permission: 'inventory', words: 'expired kharab dead stock return' },
  { id: 'addExpense', href: '/seller/expenses?new=1', navKey: 'expenses', permission: 'expenses', words: 'add kharcha expense naya' },
  // Writing a reminder is the one verb here that has nothing to do with a screen the
  // shopkeeper was already heading for: the thought arrives mid-sale ("Ramesh ko 5 baje
  // phone karna"), and the palette is the only surface in the app reachable without
  // leaving whatever is on screen. No permission — it is the counter's own memory.
  { id: 'newReminder', href: '/seller/reminders?new=1', navKey: 'reminders', words: 'reminder yaad remind note todo kaam alarm' },
  { id: 'todayHisaab', href: '/seller/daybook', navKey: 'daybook', permission: 'expenses', words: 'today hisaab aaj ka day book close' },
  { id: 'backupNow', href: '/seller/backup', navKey: 'backup', words: 'backup download safety export' },
];

// Which screens a brand-new palette offers before anything is typed. Ordered by how
// often a shop actually opens them, not by where they sit in the sidebar.
const DEFAULT_KEYS = ['billing', 'khata', 'inventory', 'orders', 'daybook', 'reports'];

/**
 * Ranked substring match.
 *
 * Deliberately not a fuzzy matcher. Fuzzy scoring earns its keep over thousands of
 * candidates with long names; here there are about thirty short ones, and its failure
 * mode — "sto" matching "Settings" because s-t-o appear in that order — is exactly the
 * kind of wrong-but-confident result that makes people stop trusting the box. A label
 * that starts with what you typed wins, a word inside it that starts with what you
 * typed comes next, an alias hit comes last. Returns -1 for no match.
 */
function score(query, label, aliases) {
  const haystack = `${label} ${aliases}`.toLowerCase();
  const text = label.toLowerCase();
  if (text.startsWith(query)) return 0;
  if (text.split(/\s+/).some((word) => word.startsWith(query))) return 1;
  if (text.includes(query)) return 2;
  if (haystack.split(/\s+/).some((word) => word.startsWith(query))) return 3;
  if (haystack.includes(query)) return 4;
  return -1;
}

export default function CommandPalette({ open, onClose, navItems, canSearch, businessType: trade }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const timer = useRef(null);

  // A fresh palette every time. Reopening onto the last query — and the last cursor
  // position three screens down a stale list — is how you fire the wrong action.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults(null);
    setCursor(0);
    // The input mounts with the overlay; focus on the next frame so the browser has
    // actually laid it out (focusing an element mid-mount is a no-op in Safari).
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Products and customers, from the same endpoint the old topbar box used. Debounced,
  // and floored at two characters: a one-letter query matches most of the shop and the
  // round trip is wasted.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (!open || !canSearch || q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setResults(null);
    setSearching(true);
    timer.current = setTimeout(() => {
      apiFetch(`/api/seller/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((data) => { if (!controller.signal.aborted) setResults(data); })
        .catch(() => { if (!controller.signal.aborted) setResults(null); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 220);
    return () => {
      clearTimeout(timer.current);
      controller.abort();
    };
  }, [query, open, canSearch]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byKey = new Map(navItems.map((item) => [item.key, item]));
    const rows = [];

    if (!q) {
      for (const key of DEFAULT_KEYS) {
        const item = byKey.get(key);
        if (item) rows.push({ kind: 'nav', id: `nav:${key}`, navKey: key, label: t(`nav.${key}`), href: item.href });
      }
      return rows;
    }

    // Screens
    const navHits = [];
    for (const item of navItems) {
      const rank = score(q, t(`nav.${item.key}`), `${item.key} ${ALIASES[item.key] || ''}`);
      if (rank >= 0) navHits.push({ kind: 'nav', id: `nav:${item.key}`, navKey: item.key, label: t(`nav.${item.key}`), href: item.href, rank });
    }
    navHits.sort((a, b) => a.rank - b.rank);
    rows.push(...navHits);

    // Actions — only the ones whose module this login can actually reach.
    const actionHits = [];
    for (const action of ACTIONS) {
      if (!byKey.has(action.navKey)) continue;
      if (action.tool && !tradeUses(trade || DEFAULT_BUSINESS_TYPE, action.tool)) continue;
      const label = t(`cmdk.action.${action.id}`);
      const rank = score(q, label, `${action.id} ${action.words}`);
      if (rank >= 0) actionHits.push({ kind: 'action', id: `act:${action.id}`, navKey: action.navKey, label, href: action.href, rank });
    }
    actionHits.sort((a, b) => a.rank - b.rank);
    rows.push(...actionHits);

    // Live data
    for (const product of results?.products || []) {
      rows.push({
        kind: 'product',
        id: `p:${product._id}`,
        label: product.name,
        meta: `₹${product.price} · ${product.stock} ${product.unit}`,
        href: '/seller/products',
      });
    }
    for (const customer of results?.customers || []) {
      rows.push({
        kind: 'customer',
        id: `c:${customer._id}`,
        label: customer.name,
        meta: `${customer.phone} · ₹${customer.balance}`,
        href: recordHref('/seller/khata/[id]', customer._id),
      });
    }
    return rows;
  }, [query, navItems, results, t]);

  // The cursor is an index into a list that changes on every keystroke. Clamping it
  // here — rather than trusting it to stay valid — is what stops Enter from firing
  // whatever happens to be last after the list shrinks under it.
  useEffect(() => {
    setCursor((current) => (current >= items.length ? 0 : current));
  }, [items.length]);

  const go = useCallback(
    (item) => {
      if (!item) return;
      onClose();
      router.push(item.href);
    },
    [onClose, router]
  );

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault();
      setCursor((c) => (items.length ? (c + 1) % items.length : 0));
      return;
    }
    if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault();
      setCursor((c) => (items.length ? (c - 1 + items.length) % items.length : 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      go(items[cursor]);
    }
  }

  // Keep the highlighted row on screen when it moves by keyboard. `block: 'nearest'`
  // so arrowing through a short list doesn't yank the whole dialog around.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  if (!open) return null;

  const groups = [
    { kind: 'nav', label: t('cmdk.groupScreens') },
    { kind: 'action', label: t('cmdk.groupActions') },
    { kind: 'product', label: t('nav.inventory') },
    { kind: 'customer', label: t('nav.khata') },
  ];

  return (
    <div className="cmdk-overlay" onMouseDown={onClose} role="presentation">
      <div
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('cmdk.title')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="cmdk-input-row">
          <SearchIcon size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t('cmdk.placeholder')}
            aria-label={t('cmdk.placeholder')}
            autoComplete="off"
            spellCheck="false"
          />
          <kbd className="cmdk-esc">esc</kbd>
        </div>

        <div className="cmdk-list" ref={listRef}>
          {items.length === 0 ? (
            <p className="cmdk-empty">
              {searching ? t('cmdk.searching') : t('cmdk.noResults', { query: query.trim() })}
            </p>
          ) : (
            groups.map((group) => {
              const rows = items.filter((item) => item.kind === group.kind);
              if (rows.length === 0) return null;
              return (
                <div key={group.kind} className="cmdk-group">
                  <div className="cmdk-group-label">{group.label}</div>
                  {rows.map((item) => {
                    const index = items.indexOf(item);
                    const active = index === cursor;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="cmdk-row"
                        data-active={active}
                        // Pointer-move, not mouse-enter: the list also moves under the
                        // pointer when you arrow through it, and mouseenter fires on
                        // that too — the cursor would snap back to wherever the mouse
                        // happens to be resting, fighting the keyboard.
                        onPointerMove={() => setCursor(index)}
                        onClick={() => go(item)}
                      >
                        {/* The chip carries the module's own colour (lib/moduleTones.js),
                            which is worth more here than anywhere else in the app: this
                            list mixes four kinds of thing — screens, products, customers,
                            actions — under one search box, and a shopkeeper who has typed
                            three letters is choosing between rows, not reading them. The
                            three non-nav kinds take a fixed hue each, so green is always a
                            product and amber is always a customer however the list is
                            sorted; a screen takes the same hue it wears on the dashboard
                            strip and in its own headings. */}
                        <span className={`cmdk-row-icon mod-chip is-sm ${
                          item.kind === 'product'
                            ? 'mod-tone-2'
                            : item.kind === 'customer'
                              ? 'mod-tone-3'
                              : item.kind === 'action'
                                ? 'mod-tone-1'
                                : moduleTone(item.navKey)
                        }`}>
                          {item.kind === 'product' ? (
                            <PackageIcon size={16} />
                          ) : item.kind === 'customer' ? (
                            <UsersIcon size={16} />
                          ) : item.kind === 'action' ? (
                            <ZapIcon size={16} />
                          ) : (
                            <NavIcon navKey={item.navKey} size={16} />
                          )}
                        </span>
                        <span className="cmdk-row-label">{item.label}</span>
                        {item.meta && <span className="cmdk-row-meta">{item.meta}</span>}
                        {active && <span className="cmdk-row-enter">↵</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> {t('cmdk.hintMove')}</span>
          <span><kbd>↵</kbd> {t('cmdk.hintOpen')}</span>
          <span className="cmdk-foot-spacer" />
          <span>{t('cmdk.hintTip')}</span>
        </div>
      </div>
    </div>
  );
}
