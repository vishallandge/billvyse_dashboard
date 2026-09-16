'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import { useLanguage } from '../components/LanguageProvider';
import { WhatsappIcon, CheckCircleIcon, SpinnerIcon, AlertIcon, SendIcon, LinkIcon, EyeIcon, ChevronDownIcon } from './Icons';
import { attemptWhatsappSend, openWhatsapp } from '../../lib/whatsappSend';

/**
 * Every WhatsApp send in the app, through one door.
 *
 * Before this there were eleven of them, and no two behaved the same. A bill offered two
 * buttons side by side and made the shopkeeper pick the plumbing; a khata reminder opened
 * WhatsApp on a `window.open` with no confirmation of any kind; a quotation showed the link
 * only *after* a second tap; a purchase order silently opened a tab that a popup blocker
 * could eat without anyone noticing. Four screens, four answers to the same question, and
 * on three of them the shopkeeper could not tell afterwards whether the message had gone.
 *
 * What this sheet fixes, in the order it matters:
 *
 *   1. **The shopkeeper sees the message before it goes.** Every one of these is written by
 *      the server — totals, rates, an udhaari figure, a wholesaler's order. Sending it
 *      unseen is how a wrong balance reaches a customer's phone, and there is no unsend.
 *   2. **One loud button, never two.** Whether the server can send this itself is a fact
 *      about the deployment's WhatsApp account. Putting that choice in front of a man with
 *      a queue at his counter is asking him to care about our plumbing.
 *   3. **A failed automatic send falls through to the link, in place.** Quota exhausted,
 *      provider refused, template un-approved overnight — the server hands the wa.me link
 *      back with every refusal, and the sheet turns into the manual path with the reason
 *      shown, rather than dead-ending on an error banner.
 *   4. **It says, afterwards, what actually happened.** "Bhej diya" only when the provider
 *      took the message. On the manual path it says WhatsApp was opened — because that is
 *      all this app can honestly know — and asks the shopkeeper to confirm he sent it.
 *
 * Usage. The caller owns whether the sheet exists, the way every dialog in this app does:
 *
 *     {share && (
 *       <WhatsappSheet
 *         title={t('wa.sendBill')}
 *         to={{ name: customer.name, phone: customer.phone }}
 *         message={share.text}
 *         link={share.whatsappLink}
 *         auto={share.whatsappAuto}
 *         endpoint={`/api/seller/bills/${bill._id}/whatsapp`}
 *         onSent={() => refresh()}
 *         onClose={() => setShare(null)}
 *       />
 *     )}
 *
 * `auto` and `endpoint` travel together: `auto` comes straight off the server's own
 * `whatsappAuto` flag (see backend/utils/whatsappDispatch.js) and `endpoint` is the route
 * that would do the sending. Omit either and the sheet is the manual path, which is the
 * correct default and the only one most shops will ever see.
 */
export default function WhatsappSheet({
  title,
  hint,
  to,
  message,
  link,
  auto = false,
  endpoint = null,
  appLink = null,
  appLinkLabel,
  sendLabel,
  onSent,
  onOpened,
  onClose,
}) {
  const { t } = useLanguage();

  /* idle → sending → sent          (automatic)
     idle → handed  → sent          (manual: WhatsApp opened, shopkeeper confirms)
     idle → sending → idle+notice   (automatic refused; the link path takes over) */
  const [stage, setStage] = useState('idle');
  const [notice, setNotice] = useState(null);
  const [waLink, setWaLink] = useState(link || null);
  const [canAuto, setCanAuto] = useState(Boolean(auto && endpoint));
  /**
   * The preview starts folded, and this is not a detail.
   *
   * An itemised bill is thirty lines. Dropped into the sheet whole it pushed the send
   * button below the fold on every phone and most laptops, so the shopkeeper had to scroll
   * a dialog to find the one thing he opened it for — and scrolling past a wall of text he
   * has already seen on the receipt behind it is not review, it is an obstacle wearing
   * review's clothes.
   *
   * Folded, the sheet fits on one screen: who, the first few lines, where it lands, and the
   * green button. The lines that matter most are at the top of every one of these messages
   * — the shop's name, what the document is, what it is worth — because that is how they
   * were written. Unfolded is one tap away for the shopkeeper who wants to read every line
   * before it goes to a customer, which is a real thing to want and is why the whole text
   * is here at all.
   */
  const [expanded, setExpanded] = useState(false);

  // The caller may re-fetch its share payload while the sheet is open — a bill that just
  // had a phone number attached to it is the everyday case. Without this the sheet would
  // still be holding the link from before the number existed, which is no link at all.
  useEffect(() => {
    setWaLink(link || null);
    setCanAuto(Boolean(auto && endpoint));
  }, [link, auto, endpoint]);

  async function handleAuto() {
    setStage('sending');
    setNotice(null);
    try {
      const result = await attemptWhatsappSend(endpoint, waLink);
      if (result.sent) {
        setStage('sent');
        onSent?.({ automatic: true });
        return;
      }
      // Refused, but with a way forward. Drop to the manual path and say why — a shopkeeper
      // who is told "quota khatam" understands the button changing; one who is told nothing
      // assumes the app is broken and stops trusting the green button everywhere else.
      setWaLink(result.link);
      setCanAuto(false);
      // `reason` is null when the server simply had no automatic path to take (see the
      // `sent === false` note in lib/whatsappSend.js) — that is not a failure and must not
      // be dressed as one. A real refusal carries its own sentence and keeps it.
      setNotice(result.reason ? { tone: 'warn', text: result.reason } : null);
      setStage('idle');
    } catch (error) {
      setNotice({ tone: 'error', text: error?.data?.message || error.message || t('wa.autoFailed') });
      setStage('idle');
    }
  }

  function handleManual() {
    const opened = openWhatsapp(waLink);
    if (!opened) {
      // Almost always a popup blocker. Worth naming: the shopkeeper's screen did nothing at
      // all, and without this line the only reasonable conclusion is that the app is dead.
      setNotice({ tone: 'error', text: t('wa.popupBlocked') });
      return;
    }
    setStage('handed');
    /**
     * Fire-and-forget, and deliberately not awaited.
     *
     * This is where a screen records that a reminder was sent — the ReminderLog row the
     * khata aging reads, the `remindedAt` stamp that takes a booking off tomorrow's queue.
     * WhatsApp is already open in front of the shopkeeper by the time it runs; a bookkeeping
     * call that fails must not reach back and undo that, and it must certainly not put an
     * error on a dialog whose job is finished.
     */
    onOpened?.();
  }

  const recipientName = to?.name || t('wa.customer');
  const initial = (recipientName || '?').trim().charAt(0).toUpperCase();

  const lines = useMemo(() => String(message || '').split('\n'), [message]);
  const folded = useMemo(() => foldMessage(lines), [lines]);
  const hiddenCount = lines.length - folded.filter((line) => line !== ELLIPSIS).length;

  /* ---------------------------------------------------------------- sent */
  if (stage === 'sent') {
    return (
      <Modal
        onClose={onClose}
        title={title || t('wa.title')}
        maxWidth={440}
        className="wa-sheet"
        footer={
          <button type="button" className="btn btn-primary btn-inline" onClick={onClose}>
            {t('wa.done')}
          </button>
        }
      >
        <div className="wa-done">
          <span className="wa-done-ring">
            <CheckCircleIcon size={30} />
          </span>
          <strong>{t('wa.sentTitle')}</strong>
          <p>{t('wa.sentBody', { name: recipientName })}</p>
        </div>
      </Modal>
    );
  }

  /* ------------------------------------------------------- WhatsApp opened */
  if (stage === 'handed') {
    return (
      <Modal
        onClose={onClose}
        title={title || t('wa.title')}
        maxWidth={440}
        className="wa-sheet"
        footer={
          <>
            <button
              type="button"
              className="btn btn-primary btn-inline"
              onClick={() => {
                setStage('sent');
                onSent?.({ automatic: false });
              }}
            >
              {t('wa.confirmSent')}
            </button>
            <button type="button" className="btn btn-secondary btn-inline" onClick={handleManual}>
              {t('wa.openAgain')}
            </button>
          </>
        }
      >
        <div className="wa-done wa-done-open">
          <span className="wa-done-ring wa-ring-brand">
            <WhatsappIcon size={30} />
          </span>
          <strong>{t('wa.openedTitle')}</strong>
          {/* Deliberately not "sent". The app opened WhatsApp; whether the shopkeeper
              pressed the green arrow after that is something it cannot see, and claiming
              otherwise is how a shop believes forty reminders went out on an evening when
              none did. */}
          <p>{t('wa.openedBody')}</p>
        </div>
      </Modal>
    );
  }

  /* ---------------------------------------------------------------- idle */
  const sending = stage === 'sending';
  const hasSomewhereToGo = canAuto || Boolean(waLink);

  return (
    <Modal
      onClose={onClose}
      title={title || t('wa.title')}
      hint={hint}
      maxWidth={440}
      className="wa-sheet"
      /* The buttons go in Modal's own pinned band, NOT in the body.
         They used to be an ordinary `.modal-actions` div among the children, which meant
         that on a short screen — a phone in landscape, a laptop with the keyboard up — the
         green button scrolled away with everything else and the shopkeeper had to scroll a
         dialog to reach the one control he opened it for. `.modal-fit` pins whatever comes
         through `footer`, so now the message scrolls under it and the send button never
         moves. See the band layout in globals.css. */
      footer={
        /* One loud action, always. Which of the two it is depends on the deployment, and
           that is the whole point — the shopkeeper presses the green button either way. */
        <>
          {canAuto ? (
            <button type="button" className="btn btn-primary btn-inline wa-go" onClick={handleAuto} disabled={sending}>
              {sending ? <SpinnerIcon size={17} /> : <WhatsappIcon size={17} />}
              {sending ? t('wa.sending') : sendLabel || t('wa.sendNow')}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-inline wa-go"
              onClick={handleManual}
              disabled={!waLink}
            >
              <WhatsappIcon size={17} /> {t('wa.openWhatsapp')}
            </button>
          )}
          <button type="button" className="btn btn-secondary btn-inline" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
      {/* ONE circle, not two. This used to be a 46px WhatsApp ring sitting beside a 30px
          initial — two discs in a row, the first of which said nothing the green button at
          the bottom does not already say, and together they read as a rendering fault. The
          mark is now a badge on the person's own avatar: same information, one object, and
          about 20px of height back for the message. */}
      <div className="wa-hero">
        {to?.phone ? (
          <div className="wa-to">
            <span className="wa-to-avatar">
              {initial}
              <span className="wa-to-badge"><WhatsappIcon size={13} /></span>
            </span>
            <div className="wa-to-who">
              <strong>{recipientName}</strong>
              <small>+91 {to.phone}</small>
            </div>
          </div>
        ) : (
          // No recipient at all: the catalogue link and the day's hisaab go to whoever the
          // shopkeeper picks inside WhatsApp itself, so there is nobody to name here.
          <p className="wa-to-anyone">
            <span className="wa-to-avatar wa-to-avatar-plain">
              <WhatsappIcon size={16} />
            </span>
            <span>{t('wa.pickInWhatsapp')}</span>
          </p>
        )}
      </div>

      {message && (
        <div className="wa-preview">
          <span className="wa-preview-label">{t('wa.preview')}</span>
          <div className="wa-bubble">{renderWhatsappText(expanded ? lines : folded)}</div>
          {/* Only offered when something is actually being hidden. A "show more" under a
              three-line reminder is a control that does nothing, and a control that does
              nothing is how a shopkeeper learns to ignore the ones that do. */}
          {hiddenCount > 0 && (
            <button type="button" className="wa-more" onClick={() => setExpanded((open) => !open)}>
              {expanded ? t('wa.showLess') : t('wa.showFull', { n: hiddenCount })}
              <ChevronDownIcon size={14} className={expanded ? 'wa-more-open' : undefined} />
            </button>
          )}
        </div>
      )}

      {/* What the message hands the other person: an address in this app where they can
          open the thing itself — the bill next to every other bill, the udhaari ledger
          behind the figure, the order the wholesaler is being asked to confirm.

          Shown, and openable, because the shopkeeper is the only person who can catch a
          broken one. Until now the customer was the first to find out, and what they found
          out was that the shop had sent them a dead link. The "kholkar dekhein" button is
          there so checking it costs a tap rather than a copy-paste. */}
      {appLink && (
        <div className="wa-applink">
          <LinkIcon size={15} />
          <div className="wa-applink-body">
            <small>{appLinkLabel || t('wa.appLinkLabel')}</small>
            <span className="wa-applink-url">{appLink}</span>
          </div>
          <a
            href={appLink}
            target="_blank"
            rel="noreferrer"
            className="icon-btn"
            data-tip={t('wa.openLink')}
            aria-label={t('wa.openLink')}
          >
            <EyeIcon size={17} />
          </a>
        </div>
      )}

      {/* The server said there IS meant to be a link here and could not build one — the
          shop has no storefront address yet, so its customers have nowhere to look anything
          up. Distinguished from `null`, which means this particular share simply has no
          such link and never did (the day's hisaab, for one).

          Named with the fix attached rather than left as an absence: a shopkeeper cannot be
          expected to work out that "shop link" on the Settings screen is the reason his
          customers cannot see their bills. */}
      {appLink === '' && (
        <p className="wa-notice wa-notice-warn">
          <AlertIcon size={15} />
          <span>{t('wa.noAppLink')}</span>
        </p>
      )}

      {notice && (
        <p className={`wa-notice wa-notice-${notice.tone}`}>
          <AlertIcon size={15} />
          <span>{notice.text}</span>
        </p>
      )}

      {hasSomewhereToGo && (
        <p className={`wa-mode ${canAuto ? 'wa-mode-auto' : 'wa-mode-manual'}`}>
          {canAuto ? <SendIcon size={15} /> : <LinkIcon size={15} />}
          <span>{canAuto ? t('wa.modeAuto') : t('wa.modeManual')}</span>
        </p>
      )}

      {!hasSomewhereToGo && <p className="field-hint wa-nophone">{t('wa.noPhone')}</p>}

    </Modal>
  );
}


/* ------------------------------------------------------------------ preview rendering */

/**
 * The fold, and why it is not simply "the first six lines".
 *
 * An itemised bill is thirty lines and the first six of them are the shop's name, its
 * address, its phone and a divider — everything except the two things the shopkeeper is
 * actually checking before he presses send: which document this is, and how much it says.
 * Cutting at a line count put the address on screen and the total below the fold, which is
 * a preview that previews nothing.
 *
 * The signal is already in the text. Every builder in backend/utils/messageTemplates.js
 * writes for WhatsApp, and WhatsApp bold is *asterisks* — which those builders spend on
 * exactly two things: the line that names the document ("*Bill #1042*") and the line that
 * carries the money ("*Total ₹542.00*").
 *
 * THE FOLD SHOWS THE MESSAGE, IN ORDER. It used to keep only the bold lines and elide the
 * rest, which read as a summary and was in fact the opposite of one: on a real bill it kept
 * the shop's name and the total and threw away the bill NUMBER, the date and every item —
 * that is, everything the shopkeeper opened the preview to check. A preview he cannot verify
 * anything against is worse than no preview, because he trusts it.
 *
 * So: the opening lines as written, whole and in sequence, and then — only if the money line
 * fell outside them — one gap and that line, because the total is the one thing worth
 * breaking sequence for. Nothing is ever cut mid-line; the array is folded, not the pixels,
 * which is also what killed the old half-line-plus-fade that started this.
 */
/* A Symbol, not a sentinel string. The gap marker is compared against real message
   lines, so anything expressible as text could in principle collide with one; a Symbol
   cannot, and it also keeps a literal NUL out of the source file. */
const ELLIPSIS = Symbol('wa-gap');
/* How many opening lines survive the fold. Eight is what it takes to carry the shop name,
   the address line, the document and its number, the date and the first item or two on the
   real builders in backend/utils/messageTemplates.js — measured against those, not guessed. */
const HEAD_LINES = 8;
/* Below this, folding is not worth doing. Hiding one line behind a control that has to be
   read, understood and tapped costs the shopkeeper more than the line ever did — and a
   "read the full message" that reveals a single URL teaches him the control is not worth
   pressing anywhere else either. */
const MIN_WORTH_HIDING = 3;

/** The last line carrying *bold* money — the total, on every message that has one. */
function lastBoldIndex(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/\*[^*]+\*/.test(lines[i])) return i;
  }
  return -1;
}

function foldMessage(lines) {
  if (lines.length - HEAD_LINES < MIN_WORTH_HIDING) return lines;

  const head = lines.slice(0, HEAD_LINES);
  const out = [...head];

  const money = lastBoldIndex(lines);
  // A gap marker rather than a silent jump: the shopkeeper must be able to SEE that lines
  // were left out, or a folded preview becomes one he cannot trust.
  out.push(ELLIPSIS);
  if (money >= HEAD_LINES) out.push(lines[money]);

  return out;
}

/* A line of nothing but box-drawing characters. Every message builder in this app uses one
   as a section rule, and rendered literally it is the loudest thing in the preview —
   fifteen heavy glyphs shouting between two quiet lines of text. Drawn as an actual rule
   it does the job it was there to do and stops competing with the words. */
const RULE = /^[\u2500-\u257F\-=_]{3,}$/;
const URL_RE = /(https?:\/\/\S+)/g;

/**
 * WhatsApp's own formatting, as WhatsApp draws it.
 *
 * The messages this app sends are written FOR WhatsApp — `*bold*` around the shop name and
 * the total, `_italic_` around the small print — and a preview that shows the asterisks is
 * showing the shopkeeper something the customer will never see. Worse, it makes the one
 * line that is meant to stand out (the total) look like a typing mistake.
 *
 * Deliberately not a markdown parser. Three rules, applied to one line at a time, because
 * that is exactly what WhatsApp supports and anything cleverer would start rendering a
 * customer's name as emphasis the moment it contained an underscore.
 */
function renderWhatsappText(lines) {
  return lines.map((line, index) => {
    if (line === ELLIPSIS) return <span key={index} className="wa-gap" aria-hidden="true" />;
    if (RULE.test(line.trim())) return <hr key={index} className="wa-rule" />;
    if (!line) return <br key={index} />;
    return (
      <span key={index} className="wa-line">
        {formatLine(line)}
      </span>
    );
  });
}

function formatLine(line) {
  const out = [];
  let key = 0;

  // URLs first: they are the one span that must never have *bold* run inside it, and a link
  // with an underscore in its path would otherwise come out half italic.
  for (const chunk of line.split(URL_RE)) {
    if (!chunk) continue;
    if (URL_RE.test(chunk)) {
      URL_RE.lastIndex = 0;
      // A span, not an anchor. This is a preview of a message; a link the shopkeeper can
      // accidentally follow takes him out of the sheet mid-send. The one link he is meant
      // to be able to open has its own row below, with a button that says so.
      out.push(
        <span key={`u${key++}`} className="wa-url">
          {chunk}
        </span>
      );
      continue;
    }
    for (const part of chunk.split(/(\*[^*]+\*|_[^_]+_)/g)) {
      if (!part) continue;
      if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
        out.push(<strong key={`b${key++}`}>{part.slice(1, -1)}</strong>);
      } else if (part.length > 2 && part.startsWith('_') && part.endsWith('_')) {
        out.push(<em key={`i${key++}`}>{part.slice(1, -1)}</em>);
      } else {
        out.push(part);
      }
    }
  }
  return out;
}
