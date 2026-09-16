/**
 * The dictionary loader.
 *
 * WHY THIS FILE IS A LOADER AND NOT THE DICTIONARY
 *
 * It used to BE the dictionary — one module holding all ten languages, 20,000 lines and
 * 1.7MB of source. LanguageProvider imports it and LanguageProvider is mounted in the root
 * layout, so webpack put the whole thing in a shared chunk: a measured 1.34MB of minified
 * JavaScript, downloaded, parsed and evaluated on every single page load of the dashboard,
 * by every shop, to read strings in one language. Nine tenths of it was never looked at.
 *
 * On the machine a shop actually runs — a ₹8,000 Android phone or an old counter laptop —
 * parsing and evaluating that much JavaScript is a few hundred milliseconds before React
 * has drawn anything. That is the app feeling slow, and it was the largest single cause.
 *
 * So each language now lives in its own file under i18n/packs/ and only English is bundled
 * eagerly. English has to be: translate() falls back to it for any key a language has not
 * translated, and seven of the ten languages are only partially translated by design.
 * Everything else arrives through the dynamic import below, as its own webpack chunk, the
 * first time a shop actually selects that language — and is then in the browser cache.
 *
 * The shapes exported here are unchanged, so nothing that calls translate() had to move.
 * `strings` is no longer exported; it was only ever read inside this file.
 */
export { LANGUAGES, RTL_LANGS } from './i18n/meta';
import { LANGUAGE_CODES } from './i18n/meta';
import en from './i18n/packs/en';

export { LANGUAGE_CODES };

// Packs that are in memory. English is here from the start because it is the fallback for
// every other language — a missing key must never leave a shopkeeper looking at a dotted
// path, so the fallback can never be the thing we are still waiting on.
const loaded = { en };
// One request per language, however many components ask at once.
const inFlight = new Map();

/**
 * True when translate() can answer in this language right now. LanguageProvider uses it to
 * skip the load entirely for English and for any pack already fetched, so the common case
 * costs one property read and no promise.
 */
export function isLanguageLoaded(lang) {
  return Boolean(loaded[lang]);
}

/**
 * Fetch a language pack. Resolves to the pack; resolves to English if the code is unknown
 * or the chunk cannot be fetched — an offline counter mid-session must keep working in
 * English rather than lose its labels.
 *
 * The template literal is deliberate: webpack reads it as a lazy context over that folder
 * and emits one chunk per language, which is the whole point. Keep the path static enough
 * for it to do that — a fully computed path would silently bundle nothing.
 */
export function loadLanguage(lang) {
  if (loaded[lang]) return Promise.resolve(loaded[lang]);
  if (!LANGUAGE_CODES.includes(lang)) return Promise.resolve(loaded.en);
  if (inFlight.has(lang)) return inFlight.get(lang);

  const request = import(`./i18n/packs/${lang}.js`)
    .then((mod) => {
      loaded[lang] = mod.default;
      inFlight.delete(lang);
      return mod.default;
    })
    .catch(() => {
      inFlight.delete(lang);
      return loaded.en;
    });

  inFlight.set(lang, request);
  return request;
}

export function translate(lang, path) {
  const dict = loaded[lang] || loaded.en;
  const parts = path.split(".");
  let value = dict;
  for (const part of parts){
        value = value?.[part];
  }
  if (typeof value !== "string") {
        let fallback = loaded.en;
        for (const part of parts){
            fallback = fallback?.[part];
        }
        // A key that resolves to a nested group (or is missing everywhere) must never
        // reach React as an object — hand back the path so the screen still renders.
        return typeof fallback === "string" ? fallback : path;
  }
  return value;
}
