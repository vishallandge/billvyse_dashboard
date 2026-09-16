/**
 * THE ASSISTANT'S VOICE — it reads the morning out loud.
 *
 * ---------------------------------------------------------------------------
 * Why this is worth having
 * ---------------------------------------------------------------------------
 * A shopkeeper opening the shutter at eight in the morning has both hands full and is not
 * reading anything. He is stacking crates, sweeping, putting the till in. The single most
 * useful thing the app can do in that minute is TELL him — "Ramesh ji, do bill hold pe
 * pade hain, ₹1,840 ka maal" — while he carries on working.
 *
 * It is also, plainly, the moment the app stops feeling like a form and starts feeling
 * like somebody is there.
 *
 * ---------------------------------------------------------------------------
 * It costs nothing, and that is not an accident
 * ---------------------------------------------------------------------------
 * This is `window.speechSynthesis` — the browser's OWN voice, the same family of API that
 * lib/voiceSearch.js uses for the counter's microphone. No cloud service, no API key, no
 * per-message cost, and nothing about the shop's money leaves the device. A thousand shops
 * listening to their advice every morning costs the platform exactly ₹0.
 *
 * That matters more here than anywhere else in the app. The obvious "assistant with a
 * voice" is a paid text-to-speech service billed per character, and the numbers being read
 * out are a shop's takings and its udhaar — which would then be leaving the phone to be
 * spoken. This does neither.
 *
 * ---------------------------------------------------------------------------
 * Three rules it must obey
 * ---------------------------------------------------------------------------
 * 1. NEVER SPEAKS ON ITS OWN. Every browser blocks audio that starts without a tap, and
 *    quite right: a shop tablet that suddenly announces "₹18,000 wholesaler ko dena hai"
 *    in front of a customer is a serious thing to do to somebody. The speaker button is
 *    the only way it ever starts.
 * 2. STOPS INSTANTLY. `cancel()` on the button, on leaving the screen, on any tap that
 *    changes the list. A voice that keeps talking after you have moved on is the fastest
 *    way to make somebody switch it off forever.
 * 3. SAYS THE MONEY PROPERLY. "₹1,840" is read as a symbol and a comma-separated string by
 *    most engines — see speakable() below.
 */

/** Whether this browser can speak at all. iOS Safari can (unlike voice INPUT, which it cannot). */
export function isVoiceSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';
}

/**
 * The shopkeeper's own language, as a BCP-47 tag.
 *
 * Mirrors LOCALE_BY_LANG in lib/voiceSearch.js on purpose: the microphone and the voice
 * must be the same language, or the app listens in Hindi and answers in English.
 * Everything else falls back to Indian English, which handles brand names and rupee
 * figures far better than an unsupported Indic voice does.
 */
const LOCALE_BY_LANG = {
  en: 'en-IN',
  hi: 'hi-IN',
  mr: 'mr-IN',
  bn: 'bn-IN',
  ta: 'ta-IN',
  te: 'te-IN',
  gu: 'gu-IN',
  kn: 'kn-IN',
  pa: 'pa-IN',
  ur: 'ur-IN',
};

/** The word for "rupees", so the ₹ sign is spoken rather than skipped. */
const RUPEES = { en: 'rupees', hi: 'रुपये', mr: 'रुपये' };

export function voiceLocale(lang) {
  return LOCALE_BY_LANG[lang] || 'en-IN';
}

/**
 * THE VOICE LIST DOES NOT EXIST YET WHEN YOU FIRST ASK FOR IT.
 *
 * `speechSynthesis.getVoices()` returns `[]` on the first call in Chrome and fills in
 * asynchronously afterwards, announcing itself with `voiceschanged`. Reading it
 * synchronously — which is the obvious way to write this, and how it was written first —
 * means the very first tap finds no voices, picks none, and the browser is left to guess
 * from `utter.lang` alone. On a locale it has no voice for, that guess is SILENCE: no
 * error, no event, nothing said. Which is exactly what "voice sahi nahi aa raha" is.
 *
 * Resolves immediately when the list is already populated, so only the first tap of a
 * session ever waits. The 1.2s ceiling is there because some builds never fire the event
 * at all — better to go ahead with whatever is available than to sit silent forever.
 */
export function loadVoices() {
  if (!isVoiceSupported()) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const ready = synth.getVoices() || [];
  if (ready.length) return Promise.resolve(ready);

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      synth.removeEventListener?.('voiceschanged', finish);
      resolve(synth.getVoices() || []);
    };
    const timer = setTimeout(finish, 1200);
    synth.addEventListener?.('voiceschanged', finish);
  });
}

/**
 * Devanagari is Devanagari.
 *
 * Marathi shares its script and most of its phonetics with Hindi, and almost no phone or
 * laptop ships an `mr-IN` voice — Windows has none at all, and most Android builds have
 * none either. Handing `utter.lang = 'mr-IN'` to an engine with no Marathi voice produces
 * nothing, so a Marathi shopkeeper got a speaker button that did precisely nothing when
 * tapped.
 *
 * A Hindi voice reading Marathi text is not perfect — the intonation is a shade off and a
 * few vowel endings are wrong — but it is completely intelligible, and it is enormously
 * better than silence. The same fallback is why Konkani and Nepali would work if the app
 * ever added them.
 */
const SCRIPT_FALLBACK = {
  mr: ['hi-IN', 'hi'],
  hi: ['mr-IN', 'hi'],
  // The Indian English voice is not on every machine either; a US or UK voice reads a
  // rupee figure perfectly well.
  en: ['en-GB', 'en-US', 'en'],
};

/**
 * The best voice this device has for a language, or `null` if it genuinely has none.
 *
 * The ladder, most specific first:
 *   1. the exact locale        — mr-IN
 *   2. any voice for that language at all  — mr-*
 *   3. the script fallback     — a Hindi voice for Marathi (see above)
 *   4. ANY English voice       — the last thing that will at least read the rupee figures
 *
 * `null` is a real and important answer, not a failure to handle: the caller uses it to
 * hide the speaker button rather than offer one that does nothing. A dead button is worse
 * than no button, because the shopkeeper concludes the whole feature is broken.
 */
export function matchVoice(voices, lang) {
  const list = voices || [];
  if (!list.length) return { voice: null, quality: null };
  const locale = voiceLocale(lang);
  const base = locale.split('-')[0];
  const tagOf = (v) => (v.lang || '').replace('_', '-');

  const byExact = list.find((v) => tagOf(v) === locale);
  if (byExact) return { voice: byExact, quality: 'exact' };

  const byLang = list.find((v) => tagOf(v).startsWith(`${base}-`) || tagOf(v) === base);
  if (byLang) return { voice: byLang, quality: 'exact' };

  for (const tag of SCRIPT_FALLBACK[base] || []) {
    const hit = list.find((v) => tagOf(v) === tag || tagOf(v).startsWith(`${tag}-`));
    // 'script' for a Devanagari stand-in reading Devanagari; the English ladder inside
    // SCRIPT_FALLBACK.en is still English reading English, so it is not a substitution the
    // shopkeeper needs to be told about.
    if (hit) return { voice: hit, quality: base === 'en' ? 'exact' : 'script' };
  }

  const english = list.find((v) => tagOf(v).startsWith('en'));
  if (english) return { voice: english, quality: 'foreign' };

  return { voice: null, quality: null };
}

/** The voice itself, for callers that do not care how good the match was. */
export function pickVoice(voices, lang) {
  return matchVoice(voices, lang).voice;
}

/**
 * Can this device speak this language, and HOW WELL.
 *
 * ---------------------------------------------------------------------------
 * Why the caller is told the quality and not just yes/no
 * ---------------------------------------------------------------------------
 * Almost no device ships a Marathi voice. Windows has none at all; most Android builds
 * have none until somebody installs the voice data. So the honest options for a Marathi
 * shopkeeper are a Hindi voice reading Marathi text — which is completely intelligible and
 * audibly NOT Marathi — or silence.
 *
 * Reading it in Hindi and saying nothing about it is the one option that is not allowed.
 * The shopkeeper notices immediately ("Marathi jaisa feel hi nahi ho raha"), and an app
 * that quietly passes one language off as another has told a small lie about something the
 * user can hear. So the screen says which voice it is using and how to get the right one —
 * see `advice.asst.voiceSubbed`. It is a two-minute device setting, and only the shopkeeper
 * can do it; the app's job is to know, and to say.
 *
 *   'exact'   — a voice for this language.
 *   'script'  — a stand-in that shares the script (Hindi reading Marathi). Say so.
 *   'foreign' — English reading Devanagari. Barely usable; say so louder.
 *   null      — nothing at all. The button is not drawn.
 */
export async function voiceQuality(lang) {
  if (!isVoiceSupported()) return null;
  return matchVoice(await loadVoices(), lang).quality;
}

/** Whether this device can actually say something in this language. */
export async function canSpeakLang(lang) {
  return Boolean(await voiceQuality(lang));
}

/**
 * Turn a sentence written for the EYE into one written for the EAR.
 *
 * Three fixes, each of which was audibly wrong without it:
 *
 *   ₹1,840   -> "1840 rupees". The symbol is silently dropped by most engines, so the
 *               single most important word in the sentence — that this is MONEY — simply
 *               never got said.
 *   1,840    -> "1840". Indian grouping makes some engines read digits one at a time, and
 *               "one, eight, four, zero" is not a number anybody can hold.
 *   —        -> a comma. An em dash is read as nothing, so two clauses ran together into
 *               one breathless sentence.
 */
export function speakable(text, lang) {
  const rupees = RUPEES[lang] || RUPEES.en;
  return String(text || '')
    .replace(/₹\s?([\d,]+)/g, (_, digits) => `${digits.replace(/,/g, '')} ${rupees}`)
    .replace(/(\d),(?=\d)/g, '$1')
    .replace(/[—–]/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Say a list of lines, one after another, calling back as each one starts.
 *
 * The callback is what makes this feel like being read to rather than like a recording:
 * the message currently being spoken lights up on screen, so the eye follows the voice
 * down the page. That one line of feedback is most of the effect.
 *
 * Returns a stop() function. Call it on unmount — a voice still talking about a screen the
 * shopkeeper has left is worse than no voice at all.
 */
export function speakLines(lines, { lang = 'en', onLine, onWord, onVoice, onDone } = {}) {
  if (!isVoiceSupported()) return () => {};

  const synth = window.speechSynthesis;
  // Anything already queued belongs to a tap that has been superseded.
  synth.cancel();

  let stopped = false;
  let index = 0;
  let chosen = null;

  /**
   * CHROME STOPS TALKING AFTER ABOUT FIFTEEN SECONDS.
   *
   * A long-standing engine bug: the synthesiser goes quiet mid-queue and never resumes, so
   * a shopkeeper with six pieces of advice hears the first two and then nothing. A
   * pause/resume pair nudges it along without any audible seam. Cheap, and it stops the
   * moment there is nothing being said.
   */
  const keepAlive = setInterval(() => {
    if (stopped) return;
    if (synth.speaking && !synth.paused) {
      try {
        synth.pause();
        synth.resume();
      } catch {
        // Some engines do not implement pause. Nothing to do; they also do not stall.
      }
    }
  }, 9000);

  const finish = () => {
    clearInterval(keepAlive);
    onDone?.();
  };

  const next = () => {
    if (stopped) return;
    if (index >= lines.length) {
      finish();
      return;
    }
    const line = lines[index];
    const text = speakable(line.text, lang);
    index += 1;
    if (!text) return next();

    onLine?.(line.key ?? null);

    const utter = new SpeechSynthesisUtterance(text);
    /**
     * THE LANGUAGE TAG COMES FROM THE VOICE THAT WAS FOUND, never from what was asked for.
     *
     * Setting `utter.lang = 'mr-IN'` on a device with no Marathi voice makes the engine say
     * nothing at all — silently, with no error and no event. So the tag is taken from the
     * voice actually selected by the ladder in pickVoice(): a Marathi shopkeeper on a
     * machine with only Hindi installed gets `hi-IN` and hears their advice, rather than a
     * button that appears to do nothing.
     */
    if (chosen) {
      utter.voice = chosen;
      utter.lang = chosen.lang;
    }
    // Slightly under natural pace. These are rupee figures a person is meant to take in
    // while doing something else, and the default rate reads them like a news bulletin.
    utter.rate = 0.95;
    utter.pitch = 1;

    /**
     * HOW FAR THROUGH THE SENTENCE THE VOICE IS — reported as a 0..1 fraction.
     *
     * This is the whole "it is really talking" effect: the screen lights the words up as
     * they are said, so the sentence is being READ TO somebody rather than displayed while
     * a sound plays somewhere.
     *
     * A FRACTION and not a character index, deliberately. `charIndex` counts into the
     * SPOKEN string, which speakable() has already rewritten — "₹1,840" became "1840
     * rupees" — so it cannot be used to find a position in the sentence on screen. The
     * fraction survives that rewrite: two thirds of the way through the spoken line is two
     * thirds of the way through the written one, near enough that a one-word drift is
     * invisible and far more robust than trying to keep an index mapping in step.
     *
     * `onboundary` is not fired by every engine (some Android builds stay silent on it).
     * When it never arrives the sentence simply stays lit as a whole, which is the correct
     * degradation — nothing looks broken, there is just no word-level follow.
     */
    utter.onboundary = (event) => {
      if (stopped || !onWord) return;
      const at = Number(event.charIndex);
      if (!Number.isFinite(at) || !text.length) return;
      onWord(line.key ?? null, Math.min(1, Math.max(0, at / text.length)));
    };

    utter.onend = next;
    // A failed utterance must not stall the queue — an engine that cannot say one line
    // should still say the rest.
    utter.onerror = next;
    synth.speak(utter);
  };

  /**
   * The voice list is resolved BEFORE the first word, and the small delay afterwards is
   * not padding: `cancel()` followed immediately by `speak()` drops the first utterance on
   * several Chrome builds, so the greeting would go missing and the assistant would appear
   * to start halfway through its own sentence.
   */
  loadVoices().then((voices) => {
    if (stopped) return;
    const match = matchVoice(voices, lang);
    chosen = match.voice;
    onVoice?.(match.quality, match.voice?.name || '');
    setTimeout(() => { if (!stopped) next(); }, 60);
  });

  return () => {
    stopped = true;
    clearInterval(keepAlive);
    try {
      synth.cancel();
    } catch {
      // Nothing to cancel, or the tab is going away. Either way there is nothing to do.
    }
    onLine?.(null);
  };
}

/** Stop whatever is being said, from anywhere. */
export function stopSpeaking() {
  if (!isVoiceSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // non-fatal
  }
}

/**
 * THERE IS DELIBERATELY NO REMEMBERED "VOICE ON" PREFERENCE.
 *
 * A stored preference was written here first and then removed, because it could not
 * legitimately be used for anything. Its only purpose would be to start the voice on the
 * next visit — and the voice may never start without a tap: every browser blocks audio
 * that begins without a gesture, and independently of that, a counter tablet announcing
 * "₹18,000 wholesaler ko dena hai" in front of a customer as the page loads is a thing you
 * apologise for.
 *
 * So it would have been a value written on every tap and read by nobody. The speaker
 * button is the whole state, and it lasts exactly as long as the screen is open.
 */
