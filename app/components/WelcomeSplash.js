'use client';

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from './LanguageProvider';
import { usePrintLogo } from '../../lib/printer/logo';
import { freshFetch } from '../../lib/freshFetch';

/**
 * The shop's own logo, for three seconds, when the day starts — an experiment.
 *
 * A moment, not a screen: nothing waits for it and nothing else changes. It only appears
 *   • on the Overview (never over billing or any worked screen),
 *   • for a shop that has uploaded a logo,
 *   • once a day per device (a reload does not replay it),
 *   • while the super admin has "Welcome splash" on in Admin → Modules (on by default),
 *   • and not at all when this device's motion setting is "off".
 * A tap anywhere, Esc, or "Skip" ends it at once.
 *
 * Motion follows the house rules: every duration scales with --motion-scale, "reduced" is a
 * plain fade, and there is no sheen, sweep or glint — the rings draw once and stop.
 * Rendered into <body> (a .panel's transform would trap a fixed overlay).
 */

const SEEN_PREFIX = 'dukaan_splash_seen:';
const HOLD_MS = 3200;
const EXIT_MS = 420;

const COPY = {
  hi: { morning: 'सुप्रभात', day: 'नमस्ते', evening: 'शुभ संध्या', ready: 'आपकी दुकान तैयार है', skip: 'छोड़ें', suffix: ' जी' },
  mr: { morning: 'सुप्रभात', day: 'नमस्कार', evening: 'शुभ संध्याकाळ', ready: 'तुमचे दुकान तयार आहे', skip: 'वगळा', suffix: ' जी' },
  en: { morning: 'Good morning', day: 'Good afternoon', evening: 'Good evening', ready: 'Your shop is ready', skip: 'Skip', suffix: '' },
};

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function seenToday(shopId) {
  try {
    return localStorage.getItem(SEEN_PREFIX + shopId) === todayKey();
  } catch {
    return true; // storage blocked: never risk showing it on every load
  }
}

function markSeen(shopId) {
  try {
    localStorage.setItem(SEEN_PREFIX + shopId, todayKey());
  } catch {
    /* nothing to remember with */
  }
}

function motionLevel() {
  const set = document.documentElement.getAttribute('data-motion');
  if (set === 'off') return 'off';
  if (set === 'reduced') return 'reduced';
  if (set !== 'full' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'reduced';
  return 'full';
}

export default function WelcomeSplash({ user }) {
  const { lang } = useLanguage();
  const logoUrl = usePrintLogo(user);
  const shopId = String((user?.role === 'staff' ? user?.shop : user?.id || user?._id) || '');
  const [allowed, setAllowed] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | in | out | done
  const [motion, setMotion] = useState('full');

  // The super admin's switch — read off the same cached answer the sidebar uses.
  useEffect(() => {
    if (!shopId) return undefined;
    let active = true;
    freshFetch('/api/seller/modules', { ttl: 60000 })
      .then((data) => {
        if (active) setAllowed(data?.modules?.welcomeSplash !== false);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [shopId]);

  useEffect(() => {
    if (!allowed || !logoUrl || !shopId || phase !== 'idle') return;
    if (seenToday(shopId)) return;
    const level = motionLevel();
    if (level === 'off') return;
    markSeen(shopId);
    setMotion(level);
    setPhase('in');
  }, [allowed, logoUrl, shopId, phase]);

  const close = useCallback(() => {
    setPhase((p) => (p === 'in' ? 'out' : p));
  }, []);

  useEffect(() => {
    if (phase === 'in') {
      const hold = setTimeout(close, motion === 'reduced' ? 1600 : HOLD_MS);
      const onKey = (event) => {
        if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') close();
      };
      window.addEventListener('keydown', onKey);
      return () => {
        clearTimeout(hold);
        window.removeEventListener('keydown', onKey);
      };
    }
    if (phase === 'out') {
      const end = setTimeout(() => setPhase('done'), EXIT_MS);
      return () => clearTimeout(end);
    }
    return undefined;
  }, [phase, motion, close]);

  if (phase === 'idle' || phase === 'done' || typeof document === 'undefined') return null;

  const t = COPY[lang] || COPY.en;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t.morning : hour < 17 ? t.day : t.evening;
  const first = String(user?.name || '').trim().split(/\s+/)[0];
  const shopName = user?.shopName || '';

  return createPortal(
    <div
      className={`ws ws--${phase} ws--${motion}`}
      role="dialog"
      aria-modal="true"
      aria-label={shopName || 'BillVyse'}
      onClick={close}
    >
      <div className="ws-stage">
        <div className="ws-mark">
          <svg className="ws-rings" viewBox="0 0 220 220" aria-hidden="true">
            <circle className="ws-ring ws-ring--outer" cx="110" cy="110" r="104" />
            <circle className="ws-ring ws-ring--inner" cx="110" cy="110" r="92" />
          </svg>
          <div className="ws-plate">
            <img src={logoUrl} alt="" />
          </div>
        </div>
        {shopName && <h1 className="ws-name">{shopName}</h1>}
        <p className="ws-greet">
          {greeting}
          {first ? `, ${first}${t.suffix}` : ''}
        </p>
        <p className="ws-ready">{t.ready}</p>
      </div>
      <button type="button" className="ws-skip" onClick={close}>
        {t.skip}
      </button>
      <span className="ws-brand" aria-hidden="true">BillVyse</span>
    </div>,
    document.body
  );
}
