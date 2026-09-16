'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatRelativeTime } from '../../../lib/format';
import { AUDIT_GROUPS, auditActionName } from '../../../lib/audit';
import { useLanguage } from '../../components/LanguageProvider';
import { SkeletonCards } from '../../components/Skeleton';
import { SearchIcon, StoreIcon, ChevronRightIcon, ListIcon } from '../../components/Icons';
import DateRangeFilter, { rangeToQuery } from '../../components/DateRangeFilter';
import AuditTimeline from '../../components/AuditTimeline';

const DEFAULT_RANGE = { preset: 'all', from: '', to: '' };

// The two categories counted per shop. Sent to the server as prefixes, so the number on a
// shop's row and the rows its chip opens onto come from the same list.
const COUNTED = Object.fromEntries(
  AUDIT_GROUPS.filter((g) => g.key === 'money' || g.key === 'security').map((g) => [g.key, g.prefixes])
);

/**
 * "Kis dukaan mein kya chal raha hai" — one row per shop for the chosen period.
 *
 * The platform timeline stops being readable somewhere past a few dozen shops. This is the
 * view that still works at a thousand: find the shop (or spot the one with a strange number
 * of khata corrections), open it, and read only its log.
 */
function ShopsView({ onPick }) {
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [sort, setSort] = useState('most');

  useEffect(() => {
    const timer = setTimeout(() => {
      const search = new URLSearchParams(rangeToQuery(range));
      if (query.trim()) search.set('q', query.trim());
      search.set('sort', sort);
      search.set('groups', JSON.stringify(COUNTED));
      setLoading(true);
      apiFetch(`/api/admin/audit/shops?${search.toString()}`)
        .then((res) => {
          setError('');
          setRows(res.shops);
          setTotal(res.total ?? res.shops.length);
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, range, sort]);

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="section-title">
          <div className="icon-badge icon-brand"><StoreIcon size={16} /></div>
          <h2>
            {t('admin.auditViewShops')} <span className="audit-count tabular">{total.toLocaleString('en-IN')}</span>
          </h2>
        </div>
        <div className="panel-tools">
          <div className="search-box-inline">
            <SearchIcon size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('admin.auditShopsSearch')} />
          </div>
          <DateRangeFilter value={range} onChange={setRange} compact />
          <div className="segmented segmented-sm">
            <button type="button" className={sort === 'most' ? 'active' : ''} onClick={() => setSort('most')}>
              {t('admin.auditShopsSortMost')}
            </button>
            <button type="button" className={sort === 'latest' ? 'active' : ''} onClick={() => setSort('latest')}>
              {t('admin.auditShopsSortLatest')}
            </button>
          </div>
        </div>
      </div>
      <p className="section-note">{t('admin.auditShopsHint')}</p>
      {error && <div className="error-banner">{error}</div>}

      {!rows && loading ? (
        <SkeletonCards count={6} height={56} />
      ) : !rows || rows.length === 0 ? (
        <p className="empty-state">{query.trim() || range.preset !== 'all' ? t('admin.noResults') : t('admin.auditShopsNone')}</p>
      ) : (
        <>
          <ul className={`audit-shops${loading ? ' is-loading' : ''}`}>
            {rows.map((shop) => (
              <li key={shop.id} className="audit-row">
                <button type="button" className="audit-row-head" onClick={() => onPick({ id: shop.id, name: shop.name })}>
                  <span className="icon-badge icon-muted"><StoreIcon size={15} /></span>
                  <span className="audit-row-main">
                    <span className="audit-row-title">
                      {shop.name}
                      {!shop.active && <span className="badge badge-inactive audit-shop-badge">{t('admin.auditShopInactive')}</span>}
                    </span>
                    <span className="audit-row-sub">
                      <span>
                        {t('admin.auditShopLast', {
                          what: auditActionName(shop.lastAction, t),
                          when: formatRelativeTime(shop.last, lang),
                        })}
                      </span>
                      <span>{shop.people === 1 ? t('admin.auditShopPerson') : t('admin.auditShopPeople', { n: shop.people })}</span>
                    </span>
                  </span>
                  <span className="audit-row-preview audit-shop-counts">
                    {shop.money > 0 && (
                      <span className="audit-count-pill is-gold">
                        {t('admin.auditGroup.money')} <b className="tabular">{shop.money}</b>
                      </span>
                    )}
                    {shop.security > 0 && (
                      <span className="audit-count-pill is-danger">
                        {t('admin.auditGroup.security')} <b className="tabular">{shop.security}</b>
                      </span>
                    )}
                  </span>
                  <span className="audit-row-time audit-shop-total tabular">
                    {t('admin.auditShopEvents', { n: shop.total.toLocaleString('en-IN') })}
                  </span>
                  <ChevronRightIcon size={16} className="audit-row-chevron" />
                </button>
              </li>
            ))}
          </ul>
          {rows.length < total && <p className="empty-state">{t('admin.auditShopsCapped', { shown: rows.length, n: total })}</p>}
        </>
      )}
    </div>
  );
}

export default function AdminAuditPage() {
  const { t } = useLanguage();
  const [view, setView] = useState('timeline');
  const [picked, setPicked] = useState(null);

  return (
    <>
      <div className="content-header">
        <h1>{t('admin.auditTitle')}</h1>
        <p>{t('admin.auditSubtitle')}</p>
      </div>

      <div className="segmented segmented-sm audit-views">
        <button
          type="button"
          className={view === 'timeline' ? 'active' : ''}
          onClick={() => {
            setPicked(null);
            setView('timeline');
          }}
        >
          <ListIcon size={14} /> {t('admin.auditViewTimeline')}
        </button>
        <button type="button" className={view === 'shops' ? 'active' : ''} onClick={() => setView('shops')}>
          <StoreIcon size={14} /> {t('admin.auditViewShops')}
        </button>
      </div>

      {view === 'shops' ? (
        <ShopsView
          onPick={(shop) => {
            setPicked(shop);
            setView('timeline');
          }}
        />
      ) : (
        // Remounted per shop so a pick from "By shop" starts that shop's log with clean filters.
        <AuditTimeline key={picked?.id || 'all'} initialShop={picked} />
      )}
    </>
  );
}
