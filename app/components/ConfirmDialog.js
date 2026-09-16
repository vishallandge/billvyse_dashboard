'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from './LanguageProvider';
import useBackDismiss from '../../lib/backDismiss';
import { AlertIcon, TrashIcon, InfoIcon, CheckCircleIcon, XIcon } from './Icons';

/**
 * The app's own confirm, prompt and "are you sure".
 *
 * Forty-two places were calling `window.confirm` and `window.prompt`. Those are not just
 * ugly — a grey OS box saying "localhost:3001 says" in front of a shopkeeper's till is the
 * app admitting it is a web page. Worse, they are unreadable in the ways that matter here:
 * no icon to say how serious this is, no room for the consequence, no way to show the ₹
 * amount that is about to move, and `prompt()` cannot even be styled or validated.
 *
 * Exposed as a PROMISE with the same shape as `window.confirm`, deliberately:
 *
 *     if (!(await confirm({ ... }))) return;
 *
 * so every one of those forty-two call sites stays a single line and the replacement is
 * mechanical rather than forty-two separate pieces of modal state. A component-per-site
 * would have been forty-two chances to get one wrong.
 *
 * Four tones, because "delete this forever" and "is this the right date" are not the same
 * question and should not look the same:
 *
 *   danger   destroys something, or moves money the wrong way. Red, and the SAFE button is
 *            focused — a shopkeeper hammering Enter must not delete a customer.
 *   warning  irreversible but expected: receiving stock, sending a debit note.
 *   info     a plain question.
 *   success  confirming something good.
 */

const ConfirmContext = createContext(null);

const TONE_ICONS = {
  danger: TrashIcon,
  warning: AlertIcon,
  info: InfoIcon,
  success: CheckCircleIcon,
};

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  // The resolver of the promise the caller is awaiting. Held in a ref so re-renders while
  // the dialog is open never lose the caller.
  const resolverRef = useRef(null);

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setRequest(typeof options === 'string' ? { body: options } : options);
    });
  }, []);

  const settle = useCallback((answer) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    // A dialog that is dismissed rather than answered resolves false, exactly like
    // window.confirm — so `if (!ok) return;` keeps working at every call site.
    resolve?.(answer);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && <ConfirmDialog request={request} onSettle={settle} />}
    </ConfirmContext.Provider>
  );
}

/**
 * `const confirm = useConfirm()` — then `await confirm({ ... })`.
 *
 * Falls back to the browser's own dialog if the provider is somehow missing, so a screen
 * rendered outside the shell degrades to the old behaviour instead of silently doing
 * nothing. A destructive action that quietly no-ops is worse than an ugly box.
 */
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  return (
    ctx ||
    ((options) => Promise.resolve(window.confirm(typeof options === 'string' ? options : options?.body || '')))
  );
}

function ConfirmDialog({ request, onSettle }) {
  const { t } = useLanguage();
  const {
    tone = 'warning',
    title,
    body,
    details,
    confirmLabel,
    cancelLabel,
    input,
    checkbox,
  } = request;

  const [value, setValue] = useState(input?.defaultValue ?? '');
  const [checked, setChecked] = useState(Boolean(checkbox?.defaultChecked));
  const [touched, setTouched] = useState(false);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef(null);
  const safeRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => setMounted(true), []);

  /* Android's back button dismisses this the same way Escape does — as the answer "no".
     A confirm is the most common thing on screen when back gets pressed, and it is the one
     place where "the app closed instead" is worst: the shopkeeper is mid-decision about
     deleting something or moving money. */
  useBackDismiss(() => onSettle(false));

  useEffect(() => {
    // An input to fill takes the caret; otherwise focus lands on the way OUT. On a
    // destructive dialog the dangerous button must never be one Enter away.
    const target = input ? inputRef.current : safeRef.current;
    target?.focus();
  }, [input]);

  const Icon = TONE_ICONS[tone] || TONE_ICONS.warning;
  const missingRequired = Boolean(input?.required) && !String(value).trim();

  function accept() {
    if (missingRequired) {
      setTouched(true);
      inputRef.current?.focus();
      return;
    }
    // A bare confirm resolves `true` so `if (!ok)` reads naturally. One that collected
    // something resolves the answer, which is still truthy.
    if (!input && !checkbox) onSettle(true);
    else onSettle({ value: input ? String(value).trim() : undefined, checked: checkbox ? checked : undefined });
  }

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onSettle(false);
      }
      // Enter submits only from the input — everywhere else the buttons own it, so a stray
      // keypress cannot confirm a deletion the shopkeeper has not read.
      if (event.key === 'Tab' && cardRef.current) {
        const focusables = cardRef.current.querySelectorAll('button, input, [href], select, textarea');
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onSettle]);

  if (!mounted) return null;

  // Portalled to <body> so no page's stacking context can trap the backdrop, the same
  // arrangement the language sheet uses.
  return createPortal(
    <div className="confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onSettle(false)}>
      <div
        className={`confirm-card is-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        ref={cardRef}
      >
        <button type="button" className="confirm-close" onClick={() => onSettle(false)} aria-label={t('common.cancel')}>
          <XIcon size={16} />
        </button>

        <div className="confirm-head">
          <span className="confirm-icon" aria-hidden="true">
            <Icon size={20} />
          </span>
          <div className="confirm-copy">
            <h2 id="confirm-title">{title || t('common.confirmTitle')}</h2>
            {body && <p>{body}</p>}
          </div>
        </div>

        {/* The consequences, spelled out. This is the whole reason a native confirm was not
            good enough — "₹300 will be added to what you owe him" belongs on its own line,
            not buried in a sentence. */}
        {details?.length > 0 && (
          <ul className="confirm-details">
            {details.map((detail, index) => (
              <li key={index}>
                {typeof detail === 'string' ? (
                  detail
                ) : (
                  <>
                    <span>{detail.label}</span>
                    <strong className={detail.tone ? `is-${detail.tone}` : undefined}>{detail.value}</strong>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {input && (
          <label className="confirm-field">
            <span>{input.label}</span>
            <input
              ref={inputRef}
              type={input.type || 'text'}
              inputMode={input.inputMode}
              min={input.min}
              max={input.max}
              step={input.step}
              value={value}
              placeholder={input.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  accept();
                }
              }}
            />
            {touched && missingRequired ? (
              <em className="confirm-field-error">{input.requiredHint || t('common.required')}</em>
            ) : (
              input.hint && <em>{input.hint}</em>
            )}
          </label>
        )}

        {/* One dialog, one decision — plus an opt-in extra. This replaced a second
            window.confirm fired immediately after the first, which reads as the app asking
            the same question twice. */}
        {checkbox && (
          <label className="confirm-check">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>
              {checkbox.label}
              {checkbox.hint && <em>{checkbox.hint}</em>}
            </span>
          </label>
        )}

        <div className="confirm-actions">
          {/* The way out first in the DOM so it takes focus on a danger dialog, but ordered
              last visually — the confirm button stays where the thumb expects it. */}
          <button type="button" className="btn btn-secondary btn-inline" ref={safeRef} onClick={() => onSettle(false)}>
            {cancelLabel || t('common.cancel')}
          </button>
          <button
            type="button"
            className={`btn btn-inline ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={accept}
          >
            {confirmLabel || t('common.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
