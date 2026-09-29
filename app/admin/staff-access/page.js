'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { SELLER_NAV_ITEMS } from '../../../lib/sellerNav';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import Switch from '../../components/Switch';
import { SkeletonCards } from '../../components/Skeleton';
import { AlertIcon, KeyIcon, UsersIcon } from '../../components/Icons';

// Every screen a permission opens, across the whole product (no one shop's trade applied) —
// the operator is deciding for all of them.
const SCREENS_BY_PERMISSION = SELLER_NAV_ITEMS.reduce((map, item) => {
  if (item.staffVisible && item.permission) (map[item.permission] ||= []).push(item.key);
  return map;
}, {});

/**
 * Admin → Staff access. What a shop owner can hand to a staff login, for every shop.
 *
 * Two levers, same shape as Modules: a switch per permission (off = not offered, and every
 * staff login holding it stops getting through at once — the stored grants are kept, so
 * switching it back on restores exactly who had it), and the ready-made roles, which can be
 * hidden or given a different set of boxes. "Cashiers should not get X any more" becomes a
 * tap here instead of a code change.
 */
export default function AdminStaffAccessPage() {
  const { t } = useLanguage();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');

  useEffect(() => {
    apiFetch('/api/admin/staff-access')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  async function save(body, savingKey, detail) {
    setSaving(savingKey);
    try {
      const res = await apiFetch('/api/admin/staff-access', { method: 'PATCH', body: JSON.stringify(body) });
      setData(res);
      toast.success(t('admin.staffAccessSaved'), detail ? { detail } : undefined);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving('');
    }
  }

  function togglePermission(key, on) {
    save({ permissions: { [key]: on } }, `perm-${key}`, t(`seller.perm.${key}`));
  }

  function toggleRole(preset, enabled) {
    save({ presets: { [preset.key]: { enabled } } }, `role-${preset.key}`, t(`seller.preset.${preset.key}`));
  }

  function toggleRolePermission(preset, key) {
    const next = preset.permissions.includes(key)
      ? preset.permissions.filter((p) => p !== key)
      : [...preset.permissions, key];
    if (next.length === 0) {
      toast.error(t('admin.roleNeedsOne'));
      return;
    }
    save({ presets: { [preset.key]: { permissions: next } } }, `role-${preset.key}`, t(`seller.preset.${preset.key}`));
  }

  function resetRole(preset) {
    save({ presets: { [preset.key]: { permissions: null, enabled: true } } }, `role-${preset.key}`, t(`seller.preset.${preset.key}`));
  }

  const offPermissions = data ? data.permissions.filter((perm) => !perm.on) : [];
  const offKeys = new Set(offPermissions.map((perm) => perm.key));
  const affected = offPermissions.reduce((sum, perm) => sum + perm.holders, 0);

  return (
    <>
      <div className="content-header">
        <h1>{t('admin.staffAccessTitle')}</h1>
        <p>{t('admin.staffAccessSubtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {offPermissions.length > 0 && (
        <div className="error-banner" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertIcon size={16} />
          {t('admin.staffAccessOffBanner', { count: offPermissions.length, staff: affected })}
        </div>
      )}

      {!data ? (
        <SkeletonCards count={2} height={200} />
      ) : (
        <>
          <div className="panel">
            <div className="section-title">
              <div className="icon-badge icon-muted"><KeyIcon size={16} /></div>
              <h2>{t('admin.staffPermsHeading')}</h2>
              {offPermissions.length > 0 && <span className="badge badge-rejected">{offPermissions.length} off</span>}
            </div>
            <p className="field-hint" style={{ marginTop: 0 }}>{t('admin.staffPermsHint', { n: data.staffCount })}</p>
            <div className="module-list">
              {data.permissions.map((perm) => {
                const screens = SCREENS_BY_PERMISSION[perm.key] || [];
                return (
                  <div className={`module-row${perm.on ? '' : ' is-off'}`} key={perm.key}>
                    <div className="module-main">
                      <div className="module-title">
                        <strong>{t(`seller.perm.${perm.key}`)}</strong>
                        <span className="badge badge-pending">{t('admin.staffHolders', { n: perm.holders })}</span>
                      </div>
                      <p>{t(`seller.permDesc.${perm.key}`)}</p>
                      {screens.length > 0 && (
                        <p className="module-meta">
                          {t('staff.opens', { list: screens.map((key) => t(`nav.${key}`)).join(' · ') })}
                        </p>
                      )}
                      {!perm.on && <p className="module-meta amount-out">{t('admin.staffPermOffHint')}</p>}
                    </div>
                    <div className="module-switch">
                      <span className={perm.on ? 'switch-label on' : 'switch-label off'}>
                        {perm.on ? t('admin.moduleOn') : t('admin.moduleOff')}
                      </span>
                      <Switch
                        id={`staff-perm-${perm.key}`}
                        checked={perm.on}
                        disabled={saving === `perm-${perm.key}`}
                        label={t(`seller.perm.${perm.key}`)}
                        onChange={(next) => togglePermission(perm.key, next)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <div className="section-title">
              <div className="icon-badge icon-muted"><UsersIcon size={16} /></div>
              <h2>{t('admin.staffRolesHeading')}</h2>
            </div>
            <p className="field-hint" style={{ marginTop: 0 }}>{t('admin.staffRolesHint')}</p>
            <div className="module-list">
              {data.presets.map((preset) => {
                const busy = saving === `role-${preset.key}`;
                const reachesShops = data.offeredPresets.includes(preset.key);
                return (
                  <div className={`module-row${preset.enabled ? '' : ' is-off'}`} key={preset.key}>
                    <div className="module-main">
                      <div className="module-title">
                        <strong>{t(`seller.preset.${preset.key}`)}</strong>
                        {preset.customised && <span className="badge badge-pending">{t('admin.roleCustomised')}</span>}
                        {preset.enabled && !reachesShops && (
                          <span className="badge badge-rejected">{t('admin.roleEmptied')}</span>
                        )}
                      </div>
                      <div className="chip-row" style={{ marginTop: '0.45rem' }}>
                        {data.permissions.map((perm) => {
                          const active = preset.permissions.includes(perm.key);
                          return (
                            <button
                              type="button"
                              key={perm.key}
                              className={`chip chip-sm${active ? ' active' : ''}`}
                              aria-pressed={active}
                              disabled={busy || !preset.enabled}
                              // A permission switched off above is still stored on the role, so
                              // switching it back on brings the role back whole — but say so.
                              data-tip={offKeys.has(perm.key) ? t('admin.rolePermOff') : undefined}
                              style={offKeys.has(perm.key) ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}
                              onClick={() => toggleRolePermission(preset, perm.key)}
                            >
                              {t(`seller.perm.${perm.key}`)}
                            </button>
                          );
                        })}
                      </div>
                      {preset.customised && (
                        <p className="module-meta">
                          <button type="button" className="link-btn" disabled={busy} onClick={() => resetRole(preset)}>
                            {t('admin.roleReset')}
                          </button>
                          {' · '}
                          {t('admin.roleDefaultWas', { list: preset.defaultPermissions.map((key) => t(`seller.perm.${key}`)).join(', ') })}
                        </p>
                      )}
                    </div>
                    <div className="module-switch">
                      <span className={preset.enabled ? 'switch-label on' : 'switch-label off'}>
                        {preset.enabled ? t('admin.roleShown') : t('admin.roleHidden')}
                      </span>
                      <Switch
                        id={`staff-role-${preset.key}`}
                        checked={preset.enabled}
                        disabled={busy}
                        label={t(`seller.preset.${preset.key}`)}
                        onChange={(next) => toggleRole(preset, next)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
