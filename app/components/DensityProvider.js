'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const DensityContext = createContext(null);
const STORAGE_KEY = 'dukaan_density';
const LEVELS = ['auto', 'comfortable', 'compact', 'small'];

export const DENSITY_LEVELS = LEVELS;

/**
 * How much of the app fits on one screen.
 *
 * Stored per DEVICE, like motion and unlike the accent theme — this is a property of
 * the hardware in front of the shopkeeper. The same account is used on a 1366x768
 * counter laptop and on a large monitor at home, and the right answer is different on
 * each; syncing the choice would make one of the two wrong.
 *
 * "auto" is the default and is the ABSENCE of the attribute, not a value of it. The
 * stylesheet's automatic bands are written `:root:not([data-density])`, so setting the
 * attribute at all is what takes the app off automatic — which means the two selectors
 * can never both match and there is no specificity race to lose. Writing
 * data-density="auto" onto <html> would silently disable the very thing it names, so
 * this provider removes the attribute instead.
 */
export function DensityProvider({ children }) {
  const [density, setDensityState] = useState('auto');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (LEVELS.includes(stored)) setDensityState(stored);
    } catch {
      // Private mode / storage disabled — auto is a fine default.
    }
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    if (density === 'comfortable' || density === 'compact' || density === 'small') {
      el.setAttribute('data-density', density);
    } else {
      el.removeAttribute('data-density');
    }
  }, [density]);

  const setDensity = useCallback((level) => {
    const next = LEVELS.includes(level) ? level : 'auto';
    setDensityState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // non-fatal
    }
  }, []);

  return (
    <DensityContext.Provider value={{ density, setDensity, levels: LEVELS }}>
      {children}
    </DensityContext.Provider>
  );
}

export function useDensity() {
  const ctx = useContext(DensityContext);
  if (!ctx) {
    throw new Error('useDensity must be used within DensityProvider');
  }
  return ctx;
}
