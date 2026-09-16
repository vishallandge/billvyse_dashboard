'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from './LanguageProvider';
import { motionIsOff } from './MotionProvider';
import { greetingFor } from '../../lib/greeting';
import BrandLogo from './BrandLogo';

// How long the moment holds before it dissolves, and how long the dissolve takes. Short
// on purpose: this sits between a shopkeeper and their counter, and the second login of
// the day must not feel like a toll booth.
const HOLD_MS = 1500;
const EXIT_MS = 420;
// With motion off it is not an animation any more, just a card that appears — so it gets
// only long enough to be read, not long enough to be waited on.
const HOLD_MS_STILL = 700;

/**
 * The one-shot "welcome back" shown immediately after a sign-in.
 *
 * Fires on a real login only — the login page parks a sessionStorage flag and the shell
 * consumes it — so a refresh, a tab restore or ordinary navigation never replays it.
 *
 * Rules it lives by:
 *  - it is never the only way to reach anything, so it can be skipped by any click, any
 *    key or a scroll, and it dismisses itself regardless;
 *  - it names the person, not the product. "Welcome to BillVyse" is an ad; "Shubh
 *    sandhya, Ramesh" is a greeting, and only one of those is worth 1.5 seconds;
 *  - every duration is scaled by --motion-scale like the rest of the motion system, and
 *    the JS timer shortens itself when motion is off — a 0ms animation with a 1.5s wait
 *    is just a freeze.
 *
 * Portalled to <body>: an ancestor with a transform (`.panel`'s entry animation leaves
 * one) becomes the containing block for position:fixed, which would trap this inside a
 * card instead of covering the page.
 */
export default function WelcomeOverlay({ name, shopName, onDone }) {
  const { lang } = useLanguage();
  const [mounted, setMounted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [hour, setHour] = useState(null);
  const doneRef = useRef(false);

  useEffect(() => setMounted(true), []);

  // Read after mount so the server render and the first client render agree — the clock
  // is the one thing on this overlay that cannot be known ahead of time.
  useEffect(() => setHour(new Date().getHours()), []);

  useEffect(() => {
    if (!mounted) return undefined;

    const still = motionIsOff();
    const hold = still ? HOLD_MS_STILL : HOLD_MS;

    function finish() {
      if (doneRef.current) return;
      doneRef.current = true;
      setLeaving(true);
      window.setTimeout(onDone, still ? 0 : EXIT_MS);
    }

    const timer = window.setTimeout(finish, hold);
    // Any sign of a person wanting to get on with their day ends it early.
    window.addEventListener('pointerdown', finish);
    window.addEventListener('keydown', finish);
    window.addEventListener('wheel', finish, { passive: true });

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', finish);
      window.removeEventListener('keydown', finish);
      window.removeEventListener('wheel', finish);
    };
  }, [mounted, onDone]);

  if (!mounted) return null;

  const greeting = hour === null ? '' : greetingFor(lang, hour);

  return createPortal(
    <div className={`welcome-veil${leaving ? ' is-leaving' : ''}`} role="status" aria-live="polite">
      <div className="welcome-core">
        <span className="welcome-ring" aria-hidden="true" />
        <span className="welcome-halo" aria-hidden="true" />
        <BrandLogo size={62} className="welcome-mark" />
      </div>

      <p className="welcome-greet">{greeting}</p>
      {name && <h2 className="welcome-name">{name}</h2>}
      {shopName && <p className="welcome-shop">{shopName}</p>}

      {/* Fills over exactly the hold, so the length of the moment is visible rather than
          something to wonder about. */}
      <span className="welcome-bar" aria-hidden="true"><i /></span>
    </div>,
    document.body
  );
}
