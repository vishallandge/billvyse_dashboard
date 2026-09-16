'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { useDashboardUser } from './DashboardShell';
import { useToast } from './Toast';
import { greetingFor } from '../../lib/greeting';
import { formatNumber } from '../../lib/hindiNumerals';
import { formatMoney } from '../../lib/format';
import { localise, adviceKey } from './Recommendations';
import { adviceActionKey, isSelfLink } from '../../lib/adviceActions';
import { voiceQuality, speakLines, stopSpeaking } from '../../lib/adviceVoice';
import AdviceRows from './AdviceRows';
import BrandLogo from './BrandLogo';
import { motionIsOff } from './MotionProvider';
import {
  AlertIcon,
  ClockIcon,
  InfoIcon,
  CheckIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  UndoIcon,
  XIcon,
} from './Icons';

const TONE_ICONS = { urgent: AlertIcon, warn: ClockIcon, info: InfoIcon };

/**
 * THE ASSISTANT — the same forty-two rules, said out loud by somebody.
 *
 * ---------------------------------------------------------------------------
 * What was wrong with the list
 * ---------------------------------------------------------------------------
 * `/seller/advice` was a correct report and almost nobody read past the second heading.
 * Fifteen cards under five headings, every one of them shouting at the same volume, is the
 * same as nothing: a shopkeeper opening it at nine in the morning scrolls, nods, and
 * closes it. The one card worth ₹18,000 is somewhere in there wearing the same clothes as
 * "42 products have no HSN code".
 *
 * The information was never the problem. The problem was that nobody was talking.
 *
 * ---------------------------------------------------------------------------
 * The four things that make this an assistant and not a list
 * ---------------------------------------------------------------------------
 *   1. IT GREETS AND SAYS WHAT IT DID. "Maine abhi aapki dukaan ka hisaab dekha — 23
 *      cheezein jaanchi." A clean day then reads as work done rather than an empty screen,
 *      which is the difference between a helper who found nothing and a screen that is
 *      broken.
 *   2. IT TAKES ONE THING AT A TIME. Everything is present — this is a thread, not a
 *      wizard, and nothing is hidden behind a "next" button a busy man cannot escape — but
 *      exactly one message wears "sabse pehli baat" and the weight that goes with it.
 *   3. IT CAN BE ANSWERED. "Kal dikhana" and "rehne do" are honoured, server-side, on every
 *      surface (see backend/utils/adviceMemory.js). Advice that shows up identically
 *      whatever you decided is advice you stop reading by Thursday.
 *   4. IT NOTICES. "Kal maine bataya tha — aaj ho gaya. ₹4,200 aa gaya." One line, no
 *      query, and it is the whole difference between a nag and somebody who was paying
 *      attention.
 *
 * ---------------------------------------------------------------------------
 * What it is NOT
 * ---------------------------------------------------------------------------
 * NOT AN LLM. Every sentence here is a translated string filled with numbers the database
 * counted. There is no free-text box and no model call, and that is a feature: an
 * assistant that invents "aapka munafa ₹18,000" once has cost us every other figure on the
 * screen. If a chat box is ever added it belongs behind its own switch, its own plan gate
 * and its own metered quota — see backend/config/assistant.js.
 *
 * NOT IN CHARGE. It shows, offers the screen that does the job, and stops. The decision is
 * the owner's — *"malik ko dikha de, wo decide karega"* — which is why the primary chip
 * navigates and never performs, and why "rehne do" is a real answer the app obeys rather
 * than a dismissal it forgets by morning.
 */
export default function AdviceAssistant({ data, focus, open, onToggle, onAnswered }) {
  const { t, lang } = useLanguage();
  const user = useDashboardUser();
  const toast = useToast();

  /**
   * Answers given in THIS session, so the message can turn into its own receipt in place.
   *
   * Local rather than a refetch on purpose. The server has already been told and will filter
   * the rule out on the next load; re-fetching now would make the answered message vanish
   * mid-thread and take the shopkeeper's place on the page with it. Leaving a one-line
   * receipt where the message was is what makes "kal dikhana" feel like it was heard.
   */
  const [answered, setAnswered] = useState({});
  const [busyKey, setBusyKey] = useState('');
  const [showHeld, setShowHeld] = useState(false);
  /**
   * The voice. `speaking` is the key of the line being said RIGHT NOW, which is what lets
   * the message light up as the voice reaches it — the eye follows the ear down the page,
   * and that one piece of feedback is most of why being read to feels like being read to
   * rather than like a recording playing somewhere.
   */
  const [speaking, setSpeaking] = useState(null);
  // 0..1 through the line being said. Drives the word-by-word lighting — see the note on
  // `onboundary` in lib/adviceVoice.js for why this is a fraction and not an index.
  const [saidTo, setSaidTo] = useState(0);
  /**
   * Lines already read in THIS session.
   *
   * Only exists to stop a jolt. The words are tinted as they are read, so a message the
   * voice has just left would snap from coloured back to plain the instant `speaking` moved
   * on and its plain string replaced the word spans. Keeping it in the word rendering for a
   * moment longer lets the colour EASE out instead — the trail fades behind the voice the
   * way it built up in front of it. Cleared a second after the reading stops, at which
   * point the sentence is a plain string again and nothing is left mounted.
   */
  const [saidKeys, setSaidKeys] = useState(() => new Set());
  const [reading, setReading] = useState(false);
  const stopRef = useRef(null);
  const [canSpeak, setCanSpeak] = useState(false);

  /**
   * Can this device speak THIS language?
   *
   * Two separate questions, and only asking the first was the bug: `'speechSynthesis' in
   * window` is true on every modern browser, but almost none of them ship a Marathi voice
   * and many ship no Indian English one either. Setting an unavailable locale on an
   * utterance makes the engine say nothing — silently — so the button appeared, was
   * tapped, and did precisely nothing.
   *
   * voiceQuality() walks the fallback ladder (a Hindi voice reads Marathi perfectly
   * intelligibly; any English voice reads a rupee figure) and answers false only when the
   * device genuinely has nothing. Then the button is not drawn at all — a dead control is
   * worse than a missing one, because it teaches the shopkeeper the feature is broken.
   *
   * Re-checked when the language changes, since the answer is different per language.
   * After mount, never during render: `window` does not exist on the server.
   */
  useEffect(() => {
    let alive = true;
    voiceQuality(lang).then((q) => { if (alive) setCanSpeak(q); });
    return () => { alive = false; };
  }, [lang]);

  // Switching language mid-sentence would leave a Hindi voice finishing a Marathi list.
  useEffect(() => {
    stopSpeaking();
    setReading(false);
    setSpeaking(null);
  }, [lang]);

  /**
   * THE PAGE FOLLOWS THE VOICE.
   *
   * When the reading moves to a message further down, the screen walks to it. This is the
   * detail that turns "a sound is playing" into "somebody is taking me through this" — and
   * unlike the rest of the effects it is not decoration: on a phone, four pieces of advice
   * are three screens tall, so without it the shopkeeper is listening to a message he
   * cannot see and has to hunt for the buttons afterwards.
   *
   * `nearest` and not `center`, so a message already comfortably on screen does not make
   * the page jump for no reason. Skipped entirely under reduced motion, where an unasked-
   * for smooth scroll is precisely the thing the setting exists to prevent — the reading
   * itself carries on.
   */
  useEffect(() => {
    if (!speaking || speaking === '__open') return;
    if (motionIsOff()) return;
    const el = document.getElementById(`adv-${speaking}`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [speaking]);

  // Leaving the screen silences it. A voice still reading out a shop's udhaar after the
  // shopkeeper has walked to another page is the reason people switch sound off forever.
  useEffect(() => () => stopSpeaking(), []);

  const assistant = data?.assistant || {};
  const items = data?.items || [];
  const held = assistant.held || [];
  const followUps = assistant.followUps || [];
  const recap = assistant.recap;

  const n = (value) => formatNumber(value, lang);
  const money = (value) => formatMoney(value, lang, { decimals: false });

  // The first thing still waiting on him. Everything after it is present but quieter —
  // see note 2 in the header.
  const firstOpenKey = useMemo(
    () => items.find((item) => !answered[item.key])?.key || '',
    [items, answered]
  );

  async function reply(key, kind) {
    setBusyKey(key);
    try {
      const res = await apiFetch('/api/seller/advisories/reply', {
        method: 'POST',
        body: JSON.stringify({ key, reply: kind }),
      });
      if (kind === 'undo') {
        setAnswered((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      } else {
        setAnswered((prev) => ({ ...prev, [key]: { reply: kind, until: res?.until } }));
      }
      onAnswered?.(key, kind);
    } catch (err) {
      // A refused answer must say so. Silently leaving the chip un-pressed would read as a
      // dead button, and the next thing the shopkeeper does is stop using them.
      toast.error(err.message);
    } finally {
      setBusyKey('');
    }
  }

  const greeting = greetingFor(lang, new Date().getHours());
  // First name only. "Namaste Ramesh ji" is how somebody speaks; the full name on the
  // account is how a bank writes.
  const firstName = String(user?.name || '').trim().split(/\s+/)[0] || '';

  const waiting = items.filter((item) => !answered[item.key]).length;

  const openLine =
    `${firstName ? t('advice.asst.greetName', { greeting, name: firstName }) : `${greeting}.`} ` +
    `${t('advice.asst.checked', { count: n(assistant.checked || 0) })} ` +
    (waiting > 0
      ? t(waiting === 1 ? 'advice.asst.oneWaiting' : 'advice.asst.manyWaiting', { count: n(waiting) })
      : t('advice.asst.allClear'));

  /**
   * Read the morning out loud.
   *
   * The greeting, then the wins, then every message still waiting — the same order the eye
   * meets them, because the voice is reading THIS page and not a summary of it.
   *
   * Only ever from this tap. Browsers block audio that starts without a gesture, and so do
   * we on principle: a counter tablet that suddenly announces "₹18,000 wholesaler ko dena
   * hai" in front of a customer is a serious thing to do to somebody.
   */
  const speak = useCallback(() => {
    if (reading) {
      stopRef.current?.();
      stopRef.current = null;
      setReading(false);
      setSpeaking(null);
      return;
    }

    const lines = [{ key: '__open', text: openLine }];
    for (const win of followUps) {
      lines.push({
        key: `win-${win.key}`,
        text: `${t('advice.asst.done', { what: t(`advice.short.${win.key}`) })} ${
          win.stake > 0 ? t('advice.asst.doneMoney', { amount: money(win.stake) }) : ''
        }`,
      });
    }
    for (const item of items) {
      if (answered[item.key]) continue;
      lines.push({ key: item.key, text: t(adviceKey(item), localise(item.params, lang)) });
    }

    setReading(true);
    setSaidKeys(new Set());
    stopRef.current = speakLines(lines, {
      lang,
      onLine: (key) => {
        // The line the voice is leaving joins the trail, so its colour eases out rather
        // than vanishing the moment the next one starts.
        setSpeaking((prev) => {
          if (prev) setSaidKeys((keys) => new Set(keys).add(prev));
          return key;
        });
        setSaidTo(0);
      },
      onWord: (key, fraction) => setSaidTo(fraction),
      onDone: () => { setReading(false); setSpeaking(null); setSaidTo(0); },
    });
  }, [reading, openLine, followUps, items, answered, lang, t, money]);

  /**
   * Once the reading has stopped and the last colour has faded, drop the trail so every
   * sentence goes back to being a plain string. A second is comfortably longer than the
   * 0.6s fade, and doing it on a timer rather than on the fade's own event keeps this
   * independent of how many words happen to be on screen.
   */
  useEffect(() => {
    if (reading || !saidKeys.size) return undefined;
    const timer = setTimeout(() => setSaidKeys(new Set()), 1000);
    return () => clearTimeout(timer);
  }, [reading, saidKeys]);

  return (
    <section className="asst">
      {/* ------------------------------------------------------------ who is talking

          The real BillVyse mark, not a drawn face and not an emoji. The shopkeeper is
          being spoken to BY THE APP — putting a cartoon avatar here would have invented a
          character with opinions of its own, and every number below it belongs to the
          product, not to a mascot. */}
      <header className="asst-head">
        {/* The mark pulses while the voice is going. It is the only thing on the page that
            says WHO is talking, so it is the thing that should look alive when somebody is
            — two soft rings, and nothing at all when it is quiet. */}
        <span className={`asst-face${reading ? ' is-talking' : ''}`}><BrandLogo size={34} /></span>
        <span className="asst-id">
          <strong>{t('advice.asst.name')}</strong>
          <small>{t('advice.asst.byline')}</small>
        </span>

        {/* THE VOICE.
            Browser speech — no key, no service, no per-message cost, and nothing about the
            shop's money leaves the phone. Never starts by itself: every browser blocks
            audio without a gesture, and a counter tablet that announces an ₹18,000 debt in
            front of a customer would be a serious thing to do to somebody.
            Hidden entirely where the browser cannot speak, rather than shown and broken. */}
        {canSpeak && assistant.voice !== false && (
          <button
            type="button"
            className={`asst-speak${reading ? ' is-on' : ''}`}
            onClick={speak}
            data-tip={reading ? t('advice.asst.stop') : t('advice.asst.speak')}
            aria-label={reading ? t('advice.asst.stop') : t('advice.asst.speak')}
          >
            {/* FOUR BARS, NOT A GLYPH.
                A sound wave is what this button does — and unlike an icon it can be ALIVE:
                the bars breathe slowly at rest and dance while the voice is going, so the
                control is its own "playing" indicator and nothing else has to say so.
                It is also the honest picture. A sparkle here would borrow the visual
                language of generated text, and there is no model behind this — every word
                it reads was counted, not invented. The magic is in the motion, not in
                pretending to be something it is not. */}
            <span className="asst-wave" aria-hidden="true">
              <i /><i /><i /><i /><i />
            </span>
            <span>{reading ? t('advice.asst.stop') : t('advice.asst.speak')}</span>
          </button>
        )}
      </header>

      {/* WHEN THE VOICE IS NOT THE SHOPKEEPER'S OWN LANGUAGE, SAY SO.
          Almost no device ships a Marathi voice — Windows has none, and Android has none
          until the voice data is installed — so `mr` falls back to a Hindi voice reading
          Marathi text. It is completely intelligible and it is audibly not Marathi, which
          the shopkeeper notices in the first sentence.
          Reading it in Hindi and staying quiet about that is the one thing we must not do:
          it is a small lie about something the user can hear, and it makes the whole
          feature feel broken rather than limited. So it is named, with the two-minute
          device setting that fixes it — which only the shopkeeper can do. Shown only while
          the voice is in use, so it never nags somebody who has not asked for sound. */}
      {reading && (canSpeak === 'script' || canSpeak === 'foreign') && (
        <p className="asst-voice-note">
          {t(canSpeak === 'script' ? 'advice.asst.voiceSubbed' : 'advice.asst.voiceForeign')}
        </p>
      )}

      <div className="asst-thread">
        {/* The opening. Two sentences: who it is talking to, and what it actually did —
            the second is what stops a quiet day reading as a broken screen. */}
        <p className={`asst-open${speaking === '__open' ? ' is-speaking' : ''}`}>
          {speaking === '__open' || saidKeys.has('__open') ? (
            <SpokenText
              text={openLine}
              progress={speaking === '__open' ? saidTo : 1}
              settled={speaking !== '__open'}
            />
          ) : (
            <>
              <b>{firstName ? t('advice.asst.greetName', { greeting, name: firstName }) : `${greeting}.`}</b>{' '}
              {t('advice.asst.checked', { count: n(assistant.checked || 0) })}{' '}
              {waiting > 0
                ? t(waiting === 1 ? 'advice.asst.oneWaiting' : 'advice.asst.manyWaiting', { count: n(waiting) })
                : t('advice.asst.allClear')}
            </>
          )}
        </p>

        {/* ------------------------------------------------------------- the good news

            Before the work, deliberately. A shopkeeper who cleared ₹4,200 yesterday has
            earned the first line of the morning, and a helper that opens with what went
            right is one you keep listening to. */}
        {followUps.map((win) => (
          <p className="asst-win" key={`win-${win.key}`}>
            <span className="asst-win-icon"><CheckCircleIcon size={17} /></span>
            <span>
              {t('advice.asst.done', { what: t(`advice.short.${win.key}`) })}
              {win.days ? ` ${t('advice.asst.doneStood', { days: n(win.days) })}` : ''}
              {win.stake > 0 ? <b> {t('advice.asst.doneMoney', { amount: money(win.stake) })}</b> : ''}
            </span>
          </p>
        ))}

        {/* ------------------------------------------------------------- the messages

            `--i` is the arrival order. The thread lands one message after another rather
            than all at once — a quarter of a second of stagger, which is the difference
            between a page painting and somebody starting to speak. The stylesheet turns it
            off entirely under reduced motion. */}
        {items.map((item, i) => (
          <AssistantMessage
            key={item.key}
            index={i}
            item={item}
            isNow={item.key === firstOpenKey}
            answer={answered[item.key]}
            busy={busyKey === item.key}
            canReply={Boolean(assistant.canReply)}
            open={Boolean(open[item.key])}
            focused={focus === item.key}
            speaking={speaking === item.key}
            settled={saidKeys.has(item.key)}
            progress={saidTo}
            onToggle={() => onToggle(item.key)}
            onReply={reply}
            t={t}
            n={n}
            money={money}
            lang={lang}
          />
        ))}

        {/* ------------------------------------------------- what he set aside earlier

            Returned, never buried. A dismissal that cannot be undone is a dismissal people
            are afraid to use — and then the reply chips are decoration and the whole
            memory is worth nothing. */}
        {held.length > 0 && (
          <div className={`asst-held${showHeld ? ' is-open' : ''}`}>
            <button type="button" className="asst-held-toggle" onClick={() => setShowHeld((v) => !v)}>
              <ClockIcon size={15} />
              <span>{t('advice.asst.heldTitle', { count: n(held.length) })}</span>
              <ChevronDownIcon size={14} />
            </button>
            {showHeld && (
              <div className="asst-held-list">
                {held.map((row) => (
                  <div className="asst-held-row" key={`held-${row.key}`}>
                    <span className="asst-held-text">{t(adviceKey(row), localise(row.params, lang))}</span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small btn-inline"
                      disabled={busyKey === row.key}
                      onClick={() => reply(row.key, 'undo')}
                    >
                      <UndoIcon size={15} /> {t('advice.asst.undo')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* --------------------------------------------------------------- the sign-off

            The week's cleared rupees. Not a score and not a streak — a fact about money
            that came back, which is the only kind of encouragement this screen has any
            business giving. Silent in a week where nothing cleared, because a zero here
            would be a scolding. */}
        {recap?.count > 0 && (
          <p className="asst-recap">
            {t('advice.asst.recap', { count: n(recap.count) })}
            {recap.amount > 0 ? <b> {t('advice.asst.recapMoney', { amount: money(recap.amount) })}</b> : ''}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * One thing the assistant has to say, and the three ways to answer it.
 *
 * The chips, in the order they are offered:
 *   - the VERB (lib/adviceActions.js) — what the screen behind this actually is. "Reminder
 *     bhejo", not "Open". It navigates and never performs: the assistant hands over the
 *     screen and the owner does the deed.
 *   - "kal dikhana" — back tomorrow morning, unchanged.
 *   - "rehne do" — quiet for a month. Not forever: a shopkeeper saying "not now" to slow
 *     stock in July is not saying "never mention slow stock again", and a permanent mute on
 *     a rule that carries money would cost somebody real rupees in silence.
 */
function AssistantMessage({ item, index, isNow, answer, busy, canReply, open, focused, speaking, settled, progress, onToggle, onReply, t, n, money, lang }) {
  const Icon = TONE_ICONS[item.tone] || InfoIcon;
  const rows = item.detail || [];
  const selfLink = isSelfLink(item);
  const sentence = t(adviceKey(item), localise(item.params, lang));

  if (answer) {
    /**
     * The receipt. It replaces the message in place rather than removing it, so the thread
     * does not shift under a thumb that has just tapped, and so the answer is visible as a
     * thing that was heard rather than as a card that disappeared.
     */
    return (
      <p className="asst-answered" id={`adv-${item.key}`}>
        <span className="asst-answered-icon"><CheckIcon size={15} /></span>
        {/* Its own class, not a bare <span>: a `> span` rule here would also match the
            icon beside it, and a flex-grow meant for the sentence landing on a 15px glyph
            pushes the sentence into the middle of the row. */}
        <span className="asst-answered-text">
          {answer.reply === 'never' ? t('advice.asst.mutedSaid') : t('advice.asst.laterSaid')}
        </span>
        <button
          type="button"
          className="asst-answered-undo"
          disabled={busy}
          onClick={() => onReply(item.key, 'undo')}
        >
          {t('advice.asst.undo')}
        </button>
      </p>
    );
  }

  return (
    <article
      className={`asst-msg asst-${item.tone}${isNow ? ' is-now' : ''}${focused ? ' is-focused' : ''}${speaking ? ' is-speaking' : ''}`}
      id={`adv-${item.key}`}
      // `--i` is the arrival order; `--said` is how far the voice has got through this
      // message, which the tone rail on the left reads as a fill. One number, two jobs, no
      // extra element — see the rail rule in globals.css.
      style={{ '--i': index, '--said': speaking ? Math.min(1, Math.max(0, progress || 0)) : 0 }}
    >
      {isNow && <span className="asst-msg-lead">{t('advice.asst.first')}</span>}

      <div className="asst-msg-top">
        <span className="asst-msg-icon"><Icon size={18} /></span>
        <p className="asst-msg-text">
          {speaking || settled ? (
            <SpokenText text={sentence} progress={speaking ? progress : 1} settled={!speaking} />
          ) : (
            sentence
          )}
        </p>
        {/* The money, stated separately from the sentence and in tabular figures, so a
            thread can be ranked by what is at stake without reading a word of it.
            `item.stake`, NOT `item.impact` — impact is the sort key and carries deliberate
            weights (slow stock ranks at a quarter of the capital in it), so printing it put
            "₹2,842" on a message whose own sentence said ₹11,369. A rule with no single
            honest rupee figure shows no figure. */}
        {item.stake > 0 && (
          <span className="asst-msg-stake">
            <b>₹{money(item.stake)}</b>
            <small>{t('advice.stakeCaption')}</small>
          </span>
        )}
      </div>

      <div className="asst-msg-reply">
        {selfLink ? (
          // The card is its own screen — the registry points slow stock and dead stock back
          // at this page so the dashboard's one-liner lands on the list. A link here would
          // navigate to where you are standing: the URL changes and nothing moves. So the
          // verb opens the rows instead.
          <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={onToggle}>
            {open ? t('advice.hideRows') : t(adviceActionKey(item))}
            <ChevronDownIcon size={15} style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
          </button>
        ) : (
          <>
            <Link href={item.href} className="btn btn-secondary btn-small btn-inline asst-do">
              {t(adviceActionKey(item))} <ChevronRightIcon size={15} />
            </Link>
            {rows.length > 0 && (
              <button type="button" className="asst-chip" onClick={onToggle}>
                {open ? t('advice.hideRows') : t('advice.showRows')}
                <ChevronDownIcon size={13} style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
              </button>
            )}
          </>
        )}

        {canReply && (
          <>
            <button type="button" className="asst-chip" disabled={busy} onClick={() => onReply(item.key, 'later')}>
              <ClockIcon size={13} /> {t('advice.asst.later')}
            </button>
            <button type="button" className="asst-chip is-quiet" disabled={busy} onClick={() => onReply(item.key, 'never')}>
              <XIcon size={13} /> {t('advice.asst.never')}
            </button>
          </>
        )}
      </div>

      {open && rows.length > 0 && <AdviceRows rows={rows} />}
    </article>
  );
}

/**
 * A sentence that lights up as it is being said.
 *
 * ---------------------------------------------------------------------------
 * This is the whole "it is actually talking" effect
 * ---------------------------------------------------------------------------
 * A voice playing while a static paragraph sits there is a recording. The words catching
 * up with the voice is somebody READING TO YOU — and it costs nothing but a span per word.
 * It is also genuinely useful rather than only pretty: a shopkeeper glancing back at the
 * screen mid-sentence can see exactly where the voice has got to.
 *
 * PROPORTIONAL, not indexed. The engine reports how far it is through the SPOKEN string,
 * which lib/adviceVoice.js has already rewritten for the ear — "₹1,840" is spoken as "1840
 * rupees" — so a character index into it cannot address the sentence on screen. The
 * fraction survives that rewrite. It can drift by a word; nobody can see a word of drift,
 * and the alternative is a mapping that would be wrong in a harder-to-notice way.
 *
 * Every word is rendered either way, so the sentence is fully readable and fully
 * selectable at all times — the lighting is a highlight, never a reveal. Nothing is hidden
 * from somebody who reads faster than the voice.
 */
function SpokenText({ text, progress, settled = false }) {
  const words = useMemo(() => String(text || '').split(/(\s+)/), [text]);
  // Count only the real words, so the run of whitespace between them does not skew where
  // the boundary lands.
  const total = useMemo(() => words.filter((w) => w.trim()).length, [words]);
  const upto = Math.round(Math.min(1, Math.max(0, progress || 0)) * total);

  let spoken = 0;
  return (
    /**
     * `is-settled` is the voice having moved on. Every word is still marked as said, so
     * nothing about the markup changes — the stylesheet simply lets the colour drain back
     * to the page's own ink over half a second. Without it a finished message snapped from
     * tinted to plain in one frame, which is the one moment in the whole effect where the
     * eye could catch the machinery.
     */
    <span className={`asst-said${settled ? ' is-settled' : ''}`}>
      {words.map((word, i) => {
        if (!word.trim()) return <span key={i}>{word}</span>;
        spoken += 1;
        /**
         * Three states, not two, and each of them is a different colour job:
         *
         *   is-said + is-saying  the word on the voice's lips — full tone, halo, lifted
         *   is-said              already read — tinted, so the trail behind the voice is
         *                        visible as COLOUR and not only as brightness
         *   (nothing)            still to come — dim and slightly blurred
         *
         * The middle state is what the shopkeeper actually reads back. Brightness alone
         * made the sentence look like a progress bar made of words; colour makes it look
         * like something being read.
         */
        const cls = spoken < upto ? 'is-said' : spoken === upto ? 'is-said is-saying' : undefined;
        return (
          <span key={i} className={cls}>
            {word}
          </span>
        );
      })}
    </span>
  );
}

/**
 * What the screen shows while the advice is still being worked out.
 *
 * Not a skeleton. A row of grey bars says "a table is loading"; this says "somebody is
 * looking at your shop right now", which is both truer — nine query packs really are
 * running — and the first half-second of the app feeling like it has somebody in it.
 *
 * Exported so the page can show it in place of SkeletonCards without importing the whole
 * assistant's state.
 */
export function AssistantThinking({ label }) {
  return (
    <section className="asst asst-thinking">
      <header className="asst-head">
        <span className="asst-face is-talking"><BrandLogo size={34} /></span>
        <span className="asst-id">
          <strong>{label}</strong>
          <small className="asst-dots" aria-hidden="true"><i /><i /><i /></small>
        </span>
      </header>
    </section>
  );
}
