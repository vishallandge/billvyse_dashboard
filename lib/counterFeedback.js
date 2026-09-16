/**
 * The sound a counter makes.
 *
 * A shopkeeper working a hardware scanner does not look at the screen — they look at the
 * next packet in the crate. The only way they learn that a scan landed is the reader's own
 * beep, and half the cheap readers sold in India have that beeper switched off or broken.
 * So the app makes the sound itself: a short blip when a line goes on the bill, a low buzz
 * when a code resolved to nothing, a two-note chime when the bill is done.
 *
 * Synthesised, never a file: an audio asset is one more thing to ship, cache, fail to load
 * over a shop's 2G tether, and get wrong in the PWA's offline manifest. An oscillator is
 * always available and costs nothing.
 *
 * Everything here is best-effort. A blocked AudioContext, a device with no vibrator, a
 * browser that has not seen a gesture yet — none of it may ever interrupt a sale, so every
 * path swallows its own failure.
 */

const SOUND_KEY = 'dukaan_counter_sound';

let ctx = null;

function audioContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  // Chrome suspends the context until a gesture. Every call site here IS a gesture (a tap,
  // a keypress, a scanner's Enter), so resuming lazily is enough and needs no unlock ritual.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function isCounterSoundOn() {
  if (typeof localStorage === 'undefined') return true;
  try {
    // Default ON. A counter that wants silence says so once; a counter that never opens
    // the setting still gets the confirmation it needs when a scan lands.
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setCounterSoundOn(on) {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    /* a full or blocked localStorage is not worth failing a sale over */
  }
}

// frequency, seconds, start-offset, waveform — one short envelope so nothing clicks.
function tone(ac, freq, duration, delay = 0, type = 'sine', peak = 0.14) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  const at = ac.currentTime + delay;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

/**
 * `kind` is what happened, not what to play — so the whole counter's sound design can be
 * retuned here without touching the billing screen.
 *
 *   add    a line went on the bill
 *   error  the code/name resolved to nothing, or the line was refused
 *   done   the bill was created
 */
export function counterFeedback(kind) {
  if (typeof window === 'undefined') return;

  // Haptics go out even when sound is off: a phone in a noisy shop is the one case where
  // the buzz IS the feedback, and it is silent by definition.
  try {
    if (navigator.vibrate) {
      navigator.vibrate(kind === 'error' ? [40, 60, 40] : kind === 'done' ? [18, 50, 18] : 14);
    }
  } catch {
    /* vibration is a nicety, never a requirement */
  }

  if (!isCounterSoundOn()) return;
  const ac = audioContext();
  if (!ac) return;
  try {
    if (kind === 'add') {
      tone(ac, 1180, 0.06, 0, 'triangle', 0.1);
    } else if (kind === 'error') {
      tone(ac, 196, 0.16, 0, 'square', 0.09);
      tone(ac, 165, 0.18, 0.1, 'square', 0.09);
    } else if (kind === 'done') {
      tone(ac, 784, 0.1, 0, 'sine', 0.12);
      tone(ac, 1175, 0.16, 0.09, 'sine', 0.12);
    }
  } catch {
    /* an audio graph that refuses to build must not take the bill down with it */
  }
}
