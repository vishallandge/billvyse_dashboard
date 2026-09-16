// Password reset drafts retain ordinary preferences, never payment details or credentials.
const DRAFT_KEY = 'dukaan_settings_draft';

/**
 * A day. The journey this covers is "reset the password, read the mail, come back" — that
 * is minutes for someone with a phone in hand and a few hours for someone who has to find
 * the laptop the mailbox is signed in on. Beyond a day it is not an interrupted edit any
 * more, it is a stale form, and offering it back would be the app arguing with whatever the
 * shop has since agreed with the server.
 */
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function sanitiseSettingsDraft(profile) {
  const { upiId, currentPassword, googleCredential, ...safe } = profile;
  safe.invoiceProfile = { ...safe.invoiceProfile };
  for (const key of Object.keys(safe.invoiceProfile)) {
    if (key.startsWith('bank')) delete safe.invoiceProfile[key];
  }
  return safe;
}

export function saveSettingsDraft(userId, profile) {
  try {
    if (!profile) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ userId: userId || null, profile: sanitiseSettingsDraft(profile), savedAt: Date.now() }));
  } catch {
    /* a full or blocked localStorage costs him the re-type, never the reset */
  }
}

export function clearSettingsDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to do — it expires on its own */
  }
}

/**
 * The draft this device may legitimately offer back, or null.
 *
 * `userId` is compared rather than merely stored, for the reason a shop counter is a shared
 * machine: the owner starting a password reset and a staff login arriving next must not be
 * handed each other's form. These fields are the shop's identity, its GSTIN and its payout
 * VPA — the wrong person's draft here is not a cosmetic mix-up.
 */
export function readSettingsDraft(userId) {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!raw?.profile) return null;
    if (!userId || raw.userId !== userId) return null;
    if (!raw.savedAt || Date.now() - raw.savedAt > DRAFT_MAX_AGE_MS) {
      clearSettingsDraft();
      return null;
    }
    raw.profile = sanitiseSettingsDraft(raw.profile);
    // Scrub legacy drafts on read as well.
    localStorage.setItem(DRAFT_KEY, JSON.stringify(raw));
    return raw;
  } catch {
    return null;
  }
}
