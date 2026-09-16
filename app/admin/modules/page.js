'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { groupIcon } from '../../../lib/moduleGroups';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import Switch from '../../components/Switch';
import { SkeletonCards } from '../../components/Skeleton';
import { AlertIcon, SearchIcon } from '../../components/Icons';

// A `defaultOff` module (not in the launch) is off until an explicit `true` is saved; every
// other module is on until an explicit `false`. Same rule as isPlatformOff() on the server.
function moduleIsOff(mod, platform) {
  const value = platform?.[mod.key];
  if (value === false) return true;
  return Boolean(mod.defaultOff) && value !== true;
}

export default function AdminModulesPage() {
  const { t } = useLanguage();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [noteDrafts, setNoteDrafts] = useState({});
  const [query, setQuery] = useState('');

  function load() {
    apiFetch('/api/admin/modules')
      .then((res) => {
        setData(res);
        setNoteDrafts(res.notes || {});
      })
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  const grouped = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.groups
      .map((group) => ({
        ...group,
        modules: Object.values(data.registry).filter(
          (mod) =>
            mod.group === group.key &&
            (!q || mod.label.toLowerCase().includes(q) || mod.description.toLowerCase().includes(q))
        ),
      }))
      .filter((group) => group.modules.length > 0);
  }, [data, query]);

  async function toggle(key, enabled) {
    setSaving(key);
    try {
      const res = await apiFetch('/api/admin/modules', {
        method: 'PATCH',
        body: JSON.stringify({ modules: { [key]: enabled ? (data.registry[key].defaultOff ? true : null) : false } }),
      });
      setData((prev) => ({ ...prev, platform: res.platform, notes: res.notes }));
      toast.success(t('admin.modulesSaved'), { detail: data.registry[key].label });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving('');
    }
  }

  async function saveNote(key) {
    setSaving(key);
    try {
      const res = await apiFetch('/api/admin/modules', {
        method: 'PATCH',
        body: JSON.stringify({ modules: {}, notes: { [key]: noteDrafts[key] || '' } }),
      });
      setData((prev) => ({ ...prev, platform: res.platform, notes: res.notes }));
      toast.success(t('admin.modulesSaved'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving('');
    }
  }

  const offCount = data ? Object.values(data.registry).filter((mod) => moduleIsOff(mod, data.platform)).length : 0;

  return (
    <>
      <div className="content-header">
        <h1>{t('admin.modulesTitle')}</h1>
        <p>{t('admin.modulesSubtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {offCount > 0 && (
        <div className="error-banner" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertIcon size={16} />
          {offCount} {t('admin.disabledModules')} — {data.shopCount} dukaan affected.
        </div>
      )}

      {data && (
        <div className="search-box-inline" style={{ maxWidth: '360px', marginBottom: '1.2rem' }}>
          <SearchIcon size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('admin.searchModules')} />
        </div>
      )}

      {!data ? (
        <SkeletonCards count={4} height={140} />
      ) : grouped.length === 0 ? (
        <p className="empty-state">{t('admin.noResults')}</p>
      ) : (
        grouped.map((group) => {
          const GroupIcon = groupIcon(group.key);
          const offInGroup = group.modules.filter((mod) => moduleIsOff(mod, data.platform)).length;
          return (
          <div className="panel" key={group.key}>
            <div className="section-title">
              <div className="icon-badge icon-muted"><GroupIcon size={16} /></div>
              <h2>{group.label}</h2>
              {offInGroup > 0 && <span className="badge badge-rejected">{offInGroup} off</span>}
            </div>
            <div className="module-list">
              {group.modules.map((mod) => {
                const isOff = moduleIsOff(mod, data.platform);
                const counts = data.overrideCounts?.[mod.key] || { on: 0, off: 0 };
                return (
                  <div className={`module-row${isOff ? ' is-off' : ''}`} key={mod.key}>
                    <div className="module-main">
                      <div className="module-title">
                        <strong>{mod.label}</strong>
                        {mod.core && <span className="badge badge-active">{t('admin.coreModule')}</span>}
                        {mod.planFeature && <span className="badge badge-pending">{mod.planFeature}</span>}
                      </div>
                      <p>{mod.description}</p>
                      {(counts.on > 0 || counts.off > 0) && (
                        <p className="module-meta">
                          {counts.on > 0 && <span className="amount-in">{counts.on} forced on</span>}
                          {counts.on > 0 && counts.off > 0 && ' · '}
                          {counts.off > 0 && <span className="amount-out">{counts.off} forced off</span>}
                        </p>
                      )}
                      {isOff && (
                        <div className="module-note">
                          <input
                            value={noteDrafts[mod.key] || ''}
                            placeholder={t('admin.notePlaceholder')}
                            onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [mod.key]: e.target.value }))}
                          />
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            disabled={saving === mod.key}
                            onClick={() => saveNote(mod.key)}
                          >
                            {t('common.save')}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="module-switch">
                      <span className={isOff ? 'switch-label off' : 'switch-label on'}>
                        {mod.core ? t('admin.coreModule') : isOff ? t('admin.moduleOff') : t('admin.moduleOn')}
                      </span>
                      <Switch
                        id={`mod-${mod.key}`}
                        checked={!isOff}
                        disabled={mod.core || saving === mod.key}
                        label={mod.label}
                        onChange={(next) => toggle(mod.key, next)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          );
        })
      )}
    </>
  );
}
