'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { apiErrorMessage } from '../../../lib/apiErrors';
import { formatRelativeTime, formatDateTime } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { SkeletonTable } from '../../components/Skeleton';
import Dropdown from '../../components/Dropdown';
import { FIX_SCREEN_ITEMS } from '../../../lib/sellerNav';
import { AuditRow } from '../../components/AuditTimeline';
import {
  SearchIcon,
  HeadsetIcon,
  PhoneIcon,
  MailIcon,
  AlertIcon,
  InfoIcon,
  CheckCircleIcon,
  ClockIcon,
  ShopIcon,
  SendIcon,
  CopyIcon,
  XIcon,
  ChevronRightIcon,
  WhatsappIcon,
  RefreshIcon,
  StarIcon,
  ListIcon,
  LockIcon,
  CheckIcon,
  ChatIcon,
} from '../../components/Icons';

// Order of the quick-reply chips; text lives in admin.supportQuick.<key>.
const QUICK_REPLIES = ['looking', 'screenshot', 'fixed', 'plan'];

// How many queue rows "Show more" adds, the most the server returns, and how often an open
// screen checks for new messages.
const PAGE_SIZE = 40;
const MAX_ROWS = 200;
const POLL_MS = 30000;

// The shell's sidebar badge listens for this and refetches (DashboardShell).
function refreshBadge() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('support:badge'));
}

/**
 * Admin -> Support. The screen an operator works from while the phone is ringing.
 *
 * WHY IT IS ONE SCREEN AND NOT A LIST THAT LINKS TO A PAGE. Support is done with a phone
 * against one ear. Every navigation is a place to lose the thread, and a shopkeeper on hold
 * while somebody clicks back and forth is a shopkeeper deciding this app is not worth the
 * trouble. So: a search box that takes whatever the call gave you, a queue down the left,
 * and everything about whoever is selected down the right. Nothing here navigates away
 * except the one link that goes to the shop's full controls.
 *
 * THE PANES ARE NOT SYMMETRICAL ON PURPOSE. The left is a chooser and stays narrow; the
 * right is where the operator reads and writes and gets the room. Below 1100px they stack,
 * chooser first — which is also the order the work happens in.
 */

// wa.me needs a country code and this product's shops are Indian. Mirrors
// normalizeWhatsapp on the server rather than re-deriving the rules — see utils/whatsapp.js.
function waNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

function planLine(shop, t) {
  if (!shop) return '';
  // The effective plan is what the shopkeeper is EXPERIENCING; the billed plan is what he
  // thinks he bought. When they disagree that gap is usually the entire support call, so
  // it is spelled out rather than shown as one word.
  if (shop.plan !== shop.billedPlan) return t('admin.supportPlanChanged', { old: shop.billedPlan, new: shop.plan });
  return shop.plan;
}

export default function AdminSupportPage() {
  const { lang, t } = useLanguage();
  const toast = useToast();

  // Built from `t()` rather than kept as module-level constants, since translated labels
  // have to change when the operator switches language — see the Plans/Overview pages for
  // the same pattern. Cheap object literals, a handful of entries, recomputed every render.
  const TOPIC_ALL = { value: '', label: t('admin.supportAllTopics') };
  const TABS = [
    // First and default: the shop spoke last and nobody has answered. The sidebar badge
    // counts exactly this bucket.
    { value: 'needs_reply', label: t('admin.supportTabNeedsReply') },
    { value: 'open', label: t('admin.supportTabOpen') },
    { value: 'resolved', label: t('admin.supportTabResolved') },
    { value: 'all', label: t('admin.supportTabAll') },
  ];
  const STATUS_META = {
    open: { label: t('admin.supportStatusOpen'), cls: 'badge-pending' },
    working: { label: t('admin.supportStatusWorking'), cls: 'badge-expiring' },
    waiting: { label: t('admin.supportStatusWaiting'), cls: 'badge-inactive' },
    resolved: { label: t('admin.supportStatusResolved'), cls: 'badge-active' },
    closed: { label: t('admin.supportStatusClosed'), cls: 'badge-inactive' },
  };
  const SEVERITY_META = {
    blocked: { icon: AlertIcon, tone: 'danger', label: t('admin.supportSeverityBlocked') },
    warn: { icon: ClockIcon, tone: 'gold', label: t('admin.supportSeverityWarn') },
    info: { icon: InfoIcon, tone: 'muted', label: t('admin.supportSeverityInfo') },
  };
  const searchRef = useRef(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);

  const [tab, setTab] = useState('needs_reply');
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [topic, setTopic] = useState('');
  const [topics, setTopics] = useState([]);
  const [queue, setQueue] = useState(null);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [counts, setCounts] = useState({});
  const [queueLoading, setQueueLoading] = useState(true);
  // One ticket action (status / priority / fix screen) at a time — a double click must not
  // send two PATCHes that race each other.
  const [acting, setActing] = useState(false);
  // Which "recent change" row is expanded to show its from → to.
  const [openAudit, setOpenAudit] = useState(null);
  const threadRef = useRef(null);
  const detailReq = useRef(0);
  const selectionRef = useRef(null);

  const [selection, setSelection] = useState(null); // { kind: 'ticket' | 'shop', id }
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  const [note, setNote] = useState('');
  // 'reply' goes into the shop's own app; 'internal' stays on this screen.
  const [mode, setMode] = useState('reply');
  const [emailCopy, setEmailCopy] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  /* --------------------------------------------------------------------- the queue */

  // `silent === true` for the background refresh: no skeleton, and a failed poll does not
  // throw a banner over a screen that is otherwise working. (The Refresh button passes a
  // click event, which is not `true`, so it loads loudly.)
  const loadQueue = useCallback(
    (silent) => {
      if (silent !== true) setQueueLoading(true);
      const params = new URLSearchParams({ status: tab, pageSize: String(limit) });
      if (topic) params.set('topic', topic);
      if (priorityOnly) params.set('priority', 'high');
      apiFetch(`/api/admin/support/tickets?${params.toString()}`)
        .then((data) => {
          setQueue(data.tickets);
          setTotal(data.total || 0);
          setCounts(data.counts || {});
          if (data.topics) setTopics(data.topics);
          setError('');
        })
        .catch((err) => {
          if (silent !== true) setError(apiErrorMessage(lang, err));
        })
        .finally(() => setQueueLoading(false));
    },
    [tab, topic, priorityOnly, limit]
  );

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  /* -------------------------------------------------------------------- the lookup */

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      return undefined;
    }
    setSearching(true);
    // Debounced like every other server-side search box in the app — a request per
    // keystroke on a phone-number field is ten requests for one number.
    const timer = setTimeout(() => {
      apiFetch(`/api/admin/support/lookup?q=${encodeURIComponent(term)}`)
        .then(setResults)
        .catch((err) => setError(err.message))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  /* -------------------------------------------------------------------- the detail */

  /**
   * Every detail request is numbered and only the newest may write the screen. Before this,
   * clicking ticket B while A was still loading could land A's response last — and the
   * composer under it would then post the reply the operator typed for B onto A.
   */
  const loadDetail = useCallback((next, { silent = false } = {}) => {
    const reqId = ++detailReq.current;
    if (!next) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    if (!silent) setDetailLoading(true);
    const url =
      next.kind === 'ticket'
        ? `/api/admin/support/tickets/${next.id}`
        : `/api/admin/support/shops/${next.id}`;
    apiFetch(url)
      .then((data) => {
        if (reqId !== detailReq.current) return;
        setDetail(data);
        setError('');
      })
      .catch((err) => {
        if (reqId !== detailReq.current || silent) return;
        setError(apiErrorMessage(lang, err));
        setDetail(null);
      })
      .finally(() => {
        if (reqId === detailReq.current) setDetailLoading(false);
      });
  }, []);

  selectionRef.current = selection;
  const selectionKey = selection ? `${selection.kind}:${selection.id}` : '';

  // A different ticket clears the old one at once — never show (or reply under) the previous
  // ticket while the next one loads.
  useEffect(() => {
    setDetail(null);
    loadDetail(selectionRef.current);
  }, [selectionKey, loadDetail]);

  /**
   * The conversation is live. While the tab is visible the queue and the open ticket refresh
   * every 30s, quietly — so a shopkeeper's "abhi bhi nahi hua" appears without the operator
   * pressing Refresh, and the composer he is typing in is left alone.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadQueue(true);
      if (selectionRef.current) loadDetail(selectionRef.current, { silent: true });
      refreshBadge();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadQueue, loadDetail]);

  // Open on the newest message, and follow new ones as they arrive.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [detail?.ticket?.id, detail?.ticket?.notes?.length]);

  /**
   * A refreshed URL must land back on the same shop.
   *
   * Read off `window.location` in an effect rather than through `useSearchParams`, so this
   * page needs no Suspense boundary for one optional param — the same call /admin/sellers
   * and /admin/audit already make.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const search = new URLSearchParams(window.location.search);
    const ticket = search.get('ticket');
    const shop = search.get('shop');
    if (ticket) setSelection({ kind: 'ticket', id: ticket });
    else if (shop) setSelection({ kind: 'shop', id: shop });
  }, []);

  /**
   * The cursor starts in the search box, because there is exactly one reason to open this
   * screen and it is to type a number into that box. An operator with a phone against one
   * ear should not have to find and click a field first.
   */
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  function select(kind, id) {
    setSelection({ kind, id });
    setNote('');
    setMode('reply');
    setEmailCopy(false);
    // The server clears the unread count when the ticket opens; mirror it in the row.
    if (kind === 'ticket') {
      setQueue((prev) => prev?.map((row) => (row.id === id ? { ...row, adminUnread: 0 } : row)));
    }
    if (typeof window !== 'undefined') {
      const url = `${window.location.pathname}?${kind}=${encodeURIComponent(id)}`;
      window.history.replaceState(null, '', url);
    }
  }

  /* ------------------------------------------------------------------- the actions */

  // The one path every ticket lever takes: one at a time, then refresh detail, queue and badge
  // together so the three can never disagree about the ticket's state.
  async function patchTicket(body, successMessage) {
    if (!detail?.ticket || acting) return;
    setActing(true);
    try {
      await apiFetch(`/api/admin/support/tickets/${detail.ticket.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (successMessage) toast.success(successMessage);
      loadDetail(selectionRef.current, { silent: true });
      loadQueue(true);
      refreshBadge();
    } catch (err) {
      toast.error(apiErrorMessage(lang, err));
    } finally {
      setActing(false);
    }
  }

  function setStatus(status) {
    if (detail?.ticket?.status === status) return;
    patchTicket({ status }, t('admin.supportTicketUpdated', { status: STATUS_META[status]?.label || status }));
  }

  function setFixScreen(fixScreen) {
    if ((detail?.ticket?.fixScreen || '') === fixScreen) return;
    patchTicket({ fixScreen }, fixScreen ? t('admin.supportFixScreenSaved', { module: t(`nav.${fixScreen}`) }) : '');
  }

  function setPriority(priority) {
    patchTicket({ priority });
  }

  /**
   * One composer, two kinds of writing. A reply lands in the shop's own Support screen (and,
   * if ticked, its inbox); an internal note never leaves this screen. `statusAfter` is the
   * "Send & mark solved" shortcut — the commonest last move on a ticket, in one press.
   */
  async function sendNote(statusAfter) {
    if (!detail?.ticket || !note.trim() || savingNote) return;
    setSavingNote(true);
    const isReply = mode === 'reply';
    try {
      const body = { text: note.trim(), mode, sendToShop: isReply && emailCopy };
      if (statusAfter) body.status = statusAfter;
      const res = await apiFetch(`/api/admin/support/tickets/${detail.ticket.id}/notes`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setNote('');
      setEmailCopy(false);
      // The reply is in the shop's app either way; only the email copy can have failed.
      if (res.sendError) toast.error(t('admin.supportReplySentMailFailed', { error: res.sendError }));
      else toast.success(isReply ? t('admin.supportReplySent') : t('admin.supportNoteSaved'));
      loadDetail(selectionRef.current, { silent: true });
      loadQueue(true);
      refreshBadge();
    } catch (err) {
      toast.error(apiErrorMessage(lang, err));
    } finally {
      setSavingNote(false);
    }
  }

  function copy(value, what) {
    if (!value) return;
    navigator.clipboard?.writeText(String(value));
    toast.success(t('admin.supportCopied', { what }));
  }

  /**
   * A diagnosis finding in the operator's language.
   *
   * The server sends a stable `key` plus the numbers (`params`); the sentence comes from
   * admin.diag.<key> here. Its English `title`/`detail`/`fix.label` are only the fallback for
   * a finding that has no translation yet — `t` hands back the path itself when a key is
   * missing, which is how that case is recognised.
   */
  function diagText(finding, field) {
    const id = finding.key.startsWith('meter.') ? 'meter' : finding.key.replace('.', '_');
    const p = finding.params || {};
    const params = {
      ...p,
      when: p.days > 0 ? t('admin.diag.inDays', { days: p.days }) : t('admin.diag.today'),
      ago: p.days > 0 ? t('admin.diag.daysAgo', { days: p.days }) : t('admin.diag.today'),
      usage: p.limit === null || p.limit === undefined ? p.used : t('admin.diag.usedOf', { used: p.used, limit: p.limit }),
    };
    let variant = field;
    if (id === 'account_suspended' && field === 'detail' && p.reason) variant = 'detailReason';
    if (id === 'account_notApproved' && field !== 'fix' && p.rejected) variant = `${field}Rejected`;
    if (id === 'payment_stuck' && field === 'title' && p.failed) variant = 'titleFailed';
    if (id === 'payment_stuck' && field === 'detail' && p.paymentId) variant = 'detailPaymentId';
    const path = `admin.diag.${id}.${variant}`;
    const out = t(path, params);
    if (out !== path) return out;
    return field === 'fix' ? finding.fix?.label : finding[field];
  }

  const fixScreenOptions = [
    { value: '', label: t('admin.supportFixScreenAuto') },
    ...FIX_SCREEN_ITEMS.map((item) => ({ value: item.key, label: t(`nav.${item.key}`) })),
  ];

  const topicOptions = useMemo(
    // Labels from the operator's language pack, not the server's English list.
    () => [TOPIC_ALL, ...topics.map((entry) => ({ value: entry.value, label: t(`support.topics.${entry.value}`) }))],
    // `lang` too: the "All topics" label must follow a language switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topics, lang]
  );

  const hasQuery = query.trim().length >= 2;
  const shop = detail?.shop;
  const ticket = detail?.ticket;
  const findings = detail?.diagnosis?.findings || [];

  return (
    <>
      <div className="content-header">
        <h1>{t('admin.supportTitle')}</h1>
        <p>{t('admin.supportSubtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* ------------------------------------------------------------------ lookup */}
      <div className="panel sup-find">
        <div className="sup-find-box">
          <SearchIcon size={18} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('admin.supportSearchPlaceholder')}
            aria-label={t('admin.supportSearchAriaLabel')}
            autoComplete="off"
          />
          {query && (
            <button type="button" className="sup-find-clear" onClick={() => setQuery('')} data-tip={t('admin.supportClear')}>
              <XIcon size={15} />
            </button>
          )}
        </div>
        <p className="sup-find-hint">
          {t('admin.supportHintPrefix')} <code>+91 98765 43210</code>,{' '}
          <code>098765-43210</code> {t('admin.and')} <code>9876543210</code> {t('admin.supportHintSuffix')}
        </p>

        {hasQuery && (
          <div className="sup-find-results">
            {searching && !results ? (
              <p className="empty-state">{t('admin.supportSearching')}</p>
            ) : !results || (!results.shops.length && !results.tickets.length) ? (
              <p className="empty-state">{t('admin.supportNoMatch')}</p>
            ) : (
              <>
                {results.shops.map((row) => (
                  <button
                    type="button"
                    key={row.id}
                    className={`sup-hit${selection?.id === row.id ? ' is-on' : ''}`}
                    onClick={() => select('shop', row.id)}
                  >
                    <span className="icon-badge icon-brand">
                      <ShopIcon size={15} />
                    </span>
                    <span className="sup-hit-main">
                      <strong>{row.shopName || row.name || t('admin.supportUnnamedShop')}</strong>
                      <span className="sup-hit-sub">
                        {[row.shopPhone, row.email].filter(Boolean).join(' · ') || t('admin.supportNoContact')}
                      </span>
                    </span>
                    <span className={`badge ${row.isActive ? 'badge-active' : 'badge-danger'}`}>
                      {planLine(row, t)}
                    </span>
                    <ChevronRightIcon size={15} />
                  </button>
                ))}
                {results.tickets.map((row) => (
                  <button
                    type="button"
                    key={row.id}
                    className={`sup-hit${selection?.id === row.id ? ' is-on' : ''}`}
                    onClick={() => select('ticket', row.id)}
                  >
                    <span className="icon-badge icon-gold">
                      <HeadsetIcon size={15} />
                    </span>
                    <span className="sup-hit-main">
                      <strong>{row.ref}</strong>
                      <span className="sup-hit-sub">
                        {row.shopName || row.snapshot?.shopName || '—'} · {t(`support.topics.${row.topic}`)}
                      </span>
                    </span>
                    <span className={`badge ${STATUS_META[row.status]?.cls || ''}`}>
                      {STATUS_META[row.status]?.label || row.status}
                    </span>
                    <ChevronRightIcon size={15} />
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <div className="sup-layout">
        {/* ------------------------------------------------------------- the queue */}
        <div className="panel sup-queue">
          <div className="panel-head">
            <div className="section-title">
              <span className="icon-badge icon-muted">
                <ListIcon size={15} />
              </span>
              <h2>{t('admin.supportQueueTitle')}</h2>
            </div>
            <button type="button" className="btn-inline btn-small" onClick={loadQueue} data-tip={t('common.refresh')}>
              <RefreshIcon size={15} />
            </button>
          </div>

          {/**
           * The one alarm on this screen. A ticket whose mail never left is the only kind
           * nobody else knows about — no inbox has it, no operator was told. It gets its
           * own line above the queue rather than a badge inside it.
           */}
          {/* The three numbers an operator starts the day on — each one opens its own list. */}
          <div className="sup-kpis">
            <button
              type="button"
              className={`sup-kpi is-reply${tab === 'needs_reply' && !priorityOnly ? ' is-on' : ''}`}
              onClick={() => {
                setTab('needs_reply');
                setPriorityOnly(false);
              }}
            >
              <strong>{counts.needsReply || 0}</strong>
              <span>{t('admin.supportKpiNeedsReply')}</span>
            </button>
            <button
              type="button"
              className={`sup-kpi${tab === 'open' && !priorityOnly ? ' is-on' : ''}`}
              onClick={() => {
                setTab('open');
                setPriorityOnly(false);
              }}
            >
              <strong>{counts.open || 0}</strong>
              <span>{t('admin.supportKpiOpen')}</span>
            </button>
            <button
              type="button"
              className={`sup-kpi${priorityOnly ? ' is-on' : ''}`}
              onClick={() => {
                setTab('open');
                setPriorityOnly(true);
              }}
            >
              <strong>{counts.highOpen || 0}</strong>
              <span>{t('admin.supportKpiHigh')}</span>
            </button>
          </div>

          {counts.undelivered > 0 && (
            <div className="sup-alarm">
              <AlertIcon size={16} />
              <span>{t('admin.supportUndelivered', { count: counts.undelivered })}</span>
            </div>
          )}

          <div className="sup-tabs">
            {TABS.map((entry) => (
              <button
                type="button"
                key={entry.value}
                className={`sup-tab${tab === entry.value && !priorityOnly ? ' is-on' : ''}`}
                onClick={() => {
                  setTab(entry.value);
                  setPriorityOnly(false);
                }}
              >
                {entry.label}
                {entry.value === 'needs_reply' && counts.needsReply > 0 && (
                  <span className="sup-tab-n">{counts.needsReply}</span>
                )}
                {entry.value === 'open' && counts.open > 0 && <span className="sup-tab-n">{counts.open}</span>}
              </button>
            ))}
            <Dropdown className="filter-select sup-tab-topic" value={topic} onChange={setTopic} options={topicOptions} />
          </div>

          {queueLoading && !queue ? (
            <SkeletonTable rows={6} cols={2} />
          ) : !queue || !queue.length ? (
            <p className="empty-state">
              {tab === 'open' || tab === 'needs_reply' ? t('admin.supportQueueEmptyOpen') : t('admin.supportQueueEmptyOther')}
            </p>
          ) : (
            <div className="sup-list">
              {queue.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  className={`sup-row${selection?.id === row.id ? ' is-on' : ''}${
                    row.priority === 'high' ? ' is-hot' : ''
                  }`}
                  onClick={() => select('ticket', row.id)}
                >
                  <div className="sup-row-top">
                    <strong>
                      {row.adminUnread > 0 && <span className="sup-dot" aria-hidden="true" />}
                      {row.shopName || row.snapshot?.shopName || t('admin.supportDeletedShop')}
                    </strong>
                    <span className="sup-row-when" data-tip={formatDateTime(row.lastMessageAt || row.createdAt, lang)}>
                      {formatRelativeTime(row.lastMessageAt || row.createdAt, lang)}
                    </span>
                  </div>
                  <p className="sup-row-msg">{row.message}</p>
                  <div className="sup-row-foot">
                    <span className="badge">{t(`support.topics.${row.topic}`)}</span>
                    {/* Who owes the next move, in words, instead of a raw status. */}
                    {row.needsReply ? (
                      <span className="badge badge-pending">{t('admin.supportNeedsReplyBadge')}</span>
                    ) : row.status === 'waiting' ? (
                      <span className="badge badge-inactive">{t('admin.supportAwaitingShop')}</span>
                    ) : (
                      <span className={`badge ${STATUS_META[row.status]?.cls || ''}`}>
                        {STATUS_META[row.status]?.label || row.status}
                      </span>
                    )}
                    {row.adminUnread > 0 && (
                      <span className="badge badge-danger">{t('admin.supportNewBadge', { count: row.adminUnread })}</span>
                    )}
                    {!row.mailDelivered && <span className="badge badge-danger">{t('admin.supportMailFailed')}</span>}
                    {row.noteCount > 0 && (
                      <span className="sup-row-notes">
                        <ChatIcon size={12} /> {row.noteCount}
                      </span>
                    )}
                  </div>
                </button>
              ))}
              {/* The queue used to stop silently at 40 — ticket 41 simply did not exist. */}
              {total > queue.length && limit < MAX_ROWS && (
                <button
                  type="button"
                  className="sup-more"
                  disabled={queueLoading}
                  onClick={() => setLimit((n) => Math.min(n + PAGE_SIZE, MAX_ROWS))}
                >
                  {t('admin.supportLoadMore', { count: total - queue.length })}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------ the detail */}
        <div className="sup-detail">
          {!selection ? (
            <div className="panel sup-blank">
              <span className="icon-badge icon-muted">
                <HeadsetIcon size={20} />
              </span>
              <h2>{t('admin.supportPickOne')}</h2>
              <p>{t('admin.supportPickOneHint')}</p>
            </div>
          ) : detailLoading && !detail ? (
            <div className="panel">
              <SkeletonTable rows={5} cols={2} />
            </div>
          ) : !detail ? null : (
            <>
              {/* ---------------------------------------------- who is on the phone */}
              {shop ? (
                <div className="panel sup-who">
                  <div className="sup-who-top">
                    <div>
                      <h2>{shop.shopName || shop.name || t('admin.supportUnnamedShop')}</h2>
                      <p className="sup-who-sub">
                        {shop.name}
                        {shop.businessType ? ` · ${shop.businessType}` : ''} ·{' '}
                        {t('admin.supportMemberSince', { date: formatDateTime(shop.createdAt, lang) })}
                      </p>
                    </div>
                    <Link href={`/admin/sellers/${shop.id}`} className="btn btn-secondary btn-small">
                      {t('admin.supportFullControls')}
                    </Link>
                  </div>

                  <div className="sup-who-chips">
                    <span className={`badge ${shop.isActive ? 'badge-active' : 'badge-danger'}`}>
                      {shop.isActive ? t('admin.supportShopActive') : t('admin.supportShopSuspended')}
                    </span>
                    <span className="badge">{planLine(shop, t)}</span>
                    {shop.emailVerified === false && <span className="badge badge-expiring">{t('admin.supportEmailUnverified')}</span>}
                    <span className="badge badge-inactive">
                      {shop.lastBillAt
                        ? t('admin.supportLastBill', { time: formatRelativeTime(shop.lastBillAt, lang) })
                        : t('admin.supportNoBillEver')}
                    </span>
                  </div>

                  {/**
                   * The three ways to reach him, as things you press rather than things you
                   * read. An operator who has to select-and-copy a phone number off a page
                   * mid-call is an operator who mis-dials.
                   */}
                  <div className="sup-reach">
                    {shop.shopPhone && (
                      <>
                        <a className="sup-reach-item" href={`tel:${shop.shopPhone}`}>
                          <PhoneIcon size={15} /> {shop.shopPhone}
                        </a>
                        <a
                          className="sup-reach-item"
                          href={`https://wa.me/${waNumber(shop.shopPhone)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <WhatsappIcon size={17} /> WhatsApp
                        </a>
                      </>
                    )}
                    {shop.email && (
                      <button type="button" className="sup-reach-item" onClick={() => copy(shop.email, t('admin.supportEmailLabel'))}>
                        <MailIcon size={15} /> {shop.email} <CopyIcon size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="panel sup-blank">
                  <h2>{t('admin.supportShopGone')}</h2>
                  <p>{t('admin.supportShopGoneHint')}</p>
                </div>
              )}

              {/* ------------------------------------------------------- diagnosis */}
              <div className="panel sup-diag">
                <div className="section-title">
                  <span className="icon-badge icon-gold">
                    <AlertIcon size={15} />
                  </span>
                  <h2>{t('admin.supportDiagTitle')}</h2>
                </div>
                <p className="section-note">{t('admin.supportDiagNote')}</p>

                {!findings.length ? (
                  <div className="sup-clean">
                    <span className="icon-badge icon-success">
                      <CheckCircleIcon size={16} />
                    </span>
                    <div>
                      <strong>{t('admin.supportDiagClean')}</strong>
                      <p>{t('admin.supportDiagCleanHint')}</p>
                    </div>
                  </div>
                ) : (
                  <div className="sup-findings">
                    {findings.map((finding) => {
                      const meta = SEVERITY_META[finding.severity] || SEVERITY_META.info;
                      const FindingIcon = meta.icon;
                      return (
                        <div key={finding.key} className={`sup-finding is-${finding.severity}`}>
                          <span className={`icon-badge icon-${meta.tone}`}>
                            <FindingIcon size={15} />
                          </span>
                          <div className="sup-finding-body">
                            <strong>{diagText(finding, 'title')}</strong>
                            <p>{diagText(finding, 'detail')}</p>
                            {finding.fix && shop && (
                              <Link href={`/admin/sellers/${shop.id}`} className="sup-finding-fix">
                                {diagText(finding, 'fix')} <ChevronRightIcon size={13} />
                              </Link>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ---------------------------------------------------- the ticket */}
              {ticket && (
                <div className="panel sup-ticket">
                  <div className="panel-head">
                    <div className="section-title">
                      <span className="icon-badge icon-brand">
                        <HeadsetIcon size={15} />
                      </span>
                      <h2>{ticket.ref}</h2>
                    </div>
                    <div className="panel-tools">
                      <button
                        type="button"
                        className={`btn-inline btn-small${ticket.priority === 'high' ? ' is-on' : ''}`}
                        disabled={acting}
                        onClick={() => setPriority(ticket.priority === 'high' ? 'normal' : 'high')}
                      >
                        <StarIcon size={15} />{' '}
                        {ticket.priority === 'high' ? t('admin.supportPriorityOn') : t('admin.supportPriorityOff')}
                      </button>
                      <button type="button" className="btn-inline btn-small" onClick={() => copy(ticket.ref, t('admin.supportRefLabel'))}>
                        <CopyIcon size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="sup-msg">
                    <div className="sup-msg-foot">
                      <span className="badge">{t(`support.topics.${ticket.topic}`)}</span>
                      {/**
                       * The plan AT THE TIME, not now. A complaint made on a lapsed plan and
                       * read back after somebody granted a new one is a different complaint,
                       * and a record that quietly rewrites itself argues with the shopkeeper.
                       */}
                      {ticket.snapshot?.plan && (
                        <span className="badge badge-inactive">{t('admin.supportPlanAtTime', { plan: ticket.snapshot.plan })}</span>
                      )}
                      {ticket.context?.page && <span className="badge badge-inactive">{ticket.context.page}</span>}
                      {ticket.context?.screen && <span className="badge badge-inactive">{ticket.context.screen}</span>}
                      {ticket.callbackPhone && (
                        <a className="badge badge-active" href={`tel:${ticket.callbackPhone}`}>
                          {t('admin.supportCallback', { phone: ticket.callbackPhone })}
                        </a>
                      )}
                      {!ticket.mailDelivered && <span className="badge badge-danger">{t('admin.supportMailFailed')}</span>}
                      {ticket.shopConfirmed === 'yes' && (
                        <span className="badge badge-active">{t('admin.supportShopSaidSolved')}</span>
                      )}
                      {ticket.shopConfirmed === 'no' && (
                        <span className="badge badge-danger">{t('admin.supportShopSaidNotSolved')}</span>
                      )}
                    </div>
                  </div>

                  <div className="sup-status-row" role="group" aria-label={t('admin.supportStatusLabel')}>
                    <span className="sup-status-label">{t('admin.supportStatusLabel')}</span>
                    {Object.entries(STATUS_META).map(([value, meta]) => (
                      <button
                        type="button"
                        key={value}
                        className={`sup-status${ticket.status === value ? ' is-on' : ''}`}
                        aria-pressed={ticket.status === value}
                        disabled={acting}
                        onClick={() => setStatus(value)}
                      >
                        {meta.label}
                      </button>
                    ))}
                  </div>

                  {/* Where the shop should go to fix it — becomes an "Open …" button on its
                      own support page. Auto = the topic's module, or no button for vague topics. */}
                  <div className="sup-fix-row">
                    <span className="sup-status-label">{t('admin.supportFixScreen')}</span>
                    <Dropdown
                      className="filter-select"
                      value={ticket.fixScreen || ''}
                      onChange={setFixScreen}
                      options={fixScreenOptions}
                    />
                    <span className="sup-fix-hint">{t('admin.supportFixScreenHint')}</span>
                  </div>

                  {ticket.resolvedAt && (
                    <p className="sup-resolved">
                      {t('admin.supportResolvedLine', {
                        name: ticket.resolvedByName || t('admin.supportSomeone'),
                        time: formatRelativeTime(ticket.resolvedAt, lang),
                      })}
                    </p>
                  )}

                  {/* ------------------------------------------- the conversation */}
                  <div className="sup-thread" ref={threadRef} aria-label={t('admin.supportThreadTitle')}>
                    <div className="sup-bubble is-shop">
                      <div className="sup-bubble-head">
                        <strong>{ticket.writerName || t('admin.supportUnknownWriter')}</strong>
                        {ticket.writerRole === 'staff' && (
                          <span className="badge badge-inactive">{t('admin.supportStaffBadge')}</span>
                        )}
                        <span className="sup-bubble-when" data-tip={formatDateTime(ticket.createdAt, lang)}>
                          {formatRelativeTime(ticket.createdAt, lang)}
                        </span>
                      </div>
                      <p>{ticket.message}</p>
                    </div>
                    {ticket.notes?.map((entry) => {
                      const side = entry.by === 'shop' ? 'is-shop' : entry.visibleToShop ? 'is-admin' : 'is-internal';
                      return (
                        <div key={entry.id} className={`sup-bubble ${side}`}>
                          <div className="sup-bubble-head">
                            <strong>
                              {entry.by === 'shop'
                                ? entry.authorName || t('admin.supportShopLabel')
                                : entry.authorName || t('admin.supportAdminFallback')}
                            </strong>
                            {!entry.visibleToShop && (
                              <span className="sup-bubble-tag">
                                <LockIcon size={11} /> {t('admin.supportInternalTag')}
                              </span>
                            )}
                            {entry.sentToShop && (
                              <span className="sup-bubble-tag">
                                <MailIcon size={11} /> {t('admin.supportEmailedTag')}
                              </span>
                            )}
                            <span className="sup-bubble-when" data-tip={formatDateTime(entry.at, lang)}>
                              {formatRelativeTime(entry.at, lang)}
                            </span>
                          </div>
                          <p>{entry.text}</p>
                        </div>
                      );
                    })}
                    {ticket.lastMessageBy === 'admin' && (
                      <p className="sup-seen">
                        {ticket.shopUnread ? (
                          t('admin.supportNotSeenYet')
                        ) : (
                          <>
                            <CheckIcon size={13} /> {t('admin.supportSeenByShop')}
                          </>
                        )}
                      </p>
                    )}
                  </div>

                  <form
                    className={`sup-compose is-${mode}`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      sendNote();
                    }}
                  >
                    <div className="sup-mode" role="tablist">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={mode === 'reply'}
                        className={`sup-mode-opt${mode === 'reply' ? ' is-on' : ''}`}
                        onClick={() => setMode('reply')}
                      >
                        <SendIcon size={14} /> {t('admin.supportModeReply')}
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={mode === 'internal'}
                        className={`sup-mode-opt${mode === 'internal' ? ' is-on' : ''}`}
                        onClick={() => setMode('internal')}
                      >
                        <LockIcon size={14} /> {t('admin.supportModeInternal')}
                      </button>
                    </div>
                    <p className="sup-compose-hint">
                      {mode === 'reply' ? t('admin.supportModeReplyHint') : t('admin.supportModeInternalHint')}
                    </p>

                    {mode === 'reply' && (
                      <div className="sup-quick" aria-label={t('admin.supportQuickReplies')}>
                        {QUICK_REPLIES.map((key) => (
                          <button
                            type="button"
                            key={key}
                            className="chip-toggle"
                            onClick={() => {
                              const text = t(`admin.supportQuick.${key}`);
                              setNote((prev) => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
                            }}
                          >
                            {t(`admin.supportQuick.${key}Label`)}
                          </button>
                        ))}
                      </div>
                    )}

                    <textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          sendNote();
                        }
                      }}
                      rows={3}
                      placeholder={mode === 'reply' ? t('admin.supportReplyPlaceholder') : t('admin.supportNotePlaceholder')}
                    />
                    <div className="sup-note-actions">
                      {mode === 'reply' && ticket.writerEmail ? (
                        <label className="sup-note-send">
                          <input
                            type="checkbox"
                            checked={emailCopy}
                            onChange={(event) => setEmailCopy(event.target.checked)}
                          />
                          <span>
                            {t('admin.supportEmailCopy')} ({ticket.writerEmail})
                          </span>
                        </label>
                      ) : (
                        <span />
                      )}
                      <div className="sup-compose-btns">
                        {mode === 'reply' ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-secondary btn-small"
                              disabled={savingNote || !note.trim()}
                              onClick={() => sendNote('resolved')}
                            >
                              <CheckCircleIcon size={15} /> {t('admin.supportReplyAndSolve')}
                            </button>
                            <button type="submit" className="btn btn-primary btn-small" disabled={savingNote || !note.trim()}>
                              <SendIcon size={15} /> {savingNote ? t('admin.supportSaving') : t('admin.supportSendReply')}
                            </button>
                          </>
                        ) : (
                          <button type="submit" className="btn btn-secondary btn-small" disabled={savingNote || !note.trim()}>
                            <LockIcon size={15} /> {savingNote ? t('admin.supportSaving') : t('admin.supportSaveNote')}
                          </button>
                        )}
                      </div>
                    </div>
                  </form>
                </div>
              )}

              {/* ------------------------------------ what changed on this shop lately
                  Rendered with the Activity screen's own AuditRow, so every row reads as
                  words ("Plan changed", "Modules changed") with a from → to when opened —
                  it used to print raw codes like "admin.support.note". Always shown for a
                  live shop: "nothing changed" is itself an answer, it rules us out. */}
              {shop && (
                <div className="panel sup-trail">
                  <div className="sup-trail-head">
                    <div className="section-title">
                      <span className="icon-badge icon-muted">
                        <ClockIcon size={15} />
                      </span>
                      <h2>{t('admin.supportTrailTitle')}</h2>
                    </div>
                    <Link href={`/admin/sellers/${shop.id}`} className="sup-finding-fix">
                      {t('admin.supportTrailAll')} <ChevronRightIcon size={13} />
                    </Link>
                  </div>
                  <p className="section-note">{t('admin.supportTrailNote')}</p>
                  {!detail.adminActions?.length ? (
                    <div className="sup-clean">
                      <span className="icon-badge icon-success">
                        <CheckCircleIcon size={16} />
                      </span>
                      <p>{t('admin.supportTrailEmpty')}</p>
                    </div>
                  ) : (
                    <div className="audit-day">
                      <ul>
                        {detail.adminActions.map((entry) => (
                          <AuditRow
                            key={entry._id}
                            entry={entry}
                            inShop
                            open={openAudit === entry._id}
                            onToggle={() => setOpenAudit((id) => (id === entry._id ? null : entry._id))}
                            onOnlyShop={() => {}}
                            onCopy={(text) => copy(text, t('admin.supportTrailCopied'))}
                          />
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* --------------------------------------------- has he written before */}
              {detail.history?.length > 0 && (
                <div className="panel sup-history">
                  <div className="section-title">
                    <span className="icon-badge icon-muted">
                      <HeadsetIcon size={15} />
                    </span>
                    <h2>{t('admin.supportHistoryTitle', { count: detail.history.length })}</h2>
                  </div>
                  <div className="sup-list">
                    {detail.history.map((row) => (
                      <button type="button" key={row.id} className="sup-row" onClick={() => select('ticket', row.id)}>
                        <div className="sup-row-top">
                          <strong>{row.ref}</strong>
                          <span className="sup-row-when">{formatRelativeTime(row.createdAt, lang)}</span>
                        </div>
                        <p className="sup-row-msg">{row.message}</p>
                        <div className="sup-row-foot">
                          <span className="badge">{t(`support.topics.${row.topic}`)}</span>
                          <span className={`badge ${STATUS_META[row.status]?.cls || ''}`}>
                            {STATUS_META[row.status]?.label || row.status}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
