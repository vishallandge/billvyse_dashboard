'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { useConfirm } from './ConfirmDialog';
import { useToast } from './Toast';
import { SpeakerIcon, PauseIcon, StopIcon, XIcon } from './Icons';

/**
 * "आज का हाल" — the shop's day, read out loud when the owner opens the dashboard.
 *
 * The words and every number come from the server (GET /api/seller/briefing), built from the
 * same functions as the Munafa card, the bell and the evening notification — this component
 * only shows them and speaks them.
 *
 * Why a button and not autoplay: every browser refuses to play sound a person has not
 * tapped for. So the card appears, the text is readable at once, and one tap reads it out.
 *
 * Seen-for-now is remembered per morning/evening on this device (a convenience only); the
 * real on/off switch is the owner's, in Settings → Notifications, and also behind "Band
 * karein" here.
 */

const SEEN_PREFIX = 'briefing-seen:';
// The greeting and the day's money; everything else is behind "read more".
const PREVIEW_PARAGRAPHS = 2;
// Hindi and Marathi share Devanagari; a phone with no Marathi voice reads Marathi well
// enough with a Hindi one. English falls back to any English voice.
const VOICE_LANGS = { hi: ['hi-IN', 'hi'], mr: ['mr-IN', 'mr', 'hi-IN', 'hi'], en: ['en-IN', 'en-GB', 'en-US', 'en'] };

function speechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

function pickVoice(lang) {
  const voices = window.speechSynthesis.getVoices() || [];
  for (const wanted of VOICE_LANGS[lang] || VOICE_LANGS.en) {
    const exact = voices.find((v) => v.lang?.toLowerCase() === wanted.toLowerCase());
    if (exact) return exact;
    const prefix = voices.find((v) => v.lang?.toLowerCase().startsWith(wanted.toLowerCase()));
    if (prefix) return prefix;
  }
  return null;
}

// Long utterances are cut off by some browsers part-way through, so each sentence is its
// own utterance. Splits on the Devanagari danda as well as ordinary sentence ends.
function sentences(text) {
  return String(text)
    .split(/(?<=[।.!?])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

function readSeen(key) {
  try {
    return localStorage.getItem(SEEN_PREFIX + key) === '1';
  } catch {
    return false;
  }
}

function writeSeen(key) {
  try {
    localStorage.setItem(SEEN_PREFIX + key, '1');
  } catch {
    /* private window — the card simply shows again next time */
  }
}

export default function VoiceBriefing() {
  const { lang, t } = useLanguage();
  const confirm = useConfirm();
  const toast = useToast();
  const [briefing, setBriefing] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [state, setState] = useState('idle'); // idle | playing | paused
  const [current, setCurrent] = useState(-1);
  const [canSpeak, setCanSpeak] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [voiceFailed, setVoiceFailed] = useState(false);
  const utteranceRef = useRef(null);
  const queueRef = useRef([]);
  const runRef = useRef(0);

  useEffect(() => {
    let active = true;
    apiFetch(`/api/seller/briefing?lang=${encodeURIComponent(lang)}`)
      .then((data) => {
        if (!active || !data?.enabled) return;
        setBriefing(data);
        setHidden(readSeen(data.key));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [lang]);

  // Voices load asynchronously in Chrome; the button only appears once one exists for this
  // language family, so a phone that cannot speak Hindi is never shown a button that is silent.
  useEffect(() => {
    if (!speechSupported() || !briefing) return undefined;
    const check = () => setCanSpeak(Boolean(pickVoice(briefing.lang)));
    check();
    window.speechSynthesis.addEventListener?.('voiceschanged', check);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', check);
  }, [briefing]);

  const stop = useCallback(() => {
    runRef.current += 1;
    queueRef.current = [];
    if (speechSupported()) window.speechSynthesis.cancel();
    setState('idle');
    setCurrent(-1);
  }, []);

  // Never keep talking after the card or the page is gone.
  useEffect(() => stop, [stop]);

  function play() {
    if (!briefing || !speechSupported()) return;
    if (state === 'paused') {
      window.speechSynthesis.resume();
      setState('playing');
      return;
    }
    stop();
    setVoiceFailed(false);
    const run = runRef.current;
    const voice = pickVoice(briefing.lang);
    const queue = [];
    briefing.paragraphs.forEach((p, index) => {
      for (const sentence of sentences(p.speech)) queue.push({ index, sentence });
    });
    queueRef.current = queue;
    let started = false;

    const next = () => {
      if (run !== runRef.current) return;
      const item = queueRef.current.shift();
      if (!item) {
        setState('idle');
        setCurrent(-1);
        writeSeen(briefing.key);
        return;
      }
      setCurrent(item.index);
      const utterance = new window.SpeechSynthesisUtterance(item.sentence);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }
      utterance.rate = 0.95;
      utterance.onstart = () => {
        started = true;
      };
      utterance.onend = next;
      utterance.onerror = next;
      // Held on to: Chrome lets an utterance nobody references be collected mid-sentence,
      // and its `onend` then never fires — the reading stopped after the first line.
      utteranceRef.current = utterance;
      // A pause left over from an earlier play would otherwise hold every new sentence.
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    };
    setState('playing');
    // Chrome drops a speak() issued in the same moment as a cancel(), so the first sentence
    // waits a beat after stop() cleared the queue.
    setTimeout(next, 150);
    // If nothing has started after a few seconds, the device has no working voice for this
    // language: say so on the card instead of leaving a button that seems to do nothing.
    setTimeout(() => {
      if (run !== runRef.current || started) return;
      stop();
      setVoiceFailed(true);
    }, 4000);
  }

  function pause() {
    if (!speechSupported()) return;
    window.speechSynthesis.pause();
    setState('paused');
  }

  function dismissForNow() {
    stop();
    if (briefing) writeSeen(briefing.key);
    setHidden(true);
  }

  async function turnOff() {
    const ok = await confirm({
      tone: 'warning',
      title: t('briefing.offTitle'),
      body: t('briefing.offBody'),
      confirmLabel: t('briefing.offConfirm'),
    });
    if (!ok) return;
    stop();
    try {
      await apiFetch('/api/seller/profile', { method: 'PUT', body: JSON.stringify({ pushPrefs: { voiceBriefing: false } }) });
      setBriefing(null);
      toast.success(t('briefing.offDone'));
    } catch (error) {
      toast.error(error.message);
    }
  }

  if (!briefing) return null;

  if (hidden) {
    // Folded to one line, so it is there when wanted and out of the way when not.
    return (
      <button type="button" className="briefing-reopen" onClick={() => setHidden(false)}>
        <SpeakerIcon size={15} /> {briefing.title}
      </button>
    );
  }

  return (
    <section className="briefing" aria-label={briefing.title}>
      <header className="briefing-head">
        <span className="briefing-badge" aria-hidden="true"><SpeakerIcon size={18} /></span>
        <h2>{briefing.title}</h2>
        <button type="button" className="icon-btn briefing-close" onClick={dismissForNow} aria-label={t('briefing.hideForNow')} data-tip={t('briefing.hideForNow')}>
          <XIcon size={17} />
        </button>
      </header>

      {/* At rest: the greeting and the day's money — the 10-second answer. The rest opens on
          "read more", and on its own while the voice is reading so the eye can follow. */}
      <div className="briefing-text">
        {briefing.paragraphs.slice(0, expanded || state !== 'idle' ? undefined : PREVIEW_PARAGRAPHS).map((p, index) => (
          <p key={index} className={index === current ? 'is-speaking' : undefined}>{p.text}</p>
        ))}
        {state === 'idle' && briefing.paragraphs.length > PREVIEW_PARAGRAPHS && (
          <button type="button" className="link-btn briefing-more" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t('briefing.readLess') : t('briefing.readMore')}
          </button>
        )}
      </div>

      <div className="briefing-actions">
        {canSpeak ? (
          <>
            {state === 'playing' ? (
              <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={pause}>
                <PauseIcon size={15} /> {t('briefing.pause')}
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-small btn-inline" onClick={play}>
                <SpeakerIcon size={15} /> {state === 'paused' ? t('briefing.resume') : t('briefing.listen')}
              </button>
            )}
            {state !== 'idle' && (
              <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={stop}>
                <StopIcon size={15} /> {t('briefing.stop')}
              </button>
            )}
          </>
        ) : (
          <span className="briefing-note">{t('briefing.noVoice')}</span>
        )}
        <button type="button" className="link-btn briefing-off" onClick={turnOff}>
          {t('briefing.turnOff')}
        </button>
      </div>
      {voiceFailed && <p className="briefing-note" role="status">{t('briefing.voiceFailed')}</p>}
    </section>
  );
}
