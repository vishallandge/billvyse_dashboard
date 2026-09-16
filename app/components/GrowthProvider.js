'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { fetchCampaigns, reportCampaignEvent } from '../../lib/growth';
import { useLanguage } from './LanguageProvider';
import { useToast } from './Toast';
import UpgradeSheet from './UpgradeSheet';
import CampaignModal from './CampaignModal';

/**
 * The one place the platform's own voice is mounted.
 *
 * Two jobs that turned out to be the same job:
 *
 *   1. A plan wall must always offer a way through it. Every 402 in the app raises
 *      `dukaan:upgradeNeeded` (see lib/api.js), and this listens for it and opens the
 *      upgrade sheet. That is what makes the upgrade button appear on every screen without
 *      any screen having been edited.
 *
 *   2. Whatever the operator has decided to say — an upsell, a festival offer, a sponsored
 *      slot, a "you have not taken a backup in three weeks" — arrives from the campaign
 *      engine and is rendered on whichever surface the campaign chose.
 *
 * Both are deliberately non-blocking. If the growth API is down, or campaigns are switched
 * off platform-wide, this component renders nothing and the app behaves exactly as it did
 * before it existed.
 */

const GrowthContext = createContext({ banners: [], cards: [], ads: [], dismiss: () => {}, click: () => {} });

export function useGrowth() {
  return useContext(GrowthContext);
}

/**
 * Moments that are true the instant the app opens, asked for together.
 *
 * The shop does not "navigate to" its trial ending — the fact is simply true when they log
 * in, so the client names every such moment in one request and the server answers with
 * whichever campaigns are waiting on any of them. One round trip instead of eight.
 */
const SESSION_TRIGGERS = [
  'app_open',
  'trial_active',
  'trial_ending',
  'trial_ended',
  'plan_expiring',
  'plan_expired',
  'milestone_bills',
  'inactive_days',
].join(',');

export default function GrowthProvider({ user, enabled = true, upsellOnLock = true, children }) {
  const { lang } = useLanguage();
  const pathname = usePathname();
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [upgradeRequest, setUpgradeRequest] = useState(null);
  const [dismissed, setDismissed] = useState(() => new Set());
  // Campaigns whose impression has already been reported this page load. Without it, every
  // re-render of the shell would count another view and a "once a day" campaign would eat
  // its own budget inside a single session.
  const reported = useRef(new Set());
  const toasted = useRef(new Set());

  const isOwner = user?.role === 'seller';

  /* ------------------------------------------------------------ the 402 → offer path */

  useEffect(() => {
    function onUpgradeNeeded(event) {
      // The operator can switch the sheet off entirely (Admin → Growth → Rules). Then a
      // refused feature falls back to whatever the screen already showed, which is the
      // behaviour the app had before this existed.
      if (!upsellOnLock) return;
      setUpgradeRequest(event.detail || {});
    }
    window.addEventListener('dukaan:upgradeNeeded', onUpgradeNeeded);
    return () => window.removeEventListener('dukaan:upgradeNeeded', onUpgradeNeeded);
  }, [upsellOnLock]);

  /* ------------------------------------------------------------------ the feed */

  const load = useCallback(
    async (trigger, extra = {}) => {
      if (!enabled || !isOwner) return;
      const incoming = await fetchCampaigns({ trigger, lang, ...extra });
      if (!incoming.length) return;
      setItems((current) => {
        // Merged rather than replaced: a session campaign matched on app open must not
        // disappear the moment the shopkeeper navigates and a page_view fetch comes back
        // with a different list.
        const byId = new Map(current.map((item) => [item.id, item]));
        for (const item of incoming) byId.set(item.id, item);
        return [...byId.values()];
      });
    },
    [enabled, isOwner, lang]
  );

  useEffect(() => {
    load(SESSION_TRIGGERS);
  }, [load]);

  useEffect(() => {
    if (!pathname) return;
    // Debounced, because a shopkeeper walking through three screens in two seconds should
    // cost one request, not three.
    const timer = setTimeout(() => {
      const triggers = pathname.startsWith('/seller/plan') ? 'page_view,plan_page' : 'page_view';
      load(triggers, { path: pathname });
    }, 700);
    return () => clearTimeout(timer);
  }, [pathname, load]);

  /* -------------------------------------------------------------- the surfaces */

  const live = useMemo(() => items.filter((item) => !dismissed.has(item.id)), [items, dismissed]);

  const banners = useMemo(() => live.filter((item) => item.placement === 'banner'), [live]);
  const cards = useMemo(() => live.filter((item) => item.placement === 'card'), [live]);
  const modal = useMemo(() => live.find((item) => item.placement === 'modal') || null, [live]);
  const toasts = useMemo(() => live.filter((item) => item.placement === 'toast'), [live]);

  const markSeen = useCallback((item) => {
    if (!item || reported.current.has(item.id)) return;
    reported.current.add(item.id);
    reportCampaignEvent(item.id, 'impression', item.variant);
  }, []);

  // Banners and cards are counted the moment they enter the list: unlike a popup they are
  // part of the page the shopkeeper is already looking at, so "rendered" and "seen" are the
  // same event and there is nothing extra to wait for.
  useEffect(() => {
    for (const item of [...banners, ...cards]) markSeen(item);
  }, [banners, cards, markSeen]);

  const dismiss = useCallback((item) => {
    if (!item) return;
    setDismissed((current) => new Set(current).add(item.id));
    reportCampaignEvent(item.id, 'dismiss', item.variant);
  }, []);

  const click = useCallback((item) => {
    if (!item) return;
    reportCampaignEvent(item.id, 'click', item.variant);
  }, []);

  /* ----------------------------------------------------------------- toasts */

  useEffect(() => {
    for (const item of toasts) {
      if (toasted.current.has(item.id)) continue;
      toasted.current.add(item.id);
      markSeen(item);
      toast.info(item.title || item.body, {
        detail: item.title ? item.body : undefined,
        duration: 8000,
        action: item.ctaLabel && item.ctaHref
          ? {
              label: item.ctaLabel,
              onClick: () => {
                click(item);
                window.location.href = item.ctaHref;
              },
            }
          : null,
      });
    }
  }, [toasts, toast, click, markSeen]);

  const value = useMemo(() => ({ banners, cards, dismiss, click }), [banners, cards, dismiss, click]);

  return (
    <GrowthContext.Provider value={value}>
      {children}
      {modal && (
        <CampaignModal
          item={modal}
          onSeen={() => markSeen(modal)}
          onClick={() => click(modal)}
          onDismiss={() => dismiss(modal)}
        />
      )}
      {upgradeRequest && (
        <UpgradeSheet request={upgradeRequest} user={user} onClose={() => setUpgradeRequest(null)} />
      )}
    </GrowthContext.Provider>
  );
}
