'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { BellIcon, ChevronRightIcon } from './Icons';
import { useLanguage } from './LanguageProvider';
import styles from './NotificationPopover.module.css';

export default function NotificationPopover({ open, setOpen, unreadCount = 0, children }) {
  const { t } = useLanguage();
  const id = useId();
  const trigger = useRef(null);
  const panel = useRef(null);
  const [position, setPosition] = useState(null);
  const count = Math.max(0, Number(unreadCount) || 0);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 24);
      const top = Math.max(12, Math.min(rect.bottom + 10, window.innerHeight - 180));
      setPosition({
        top,
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        maxHeight: Math.min(360, window.innerHeight - top - 12),
      });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus({ preventScroll: true });
    function outside(event) {
      if (!trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false);
    }
    function escape(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    }
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, setOpen]);

  return (
    <>
      <button ref={trigger} type="button" className={`bell-btn ${styles.trigger} ${open ? styles.active : ''}`}
        onClick={() => setOpen(value => !value)} aria-label={t('notifications.title')}
        aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog">
        <BellIcon size={17} />
        {count > 0 && <span className="bell-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && createPortal(
        <section ref={panel} id={id} className={styles.panel} style={position || { visibility: 'hidden' }}
          role="dialog" aria-labelledby={`${id}-title`} tabIndex={-1}>
          <h2 id={`${id}-title`} className="sr-only">{t('notifications.title')}</h2>
          <div className={styles.content}>
            {children}
            <Link href="/seller/notifications" className={styles.footer} onClick={() => setOpen(false)}>
              <span>{t('notifications.viewAll')}</span><ChevronRightIcon size={17} />
            </Link>
          </div>
        </section>, document.body
      )}
    </>
  );
}
