'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch, downloadFile } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { recordHref } from '../../lib/routeId';
import {
  AUDIT_GROUPS,
  auditActionName,
  auditDetails,
  auditGroup,
  auditMeta,
  auditParties,
  auditPreview,
} from '../../lib/audit';
import { useLanguage } from './LanguageProvider';
import { useToast } from './Toast';
import { SkeletonCards } from './Skeleton';
import { SearchIcon, ExcelIcon, ChevronDownIcon, CopyIcon, StoreIcon, XIcon, InfoIcon, AuditIcon } from './Icons';
import DateRangeFilter, { rangeToQuery } from './DateRangeFilter';
import Dropdown from './Dropdown';

const PAGE_SIZE = 100;
// Matches the server's own cap on this route. Without it "load more" keeps offering itself
// after the server has stopped growing the response — a button that does nothing.
const MAX_ROWS = 1000;

// An activity log opens on everything. Every other filtered list in the app defaults to
// today, but "what happened today" is the one question an admin can already answer from
// the overview's recent-activity feed — this screen exists for the other one.
const DEFAULT_RANGE = { preset: 'all', from: '', to: '' };

function dayKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function timeOnly(value, lang) {
  const text = new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return lang === 'hi' || lang === 'mr' ? formatDateTime(value, lang).split(',').pop().trim() : text;
}

/**
 * The block support pastes into a ticket or sends to a developer. Plain text on purpose —
 * it has to survive WhatsApp, and the raw meta is the part a developer actually needs.
 */
function copyText(entry, name, parties) {
  return [
    `What: ${name} (${entry.action})`,
    `When: ${new Date(entry.createdAt).toISOString()}`,
    `Who: ${parties.actor}${entry.actor ? ` [${entry.actor}]` : ''}`,
    entry.shop ? `Shop: ${entry.shop.name} [${entry.shop.id}]` : null,
    entry.targetLabel ? `Target: ${entry.targetLabel}${entry.target ? ` [${entry.target}]` : ''}` : null,
    entry.ip ? `IP: ${entry.ip}` : null,
    `Log id: ${entry._id}`,
    entry.meta ? `Data: ${JSON.stringify(entry.meta, null, 2)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function AuditRow({ entry, open, onToggle, onOnlyShop, onCopy, inShop = false }) {
  const { t, lang } = useLanguage();
  const { icon: ActionIcon, tone } = auditMeta(entry.action, entry.meta);
  const name = auditActionName(entry.action, t, entry.meta);
  const parties = auditParties(entry, t);
  const details = useMemo(() => auditDetails(entry, { t, lang }), [entry, t, lang]);
  const preview = auditPreview(details);
  const group = auditGroup(entry.action);

  return (
    <li className={`audit-row${open ? ' is-open' : ''}`}>
      <button type="button" className="audit-row-head" aria-expanded={open} onClick={onToggle}>
        <span className={`icon-badge icon-${tone}`}>
          <ActionIcon size={15} />
        </span>
        <span className="audit-row-main">
          <span className="audit-row-title">{name}</span>
          <span className="audit-row-sub">
            <span>{t('admin.auditBy', { name: parties.actor })}</span>
            {parties.targetLabel && (
              <span>
                {parties.targetKindLabel ? `${parties.targetKindLabel}: ` : ''}
                <strong>{parties.targetLabel}</strong>
              </span>
            )}
            {parties.shop && !inShop && (
              <span className="audit-row-shop">
                <StoreIcon size={12} /> {parties.shop.name}
              </span>
            )}
          </span>
        </span>
        {preview && <span className="audit-row-preview">{preview}</span>}
        <span className="audit-row-time tabular" data-tip={formatDateTime(entry.createdAt, lang)}>
          {timeOnly(entry.createdAt, lang)}
        </span>
        <ChevronDownIcon size={16} className="audit-row-chevron" />
      </button>

      {open && (
        <div className="audit-detail">
          <div className="audit-detail-main">
            <h3>{details.changes.length > 0 ? t('admin.auditWhatChanged') : t('admin.auditDetails')}</h3>
            {details.changes.length > 0 ? (
              <div className="audit-changes">
                {details.changes.map((c) => (
                  <div className="audit-change" key={c.key}>
                    <span className="audit-change-label">{c.label}</span>
                    <span className="audit-change-from">{c.from}</span>
                    <span className="audit-change-arrow" aria-hidden="true">→</span>
                    <span className="audit-change-to">{c.to}</span>
                  </div>
                ))}
              </div>
            ) : details.facts.length === 0 ? (
              <p className="audit-muted">{t('admin.auditNothingRecorded')}</p>
            ) : null}

            {details.facts.length > 0 && (
              <dl className="audit-facts">
                {details.facts.map((f) => (
                  <Fragment key={f.key}>
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </Fragment>
                ))}
              </dl>
            )}

            <p className="audit-hint">
              <InfoIcon size={14} />
              <span>{t(`admin.auditHint.${group}`)}</span>
            </p>
          </div>

          <div className="audit-detail-tech">
            <h3>{t('admin.auditTech')}</h3>
            <dl className="audit-facts audit-facts-tight">
              <dt>{t('admin.auditExactTime')}</dt>
              <dd className="tabular">{new Date(entry.createdAt).toLocaleString('en-IN')}</dd>
              <dt>{t('admin.auditCode')}</dt>
              <dd><code className="audit-code">{entry.action}</code></dd>
              {entry.ip && (
                <>
                  <dt>{t('admin.auditIp')}</dt>
                  <dd><code className="audit-code">{entry.ip}</code></dd>
                </>
              )}
              {details.ids.map((id) => (
                <Fragment key={id.label}>
                  <dt>{id.label}</dt>
                  <dd><code className="audit-code">{id.value}</code></dd>
                </Fragment>
              ))}
              <dt>{t('admin.auditLogId')}</dt>
              <dd><code className="audit-code">{entry._id}</code></dd>
            </dl>

            <div className="audit-actions">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => onCopy(copyText(entry, name, parties))}>
                <CopyIcon size={15} /> {t('admin.auditCopy')}
              </button>
              {parties.shop && !inShop && (
                <>
                  <button type="button" className="link-btn" onClick={() => onOnlyShop(parties.shop)}>
                    {t('admin.auditOnlyShop')}
                  </button>
                  <Link className="link-btn" href={recordHref('/admin/sellers/[id]', parties.shop.id)}>
                    {t('admin.auditOpenShop')}
                  </Link>
                </>
              )}
            </div>

            {entry.meta && Object.keys(entry.meta).length > 0 && (
              <details className="audit-raw">
                <summary>{t('admin.auditRaw')}</summary>
                <pre>{JSON.stringify(entry.meta, null, 2)}</pre>
              </details>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * The activity timeline — the whole platform's, or one shop's.
 *
 * `lockedShop` pins it to one dukaan (the Shop control screen): the shop filter cannot be
 * removed, and the shop's own name is left off every row because the whole panel is already
 * about it. `initialShop` only starts the platform view filtered (picked from "By shop"), and
 * stays removable. Renders exactly one `.panel`.
 */
export default function AuditTimeline({ lockedShop = null, initialShop = null, note = '' }) {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const [entries, setEntries] = useState(null);
  const [total, setTotal] = useState(0);
  const [actions, setActions] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [action, setAction] = useState('');
  const [group, setGroup] = useState('');
  const [pickedShop, setPickedShop] = useState(initialShop);
  const [query, setQuery] = useState('');
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [openId, setOpenId] = useState(null);
  const shop = lockedShop || pickedShop;

  // The overview's attention cards deep-link here with ?action=… — "3 prescription tags
  // removed" is only worth clicking if it lands on those three. Read off the raw URL rather
  // than useSearchParams so this page doesn't need a Suspense boundary for one optional
  // filter. Applied once, so the dropdown stays freely usable afterwards.
  useEffect(() => {
    if (lockedShop || typeof window === 'undefined') return;
    const incoming = new URLSearchParams(window.location.search).get('action');
    if (incoming) setAction(incoming);
  }, [lockedShop]);

  // The dropdown used to offer a hard-coded list of action strings that had already
  // drifted from what the server writes. It now asks.
  useEffect(() => {
    apiFetch('/api/admin/audit/actions')
      .then((res) => setActions(res.actions))
      .catch(() => {});
  }, []);

  const params = useCallback(
    (extra = {}) => {
      const search = new URLSearchParams(rangeToQuery(range));
      if (action) search.set('action', action);
      else if (group) {
        const def = AUDIT_GROUPS.find((g) => g.key === group);
        if (def) search.set('prefix', def.prefixes.join(','));
      }
      if (shop) search.set('target', shop.id);
      if (query.trim()) search.set('q', query.trim());
      for (const [key, value] of Object.entries(extra)) search.set(key, value);
      return search;
    },
    [range, action, group, shop, query]
  );

  const load = useCallback(
    (nextLimit) => {
      setLoading(true);
      apiFetch(`/api/admin/audit?${params({ limit: String(nextLimit ?? PAGE_SIZE) }).toString()}`)
        .then((res) => {
          setError('');
          setEntries(res.entries);
          setTotal(res.total ?? res.entries.length);
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    },
    [params]
  );

  // Search is on the server, so it is debounced like every other server-side search box.
  useEffect(() => {
    const timer = setTimeout(() => {
      setLimit(PAGE_SIZE);
      load(PAGE_SIZE);
    }, 250);
    return () => clearTimeout(timer);
  }, [load]);

  function loadMore() {
    const next = limit + PAGE_SIZE;
    setLimit(next);
    load(next);
  }

  async function exportXlsx() {
    setExporting(true);
    try {
      const slug = shop ? `-${shop.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : '';
      await downloadFile(
        `/api/admin/audit?${params({ format: 'xlsx' }).toString()}`,
        `activity-log${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`
      );
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(false);
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('admin.auditCopied'));
    } catch {
      toast.error(t('admin.auditCopyFailed'));
    }
  }

  function pickGroup(key) {
    setGroup(key);
    // A specific action from another category would silently win over the chip.
    if (action && key && auditGroup(action) !== key) setAction('');
  }

  // The action dropdown, grouped under the same categories as the chips and named in words.
  const actionGroups = useMemo(() => {
    const keys = [...AUDIT_GROUPS.map((g) => g.key), 'other'];
    const visible = group ? [group] : keys;
    return visible
      .map((key) => ({
        label: t(`admin.auditGroup.${key}`),
        options: actions
          .filter((a) => auditGroup(a) === key)
          .map((a) => ({ value: a, label: auditActionName(a, t) }))
          .sort((x, y) => x.label.localeCompare(y.label)),
      }))
      .filter((g) => g.options.length > 0);
  }, [actions, group, t]);

  const days = useMemo(() => {
    if (!entries) return [];
    const today = dayKey(Date.now());
    const yesterday = dayKey(Date.now() - 86400000);
    const out = [];
    for (const entry of entries) {
      const key = dayKey(entry.createdAt);
      let bucket = out[out.length - 1];
      if (!bucket || bucket.key !== key) {
        const label =
          key === today ? t('admin.auditToday') : key === yesterday ? t('admin.auditYesterday') : formatDate(entry.createdAt, lang);
        bucket = { key, label, rows: [] };
        out.push(bucket);
      }
      bucket.rows.push(entry);
    }
    return out;
  }, [entries, t, lang]);

  const filtersActive = Boolean(action || group || pickedShop || query.trim() || range.preset !== 'all');

  function clearAll() {
    setAction('');
    setGroup('');
    setPickedShop(null);
    setQuery('');
    setRange(DEFAULT_RANGE);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="section-title">
          <div className="icon-badge icon-brand"><AuditIcon size={16} /></div>
          <h2>
            {t('admin.auditTitle')} <span className="audit-count tabular">{total.toLocaleString('en-IN')}</span>
          </h2>
        </div>
        <div className="panel-tools">
          <div className="search-box-inline">
            <SearchIcon size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(lockedShop ? 'admin.auditSearchInShop' : 'admin.auditSearch')}
            />
          </div>
          <DateRangeFilter value={range} onChange={setRange} compact />
          <Dropdown
            className="filter-select"
            value={action}
            onChange={setAction}
            searchable
            placeholder={t('admin.auditAnyAction')}
            groups={[{ label: '', options: [{ value: '', label: t('admin.auditAnyAction') }] }, ...actionGroups]}
          />
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={exporting || total === 0}
            onClick={exportXlsx}
          >
            <ExcelIcon size={17} /> {exporting ? t('common.loading') : t('admin.exportXlsx')}
          </button>
        </div>
      </div>

      {note && <p className="section-note">{note}</p>}
      {error && <div className="error-banner">{error}</div>}

      <div className="audit-filters">
        <div className="chip-row">
          <button type="button" className={`chip chip-sm${!group ? ' active' : ''}`} onClick={() => pickGroup('')}>
            {t('admin.auditGroup.all')}
          </button>
          {AUDIT_GROUPS.map((g) => (
            <button
              type="button"
              key={g.key}
              className={`chip chip-sm${group === g.key ? ' active' : ''}`}
              onClick={() => pickGroup(g.key)}
            >
              {t(`admin.auditGroup.${g.key}`)}
            </button>
          ))}
        </div>
        {filtersActive && (
          <div className="audit-active">
            {pickedShop && (
              <span className="audit-shop-pill">
                <StoreIcon size={13} /> {t('admin.auditShowingShop', { name: pickedShop.name })}
                <button type="button" aria-label={t('admin.auditClearShop')} onClick={() => setPickedShop(null)}>
                  <XIcon size={12} />
                </button>
              </span>
            )}
            <button type="button" className="link-btn" onClick={clearAll}>
              {t('admin.auditClearAll')}
            </button>
          </div>
        )}
        {group && <p className="audit-group-hint">{t(`admin.auditHint.${group}`)}</p>}
      </div>

      {!entries && loading ? (
        <SkeletonCards count={6} height={56} />
      ) : !entries || entries.length === 0 ? (
        <p className="empty-state">
          {filtersActive ? t('admin.noResults') : t(lockedShop ? 'admin.auditShopEmpty' : 'admin.noAudit')}
        </p>
      ) : (
        <>
          <div className={`audit-list${loading ? ' is-loading' : ''}`}>
            {days.map((day) => (
              <section key={day.key} className="audit-day">
                <h3 className="audit-day-label">
                  {day.label} <span className="tabular">· {day.rows.length}</span>
                </h3>
                <ul>
                  {day.rows.map((entry) => (
                    <AuditRow
                      key={entry._id}
                      entry={entry}
                      inShop={Boolean(lockedShop)}
                      open={openId === entry._id}
                      onToggle={() => setOpenId((id) => (id === entry._id ? null : entry._id))}
                      onOnlyShop={(s) => {
                        setPickedShop(s);
                        setOpenId(null);
                      }}
                      onCopy={copy}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {entries.length < total && limit < MAX_ROWS && (
            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button type="button" className="btn btn-secondary btn-small" disabled={loading} onClick={loadMore}>
                {loading ? t('common.loading') : t('admin.loadMore')}
              </button>
            </div>
          )}
          {entries.length < total && limit >= MAX_ROWS && (
            <p className="empty-state">{t('admin.auditCapped', { n: MAX_ROWS })}</p>
          )}
        </>
      )}
    </div>
  );
}
