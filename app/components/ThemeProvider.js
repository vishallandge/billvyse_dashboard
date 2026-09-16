'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { THEMES, DEFAULT_THEME, normalizeTheme } from '../../lib/themes';
import { SCENES, DEFAULT_SCENE, normalizeScene } from '../../lib/scenes';
import { apiFetch } from '../../lib/api';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'dukaan_theme';
const ACCENT_KEY = 'dukaan_accent';
const SCENE_KEY = 'dukaan_scene';

/**
 * Mode, accent and scene are three independent axes and are stored separately:
 *
 *   data-theme="dark|light"    the MODE  — a per-device preference (a shopkeeper
 *                              may want dark on the counter tablet, light on a
 *                              bright phone), so it lives only in localStorage.
 *   data-accent="<theme id>"   the ACCENT — a property of the SHOP, so it is saved
 *                              on the profile and follows them to any device, and
 *                              the customer storefront renders in the same colour.
 *   data-scene="<scene id>"    the SCENE  — also a property of the shop, and stored
 *                              exactly like the accent. Dashboard-only: the
 *                              storefront has its own design system and ignores it.
 *
 * Scene and accent are separate settings rather than one combined "look" for the
 * same reason they are separate CSS axes — a shop's colour is its identity and its
 * scene is a working preference, and a shopkeeper who spent a minute choosing
 * Gulab should not lose it by trying out Noir. See lib/scenes.js.
 *
 * localStorage still caches both, but only to paint the right look before the
 * profile request comes back. The server value is authoritative and overwrites the
 * cache on load — see adoptServerAccent / adoptServerScene.
 *
 * MODE has three settings but only ever two values.
 *
 *   `mode`  is what the shopkeeper chose: 'dark', 'light' or 'auto'.
 *   `theme` is what is actually on screen: 'dark' or 'light', never 'auto'.
 *
 * Everything downstream — the sun/moon button, data-theme, the PWA status bar tint —
 * reads `theme`, so nothing else in the app has to learn about the third setting.
 *
 * 'auto' exists because this app is read at a counter from open to close. The one
 * eye-comfort control that was still missing was not another palette: it was not
 * having to reach for the toggle when the shop lights come on. It follows the
 * device's own day/night setting, which is the thing already tracking sunset.
 *
 * The DEFAULT is still dark, not auto. An absent key means a shopkeeper who has
 * never touched the toggle, and flipping their app to light one evening because
 * their phone is on a schedule would be a change they never asked for. Auto only
 * happens when it is picked.
 */

function systemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState('dark');
  const [theme, setThemeState] = useState('dark');
  const [accent, setAccentState] = useState(DEFAULT_THEME);
  const [scene, setSceneState] = useState(DEFAULT_SCENE);
  // Set once the server has told us what the shop's accent actually is, so a late
  // profile response can't clobber a change the shopkeeper made in the meantime.
  const serverSynced = useRef(false);
  // Tracked separately from the accent's flag: the two are written by two different
  // pickers and arrive in the same profile response, so one shared flag would let a
  // scene change swallow the server's accent (or the reverse).
  const sceneSynced = useRef(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') {
        setModeState(stored);
        setThemeState(stored);
      } else if (stored === 'auto') {
        setModeState('auto');
        setThemeState(systemTheme());
      }
      const storedAccent = localStorage.getItem(ACCENT_KEY);
      if (storedAccent) setAccentState(normalizeTheme(storedAccent));
      const storedScene = localStorage.getItem(SCENE_KEY);
      if (storedScene) setSceneState(normalizeScene(storedScene));
    } catch {
      // Private mode / storage disabled — defaults are fine.
    }
  }, []);

  // Only while following the device. An explicit dark or light must not be overridden
  // by the phone crossing into night mode two hours later — that is the whole meaning
  // of having picked one.
  useEffect(() => {
    if (mode !== 'auto' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-color-scheme: light)');
    function sync() {
      setThemeState(query.matches ? 'light' : 'dark');
    }
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, [mode]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    // Keep the PWA chrome (status bar / address bar tint on mobile) in sync with the
    // actual toggle, not just the OS's light/dark preference — the static <meta> from
    // layout.js only covers the pre-toggle default.
    //
    // The dark value tracks --bg, which the reading-comfort pass lifted off near-black
    // to #101014. This was left at the old #0a0a0d, so toggling to dark on a phone put
    // a visibly darker band above a lighter page — a seam exactly where the app meets
    // the system, which is the last place a product wants one.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#eef0f4' : '#101014');
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent);
  }, [accent]);

  useEffect(() => {
    document.documentElement.setAttribute('data-scene', scene);
  }, [scene]);

  /**
   * The topbar sun/moon button. Always lands on an explicit choice — pressing it
   * while following the device means "no, I want it this way now", and leaving the
   * app on auto would let the device flip it back an hour later.
   */
  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      setModeState(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // non-fatal
      }
      return next;
    });
  }, []);

  /** The three-way setting in Settings. 'auto' resolves through the effect above. */
  const setMode = useCallback((next) => {
    const value = next === 'light' || next === 'dark' || next === 'auto' ? next : 'dark';
    setModeState(value);
    if (value !== 'auto') setThemeState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // non-fatal
    }
  }, []);

  /**
   * Apply an accent and save it to the shop. Paints immediately and saves in the
   * background, because a colour swatch that waits on the network feels broken.
   * Returns the request promise so a caller can surface a failure if it wants to;
   * the on-screen colour is not rolled back on error — the shopkeeper can simply
   * pick again, and reverting the colour under their cursor is more confusing.
   */
  const setAccent = useCallback((id) => {
    const next = normalizeTheme(id);
    serverSynced.current = true;
    setAccentState(next);
    try {
      localStorage.setItem(ACCENT_KEY, next);
    } catch {
      // non-fatal
    }
    return apiFetch('/api/seller/profile', {
      method: 'PUT',
      body: JSON.stringify({ appTheme: next }),
    });
  }, []);

  /**
   * Apply a scene and save it to the shop. Same fire-and-forget shape as setAccent:
   * a look that waits on the network before it appears feels broken, and snapping it
   * back on a failed write would be more confusing than leaving it applied with an
   * inline "not saved" note next to the picker.
   */
  const setScene = useCallback((id) => {
    const next = normalizeScene(id);
    sceneSynced.current = true;
    setSceneState(next);
    try {
      localStorage.setItem(SCENE_KEY, next);
    } catch {
      // non-fatal
    }
    return apiFetch('/api/seller/profile', {
      method: 'PUT',
      body: JSON.stringify({ appScene: next }),
    });
  }, []);

  /**
   * Adopt the accent the server has on file. Called once the profile loads. Skipped
   * after the shopkeeper has picked something this session, so an in-flight profile
   * response can't undo their choice.
   */
  const adoptServerAccent = useCallback((id) => {
    if (serverSynced.current || !id) return;
    serverSynced.current = true;
    const next = normalizeTheme(id);
    setAccentState(next);
    try {
      localStorage.setItem(ACCENT_KEY, next);
    } catch {
      // non-fatal
    }
  }, []);

  /** The scene's half of adoptServerAccent, with its own guard flag. */
  const adoptServerScene = useCallback((id) => {
    if (sceneSynced.current || !id) return;
    sceneSynced.current = true;
    const next = normalizeScene(id);
    setSceneState(next);
    try {
      localStorage.setItem(SCENE_KEY, next);
    } catch {
      // non-fatal
    }
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        mode,
        setMode,
        toggleTheme,
        accent,
        setAccent,
        adoptServerAccent,
        themes: THEMES,
        scene,
        setScene,
        adoptServerScene,
        scenes: SCENES,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
