'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import Switch from './Switch';

/**
 * The owner's on/off for "आज का हाल", the spoken summary on the home screen.
 *
 * Its own row rather than one of the push switches above it: those only appear once phone
 * notifications are turned on, and this has nothing to do with notifications — it must be
 * findable by an owner who never turned those on. Saves itself, like the switches beside it.
 * Owner-only: a staff login gets a 403 from the profile and the row is not drawn.
 */
export default function VoiceBriefingSetting() {
  const { t } = useLanguage();
  const [on, setOn] = useState(null);

  useEffect(() => {
    apiFetch('/api/seller/profile')
      .then((data) => setOn(data?.profile?.pushPrefs?.voiceBriefing !== false))
      .catch(() => setOn(null));
  }, []);

  async function save(next) {
    const before = on;
    setOn(next);
    await apiFetch('/api/seller/profile', {
      method: 'PUT',
      body: JSON.stringify({ pushPrefs: { voiceBriefing: next } }),
    }).catch(() => setOn(before));
  }

  if (on === null) return null;

  return (
    <div className="briefing-setting">
      <span>
        <strong>{t('briefing.settingLabel')}</strong>
        <small>{t('briefing.settingHint')}</small>
      </span>
      <Switch id="voice-briefing" checked={on} onChange={save} label={t('briefing.settingLabel')} />
    </div>
  );
}
