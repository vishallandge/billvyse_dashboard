'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { apiErrorMessage } from '../../../lib/apiErrors';
import { formatRelativeTime, formatDateTime } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { SkeletonTable } from '../../components/Skeleton';
import { useSupport, useHiddenNav, useDashboardUser } from '../../components/DashboardShell';
import Link from 'next/link';
import { fixScreenFor } from '../../../lib/sellerNav';
import {
  ChevronRightIcon,
  HeadsetIcon,
  PlusIcon,
  SendIcon,
  CheckCircleIcon,
  ArrowLeftIcon,
  ChatIcon,
  ClockIcon,
} from '../../components/Icons';

/**
 * Support, from the shop's side — the other half of Admin -> Support.
 *
 * Before this, a shopkeeper who wrote in got a reference number and then silence: whatever
 * the operator answered went to a mail inbox he may never open, and there was no way to say
 * "nahi hua" without starting over. Here is the same conversation the operator sees, minus
 * the operator's internal notes (the server filters those out): his question, every reply,
 * a box to answer back, and — once support marks it solved — a plain "haan / nahi".
 *
 * One screen, list on the left and the thread on the right. On a phone the two take turns:
 * the list until a question is opened, then the thread with a way back.
 */

const STATUS_CLS = {
  open: 'badge-pending',
  working: 'badge-expiring',
  waiting: 'badge-active',
  resolved: 'badge-active',
  closed: 'badge-inactive',
};

export default function SellerSupportPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const openSupport = useSupport();
  const hiddenNav = useHiddenNav();
  const user = useDashboardUser();

  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [notSolved, setNotSolved] = useState(false);
  const [notSolvedText, setNotSolvedText] = useState('');

  const threadEndRef = useRef(null);
  const layoutRef = useRef(null);
  const [fitHeight, setFitHeight] = useState(null);

  /**
   * ONE SCREEN, NO PAGE SCROLL. The two panes are sized to exactly what is left of the
   * window below the header (minus the phone's bottom nav), and scroll inside themselves —
   * so the reply box never scrolls out of reach behind a long conversation. Measured rather
   * than a fixed calc(), because banners (plan expiry, impersonation) change what is above.
   */
  useEffect(() => {
    function fit() {
      const el = layoutRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const nav = document.querySelector('.bottom-nav');
      const navHeight = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().height : 0;
      setFitHeight(Math.max(420, Math.round(window.innerHeight - top - navHeight - 14)));
    }
    fit();
    // Banners that arrive after the first paint move the panes down.
    const late = window.setTimeout(fit, 450);
    window.addEventListener('resize', fit);
    return () => {
      window.clearTimeout(late);
      window.removeEventListener('resize', fit);
    };
  }, []);

  const loadList = useCallback(() => {
    return apiFetch('/api/seller/support/tickets')
      .then((data) => setList(data.tickets || []))
      .catch((err) => setError(apiErrorMessage(lang, err)));
  }, [lang]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const choose = useCallback((id) => {
    setSelected(id);
    setNotSolved(false);
    setNotSolvedText('');
    if (typeof window !== 'undefined') {
      const url = id ? `${window.location.pathname}?ticket=${encodeURIComponent(id)}` : window.location.pathname;
      window.history.replaceState(null, '', url);
    }
  }, []);

  /**
   * A refreshed URL lands back on the same question, and a question sent from the support
   * sheet while this screen is open appears — and opens — without a reload.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const id = new URLSearchParams(window.location.search).get('ticket');
    if (id) setSelected(id);
    function onSent(event) {
      loadList();
      if (event.detail?.id) choose(event.detail.id);
    }
    // The topbar chat shortcut opening one of his questions while this screen is already up.
    function onOpen(event) {
      if (event.detail?.id) choose(event.detail.id);
    }
    window.addEventListener('support:sent', onSent);
    window.addEventListener('support:open', onOpen);
    return () => {
      window.removeEventListener('support:sent', onSent);
      window.removeEventListener('support:open', onOpen);
    };
  }, [loadList, choose]);

  useEffect(() => {
    // Clear at once: the previous question's thread and reply box must never stay on screen
    // while the next one loads — a reply typed then would go to the wrong question.
    setDetail(null);
    if (!selected) return undefined;
    let alive = true;
    const hadUnread = list?.find((row) => row.id === selected)?.unread > 0;
    setDetailLoading(true);
    apiFetch(`/api/seller/support/tickets/${selected}`)
      .then((data) => {
        if (!alive) return;
        setDetail(data);
        // Opening it read it — clear the dot here instead of refetching the list, and let the
        // sidebar/topbar badge drop now rather than on the next navigation.
        setList((prev) => prev?.map((row) => (row.id === selected ? { ...row, unread: 0 } : row)));
        if (hadUnread) window.dispatchEvent(new Event('support:badge'));
      })
      .catch((err) => {
        if (!alive) return;
        toast.error(apiErrorMessage(lang, err));
        setDetail(null);
      })
      .finally(() => alive && setDetailLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // The newest message is the one he came for.
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [detail?.ticket?.id, detail?.thread?.length]);

  /**
   * Support's answer arrives while he is looking. Every 30s, while the tab is visible, the
   * list and the open question refresh quietly — the reply box he is typing in is untouched.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadList();
      if (!selected) return;
      apiFetch(`/api/seller/support/tickets/${selected}`)
        .then((data) => setDetail((prev) => (prev?.ticket?.id === data.ticket?.id ? data : prev)))
        .catch(() => {});
    }, 30000);
    return () => window.clearInterval(timer);
  }, [selected, loadList]);

  // Only lands on the question it was sent for — he may have opened another one meanwhile.
  function applyResult(res) {
    setDetail((prev) =>
      prev && prev.ticket?.id === res.ticket?.id
        ? { ...prev, ticket: { ...prev.ticket, ...res.ticket }, thread: res.thread }
        : prev
    );
    loadList();
  }

  async function sendReply(event) {
    event.preventDefault();
    if (!detail?.ticket || sending) return;
    if (reply.trim().length < 2) {
      toast.error(t('support.replyEmpty'));
      return;
    }
    setSending(true);
    try {
      const res = await apiFetch(`/api/seller/support/tickets/${detail.ticket.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text: reply.trim() }),
      });
      setReply('');
      applyResult(res);
    } catch (err) {
      toast.error(apiErrorMessage(lang, err));
    } finally {
      setSending(false);
    }
  }

  async function confirm(solved) {
    if (!detail?.ticket || sending) return;
    setSending(true);
    try {
      const res = await apiFetch(`/api/seller/support/tickets/${detail.ticket.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ solved, text: solved ? '' : notSolvedText.trim() }),
      });
      setNotSolved(false);
      setNotSolvedText('');
      toast.success(solved ? t('support.solvedThanks') : t('support.reopenedToast'));
      applyResult(res);
    } catch (err) {
      toast.error(apiErrorMessage(lang, err));
    } finally {
      setSending(false);
    }
  }

  const ticket = detail?.ticket;
  const thread = detail?.thread || [];

  /**
   * Where this gets fixed: support's choice, else the topic's own module (lib/sellerNav.js).
   * Dropped when this login cannot open that screen — a button to a 403 is not a fix.
   */
  const fix = fixScreenFor(ticket);
  const fixReachable =
    fix &&
    !hiddenNav.includes(fix.item.key) &&
    !(user?.role === 'staff' && !fix.item.staffVisible);

  return (
    <>
      <div className="content-header mysup-header">
        <h1>{t('support.myTitle')}</h1>
        <p>{t('support.mySubtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div
        ref={layoutRef}
        className={`mysup-layout${selected ? ' has-selection' : ''}`}
        style={fitHeight ? { height: `${fitHeight}px` } : undefined}
      >
        {/* ------------------------------------------------------------ the list */}
        <div className="panel mysup-list">
          <div className="panel-head">
            <div className="section-title">
              <span className="icon-badge icon-muted">
                <HeadsetIcon size={15} />
              </span>
              <h2>{t('support.listTitle')}</h2>
            </div>
            <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => openSupport('')}>
              <PlusIcon size={15} /> {t('support.newQuestion')}
            </button>
          </div>

          {!list ? (
            <SkeletonTable rows={4} cols={1} />
          ) : !list.length ? (
            <div className="sup-blank">
              <span className="icon-badge icon-muted">
                <ChatIcon size={20} />
              </span>
              <h2>{t('support.emptyTitle')}</h2>
              <p>{t('support.emptyBody')}</p>
            </div>
          ) : (
            <div className="sup-list">
              {list.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  className={`sup-row${selected === row.id ? ' is-on' : ''}`}
                  onClick={() => choose(row.id)}
                >
                  <div className="sup-row-top">
                    <strong>
                      {row.unread > 0 && <span className="sup-dot" aria-hidden="true" />}
                      {t(`support.topics.${row.topic}`)}
                    </strong>
                    <span className="sup-row-when">{formatRelativeTime(row.lastMessageAt, lang)}</span>
                  </div>
                  <p className="sup-row-msg">{row.lastText}</p>
                  <div className="sup-row-foot">
                    <span className={`badge ${STATUS_CLS[row.status] || ''}`}>{t(`support.status.${row.status}`)}</span>
                    {row.unread > 0 && <span className="badge badge-danger">{t('support.newReply')}</span>}
                    {row.replies > 0 && (
                      <span className="sup-row-notes">
                        <ChatIcon size={12} /> {t('support.repliesCount', { count: row.replies })}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ---------------------------------------------------------- the thread */}
        <div className="mysup-detail">
          {!selected ? (
            <div className="panel sup-blank mysup-pick">
              <span className="icon-badge icon-muted">
                <ChatIcon size={20} />
              </span>
              <p>{t('support.pickOne')}</p>
            </div>
          ) : detailLoading && !detail ? (
            <div className="panel">
              <SkeletonTable rows={4} cols={1} />
            </div>
          ) : !ticket ? null : (
            <div className="panel sup-ticket mysup-thread-panel">
              <div className="mysup-thread-head">
                <button type="button" className="mysup-back" onClick={() => choose(null)} aria-label={t('support.back')}>
                  <ArrowLeftIcon size={16} />
                </button>
                <div className="mysup-thread-title">
                  <h2>{t(`support.topics.${ticket.topic}`)}</h2>
                  <p>
                    {t('support.refShort')} {ticket.ref} · {formatDateTime(ticket.createdAt, lang)}
                  </p>
                </div>
                <div className="mysup-thread-tools">
                  <span className={`badge ${STATUS_CLS[ticket.status] || ''}`}>{t(`support.status.${ticket.status}`)}</span>
                </div>
              </div>

              <div className="sup-thread">
                <div className="sup-bubble is-mine">
                  <div className="sup-bubble-head">
                    <strong>{t('support.you')}</strong>
                    <span className="sup-bubble-when" data-tip={formatDateTime(ticket.createdAt, lang)}>
                      {formatRelativeTime(ticket.createdAt, lang)}
                    </span>
                  </div>
                  <p>{ticket.message}</p>
                </div>
                {thread.map((entry) => (
                  <div key={entry.id} className={`sup-bubble ${entry.by === 'shop' ? 'is-mine' : 'is-team'}`}>
                    <div className="sup-bubble-head">
                      <strong>
                        {entry.by === 'shop'
                          ? t('support.you')
                          : entry.authorName
                            ? `${entry.authorName} · ${t('support.team')}`
                            : t('support.team')}
                      </strong>
                      <span className="sup-bubble-when" data-tip={formatDateTime(entry.at, lang)}>
                        {formatRelativeTime(entry.at, lang)}
                      </span>
                    </div>
                    <p>{entry.text}</p>
                  </div>
                ))}
                {ticket.lastMessageBy === 'shop' && ['open', 'working'].includes(ticket.status) && detail.hours && (
                  <p className="sup-seen">
                    <ClockIcon size={13} /> {detail.hours}
                  </p>
                )}
                <div ref={threadEndRef} />
              </div>

              {/* Where to go to actually fix it — right above the reply box, where the next
                  move is decided. Says who is pointing him there, because "support told me
                  to" and "problems like this usually live here" deserve different trust. */}
              {fixReachable && ticket.status !== 'closed' && (
                <div className={`sup-fix${fix.bySupport ? ' is-support' : ''}`}>
                  <span className="sup-fix-text">
                    {fix.bySupport
                      ? t('support.fixTeamSaid', { module: t(`nav.${fix.item.key}`) })
                      : t('support.fixUsually', { module: t(`nav.${fix.item.key}`) })}
                  </span>
                  <Link href={fix.item.href} className="mysup-jump">
                    {t('support.goToScreen', { module: t(`nav.${fix.item.key}`) })} <ChevronRightIcon size={13} />
                  </Link>
                </div>
              )}

              {/* Support said it is solved — the shop gets the last word on that. */}
              {ticket.status === 'resolved' && (
                <div className="sup-confirm">
                  <p>
                    <CheckCircleIcon size={16} /> {t('support.solvedAsk')}
                  </p>
                  {!notSolved ? (
                    <div className="sup-confirm-actions">
                      <button type="button" className="btn btn-primary btn-small btn-inline" disabled={sending} onClick={() => confirm(true)}>
                        <CheckCircleIcon size={15} /> {t('support.solvedYes')}
                      </button>
                      <button type="button" className="btn btn-secondary btn-small btn-inline" disabled={sending} onClick={() => setNotSolved(true)}>
                        {t('support.solvedNo')}
                      </button>
                    </div>
                  ) : (
                    <div className="sup-compose">
                      <textarea
                        rows={2}
                        value={notSolvedText}
                        maxLength={4000}
                        onChange={(event) => setNotSolvedText(event.target.value)}
                        placeholder={t('support.solvedNoPlaceholder')}
                        autoFocus
                      />
                      <div className="sup-confirm-actions">
                        <button type="button" className="btn btn-primary btn-small btn-inline" disabled={sending} onClick={() => confirm(false)}>
                          <SendIcon size={15} /> {t('support.solvedNoSend')}
                        </button>
                        <button type="button" className="btn btn-secondary btn-small btn-inline" disabled={sending} onClick={() => setNotSolved(false)}>
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {ticket.status === 'closed' && <p className="sup-resolved">{t('support.closedNote')}</p>}

              {/* While the "solved?" question is up it is the one action on screen. */}
              {ticket.status !== 'resolved' && (
                <form className="sup-compose" onSubmit={sendReply}>
                  <textarea
                    rows={3}
                    value={reply}
                    maxLength={4000}
                    onChange={(event) => setReply(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) sendReply(event);
                    }}
                    placeholder={t('support.replyPlaceholder')}
                  />
                  <div className="sup-note-actions">
                    <span />
                    <button type="submit" className="btn btn-primary btn-small" disabled={sending || !reply.trim()}>
                      <SendIcon size={15} /> {sending ? t('support.replySending') : t('support.replySend')}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
