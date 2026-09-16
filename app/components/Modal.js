'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from './LanguageProvider';
import useBackDismiss from '../../lib/backDismiss';
import { XIcon } from './Icons';

/**
 * The app's dialog.
 *
 * There were seventy-one hand-written copies of this markup — `<div className="modal-overlay"
 * onClick={close}><form className="modal-card" onClick={stopPropagation}>` — spread across two
 * dozen pages, and only four of them wore `modal-fit`, the shape that actually guarantees the
 * card fits the screen. That is the real reason "the popup is wrong on my phone" kept coming
 * back: there was no one place to fix it, so each fix reached one dialog and the other seventy
 * carried on however they had been typed. This component is that one place.
 *
 * What every dialog gets for free by going through it:
 *
 *   Fits the screen.       Always `modal-fit`: header pinned, action row pinned, only the middle
 *                          scrolls, and the card's height cap is measured off the overlay's own
 *                          `--ov-top`/`--ov-bottom` — so it re-measures itself at every
 *                          breakpoint and clears the home indicator on a gesture-nav phone
 *                          without anyone writing a number twice.
 *   Escape closes it.      Twelve of the seventy-one had this. Now all of them do.
 *   A backdrop that is honest about what a click is (see the mousedown note below).
 *   Focus goes in, and comes back out to whatever opened the dialog.
 *   Tab stays inside.      A dialog you can Tab out of is a dialog a screen reader walks
 *                          straight out of the back of.
 *   role/aria-modal/aria-labelledby, wired to the real title.
 *   Portalled to <body>.   `.panel`'s entry animation leaves a `transform` behind, and a
 *                          transform makes an ancestor the containing block for
 *                          `position: fixed` — so an overlay rendered inside a panel is
 *                          trapped in it. Portalling means it can never matter again.
 *
 * Usage — the caller still owns whether the dialog exists:
 *
 *     {formOpen && (
 *       <Modal
 *         as="form"
 *         onSubmit={handleSubmit}
 *         onClose={() => setFormOpen(false)}
 *         title={t('expenses.add')}
 *         hint={t('expenses.formHint')}
 *         maxWidth={560}
 *         footer={<>
 *           <button type="submit" className="btn btn-primary btn-inline">{t('common.save')}</button>
 *           <button type="button" className="btn btn-secondary btn-inline" onClick={close}>…</button>
 *         </>}
 *       >
 *         …fields…
 *       </Modal>
 *     )}
 *
 * `footer` is deliberately a separate prop rather than "the last child": the pinned action row
 * is the one band that must never scroll away, and leaving that to convention is how it ends up
 * in the scroll box on the one page nobody re-checked.
 */
export default function Modal({
  onClose,
  title,
  hint,
  headerActions,
  footer,
  children,
  maxWidth,
  as = 'div',
  onSubmit,
  noValidate = false,
  className = '',
  labelledBy,
  closeOnBackdrop = true,
  closeOnEscape = true,
  initialFocus,
}) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);
  const cardRef = useRef(null);
  const overlayRef = useRef(null);
  // Whatever had focus when the dialog opened. Restored on the way out so closing a dialog
  // puts the shopkeeper back on the button they opened it from, not at the top of the page.
  const returnFocusRef = useRef(null);
  const headingId = useId();

  useEffect(() => setMounted(true), []);

  /* Android's back button, when the app is installed. Deliberately tied to `closeOnEscape`
     rather than to a prop of its own: both answer the same question — may this dialog be
     dismissed without committing to it? A plan-expiry wall that refuses Escape must refuse
     back for the same reason, or the one screen the shopkeeper cannot walk past becomes the
     one screen the hardware button walks them past. */
  useBackDismiss(onClose, Boolean(onClose) && closeOnEscape);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    return () => {
      const target = returnFocusRef.current;
      if (target && typeof target.focus === 'function' && document.contains(target)) target.focus();
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const card = cardRef.current;
    if (!card) return;
    // A child's own `autoFocus` has already run by now, and it knows better than we do which
    // field the shopkeeper came here to type in. Only place focus when nothing inside took it.
    if (card.contains(document.activeElement)) return;
    const target = (initialFocus?.current) || card.querySelector(FOCUSABLE);
    (target || card).focus();
  }, [mounted, initialFocus]);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape' && closeOnEscape) {
        /* Escape belongs to whatever is on TOP, and several things in this app can sit on top
           of a dialog. They all listen on `document` too, so `stopPropagation` would not stop
           them — listeners on the same node all fire regardless. The dialog therefore steps
           aside instead: a `Dropdown`'s open list, a `useConfirm()` dialog and the calculator
           all portal to <body> and are recognisable there, and a dialog opened FROM this one
           lands after it in the overlay order. Without this, one Escape inside an open
           dropdown shut the dropdown and threw the half-filled form away with it. */
        if (document.querySelector('.dropdown-list, .confirm-backdrop, .calc-overlay')) return;
        const overlays = document.querySelectorAll('.modal-overlay');
        if (overlays.length > 0 && overlays[overlays.length - 1] !== overlayRef.current) return;
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab' || !cardRef.current) return;
      const focusables = Array.from(cardRef.current.querySelectorAll(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null || node === document.activeElement
      );
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
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, closeOnEscape]);

  if (!mounted) return null;

  const Card = as === 'form' ? 'form' : 'div';

  /* `onMouseDown`, not `onClick`, and only when the press STARTED on the backdrop.
     The old hand-written pattern was `onClick` on the overlay with `stopPropagation` on the
     card, which quietly means: select some text in a field, drag past the edge of the card,
     let go — the click event resolves against the common ancestor, which is the overlay, and
     the half-filled form is gone. Rare, unreproducible on demand, and it eats real work. */
  function onBackdrop(event) {
    if (!closeOnBackdrop) return;
    if (event.target !== event.currentTarget) return;
    onClose?.();
  }

  return createPortal(
    <div className="modal-overlay" ref={overlayRef} onMouseDown={onBackdrop}>
      <Card
        ref={cardRef}
        className={`modal-card modal-fit${className ? ` ${className}` : ''}`}
        style={maxWidth ? { maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth } : undefined}
        onSubmit={Card === 'form' ? onSubmit : undefined}
        noValidate={Card === 'form' ? noValidate : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || (title ? headingId : undefined)}
        tabIndex={-1}
      >
        {(title || hint || headerActions || onClose) && (
          <div className="modal-header">
            <div>
              {title && <h2 id={headingId}>{title}</h2>}
              {hint && <p>{hint}</p>}
            </div>
            {/* For the handful of dialogs whose header carries a control of its own — the
                supplier order sheet's Print, for one. Anything that acts on the dialog's
                SUBJECT rather than on the dialog goes here; the commit action still belongs
                in `footer`, where the thumb can find it. */}
            {headerActions ? (
              <div className="row-actions">
                {headerActions}
                {onClose && (
                  <button type="button" className="modal-close" onClick={onClose} aria-label={t('common.close')}>
                    <XIcon size={18} />
                  </button>
                )}
              </div>
            ) : (
              onClose && (
                <button type="button" className="modal-close" onClick={onClose} aria-label={t('common.close')}>
                  <XIcon size={18} />
                </button>
              )
            )}
          </div>
        )}

        <div className="modal-body">{children}</div>

        {footer && <div className="modal-actions">{footer}</div>}
      </Card>
    </div>,
    document.body
  );
}

/* Kept in one place because the focus effect and the Tab trap must agree on what "focusable"
   means — two slightly different lists is how a trap ends up letting Tab escape past the one
   control the other list forgot. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
