'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useBackDismiss from '../../lib/backDismiss';
import { useLanguage } from './LanguageProvider';
import { DotsIcon } from './Icons';

/**
 * The overflow menu on a table row.
 *
 * A row of records has more things you can do to it than a row has width. The purchase
 * order list is the clearest case: mark received, open it, edit it, delete it — and each
 * one used to be spelled out as a button, so the actions column grew wider than the money
 * columns and shoved "Bill" off the right edge of the table. Widening the column is not
 * the fix, because the next vertical adds a fifth action.
 *
 * So a row gets at most three icon buttons — the ones a shopkeeper reaches for every day
 * — and everything else lives behind these three dots. That is not a compromise; it is
 * what every piece of software with a list in it does, for exactly this reason. It also
 * settles a question the icon-only rule cannot answer on its own: an action whose label
 * is genuinely needed to understand it ("Offboard", "Reset password", "Pause") does not
 * belong on a 30px square at all. In here it keeps its words.
 *
 * Portalled to <body> on purpose. `.panel` animates in with a transform, and a transformed
 * ancestor becomes the containing block for `position: fixed`, which would trap this menu
 * inside the panel and let the table's own `overflow-x` clip it. Same reason Dropdown.js
 * portals its list.
 *
 * items: [{ label, icon, onClick, href, danger, disabled, hidden }]
 *   `hidden` is honoured here rather than at the call site so a row can pass its full
 *   vocabulary of actions as one array and let the state of the record decide, instead of
 *   every page repeating a `&&` ladder around the menu itself.
 */

const MENU_WIDTH = 208;
const GUTTER = 8;

export default function RowMenu({ items = [], label, tip, className = '' }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => setMounted(true), []);

  // Same reason as the dropdown's: an open menu is the thing back should close.
  useBackDismiss(() => setOpen(false), open);

  const shown = items.filter((item) => item && !item.hidden);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) {
      if (
        triggerRef.current && !triggerRef.current.contains(event.target)
        && menuRef.current && !menuRef.current.contains(event.target)
      ) setOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    // Measured once against the viewport, so anything that moves the row out from under
    // the menu — scrolling the page, scrolling the table sideways, a resize — closes it
    // rather than leaving it floating over an unrelated row.
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (shown.length === 0) return null;

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      // Right-aligned to the trigger, because the actions column is the last one in the
      // table — a left-aligned menu would hang off the edge of the window on every row.
      const left = Math.min(
        Math.max(GUTTER, rect.right - MENU_WIDTH),
        window.innerWidth - MENU_WIDTH - GUTTER,
      );
      // Roughly what the list will need; only used to decide which way to open, and the
      // stylesheet caps the real height with a scroll.
      const wanted = shown.length * 38 + 12;
      const spaceBelow = window.innerHeight - rect.bottom - GUTTER;
      const openUp = spaceBelow < wanted && rect.top - GUTTER > spaceBelow;
      setCoords({
        left,
        maxHeight: Math.max(140, openUp ? rect.top - GUTTER * 2 : spaceBelow),
        ...(openUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      });
    }
    setOpen(true);
  }

  function run(item) {
    setOpen(false);
    if (item.onClick) item.onClick();
  }

  const menu = open && (
    <div className="row-menu" role="menu" ref={menuRef} style={{ position: 'fixed', width: MENU_WIDTH, ...coords }}>
      {shown.map((item, index) => {
        const body = (
          <>
            {item.icon ? <span className="row-menu-icon">{item.icon}</span> : <span className="row-menu-icon" />}
            <span>{item.label}</span>
          </>
        );
        const cls = `row-menu-item${item.danger ? ' danger' : ''}`;
        if (item.href) {
          return (
            <a
              key={index}
              role="menuitem"
              className={cls}
              href={item.href}
              target={item.external ? '_blank' : undefined}
              rel={item.external ? 'noreferrer' : undefined}
              onClick={() => setOpen(false)}
            >
              {body}
            </a>
          );
        }
        return (
          <button key={index} type="button" role="menuitem" className={cls} disabled={item.disabled} onClick={() => run(item)}>
            {body}
          </button>
        );
      })}
    </div>
  );

  const tipText = tip || label || t('common.moreActions');

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`icon-btn${open ? ' active' : ''} ${className}`.trim()}
        data-tip={tipText}
        aria-label={tipText}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <DotsIcon size={17} />
      </button>
      {mounted && menu ? createPortal(menu, document.body) : null}
    </>
  );
}
