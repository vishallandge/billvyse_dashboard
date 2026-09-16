'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const TextSizeContext = createContext(null);
const STORAGE_KEY = 'dukaan_textsize';
const LEVELS = ['normal', 'large', 'xlarge'];

export const TEXT_SIZE_LEVELS = LEVELS;

/**
 * How big the whole app reads.
 *
 * This is NOT the same knob as density, and putting them on one control would have
 * been wrong: density is about how much fits on the screen in front of you, and it
 * only ever tightens. This is about eyes. The median user of this app is a shopkeeper
 * in their forties or fifties reading a 14px number under a shop tubelight, and the
 * app had no answer for that at all — the type scale bottomed out at a fixed
 * --fs-base of 0.92rem and nothing could move it.
 *
 * Implemented as a root font-size rather than by rewriting the nine --fs-* tokens,
 * for two reasons. Every step of that scale is already in rem, so one number moves
 * all of them in proportion and the hierarchy the scale encodes survives intact. And
 * the app's spacing is in rem too, so padding and gaps grow with the text instead of
 * leaving bigger words crammed into the same boxes — which is what "bigger text" that
 * only touches font-size always ends up looking like.
 *
 * It only ever scales UP. Shrinking would push text inputs below 16px, and on iOS
 * anything under 16px makes Safari zoom the page the moment the field is focused —
 * the rule the mobile pass established and that nothing in this app is allowed to
 * break.
 *
 * Stored per DEVICE, like density and motion: the counter laptop and the owner's
 * phone are read at different distances by (often) different people.
 */
export function TextSizeProvider({ children }) {
  const [textSize, setTextSizeState] = useState('normal');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (LEVELS.includes(stored)) setTextSizeState(stored);
    } catch {
      // Private mode / storage disabled — normal is a fine default.
    }
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    // 'normal' is the ABSENCE of the attribute, matching how density handles 'auto':
    // it means "whatever the stylesheet already does", so there is no rule to write.
    if (textSize === 'large' || textSize === 'xlarge') {
      el.setAttribute('data-textsize', textSize);
    } else {
      el.removeAttribute('data-textsize');
    }
  }, [textSize]);

  const setTextSize = useCallback((level) => {
    const next = LEVELS.includes(level) ? level : 'normal';
    setTextSizeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // non-fatal
    }
  }, []);

  return (
    <TextSizeContext.Provider value={{ textSize, setTextSize, levels: LEVELS }}>
      {children}
    </TextSizeContext.Provider>
  );
}

export function useTextSize() {
  const ctx = useContext(TextSizeContext);
  if (!ctx) throw new Error('useTextSize must be used inside TextSizeProvider');
  return ctx;
}
