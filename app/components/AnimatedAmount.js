'use client';

import { useEffect, useRef, useState } from 'react';
import { motionIsOff } from './MotionProvider';

/**
 * A rupee figure that counts from its previous value to the new one.
 *
 * Only worth it where the CHANGE is the news — a khata balance dropping after a payment,
 * the day's takings ticking up. On a static figure it is noise, so don't reach for this
 * everywhere a number is rendered.
 *
 * Counts on requestAnimationFrame rather than a CSS transition because the thing being
 * animated is the text content, not a style. Honours the motion setting: at "off" (or an
 * OS reduced-motion preference) it snaps straight to the value with no frames at all.
 */
export default function AnimatedAmount({ value, duration = 620, decimals = 0, prefix = '₹', className }) {
  const target = Number(value) || 0;
  const [shown, setShown] = useState(target);
  const previous = useRef(target);
  const frame = useRef(0);

  useEffect(() => {
    const from = previous.current;
    previous.current = target;

    if (from === target) return undefined;

    if (motionIsOff()) {
      setShown(target);
      return undefined;
    }

    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic — fast first, settles gently, so the final digits are readable
      // instead of blurring past at constant speed.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (target - from) * eased);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame.current);
  }, [target, duration]);

  return (
    <span className={className}>
      {prefix}
      {shown.toFixed(decimals)}
    </span>
  );
}
