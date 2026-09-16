'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatRelativeTime } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import Switch from '../../components/Switch';
import AnimatedNumber from '../../components/AnimatedNumber';
import { SkeletonStats, SkeletonCards } from '../../components/Skeleton';
import {
  AlertIcon,
  BellIcon,
  UsersIcon,
  ClockIcon,
  CheckCircleIcon,
  HeadsetIcon,
  WhatsappIcon,
  MailIcon,
  PhoneIcon,
} from '../../components/Icons';
import Dropdown from '../../components/Dropdown';

function toInputDatetime(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminPlatformSettingsPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  // What a dukandar's support sheet will actually draw once the blanks below fall through
  // to .env. The screen cannot compute this itself — see getPlatformConfig.
  const [supportLive, setSupportLive] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    Promise.all([apiFetch('/api/admin/settings'), apiFetch('/api/admin/health')])
      .then(([settingsRes, healthRes]) => {
        setSettings(settingsRes.settings);
        setSupportLive(settingsRes.supportLive || null);
        setHealth(healthRes);
      })
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  // A settings snapshot written before the support block shipped has no `support` key, and
  // binding an input to `undefined` would make it uncontrolled.
  const support = settings?.support || { email: '', whatsapp: '', phone: '', hours: '' };

  function patch(path, value) {
    setSettings((prev) => {
      const next = structuredClone(prev);
      const parts = path.split('.');
      let obj = next;
      for (let i = 0; i < parts.length - 1; i += 1) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] = value;
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await apiFetch('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          maintenance: settings.maintenance,
          announcement: settings.announcement,
          registrationOpen: settings.registrationOpen,
          autoApproveShops: settings.autoApproveShops,
          trialDays: settings.trialDays,
          planReminderDays: settings.planReminderDays,
          support: settings.support,
        }),
      });
      setSettings(res.settings);
      setSupportLive(res.supportLive || null);
      toast.success(t('admin.settingsSaved'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!settings) {
    return (
      <>
        <div className="content-header">
          <h1>{t('admin.platformTitle')}</h1>
          <p>{t('admin.platformSubtitle')}</p>
        </div>
        <SkeletonStats count={5} />
        <SkeletonCards count={3} height={140} />
      </>
    );
  }

  return (
    <>
      <div className="content-header">
        <h1>{t('admin.platformTitle')}</h1>
        <p>{t('admin.platformSubtitle')}</p>
      </div>

      {health && (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-card-top">
              <div className={`stat-card-icon ${health.db.state === 1 ? 'icon-success' : 'icon-danger'}`}>
                <span className={`pulse-dot ${health.db.state === 1 ? 'ok' : 'bad'}`} />
              </div>
            </div>
            <div className="stat-value" style={{ fontSize: 'var(--fs-lg)' }}>
              {health.db.state === 1 ? t('admin.dbConnected') : t('admin.dbDown')}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-muted"><ClockIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={Math.floor(health.uptimeSeconds / 60)} decimals={false} suffix="m" /></div>
            <div className="stat-label">{t('admin.uptime')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-muted"><AlertIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={health.memoryMb} decimals={false} suffix="MB" /></div>
            <div className="stat-label">{t('admin.memory')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-top">
              <div className={`stat-card-icon ${health.disabledModules.length ? 'icon-danger' : 'icon-success'}`}>
                <AlertIcon size={17} />
              </div>
            </div>
            <div className="stat-value"><AnimatedNumber value={health.disabledModules.length} decimals={false} /></div>
            <div className="stat-label">{t('admin.disabledModules')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-top"><div className="stat-card-icon icon-brand"><UsersIcon size={17} /></div></div>
            <div className="stat-value"><AnimatedNumber value={health.shopsWithOverrides} decimals={false} /></div>
            <div className="stat-label">{t('admin.shopsWithOverrides')}</div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-danger"><AlertIcon size={16} /></div>
          <h2>{t('admin.maintenance')}</h2>
        </div>
        <p className="empty-state" style={{ textAlign: 'left', padding: '0 0 0.6rem' }}>{t('admin.maintenanceHint')}</p>
        <div className="checkbox-row">
          <Switch
            id="maint-toggle"
            checked={settings.maintenance.enabled}
            onChange={(v) => patch('maintenance.enabled', v)}
            label={t('admin.maintenance')}
          />
          <label htmlFor="maint-toggle">{settings.maintenance.enabled ? t('admin.moduleOn') : t('admin.moduleOff')}</label>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="maint-msg">{t('admin.maintenanceMsg')}</label>
            <input
              id="maint-msg"
              value={settings.maintenance.message}
              onChange={(e) => patch('maintenance.message', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="maint-until">{t('admin.maintenanceUntil')}</label>
            <input
              id="maint-until"
              type="datetime-local"
              value={toInputDatetime(settings.maintenance.until)}
              onChange={(e) => patch('maintenance.until', e.target.value ? new Date(e.target.value).toISOString() : null)}
            />
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-gold"><BellIcon size={16} /></div>
          <h2>{t('admin.announcement')}</h2>
        </div>
        <p className="empty-state" style={{ textAlign: 'left', padding: '0 0 0.6rem' }}>{t('admin.announcementHint')}</p>
        <div className="checkbox-row">
          <Switch
            id="ann-toggle"
            checked={settings.announcement.enabled}
            onChange={(v) => patch('announcement.enabled', v)}
            label={t('admin.announcement')}
          />
          <label htmlFor="ann-toggle">{settings.announcement.enabled ? t('admin.moduleOn') : t('admin.moduleOff')}</label>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="ann-text">{t('admin.announcementText')}</label>
            <input
              id="ann-text"
              value={settings.announcement.text}
              onChange={(e) => patch('announcement.text', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ann-level">{t('admin.level')}</label>
            <Dropdown
              id="ann-level"
              value={settings.announcement.level}
              onChange={(v) => patch('announcement.level', v)}
              options={[
                { value: 'info', label: 'info' },
                { value: 'warning', label: 'warning' },
                { value: 'danger', label: 'danger' },
              ]}
            />
          </div>
        </div>
        {settings.announcement.enabled && settings.announcement.text && (
          <div className={`platform-banner ${settings.announcement.level}`} style={{ marginTop: '0.8rem', marginBottom: 0 }}>
            {settings.announcement.text}
          </div>
        )}
      </div>

      {/*
        WHERE EVERY SHOP REACHES A HUMAN.

        These four fields are read by the headset in every dukaan's topbar. They used to
        live in .env, which meant changing the number somebody answers took a deploy — and
        a wrong number showed up as nothing at all: the WhatsApp tile simply stopped being
        drawn, with no screen anywhere that said why.

        Blank is a real value: it hands that channel back to .env, and the strip at the
        bottom shows what the shop will see either way.
      */}
      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-brand"><HeadsetIcon size={16} /></div>
          <h2>{t('admin.supportContact')}</h2>
        </div>
        <p className="empty-state" style={{ textAlign: 'left', padding: '0 0 0.6rem' }}>
          {t('admin.supportContactHint')}
        </p>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="sup-email">{t('admin.supportEmail')}</label>
            <input
              id="sup-email"
              type="email"
              inputMode="email"
              value={support.email}
              placeholder={supportLive?.email || 'support@billvyse.com'}
              onChange={(e) => patch('support.email', e.target.value)}
            />
            <p className="field-hint">{t('admin.supportEmailHint')}</p>
          </div>
          <div className="field">
            <label htmlFor="sup-wa">{t('admin.supportWhatsapp')}</label>
            <input
              id="sup-wa"
              inputMode="tel"
              value={support.whatsapp}
              placeholder="919876543210"
              onChange={(e) => patch('support.whatsapp', e.target.value)}
            />
            <p className="field-hint">{t('admin.supportWhatsappHint')}</p>
          </div>
          <div className="field">
            <label htmlFor="sup-phone">{t('admin.supportPhone')}</label>
            <input
              id="sup-phone"
              inputMode="tel"
              value={support.phone}
              placeholder="+91 98765 43210"
              onChange={(e) => patch('support.phone', e.target.value)}
            />
            <p className="field-hint">{t('admin.supportPhoneHint')}</p>
          </div>
          <div className="field">
            <label htmlFor="sup-hours">{t('admin.supportHours')}</label>
            <input
              id="sup-hours"
              value={support.hours}
              placeholder="Mon-Sat, 10am-7pm"
              onChange={(e) => patch('support.hours', e.target.value)}
            />
            <p className="field-hint">{t('admin.supportHoursHint')}</p>
          </div>
        </div>
        {supportLive && (
          <div className="admin-support-live">
            <span className="cell-sub">{t('admin.supportLive')}</span>
            <span className="admin-support-live-row">
              <span><MailIcon size={13} /> {supportLive.email}</span>
              <span className={supportLive.whatsapp ? '' : 'is-off'}>
                <WhatsappIcon size={13} /> {supportLive.whatsapp || t('admin.supportNotShown')}
              </span>
              <span className={supportLive.phone ? '' : 'is-off'}>
                <PhoneIcon size={13} /> {supportLive.phone || t('admin.supportNotShown')}
              </span>
              <span className={supportLive.hours ? '' : 'is-off'}>
                <ClockIcon size={13} /> {supportLive.hours || t('admin.supportNotShown')}
              </span>
            </span>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-brand"><UsersIcon size={16} /></div>
          <h2>{t('admin.dukaansTitle')}</h2>
        </div>
        <div className="checkbox-row">
          <Switch
            id="reg-toggle"
            checked={settings.registrationOpen}
            onChange={(v) => patch('registrationOpen', v)}
            label={t('admin.registrationOpen')}
          />
          <label htmlFor="reg-toggle">{t('admin.registrationOpen')}</label>
        </div>
        <div className="checkbox-row">
          <Switch
            id="approve-toggle"
            checked={settings.autoApproveShops}
            onChange={(v) => patch('autoApproveShops', v)}
            label={t('admin.autoApprove')}
          />
          <label htmlFor="approve-toggle">{t('admin.autoApprove')}</label>
        </div>
        <div className="field" style={{ maxWidth: '220px' }}>
          <label htmlFor="trial-days">{t('admin.trialDaysDefault')}</label>
          <input
            id="trial-days"
            type="number"
            min="0"
            max="365"
            value={settings.trialDays}
            onChange={(e) => patch('trialDays', Number(e.target.value))}
          />
        </div>
        <div className="field" style={{ maxWidth: '220px' }}>
          <label htmlFor="plan-reminder-days">{t('admin.planReminderDays')}</label>
          <input
            id="plan-reminder-days"
            type="number"
            min="0"
            max="30"
            value={settings.planReminderDays}
            onChange={(e) => patch('planReminderDays', Number(e.target.value))}
          />
        </div>
      </div>

      <div className="row-actions" style={{ alignItems: 'center' }}>
        <button className="btn btn-primary" disabled={saving} onClick={save}>
          {saving ? t('common.saving') : t('common.saveChanges')}
        </button>
        {settings.updatedAt && (
          <span className="cell-sub" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
            <CheckCircleIcon size={13} /> {t('admin.lastUpdated')} {formatRelativeTime(settings.updatedAt, lang)}
          </span>
        )}
      </div>
    </>
  );
}
