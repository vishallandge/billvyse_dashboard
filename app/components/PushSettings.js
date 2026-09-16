'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import {
  pushSupported,
  getPushStatus,
  enablePush,
  disablePush,
  sendTestPush,
} from '../../lib/push';
import { TrashIcon } from './Icons';

/**
 * The Settings block for phone alerts.
 *
 * Two things about push make this screen more than an on/off switch. First, permission is
 * per-device: the shop's phone and the counter PC are separate decisions, so the toggle
 * has to speak about "this device" and the list of other registered devices has to be
 * visible. Second, a browser-level block is permanent from the app's side — once denied,
 * no button here can bring the prompt back — so that state gets an explanation of where to
 * go instead of a button that would do nothing.
 */
export default function PushSettings({ compact = false }) {
  const { t } = useLanguage();

  const [status, setStatus] = useState({ supported: true, permission: 'default', subscribed: false });
  const [config, setConfig] = useState({ configured: true, devices: [] });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [prefs, setPrefs] = useState({ events: true, morningDigest: true, eveningSummary: true });
  const [canSetPrefs, setCanSetPrefs] = useState(false);

  const refresh = useCallback(async () => {
    setStatus(await getPushStatus());
    const data = await apiFetch('/api/seller/push/config').catch(() => null);
    if (data) setConfig(data);
  }, []);

  useEffect(() => {
    refresh();
    // Owner-only endpoint. A staff login gets a 403 here and simply does not see the two
    // preference switches — which is right, because those are shop-wide settings and not
    // a counter assistant's to change. Their own device toggle still works.
    apiFetch('/api/seller/profile')
      .then((data) => {
        if (data?.profile?.pushPrefs) {
          setPrefs(data.profile.pushPrefs);
          setCanSetPrefs(true);
        }
      })
      .catch(() => setCanSetPrefs(false));
  }, [refresh]);

  async function handleEnable() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await enablePush();
      if (!result.ok) {
        setMessage({
          tone: 'error',
          text:
            result.reason === 'denied' ? t('seller.pushBlocked')
            : result.reason === 'unsupported' ? t('seller.pushUnsupported')
            : result.reason === 'server-not-configured' ? t('seller.pushNotConfigured')
            // "default" — the shopkeeper dismissed the prompt without choosing. Nothing is
            // broken and the prompt will come back, so this deliberately says nothing.
            : null,
        });
      }
      await refresh();
    } catch (error) {
      setMessage({ tone: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    setMessage(null);
    try {
      await disablePush();
      await refresh();
    } catch (error) {
      setMessage({ tone: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await sendTestPush();
      setMessage(
        result?.success
          ? { tone: 'ok', text: t('seller.pushTestSent') }
          : { tone: 'error', text: t('seller.pushTestFailed') }
      );
      // A test that pruned the endpoint means the row is gone; the toggle has to stop
      // claiming this device is on.
      if (!result?.success) await refresh();
    } catch (error) {
      setMessage({ tone: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  // Saved immediately rather than on the page's Save button: this component lives outside
  // that form, and a switch that looks flipped but is not yet saved is the worst of both.
  async function savePref(key, value) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    await apiFetch('/api/seller/profile', {
      method: 'PUT',
      body: JSON.stringify({ pushPrefs: next }),
    }).catch(() => setPrefs(prefs));
  }

  async function removeDevice(id) {
    await apiFetch(`/api/seller/push/devices/${id}`, { method: 'DELETE' }).catch(() => {});
    await refresh();
  }

  if (!pushSupported() || status.supported === false) {
    return compact ? null : <p className="empty-state" style={{ paddingTop: 0 }}>{t('seller.pushUnsupported')}</p>;
  }

  if (!config.configured) {
    return compact ? null : <p className="empty-state" style={{ paddingTop: 0 }}>{t('seller.pushNotConfigured')}</p>;
  }

  // Compact mode is an offer, not a control panel. Once this device is subscribed there is
  // nothing left to say here, and a permanent "alerts are on" strip above the notification
  // list is exactly the kind of thing that gets scrolled past forever.
  if (compact && (status.subscribed || status.permission === 'denied')) return null;

  const blocked = status.permission === 'denied';
  const otherDevices = (config.devices || []).filter((device) => device.endpoint !== status.endpoint);

  return (
    <div className={`push-settings${compact ? ' push-settings-compact' : ''}`}>
      <p className="empty-state" style={{ paddingTop: 0 }}>{t('seller.pushHint')}</p>

      {blocked ? (
        <div className="info-banner">{t('seller.pushBlocked')}</div>
      ) : (
        <div className="push-actions">
          <span className={`badge ${status.subscribed ? 'badge-active' : 'badge-inactive'}`}>
            {status.subscribed ? t('seller.pushOn') : t('seller.pushOff')}
          </span>
          {status.subscribed ? (
            <>
              <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={handleTest} disabled={busy}>
                {t('seller.pushTest')}
              </button>
              <button type="button" className="link-btn" onClick={handleDisable} disabled={busy}>
                {t('seller.pushDisable')}
              </button>
            </>
          ) : (
            /* `btn btn-primary btn-small btn-inline`, and every word of that is load-bearing.
               It was `btn-primary` alone: no `.btn`, which is where the padding, the radius
               and the font live — and `.btn-primary` on its own carries `width: 100%`,
               because it was built for the auth forms. So the one control that turns phone
               alerts on rendered as a flat full-width coloured bar wedged into a wrapping
               flex row beside a status pill. It did not look like a button, and on the
               Notifications screen it is the first thing a shopkeeper sees. */
            <button type="button" className="btn btn-primary btn-small btn-inline" onClick={handleEnable} disabled={busy}>
              {t('seller.pushEnable')}
            </button>
          )}
        </div>
      )}

      {message?.text && (
        <div className={message.tone === 'ok' ? 'info-banner' : 'error-banner'}>{message.text}</div>
      )}

      {status.subscribed && canSetPrefs && !compact && (
        <div className="push-prefs">
          <label className="push-pref">
            <input
              type="checkbox"
              checked={prefs.events !== false}
              onChange={(event) => savePref('events', event.target.checked)}
            />
            <span>
              <strong>{t('seller.pushEventsLabel')}</strong>
              <small>{t('seller.pushEventsHint')}</small>
            </span>
          </label>
          <label className="push-pref">
            <input
              type="checkbox"
              checked={prefs.morningDigest !== false}
              onChange={(event) => savePref('morningDigest', event.target.checked)}
            />
            <span>
              <strong>{t('seller.pushDigestLabel')}</strong>
              <small>{t('seller.pushDigestHint')}</small>
            </span>
          </label>
          {/* The 9:30pm close. Its own switch, because it is the opposite kind of message
              from the two above — not a task and not an interruption, but how the day
              actually went. Some shopkeepers want only this one. */}
          <label className="push-pref">
            <input
              type="checkbox"
              checked={prefs.eveningSummary !== false}
              onChange={(event) => savePref('eveningSummary', event.target.checked)}
            />
            <span>
              <strong>{t('seller.pushEveningLabel')}</strong>
              <small>{t('seller.pushEveningHint')}</small>
            </span>
          </label>
        </div>
      )}

      {/* The device list is a Settings concern. On the notifications page this component is
          only here to offer the switch to whoever is standing at the counter — including a
          staff login, which is the one that never reaches Settings at all. */}
      {otherDevices.length > 0 && !compact && (
        <div className="push-devices">
          <h3>{t('seller.pushDevices')}</h3>
          <ul>
            {otherDevices.map((device) => (
              <li key={device.id}>
                <span>{device.label}</span>
                <button
                  type="button"
                  className="icon-btn danger"
                  data-tip={t('seller.pushRemoveDevice')}
                  onClick={() => removeDevice(device.id)}
                >
                  <TrashIcon size={17} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
