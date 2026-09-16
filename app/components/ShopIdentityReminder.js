'use client';

import { useEffect, useState } from 'react';
import ShopIdentityGate from './ShopIdentityGate';
import { reminderDay, readShopIdentityDismissal, dismissShopIdentity, shouldRemindShopIdentity } from '../../lib/shopIdentityReminder';

export default function ShopIdentityReminder({ user, onSaved, onLogout }) {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(null);
  const [day, setDay] = useState(reminderDay);
  useEffect(() => {
    setDismissed(readShopIdentityDismissal());
    setDay(reminderDay());
    setReady(true);
    const updateDay = () => setDay(reminderDay());
    const interval = window.setInterval(updateDay, 60_000);
    window.addEventListener('focus', updateDay);
    document.addEventListener('visibilitychange', updateDay);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', updateDay);
      document.removeEventListener('visibilitychange', updateDay);
    };
  }, [user.id]);

  if (!ready || !shouldRemindShopIdentity(user, dismissed, day)) return null;
  return <ShopIdentityGate user={user} onSaved={onSaved} onLogout={onLogout}
    onClose={() => { const today = reminderDay(); setDay(today); setDismissed(dismissShopIdentity(user.id, today)); }} />;
}
