'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from './LanguageProvider';
import { MaximizeIcon, MinimizeIcon } from './Icons';

/**
 * Take the whole screen, on demand.
 *
 * A shop laptop is usually 1366x768 and the browser eats ~130px of that in tabs,
 * address bar and bookmarks — on the billing screen that is two product rows, and on
 * the khata list it is three customers. F11 already does this on a desktop browser,
 * but the two places it matters most are exactly the two where F11 does not exist:
 * the installed PWA and a counter tablet. So it gets a button.
 *
 * It is a toggle, not a "go fullscreen" action, and the icon always shows what the
 * NEXT tap does. State is read from the browser rather than remembered locally,
 * because fullscreen can end without us: Esc, F11, the OS, or another tab. A local
 * boolean would drift out of sync the first time any of those happened and leave the
 * button lying about what it will do.
 *
 * Deliberately not persisted across page loads. Every browser requires a user
 * gesture to enter fullscreen, so "restore on load" cannot work — it would silently
 * fail and the app would look broken to whoever turned it on.
 */

// Safari (desktop and iPad) still ships this only under the webkit prefix, and a
// counter tablet is a real deployment for this app. IE-era `ms` is here because it
// costs one line and some kiosk shells are still built on it.
function fullscreenElement() {
  if (typeof document === 'undefined') return null;
  return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
}

function canFullscreen() {
  if (typeof document === 'undefined') return false;
  const root = document.documentElement;
  return Boolean(root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen);
}

export default function FullscreenToggle({ className = 'bell-btn' }) {
  const { t } = useLanguage();
  // Both start false on the server AND on the first client render: `canFullscreen()`
  // reads the DOM, so deciding whether to render at paint time would make the server
  // and client markup disagree. The effect below settles it one tick later.
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    setSupported(canFullscreen());

    function sync() {
      setActive(Boolean(fullscreenElement()));
    }
    sync();
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  const toggle = useCallback(() => {
    const root = document.documentElement;
    if (fullscreenElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      // Rejects if the document already left fullscreen between the click and here.
      // Nothing to tell the shopkeeper — the change event has already corrected the icon.
      exit?.call(document)?.catch?.(() => {});
      return;
    }
    const request = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
    // `navigationUI: 'hide'` is a hint, not a demand; browsers that don't know the
    // option ignore the whole argument rather than throwing.
    request?.call(root, { navigationUI: 'hide' })?.catch?.(() => {});
  }, []);

  if (!supported) return null;

  const label = active ? t('common.exitFullscreen') : t('common.fullscreen');

  return (
    <button type="button" className={className} onClick={toggle} aria-label={label} data-tip={label} aria-pressed={active}>
      {active ? <MinimizeIcon size={18} /> : <MaximizeIcon size={18} />}
    </button>
  );
}
