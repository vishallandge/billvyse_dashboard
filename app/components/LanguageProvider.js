'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { translate, loadLanguage, isLanguageLoaded, LANGUAGE_CODES, RTL_LANGS } from '../../lib/i18n';
import { syncPushSubscription } from '../../lib/push';

const LanguageContext = createContext(null);
// Exported so the signup page can tell "no explicit choice yet" apart from "chose English"
// before running its one-time browser-locale auto-detect.
export const LANG_STORAGE_KEY = 'dukaan_lang';
const STORAGE_KEY = LANG_STORAGE_KEY;

// Right-to-left languages (Urdu) need the whole document flipped so the layout,
// icons and text all read correctly — not just the strings translated.
function applyDirection(lang) {
  if (typeof document === 'undefined') return;
  const rtl = RTL_LANGS.includes(lang);
  document.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  document.documentElement.setAttribute('lang', lang);
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState('en');
  /**
   * Bumped when a language pack finishes downloading, and nothing else. Only English is
   * in the bundle (see lib/i18n.js for why); the other nine arrive as their own chunk, so
   * between the shop picking Hindi and that chunk landing, translate() answers in English.
   * Changing this re-creates `t` and re-renders everything reading it, in Hindi.
   *
   * That gap is one network request on the first visit in that language and a cache hit
   * forever after. It is also not a new gap: `lang` has always started at 'en' and only
   * moved to the stored language in the effect below, so a Hindi shop already painted one
   * English frame on every load. What it buys is roughly a megabyte off every page load.
   */
  const [packRev, setPackRev] = useState(0);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LANGUAGE_CODES.includes(stored)) {
      setLangState(stored);
      applyDirection(stored);
    }
  }, []);

  // Make sure the current language's strings are actually in memory. A no-op for English
  // and for any pack already fetched this session, so the common path costs one lookup.
  useEffect(() => {
    if (isLanguageLoaded(lang)) return undefined;
    let alive = true;
    loadLanguage(lang).then(() => {
      if (alive) setPackRev((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [lang]);

  const setLang = useCallback((next) => {
    if (!LANGUAGE_CODES.includes(next)) return;
    // Start the download before the state change so the pack is usually already there by
    // the time React has re-rendered the screen in it.
    loadLanguage(next).then(() => setPackRev((n) => n + 1));
    setLangState(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyDirection(next);
    // Tell the server this device now reads another language, so tonight's notification
    // arrives in it. Silent and best-effort; the next page load re-syncs anyway.
    syncPushSubscription();
  }, []);

  const t = useCallback((path, vars) => {
    let value = translate(lang, path);
    if (typeof value === 'string' && vars) {
      Object.entries(vars).forEach(([key, val]) => {
        // `null` and `undefined` are replaced with nothing, never with themselves.
        // String.replace() stringifies whatever it is handed, so a rule that omitted one
        // number used to put the WORD "null" in front of a shopkeeper — "null din se
        // backup nahi liya". A gap in a sentence is a typo; the word "null" is the app
        // admitting in English that it lost track of something.
        value = value.replace(`{${key}}`, val === null || val === undefined ? '' : val);
      });
    }
    return value;
    // packRev is not read in the body on purpose — it exists so that a pack landing
    // gives every consumer a new `t` and therefore a re-render in the new language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, packRev]);

  // Memoised so a parent re-render does not hand every consumer in the app a new context
  // value and re-render all of them; this now changes only when the language or its pack does.
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return ctx;
}
