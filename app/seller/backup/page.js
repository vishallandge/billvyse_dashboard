'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { apiFetch, downloadFile } from '../../../lib/api';
import { formatDateTime, formatRelativeTime, formatRupees } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { SkeletonCards } from '../../components/Skeleton';
import { ShieldIcon, DownloadIcon, ExcelIcon, UploadIcon, AlertIcon, CheckCircleIcon, GoogleDriveIcon, LinkIcon, LogOutIcon } from '../../components/Icons';
import Dropdown from '../../components/Dropdown';

// Labels for the collection keys the backup summary returns. Anything not listed here
// still renders, just under its raw key — better than hiding data the file contains.
const COLLECTION_LABELS = {
  products: 'Products',
  customers: 'Khata customers',
  bills: 'Bills',
  customerTransactions: 'Khata entries',
  suppliers: 'Suppliers',
  purchaseOrders: 'Purchase orders',
  expenses: 'Kharcha entries',
  cashRegisters: 'Day book days',
  cashMovements: 'Bank deposits & owner cash',
  stockAdjustments: 'Stock adjustments',
  orders: 'Online orders',
  stores: 'Stores',
  storeStock: 'Store stock rows',
  coupons: 'Coupons',
  loyaltyTransactions: 'Loyalty entries',
  loyaltySettings: 'Loyalty settings',
};

// Reasons the Drive callback can bounce back with, in the seller's terms.
const GDRIVE_ERRORS = {
  gdrive_permission_denied: 'You cancelled the Google permission screen. Nothing was connected.',
  gdrive_missing_code: 'Google did not send back a permission code. Please try connecting again.',
  gdrive_bad_state: 'The connection link expired. Please press Connect Google Drive again.',
  gdrive_plan: 'Google Drive backup needs a Pro plan or higher.',
  gdrive_no_refresh_token:
    'Google did not grant offline access. Remove BillVyse from your Google account permissions, then connect again.',
  gdrive_callback_failed: 'Could not finish connecting to Google Drive. Please try again.',
};

export default function BackupPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef(null);

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [result, setResult] = useState(null);

  function load() {
    setLoading(true);
    apiFetch('/api/seller/backup/summary')
      .then(setSummary)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  // Handle OAuth callback status from URL query params
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const success = searchParams.get('success');
    const error = searchParams.get('error');
    if (success === 'gdrive_connected') {
      toast.success('Google Drive connected successfully!');
      load();
      router.replace('/seller/backup');
    } else if (error) {
      // Every branch of the callback sends its own reason, so the seller is told what
      // to actually do instead of a blanket "try again".
      toast.error(GDRIVE_ERRORS[error] || 'Google Drive connection failed. Please try again.');
      router.replace('/seller/backup');
    }
  }, [searchParams, toast, router]);

  async function handleGdriveConnect() {
    setConnecting(true);
    try {
      // Authenticated fetch, then navigate. A plain <a href> to the API sends no
      // Authorization header, so this 401'd the moment the API is on another host.
      const { url } = await apiFetch('/api/seller/backup/gdrive/connect');
      window.location.href = url;
    } catch (err) {
      toast.error(err.message);
      setConnecting(false);
    }
  }

  // Downloads go through an authenticated fetch rather than a plain link, so the
  // "backup taken" timestamp is only recorded once the file has actually arrived —
  // previously it was stamped on click, even if the download then failed.
  async function handleDownload(path, fallbackName, stamp) {
    setError('');
    setDownloading(path);
    try {
      await downloadFile(path, fallbackName);
      if (stamp) {
        await apiFetch('/api/seller/backup/taken', { method: 'POST' }).catch(() => {});
        load();
      }
      toast.success(t('backup.downloadReady'));
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setDownloading('');
    }
  }

  async function handleRestore(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!(await confirm({ tone: 'danger', title: t('backup.restore'), body: t('backup.confirmRestore'), confirmLabel: t('backup.restore') }))) return;

    setRestoring(true);
    setResult(null);
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      const response = await apiFetch('/api/seller/backup/restore', {
        method: 'POST',
        body: JSON.stringify({ backup }),
        // Slow on purpose, on BOTH sides. The server exempts /api/seller/backup from its
        // own deadline (middleware/timeout.js); without the same exemption here the
        // browser gave up at 30s on a year of a shop's data, retried with the same
        // idempotency key, and the still-running restore answered the retry with "This is
        // already being saved" — a restore that was working reported as a duplicate.
        // retries: 0 because re-uploading a whole backup file over the connection that
        // just struggled is not a repair; the button is still there to press.
        timeoutMs: 180000,
        retries: 0,
      });
      setResult(response);
      toast.success(t('backup.restoreDone'));
      load();
    } catch (err) {
      toast.error(err instanceof SyntaxError ? 'Backup file is not readable' : err.message);
    } finally {
      setRestoring(false);
    }
  }

  async function handleReminderChange(value) {
    const days = Number(value);
    try {
      await apiFetch('/api/seller/backup/settings', {
        method: 'PUT',
        body: JSON.stringify({ backupReminderDays: days }),
      });
      toast.success('Reminder setting saved!');
      setSummary((prev) => ({ ...prev, backupReminderDays: days }));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleAutoBackupToggle(next) {
    try {
      await apiFetch('/api/seller/backup/settings', {
        method: 'PUT',
        body: JSON.stringify({ autoBackupEnabled: next }),
      });
      toast.success(next ? t('backup.autoOn') : t('backup.autoOff'));
      // Clearing the stored failure locally too, so the banner goes with the toggle rather
      // than lingering until the next reload.
      setSummary((prev) => ({ ...prev, auto: { ...(prev?.auto || {}), enabled: next, lastError: next ? null : prev?.auto?.lastError } }));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleGdriveUpload() {
    if (!(await confirm({ tone: 'info', title: t('backup.driveUploadTitle'), body: t('backup.driveUploadBody'), confirmLabel: t('backup.driveUploadTitle') }))) return;
    setUploading(true);
    try {
      // Same reasoning as the restore above: the server builds the whole export and pushes
      // it to Drive inside this one request, which is minutes on a big shop and is exempt
      // from the server's deadline. A 30s client abort turned a working upload into
      // "This is already being saved", and the retry could have written a second file.
      const res = await apiFetch('/api/seller/backup/gdrive/upload', { method: 'POST', timeoutMs: 180000, retries: 0 });
      // A backup is a "did it really work?" moment, so this toast names the file, the
      // folder and the record count and holds for 8s — long enough to actually read
      // before it slides away, unlike the 3.2s default used for routine saves.
      toast.success(t('backup.uploadedTitle'), {
        duration: 8000,
        detail: [
          res.fileName,
          res.records != null ? `${res.records.toLocaleString('en-IN')} ${t('backup.records')}` : null,
          res.uploadedAt ? formatDateTime(res.uploadedAt, lang) : null,
        ]
          .filter(Boolean)
          .join(' • '),
      });
      load();
    } catch (err) {
      toast.error(err.message, { duration: 8000 });
    } finally {
      setUploading(false);
    }
  }

  async function handleGdriveDisconnect() {
    if (!(await confirm({ tone: 'warning', title: t('backup.driveDisconnectTitle'), body: t('backup.driveDisconnectBody'), confirmLabel: t('backup.driveDisconnectTitle') }))) return;
    try {
      await apiFetch('/api/seller/backup/gdrive/disconnect', { method: 'DELETE' });
      toast.success('Google Drive disconnected.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  const counts = summary?.counts || {};
  const totalRecords = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const lastBackupAt = summary?.lastBackupAt;
  const daysSinceBackup = lastBackupAt
    ? Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / 86400000)
    : null;
  const backupIsStale = daysSinceBackup == null || daysSinceBackup >= (summary?.backupReminderDays || 14);
  const gdriveConnected = summary?.gdrive?.connected;
  /**
   * Asked of the server, never decided here.
   *
   * This line used to be its own hardcoded `['pro','premium','enterprise'].includes(plan)`,
   * while the connect route asked a different question entirely. The button appeared for
   * every paid shop and the redirect refused every one of them. One answer, from the one
   * function that guards the route.
   */
  const allowGdrive = Boolean(summary?.gdriveAllowed);
  const lastDownloadAt = summary?.lastDownloadBackupAt;
  const lastDriveUploadAt = summary?.gdrive?.lastUploadAt;
  // Absent means on: an existing shop has no stored preference and the nightly copy is the
  // default (see User.autoBackupEnabled for why it defaults that way).
  const autoBackupOn = summary?.auto?.enabled !== false;

  return (
    <>
      <div className="content-header">
        <h1>{t('backup.title')}</h1>
        <p>{t('backup.subtitle')}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className={`reconcile-banner ${backupIsStale ? 'short' : 'ok'}`} style={{ marginTop: 0, marginBottom: '1.5rem' }}>
        {backupIsStale ? <AlertIcon size={17} /> : <CheckCircleIcon size={17} />}
        <div>
          <strong>
            {lastBackupAt
              ? `${t('backup.lastBackup')}: ${formatDateTime(lastBackupAt, lang)} (${formatRelativeTime(lastBackupAt, lang)})`
              : t('backup.never')}
          </strong>
          <span>{t('backup.warning')}</span>
        </div>
      </div>

      {/* The banner above only ever shows whichever backup happened last. These two rows
          answer the actual question — "file kab li thi" and "Drive pe kab gaya tha" —
          which are separate events a shopkeeper tracks separately. */}
      {!loading && (
        <div className="panel" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ marginTop: 0 }}>{t('backup.historyTitle')}</h2>

          <div className="reconcile-banner neutral" style={{ marginTop: '0.6rem' }}>
            <DownloadIcon size={17} />
            <div>
              <strong>
                {t('backup.historyFile')}:{' '}
                {lastDownloadAt ? formatDateTime(lastDownloadAt, lang) : t('backup.historyNone')}
              </strong>
              <span>
                {lastDownloadAt ? formatRelativeTime(lastDownloadAt, lang) : t('backup.historyNoFile')}
              </span>
            </div>
          </div>

          <div className="reconcile-banner neutral">
            <GoogleDriveIcon size={18} />
            <div>
              <strong>
                {t('backup.historyDrive')}:{' '}
                {lastDriveUploadAt ? formatDateTime(lastDriveUploadAt, lang) : t('backup.historyNone')}
              </strong>
              <span>
                {lastDriveUploadAt
                  ? [formatRelativeTime(lastDriveUploadAt, lang), summary?.gdrive?.lastFileName]
                      .filter(Boolean)
                      .join(' • ')
                  : gdriveConnected
                    ? t('backup.historyNoDrive')
                    : t('backup.historyDriveOff')}
              </span>
            </div>
          </div>

          {summary?.gdrive?.connectedAt && (
            <div className="reconcile-banner neutral">
              <LinkIcon size={17} />
              <div>
                <strong>
                  {t('backup.historyConnected')}: {formatDateTime(summary.gdrive.connectedAt, lang)}
                </strong>
                <span>{summary.gdrive.email}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <SkeletonCards count={2} height={220} />
      ) : (
        <>
          <div className="panel">
            <div className="two-col">
              <div>
                <h2>{t('backup.downloadTitle')}</h2>
                <p className="empty-state" style={{ textAlign: 'left', padding: '0 0 0.9rem' }}>
                  {t('backup.downloadHint')}
                </p>
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-inline"
                    disabled={downloading !== ''}
                    onClick={() => handleDownload('/api/seller/backup/export', 'backup.json', true)}
                  >
                    <DownloadIcon size={17} />
                    {downloading === '/api/seller/backup/export' ? t('backup.downloading') : t('backup.downloadJson')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-inline"
                    disabled={downloading !== ''}
                    onClick={() => handleDownload('/api/seller/backup/export.xlsx', 'backup.xlsx', true)}
                  >
                    <ExcelIcon size={17} />
                    {downloading === '/api/seller/backup/export.xlsx' ? t('backup.downloading') : t('backup.downloadExcel')}
                  </button>
                </div>

                <h2 style={{ marginTop: '1.5rem' }}>{t('backup.counts')}</h2>
                <ul className="ledger-list">
                  {Object.entries(counts)
                    .filter(([, count]) => count > 0)
                    .sort((a, b) => b[1] - a[1])
                    .map(([key, count]) => (
                      <li key={key}>
                        <span>{COLLECTION_LABELS[key] || key}</span>
                        <strong>{count}</strong>
                      </li>
                    ))}
                  <li className="total">
                    <span>{t('common.total')}</span>
                    <strong>{totalRecords}</strong>
                  </li>
                </ul>
              </div>
              <div>
                <h2>{t('backup.restoreTitle')}</h2>
                <p className="empty-state" style={{ textAlign: 'left', padding: '0 0 0.9rem' }}>
                  {t('backup.restoreHint')}
                </p>

                <button
                  type="button"
                  className="import-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={restoring}
                >
                  <span className="import-dropzone-icon">
                    {restoring ? <ShieldIcon size={22} /> : <UploadIcon size={22} />}
                  </span>
                  <strong>{restoring ? t('backup.restoring') : t('backup.chooseFile')}</strong>
                  <span>.json</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={handleRestore}
                  style={{ display: 'none' }}
                />

                {result && (
                  <ul className="ledger-list" style={{ marginTop: '1rem' }}>
                    {Object.entries(result.restored)
                      .filter(([, count]) => count > 0)
                      .map(([key, count]) => (
                        <li key={key} className="in">
                          <span>{COLLECTION_LABELS[key] || key}</span>
                          <strong>+{count}</strong>
                        </li>
                      ))}
                    <li className="total">
                      <span>{t('backup.restoreDone')}</span>
                      <strong>{Object.values(result.restored).reduce((sum, count) => sum + count, 0)}</strong>
                    </li>
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="two-col">
              <div>
                <h2>{t('backup.cloudTitle')}</h2>
                <p className="empty-state" style={{ textAlign: 'left', padding: '0 0 0.9rem' }}>
                  {t('backup.cloudHint')}
                </p>
                {allowGdrive ? (
                  gdriveConnected ? (
                    <div>
                      <div className="reconcile-banner ok" style={{ marginTop: 0 }}>
                        <CheckCircleIcon size={18} />
                        <div>
                          <strong>{t('backup.connectedAs')}</strong>
                          <span>{summary.gdrive.email}</span>
                        </div>
                      </div>
                      {/* The nightly copy. Shown only once Drive is connected, because that
                          is the only state in which it does anything — and shown as the
                          *status* of a thing already running, not as an invitation, since it
                          defaults to on (see User.autoBackupEnabled). */}
                      <div className="invoice-toggles" style={{ marginTop: '0.9rem' }}>
                        <label>
                          <input
                            type="checkbox"
                            checked={autoBackupOn}
                            onChange={(e) => handleAutoBackupToggle(e.target.checked)}
                          />
                          {t('backup.autoTitle')}
                        </label>
                      </div>
                      <p className="field-hint">
                        {autoBackupOn
                          ? summary?.auto?.lastRunAt
                            ? t('backup.autoLastRun', { when: formatRelativeTime(summary.auto.lastRunAt, lang) })
                            : t('backup.autoTonight')
                          : t('backup.autoOffHint')}
                      </p>
                      {/* A backup that has been failing quietly for a fortnight looks exactly
                          like one that is working. This is the only screen that can say so. */}
                      {autoBackupOn && summary?.auto?.lastError && (
                        <div className="error-banner" style={{ marginTop: '0.6rem' }}>
                          {t('backup.autoFailed')}: {summary.auto.lastError}
                        </div>
                      )}
                      <div className="row-actions" style={{ marginTop: '1rem' }}>
                        <button className="btn btn-primary btn-inline" onClick={handleGdriveUpload} disabled={uploading}>
                          <UploadIcon size={17} />
                          {uploading ? t('backup.driveUploading') : t('backup.driveUploadNow')}
                        </button>
                        {/* LogOut, not the link-break glyph that was here.
                            Phosphor's link-break carries two arcs and four motion ticks, and
                            at the 16px a button uses they collapse into a smudge you cannot
                            name — checked by rendering it, not by looking at the path. This
                            is also the truer word for what the button does: it signs the
                            shop out of a Google account, it does not sever a generic link. */}
                        <button className="btn btn-secondary btn-inline" onClick={handleGdriveDisconnect}>
                          <LogOutIcon size={17} />
                          {t('backup.driveDisconnect')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="btn btn-primary btn-inline"
                      onClick={handleGdriveConnect}
                      disabled={connecting}
                    >
                      {/* 20, where every other button glyph is 16. A brand mark is not a UI
                          glyph: it has to be RECOGNISED, and Drive's triangle loses its
                          inner divisions below about 20px and reads as a grey blob. */}
                      <GoogleDriveIcon size={20} />
                      {connecting ? t('backup.driveOpening') : t('backup.driveConnect')}
                    </button>
                  )
                ) : (
                  // Names the plan and the price, both off the catalog, so the shopkeeper
                  // can decide instead of being told to go and find out. Falls back to the
                  // price-free sentence that already existed for "no tier offers this" —
                  // which is also what the Google Play build gets, since it is sent no offer
                  // prices at all (backend/middleware/nativeClient.js).
                  <p className="field-hint">
                    {summary?.gdrivePlan?.priceMonthly != null
                      ? t('backup.cloudNeedsPlan', {
                          plan: summary.gdrivePlan.name,
                          price: formatRupees(summary.gdrivePlan.priceMonthly, lang),
                        })
                      : t('backup.cloudProOnly')}
                  </p>
                )}
              </div>
              <div>
                <h2>{t('backup.settingsTitle')}</h2>
                <div className="field-group">
                  <label htmlFor="reminder-days">{t('backup.remindEvery')}</label>
                  <Dropdown
                    id="reminder-days"
                    className="field-input"
                    value={summary?.backupReminderDays || 14}
                    onChange={handleReminderChange}
                    options={[
                      { value: '7', label: '7 days' },
                      { value: '14', label: '14 days' },
                      { value: '30', label: '30 days' },
                      { value: '60', label: '60 days' },
                    ]}
                  />
                  <p className="field-hint">{t('backup.remindHint')}</p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
