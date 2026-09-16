/**
 * The time-of-day greeting, in one place.
 *
 * Two screens say it now — the dashboard's GreetingHero and the sign-in welcome — and a
 * shopkeeper sees them within a second of each other on every login. Two copies of these
 * four strings would drift the first time somebody improves one of them, and the drift
 * would be visible in that same second.
 *
 * Localised for the three primary languages; every other language falls to English, the
 * same rule the rest of the dictionary follows.
 */
const GREETINGS = {
  en: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Working late' },
  hi: { morning: 'सुप्रभात', afternoon: 'नमस्कार', evening: 'शुभ संध्या', night: 'शुभ रात्रि' },
  mr: { morning: 'सुप्रभात', afternoon: 'नमस्कार', evening: 'शुभ संध्याकाळ', night: 'शुभ रात्री' },
};

export function greetingBucket(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

export function greetingFor(lang, hour) {
  const part = greetingBucket(hour);
  const set = GREETINGS[lang] || GREETINGS.en;
  return set[part] || GREETINGS.en[part];
}
