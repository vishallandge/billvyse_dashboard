'use client';

import { useEffect, useRef, useState } from 'react';
import { isVoiceSearchSupported, startVoiceSearch } from '../../lib/voiceSearch';
import { useLanguage } from './LanguageProvider';
import { useToast } from './Toast';
import { MicIcon } from './Icons';

/**
 * Mic button for any search box. Renders nothing at all where the browser can't do speech
 * recognition (notably iOS Safari) — a button that fails on tap is worse than no button.
 *
 * It renders one element and nothing else — a bare `<button>`. That is a hard rule here,
 * arrived at by getting it wrong twice:
 *
 *  1. It used to return a fragment: the button *and* a sibling `<span class="voice-error">`
 *     carrying `width: 100%`. As a flex item that span claimed the entire row the moment
 *     someone denied the mic permission, squeezing the search field beside it down to
 *     min-content — billing's label and hint rendered one character per line.
 *  2. Making the message an absolutely-positioned popover fixed the squeeze but not the
 *     problem: `.panel` sets `overflow-x: auto`, and CSS will not let one axis scroll while
 *     the other stays visible — so the panel's `overflow-y` computes to `auto` too, and a
 *     popover hanging past its bottom edge was clipped *and* grew a scrollbar on the panel.
 *
 * The lesson both times is that a component dropped into somebody else's box cannot own
 * pixels outside its own. So the message goes to the app-wide toast layer, which is fixed
 * to the viewport and belongs to no panel, and the button keeps a standing red state so the
 * reason is still discoverable (via its tooltip) after the toast has gone.
 */
export default function VoiceSearchButton({ onResult, title, size = 18 }) {
  const { lang, t } = useLanguage();
  const toast = useToast();
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState('');
  const sessionRef = useRef(null);

  // Support is checked after mount: `window` doesn't exist during SSR, and rendering the
  // button on the server then removing it on hydration causes a visible flicker.
  useEffect(() => {
    setSupported(isVoiceSearchSupported());
    return () => sessionRef.current?.stop();
  }, []);

  // Says it once, in the toast layer, and leaves the button red afterwards. Not cleared on
  // a timer: a blocked mic stays blocked until the shopkeeper actually changes the browser
  // setting, so the standing state is the truth. `toggle` clears it on the next attempt.
  function report(message) {
    setError(message);
    toast.error(message);
  }

  function toggle() {
    if (listening) {
      sessionRef.current?.stop();
      setListening(false);
      return;
    }

    setError('');
    const session = startVoiceSearch({
      lang,
      onResult: ({ transcript, isFinal, text, quantity }) => {
        // Interim results stream into the box so the shopkeeper sees it working; only the
        // final one carries the parsed quantity and is safe to act on.
        onResult?.({ transcript, isFinal, text, quantity });
      },
      onError: (code) => {
        report(
          code === 'not-allowed' || code === 'service-not-allowed'
            ? t('seller.voiceMicDenied')
            : t('seller.voiceFailed')
        );
        setListening(false);
      },
      onEnd: () => setListening(false),
    });

    if (!session) {
      report(t('seller.voiceFailed'));
      return;
    }
    sessionRef.current = session;
    setListening(true);
  }

  if (!supported) return null;

  // One element. Nothing beside it, nothing floating out of it — see the note above.
  return (
    <button
      type="button"
      className={`icon-btn voice-btn${listening ? ' listening' : ''}${error ? ' errored' : ''}`}
      onClick={toggle}
      // The standing red state needs a reason attached to it, and the tooltip is the one
      // place that costs no layout at all.
      data-tip={error || title || t('seller.voiceSearch')}
      aria-label={error ? `${title || t('seller.voiceSearch')} — ${error}` : title || t('seller.voiceSearch')}
      aria-pressed={listening}
    >
      <MicIcon size={size} />
    </button>
  );
}
