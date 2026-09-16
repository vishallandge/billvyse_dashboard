'use client';

import { useEffect } from 'react';

/**
 * Stops the browser drawing its own suggestion list over this app.
 *
 * What went wrong: the "Add a product" dialog has `<input id="name">`, and Chrome does not
 * read our labels — it classifies a field from its `id`, `name` and placeholder. "name"
 * means a PERSON's name to that classifier, so opening the product form popped Chrome's
 * saved-profile list over the dialog: the shopkeeper's own name, their organisation, and
 * every value they had ever typed into a similarly-named box. A black panel, in the
 * browser's styling and not ours, covering the form. The same thing happens on the
 * customer name, supplier name and phone boxes for the same reason.
 *
 * It is not only ugly. It is wrong: the field wants the name of the PRODUCT, and the list
 * offers the name of the person reading the screen, one tap away from being saved as a
 * product called "Vishal Landge".
 *
 * Why this is one mounted component and not an attribute on each input: there are ~640
 * `<input>` elements across this app and no shared field component to put the default in.
 * Editing every one of them is a change nobody could review, would miss the next input
 * somebody writes, and would have to be repeated in the customer app. This is the same
 * shape as PwaRegister and TooltipLayer above it — one listener, mounted once, for a
 * behaviour that belongs to the whole document.
 *
 * The rule is a DEFAULT, never an override: any field that already declares
 * `autoComplete` is left exactly as it is. That is what keeps the places where autofill
 * genuinely helps — the login email, the OTP box, the password fields, every part of
 * AddressField — working as their authors wrote them. Roughly forty fields opt in like
 * that today, and they are the whole reason this guard reads the attribute before writing
 * it.
 *
 * The honest limit: `autocomplete="off"` is a request. Chrome documents that it may
 * override it for password fields and for forms it has decided are address forms, and
 * that behaviour cannot be tested from here — it needs a real browser profile with saved
 * addresses. So the mis-signal is fixed at the source as well, wherever a field's id told
 * the classifier something untrue (see `id="product-name"` in seller/products).
 */

/**
 * Types that have a suggestion dropdown at all.
 *
 * A checkbox, a date picker or a file button has nothing to suppress, and stamping them
 * would put a pointless attribute on ~130 elements. `''` is in the set because an input
 * with no `type` IS a text input, and that is most of them here.
 *
 * `password` is deliberately absent. A password box with autofill switched off fights the
 * shopkeeper's password manager, which is a real usability loss to prevent a dropdown that
 * is genuinely wanted there — and our four password fields already declare
 * current-password / new-password for themselves.
 */
const HAS_SUGGESTIONS = new Set(['', 'text', 'search', 'tel', 'url', 'email', 'number']);

function wantsGuard(field) {
  if (field.hasAttribute('autocomplete')) return false;
  if (field.tagName === 'TEXTAREA') return true;
  if (field.tagName !== 'INPUT') return false;
  return HAS_SUGGESTIONS.has((field.getAttribute('type') || '').toLowerCase());
}

function guard(node) {
  if (!node || node.nodeType !== 1) return;

  // The node itself, for the case where a single field is the thing that was added —
  // `querySelectorAll` searches descendants only and would skip it.
  if (wantsGuard(node)) node.setAttribute('autocomplete', 'off');
  // A form-level default too. An input's own attribute still wins over its form's, so the
  // forty opt-ins are unaffected; this only adds the second signal for the fields inside.
  if (node.tagName === 'FORM' && !node.hasAttribute('autocomplete')) {
    node.setAttribute('autocomplete', 'off');
  }

  if (typeof node.querySelectorAll !== 'function') return;
  // `:not([autocomplete])` does the skipping in the selector engine rather than in JS, so
  // a re-scan after a re-render walks only the fields that have not been stamped yet.
  for (const field of node.querySelectorAll('input:not([autocomplete]), textarea:not([autocomplete])')) {
    if (wantsGuard(field)) field.setAttribute('autocomplete', 'off');
  }
  for (const form of node.querySelectorAll('form:not([autocomplete])')) {
    form.setAttribute('autocomplete', 'off');
  }
}

export default function AutofillGuard() {
  useEffect(() => {
    guard(document.body);

    /* Every dialog in this app is portalled to <body> and every table row is rendered on
       demand, so the fields that matter mostly do not exist yet when this first runs.
       Watching for them is the whole point — a one-shot pass would guard the login page
       and nothing else.

       React never fights us for the attribute: it only patches props a component actually
       declares, and these components declare no `autoComplete`, so nothing re-renders it
       away. Where a component DOES declare one, `wantsGuard` has already stepped aside. */
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) guard(node);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
