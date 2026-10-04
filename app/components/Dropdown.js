'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useBackDismiss from '../../lib/backDismiss';
import { ChevronDownIcon, CheckIcon } from './Icons';

const LIST_MAX_HEIGHT = 280;
// Below this, a downward-opening list would be too short to be useful — only then is it
// worth flipping upward instead. Using this (rather than the full 280) as the flip
// threshold means most fields still open downward with a shorter, clamped list instead of
// flipping and swallowing whatever sits just above the trigger (a label, the field above).
const MIN_USEFUL_HEIGHT = 140;

// A real, fully-styled replacement for <select> — the native element can't be styled once
// its option list is open (the browser renders that part itself, off-brand and sometimes
// mis-positioned relative to whatever card/modal it's inside). Same portal-to-<body> +
// getBoundingClientRect positioning as DateRangeFilter.js, which already solved exactly
// this for the date-range popover.
//
// `searchable` is opt-in on purpose. Most of the ~55 dropdowns in this app are a unit, a
// payment mode or a GST slab — six options where a filter box is one more thing to look
// at. It is for the two or three lists that grow with the business: a shop with 300 khata
// customers cannot find "Ramesh" by scrolling, and at a counter with someone waiting,
// scrolling is the whole cost.
export default function Dropdown({
  id,
  value,
  onChange,
  options,
  groups,
  placeholder,
  className = '',
  disabled = false,
  searchable = false,
  searchPlaceholder = '',
  emptyLabel = 'No match',
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => setMounted(true), []);
  const touchFirst = mounted && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

  /* On a phone an open option list covers the screen, so back reads as "close this list",
     not "leave the page". Without it, choosing a unit and changing your mind shuts the
     installed app on the form you were filling. */
  useBackDismiss(() => setOpen(false), open);

  const allOptions = groups ? groups.flatMap((g) => g.options) : options || [];
  const selected = allOptions.find((o) => String(o.value) === String(value));

  // Filtering is on the label because that is the only thing the person looking at the
  // list can see — matching the value would mean matching an id nobody has ever read.
  const needle = searchable ? search.trim().toLowerCase() : '';
  const matches = (option) => !needle || String(option.label).toLowerCase().includes(needle);
  const shownGroups = groups
    ? groups.map((g) => ({ ...g, options: g.options.filter(matches) })).filter((g) => g.options.length > 0)
    : null;
  const shownOptions = groups ? null : (options || []).filter(matches);
  const shownCount = shownGroups ? shownGroups.reduce((n, g) => n + g.options.length, 0) : shownOptions.length;

  function openList() {
    // Every opening starts from the whole list. A filter left over from the last time this
    // dropdown was opened is a list that looks like it has lost most of its options.
    setSearch('');
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const margin = 8;
      // The list mirrors the trigger's width, and on a phone a full-width trigger inside a
      // modal can be wider than what's left after the 8px gutters — clamping here (rather
      // than letting the fixed-position box run off the edge) is what keeps the last
      // option's tick mark on screen on a 360px handset.
      const width = Math.min(rect.width, window.innerWidth - margin * 2);
      const left = Math.min(rect.left, window.innerWidth - width - margin);
      const spaceBelow = window.innerHeight - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      const openUp = spaceBelow < MIN_USEFUL_HEIGHT && spaceAbove > spaceBelow;
      const maxHeight = Math.max(MIN_USEFUL_HEIGHT, Math.min(LIST_MAX_HEIGHT, openUp ? spaceAbove : spaceBelow));
      setCoords({
        left: Math.max(margin, left),
        width,
        maxHeight,
        ...(openUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      });
    }
    setOpen(true);
  }

  // Portalled out of the trigger's own DOM subtree, so "click outside" has to check both
  // pieces separately — same reasoning as DateRangeFilter's popover.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(event.target) &&
        listRef.current &&
        !listRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    function onScroll(event) {
      // Scrolling the open list itself (it's a fixed-height, overflow-y:auto box once the
      // option count grows — Unit's grouped list included) fires a 'scroll' event too, and
      // a capture-phase window listener sees it before it ever reaches the list. Without
      // this check, scrolling to reach an option instantly closed the list on the first
      // pixel of movement — the list could never actually be scrolled through.
      if (listRef.current && listRef.current.contains(event.target)) return;
      // Typing in the search box: a phone browser scrolls the page to lift the focused box
      // above its keyboard, and that scroll is the browser's, not the person's.
      if (listRef.current && listRef.current.contains(document.activeElement)) return;
      setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    // The list is position:fixed at coordinates measured once, when it opened — rotating a
    // phone or resizing a browser window leaves it floating away from its trigger. Closing
    // is the honest response: the next tap re-measures against the new viewport.
    //
    // WIDTH only. On Android the on-screen keyboard opening is a height-only resize, and
    // closing on that made a searchable list flash open and shut the instant the search
    // box was tapped — the list could never be typed into on a phone.
    const openWidth = window.innerWidth;
    function onResize() {
      if (window.innerWidth !== openWidth) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function pick(val) {
    onChange(val);
    setOpen(false);
  }

  function renderOption(option) {
    const isSelected = String(option.value) === String(value);
    return (
      <button
        type="button"
        key={option.value}
        role="option"
        aria-selected={isSelected}
        className={`dropdown-option${isSelected ? ' selected' : ''}`}
        onClick={() => pick(option.value)}
      >
        <span>{option.label}</span>
        {isSelected && <CheckIcon size={14} />}
      </button>
    );
  }

  const list = open && (
    <div
      className="dropdown-list"
      style={{ position: 'fixed', maxHeight: LIST_MAX_HEIGHT, ...coords }}
      ref={listRef}
      role="listbox"
    >
      {searchable && (
        <div className="dropdown-search">
          <input
            type="text"
            value={search}
            // A mouse gets the box focused; a finger does not. Focusing on touch throws the
            // keyboard over half the screen before the person has even seen the list —
            // most of the time they wanted to tap an option, not type.
            autoFocus={!touchFirst}
            placeholder={searchPlaceholder}
            onChange={(e) => setSearch(e.target.value)}
            // Enter picks the only thing left, which is what typing three letters of a
            // name is for. Escape is handled by the shared key handler above.
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const only = shownGroups ? shownGroups.flatMap((g) => g.options) : shownOptions;
              if (only.length > 0) pick(only[0].value);
            }}
          />
        </div>
      )}
      {shownGroups
        ? shownGroups.map((group) => (
            <div key={group.label} className="dropdown-group">
              {/* An unlabelled group is a lead-in option ("Any action") above the named ones. */}
              {group.label && <div className="dropdown-group-label">{group.label}</div>}
              {group.options.map(renderOption)}
            </div>
          ))
        : shownOptions.map(renderOption)}
      {shownCount === 0 && <p className="dropdown-empty">{emptyLabel}</p>}
    </div>
  );

  return (
    <div className={`dropdown-field ${disabled ? 'disabled' : ''} ${className}`}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="dropdown-trigger"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="dropdown-trigger-label">{selected ? selected.label : placeholder}</span>
        <ChevronDownIcon size={15} className={`dropdown-caret${open ? ' open' : ''}`} />
      </button>
      {mounted && list && createPortal(list, document.body)}
    </div>
  );
}
