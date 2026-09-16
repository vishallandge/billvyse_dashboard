'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const MotionContext = createContext(null);
const STORAGE_KEY = 'dukaan_motion';
const LEVELS = ['full', 'reduced', 'off'];

export const MOTION_LEVELS = LEVELS;

/**
 * How much the app is allowed to move.
 *
 * Stored per DEVICE, not on the shop — unlike the accent theme. This is a property of
 * the hardware and the person using it: the owner's phone may be new while the counter
 * runs on a five-year-old tablet that drops frames, and a busy counter may simply want
 * everything still. Syncing it across devices would be the wrong behaviour.
 *
 * Left unset, the attribute is absent and CSS falls back to full — except where the OS
 * reports prefers-reduced-motion, which the stylesheet honours on its own. Picking
 * "full" explicitly is the one thing that overrides the OS, because at that point the
 * shopkeeper has told us directly.
 */
export function MotionProvider({ children }) {
  const [motion, setMotionState] = useState('full');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (LEVELS.includes(stored)) setMotionState(stored);
    } catch {
      // Private mode / storage disabled — full is a fine default.
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-motion', motion);
  }, [motion]);

  const setMotion = useCallback((level) => {
    const next = LEVELS.includes(level) ? level : 'full';
    setMotionState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // non-fatal
    }
  }, []);

  return (
    <MotionContext.Provider value={{ motion, setMotion, levels: LEVELS }}>
      {children}
    </MotionContext.Provider>
  );
}

export function useMotion() {
  const ctx = useContext(MotionContext);
  if (!ctx) {
    throw new Error('useMotion must be used within MotionProvider');
  }
  return ctx;
}

/**
 * True when the app should not animate at all — for the JS side of a moment, where a
 * CSS duration of 0ms is not enough on its own (a timer that clears a "just happened"
 * flag, a count-up loop). Reads the live attribute rather than context so it can be
 * called from effects and event handlers without re-subscribing.
 */
export function motionIsOff() {
  if (typeof document === 'undefined') return true;
  if (document.documentElement.getAttribute('data-motion') === 'off') return true;
  if (document.documentElement.getAttribute('data-motion') === 'full') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
