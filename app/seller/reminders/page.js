'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { formatRupees } from '../../../lib/format';
import { getShopSocket } from '../../../lib/socket';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { SkeletonCards } from '../../components/Skeleton';
import Illustration from '../../components/Illustration';
import RowMenu from '../../components/RowMenu';
import ReminderComposer from '../../components/ReminderComposer';
import {
  PlusIcon, CheckIcon, ClockIcon, SearchIcon, ChevronRightIcon, UndoIcon,
  LedgerIcon, PackageIcon, CalendarIcon, ShopIcon, StarIcon, TruckIcon, EditIcon, TrashIcon,
} from '../../components/Icons';

/**
 * The Smart Reminder Centre.
 *
 * Everything this dukaan has to do on a date, on one timeline — the obligations the app
 * worked out for itself (a promise to pay on the 25th, a wholesaler's credit running out on
 * Friday, a lot expiring on the 12th) sitting in the same list as the reminders the
 * shopkeeper wrote himself, because he does not have two days.
 *
 * This is NOT the notifications page in a different colour, and the difference is the whole
 * reason it exists. The bell answers "what is wrong right now" — aggregated, severity-first,
 * dateless. This answers "what is due, and WHEN". Same numbers, same single source
 * (backend/utils/shopNotifications.js), two genuinely different questions; a shopkeeper needs
 * both and has, until now, only had the first.
 *
 * Three rules the screen is built on:
 *
 *   1. **Buckets before rows.** "When" is the only question here, so the first thing on the
 *      screen is five piles — late, today, tomorrow, this week, later — and each one is also
 *      the filter for itself. A flat list of forty dated rows answers "when" no better than
 *      the nine screens they came from.
 *   2. **One number per row, and only where it is real.** A derived reminder carries what
 *      acting on it is worth in rupees, because that is what turns "6 reminders" into a
 *      decision about which one to do first. A written reminder carries no figure at all
 *      rather than a zero.
 *   3. **Nothing is ever dismissed forever.** A derived row can be pushed to tomorrow; it
 *      cannot be closed, because the money behind it does not go away when the row does.
 */

const BUCKETS = ['overdue', 'today', 'tomorrow', 'week', 'later'];

// One glyph per source, so the eye finds "paisa aana" in the list before it has read a word.
// Sources come from backend/utils/autoReminders.js; `mine` is what the shopkeeper typed.
const SOURCE_ICONS = {
  'money-in': LedgerIcon,
  'money-out': TruckIcon,
  stock: PackageIcon,
  diary: CalendarIcon,
  shop: ShopIcon,
  mine: StarIcon,
};

/**
 * How far a row can be pushed.
 *
 * Four options, no custom picker. A snooze is a decision made in half a second while looking
 * at something else — the moment it needs a calendar it stops being a snooze and becomes an
 * edit, which the row's menu already offers.
 */
const SNOOZE_PRESETS = [
  { key: 'hour', minutes: 60 },
  { key: 'evening', at: (now) => atHour(now, 18) },
  { key: 'tomorrow', at: (now) => atHour(addDays(now, 1), 9) },
  { key: 'nextWeek', at: (now) => atHour(addDays(now, 7), 9) },
];

function atHour(date, hour) {
  const next = new Date(date);
  next.setHours(hour, 0, 0, 0);
  return next;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dayKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function RemindersPage() {
  // `useSearchParams` needs a Suspense boundary under the App Router — the same wrapper the
  // Campaigns and Offers screens use for their own deep links.
  return (
    <Suspense fallback={null}>
      <RemindersPageInner />
    </Suspense>
  );
}

function RemindersPageInner() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const params = useSearchParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bucket, setBucket] = useState('all');
  const [source, setSource] = useState('all');
  const [search, setSearch] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [composer, setComposer] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback((mode) => {
    if (mode !== 'quiet') setLoading(true);
    return apiFetch('/api/seller/reminders')
      .then((next) => {
        setData(next);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // `?new=1` — the command palette and the sidebar's quick actions both open this screen
  // straight into the composer, so writing a reminder is never "open a screen, then find a
  // button".
  useEffect(() => {
    if (params.get('new') === '1') setComposer({});
  }, [params]);

  /**
   * The list re-reads itself when the shop changes underneath it.
   *
   * Every derived row here is a live fact about the dukaan — a payment lands and the promise
   * row should go, a bill is confirmed and the claim row should go. A reminder centre that
   * still shows a settled udhaari an hour later is one nobody trusts twice.
   */
  useEffect(() => {
    const socket = getShopSocket();
    if (!socket) return undefined;
    let timer = null;
    function refresh() {
      clearTimeout(timer);
      timer = setTimeout(() => load('quiet'), 1200);
    }
    const events = ['reminder:changed', 'bill:created', 'paymentClaim:new', 'order:created'];
    events.forEach((event) => socket.on(event, refresh));
    return () => {
      events.forEach((event) => socket.off(event, refresh));
      clearTimeout(timer);
    };
  }, [load]);

  const rupees = useCallback((value) => formatRupees(value, lang, { decimals: false }), [lang]);

  /** The sentence a row shows. Derived rows are translated here; written ones already are. */
  const titleOf = useCallback(
    (row) => (row.kind === 'auto' ? t(`reminders.auto.${row.titleKey}`, row.params || {}) : row.title),
    [t]
  );

  const visible = useMemo(() => {
    const rows = data?.reminders || [];
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (row.bucket === 'done' && !showDone) return false;
      if (row.bucket !== 'done' && bucket !== 'all' && row.bucket !== bucket) return false;
      if (source !== 'all' && row.source !== source) return false;
      if (term && !titleOf(row).toLowerCase().includes(term)) return false;
      return true;
    });
  }, [data, bucket, source, search, showDone, titleOf]);

  const selectable = useMemo(() => source === 'mine' ? visible.filter((row) => row.kind === 'manual') : [], [source, visible]);
  const selectedIds = useMemo(() => selectable.filter((row) => selected.includes(row.id)).map((row) => row.id), [selectable, selected]);
  useEffect(() => { setSelected([]); }, [source, bucket, search, showDone]);
  useEffect(() => {
    setSelected((ids) => ids.filter((id) => selectable.some((row) => row.id === id)));
  }, [selectable]);

  async function removeSelected() {
    if (bulkBusy || busyId || !selectedIds.length) return;
    const ids = [...selectedIds];
    setBulkBusy(true);
    try {
      const ok = await confirm({ title: t('reminders.bulkDeleteTitle', { count: ids.length }),
        body: t('reminders.bulkDeleteBody'), confirmLabel: t('common.delete'), tone: 'danger' });
      if (!ok) return;
      const result = await apiFetch('/api/seller/reminders/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) });
      setSelected([]);
      toast.success(t('reminders.bulkDeleted', { count: result.deletedCount }));
      await load('quiet');
      window.dispatchEvent(new CustomEvent('dukaan:notificationsChanged'));
    } catch (err) { toast.error(err.message); }
    finally { setBulkBusy(false); }
  }

  // Grouped by the day each row lands on. Everything already overdue collapses into ONE
  // group at the top rather than a header per past date — a shop with eleven late udhaaris
  // does not need eleven headings saying so, it needs the eleven rows.
  const groups = useMemo(() => {
    const out = [];
    const byDay = new Map();
    for (const row of visible) {
      const key = row.bucket === 'overdue' ? 'overdue' : row.bucket === 'done' ? 'done' : dayKey(row.effectiveDueAt);
      if (!byDay.has(key)) {
        const group = { key, at: row.effectiveDueAt, rows: [], amount: 0 };
        byDay.set(key, group);
        out.push(group);
      }
      const group = byDay.get(key);
      group.rows.push(row);
      group.amount += row.amount || 0;
    }
    /**
     * Late first, finished last, the days in between in order.
     *
     * The rows are already sorted by date, so a reminder ticked off this morning would
     * otherwise land its whole "Done today" heading somewhere in the middle of the timeline —
     * between yesterday's overdue pile and Friday — which reads as a rendering fault. What is
     * finished belongs at the bottom of the day, where a shopkeeper glances at it once.
     */
    const rank = (group) => (group.key === 'overdue' ? 0 : group.key === 'done' ? 2 : 1);
    return out.sort((a, b) => rank(a) - rank(b) || new Date(a.at) - new Date(b.at));
  }, [visible]);

  const summary = data?.summary || {};
  const focus = data?.focus || null;

  /* ------------------------------------------------------------------ actions */

  async function act(row, run, successKey) {
    if (bulkBusy) return;
    setBusyId(row.id);
    try {
      await run();
      if (successKey) toast.success(t(successKey));
      await load('quiet');
      // The sidebar badge is computed from the same numbers, so it has to be told.
      try {
        window.dispatchEvent(new CustomEvent('dukaan:notificationsChanged'));
      } catch {
        /* older browsers, or a server render — the badge simply refreshes on its own timer */
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function markDone(row) {
    return act(row, () => apiFetch(`/api/seller/reminders/${row.id}/done`, { method: 'POST' }), 'reminders.doneToast');
  }

  function reopen(row) {
    return act(row, () => apiFetch(`/api/seller/reminders/${row.id}/reopen`, { method: 'POST' }));
  }

  function snooze(row, preset) {
    const now = new Date();
    const body = preset.minutes ? { minutes: preset.minutes } : { until: preset.at(now).toISOString() };
    // An "aaj shaam" that has already passed would be a snooze into the past — push to
    // tomorrow morning instead, which is what the shopkeeper meant by it at 8pm anyway.
    if (!preset.minutes && preset.at(now) <= now) body.until = atHour(addDays(now, 1), 9).toISOString();

    return act(
      row,
      () =>
        row.kind === 'auto'
          ? apiFetch('/api/seller/reminders/auto/snooze', {
              method: 'POST',
              body: JSON.stringify({ autoKey: row.autoKey, ...body }),
            })
          : apiFetch(`/api/seller/reminders/${row.id}/snooze`, { method: 'POST', body: JSON.stringify(body) }),
      'reminders.snoozeToast'
    );
  }

  function unsnooze(row) {
    return act(row, () =>
      row.kind === 'auto'
        ? apiFetch('/api/seller/reminders/auto/snooze', {
            method: 'POST',
            body: JSON.stringify({ autoKey: row.autoKey, clear: true }),
          })
        : apiFetch(`/api/seller/reminders/${row.id}/snooze`, {
            method: 'POST',
            body: JSON.stringify({ clear: true }),
          })
    );
  }

  async function remove(row) {
    const ok = await confirm({
      title: t('reminders.deleteTitle'),
      body: t('reminders.deleteBody'),
      confirmLabel: t('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;
    act(row, () => apiFetch(`/api/seller/reminders/${row.id}`, { method: 'DELETE' }), 'reminders.deletedToast');
  }

  /* -------------------------------------------------------------------- render */

  function groupLabel(group) {
    if (group.key === 'overdue') return t('reminders.groupOverdue');
    if (group.key === 'done') return t('reminders.groupDone');
    const date = new Date(group.at);
    if (dayKey(date) === dayKey(new Date())) return t('reminders.groupToday');
    if (dayKey(date) === dayKey(addDays(new Date(), 1))) return t('reminders.groupTomorrow');
    return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function timeLabel(row) {
    if (row.allDay) return null;
    return new Date(row.effectiveDueAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  function menuItems(row) {
    const items = SNOOZE_PRESETS.map((preset) => ({
      label: t(`reminders.snooze.${preset.key}`),
      icon: <ClockIcon size={15} />,
      onClick: () => snooze(row, preset),
    }));

    if (row.snoozedUntil) {
      items.unshift({
        label: t('reminders.unsnooze'),
        icon: <UndoIcon size={15} />,
        onClick: () => unsnooze(row),
      });
    }
    if (row.kind === 'manual') {
      items.push(
        { label: t('common.edit'), icon: <EditIcon size={15} />, onClick: () => setComposer(row) },
        { label: t('common.delete'), icon: <TrashIcon size={15} />, danger: true, onClick: () => remove(row) }
      );
    }
    return items;
  }

  return (
    <>
      <div className="content-header rc-header">
        <div>
          <h1>{t('reminders.title')}</h1>
          <p>{t('reminders.subtitle')}</p>
        </div>
        <button type="button" className="btn btn-primary btn-inline" onClick={() => setComposer({})}>
          <PlusIcon size={17} /> {t('reminders.new')}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <SkeletonCards count={4} height={84} />
      ) : (
        <>
          {/* The one thing worth doing first. Deliberately a band and not a card: this is the
              page telling the shopkeeper something, not a box he has to manage. */}
          {focus && (
            <Link href={focus.href || '#'} className={`rc-focus rc-tone-${focus.tone}`}>
              <span className="rc-focus-label">{t('reminders.focusLabel')}</span>
              <strong className="rc-focus-line">{titleOf(focus)}</strong>
              {focus.amount > 0 && <span className="rc-focus-amount">{rupees(focus.amount)}</span>}
              <ChevronRightIcon size={18} />
            </Link>
          )}

          <div className="rc-buckets" role="tablist" aria-label={t('reminders.title')}>
            <button
              type="button"
              role="tab"
              aria-selected={bucket === 'all'}
              className={`rc-bucket${bucket === 'all' ? ' active' : ''}`}
              onClick={() => setBucket('all')}
            >
              <span className="rc-bucket-label">{t('reminders.bucketAll')}</span>
              <span className="rc-bucket-count">
                {BUCKETS.reduce((sum, key) => sum + (summary[key]?.count || 0), 0)}
              </span>
            </button>
            {BUCKETS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={bucket === key}
                className={`rc-bucket rc-bucket-${key}${bucket === key ? ' active' : ''}`}
                onClick={() => setBucket(key)}
              >
                <span className="rc-bucket-label">{t(`reminders.bucket.${key}`)}</span>
                <span className="rc-bucket-count">{summary[key]?.count || 0}</span>
                {/* Rupees only where there are any. "₹0" beside a count reads as a bug, and
                    one figure nobody believes costs every other figure on the page. */}
                {summary[key]?.amount > 0 && (
                  <span className="rc-bucket-amount">{rupees(summary[key].amount)}</span>
                )}
              </button>
            ))}
          </div>

          <div className="rc-toolbar">
            <div className="rc-sources">
              <button
                type="button"
                className={`chip${source === 'all' ? ' active' : ''}`}
                onClick={() => setSource('all')}
              >
                {t('reminders.sourceAll')}
              </button>
              {(data?.sources || []).map((row) => {
                const Icon = SOURCE_ICONS[row.key] || StarIcon;
                return (
                  <button
                    key={row.key}
                    type="button"
                    className={`chip${source === row.key ? ' active' : ''}`}
                    onClick={() => setSource(source === row.key ? 'all' : row.key)}
                  >
                    <Icon size={14} /> {t(`reminders.source.${row.key}`)} · {row.count}
                  </button>
                );
              })}
            </div>

            <div className="rc-toolbar-right">
              <div className="rc-search">
                <SearchIcon size={15} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('reminders.searchPlaceholder')}
                  aria-label={t('reminders.searchPlaceholder')}
                />
              </div>
              <button
                type="button"
                className={`chip${showDone ? ' active' : ''}`}
                onClick={() => setShowDone((on) => !on)}
              >
                <CheckIcon size={14} /> {t('reminders.showDone')}
                {summary.done?.count > 0 ? ` · ${summary.done.count}` : ''}
              </button>
            </div>
          </div>

          {source === 'mine' && selectable.length > 0 && (
            <div className="rc-bulk-toolbar" aria-busy={bulkBusy}>
              <label className="rc-select-all">
                <input type="checkbox" checked={selectedIds.length === selectable.length}
                  ref={(node) => { if (node) node.indeterminate = selectedIds.length > 0 && selectedIds.length < selectable.length; }}
                  disabled={bulkBusy || Boolean(busyId)}
                  onChange={(event) => setSelected(event.target.checked ? selectable.map((row) => row.id) : [])} />
                {t('reminders.selectVisible')}
              </label>
              <span role="status">{t('reminders.selectedCount', { count: selectedIds.length })}</span>
              {selectedIds.length > 0 && <button type="button" className="btn btn-secondary btn-small" disabled={bulkBusy} onClick={() => setSelected([])}>{t('reminders.clearSelection')}</button>}
              <button type="button" className="btn btn-secondary btn-small btn-inline rc-bulk-delete"
                disabled={!selectedIds.length || bulkBusy || Boolean(busyId)} onClick={removeSelected}>
                <TrashIcon size={15} /> {t('reminders.deleteSelected')}
              </button>
            </div>
          )}

          {groups.length === 0 ? (
            <div className="empty-state-rich">
              <Illustration scene="calendar" />
              <p>{bucket === 'all' && source === 'all' && !search ? t('reminders.emptyAll') : t('reminders.emptyFiltered')}</p>
              {bucket === 'all' && source === 'all' && !search && (
                <button type="button" className="btn btn-primary btn-small btn-inline" onClick={() => setComposer({})}>
                  <PlusIcon size={15} /> {t('reminders.new')}
                </button>
              )}
            </div>
          ) : (
            <div className="rc-timeline">
              {groups.map((group) => (
                <section key={group.key} className={`rc-group rc-group-${group.key === 'overdue' ? 'overdue' : 'day'}`}>
                  <header className="rc-group-head">
                    <h2>{groupLabel(group)}</h2>
                    <span className="rc-group-count">{group.rows.length}</span>
                    {group.amount > 0 && <span className="rc-group-amount">{rupees(group.amount)}</span>}
                  </header>

                  <div className="rc-rows">
                    {group.rows.map((row) => {
                      const Icon = SOURCE_ICONS[row.source] || StarIcon;
                      const time = timeLabel(row);
                      const done = row.bucket === 'done';
                      return (
                        <article
                          key={row.id}
                          className={`rc-row rc-tone-${row.tone}${row.amount > 0 ? ' rc-has-amount' : ''}${done ? ' is-done' : ''}${selectedIds.includes(row.id) ? ' is-selected' : ''}${busyId === row.id ? ' is-busy' : ''}`}
                        >
                          {source === 'mine' && row.kind === 'manual' && (
                            <label className="rc-select-row">
                              <input type="checkbox" checked={selectedIds.includes(row.id)}
                                aria-label={t('reminders.selectReminder', { title: titleOf(row) })}
                                disabled={bulkBusy || Boolean(busyId)}
                                onChange={(event) => setSelected((ids) => event.target.checked ? [...new Set([...ids, row.id])] : ids.filter((id) => id !== row.id))} />
                            </label>
                          )}
                          {/* Ticking off is the single most-used control on this screen, so it
                              is the left-most thing in the row and the size of a real target.
                              A derived row has no tick: the app cannot know that a supplier
                              was paid, and a box that closes a row without changing anything
                              is a lie the shopkeeper finds out about a week later. */}
                          {row.kind === 'manual' ? (
                            <button
                              type="button"
                              className={`rc-tick${done ? ' is-done' : ''}`}
                              onClick={() => (done ? reopen(row) : markDone(row))}
                              disabled={bulkBusy || busyId === row.id}
                              data-tip={done ? t('reminders.reopen') : t('reminders.markDone')}
                              aria-label={done ? t('reminders.reopen') : t('reminders.markDone')}
                            >
                              <CheckIcon size={15} />
                            </button>
                          ) : (
                            <span className="rc-row-icon" aria-hidden="true">
                              <Icon size={16} />
                            </span>
                          )}

                          <div className="rc-row-body">
                            <p className="rc-row-title">{titleOf(row)}</p>
                            <div className="rc-row-meta">
                              <span className={`rc-tag rc-tag-${row.source}`}>{t(`reminders.source.${row.source}`)}</span>
                              {time && <span className="rc-row-time">{time}</span>}
                              {row.repeat?.every && row.repeat.every !== 'none' && (
                                <span className="rc-row-repeat">{t(`reminders.repeat.${row.repeat.every}`)}</span>
                              )}
                              {row.snoozedUntil && (
                                <span className="rc-row-snoozed">
                                  <ClockIcon size={12} /> {t('reminders.snoozedTag')}
                                </span>
                              )}
                              {row.link?.label && <span className="rc-row-link">{row.link.label}</span>}
                              {row.note && <span className="rc-row-note">{row.note}</span>}
                            </div>
                          </div>

                          {row.amount > 0 && <span className="rc-row-amount">{rupees(row.amount)}</span>}

                          <div className="rc-row-actions">
                            {row.href && (
                              <Link
                                href={row.href}
                                className="icon-btn"
                                data-tip={t('reminders.open')}
                                aria-label={t('reminders.open')}
                              >
                                <ChevronRightIcon size={17} />
                              </Link>
                            )}
                            {!done && !bulkBusy && <RowMenu items={menuItems(row)} tip={t('reminders.moreActions')} />}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {composer && (
        <ReminderComposer
          reminder={composer.id ? composer : null}
          onClose={() => setComposer(null)}
          onSaved={() => load('quiet')}
        />
      )}
    </>
  );
}
