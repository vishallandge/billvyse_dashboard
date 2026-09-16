'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { useToast } from './Toast';
// The rule about which rows this shop is even asked about lives there, pure and testable —
// see lib/screens.js for why it is not inline here.
import { listedScreenGroups, moduleOffKeys } from '../../lib/screens';

/**
 * "Yeh screen mere kaam ki nahi hai."
 *
 * The app guesses which screens a trade needs (backend/utils/navRelevance.js) and the guess
 * is a good one, but it had two holes a kirana owner found immediately: it un-hid a screen
 * for good the moment a single stray row existed — one poke at the Tables screen and a
 * general store carried "Tables" and "Kitchen" in its menu forever — and there was no way to
 * tell the app it had guessed wrong. Showing the app to a customer with a kitchen ticket
 * screen in a kirana's sidebar is not a small thing; it says nobody built this for you.
 *
 * So this is the shop's own answer, and it outranks the guess in both directions. What it
 * cannot do is switch on a screen the plan does not include — those rows are shown as locked
 * rather than quietly ignored, because a toggle that does nothing is worse than none.
 *
 * Hiding a screen hides a LINK. The route still opens and the API still answers, so nothing
 * here can strand a shop's own data behind a menu.
 */

export default function ScreenPicker() {
  const { t } = useLanguage();
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiFetch('/api/seller/modules')
      .then(setInfo)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  const hiddenList = info?.screenPrefs?.hidden || [];
  const byTrade = info?.screenPrefs?.byTrade || [];
  const hidden = new Set(hiddenList);
  const groups = listedScreenGroups({
    byTrade,
    moduleOff: moduleOffKeys({ hiddenNav: info?.hiddenNav || [], byTrade, hidden: hiddenList }),
  });

  function isVisible(key) {
    return !hidden.has(key);
  }

  async function toggle(key, next) {
    const nextHidden = new Set(hidden);
    if (next) nextHidden.delete(key);
    else nextHidden.add(key);

    setSaving(key);
    setError('');
    // Optimistic, because a menu that lags a tap behind feels broken. The server's own copy
    // replaces this a moment later.
    setInfo((current) => ({
      ...current,
      screenPrefs: { ...current.screenPrefs, hidden: [...nextHidden] },
    }));
    try {
      await apiFetch('/api/seller/screens', {
        method: 'PUT',
        body: JSON.stringify({ hidden: [...nextHidden] }),
      });
      // The sidebar reads this list from the same endpoint, so it has to be told the answer
      // changed — otherwise the menu only catches up on the next navigation.
      window.dispatchEvent(new Event('dukaan:screensChanged'));
      load();
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
      load();
    } finally {
      setSaving('');
    }
  }

  if (error && !info) return <p className="error-banner">{error}</p>;
  if (!info) return <p className="empty-state">{t('common.loading')}</p>;

  return (
    <div className="screen-picker">
      {groups.map((group) => (
        <div key={group.id} className="screen-picker__group">
          <span className="inv-ctl-label">{t(`navGroup.${group.id}`)}</span>
          <div className="invoice-toggles">
            {group.keys.map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={isVisible(key)}
                  disabled={saving === key}
                  onChange={(e) => toggle(key, e.target.checked)}
                />
                {t(`nav.${key}`)}
              </label>
            ))}
          </div>
        </div>
      ))}
      <p className="field-hint">{t('seller.screensFootnote')}</p>
    </div>
  );
}
