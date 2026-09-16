/**
 * Put the shopkeeper's eye on the box that is wrong.
 *
 * A refusal printed at the top of a form names a field the reader may not be able to see —
 * the Settings screen is eight panels tall, and the shop-identity wall is four boxes with
 * an address block in the middle of it. Worse, a message like "this mobile number is
 * already linked to another shop" is about ONE box, and shown at the top it makes the
 * reader check all of them.
 *
 * So: scroll it into view, put the caret in it, and flash it. Three things at once, because
 * each answers a different question — where is it, can I type in it, and is this the one?
 *
 * Lifted out of seller/settings/page.js, which had it (and a second near-copy for its
 * `#gstin` deep link) all to itself. Every screen that can be refused by the server needs
 * the same three lines, and a fourth copy is how they start to differ.
 */

// Long enough to be noticed after a smooth scroll has finished, short enough not to still
// be pulsing while the shopkeeper is typing the fix. Matches what Settings already used.
const FLASH_MS = 1800;

/**
 * Scroll a box into view and ring it.
 *
 * Takes the element directly, for the controls that have no input with an id to find — a
 * Dropdown wrapper held in a ref, say. `jumpToField` below is the same thing addressed by
 * field id, which is what a server refusal names.
 *
 * The ring is a static box-shadow that JS removes rather than something living only inside
 * the keyframes: a shopkeeper on `data-motion="off"` still has to see where to look.
 */
export function flashElement(node) {
  if (!node) return false;
  node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  // Restart the animation even when the same box is refused twice in a row: without the
  // reflow the class is already there, nothing changes, and the second refusal looks like
  // nothing happened at all.
  node.classList.remove('fix-flash');
  void node.offsetWidth;
  node.classList.add('fix-flash');
  window.setTimeout(() => node.classList.remove('fix-flash'), FLASH_MS);
  return true;
}

export function jumpToField(fieldId) {
  if (typeof document === 'undefined' || !fieldId) return false;
  const input = document.getElementById(fieldId);
  if (!input) return false;

  // Focus only where it can be typed into — pulling the caret into a locked or disabled
  // field would promise an edit the server is going to refuse again.
  if (!input.readOnly && !input.disabled) input.focus({ preventScroll: true });

  /* The ring goes on the `.field` wrapper, not the input: `.field input:focus` already owns
     a box-shadow at higher specificity and would hide it. `.phone-field` and `.auth-field`
     are the same shape for this purpose — the wrapper is whatever box the eye reads as
     "this control". */
  return flashElement(input.closest('.field, .auth-field, .phone-field') || input);
}
