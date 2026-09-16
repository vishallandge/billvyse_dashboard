// Reminder preferences only: no shop details or authentication credentials are stored.
export const SHOP_IDENTITY_DISMISS_KEY = 'dukaan_shop_identity_dismissed';

export function reminderDay(now = Date.now()) {
  // Indian business day, including when the browser is in a different timezone.
  return new Date(Number(now) + 330 * 60 * 1000).toISOString().slice(0, 10);
}

export function shopIdentityComplete(user) {
  return ['shopName', 'shopAddress', 'shopPhone'].every((key) => String(user?.[key] || '').trim().length > 0);
}

export function shouldRemindShopIdentity(user, dismissed, day = reminderDay()) {
  return user?.role === 'seller' && !shopIdentityComplete(user) &&
    !(dismissed?.ownerId === user.id && dismissed?.day === day);
}

export function readShopIdentityDismissal() {
  try { return JSON.parse(sessionStorage.getItem(SHOP_IDENTITY_DISMISS_KEY) || 'null'); }
  catch { return null; }
}

export function dismissShopIdentity(ownerId, day = reminderDay()) {
  const dismissed = { ownerId, day };
  try { sessionStorage.setItem(SHOP_IDENTITY_DISMISS_KEY, JSON.stringify(dismissed)); } catch {}
  return dismissed;
}

export function resetShopIdentityReminder() {
  try { sessionStorage.removeItem(SHOP_IDENTITY_DISMISS_KEY); } catch {}
}
