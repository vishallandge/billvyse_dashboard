'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from './LanguageProvider';
import {
  SparkleIcon,
  GridIcon,
  BellIcon,
  ShopIcon,
  OrdersIcon,
  ShieldIcon,
  TagIcon,
  SlidersIcon,
  CreditCardIcon,
  PrinterIcon,
  LockIcon,
  SearchIcon,
  XIcon,
} from './Icons';

const ICONS = {
  sparkle: SparkleIcon,
  grid: GridIcon,
  bell: BellIcon,
  shop: ShopIcon,
  orders: OrdersIcon,
  shield: ShieldIcon,
  tag: TagIcon,
  sliders: SlidersIcon,
  card: CreditCardIcon,
  printer: PrinterIcon,
  lock: LockIcon,
};

/**
 * The index down the side of the Settings page, and the box that searches it.
 *
 * Settings is eleven panels and about eighty controls. Before this it was one unbroken
 * scroll with no map, and the observable cost was shopkeepers failing to find settings they
 * had already been shown once — "GST wala box kahan tha" was a support question the app was
 * generating for itself.
 *
 * Two behaviours, and the second matters more than the first:
 *
 *   The rail jumps. Ordinary anchor navigation, plus a scroll-spy so the rail always says
 *   where you are — a rail that does not track the scroll is a rail people stop trusting
 *   after the second wrong highlight.
 *
 *   The search box FILTERS. Typing "delivery" removes every panel that has nothing to do
 *   with delivery, rather than merely highlighting one — because on a page this tall,
 *   highlighting still leaves the shopkeeper scrolling past nine irrelevant panels to reach
 *   the mark. Filtering is what turns eighty controls back into three.
 *
 * On a phone the rail becomes a horizontal strip of chips: the same index, laid the only
 * way that fits, and still sticky so it does not scroll away with the first panel.
 */
export default function SettingsNav({ sections, activeId, query, onQueryChange, matchCount }) {
  const { t } = useLanguage();
  const inputRef = useRef(null);
  const railRef = useRef(null);

  // The active chip has to be brought into view on a phone, or the strip cheerfully
  // highlights something scrolled off the left edge and reads as broken.
  useEffect(() => {
    if (!activeId || !railRef.current) return;
    const chip = railRef.current.querySelector(`[data-section="${activeId}"]`);
    chip?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [activeId]);

  function jump(event, id) {
    event.preventDefault();
    const target = document.getElementById(`settings-${id}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // The URL follows, so a shopkeeper who is told "Settings → Storefront" over the phone
    // can be sent a link that actually lands there.
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `#settings-${id}`);
  }

  return (
    <nav className="settings-nav" aria-label={t('seller.settingsTitle')}>
      <div className="settings-search">
        <SearchIcon size={15} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t('seller.settingsSearchPlaceholder')}
          aria-label={t('seller.settingsSearchPlaceholder')}
        />
        {query && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              onQueryChange('');
              inputRef.current?.focus();
            }}
            data-tip={t('common.cancel')}
            aria-label={t('common.cancel')}
          >
            <XIcon size={17} />
          </button>
        )}
      </div>

      {/* Said only while searching, and only as a count. A running "12 results" on a page
          nobody is searching is noise; a silent zero is the app looking broken. */}
      {query && (
        <p className="settings-search-count">
          {matchCount === 0
            ? t('seller.settingsSearchNone', { query })
            : t('seller.settingsSearchCount', { count: matchCount })}
        </p>
      )}

      <ul ref={railRef} className="settings-rail">
        {sections.map((section) => {
          const Icon = ICONS[section.icon] || SlidersIcon;
          return (
            <li key={section.id}>
              <a
                href={`#settings-${section.id}`}
                data-section={section.id}
                className={activeId === section.id ? 'is-active' : undefined}
                aria-current={activeId === section.id ? 'true' : undefined}
                onClick={(event) => jump(event, section.id)}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{t(section.labelKey)}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Which panel the reader is looking at.
 *
 * An IntersectionObserver rather than a scroll listener: this fires a handful of times per
 * scroll instead of on every frame, which on the counter PCs this app actually runs on is
 * the difference between a smooth page and a stuttering one.
 *
 * The top margin is what makes it feel right. Without it the "active" section only changes
 * once a panel's top edge reaches the very top of the window, so the rail lags a full panel
 * behind the eye. Pulling the detection line down to about a third of the viewport makes the
 * rail change at the moment a reader would say they had moved on.
 */
export function useActiveSection(ids) {
  const [activeId, setActiveId] = useState(ids[0] || null);
  const key = ids.join('|');

  useEffect(() => {
    if (typeof window === 'undefined' || !ids.length) return undefined;

    const visible = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace('settings-', '');
          if (entry.isIntersecting) visible.set(id, entry.boundingClientRect.top);
          else visible.delete(id);
        }
        if (!visible.size) return;
        // The highest one still on screen — reading down a page, that is the section you
        // are in, not the one that happens to cover the most pixels.
        const [top] = [...visible.entries()].sort((a, b) => a[1] - b[1]);
        setActiveId(top[0]);
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: 0 }
    );

    const nodes = ids.map((id) => document.getElementById(`settings-${id}`)).filter(Boolean);
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
    // Keyed on the joined ids: the array identity changes on every render, and observing
    // eleven panels again on every keystroke is exactly the stutter this was meant to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return activeId;
}
