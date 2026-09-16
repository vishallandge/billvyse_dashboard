// Voice search for the counter.
//
// A shopkeeper billing with one hand on a weighing scale and a queue in front of them
// cannot type "Fortune Sunflower Oil". Speaking it is the fastest input a phone has, and
// it is the difference between this app being usable during the evening rush and being
// abandoned for a paper pad.
//
// Uses the browser's own Web Speech API — no cloud service, no API key, no audio ever
// leaving the device beyond what the browser itself does. Chrome and Edge on Android and
// desktop support it well; iOS Safari does not, so callers must check isVoiceSearchSupported()
// and simply not render the button rather than showing one that fails.

// A kirana's speech is code-mixed — "do kilo cheeni" — so recognition runs in the
// shopkeeper's chosen dashboard language, with Indian English as the fallback because it
// handles brand names ("Colgate", "Parle-G") far better than the Indic models do.
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

function getRecognition() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isVoiceSearchSupported() {
  return Boolean(getRecognition());
}

// Numbers spoken in Hindi/Marathi come back as words far more often than digits, and a
// quantity is the one thing that has to be exact on a bill. Mapping the first twenty
// covers essentially every kirana quantity ("paanch kilo aata", "do packet").
const SPOKEN_NUMBERS = {
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhah: 6, cheh: 6, chai: 6,
  saat: 7, aath: 8, nau: 9, das: 10, gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15,
  solah: 16, satrah: 17, atharah: 18, unnis: 19, bees: 20, aadha: 0.5, adha: 0.5, pav: 0.25,
  paav: 0.25, dedh: 1.5, derh: 1.5, dhai: 2.5, sava: 1.25,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  half: 0.5, quarter: 0.25,
};

// Pulls a leading quantity out of a spoken phrase so "do kilo cheeni" can add 2 of the
// matched product instead of searching for the literal string. Returns the remaining
// text to search with, plus the quantity if one was clearly spoken.
export function parseSpokenQuery(transcript) {
  const text = String(transcript || '').trim().toLowerCase();
  if (!text) return { text: '', quantity: null };

  const words = text.split(/\s+/);
  let quantity = null;
  let consumed = 0;

  const first = words[0];
  if (/^\d+(\.\d+)?$/.test(first)) {
    quantity = Number(first);
    consumed = 1;
  } else if (SPOKEN_NUMBERS[first] !== undefined) {
    quantity = SPOKEN_NUMBERS[first];
    consumed = 1;
  }

  // Drop a unit word if it follows the number — it identifies the product's unit, not
  // its name, so leaving it in would wreck the name match.
  const UNITS = ['kilo', 'kg', 'gram', 'gm', 'litre', 'liter', 'ltr', 'ml', 'packet', 'paket', 'piece', 'pcs', 'dozen', 'box', 'peti'];
  if (quantity !== null && words[consumed] && UNITS.includes(words[consumed])) {
    consumed += 1;
  }

  return { text: words.slice(consumed).join(' ').trim() || text, quantity };
}

// Starts one listening session. Returns a handle with stop(), or null when unsupported.
//
// Non-continuous by design: at a counter you want one phrase, acted on immediately, mic
// off. A continuous stream would keep picking up the customer, the street and the fan.
export function startVoiceSearch({ lang = 'en', onResult, onError, onEnd, interim = true } = {}) {
  const Recognition = getRecognition();
  if (!Recognition) return null;

  const recognition = new Recognition();
  recognition.lang = LOCALE_BY_LANG[lang] || 'en-IN';
  recognition.continuous = false;
  recognition.interimResults = interim;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const transcript = result[0]?.transcript || '';
    onResult?.({ transcript, isFinal: result.isFinal, ...parseSpokenQuery(transcript) });
  };

  recognition.onerror = (event) => {
    // 'aborted' is what a deliberate stop() produces — not worth alarming anyone about.
    if (event.error !== 'aborted') onError?.(event.error);
  };

  recognition.onend = () => onEnd?.();

  try {
    recognition.start();
  } catch {
    // start() throws if a session is already running; treat it as already-listening.
    return { stop: () => recognition.abort() };
  }

  return { stop: () => recognition.abort() };
}
