'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import VoiceSearchButton from '../../components/VoiceSearchButton';
import { highlightParts } from '../../../lib/menuSearch';
import { SearchIcon, XIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, TagIcon } from '../../components/Icons';
import { formatRupees } from '../../../lib/format';

/**
 * The menu search on a table, and the category rail under it.
 *
 * Built the way a shopping app's search works, because that is the search every waiter
 * already knows: suggestions open under the box as you type, the matching part of each
 * name is bold, arrows + Enter pick one, and a spelling slip still finds the dish (lib/menuSearch.js does the ranking). On top of that, the two
 * things only a restaurant needs: "2 naan" adds two, and the dish already on the table
 * says so in the suggestion.
 *
 * Each component renders ONE element. The suggestions are portalled to <body>: `.panel`
 * sets overflow and a transform, so anything positioned inside it is clipped or trapped
 * (see the VoiceSearchButton note on the same trap).
 */

// Measuring the box has to happen before paint in the browser; on the server there is no
// box, and useLayoutEffect there only logs a warning.
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const SUGGEST_DISHES = 6;

function Highlighted({ name, query }) {
  return highlightParts(name, query).map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>));
}

function priceChipText(price, t, lang) {
  if (!price) return '';
  if (price.min !== undefined && price.max !== undefined) {
    return t('tables.msearch.priceBetween', { min: formatRupees(price.min, lang), max: formatRupees(price.max, lang) });
  }
  if (price.max !== undefined) return t('tables.msearch.priceUnder', { amount: formatRupees(price.max, lang) });
  return t('tables.msearch.priceOver', { amount: formatRupees(price.min, lang) });
}

export function MenuSearchBox({
  value,
  onChange,
  search,
  qtyOnTable,
  onPick,
  onCategory,
  isExpired = () => false,
  t,
  lang,
}) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Recent searches were shown here once and taken out at the founder's ask; drop what an
    // earlier version left on this device.
    try {
      localStorage.removeItem('bv:menuRecent');
    } catch {
      // Storage blocked: nothing was saved either.
    }
  }, []);

  const query = value.trim();
  const parsed = search?.parsed || { text: '', qty: null, price: null };
  const qty = parsed.qty || 1;

  // Everything the arrow keys can land on, in the order it is drawn. Nothing until a word is
  // typed — an empty box opens no list.
  const options = [];
  if (query) {
    (search?.results || []).slice(0, SUGGEST_DISHES).forEach(({ product }) => options.push({ type: 'dish', key: `d:${product._id}`, product }));
    const facets = [...(search?.facets || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (facets.length > 1) facets.forEach(([category, count]) => options.push({ type: 'category', key: `c:${category}`, category, count }));
    if (search?.didYouMean) options.push({ type: 'suggest', key: 's', query: search.didYouMean });
  }
  const hasPanel = open && Boolean(query);

  // The highlighted row resets whenever what is typed changes.
  useEffect(() => setActive(-1), [value]);

  // Pinned under the box, sized to what is left of the screen above the keyboard.
  useBrowserLayoutEffect(() => {
    if (!hasPanel) return undefined;
    function place() {
      const node = rootRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const vv = window.visualViewport;
      const bottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
      const room = Math.max(160, bottom - rect.bottom - 12);
      setBox({ top: rect.bottom + 6, left: rect.left, width: rect.width, maxHeight: Math.min(room, 440) });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, [hasPanel]);

  // A tap anywhere that is not the box or its suggestions closes them.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) {
      if (rootRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // "/" jumps to the search from anywhere on the table screen, as on most search sites —
  // but never while typing somewhere else or with a dialog open.
  useEffect(() => {
    function onKey(event) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function pick(product, amount = qty) {
    if (!product) return;
    onPick(product, amount);
    onChange('');
    setOpen(false);
    // Focus stays in the box so the next dish can be typed straight away.
    inputRef.current?.focus();
  }

  function choose(option) {
    if (!option) return;
    if (option.type === 'dish') pick(option.product, qty);
    else if (option.type === 'suggest') {
      onChange(option.query);
      setOpen(true);
      inputRef.current?.focus();
    } else if (option.type === 'category') {
      onCategory(option.category);
      setOpen(false);
    }
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (options.length ? (i + 1) % options.length : -1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (options.length ? (i <= 0 ? options.length - 1 : i - 1) : -1));
    } else if (event.key === 'Enter') {
      if (active >= 0 && options[active]) {
        event.preventDefault();
        choose(options[active]);
      } else if (query && search?.results?.length > 0) {
        // Enter with nothing highlighted adds the best match — the fast path.
        event.preventDefault();
        pick(search.results[0].product);
      }
    } else if (event.key === 'Escape') {
      if (open) setOpen(false);
      else onChange('');
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (active < 0) return;
    panelRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const listId = 'menu-suggest-list';
  const total = search?.total ?? 0;
  let idx = -1;
  const row = () => {
    idx += 1;
    return idx;
  };

  function dishRow(option) {
    const i = row();
    const p = option.product;
    const onTable = qtyOnTable?.get(String(p._id)) || 0;
    const expired = isExpired(p);
    const amount = query ? qty : 1;
    return (
      <li
        key={option.key}
        id={`${listId}-${i}`}
        data-idx={i}
        role="option"
        aria-selected={active === i}
        className={`msuggest__dish${active === i ? ' is-active' : ''}${expired ? ' is-expired' : ''}`}
        onMouseEnter={() => setActive(i)}
        onClick={() => choose(option)}
      >
        {p.photoUrl ? <img src={p.photoUrl} alt="" className="msuggest__thumb" /> : <span className="msuggest__thumb msuggest__thumb--none" aria-hidden="true">{String(p.name || '?').charAt(0)}</span>}
        <span className="msuggest__main">
          <span className="msuggest__name">{query ? <Highlighted name={p.name} query={value} /> : p.name}</span>
          <span className="msuggest__meta">
            {p.category && <span>{p.category}</span>}
            {onTable > 0 && <span className="msuggest__ontable">{t('tables.msearch.onTable', { count: onTable })}</span>}
            {expired && <span className="msuggest__warn">{t('tables.msearch.expired')}</span>}
          </span>
        </span>
        <span className="msuggest__price">{formatRupees(p.price, lang)}</span>
        <span className="msuggest__add" aria-hidden="true">
          <PlusIcon size={13} />
          {amount > 1 ? amount : ''}
        </span>
      </li>
    );
  }

  const panel = hasPanel && box && mounted
    ? createPortal(
      <div
        ref={panelRef}
        className="msuggest"
        style={{ top: box.top, left: box.left, width: box.width, maxHeight: box.maxHeight }}
        // Keeps the focus (and a phone's keyboard) in the box while a row is tapped.
        onMouseDown={(e) => e.preventDefault()}
      >
        {(parsed.qty > 1 || parsed.price) && query && (
          <div className="msuggest__chips">
            {parsed.qty > 1 && <span className="msuggest__chip">{t('tables.msearch.qtyChip', { qty: parsed.qty })}</span>}
            {parsed.price && <span className="msuggest__chip"><TagIcon size={12} /> {priceChipText(parsed.price, t, lang)}</span>}
          </div>
        )}
        <ul id={listId} role="listbox" className="msuggest__list" aria-label={t('tables.searchMenu')}>
          {query && search?.partial && options.some((o) => o.type === 'dish') && (
            <li className="msuggest__note" role="presentation">{t('tables.msearch.partial')}</li>
          )}
          {query && options.filter((o) => o.type === 'dish').map(dishRow)}
          {query && options.some((o) => o.type === 'category') && (
            <li className="msuggest__head" role="presentation"><span>{t('tables.msearch.inCategoryHead')}</span></li>
          )}
          {query && options.filter((o) => o.type === 'category').map((o) => {
            const i = row();
            return (
              <li
                key={o.key}
                id={`${listId}-${i}`}
                data-idx={i}
                role="option"
                aria-selected={active === i}
                className={`msuggest__cat${active === i ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
              >
                <SearchIcon size={14} />
                <span>{t('tables.msearch.inCategory', { q: parsed.text || query, category: o.category })}</span>
                <span className="msuggest__count">{o.count}</span>
              </li>
            );
          })}
          {query && total === 0 && (
            <li className="msuggest__empty" role="presentation">
              {t('tables.menuNoMatch')}
              <small>{t('tables.msearch.tips')}</small>
            </li>
          )}
          {query && options.filter((o) => o.type === 'suggest').map((o) => {
            const i = row();
            return (
              <li
                key={o.key}
                id={`${listId}-${i}`}
                data-idx={i}
                role="option"
                aria-selected={active === i}
                className={`msuggest__cat${active === i ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
              >
                <SearchIcon size={14} />
                <span>{t('tables.msearch.didYouMean')} <strong>{o.query}</strong>?</span>
              </li>
            );
          })}
        </ul>
        {query && total > SUGGEST_DISHES && (
          <p className="msuggest__more">{t('tables.msearch.moreBelow', { count: total })}</p>
        )}
        <p className="msuggest__keys">{t('tables.msearch.keysHint')}</p>
      </div>,
      document.body,
    )
    : null;

  return (
    <div ref={rootRef} className={`menu-search${value ? ' has-query' : ''}${hasPanel ? ' is-open' : ''}`} role="search">
      <SearchIcon size={18} />
      <input
        ref={inputRef}
        id="menuSearch"
        type="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        role="combobox"
        aria-expanded={hasPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={t('tables.msearch.placeholder')}
        aria-label={t('tables.searchMenu')}
      />
      {/* No count pill in here: the results line under the rail says how many, and on a
          phone the pill took the room the words being typed needed. */}
      {value && (
        <button
          type="button"
          className="menu-search__clear"
          aria-label={t('tables.menuClear')}
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
        >
          <XIcon size={16} />
        </button>
      )}
      <VoiceSearchButton
        size={17}
        onResult={({ transcript, isFinal, text, quantity }) => {
          // Interim words stream into the box; the final one keeps a spoken count ("do naan").
          onChange(isFinal && quantity && quantity >= 1 && Number.isInteger(quantity) ? `${quantity} ${text}` : transcript);
          setOpen(true);
          if (isFinal) inputRef.current?.focus();
        }}
      />
      {panel}
    </div>
  );
}

/**
 * The category pills, as a rail that scrolls on every device: swipe on a phone, the mouse
 * wheel or a drag on a desktop, arrow buttons at either end whenever there is more to see,
 * and the chosen pill always brought into view. A hidden scrollbar with no other way to
 * move it was the old version — on a desktop the last categories simply could not be
 * reached.
 */
export function CategoryRail({ categories, value, onChange, counts, searching, t }) {
  const scrollRef = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const drag = useRef(null);

  function measure() {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdges((cur) => (cur.left === left && cur.right === right ? cur : { left, right }));
  }

  useEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el) return undefined;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    // A vertical wheel moves the rail sideways — but only while there is somewhere to go,
    // so the page still scrolls once the rail is at its end.
    function onWheel(event) {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const next = Math.min(max, Math.max(0, el.scrollLeft + event.deltaY));
      if (next === el.scrollLeft) return;
      event.preventDefault();
      el.scrollLeft = next;
      measure();
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro?.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, [categories.length]);

  // Counts and names change the rail's width without resizing the rail itself, which the
  // ResizeObserver above cannot see.
  useEffect(() => {
    measure();
  }, [categories, counts, value]);

  // The chosen pill comes into view — set from the search suggestions, it may be off-screen.
  useEffect(() => {
    const el = scrollRef.current;
    const pill = el?.querySelector('.filter-pill.active');
    if (!el || !pill) return;
    const pad = 40;
    if (pill.offsetLeft < el.scrollLeft + pad) el.scrollTo({ left: Math.max(0, pill.offsetLeft - pad), behavior: 'smooth' });
    else if (pill.offsetLeft + pill.offsetWidth > el.scrollLeft + el.clientWidth - pad) {
      el.scrollTo({ left: pill.offsetLeft + pill.offsetWidth - el.clientWidth + pad, behavior: 'smooth' });
    }
  }, [value]);

  function page(direction) {
    const el = scrollRef.current;
    if (el) el.scrollBy({ left: direction * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' });
  }

  // Drag to scroll with a mouse. Touch already swipes natively and is left alone.
  function onPointerDown(event) {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag.current = { x: event.clientX, left: scrollRef.current.scrollLeft, moved: false };
  }
  function onPointerMove(event) {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 5) d.moved = true;
    if (d.moved) {
      scrollRef.current.scrollLeft = d.left - dx;
      measure();
    }
  }
  function onPointerUp() {
    // Cleared after the click that follows, so a drag never also picks a pill.
    setTimeout(() => { drag.current = null; }, 0);
  }
  function onClickCapture(event) {
    if (drag.current?.moved) {
      event.stopPropagation();
      event.preventDefault();
    }
  }

  // Left/right arrows walk the pills, as in any tab list.
  function onKeyDown(event) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const pills = [...scrollRef.current.querySelectorAll('.filter-pill')];
    const at = pills.indexOf(document.activeElement);
    if (at === -1) return;
    event.preventDefault();
    const next = pills[Math.min(pills.length - 1, Math.max(0, at + (event.key === 'ArrowRight' ? 1 : -1)))];
    next?.focus();
    next?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  const allCount = searching ? [...counts.values()].reduce((a, b) => a + b, 0) : null;

  return (
    <div className={`cat-rail${edges.left ? ' can-left' : ''}${edges.right ? ' can-right' : ''}`}>
      {edges.left && (
        <button type="button" className="cat-rail__arrow is-left" onClick={() => page(-1)} aria-label={t('tables.msearch.scrollLeft')} tabIndex={-1}>
          <ChevronLeftIcon size={16} />
        </button>
      )}
      <div
        ref={scrollRef}
        className="category-tabs cat-rail__scroll"
        role="tablist"
        aria-label={t('tables.allCategories')}
        onScroll={measure}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onClickCapture={onClickCapture}
        onKeyDown={onKeyDown}
      >
        <button type="button" role="tab" aria-selected={!value} className={`filter-pill ${!value ? 'active' : ''}`} onClick={() => onChange('')}>
          {t('tables.allCategories')}
          {allCount !== null && <span className="filter-pill__count">{allCount}</span>}
        </button>
        {categories.map((c) => {
          const n = counts.get(c) || 0;
          return (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={value === c}
              className={`filter-pill ${value === c ? 'active' : ''}${searching && n === 0 ? ' is-empty' : ''}`}
              onClick={() => onChange(value === c ? '' : c)}
            >
              {c}
              <span className="filter-pill__count">{n}</span>
            </button>
          );
        })}
      </div>
      {edges.right && (
        <button type="button" className="cat-rail__arrow is-right" onClick={() => page(1)} aria-label={t('tables.msearch.scrollRight')} tabIndex={-1}>
          <ChevronRightIcon size={16} />
        </button>
      )}
    </div>
  );
}
