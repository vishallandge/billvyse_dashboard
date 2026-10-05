'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from './LanguageProvider';
import { formatMoney } from '../../lib/format';

const DURATION_MS = 700;
// Cubic ease-out: fast off the mark, settles gently — the number lands rather than stops.
const ease = (t) => 1 - Math.pow(1 - t, 3);

/**
 * Counts a stat card's value up from its previous figure instead of snapping to it.
 * Motion is skipped entirely for users who ask for reduced motion, and for the very
 * first paint after a re-login (from 0 the count-up is the point, so that one animates).
 */
export default function AnimatedNumber({ value, prefix = '', suffix = '', decimals = true, duration = DURATION_MS, from }) {
  const { lang } = useLanguage();
  const target = Number(value) || 0;
  // `from` lets a hero figure count up on its very first paint (Munafa card counts from
  // zero); everywhere else the first paint is the figure itself.
  const start0 = Number.isFinite(from) ? from : target;
  const [shown, setShown] = useState(start0);
  const fromRef = useRef(start0);
  const frameRef = useRef(null);

  useEffect(() => {
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = fromRef.current;
    if (reduceMotion || from === target) {
      fromRef.current = target;
      setShown(target);
      return undefined;
    }

    const start = performance.now();
    function step(now) {
      const progress = Math.min(1, (now - start) / duration);
      setShown(from + (target - from) * ease(progress));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
      }
    }
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration]);

  return (
    <span className="tabular">
      {prefix}
      {formatMoney(shown, lang, { decimals })}
      {suffix}
    </span>
  );
}
