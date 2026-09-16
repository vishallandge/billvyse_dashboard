/**
 * What makes a password acceptable, and how to say so while it is being typed.
 *
 * Mirrors backend/utils/passwordRules.js. That file is the enforcement; this one is the
 * explanation — and the explanation has to arrive BEFORE the refusal, because a password
 * box that accepts eight characters and then rejects them on submit has wasted the one
 * thing the person was concentrating on.
 *
 * The rules are deliberately mild. This is a counter app used by people typing on a cheap
 * Android keyboard with the shop's phone in the other hand; a symbol-and-uppercase policy
 * does not produce strong passwords here, it produces `Dukaan@1` on every account in the
 * country. What it refuses instead are the passwords that are genuinely broken.
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

const OBVIOUS = new Set([
  'password', 'password1', 'passw0rd', '12345678', '123456789', '1234567890',
  'qwertyui', 'qwerty123', 'iloveyou', 'welcome1', 'abcd1234', 'abcdefgh',
  'dukaan123', 'shop1234', 'admin123', 'india123', 'billvyse', 'mypassword',
]);

function isSequential(digits) {
  let up = true;
  let down = true;
  for (let i = 1; i < digits.length; i += 1) {
    const step = Number(digits[i]) - Number(digits[i - 1]);
    if (step !== 1) up = false;
    if (step !== -1) down = false;
  }
  return up || down;
}

/** The same codes the server sends back, worked out here so the box can say it first. */
export function passwordProblem(value, { email, name } = {}) {
  const password = String(value ?? '');

  if (password.length < PASSWORD_MIN) return 'PASSWORD_TOO_SHORT';
  if (password.length > PASSWORD_MAX) return 'PASSWORD_TOO_LONG';
  if (password !== password.trim()) return 'PASSWORD_HAS_EDGE_SPACES';
  if (OBVIOUS.has(password.toLowerCase())) return 'PASSWORD_TOO_COMMON';
  if (/^(.)\1+$/.test(password)) return 'PASSWORD_TOO_SIMPLE';
  if (/^\d+$/.test(password) && isSequential(password)) return 'PASSWORD_TOO_SIMPLE';
  if (/^\d+$/.test(password)) return 'PASSWORD_NEEDS_LETTER';

  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length >= 4 && password.toLowerCase().includes(local)) return 'PASSWORD_LOOKS_LIKE_EMAIL';
  const owner = String(name || '').trim().toLowerCase();
  if (owner.length >= 4 && password.toLowerCase().includes(owner)) return 'PASSWORD_LOOKS_LIKE_NAME';

  return null;
}

/**
 * A three-step strength read, for the bar under the box.
 *
 * Deliberately three steps and not five. A meter with five bars invites someone to chase
 * the fifth one by adding `!!` to the end, which buys almost nothing; three says the only
 * thing worth saying — this is refused, this will do, this is genuinely good — and the
 * middle step is a pass, not a scolding.
 *
 * Returns `{ level, score, problem }`. `level` is 'weak' | 'ok' | 'strong'.
 */
export function passwordStrength(value, context = {}) {
  const password = String(value ?? '');
  const problem = passwordProblem(password, context);
  if (!password) return { level: 'weak', score: 0, problem: null };
  if (problem) return { level: 'weak', score: 1, problem };

  // Length is the only input that reliably matters once the obvious shapes are refused, so
  // it carries the most weight; variety is a tiebreaker rather than a requirement.
  let score = 2;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes >= 3) score += 1;

  return { level: score >= 4 ? 'strong' : 'ok', score: Math.min(5, score), problem: null };
}
