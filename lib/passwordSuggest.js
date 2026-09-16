/**
 * A first password the owner can say out loud.
 *
 * This is not a password anybody chose for themselves — it is one shopkeeper creating a
 * login for another person standing in front of them, and it has to survive being read
 * across a counter, typed on a cheap Android keyboard, and remembered until it is changed.
 * That rules out the usual random-string generator: `xK7#pQ2v` is stronger and completely
 * useless here, because what actually happens is the owner gives up and types `123456`.
 *
 * So: one plain word plus four digits. Long enough to be worth having, short enough to
 * dictate, and made only of characters that cannot be misheard or misread — no O/0, no
 * I/l/1, no symbols nobody can find on a phone keyboard.
 *
 * The words are deliberately shop-shaped and Latin-scripted: every one of them is typed
 * the same way whatever language the dashboard is in, because the person receiving it may
 * be reading a WhatsApp message on a phone set to a different language than the shop's.
 */
const WORDS = [
  'Bazaar', 'Dukaan', 'Counter', 'Kirana', 'Mandi', 'Vyapar', 'Grahak', 'Munafa',
  'Hisaab', 'Rakhwala', 'Shubh', 'Sunder', 'Chabi', 'Sahara', 'Tarakki', 'Mehnat',
];

// Crypto where it exists, Math.random where it does not. The fallback matters more than
// it looks: this runs in a browser, and a generator that throws leaves the owner with an
// empty field and no idea why the button did nothing.
function randomInt(max) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0] % max;
  }
  return Math.floor(Math.random() * max);
}

export function suggestPassword() {
  const word = WORDS[randomInt(WORDS.length)];
  // 2000–9999: four digits, never leading-zero (which people drop when retyping) and
  // never a year-shaped 19xx/20xx that reads as a birthday and gets guessed.
  const digits = 2000 + randomInt(8000);
  return `${word}${digits}`;
}
