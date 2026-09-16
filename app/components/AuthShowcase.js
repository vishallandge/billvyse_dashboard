'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from './LanguageProvider';
import { motionIsOff } from './MotionProvider';
import AmbientBackdrop from './AmbientBackdrop';
import BrandLogo from './BrandLogo';
import { CheckCircleIcon, TrendUpIcon, ShieldIcon } from './Icons';

// Bars for the little sale-by-hour strip. Fixed values, not random: a random array would
// differ between the server render and the client one and blow up hydration, and it would
// also redraw on every keystroke in the form next to it.
const BARS = [26, 38, 31, 47, 42, 58, 51, 64, 55, 72, 66, 81, 74, 92];

const SALE = 48250;
const PROFIT = 9120;
const ROTATE_MS = 3600;

// The one-line pitch cycles on its own. It is the only thing on this panel that changes
// while somebody is typing a password, and it is deliberately slow — a shopkeeper reading
// it should finish the sentence before it moves.
function useRotator(count, enabled) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!enabled || count < 2) return undefined;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => clearInterval(timer);
  }, [count, enabled]);
  return index;
}

// Counts the day's total up from zero once, on mount. Not decoration for its own sake:
// the number is the single thing on this screen that says what the product is for, and a
// figure that lands rather than sits is what makes somebody read it at all.
function useCountUp(target, enabled) {
  const [value, setValue] = useState(enabled ? 0 : target);
  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return undefined;
    }
    const started = performance.now();
    let frame = 0;
    const tick = (now) => {
      const p = Math.min((now - started) / 1100, 1);
      // easeOutCubic — fast first, then settles, which is what reads as "counted".
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, enabled]);
  return value;
}

/**
 * The left half of every auth screen.
 *
 * It is not a stock illustration: it is a small, honest picture of the thing being signed
 * into — today's sale counting up, the hour-by-hour strip, the profit chip, a bill going
 * out on WhatsApp. Somebody who has never seen the app knows what it does before they
 * finish typing their email, which is the entire job of this panel.
 *
 * The figures inside the preview card are a sample, so that card is aria-hidden — a
 * screen reader must never be read a made-up ₹48,250 as though it were this shop's money.
 * The headline, the rotating line and the proof row are real copy and stay readable.
 */
export default function AuthShowcase({ variant = 'signin' }) {
  const { t } = useLanguage();
  const [animate, setAnimate] = useState(false);

  // Motion is opt-in from the app's own setting plus the OS one — motionIsOff() is the
  // shared reading of both, so this panel can never drift from what the rest of the app
  // considers "animate". At "Less"/"Off" it still says everything, just all at once.
  useEffect(() => {
    setAnimate(!motionIsOff());
  }, []);

  const lines = t('auth.rotate');
  const rotate = Array.isArray(lines) ? lines : [];
  const active = useRotator(rotate.length, animate);
  const sale = useCountUp(SALE, animate);

  const headline = variant === 'signup' ? t('auth.headlineSignup') : t('auth.headlineSignin');

  return (
    <aside className="auth-aside">
      <AmbientBackdrop />

      <div className="auth-aside-inner">
        <div className="auth-brandline">
          <BrandLogo size={38} className="auth-brandmark" />
          <span className="auth-brandtext">
            {/* The name is split so the V can carry the logo's green. aria-label keeps it
                one word for a screen reader; wm-enter is the one-shot brand entrance
                (globals.css, Motion system) — the login screen is a brand moment, so it
                earns it, and it plays once per visit rather than on every render. */}
            <strong className="wm-enter" aria-label={t('appName')}>
              <span>Bill</span><span className="auth-wordmark-v">V</span><span>yse</span>
            </strong>
            <em className="wm-enter-tag">{t('appTagline')}</em>
          </span>
        </div>

        <div className="auth-pitch">
          <h2 className="auth-headline">{headline}</h2>
          <p className="auth-subhead">{t('auth.subhead')}</p>
        </div>

        {/* Sample figures — see the note on the component. */}
        <div className="auth-preview" aria-hidden="true">
          <div className="auth-preview-head">
            <span className="auth-live"><i />{t('auth.liveNow')}</span>
            <span className="auth-preview-when">{t('auth.todaySale')}</span>
          </div>

          <div className="auth-preview-figure">
            <span className="auth-preview-value">₹{sale.toLocaleString('en-IN')}</span>
            <span className="auth-preview-delta"><TrendUpIcon size={13} />12%</span>
          </div>
          <p className="auth-preview-meta">{t('auth.todayMeta', { bills: 34, udhaar: '₹2,400' })}</p>

          <div className="auth-bars">
            {BARS.map((h, i) => (
              <span key={i} style={{ '--h': `${h}%`, '--i': i }} />
            ))}
          </div>

          <div className="auth-preview-foot">
            <CheckCircleIcon size={15} />
            <span>{t('auth.toast')}</span>
          </div>

          <div className="auth-profit-chip">
            {t('auth.profitLine', { profit: `₹${PROFIT.toLocaleString('en-IN')}`, pct: 19 })}
          </div>
        </div>

        {rotate.length > 0 && (
          <p className="auth-rotator">
            {/* Keyed on the index so React swaps the node and the fade-in animation
                actually re-runs; without the key it would only ever play once. */}
            <span key={active} className="auth-rotator-line">{rotate[active]}</span>
          </p>
        )}

        <div className="auth-proof">
          <span className="auth-proof-item"><strong>22</strong>{t('auth.proofTypes')}</span>
          <span className="auth-proof-item"><strong>12</strong>{t('auth.proofLangs')}</span>
          <span className="auth-proof-item auth-proof-trust"><ShieldIcon size={14} />{t('auth.proofGst')}</span>
        </div>
      </div>
    </aside>
  );
}
