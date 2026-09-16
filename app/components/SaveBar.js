'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from './LanguageProvider';
import { CheckCircleIcon, AlertIcon, XIcon, EditIcon } from './Icons';

/**
 * "Save" that comes to the shopkeeper, instead of making him come to it.
 *
 * The Settings page is one form about six hundred lines long with a single Save button at the
 * very bottom. Renaming the shop — the first field on the page — meant scrolling past every
 * invoice toggle in the app to reach it, and the confirmation banner then appeared back at the
 * top, where he no longer was. Both halves of that are the same bug: the page's answer was
 * somewhere other than where the shopkeeper's hands were.
 *
 * So this is a strip that arrives at the bottom of the screen the moment anything changes,
 * stays within reach however far down he has scrolled, and reports the result in the same place
 * he pressed the button. Four states, one strip:
 *
 *   dirty    "3 settings changed" + Undo + Save
 *   saving   the same strip, busy — nothing moves, so the button never jumps under a thumb
 *   done     a green "Saved" that leaves on its own after a moment
 *   error    the server's actual sentence, in reach, with the button still there to press again
 *
 * The error state is the easiest to skip and the most important one here: an error banner at the
 * top of a page the shopkeeper is not looking at is indistinguishable from the save having
 * quietly worked, which is how a shop ends up with a UPI id it only thinks it changed.
 *
 * PORTALLED TO <body>, always. This bar is `position: fixed`, and `.panel` animates in with a
 * transform — a fixed element rendered inside one is captured by that transform and pins itself
 * to the panel instead of the viewport. That has caught us before; the portal is not decoration.
 *
 * Generic on purpose (`rows`, `onSave`, `onDiscard`), because Settings is not the only long form
 * in this app and the second one should get this by importing it, not by copying it.
 */
export default function SaveBar({ rows = [], saving = false, error = '', savedAt = null, onSave, onDiscard }) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);
  // The green tick is worth about two and a half seconds. Any longer and it is still sitting
  // there once he has started editing again, which makes "saved" ambiguous about WHICH save.
  const [showDone, setShowDone] = useState(false);
  const doneTimer = useRef(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!savedAt) return undefined;
    setShowDone(true);
    clearTimeout(doneTimer.current);
    doneTimer.current = setTimeout(() => setShowDone(false), 2600);
    return () => clearTimeout(doneTimer.current);
  }, [savedAt]);

  const dirty = rows.length > 0;
  if (!mounted || !(dirty || saving || showDone || error)) return null;

  const state = error ? 'error' : saving ? 'saving' : dirty ? 'dirty' : 'done';
  const message =
    state === 'error'
      ? error
      : state === 'saving'
        ? t('seller.savingSettings')
        : state === 'done'
          ? t('seller.settingsSaved')
          : rows.length === 1
            ? t('seller.unsavedOne')
            : t('seller.unsavedMany', { count: rows.length });

  return createPortal(
    <div className={`save-bar is-${state}`} role="status" aria-live="polite">
      <span className="save-bar__mark" aria-hidden="true">
        {state === 'done' ? <CheckCircleIcon size={16} /> : state === 'error' ? <AlertIcon size={16} /> : <EditIcon size={15} />}
      </span>

      <span className="save-bar__copy">
        <strong>{message}</strong>
        {/* The reason the bar is there, said once. Dropped the moment there is something more
            useful to put in the space — a server error owns the whole strip. */}
        {state === 'dirty' && <small>{t('seller.unsavedHint')}</small>}
      </span>

      {(state === 'dirty' || state === 'error') && (
        <span className="save-bar__actions">
          <button type="button" className="save-bar__ghost" onClick={onDiscard} disabled={saving}>
            {t('seller.discardChanges')}
          </button>
          <button type="button" className="btn btn-primary btn-small" onClick={onSave} disabled={saving}>
            {state === 'error' ? t('seller.retry') : t('common.saveChanges')}
          </button>
        </span>
      )}
    </div>,
    document.body
  );
}

/**
 * "These are the things you changed. Save them?"
 *
 * Not a generic are-you-sure. A confirmation that only asks the question adds a tap and tells
 * the shopkeeper nothing. This one is the only place in the app that can show him what half an
 * hour of poking at fifty toggles actually amounts to, before it becomes how his shop behaves —
 * and he can now reach Save from the middle of the page, so he may well be saving without ever
 * having seen the bottom two-thirds of the form.
 *
 * Old value struck through, new value in the shop's accent, one row per setting. That shape is
 * chosen so the list can be checked WITHOUT being read: a row whose right-hand half is wrong
 * stands out at a glance, which is the entire point of putting it in front of him.
 *
 * Portalled for the same reason as the bar above it, and separate from it so that each of these
 * components renders exactly one box.
 */
export function ChangeReview({
  rows,
  saving,
  warning,
  title,
  confirmLabel,
  onCancel,
  onConfirm,
  /**
   * An explanation the shop has to give before this save is allowed.
   *
   * Rendered here, inside the review, rather than as a second dialog on top of this one or as a
   * box somewhere in the form. That box is what this replaces: it used to appear inline beside
   * the business-type dropdown, six hundred lines up a page the shopkeeper had already scrolled
   * past, AFTER a save that had failed — so the app refused him, then hid the way to comply.
   * The question belongs against the button that triggers it.
   */
  reason,
}) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault();
        onCancel();
      }
    }
    document.addEventListener('keydown', onKey);
    // The page behind is six hundred lines of form; without this the review floats over a
    // document that is still scrolling, which reads as the dialog itself drifting.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onCancel, saving]);

  useEffect(() => {
    cardRef.current?.querySelector('.btn-primary')?.focus();
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="modal-overlay save-review-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && !saving && onCancel()}
    >
      <div
        className="modal-card save-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-review-title"
        ref={cardRef}
      >
        <div className="modal-header">
          <div>
            <h2 id="save-review-title">{title || t('seller.reviewTitle')}</h2>
            <p>{rows.length === 1 ? t('seller.reviewBodyOne') : t('seller.reviewBody', { count: rows.length })}</p>
          </div>
          <button type="button" className="modal-close" onClick={onCancel} disabled={saving} aria-label={t('common.cancel')}>
            <XIcon size={16} />
          </button>
        </div>

        {/* Only ever one, and only for the rows whose consequence a shopkeeper would not guess
            from the field's name — see heavyWarningKey in lib/settingsDiff.js. */}
        {warning && (
          <p className="save-review__warn">
            <AlertIcon size={15} />
            <span>{warning}</span>
          </p>
        )}

        <ul className="save-review__list">
          {rows.map((row, index) => (
            <li
              key={row.path}
              className={row.weight === 'heavy' ? 'is-heavy' : undefined}
              /* Rows arrive in a short cascade rather than all at once. Capped, because past
                 about a dozen the stagger stops reading as arrival and starts reading as lag. */
              style={{ '--row-i': Math.min(index, 12) }}
            >
              <span className="save-review__field">{row.label}</span>
              <span className="save-review__values">
                <s>{row.from}</s>
                <i aria-hidden="true">→</i>
                <b>{row.to}</b>
              </span>
            </li>
          ))}
        </ul>

        {reason && <ReasonField {...reason} disabled={saving} />}

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: 'auto' }}
            onClick={onConfirm}
            /* Blocked rather than allowed-and-refused. The shopkeeper can see exactly what is
               missing a line above the button, so a disabled Save here is self-explanatory —
               which is the only condition under which disabling a button is honest. */
            disabled={saving || (reason ? Boolean(reason.problem) : false)}
          >
            {saving ? t('seller.savingSettings') : confirmLabel || t('common.saveChanges')}
          </button>
          <button type="button" className="btn btn-secondary" style={{ width: 'auto' }} onClick={onCancel} disabled={saving}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * "Kripya kaaran likhein" — as a list of the answers people actually give.
 *
 * This started as a text box with a ten-character minimum, which was wrong twice over. There are
 * about six real reasons a shop changes its business type, so making a shopkeeper compose a
 * sentence on a phone at his counter is work we invented; and what he then typed to get past the
 * form was worth nothing to the audit log it went into. Taps instead: a better record AND less
 * work, which is the only kind of validation worth adding.
 *
 * "Koi aur wajah" is last and is the only one that still asks for a sentence — because it is the
 * only one where we genuinely do not know what he is about to say.
 *
 * Three decisions worth keeping:
 *
 *   The list differs for a chemist. See `reasonsFor` in lib/changeReason.js — a shop that added
 *   FMCG but still sells medicines is not handed a one-tap reason to switch off its own
 *   prescription register.
 *
 *   The verdict on free text only appears once he has typed. Opening with a red "too short"
 *   under an empty box is the app telling him off for a sentence he has not written yet.
 *
 *   `consequences` names what actually switches off. Nobody minds answering a question when they
 *   can see what it is for; everybody minds when it looks like paperwork.
 */
function ReasonField({
  options = [],
  code,
  onCodeChange,
  value,
  onChange,
  problem,
  touched,
  label,
  placeholder,
  hint,
  consequences = [],
  keeps,
  nudge,
  disabled,
}) {
  const { t } = useLanguage();
  const showText = code === 'other';

  return (
    <div className="save-reason">
      {consequences.length > 0 && (
        <ul className="save-reason__consequences">
          {consequences.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {/* What does NOT change, said as plainly as what does. An honest chemist correcting a
          mis-picked type should not be left thinking he has switched off a legal safeguard,
          and nobody should come away believing the type is a way round one. */}
      {keeps && <p className="save-reason__keeps">{keeps}</p>}

      <p className="save-reason__label" id="btype-reason-label">
        {label}
      </p>

      {/* A radiogroup, not a Dropdown: six options that must all be read before one is picked,
          and a dropdown hides five of them behind a tap. */}
      <div className="reason-choices" role="radiogroup" aria-labelledby="btype-reason-label">
        {options.map((option) => (
          <label key={option} className={`reason-choice${code === option ? ' is-picked' : ''}`}>
            <input
              type="radio"
              name="btype-reason"
              value={option}
              checked={code === option}
              disabled={disabled}
              onChange={() => onCodeChange(option)}
            />
            <span>{t(`seller.btypeReason_${option}`)}</span>
          </label>
        ))}
      </div>

      {showText && (
        <div className="save-reason__text">
          <textarea
            id="btype-reason-text"
            rows={2}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            placeholder={placeholder}
            aria-label={label}
            aria-invalid={touched && Boolean(problem)}
            aria-describedby="btype-reason-note"
            autoFocus
          />
        </div>
      )}

      {/* Prompted by the answer he just gave, so it appears under the choice rather than above
          it — and it is a nudge, not a condition: the Save button is not waiting on it. */}
      {nudge && <p className="save-reason__nudge">{nudge}</p>}

      <p id="btype-reason-note" className={`save-reason__note${touched && problem ? ' is-bad' : ''}`}>
        {touched && problem ? t(`seller.reason_${problem}`) : hint}
      </p>
    </div>
  );
}
