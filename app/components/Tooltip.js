'use client';

/**
 * One tooltip for the whole app.
 *
 * Every icon-only control in the dashboard used to explain itself through the browser's
 * own `title` attribute. That is not a tooltip a piece of software has: it waits about a
 * second before appearing, draws itself in the operating system's grey box at the OS's
 * font size, ignores the shop's theme entirely, never shows up on a touch screen, and
 * puts itself under the mouse pointer rather than beside the button. On a screen full of
 * marigold and Inter, that grey Windows box is the loudest thing saying "this is a web
 * page". Fifteen of them across a table row and the page stops feeling like a till.
 *
 * So: one listener on the document, one bubble in the body, and `data-tip` on the button.
 * Nothing is wrapped, no call site takes a component, and a control anywhere in the app —
 * inside a modal, inside a table that scrolls sideways, inside the billing terminal —
 * gets the same instant, themed label. Because the bubble is `position: fixed` in a
 * portal at the end of <body>, no `overflow: hidden` ancestor can clip it, which is the
 * one thing a CSS-only `::after` tooltip could never solve for the table rows.
 *
 * Accessibility is handled here rather than at 150 call sites: a control that has no
 * accessible name of its own (no aria-label, no visible text) gets one from its tip the
 * first time it is hovered or focused, so a screen reader announces exactly what the
 * sighted user reads.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Long enough that sweeping the mouse across a toolbar does not flash five bubbles,
// short enough that it reads as instant when you stop on one. The browser's own delay is
// roughly a second, which is the reason nobody ever waits for it.
const OPEN_DELAY = 140;
const GUTTER = 8;

export default function TooltipLayer() {
  const [tip, setTip] = useState(null);
  const timerRef = useRef(null);
  const bubbleRef = useRef(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return undefined;

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const hide = () => {
      clearTimer();
      setTip((current) => (current ? null : current));
    };

    // A control's tip may sit on the button itself or on something it wraps (an icon
    // inside it), so the nearest ancestor carrying one wins.
    const targetFor = (node) => (node && node.closest ? node.closest('[data-tip]') : null);

    const show = (el) => {
      const text = el.getAttribute('data-tip');
      if (!text) return;

      // The tip doubles as the accessible name when the control has none. Only when it
      // has none: a button that already says "Delete" in words must not be renamed by a
      // tooltip that happens to say something slightly different.
      if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.textContent.trim()) {
        el.setAttribute('aria-label', text);
      }

      const rect = el.getBoundingClientRect();
      setTip({ text, rect, side: el.getAttribute('data-tip-side') || 'top' });
    };

    const onOver = (event) => {
      const el = targetFor(event.target);
      if (!el) {
        // Left the control (or moved onto something else entirely) — the bubble goes
        // with it. Checking here rather than on pointerout keeps a move between a button
        // and the icon inside it from flickering.
        hide();
        return;
      }
      // Touch fires a pointerover just before the tap. A bubble that appears under the
      // finger at the moment of the press is noise, and the aria-label above is what a
      // touch user's screen reader reads anyway.
      if (event.pointerType === 'touch') return;
      clearTimer();
      timerRef.current = setTimeout(() => show(el), OPEN_DELAY);
    };

    const onFocus = (event) => {
      const el = targetFor(event.target);
      if (!el) return;
      // Keyboard focus is deliberate in a way a passing mouse is not, so it skips the
      // delay entirely.
      clearTimer();
      show(el);
    };

    const onKey = (event) => {
      if (event.key === 'Escape') hide();
    };

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('keydown', onKey, true);
    // A tip is pinned to where the control WAS. Anything that moves the control —
    // scrolling a page, scrolling a table sideways, resizing — invalidates that, and
    // re-measuring on every frame would cost more than it is worth for a label.
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide, true);
    window.addEventListener('blur', hide);

    return () => {
      clearTimer();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('focusout', hide, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, [mounted]);

  // Measured placement, in a layout effect's shoes: the bubble is rendered off-screen for
  // one frame, measured, then moved. Guessing its width from the string length is what
  // makes most tooltips sit half off the edge of a laptop screen.
  useEffect(() => {
    const node = bubbleRef.current;
    if (!tip || !node) return;
    const box = node.getBoundingClientRect();
    const { rect, side } = tip;

    let top = side === 'bottom' ? rect.bottom + 6 : rect.top - box.height - 6;
    // Not enough room above? Flip. This is the whole reason a tooltip on the first row of
    // a sticky table header is readable at all.
    if (top < GUTTER) top = rect.bottom + 6;
    if (top + box.height > window.innerHeight - GUTTER) top = Math.max(GUTTER, rect.top - box.height - 6);

    let left = rect.left + rect.width / 2 - box.width / 2;
    left = Math.min(Math.max(GUTTER, left), window.innerWidth - box.width - GUTTER);

    node.style.top = `${Math.round(top)}px`;
    node.style.left = `${Math.round(left)}px`;
    node.style.visibility = 'visible';
  }, [tip]);

  if (!mounted || !tip) return null;

  return createPortal(
    // Keyed on the tip itself so every new tooltip is a NEW node. Reusing one node would
    // mean the second tip paints for a frame at the first one's coordinates — the
    // measuring effect below only runs after that paint — which reads as the bubble
    // jumping across the screen before it settles.
    <div
      key={`${tip.text}|${Math.round(tip.rect.top)}|${Math.round(tip.rect.left)}`}
      ref={bubbleRef}
      className="tip-bubble"
      role="tooltip"
      style={{ visibility: 'hidden' }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
