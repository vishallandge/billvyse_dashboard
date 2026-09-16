'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, downloadFile } from '../../../lib/api';
import { formatRelativeTime, formatDateTime } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import Switch from '../../components/Switch';
import Dropdown from '../../components/Dropdown';
import AnimatedNumber from '../../components/AnimatedNumber';
import { SkeletonStats, SkeletonCards } from '../../components/Skeleton';
import {
  AlertIcon,
  CheckCircleIcon,
  ClockIcon,
  DownloadIcon,
  InfoIcon,
  LayersIcon,
  RefreshIcon,
  ShieldIcon,
  SpinnerIcon,
  TrashIcon,
} from '../../components/Icons';

/**
 * Admin → Backups.
 *
 * The screen exists to make one thing impossible: believing there is a backup when there
 * is not. That is why the top strip leads with "last GOOD copy" rather than "last run"
 * (the newest run can be a failure), why a failure keeps its reason in full instead of a
 * red dot, and why the R2 panel names the exact environment variables that are missing
 * rather than saying "storage is not configured" and leaving somebody to hunt.
 */

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * "in 5h" for something that has not happened yet.
 *
 * formatRelativeTime() only ever looks backwards — it subtracts from now, so a date five
 * hours in the future lands under its "less than a minute" branch and prints "just now".
 * On this screen that is not a cosmetic bug: the card would report the next backup as
 * having already happened, every single time, which is the exact false comfort the whole
 * page exists to prevent.
 */
function formatUntil(value, lang) {
  if (!value) return '—';
  const diffMin = Math.round((new Date(value).getTime() - Date.now()) / 60000);
  if (diffMin <= 0) return formatDateTime(value, lang);
  if (diffMin < 60) return `in ${diffMin}m`;
  if (diffMin < 24 * 60) return `in ${Math.round(diffMin / 60)}h`;
  if (diffMin < 30 * 24 * 60) return `in ${Math.round(diffMin / (60 * 24))}d`;
  return formatDateTime(value, lang);
}

function formatDuration(ms) {
  if (!ms) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: `${String(hour).padStart(2, '0')}:00`,
}));

export default function AdminBackupsPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [open, setOpen] = useState(null);
  const pollRef = useRef(null);

  const load = useCallback(
    () =>
      apiFetch('/api/admin/backups')
        .then(setData)
        .catch((err) => setError(err.message)),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  // A dump takes minutes and runs on the server whether or not this tab is open, so the
  // screen polls rather than holding a request. The interval is cleared the moment the run
  // finishes — a page left open overnight must not keep asking forever.
  useEffect(() => {
    if (!data?.running) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return undefined;
    }
    pollRef.current = setInterval(load, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [data?.running, load]);

  function patch(key, value) {
    setData((prev) => ({ ...prev, backup: { ...prev.backup, [key]: value } }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await apiFetch('/api/admin/backups/settings', {
        method: 'PATCH',
        body: JSON.stringify(data.backup),
      });
      setData((prev) => ({ ...prev, backup: res.backup, nextDueAt: res.nextDueAt }));
      toast.success(t('admin.settingsSaved'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setStarting(true);
    try {
      await apiFetch('/api/admin/backups/run', { method: 'POST' });
      toast.success(t('admin.backupStarted'));
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setStarting(false);
    }
  }

  // Retention is applied at the end of every backup, so this exists for one case only:
  // the operator has just LOWERED "how many to keep" and does not want to wait until
  // tonight for the extra copies to actually go. Shown only when there are more than the
  // setting allows, so it is never a button that does nothing.
  async function pruneNow() {
    const ok = await confirm({
      tone: 'danger',
      title: t('admin.backupPruneNow'),
      body: t('admin.backupPruneConfirm', { n: backup.keepCount }),
      confirmLabel: t('admin.backupPruneNow'),
    });
    if (!ok) return;
    try {
      const res = await apiFetch('/api/admin/backups/prune', { method: 'POST' });
      toast.success(t('admin.backupPruned', { n: res.removed }));
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function download(run) {
    try {
      await downloadFile(`/api/admin/backups/${run._id}/download`, run.filename);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function remove(run) {
    const ok = await confirm({
      tone: 'danger',
      title: t('admin.backupDelete'),
      body: t('admin.backupDeleteConfirm'),
      details: run.filename,
      confirmLabel: t('admin.backupDelete'),
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/admin/backups/${run._id}`, { method: 'DELETE' });
      toast.success(t('admin.backupDeleted'));
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!data) {
    return (
      <>
        <div className="content-header">
          <h1>{t('admin.backupTitle')}</h1>
          <p>{t('admin.backupSubtitle')}</p>
        </div>
        <SkeletonStats count={4} />
        <SkeletonCards count={2} height={160} />
      </>
    );
  }

  const { backup, storage, lastSuccess, running, nextDueAt, runs } = data;

  // "Stale" is judged against the operator's own interval plus a day of slack, not against
  // a number invented here: a shop backing up every 3 days is not late on day two.
  const staleAfterMs = (Number(backup.everyDays || 1) + 1) * 24 * 60 * 60 * 1000;
  const lastAgeMs = lastSuccess ? Date.now() - new Date(lastSuccess.startedAt).getTime() : Infinity;
  const healthy = Boolean(lastSuccess) && lastAgeMs < staleAfterMs;
  // Counted off the successes only — failed rows hold no bytes and retention never touches
  // them, so including them here would offer a cleanup that frees nothing.
  const overKeep = Math.max(0, runs.filter((run) => run.status === 'success').length - Number(backup.keepCount || 0));

  return (
    <>
      <div className="content-header">
        <h1>{t('admin.backupTitle')}</h1>
        <p>{t('admin.backupSubtitle')}</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-card-top">
            <div className={`stat-card-icon ${healthy ? 'icon-success' : 'icon-danger'}`}>
              {healthy ? <CheckCircleIcon size={17} /> : <AlertIcon size={17} />}
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: 'var(--fs-lg)' }}>
            {lastSuccess ? formatRelativeTime(lastSuccess.startedAt, lang) : t('admin.backupNever')}
          </div>
          <div className="stat-label">{t('admin.backupLastGood')}</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon icon-muted"><LayersIcon size={17} /></div>
          </div>
          <div className="stat-value">
            <AnimatedNumber value={lastSuccess?.documents || 0} decimals={false} />
          </div>
          <div className="stat-label">
            {t('admin.backupDocs')} · {formatBytes(lastSuccess?.bytes)}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-top">
            <div className={`stat-card-icon ${storage.r2Configured ? 'icon-success' : 'icon-gold'}`}>
              <ShieldIcon size={17} />
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: 'var(--fs-lg)' }}>
            {storage.r2Configured ? t('admin.backupOnR2') : t('admin.backupOnDisk')}
          </div>
          <div className="stat-label">{t('admin.backupWhere')}</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon icon-muted"><ClockIcon size={17} /></div>
          </div>
          <div
            className="stat-value"
            style={{ fontSize: 'var(--fs-lg)' }}
            data-tip={nextDueAt ? formatDateTime(nextDueAt, lang) : undefined}
          >
            {nextDueAt ? formatUntil(nextDueAt, lang) : t('admin.backupOff')}
          </div>
          <div className="stat-label">{t('admin.backupNextDue')}</div>
        </div>
      </div>

      {/* The one thing on this page that turns "set up later" into a named, finishable task. */}
      {!storage.r2Configured && (
        <div className="panel">
          <div className="section-title">
            <div className="icon-badge icon-gold"><AlertIcon size={16} /></div>
            <h2>{t('admin.backupDiskWarnTitle')}</h2>
          </div>
          <p className="empty-state" style={{ textAlign: 'left', padding: '0 0 0.7rem' }}>
            {t('admin.backupDiskWarnBody')}
          </p>
          <div className="row-actions" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
            {storage.missingEnv.map((key) => (
              <span key={key} className="badge">{key}</span>
            ))}
          </div>
          {storage.localDir && (
            <p className="cell-sub" style={{ marginTop: '0.7rem' }}>
              {t('admin.backupLocalDir')}: <code>{storage.localDir}</code>
            </p>
          )}
        </div>
      )}

      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-brand"><ClockIcon size={16} /></div>
          <h2>{t('admin.backupSchedule')}</h2>
        </div>

        <div className="checkbox-row">
          <Switch
            id="backup-enabled"
            checked={backup.enabled}
            onChange={(v) => patch('enabled', v)}
            label={t('admin.backupEnabled')}
          />
          <label htmlFor="backup-enabled">{t('admin.backupEnabled')}</label>
        </div>

        <div className="form-grid cols-2">
          <div className="field">
            <label htmlFor="backup-every">{t('admin.backupEveryDays')}</label>
            <input
              id="backup-every"
              type="number"
              min="1"
              max="30"
              value={backup.everyDays}
              onChange={(e) => patch('everyDays', Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="backup-hour">{t('admin.backupHour')}</label>
            <Dropdown
              id="backup-hour"
              value={backup.hourIst}
              onChange={(v) => patch('hourIst', Number(v))}
              options={HOURS}
            />
          </div>
          <div className="field">
            <label htmlFor="backup-keep">{t('admin.backupKeep')}</label>
            <input
              id="backup-keep"
              type="number"
              min="1"
              max="90"
              value={backup.keepCount}
              onChange={(e) => patch('keepCount', Number(e.target.value))}
            />
          </div>
        </div>

        <div className="checkbox-row">
          <Switch
            id="backup-files"
            checked={backup.includeFiles}
            onChange={(v) => patch('includeFiles', v)}
            label={t('admin.backupIncludeFiles')}
          />
          <label htmlFor="backup-files">{t('admin.backupIncludeFiles')}</label>
        </div>
        <p className="cell-sub">{t('admin.backupIncludeFilesHint')}</p>

        <div className="row-actions" style={{ alignItems: 'center', marginTop: '0.9rem' }}>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
            {saving ? t('common.saving') : t('common.saveChanges')}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{t('admin.backupHistory')}</h2>
          <div className="panel-tools">
            <button type="button" className="btn btn-secondary btn-small" onClick={load} data-tip={t('common.refresh')}>
              <RefreshIcon size={15} />
            </button>
            {overKeep > 0 && (
              <button type="button" className="btn btn-secondary btn-small" onClick={pruneNow}>
                <TrashIcon size={15} /> {t('admin.backupPruneNow')} ({overKeep})
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-small"
              disabled={starting || Boolean(running)}
              onClick={runNow}
            >
              {running ? <SpinnerIcon size={15} /> : <ShieldIcon size={15} />}{' '}
              {running ? t('admin.backupRunning') : t('admin.backupRunNow')}
            </button>
          </div>
        </div>

        {runs.length === 0 ? (
          <p className="empty-state">{t('admin.backupNoRuns')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>{t('admin.backupWhen')}</th>
                  <th>{t('admin.backupStatus')}</th>
                  <th>{t('admin.backupTrigger')}</th>
                  <th className="tabular">{t('admin.backupDocs')}</th>
                  <th className="tabular">{t('admin.backupSize')}</th>
                  <th>{t('admin.backupWhere')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <Fragment key={run._id}>
                    <tr>
                      <td className="tabular" data-tip={formatDateTime(run.startedAt, lang)}>
                        {formatRelativeTime(run.startedAt, lang)}
                        {run.durationMs ? <div className="cell-sub">{formatDuration(run.durationMs)}</div> : null}
                      </td>
                      <td>
                        {run.status === 'running' && <span className="badge">{t('admin.backupRunning')}</span>}
                        {run.status === 'success' && <span className="badge badge-active">{t('admin.backupSuccess')}</span>}
                        {run.status === 'failed' && (
                          // The reason in full, on the row. A failed backup whose cause is
                          // one click away is a failed backup nobody reads.
                          <>
                            <span className="badge badge-danger">{t('admin.backupFailed')}</span>
                            <div className="cell-sub" style={{ maxWidth: 320 }}>{run.error}</div>
                          </>
                        )}
                      </td>
                      <td>{run.trigger === 'auto' ? t('admin.backupAuto') : t('admin.backupManual')}</td>
                      <td className="tabular">{run.documents ? run.documents.toLocaleString('en-IN') : '—'}</td>
                      <td className="tabular">{formatBytes(run.bytes)}</td>
                      <td>
                        {run.status === 'success'
                          ? run.storage === 'r2'
                            ? t('admin.backupOnR2')
                            : t('admin.backupOnDisk')
                          : '—'}
                      </td>
                      <td>
                        <div className="row-actions">
                          {run.collectionCount > 0 && (
                            <button
                              type="button"
                              className="icon-btn"
                              data-tip={t('admin.backupCollections')}
                              onClick={() => setOpen(open === run._id ? null : run._id)}
                            >
                              <InfoIcon size={17} />
                            </button>
                          )}
                          {run.status === 'success' && (
                            <button
                              type="button"
                              className="icon-btn"
                              data-tip={t('admin.backupDownload')}
                              onClick={() => download(run)}
                            >
                              <DownloadIcon size={17} />
                            </button>
                          )}
                          {run.status !== 'running' && (
                            <button
                              type="button"
                              className="icon-btn danger"
                              data-tip={t('admin.backupDelete')}
                              onClick={() => remove(run)}
                            >
                              <TrashIcon size={17} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {open === run._id && (
                      // The per-collection counts, which are the only real way to tell a
                      // healthy backup from a backup of a broken database.
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--surface-strong)' }}>
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                              gap: '0.25rem 1.2rem',
                            }}
                          >
                            {run.collections.map((c) => (
                              <div
                                key={c.name}
                                className="cell-sub"
                                style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem' }}
                              >
                                <span>{c.name}</span>
                                <span className="tabular">{c.documents.toLocaleString('en-IN')}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="section-title">
          <div className="icon-badge icon-muted"><InfoIcon size={16} /></div>
          <h2>{t('admin.backupRestoreTitle')}</h2>
        </div>
        <p className="empty-state" style={{ textAlign: 'left', padding: '0 0 0.6rem' }}>
          {t('admin.backupRestoreBody')}
        </p>
        <pre
          style={{
            margin: 0,
            padding: '0.7rem 0.9rem',
            background: 'var(--surface-strong)',
            borderRadius: 'var(--radius-sm)',
            overflowX: 'auto',
            fontSize: 'var(--fs-sm)',
          }}
        >
{`npm run restore:backup -- billvyse-....ndjson.gz
npm run restore:backup -- billvyse-....ndjson.gz --to mongodb://127.0.0.1:27017/scratch --drop`}
        </pre>
      </div>
    </>
  );
}
