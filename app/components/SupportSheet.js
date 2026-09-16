'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { apiErrorMessage } from '../../lib/apiErrors';
import { useToast } from './Toast';
import Modal from './Modal';
import PhoneField from './PhoneField';
import {
  WhatsappIcon,
  MailIcon,
  PhoneIcon,
  SendIcon,
  SpinnerIcon,
  CheckCircleIcon,
  CopyIcon,
  CheckIcon,
  ChevronDownIcon,
  AlertIcon,
  ClockIcon,
  ChatIcon,
} from './Icons';

/**
 * The support sheet — what the lifebuoy in the topbar opens.
 *
 * The problem it exists to solve is not "there is no way to contact us". There was one: a
 * `mailto:` at the bottom of the plan screen, four clicks deep, on the one screen a
 * shopkeeper only opens when he is thinking about money. The problem is that a shop whose
 * counter has just stopped printing has to STOP, leave the app, find an address, and
 * compose a mail that begins by explaining who he is — and most of them simply don't. They
 * put the phone down and the shop goes quiet.
 *
 * So the sheet is built around three decisions:
 *
 * ONE, TWO DOORS, and the shop picks the one it already lives in. WhatsApp is not a
 * fallback here, it is the front door: it is where an Indian kirana's whole day already
 * happens, and it costs the shopkeeper nothing to learn. Mail is the door for anything with
 * a screenshot, a bill or a long story behind it. The picker is two big tiles rather than a
 * dropdown, because this is a choice a shopkeeper makes with his thumb.
 *
 * TWO, HE TYPES THE PROBLEM AND NOTHING ELSE. Shop name, plan, trade, which screen he was
 * on, which browser — every one of those is attached by the server from the session (see
 * backend/controllers/supportController.js). Asking a stuck shopkeeper for his plan name is
 * asking him to do our filing.
 *
 * THREE, NO DEAD ENDS. A `wa.me` link OPENS a chat, it never sends one — so the success
 * state says exactly that, in as many words, rather than claiming a message went. And if
 * our own mail sending is down, the refusal comes back carrying the address and the
 * reference, and the sheet turns them into a working `mailto:` and a copy button. The one
 * screen whose entire job is reaching a human must never be the screen that fails silently.
 */

// Order matters — this is the order a shopkeeper's problems actually arrive in, most
// common first, with "something is broken" and "an idea" at the end where they belong.
// The ids are the contract with the server; the labels are looked up per language.
const TOPICS = ['billing', 'stock', 'khata', 'purchase', 'plan', 'data', 'bug', 'idea', 'other'];

// Matches MIN_MESSAGE on the server. Checked here too so a one-word message is caught
// before it costs a round trip — and, on the WhatsApp path, so the chat never opens with
// an empty box the shopkeeper has to fill in twice.
const MIN_MESSAGE = 10;
const MAX_MESSAGE = 4000;

/** Which screen he was on, in words support can read, not a raw pathname. */
function screenSize() {
  if (typeof window === 'undefined') return '';
  return `${window.innerWidth}x${window.innerHeight}`;
}

export default function SupportSheet({ user, initialTopic = '', onClose }) {
  const { t, lang } = useLanguage();
  const toast = useToast();

  const [channels, setChannels] = useState(null);
  const [channel, setChannel] = useState('');
  const [topic, setTopic] = useState(initialTopic || '');
  const [message, setMessage] = useState('');
  const [callbackPhone, setCallbackPhone] = useState(user?.shopPhone || '');
  const [showContext, setShowContext] = useState(false);
  const [busy, setBusy] = useState(false);
  // One of: null | { kind: 'email', ref } | { kind: 'whatsapp' } | { kind: 'failed', ref, email }
  const [done, setDone] = useState(null);
  // Which thing was last copied ('ref' | 'message'), so the tick appears on the button
  // that was actually pressed — one shared boolean put it on both.
  const [copied, setCopied] = useState('');

  const messageRef = useRef(null);
  const pageRef = useRef('');

  // Captured on mount, not on submit: by the time he has typed three lines the router may
  // have moved on, and the screen support needs to know about is the one he opened the
  // sheet from.
  useEffect(() => {
    if (typeof window !== 'undefined') pageRef.current = window.location.pathname;
  }, []);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/seller/support/channels')
      .then((data) => {
        if (!alive) return;
        setChannels(data);
        // WhatsApp wins the default wherever it is staffed — it is the channel with the
        // shortest distance between "something is wrong" and a human reading it.
        setChannel(data.whatsapp ? 'whatsapp' : 'email');
      })
      .catch(() => {
        // The channel list failing must not take the sheet down with it. Mail always
        // exists; the address is the server's default and the send route is the same.
        if (!alive) return;
        setChannels({ email: '', whatsapp: null, phone: null, hours: null });
        setChannel('email');
      });
    return () => { alive = false; };
  }, []);

  const supportEmail = channels?.email || '';
  const waReady = Boolean(channels?.whatsapp);

  /** Scroll to the message box and flash it — the shared "here is the fix" gesture. */
  function pointAtMessage() {
    const box = messageRef.current;
    if (!box) return;
    box.focus();
    const field = box.closest('.field');
    if (!field) return;
    field.classList.remove('fix-flash');
    // Force a reflow so the class re-applies when the same field is flagged twice.
    void field.offsetWidth;
    field.classList.add('fix-flash');
    window.setTimeout(() => field.classList.remove('fix-flash'), 1800);
  }

  /**
   * The text that goes into WhatsApp.
   *
   * Deliberately short and human: it opens in the shopkeeper's OWN chat window and he can
   * see every line of it before he presses send, so anything that reads like a machine
   * header ("user-agent", "shop id") would just make him delete it. The shop name and the
   * screen are the two lines that save support a question; the rest we look up ourselves.
   */
  function whatsappText() {
    const lines = [];
    if (topic) lines.push(`${t('support.waTopic')}: ${t(`support.topics.${topic}`)}`);
    if (user?.shopName) lines.push(`${t('support.waShop')}: ${user.shopName}`);
    if (pageRef.current) lines.push(`${t('support.waScreen')}: ${pageRef.current}`);
    return `${t('support.waIntro')}\n${lines.join('\n')}\n\n${message.trim()}`;
  }

  function sendOnWhatsapp() {
    if (message.trim().length < MIN_MESSAGE) {
      toast.error(t('support.messageShort'));
      pointAtMessage();
      return;
    }
    const url = `https://wa.me/${channels.whatsapp}?text=${encodeURIComponent(whatsappText())}`;
    window.open(url, '_blank', 'noopener');
    setDone({ kind: 'whatsapp' });
  }

  async function sendOnEmail() {
    if (message.trim().length < MIN_MESSAGE) {
      toast.error(t('support.messageShort'));
      pointAtMessage();
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch('/api/seller/support', {
        method: 'POST',
        body: JSON.stringify({
          topic: topic || 'other',
          message: message.trim(),
          callbackPhone,
          context: { page: pageRef.current, lang, screen: screenSize() },
        }),
      });
      setDone({ kind: 'email', ref: res.ref, id: res.id, replyTo: res.replyTo });
      // /seller/support listens for this so a question sent from its own button appears at once.
      window.dispatchEvent(new CustomEvent('support:sent', { detail: { id: res.id } }));
    } catch (err) {
      // A refusal that names the box is a refusal the shopkeeper can act on.
      if (err.data?.field === 'message') {
        toast.error(apiErrorMessage(lang, err));
        pointAtMessage();
      } else if (err.code === 'SUPPORT_SEND_FAILED') {
        // Our mail is down, not his. Hand him the two things that still work.
        setDone({ kind: 'failed', ref: err.data?.ref, email: err.data?.email || supportEmail });
      } else {
        toast.error(apiErrorMessage(lang, err));
      }
    } finally {
      setBusy(false);
    }
  }

  function copy(what, text) {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(what);
        window.setTimeout(() => setCopied((c) => (c === what ? '' : c)), 2000);
      },
      () => toast.error(t('support.copyFailed'))
    );
  }

  /* ---------------------------------------------------------------- done states ---- */

  if (done) {
    const failed = done.kind === 'failed';
    return (
      <Modal
        onClose={onClose}
        title={
          failed ? t('support.failTitle')
            : done.kind === 'whatsapp' ? t('support.waOpenedTitle')
            : t('support.sentTitle')
        }
        maxWidth={520}
        footer={
          <>
            <button type="button" className="btn btn-primary btn-inline" onClick={onClose}>
              {t('support.done')}
            </button>
            {done.kind === 'email' && done.id && (
              <Link href={`/seller/support?ticket=${done.id}`} className="btn btn-secondary btn-inline" onClick={onClose}>
                <ChatIcon size={17} /> {t('support.viewConversation')}
              </Link>
            )}
            {failed && waReady && (
              <button type="button" className="btn btn-secondary btn-inline" onClick={() => { setDone(null); setChannel('whatsapp'); }}>
                <WhatsappIcon size={17} /> {t('support.tryWhatsapp')}
              </button>
            )}
          </>
        }
      >
        <div className={`support-done${failed ? ' failed' : ''}`}>
          <span className="support-done-mark" aria-hidden="true">
            {failed ? <AlertIcon size={26} /> : <CheckCircleIcon size={26} />}
          </span>

          {done.kind === 'whatsapp' && (
            /* Said plainly, because it is the one thing about this channel that is easy to
               get wrong: a wa.me link OPENS the chat. Nothing has reached us until he
               presses send in WhatsApp itself. */
            <p className="support-done-body">{t('support.waOpenedBody')}</p>
          )}

          {done.kind === 'email' && (
            <>
              <p className="support-done-body">{t('support.sentBody', { email: done.replyTo || user?.email || '' })}</p>
              <p className="support-done-body">{t('support.inAppNote')}</p>
              {channels?.hours && (
                <p className="support-done-hours"><ClockIcon size={14} /> {channels.hours}</p>
              )}
            </>
          )}

          {failed && (
            <>
              <p className="support-done-body">{t('support.failBody')}</p>
              <div className="support-fallback">
                <a
                  className="btn btn-secondary btn-small btn-inline"
                  href={`mailto:${done.email}?subject=${encodeURIComponent(`${done.ref} — BillVyse support`)}&body=${encodeURIComponent(message.trim())}`}
                >
                  <MailIcon size={15} /> {done.email}
                </a>
                <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => copy('message', message.trim())}>
                  {copied === 'message' ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
                  {copied === 'message' ? t('support.copied') : t('support.copyMessage')}
                </button>
              </div>
            </>
          )}

          {done.ref && (
            /* The reference is in the subject line of the mail, so this is a number support
               can genuinely search for — not a receipt for a queue nobody reads. */
            <div className="support-ref">
              <span className="support-ref-label">{t('support.refLabel')}</span>
              <code>{done.ref}</code>
              <button type="button" className="support-ref-copy" onClick={() => copy('ref', done.ref)} data-tip={t('support.copyRef')} aria-label={t('support.copyRef')}>
                {copied === 'ref' ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              </button>
            </div>
          )}
        </div>
      </Modal>
    );
  }

  /* -------------------------------------------------------------------- the form ---- */

  const tooShort = message.trim().length > 0 && message.trim().length < MIN_MESSAGE;

  return (
    <Modal
      as="form"
      onSubmit={(e) => { e.preventDefault(); if (channel === 'whatsapp') sendOnWhatsapp(); else sendOnEmail(); }}
      onClose={onClose}
      title={t('support.title')}
      hint={t('support.hint')}
      maxWidth={620}
      footer={
        <>
          <button type="submit" className="btn btn-primary btn-inline" disabled={busy || !channel}>
            {busy ? <SpinnerIcon size={17} /> : channel === 'whatsapp' ? <WhatsappIcon size={17} /> : <SendIcon size={17} />}
            {busy ? t('support.sending') : channel === 'whatsapp' ? t('support.sendWhatsapp') : t('support.sendEmail')}
          </button>
          <button type="button" className="btn btn-secondary btn-inline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
      {/* ---- Which door ---- */}
      <div className="support-channels" role="group" aria-label={t('support.channelLabel')}>
        {waReady && (
          <button
            type="button"
            className={`support-channel${channel === 'whatsapp' ? ' on' : ''}`}
            onClick={() => setChannel('whatsapp')}
            aria-pressed={channel === 'whatsapp'}
          >
            <span className="support-channel-mark wa"><WhatsappIcon size={20} /></span>
            <span className="support-channel-text">
              <strong>{t('support.channelWhatsapp')}</strong>
              <span>{t('support.channelWhatsappSub')}</span>
            </span>
            {channel === 'whatsapp' && <CheckIcon size={16} className="support-channel-tick" />}
          </button>
        )}
        <button
          type="button"
          className={`support-channel${channel === 'email' ? ' on' : ''}`}
          onClick={() => setChannel('email')}
          aria-pressed={channel === 'email'}
        >
          <span className="support-channel-mark"><MailIcon size={20} /></span>
          <span className="support-channel-text">
            <strong>{t('support.channelEmail')}</strong>
            <span>{t('support.channelEmailSub', { email: user?.email || '' })}</span>
          </span>
          {channel === 'email' && <CheckIcon size={16} className="support-channel-tick" />}
        </button>
      </div>

      {/* A number that is actually answered, when there is one. Not a third tile: a phone
          call is not a thing this form submits, it is a thing he does instead of it. */}
      {(channels?.phone || channels?.hours) && (
        <p className="support-hours">
          {channels.phone && (
            <a className="support-phone" href={`tel:${channels.phone.replace(/\s/g, '')}`}>
              <PhoneIcon size={14} /> {channels.phone}
            </a>
          )}
          {channels.hours && <span><ClockIcon size={14} /> {channels.hours}</span>}
        </p>
      )}

      {/* ---- What it is about ---- */}
      <div className="field">
        <label>{t('support.topicLabel')}</label>
        <div className="chip-select support-topics">
          {TOPICS.map((id) => (
            <button
              key={id}
              type="button"
              className={`chip-toggle${topic === id ? ' on' : ''}`}
              onClick={() => setTopic(topic === id ? '' : id)}
              aria-pressed={topic === id}
            >
              {t(`support.topics.${id}`)}
            </button>
          ))}
        </div>
      </div>

      {/* ---- The problem, in his words ---- */}
      <div className="field">
        <label htmlFor="support-message">{t('support.messageLabel')}</label>
        <textarea
          id="support-message"
          ref={messageRef}
          rows={5}
          value={message}
          maxLength={MAX_MESSAGE}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('support.messagePlaceholder')}
        />
        <p className={`support-count${tooShort ? ' short' : ''}`}>
          {tooShort ? t('support.messageShort') : t('support.messageHint')}
        </p>
      </div>

      {/* Only asked on the mail path: on WhatsApp we already have the number he is
          writing from, and a field that asks for something twice is a field that gets
          filled in wrong. */}
      {channel === 'email' && (
        <PhoneField
          id="support-phone"
          label={t('support.phoneLabel')}
          value={callbackPhone}
          onChange={setCallbackPhone}
        />
      )}

      {/* ---- What rides along ----
          Shown, not hidden: this is the shop's own data leaving the shop, and a disclosure
          that has to be opened is a disclosure that admits it would rather not be read.
          Collapsed by default only because it is reference, not a question. */}
      <div className="support-context">
        <button type="button" className="support-context-toggle" onClick={() => setShowContext((s) => !s)} aria-expanded={showContext}>
          <ChevronDownIcon size={14} className={showContext ? 'open' : ''} />
          {t('support.contextToggle')}
        </button>
        {showContext && (
          <ul className="support-context-list">
            <li><span>{t('support.ctxShop')}</span><strong>{user?.shopName || user?.name || '—'}</strong></li>
            <li><span>{t('support.ctxWho')}</span><strong>{user?.name || '—'}{user?.email ? ` · ${user.email}` : ''}</strong></li>
            <li><span>{t('support.ctxPlan')}</span><strong>{user?.plan || '—'}</strong></li>
            <li><span>{t('support.ctxScreen')}</span><strong>{pageRef.current || '—'}</strong></li>
            <li><span>{t('support.ctxDevice')}</span><strong>{screenSize()}</strong></li>
          </ul>
        )}
        <p className="support-context-note">{t('support.contextNote')}</p>
      </div>
    </Modal>
  );
}
