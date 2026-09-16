'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from './LanguageProvider';
import { formatRupees } from '../../lib/format';
import Dropdown from './Dropdown';
import RowMenu from './RowMenu';
import {
  AlertIcon,
  ClockIcon,
  PlusIcon,
  MinusIcon,
  SearchIcon,
  TruckIcon,
  EyeIcon,
  EyeOffIcon,
  LayersIcon,
  CheckIcon,
  RowsIcon,
  ListIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from './Icons';

/**
 * The reorder list, as something you can act on in one pass instead of one tap at a time.
 *
 * The complaint this was built from: eleven things are low, the shopkeeper wants six of
 * them on today's order, and the only way to say so was to tap six separate chips — each
 * one reopening the form, each one at whatever quantity the app guessed, with no running
 * total and no way to say "not this one" about the other five. Every morning, again.
 *
 * So the surface is a list with checkboxes and a running total, and the two things that
 * were missing around the selection itself:
 *
 *   · a quantity you can change *before* it lands on the order, because the suggestion is
 *     a 14-day estimate and the man on the phone sells in cases of 24.
 *   · the wholesaler, on the row. A purchase order has exactly one supplier, so a
 *     selection spanning three of them is not one order — it is three. Rather than
 *     silently dropping two, the bar offers to raise all three as drafts.
 *
 * Renders exactly one element (the panel), so a page can drop it anywhere a panel goes.
 *
 * onAdd(rows)            rows: [{ suggestion, quantity }] — put these on the open form.
 * onSplitBySupplier(gs)  gs: [{ supplierId, supplierName, rows }] — raise one draft each.
 *                        Omitted, the split button is simply absent (the suppliers page
 *                        has no form to raise anything from).
 * onSnooze(ids, days)    days 0 wakes them up again. Omitted, snoozing is absent.
 */

const BANDS = ['', 'out', 'critical', 'low', 'pending', 'dormant'];

/* ---------------------------------------------------------------------------
   How the list holds together once it stops being short.

   Measured, not guessed: at 22 suggestions the panel was 1,681px — two full
   laptop screens of identical 65px rows, sitting on a page that has other work
   on it. Every row carried the same weight whether it was a decision (this is
   out of stock and costing ₹88 a day) or a formality (this one is fine, next).

   Three separate things were wrong, so there are three separate answers and
   they are on different axes:

     STRUCTURE  the list was already sorted by urgency and never said so. It is
                now cut into sections that carry that sort, each with its own
                count and its own rupee subtotal.
     WEIGHT     a second row shape. On a long list the reason moves off its own
                line (onto the row's tooltip) and a row is ~40px instead of 65.
     VOLUME     the old flat "first 8 of 22" cap is gone. The cap is per SECTION
                now, so what is hidden is always "more of this same kind" rather
                than an arbitrary slice through the middle of the round.

   None of it appears on a short list. A shop with six low items gets exactly
   what it got before — new chrome for a problem you do not have is its own
   kind of mess.
   --------------------------------------------------------------------------- */

const GROUP_MODES = ['urgency', 'supplier', 'none'];

// Above this many rows the panel stops being a glance and becomes a job of work.
const LONG_LIST = 12;
// Per section. Eight compact rows is about a third of a screen — enough to see the
// shape of a band without any one of them laying a wall across the page.
const SECTION_ROWS = 8;
// Per device, like the motion level and for the same reason: the counter tablet and
// the owner's phone are used differently by different people.
const VIEW_KEY = 'dukaan.reorderView';

// The band a row belongs to. Already ordered and dormant are answers in themselves and
// outrank the stock reading — a thing that is out of stock but on its way is not a
// decision about buying, it is a decision about chasing.
function bandOf(suggestion) {
  if (suggestion.alreadyOrdered) return 'pending';
  if (suggestion.dormant) return 'dormant';
  return suggestion.urgency || 'low';
}

// The order sections appear in, which is the order the decisions should be made in.
const BAND_ORDER = ['out', 'critical', 'low', 'pending', 'dormant'];
// Sections that stay open however long the list is. "Khatam" is the reason the
// shopkeeper opened the panel; collapsing it to save space would save the wrong space.
const URGENT_BANDS = new Set(['out', 'critical']);

// The quantity a row starts at. An item already part-ordered starts at what is still
// missing, not at the full suggestion — adding the whole 20 again on top of an open order
// for 15 is the double-order this list exists to prevent.
function defaultQty(suggestion) {
  const short = suggestion.alreadyOrdered?.shortfall;
  return String(short > 0 ? short : suggestion.suggestedQty);
}

// A row already fully covered by an open order is not a decision — it stays on the list as
// a status, but it cannot be picked. One with a shortfall can: the top-up is real.
function isPickable(suggestion) {
  return !suggestion.alreadyOrdered || suggestion.alreadyOrdered.shortfall > 0;
}

/**
 * Why this row is on the list, in one sentence, in money or in days.
 *
 * The list used to state a fact — "4 packet left" — and leave the shopkeeper to work out
 * whether that mattered. It never does the same amount of mattering twice: 4 packets of
 * Colgate is three days and 4 boxes of Diwali sweets is next October. So each row now says
 * the consequence rather than the reading, and says it in rupees wherever there are rupees
 * to say it in, because that is the only unit a purchase argues in.
 */
function reasonFor(suggestion, t, lang, formatRupees) {
  const s = suggestion;
  const pending = s.alreadyOrdered;
  if (pending && pending.shortfall > 0) {
    return t('purchase.reorderWhyShort', { po: pending.poLabel, ordered: pending.quantity, short: pending.shortfall });
  }
  if (s.dormant) return t('purchase.reorderWhyDormant');
  if (s.product.stock <= 0) {
    return s.dailySales > 0
      ? t('purchase.reorderWhyOutMoney', { amount: formatRupees(s.dailySales, lang) })
      : t('purchase.reorderWhyOut');
  }
  const days = s.daysLeft == null ? null : Math.round(s.daysLeft);
  if (days != null && days <= 7) {
    // "About 1 days left" on the row a shopkeeper is most likely to act on is the sort of
    // thing that makes the whole panel read as machine output, so one day gets its own line.
    const one = days === 1 ? 'One' : '';
    return s.dailySales > 0
      ? t(`purchase.reorderWhySoonMoney${one}`, { days, amount: formatRupees(s.dailySales, lang) })
      : t(`purchase.reorderWhySoon${one}`, { days });
  }
  return t('purchase.reorderWhyLow', { sold: s.soldLast30Days, unit: s.product.unit });
}

function unitCostOf(suggestion) {
  return suggestion.unitCost ?? suggestion.lastBuy?.effectiveCost ?? suggestion.product.costPrice ?? 0;
}

export default function ReorderPanel({
  suggestions = [],
  summary = null,
  loading = false,
  busy = false,
  onAdd,
  onSplitBySupplier,
  onSnooze,
  onOpenOrder,
  onToggleSnoozed,
  showingSnoozed = false,
  headerExtra = null,
}) {
  const { t, lang } = useLanguage();
  const [search, setSearch] = useState('');
  const [band, setBand] = useState('');
  // Urgency by default: it is the order the list is already sorted in, and "what is about
  // to stop selling" is the question the panel exists to answer. Supplier is the other
  // real question — "aaj kis wholesaler ko phone karna hai" — and used to be a separate
  // icon toggle, which made two groupings of one list look like two unrelated features.
  const [groupBy, setGroupBy] = useState('urgency');
  // null until the shopkeeper says otherwise, and then remembered. Left null, the panel
  // picks by length: a short list is worth reading, a long one is worth sweeping.
  const [viewPref, setViewPref] = useState(null);
  // Only the sections he has actually opened or closed himself. Everything else follows
  // the default, which keeps the panel from arguing with him after a reload.
  const [sectionOpen, setSectionOpen] = useState(() => new Map());
  const [sectionAll, setSectionAll] = useState(() => new Set());
  // productId -> quantity, as a string, because it is what a text input holds. A Map keeps
  // the two facts that matter together; a Set of ids would need a second store for the
  // edited quantities and they would drift apart the first time a row was filtered away.
  const [picked, setPicked] = useState(() => new Map());

  // A reload replaces the rows underneath the selection. Anything picked that is no longer
  // on the list (it was ordered, or the stock came in) is dropped rather than silently
  // travelling onto the next order the shopkeeper builds.
  useEffect(() => {
    setPicked((current) => {
      if (current.size === 0) return current;
      const live = new Set(suggestions.map((s) => String(s.product.id)));
      const next = new Map([...current].filter(([id]) => live.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [suggestions]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return suggestions.filter((s) => {
      if (needle) {
        const haystack = `${s.product.name} ${s.product.category || ''} ${s.lastBuy?.supplierName || ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (!band) return true;
      if (band === 'pending') return Boolean(s.alreadyOrdered);
      if (band === 'dormant') return Boolean(s.dormant);
      return !s.alreadyOrdered && s.urgency === band;
    });
  }, [suggestions, search, band]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === 'compact' || saved === 'detailed') setViewPref(saved);
    } catch {
      // Private mode, or storage blocked. The length-based default is a fine answer.
    }
  }, []);

  const long = visible.length > LONG_LIST;
  const view = viewPref || (long ? 'compact' : 'detailed');
  const compact = view === 'compact';

  function chooseView(next) {
    setViewPref(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // It reverts to the length-based default next visit, which is the harmless failure.
    }
  }

  /**
   * The list, cut into the sections it is already sorted into.
   *
   * Every mode produces the same shape — `{ key, label, tone, rows }` — so the renderer
   * below has one job and not three. "None" is a single unnamed section rather than a
   * separate code path, which is what stops the flat list quietly missing a fix the
   * grouped ones get.
   */
  const sections = useMemo(() => {
    if (groupBy === 'none') {
      return [{ key: 'all', label: null, tone: null, rows: visible }];
    }

    if (groupBy === 'supplier') {
      const map = new Map();
      visible.forEach((s) => {
        const id = s.lastBuy?.supplierId ? String(s.lastBuy.supplierId) : '';
        const group = map.get(id) || { key: id || 'unknown', label: s.lastBuy?.supplierName || null, tone: null, rows: [] };
        group.rows.push(s);
        map.set(id, group);
      });
      // Biggest first, and "supplier not known" last — it is a to-do, not a wholesaler.
      return [...map.values()].sort((a, b) => {
        if ((a.key === 'unknown') !== (b.key === 'unknown')) return a.key === 'unknown' ? 1 : -1;
        return b.rows.length - a.rows.length;
      });
    }

    const map = new Map();
    visible.forEach((s) => {
      const key = bandOf(s);
      const group = map.get(key) || { key, label: null, tone: key, rows: [] };
      group.rows.push(s);
      map.set(key, group);
    });
    return BAND_ORDER.filter((key) => map.has(key)).map((key) => map.get(key));
  }, [visible, groupBy]);

  /**
   * Whether a section is open.
   *
   * Derived rather than stored, with only the shopkeeper's own taps kept as overrides.
   * Storing the computed state instead would need an effect to reseed it every time the
   * list reloads, and an effect that writes state the user can also write is how a panel
   * ends up re-collapsing a section three seconds after it was opened.
   */
  function sectionIsOpen(section) {
    if (sectionOpen.has(section.key)) return sectionOpen.get(section.key);
    if (groupBy === 'none') return true;
    if (!long) return true;
    // On a long list only the bands that are actually urgent stay open. Under supplier
    // grouping there is no such thing, so the biggest wholesaler opens and the rest wait.
    if (groupBy === 'supplier') return section === sections[0];
    return URGENT_BANDS.has(section.key);
  }

  function toggleSection(section) {
    setSectionOpen((current) => {
      const next = new Map(current);
      next.set(section.key, !sectionIsOpen(section));
      return next;
    });
  }

  // Everything picked, in list order, with the quantity that is actually on screen. The
  // one place the selection turns back into rows — the bar, the split and the add all read
  // this, so they can never disagree about what "6 selected" meant.
  const pickedRows = useMemo(
    () =>
      suggestions
        .filter((s) => picked.has(String(s.product.id)))
        .map((s) => ({ suggestion: s, quantity: Number(picked.get(String(s.product.id))) || 0 }))
        .filter((row) => row.quantity > 0),
    [suggestions, picked]
  );

  const pickedTotal = useMemo(
    () => pickedRows.reduce((sum, row) => sum + row.quantity * unitCostOf(row.suggestion), 0),
    [pickedRows]
  );

  // How many different wholesalers the current selection spans, counting "never bought
  // before" as its own bucket. Two or more and one purchase order cannot hold it.
  const pickedSupplierGroups = useMemo(() => {
    const groups = new Map();
    pickedRows.forEach((row) => {
      const id = row.suggestion.lastBuy?.supplierId ? String(row.suggestion.lastBuy.supplierId) : '';
      const group = groups.get(id) || {
        supplierId: id || null,
        supplierName: row.suggestion.lastBuy?.supplierName || null,
        rows: [],
      };
      group.rows.push(row);
      groups.set(id, group);
    });
    return [...groups.values()];
  }, [pickedRows]);

  const namedSupplierGroups = pickedSupplierGroups.filter((group) => group.supplierId);
  const canSplit = Boolean(onSplitBySupplier) && namedSupplierGroups.length > 1;

  // Off the whole filtered list, not off what happens to be rendered. "Select all 22" that
  // quietly picks the eight on screen is the kind of thing that puts fourteen items nobody
  // chose onto a purchase order — or leaves fourteen off one they thought they had.
  const pickableVisible = visible.filter(isPickable);
  const allShownPicked = pickableVisible.length > 0 && pickableVisible.every((s) => picked.has(String(s.product.id)));

  function toggle(suggestion) {
    const id = String(suggestion.product.id);
    setPicked((current) => {
      const next = new Map(current);
      if (next.has(id)) next.delete(id);
      else next.set(id, defaultQty(suggestion));
      return next;
    });
  }

  function setQty(suggestion, value) {
    const id = String(suggestion.product.id);
    setPicked((current) => {
      const next = new Map(current);
      // Typing in the quantity box of an unpicked row picks it — otherwise the number is
      // silently thrown away, which is the sort of thing you only notice after the order
      // has gone to the wholesaler.
      next.set(id, value);
      return next;
    });
  }

  function step(suggestion, delta) {
    const id = String(suggestion.product.id);
    const current = Number(picked.get(id) ?? defaultQty(suggestion)) || 0;
    setQty(suggestion, String(Math.max(1, current + delta)));
  }

  function pickMany(rows, on) {
    setPicked((current) => {
      const next = new Map(current);
      rows.forEach((s) => {
        const id = String(s.product.id);
        if (on) next.set(id, next.get(id) ?? defaultQty(s));
        else next.delete(id);
      });
      return next;
    });
  }

  function clear() {
    setPicked(new Map());
  }

  function handleAdd() {
    if (pickedRows.length === 0) return;
    onAdd?.(pickedRows);
    clear();
  }

  function handleSplit() {
    if (!canSplit) return;
    onSplitBySupplier?.(namedSupplierGroups);
    clear();
  }

  function handleSnooze(rows, days) {
    if (!onSnooze || rows.length === 0) return;
    onSnooze(rows.map((s) => String(s.product.id)), days);
    pickMany(rows, false);
  }

  const snoozedCount = summary?.snoozed || 0;

  return (
    <div className="panel reorder-panel">
      <div className="panel-head">
        <h2>{t('seller.reorderSuggestions')}</h2>
        <div className="panel-tools">
          <div className="search-box-inline">
            <SearchIcon size={15} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('purchase.reorderSearch')} />
          </div>
          <Dropdown
            className="filter-select"
            value={band}
            onChange={setBand}
            options={BANDS.map((value) => ({ value, label: t(`purchase.reorderBand.${value || 'all'}`) }))}
          />
          {/* One control, not two. Urgency and supplier are two groupings of the same
              list — as a pair of toggles they read as unrelated features, and nothing
              said which one was on. */}
          <Dropdown
            className="filter-select"
            value={groupBy}
            onChange={setGroupBy}
            options={GROUP_MODES.map((value) => ({ value, label: t(`purchase.reorderGroupBy.${value}`) }))}
          />
          {/* Only offered once the list is long enough for it to matter. On six rows a
              density switch is a setting nobody asked for. */}
          {visible.length > LONG_LIST && (
            <button
              type="button"
              className={`icon-btn${compact ? ' primary' : ''}`}
              data-tip={compact ? t('purchase.reorderViewDetailed') : t('purchase.reorderViewCompact')}
              onClick={() => chooseView(compact ? 'detailed' : 'compact')}
            >
              {compact ? <RowsIcon size={17} /> : <ListIcon size={17} />}
            </button>
          )}
          {onToggleSnoozed && snoozedCount > 0 && (
            <button
              type="button"
              className={`icon-btn${showingSnoozed ? ' primary' : ''}`}
              data-tip={showingSnoozed ? t('purchase.reorderHideSnoozed') : t('purchase.reorderShowSnoozed', { count: snoozedCount })}
              onClick={() => onToggleSnoozed(!showingSnoozed)}
            >
              {showingSnoozed ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
            </button>
          )}
          {headerExtra}
        </div>
      </div>

      {/* Why this panel is worth two minutes, said once at the top. The complaint behind it:
          a list of low items is not self-explanatory to somebody who has run the shop on
          memory for twenty years — "kam hai" is obvious, "isliye aaj hi order karo" is not. */}
      <p className="reorder-why-panel">
        {summary?.atRiskPerDay > 0
          ? t('purchase.reorderWhyPanelMoney', { amount: formatRupees(summary.atRiskPerDay, lang) })
          : t('purchase.reorderWhyPanel')}
      </p>

      {/* What the whole list adds up to before a single row is picked — the reason to open
          it at all. The money is the still-to-order part only; anything already on an open
          order has been bought and counting it again would overstate today's round. */}
      {summary && summary.total > 0 && (
        <div className="reorder-summary">
          {summary.out > 0 && (
            <span className="reorder-pill is-out">
              <AlertIcon size={12} /> {t('purchase.reorderBandCount.out', { count: summary.out })}
            </span>
          )}
          {summary.critical > 0 && (
            <span className="reorder-pill is-critical">
              <ClockIcon size={12} /> {t('purchase.reorderBandCount.critical', { count: summary.critical })}
            </span>
          )}
          {summary.low > 0 && <span className="reorder-pill is-low">{t('purchase.reorderBandCount.low', { count: summary.low })}</span>}
          {summary.pending > 0 && (
            <span className="reorder-pill is-pending">
              <TruckIcon size={12} /> {t('purchase.reorderBandCount.pending', { count: summary.pending })}
            </span>
          )}
          {summary.estimatedCost > 0 && (
            <span className="reorder-estimate">{t('purchase.reorderRoundCost', { amount: formatRupees(summary.estimatedCost, lang) })}</span>
          )}
        </div>
      )}

      {/* The bar the whole rebuild is for. Sticky rather than at the foot of the list: on a
          shop with forty low items the selection is made while scrolling, and a total that
          scrolls away is a total nobody reads. */}
      {pickedRows.length > 0 && (
        <div className="reorder-bar">
          <span className="reorder-bar-count">
            <CheckIcon size={14} />
            {t('purchase.reorderSelected', { count: pickedRows.length, amount: formatRupees(pickedTotal, lang) })}
          </span>
          <div className="reorder-bar-actions">
            {onAdd && (
              <button type="button" className="btn btn-primary btn-small btn-inline" disabled={busy} onClick={handleAdd}>
                <PlusIcon size={15} /> {t('purchase.reorderAddSelected', { count: pickedRows.length })}
              </button>
            )}
            {canSplit && (
              <button type="button" className="btn btn-secondary btn-small btn-inline" disabled={busy} onClick={handleSplit}>
                <LayersIcon size={15} /> {t('purchase.reorderSplit', { count: namedSupplierGroups.length })}
              </button>
            )}
            {onSnooze && (
              <button
                type="button"
                className="btn btn-secondary btn-small btn-inline"
                disabled={busy}
                onClick={() => handleSnooze(pickedRows.map((row) => row.suggestion), 30)}
              >
                <ClockIcon size={15} /> {t('purchase.reorderSnoozeSelected')}
              </button>
            )}
            <button type="button" className="link-btn" onClick={clear}>
              {t('purchase.clearSelection')}
            </button>
          </div>
          {/* Said plainly rather than enforced. A purchase order holds one supplier, so a
              mixed selection is going onto one form with one name at the top — which is
              fine if that is what he meant, and worth knowing if it is not. */}
          {pickedSupplierGroups.length > 1 && (
            <span className="reorder-bar-hint">{t('purchase.reorderMixedSuppliers', { count: pickedSupplierGroups.length })}</span>
          )}
        </div>
      )}

      {loading ? (
        <p className="cell-muted">{t('common.loading')}</p>
      ) : visible.length === 0 ? (
        <p className="cell-muted">{suggestions.length === 0 ? t('purchase.reorderAllCovered') : t('purchase.reorderNoneMatch')}</p>
      ) : (
        <>
          <div className="reorder-selectall">
            <label className="reorder-check">
              <input
                type="checkbox"
                checked={allShownPicked}
                disabled={pickableVisible.length === 0}
                onChange={(e) => pickMany(pickableVisible, e.target.checked)}
              />
              <span>{t('purchase.reorderSelectAll', { count: pickableVisible.length })}</span>
            </label>
            <span className="cell-muted">{t('purchase.reorderHint')}</span>
          </div>

          {/* One renderer for all three groupings.
              Section headers are deliberately NOT sticky: the selection bar above already
              is, and two sticky bands stacked on a phone eat the rows they are there to
              help you read. A section is capped at eight anyway, so its header is never
              far off the top of the screen. */}
          {sections.map((section) => {
            const open = sectionIsOpen(section);
            const pickableRows = section.rows.filter(isPickable);
            const allPicked = pickableRows.length > 0 && pickableRows.every((s) => picked.has(String(s.product.id)));
            const capped = !sectionAll.has(section.key) && section.rows.length > SECTION_ROWS;
            const rows = open ? (capped ? section.rows.slice(0, SECTION_ROWS) : section.rows) : [];
            // What this band is worth, so a closed section still answers the only question
            // worth asking about a closed section: is there money in it?
            const worth = section.rows.reduce(
              (sum, s) => sum + (Number(picked.get(String(s.product.id)) ?? defaultQty(s)) || 0) * unitCostOf(s),
              0
            );

            return (
              <div className={`reorder-section${open ? '' : ' is-closed'}`} key={section.key}>
                {section.label !== null || section.tone ? (
                  <div className={`reorder-section-head${section.tone ? ` is-${section.tone}` : ''}`}>
                    <label className="reorder-check">
                      <input
                        type="checkbox"
                        checked={allPicked}
                        disabled={pickableRows.length === 0}
                        onChange={(e) => pickMany(pickableRows, e.target.checked)}
                        aria-label={t('purchase.reorderSelectAll', { count: pickableRows.length })}
                      />
                      <strong>
                        {section.tone
                          ? t(`purchase.reorderBand.${section.tone}`)
                          : section.label || t('purchase.reorderNoSupplier')}
                      </strong>
                    </label>
                    <span className="reorder-section-meta">
                      {t('purchase.itemCount', { count: section.rows.length })}
                      {worth > 0 ? ` · ${formatRupees(worth, lang)}` : ''}
                    </span>
                    <button
                      type="button"
                      className="icon-btn reorder-section-toggle"
                      aria-expanded={open}
                      data-tip={open ? t('purchase.reorderCollapse') : t('purchase.reorderExpand')}
                      onClick={() => toggleSection(section)}
                    >
                      {open ? <ChevronUpIcon size={17} /> : <ChevronDownIcon size={17} />}
                    </button>
                  </div>
                ) : null}

                {open && (
                  <div className="reorder-list">
                    {rows.map((s, index) => (
                      <ReorderRow
                        key={String(s.product.id)}
                        index={index}
                        suggestion={s}
                        picked={picked}
                        onToggle={toggle}
                        onQty={setQty}
                        onStep={step}
                        onSnooze={onSnooze ? handleSnooze : null}
                        onOpenOrder={onOpenOrder}
                        showSupplier={groupBy !== 'supplier'}
                        compact={compact}
                        t={t}
                        lang={lang}
                      />
                    ))}
                  </div>
                )}

                {/* What is hidden is now always "more of this same kind", never an
                    arbitrary slice through the middle of the round. */}
                {open && section.rows.length > SECTION_ROWS && (
                  <button
                    type="button"
                    className="link-btn reorder-more"
                    onClick={() =>
                      setSectionAll((current) => {
                        const next = new Set(current);
                        if (next.has(section.key)) next.delete(section.key);
                        else next.add(section.key);
                        return next;
                      })
                    }
                  >
                    {capped
                      ? t('purchase.reorderShowAll', { count: section.rows.length })
                      : t('purchase.reorderShowLess')}
                  </button>
                )}
              </div>
            );
          })}

        </>
      )}
    </div>
  );
}

function ReorderRow({ suggestion, picked, onToggle, onQty, onStep, onSnooze, onOpenOrder, showSupplier, compact = false, index = 0, t, lang }) {
  const s = suggestion;
  const id = String(s.product.id);
  const isPicked = picked.has(id);
  const pickable = isPickable(s);
  const qty = picked.get(id) ?? defaultQty(s);
  const pending = s.alreadyOrdered;
  const lineCost = (Number(qty) || 0) * unitCostOf(s);
  const why = reasonFor(s, t, lang, formatRupees);

  const menuItems = [
    pending && onOpenOrder
      ? { label: t('purchase.reorderOpenOrder', { po: pending.poLabel }), icon: <TruckIcon size={15} />, onClick: () => onOpenOrder(pending.poId) }
      : null,
    onSnooze ? { label: t('purchase.reorderSnoozeDays', { days: 7 }), icon: <ClockIcon size={15} />, onClick: () => onSnooze([s], 7) } : null,
    onSnooze ? { label: t('purchase.reorderSnoozeDays', { days: 30 }), icon: <ClockIcon size={15} />, onClick: () => onSnooze([s], 30) } : null,
    onSnooze && s.snoozedUntil
      ? { label: t('purchase.reorderUnsnooze'), icon: <EyeIcon size={15} />, onClick: () => onSnooze([s], 0) }
      : null,
  ].filter(Boolean);

  return (
    <div
      className={`reorder-row is-${s.urgency}${compact ? ' compact' : ''}${isPicked ? ' selected' : ''}${pending && !pickable ? ' is-ordered' : ''}`}
      /* Compact drops the reason to a tooltip rather than deleting it. The sentence is the
         thing that turns a reading into a decision — on a list you are sweeping it is in
         the way, and on the one row you stop at it is the whole point. */
      data-tip={compact ? why : undefined}
      /* Rows arrive one after another rather than all at once, so the eye is walked down
         the list in the order the list is sorted in — which is the order the decisions
         should be made in. Capped, because a stagger you have to wait out is an obstacle,
         and multiplied by --motion-scale so "off" is genuinely off. */
      style={{ '--reorder-delay': `calc(${Math.min(index, 10) * 45}ms * var(--motion-scale))` }}
    >
      <label className="reorder-check">
        <input type="checkbox" checked={isPicked} disabled={!pickable} onChange={() => onToggle(s)} />
        <span className="reorder-name">{s.product.name}</span>
      </label>

      <div className="reorder-facts">
        {/* Stock and days-of-cover together, because neither answers on its own. */}
        <span className={`reorder-pill is-${s.urgency}${s.product.stock <= 0 && !pending ? ' moment-alert' : ''}`}>
          {s.product.stock <= 0
            ? t('purchase.reorderOutOfStock')
            : t('purchase.stockLeft', { qty: s.product.stock, unit: s.product.unit })}
        </span>
        {showSupplier && s.lastBuy?.supplierName && (
          <span className="cell-muted">
            {t('purchase.reorderLastRate', { amount: formatRupees(s.lastBuy.effectiveCost || s.lastBuy.costPrice, lang), supplier: s.lastBuy.supplierName })}
            {s.lastBuy.scheme ? ` · ${s.lastBuy.scheme}` : ''}
          </span>
        )}
        {pending && (
          <span className={`reorder-pill ${pending.isOverdue ? 'is-out' : 'is-pending'}`}>
            {pending.isOverdue ? <AlertIcon size={12} /> : <TruckIcon size={12} />}
            {pending.shortfall > 0
              ? t('purchase.reorderShortfall', { po: pending.poLabel, ordered: pending.quantity, short: pending.shortfall })
              : pending.isOverdue
                ? t('purchase.reorderOverdue', { po: pending.poLabel })
                : pending.status === 'draft'
                  ? t('purchase.reorderDraft', { po: pending.poLabel })
                  : t('purchase.reorderOrdered', { po: pending.poLabel })}
          </span>
        )}
      </div>

      {/* The sentence that turns a reading into a reason. Its own line rather than another
          chip in the row above: it is prose, and prose crammed between badges gets skipped. */}
      {!compact && <p className="reorder-why">{why}</p>}

      <div className="reorder-qty">
        <button type="button" className="icon-btn" data-tip={t('purchase.reorderQtyDown')} disabled={!pickable} onClick={() => onStep(s, -1)}>
          <MinusIcon size={17} />
        </button>
        <input
          type="number"
          min="1"
          inputMode="numeric"
          value={qty}
          disabled={!pickable}
          aria-label={t('seller.suggestedQty')}
          onChange={(e) => onQty(s, e.target.value)}
        />
        <button type="button" className="icon-btn" data-tip={t('purchase.reorderQtyUp')} disabled={!pickable} onClick={() => onStep(s, 1)}>
          <PlusIcon size={17} />
        </button>
        <span className="reorder-line-cost">{lineCost > 0 ? formatRupees(lineCost, lang) : '—'}</span>
      </div>

      {menuItems.length > 0 && <RowMenu items={menuItems} className="reorder-menu" tip={t('purchase.reorderRowMenu')} />}
    </div>
  );
}
