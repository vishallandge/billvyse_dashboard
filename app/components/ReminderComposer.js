'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import Dropdown from './Dropdown';
import Switch from './Switch';
import { useLanguage } from './LanguageProvider';
import { apiFetch } from '../../lib/api';
import { toDateInput } from '../../lib/format';
import { SearchIcon, XIcon, UsersIcon, TruckIcon } from './Icons';
import { recordHref } from '../../lib/routeId';

/**
 * Writing a reminder down.
 *
 * The whole feature stands or falls here. A shopkeeper writes a reminder while a customer is
 * standing in front of him, with one hand — if this dialog costs him more than about six
 * seconds he goes back to the wall, the diary, or his own memory, and every clever thing on
 * the Reminder Centre is worth nothing.
 *
 * So the shape is: ONE required field, and a date that is already answered.
 *
 * Everything else — repeat, priority, who it is about, an alert before the time, a note — is
 * on the screen but pre-filled and skippable. That is why the date presets come before the
 * date input rather than after it: "Kal" is one tap and covers most of what a counter needs,
 * and a shopkeeper who wants the 14th at 4pm can still have it without the dialog ever having
 * asked him to choose a format.
 */

const PRIORITIES = ['low', 'normal', 'high'];

// How long the app waits after the last keystroke before asking the server who this is about.
// The customer search is the only network call this dialog makes while it is open, and firing
// it per keystroke would put a request behind every letter of "Ramesh".
const SEARCH_DEBOUNCE_MS = 260;

function atHour(date, hour) {
  const next = new Date(date);
  next.setHours(hour, 0, 0, 0);
  return next;
}

/**
 * The four dates a counter actually reaches for.
 *
 * Deliberately not seven, and deliberately not a calendar. "Aaj shaam", "kal subah", "parso"
 * and "agle hafte" are how the reminder was said out loud in the first place, and every one
 * of them is one tap. Anything rarer than these four is worth typing a date for.
 */
function presetDates(now = new Date()) {
  const evening = atHour(now, 18);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(now);
  dayAfter.setDate(dayAfter.getDate() + 2);
  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);

  return [
    // Only offered while there is still an evening left to remind him about — at 8pm
    // "aaj shaam" is a button that puts a reminder in the past.
    ...(evening > now ? [{ key: 'tonight', at: evening, allDay: false }] : []),
    { key: 'tomorrow', at: atHour(tomorrow, 10), allDay: false },
    { key: 'dayAfter', at: atHour(dayAfter, 10), allDay: false },
    { key: 'nextWeek', at: atHour(nextWeek, 10), allDay: true },
  ];
}

function toTimeInput(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '10:00';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export default function ReminderComposer({ reminder, onClose, onSaved }) {
  const { t } = useLanguage();
  const editing = Boolean(reminder?.id);

  const initialDue = reminder?.dueAt ? new Date(reminder.dueAt) : atHour(new Date(), 18) > new Date() ? atHour(new Date(), 18) : atHour(new Date(Date.now() + 86400000), 10);

  const [title, setTitle] = useState(reminder?.title || '');
  const [note, setNote] = useState(reminder?.note || '');
  const [date, setDate] = useState(toDateInput(initialDue));
  const [time, setTime] = useState(toTimeInput(initialDue));
  const [allDay, setAllDay] = useState(Boolean(reminder?.allDay));
  const [priority, setPriority] = useState(reminder?.priority || 'normal');
  const [repeat, setRepeat] = useState(reminder?.repeat?.every || 'none');
  const [push, setPush] = useState(reminder?.notify?.push !== false);
  const [beforeMins, setBeforeMins] = useState(String(reminder?.notify?.beforeMins ?? 0));
  const [link, setLink] = useState(reminder?.link || null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const titleRef = useRef(null);
  const presets = useMemo(() => presetDates(), []);

  /**
   * Who this reminder is about.
   *
   * Reuses `/api/seller/search` — the same endpoint the command palette and the billing
   * counter already use — rather than a new one. A reminder about "Ramesh" that carries the
   * real customer id is a reminder whose row can open his khata; a reminder that just has the
   * word "Ramesh" in it is a sticky note with extra steps.
   */
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      apiFetch(`/api/seller/search?q=${encodeURIComponent(term)}`)
        .then((data) => {
          if (!cancelled) setResults(data);
        })
        .catch(() => {
          if (!cancelled) setResults(null);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  function applyPreset(preset) {
    setDate(toDateInput(preset.at));
    setTime(toTimeInput(preset.at));
    setAllDay(preset.allDay);
  }

  // Which preset (if any) the current date/time already equals — so a tapped chip stays lit
  // and the shopkeeper can see what he chose without re-reading the date field.
  const activePreset = presets.find(
    (preset) => toDateInput(preset.at) === date && (preset.allDay ? allDay : !allDay && toTimeInput(preset.at) === time)
  );

  async function submit(event) {
    event.preventDefault();
    if (!title.trim()) {
      setError(t('reminders.errTitle'));
      titleRef.current?.focus();
      return;
    }
    if (!date) {
      setError(t('reminders.errDate'));
      return;
    }

    setSaving(true);
    setError('');
    // An all-day reminder sends a bare date and lets the server pin it to the shop's own
    // morning; a timed one sends the instant the shopkeeper actually chose.
    const dueAt = allDay ? `${date}T00:00:00` : `${date}T${time || '10:00'}:00`;

    const body = {
      title: title.trim(),
      note: note.trim(),
      dueAt: new Date(dueAt).toISOString(),
      allDay,
      priority,
      repeat: { every: repeat, interval: 1 },
      link: link ? { kind: link.kind, id: link.id, label: link.label, href: link.href } : { kind: 'none' },
      notify: { push, beforeMins: Number(beforeMins) || 0 },
    };

    try {
      const data = await apiFetch(editing ? `/api/seller/reminders/${reminder.id}` : '/api/seller/reminders', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      onSaved?.(data.reminder);
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const beforeOptions = [
    { value: '0', label: t('reminders.beforeAtTime') },
    { value: '10', label: t('reminders.before10') },
    { value: '30', label: t('reminders.before30') },
    { value: '60', label: t('reminders.before60') },
    { value: '1440', label: t('reminders.before1440') },
  ];

  return (
    <Modal
      as="form"
      onSubmit={submit}
      onClose={onClose}
      title={editing ? t('reminders.editTitle') : t('reminders.newTitle')}
      hint={t('reminders.composerHint')}
      maxWidth={620}
      footer={
        <>
          <button type="submit" className="btn btn-primary btn-inline" disabled={saving}>
            {saving ? t('common.saving') : editing ? t('common.save') : t('reminders.saveNew')}
          </button>
          <button type="button" className="btn btn-secondary btn-inline" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
      {error && <div className="error-banner">{error}</div>}

      <div className="form-grid">
        <div className="field field-span2">
          <label htmlFor="rc-title">{t('reminders.fieldTitle')}</label>
          <input
            id="rc-title"
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('reminders.titlePlaceholder')}
            maxLength={160}
          />
        </div>

        {/* The date, answered before it is asked. */}
        <div className="field field-span2">
          <label>{t('reminders.fieldWhen')}</label>
          <div className="rc-presets">
            {presets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className={`chip${activePreset?.key === preset.key ? ' active' : ''}`}
                onClick={() => applyPreset(preset)}
              >
                {t(`reminders.preset.${preset.key}`)}
              </button>
            ))}
          </div>
          <div className="rc-when">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={allDay}
              aria-label={t('reminders.fieldTime')}
            />
            {/* A div, not a label: Switch renders its own <label for=…>, and a label nested
                inside another label is invalid markup whose click target the browser is free
                to resolve either way. The text beside it is a plain span for the same reason. */}
            <div className="rc-allday">
              <Switch checked={allDay} onChange={setAllDay} label={t('reminders.allDay')} id="rc-allday" />
              <span>{t('reminders.allDay')}</span>
            </div>
          </div>
        </div>

        <div className="field">
          <label>{t('reminders.fieldPriority')}</label>
          <div className="rc-presets">
            {PRIORITIES.map((level) => (
              <button
                key={level}
                type="button"
                className={`chip${priority === level ? ' active' : ''}`}
                onClick={() => setPriority(level)}
              >
                {t(`reminders.priority.${level}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="rc-repeat">{t('reminders.fieldRepeat')}</label>
          <Dropdown
            value={repeat}
            onChange={setRepeat}
            options={['none', 'daily', 'weekly', 'monthly', 'yearly'].map((key) => ({
              value: key,
              label: t(`reminders.repeat.${key}`),
            }))}
          />
        </div>

        {/* Who or what it is about. Optional, and the dialog says so — most reminders are
            about nobody, and a required field here would be four taps of nothing. */}
        <div className="field field-span2">
          <label htmlFor="rc-link">{t('reminders.fieldAbout')}</label>
          {link ? (
            <div className="rc-link-picked">
              {link.kind === 'supplier' ? <TruckIcon size={15} /> : <UsersIcon size={15} />}
              <span>{link.label}</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  setLink(null);
                  setQuery('');
                }}
                data-tip={t('common.remove')}
                aria-label={t('common.remove')}
              >
                <XIcon size={17} />
              </button>
            </div>
          ) : (
            <div className="input-action">
              <input
                id="rc-link"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('reminders.aboutPlaceholder')}
                autoComplete="off"
              />
              <span className="input-action-icon" aria-hidden="true">
                <SearchIcon size={15} />
              </span>
            </div>
          )}
          {!link && query.trim().length >= 2 && (
            <div className="rc-results">
              {searching && <p className="rc-results-empty">{t('common.loading')}</p>}
              {!searching && !results?.customers?.length && (
                <p className="rc-results-empty">{t('reminders.aboutNoMatch')}</p>
              )}
              {(results?.customers || []).map((customer) => (
                <button
                  key={customer._id}
                  type="button"
                  className="rc-result-row"
                  onClick={() =>
                    setLink({
                      kind: 'customer',
                      id: customer._id,
                      label: customer.name,
                      href: recordHref('/seller/khata/[id]', customer._id),
                    })
                  }
                >
                  <UsersIcon size={15} />
                  <span>{customer.name}</span>
                  <span className="rc-result-meta">{customer.phone}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="field field-span2">
          <label htmlFor="rc-note">{t('reminders.fieldNote')}</label>
          <textarea
            id="rc-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('reminders.notePlaceholder')}
            maxLength={1000}
          />
        </div>

        {/* The alert. On by default, because a reminder nobody is told about is a list. */}
        <div className="field field-span2">
          <div className="rc-notify">
            <div className="rc-allday">
              <Switch checked={push} onChange={setPush} label={t('reminders.notifyPush')} id="rc-push" />
              <span>{t('reminders.notifyPush')}</span>
            </div>
            {push && (
              <Dropdown
                value={beforeMins}
                onChange={setBeforeMins}
                options={beforeOptions}
                className="rc-before"
              />
            )}
          </div>
          <p className="field-hint">{t('reminders.notifyHint')}</p>
        </div>
      </div>
    </Modal>
  );
}
