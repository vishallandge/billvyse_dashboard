'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ChatIcon, ChevronRightIcon, SpinnerIcon } from './Icons';
import { useLanguage } from './LanguageProvider';
import { apiFetch } from '../../lib/api';
import { formatRelativeTime } from '../../lib/format';
import styles from './SupportPopover.module.css';

/**
 * The chat shortcut in the topbar — on every module, beside the bell.
 *
 * It used to be a headset that opened a blank form. Two things were missing: the shop could
 * not SEE that support had answered (the reply sat on a page he had no reason to open), and
 * asking about the screen he was standing on meant explaining which screen that was. So:
 *
 *   - the icon carries the count of replies he has not opened;
 *   - the first row says "Ask about Billing" (whatever module this is) and opens the form
 *     with that topic already picked — the page itself travels with the message anyway;
 *   - under it, his last few questions, each one tap from its conversation.
 *
 * Positioned and dismissed exactly like NotificationPopover, portalled to body for the
 * reason in feedback_no_overlay_inside_panel.
 */

const STATUS_CLS = {
  open: 'badge-pending',
  working: 'badge-expiring',
  waiting: 'badge-active',
  resolved: 'badge-active',
  closed: 'badge-inactive',
};

export default function SupportPopover({ unreadCount = 0, moduleLabel = '', topic = '', onAsk }) {
  const { t, lang } = useLanguage();
  const id = useId();
  const trigger = useRef(null);
  const panel = useRef(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const [tickets, setTickets] = useState(null);
  const count = Math.max(0, Number(unreadCount) || 0);

  useLayoutEffect(() => {
    if (!open) return undefined;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(340, window.innerWidth - 24);
      const top = Math.max(12, Math.min(rect.bottom + 10, window.innerHeight - 200));
      setPosition({
        top,
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        maxHeight: Math.min(440, window.innerHeight - top - 12),
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
    if (!open) return undefined;
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
  }, [open]);

  // Fetched on open, not on every navigation — the badge already comes from the shell's feed.
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    apiFetch('/api/seller/support/tickets')
      .then((data) => alive && setTickets(data.tickets || []))
      .catch(() => alive && setTickets([]));
    return () => {
      alive = false;
    };
  }, [open]);

  function openTicket(ticketId) {
    setOpen(false);
    // /seller/support may already be on screen, where a query change alone does not remount it.
    window.dispatchEvent(new CustomEvent('support:open', { detail: { id: ticketId } }));
  }

  const recent = (tickets || []).slice(0, 4);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`bell-btn support-btn ${styles.trigger} ${open ? styles.active : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-label={t('support.navLabel')}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
      >
        <ChatIcon size={17} />
        {count > 0 && (
          <span className="bell-badge" aria-hidden="true">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <section
            ref={panel}
            id={id}
            className={styles.panel}
            style={position || { visibility: 'hidden' }}
            role="dialog"
            aria-labelledby={`${id}-title`}
            tabIndex={-1}
          >
            <header className={styles.head}>
              <strong id={`${id}-title`}>{t('support.popTitle')}</strong>
              {moduleLabel && <span>{t('support.youAreOn', { module: moduleLabel })}</span>}
            </header>

            <div className={styles.content}>
              <button
                type="button"
                className={styles.ask}
                onClick={() => {
                  setOpen(false);
                  onAsk?.(topic);
                }}
              >
                <span className={styles.askMark}>
                  <ChatIcon size={16} />
                </span>
                <span className={styles.askText}>
                  <strong>{moduleLabel ? t('support.askAbout', { module: moduleLabel }) : t('support.askGeneral')}</strong>
                  <small>{t('support.askHint')}</small>
                </span>
                <ChevronRightIcon size={15} />
              </button>

              <div className={styles.label}>{t('support.recent')}</div>
              {!tickets ? (
                <p className={styles.empty}>
                  <SpinnerIcon size={16} /> {t('support.loading')}
                </p>
              ) : !recent.length ? (
                <p className={styles.empty}>{t('support.popEmpty')}</p>
              ) : (
                recent.map((row) => (
                  <Link
                    key={row.id}
                    href={`/seller/support?ticket=${row.id}`}
                    className={styles.row}
                    onClick={() => openTicket(row.id)}
                  >
                    <span className={styles.rowMain}>
                      <span className={styles.rowTop}>
                        {row.unread > 0 && <span className={styles.dot} aria-hidden="true" />}
                        <strong>{t(`support.topics.${row.topic}`)}</strong>
                        <span className={styles.when}>{formatRelativeTime(row.lastMessageAt, lang)}</span>
                      </span>
                      <span className={styles.snippet}>{row.lastText}</span>
                    </span>
                    <span className={`badge ${STATUS_CLS[row.status] || ''}`}>{t(`support.status.${row.status}`)}</span>
                  </Link>
                ))
              )}
            </div>

            <Link href="/seller/support" className={styles.footer} onClick={() => setOpen(false)}>
              <span>{t('support.allConversations')}</span>
              <ChevronRightIcon size={17} />
            </Link>
          </section>,
          document.body
        )}
    </>
  );
}
