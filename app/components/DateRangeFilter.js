'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarIcon, XIcon } from './Icons';
import { useLanguage } from './LanguageProvider';

// Preset ids are the same strings the backend's utils/dateRange.js understands, so a
// filter value can be turned into a query string without any translation layer.
export const RANGE_PRESETS = [
  'today',
  'yesterday',
  'last7',
  'last30',
  'week',
  'month',
  'lastMonth',
  'quarter',
  'fy',
  'all',
];

export const DEFAULT_RANGE = { preset: 'today', from: '', to: '' };

export function rangeToQuery(range) {
  if (!range) return '';
  const params = new URLSearchParams();
  params.set('preset', range.preset || 'today');
  if (range.preset === 'custom') {
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
  }
  return params.toString();
}

function todayInputValue() {
  // A date input wants shop-local YYYY-MM-DD; the browser is already in the shop's
  // timezone, so its own local parts are the right ones to read.
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const POPOVER_WIDTH = 300;
const MOBILE_BREAKPOINT = 520;
/** Kept clear of every viewport edge, so the box never sits flush against the screen. */
const VIEWPORT_MARGIN = 12;

/**
 * The one date filter used by every list and report screen. Presets cover the 95% case
 * in a single tap; "Custom" opens a from/to pair for the rest. Nothing is applied until
 * a custom range actually has both dates, so the list never flickers through a
 * half-typed year.
 */
export default function DateRangeFilter({ value, onChange, presets = RANGE_PRESETS, compact = false }) {
  const { t } = useLanguage();
  const range = value || DEFAULT_RANGE;
  const [customOpen, setCustomOpen] = useState(range.preset === 'custom');
  const [draft, setDraft] = useState({ from: range.from || todayInputValue(), to: range.to || todayInputValue() });
  // Where the portalled popover should sit, in viewport coordinates — computed fresh
  // every time it opens from the trigger button's own position.
  const [coords, setCoords] = useState(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  // The chip strip. Only matters on a phone, where it is a sideways scroller rather than
  // a wrapping row (see .range-chips).
  const chipsRef = useRef(null);

  // document.body doesn't exist during server rendering, so the portal target is only
  // safe to touch once mounted in the browser.
  useEffect(() => setMounted(true), []);

  // Which edges of the strip still have chips behind them. Drives the fade in
  // globals.css: drawn only where there is genuinely more to swipe to, so a strip that
  // fits (every desktop, and a short preset list on a phone) carries no fade at all and
  // a strip scrolled to its end stops advertising a right edge that no longer exists.
  const syncEdges = useCallback(() => {
    const box = chipsRef.current;
    if (!box) return;
    // 1px of slack: a fractional scrollLeft after a smooth scroll or a zoomed viewport
    // would otherwise leave a fade pinned on at either extreme.
    const max = box.scrollWidth - box.clientWidth;
    const left = box.scrollLeft > 1;
    const right = box.scrollLeft < max - 1;
    box.dataset.edge = left && right ? 'both' : left ? 'left' : right ? 'right' : 'none';
  }, []);

  // A selected chip that sits off the right of the strip is the same bug as no selection
  // at all: the shopkeeper opens Insights on "30 days" and sees a row starting at "Today"
  // with nothing highlighted. Scroll it into view — by hand rather than with
  // scrollIntoView(), which walks up the ancestor chain and would drag the whole page
  // sideways or jump it down to the filter bar on load.
  const revealActive = useCallback(() => {
    const box = chipsRef.current;
    // Read off the DOM rather than holding a ref: the selected chip may be the custom one
    // or a preset one, and on a screen whose `presets` list does not contain the current
    // preset (the billing register's short list, fed a range picked elsewhere) it is
    // neither, and there is nothing to scroll to.
    const chip = box?.querySelector('.range-chip.active');
    if (!box || !chip) return;
    // Land the chip clear of the 2rem fade rather than flush under it.
    const pad = 32;
    const start = chip.offsetLeft - pad;
    const end = chip.offsetLeft + chip.offsetWidth + pad;
    if (start < box.scrollLeft) box.scrollLeft = Math.max(0, start);
    else if (end > box.scrollLeft + box.clientWidth) box.scrollLeft = end - box.clientWidth;
  }, []);

  function openCustom() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      // Clamped so a button sitting near the right edge of the screen still gets a
      // popover that lands fully on screen instead of running off it. The vertical half
      // of the same job needs the popover's real height, which does not exist yet — see
      // the layout effect below, which corrects this first guess before it is painted.
      const left = Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN);
      setCoords({ top: rect.bottom + 8, left: Math.max(VIEWPORT_MARGIN, left) });
    }
    setCustomOpen(true);
  }


  // Rendered outside the trigger's own DOM subtree (see the portal below), so "click
  // outside to close" has to check against both the button that opened it and the
  // popover itself — neither is an ancestor of the other any more.
  useEffect(() => {
    if (!customOpen) return undefined;
    function onDown(event) {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(event.target) &&
        popoverRef.current &&
        !popoverRef.current.contains(event.target)
      ) {
        setCustomOpen(false);
      }
    }
    // A stale popover pinned to a button that has since scrolled away reads as broken —
    // closing it is simpler and safer than tracking scroll to reposition it.
    function onScroll() {
      setCustomOpen(false);
    }
    // Same reasoning for a rotated phone or a resized window: the coordinates were
    // measured against the old viewport, and the pinned/centred choice below was made
    // against the old width. Closing re-measures both on the next tap.
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('orientationchange', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('orientationchange', onScroll);
    };
  }, [customOpen]);

  function pick(preset) {
    setCustomOpen(false);
    onChange({ preset, from: '', to: '' });
  }

  function applyCustom(event) {
    event.preventDefault();
    if (!draft.from || !draft.to) return;
    // Swapped dates are a slip, not an error worth a message — just fix the order.
    const [from, to] = draft.from <= draft.to ? [draft.from, draft.to] : [draft.to, draft.from];
    onChange({ preset: 'custom', from, to });
    setCustomOpen(false);
  }

  const customLabel =
    range.preset === 'custom' && range.from && range.to
      ? `${range.from.split('-').reverse().join('/')} – ${range.to.split('-').reverse().join('/')}`
      : t('range.custom');

  // Re-measured on every change that can move the chips: a new selection, a custom label
  // that grew from "Custom" to a pair of dates, a different preset list, a rotated phone,
  // and the font swap that reflows every chip a beat after first paint (ResizeObserver
  // catches that one, which a resize listener alone does not).
  useEffect(() => {
    // No `mounted` guard: effects never run during server rendering anyway, and waiting
    // for the extra render that flag costs would leave the strip sitting at scroll 0 for
    // a frame before jumping to the selected chip.
    revealActive();
    syncEdges();
    const box = chipsRef.current;
    if (!box || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncEdges);
      return () => window.removeEventListener('resize', syncEdges);
    }
    const observer = new ResizeObserver(syncEdges);
    observer.observe(box);
    return () => observer.disconnect();
  }, [range.preset, customLabel, presets, revealActive, syncEdges]);


  // Below the mobile breakpoint the popover is centred on the viewport by CSS instead
  // of pinned under the button (there usually isn't room), so no inline coordinates are
  // pushed down to fight that rule.
  const isDesktop = mounted && window.innerWidth > MOBILE_BREAKPOINT;

  /**
   * Put the box where it actually fits, now that there is a box to measure.
   *
   * `openCustom` can only guess the vertical placement: it runs on the click, before the
   * popover exists, so it drops it 8px under the button and hopes. On a laptop in
   * landscape — or any screen where the filter bar sits low, which on a long report is
   * most of them — that put Apply and Cancel below the fold, and because the popover is
   * `position: fixed` and scrolling closes it, there was no way to reach them at all.
   *
   * So once it is mounted, it is measured and moved: below the button if it fits there,
   * flipped above it if it does not, and clamped to the viewport if neither has room
   * (a very short window, where the popover scrolls inside itself instead — see the
   * max-height in globals.css).
   *
   * `useEffect` rather than `useLayoutEffect` on purpose: this component renders on the
   * server, where useLayoutEffect warns, and the correction lands inside the popover's own
   * 180ms entrance animation where a first-frame adjustment cannot be seen. It does not
   * depend on `coords`, and the equality check keeps a corrected position from scheduling
   * another render — so this settles in one pass, never a loop.
   */
  useEffect(() => {
    if (!customOpen || !isDesktop) return;
    const box = popoverRef.current;
    const trigger = triggerRef.current;
    if (!box || !trigger) return;

    /*
     * offsetWidth/offsetHeight, NOT getBoundingClientRect().
     *
     * This effect fires in the first frame of the popover's own `popIn` entrance, which
     * ends on `translateY(0) scale(1)` — so at the moment of measuring it is still ~3%
     * small and 6px high. getBoundingClientRect() reports that transformed box, and the
     * placement below would be computed against a popover that does not exist yet. The
     * offset* pair reads the untransformed layout box and is right on the first frame.
     */
    const height = box.offsetHeight;
    const width = box.offsetWidth;
    const anchor = trigger.getBoundingClientRect();

    let top = anchor.bottom + 8;
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      // Above the button, if that is where it fits. Otherwise pinned to the bottom of the
      // viewport — a popover taller than the whole screen has nowhere good to go, and its
      // own max-height turns it into a scroller rather than letting Apply fall off.
      const above = anchor.top - height - 8;
      top = above >= VIEWPORT_MARGIN
        ? above
        : Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
    }
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, anchor.left),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
    );

    setCoords((current) =>
      current && Math.abs(current.top - top) < 0.5 && Math.abs(current.left - left) < 0.5
        ? current
        : { top, left }
    );
    // `coords` is deliberately not a dependency: this reads the DOM, not the state, and
    // listing it would re-run the effect on the very update it just made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customOpen, isDesktop]);

  const popover = customOpen && (
    <>
      {/* Tapping anywhere outside also closes it (see the mousedown listener above),
          but a visible backdrop on a phone makes that affordance obvious instead of the
          popover just feeling stuck open. */}
      <div className="range-popover-backdrop" onClick={() => setCustomOpen(false)} />
      <form
        className="range-popover"
        style={isDesktop && coords ? { top: coords.top, left: coords.left } : undefined}
        onSubmit={applyCustom}
        ref={popoverRef}
      >
        <div className="range-popover-head">
          <span className="icon-badge icon-brand"><CalendarIcon size={14} /></span>
          <span className="range-popover-title">{t('range.pickDates')}</span>
          <button type="button" className="modal-close" onClick={() => setCustomOpen(false)} aria-label={t('common.cancel')}>
            <XIcon size={15} />
          </button>
        </div>
        <div className="range-popover-fields">
          <div className="field">
            <label>{t('range.from')}</label>
            <input type="date" value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} autoFocus />
          </div>
          <div className="field">
            <label>{t('range.to')}</label>
            <input type="date" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
          </div>
        </div>
        <div className="range-popover-actions">
          <button type="submit" className="btn btn-primary btn-small" disabled={!draft.from || !draft.to}>
            {t('range.apply')}
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setCustomOpen(false)}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </>
  );

  return (
    <div className={`range-filter${compact ? ' range-filter-compact' : ''}`}>
      {!compact && (
        <div className="range-filter-label">
          <span className="icon-badge icon-brand"><CalendarIcon size={14} /></span>
          {t('range.label')}
        </div>
      )}
      <div className="range-chips" role="group" aria-label={t('range.label')} ref={chipsRef} onScroll={syncEdges}>
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`range-chip${range.preset === preset ? ' active' : ''}`}
            onClick={() => pick(preset)}
          >
            {t(`range.${preset}`)}
          </button>
        ))}

        <button
          type="button"
          ref={triggerRef}
          className={`range-chip range-chip-custom${range.preset === 'custom' ? ' active' : ''}`}
          onClick={() => (customOpen ? setCustomOpen(false) : openCustom())}
        >
          <CalendarIcon size={14} />
          {customLabel}
        </button>
      </div>

      {/* Portalled straight to <body> so the popover's stacking is never trapped inside
          an ancestor's local stacking context — several panels on this page (.filter-bar
          itself included) run a fadeInUp entrance animation, and CSS creates a new
          stacking context for the whole duration+lifetime of any non-none `transform`,
          including the harmless-looking `translateY(0)` the animation ends on. A z-index
          set on a descendant of one of those elements can never out-rank a later sibling
          like the stat cards below it, no matter how high the number — only escaping the
          subtree entirely fixes it. */}
      {mounted && createPortal(popover, document.body)}
    </div>
  );
}
