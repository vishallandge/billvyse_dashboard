'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch, API_URL } from '../../../lib/api';
import { formatRupees } from '../../../lib/format';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { useDashboardUser } from '../../components/DashboardShell';
import { SkeletonCards } from '../../components/Skeleton';
import StorefrontPoster from '../../components/StorefrontPoster';
import { Pagination, usePagination } from '../../components/Pagination';
import Dropdown from '../../components/Dropdown';
import {
  AlertIcon,
  CheckCircleIcon,
  CopyIcon,
  EyeIcon,
  LinkIcon,
  PackageIcon,
  RefreshIcon,
  SearchIcon,
  TagIcon,
  PlusIcon,
  WhatsappIcon,
  FilterClearIcon,
  XIcon,
} from '../../components/Icons';
import CategoryArt, { hueFor } from '../../components/CategoryArt';
import WhatsappSheet from '../../components/WhatsappSheet';

const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';

export default function CatalogPage() {
  const { t, lang } = useLanguage();
  const user = useDashboardUser();
  const [items, setItems] = useState([]);
  const [share, setShare] = useState(null);
  const [shareError, setShareError] = useState('');
  // The open WhatsApp send sheet, or null. See components/WhatsappSheet.js.
  const [waSheet, setWaSheet] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [category, setCategory] = useState('');
  const [copied, setCopied] = useState(false);

  const catalogUrl = share?.catalogUrl || (user?.shopSlug ? `${FRONTEND_URL}/c/${user.shopSlug}/catalog` : '');
  const pdfUrl = user?.shopSlug ? `${API_URL}/api/public/${user.shopSlug}/catalog.pdf` : null;

  const loadCatalog = useCallback(async () => {
    if (!user?.shopSlug) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/public/${user.shopSlug}/catalog`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Could not load catalog');
      setItems(data.items || []);
    } catch (err) {
      setError(err.message || 'Could not load catalog');
    } finally {
      setLoading(false);
    }
  }, [user?.shopSlug]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!user?.shopSlug) return;
    setShareError('');
    apiFetch('/api/seller/catalog/share')
      .then(setShare)
      .catch((err) => setShareError(err.message));
  }, [user?.shopSlug]);

  const categories = useMemo(
    () => [...new Set(items.map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [items]
  );

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      if (stockFilter === 'in' && !item.inStock) return false;
      if (stockFilter === 'out' && item.inStock) return false;
      if (category && item.category !== category) return false;
      if (!needle) return true;
      return [item.name, item.category, item.description]
        .some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [items, search, stockFilter, category]);

  const catalogPage = usePagination(filteredItems, {
    pageSize: 24,
    resetKey: `${search}|${stockFilter}|${category}`,
  });

  const counts = useMemo(() => ({
    live: items.length,
    inStock: items.filter((item) => item.inStock).length,
    outOfStock: items.filter((item) => !item.inStock).length,
    categories: categories.length,
  }), [items, categories.length]);

  async function copyCatalogLink() {
    if (!catalogUrl) return;
    setShareError('');
    try {
      await navigator.clipboard.writeText(catalogUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareError(t('common.copyFailed'));
    }
  }

  const filtersActive = Boolean(search || category || stockFilter !== 'all');

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <h1>{t('seller.catalogTitle')}</h1>
          <p className="page-head-sub">{t('seller.catalogSubtitle')}</p>
        </div>
        <div className="page-head-actions">
          <Link href="/seller/products" className="btn btn-secondary btn-inline">
            <PackageIcon size={17} /> {t('seller.inventoryTitle')}
          </Link>
          {catalogUrl && (
            <a className="btn btn-primary btn-inline" href={catalogUrl} target="_blank" rel="noreferrer">
              <EyeIcon size={17} /> {t('seller.catalogPreview')}
            </a>
          )}
        </div>
      </div>

      {error && (
        <div className="error-banner catalog-admin-error">
          <span>{error}</span>
          <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={loadCatalog}>
            <RefreshIcon size={15} /> {t('common.refresh')}
          </button>
        </div>
      )}

      <section className="catalog-admin-hero">
        <div className="catalog-admin-hero-copy">
          <span className="catalog-admin-live"><span aria-hidden="true" /> {t('common.active')}</span>
          <h2>{t('seller.shareCatalog')}</h2>
          <p>{t('seller.catalogLinkHint')}</p>
        </div>

        <div className="catalog-admin-linkbox">
          <LinkIcon size={18} />
          <input
            readOnly
            value={catalogUrl}
            aria-label={t('seller.catalogLinkHint')}
            onFocus={(event) => event.target.select()}
          />
          <button type="button" className="btn btn-primary btn-inline" disabled={!catalogUrl} onClick={copyCatalogLink}>
            <CopyIcon size={17} /> {copied ? t('admin.linkCopied') : t('admin.copyLink')}
          </button>
        </div>

        {shareError && <p className="catalog-admin-inline-error">{shareError}</p>}

        <div className="catalog-admin-share-actions">
          {share?.whatsappLink && (
            <button
              type="button"
              className="btn btn-primary btn-inline"
              onClick={() =>
                setWaSheet({
                  title: t('wa.shareCatalog'),
                  message: share.message,
                  link: share.whatsappLink,
                  // Nobody to send it to: this link is one the shopkeeper forwards to a
                  // group, a status, whoever he likes, and he picks them inside WhatsApp.
                  // The sheet says so instead of drawing an empty recipient row.
                  auto: false,
                  appLink: share.appLink,
                  appLinkLabel: t('wa.appLinkCatalog'),
                })
              }
            >
              <WhatsappIcon size={17} /> {t('seller.shareWhatsapp')}
            </button>
          )}
          {pdfUrl && (
            <a className="btn btn-secondary btn-inline" href={pdfUrl} target="_blank" rel="noreferrer">
              {t('seller.downloadCatalogPdf')}
            </a>
          )}
        </div>
      </section>

      {waSheet && <WhatsappSheet {...waSheet} onClose={() => setWaSheet(null)} />}

      {loading ? (
        <SkeletonCards count={4} height={92} />
      ) : (
        <div className="catalog-admin-stats">
          <CatalogStat icon={<PackageIcon size={18} />} value={counts.live} label={t('seller.products')} />
          <CatalogStat icon={<CheckCircleIcon size={18} />} value={counts.inStock} label={t('seller.catalogInStock')} tone="success" />
          <CatalogStat icon={<AlertIcon size={18} />} value={counts.outOfStock} label={t('seller.catalogOutOfStock')} tone={counts.outOfStock ? 'warning' : ''} />
          <CatalogStat icon={<TagIcon size={18} />} value={counts.categories} label={t('seller.category')} />
        </div>
      )}

      {catalogUrl && (
        <section className="panel catalog-admin-poster">
          <div className="catalog-admin-section-head">
            <div>
              <h2>{t('seller.qrPosterTitle')}</h2>
              <p>{t('seller.qrPosterHint')}</p>
            </div>
          </div>
          <StorefrontPoster url={catalogUrl} shopName={user?.shopName || user?.name} />
        </section>
      )}

      <section className="data-panel catalog-admin-preview">
        <div className="data-panel-head">
          <h2 className="data-panel-title">
            {t('seller.catalogPreview')} <span className="count-pill">{filteredItems.length}</span>
          </h2>
          <button type="button" className="btn btn-secondary btn-small btn-inline" disabled={loading} onClick={loadCatalog}>
            <RefreshIcon size={15} /> {t('common.refresh')}
          </button>
        </div>

        <div className="data-filters">
          <div className="search-box">
            <SearchIcon size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('seller.searchProducts')} />
          </div>

          <div className="filter-group">
            {categories.length > 0 && (
              <Dropdown
                className={category ? 'select-control filtered' : 'select-control'}
                value={category}
                onChange={setCategory}
                options={[
                  { value: '', label: t('seller.allCategories') },
                  ...categories.map((name) => ({ value: name, label: name })),
                ]}
              />
            )}
            <div className="segmented-mini" role="group" aria-label={t('seller.stockFilter')}>
              <button type="button" className={stockFilter === 'all' ? 'active' : ''} onClick={() => setStockFilter('all')}>
                {t('seller.all')}
              </button>
              <button type="button" className={stockFilter === 'in' ? 'active' : ''} onClick={() => setStockFilter('in')}>
                {t('seller.catalogInStock')}
              </button>
              <button type="button" className={stockFilter === 'out' ? 'active' : ''} onClick={() => setStockFilter('out')}>
                {t('seller.outOfStock')}
              </button>
            </div>
          </div>

          {filtersActive && (
            <button
              type="button"
              className="filter-clear"
              onClick={() => {
                setSearch('');
                setCategory('');
                setStockFilter('all');
              }}
            >
              <XIcon size={13} />
              {t('table.clearFilters')}
            </button>
          )}
        </div>

        {loading ? (
          <div className="data-panel-body"><SkeletonCards count={8} height={210} /></div>
        ) : items.length === 0 ? (
          <div className="empty-state-rich catalog-admin-empty">
            <Illustration scene="shelf" />
            <p>{t('seller.catalogEmpty')}</p>
            <Link href="/seller/products?new=1" className="btn btn-primary btn-small btn-inline">
              <PlusIcon size={15} />
              {t('seller.addYourFirstProduct')}
            </Link>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="empty-state-rich catalog-admin-empty">
            <Illustration scene="search" />
            <p>{t('seller.noMatchingProducts')}</p>
            <button
              type="button"
              className="btn btn-secondary btn-small btn-inline"
              onClick={() => {
                setSearch('');
                setCategory('');
                setStockFilter('all');
              }}
            >
              <FilterClearIcon size={15} /> {t('table.clearFilters')}
            </button>
          </div>
        ) : (
          <>
            <div className="catalog-admin-grid">
              {catalogPage.pageItems.map((item) => (
                <Link className="catalog-admin-product" href={`/seller/products?edit=${item.id}`} key={item.id}>
                  <div className="catalog-admin-thumb" style={{ '--tile-h': hueFor(item.category || item.name) }}>
                    {item.photoUrl ? (
                      <img src={item.photoUrl} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <CategoryArt name={item.name} category={item.category} />
                    )}
                    <span className={`catalog-admin-stock-dot ${item.inStock ? 'in' : 'out'}`} aria-hidden="true" />
                  </div>
                  <div className="catalog-admin-product-copy">
                    {item.category && <span>{item.category}</span>}
                    <strong>{item.name}</strong>
                    <div>
                      <b>{formatRupees(item.price, lang)}</b>
                      <small className={item.inStock ? 'in' : 'out'}>
                        {item.inStock ? t('seller.catalogInStock') : t('seller.catalogOutOfStock')}
                      </small>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
            <Pagination
              compact
              page={catalogPage.page}
              pageCount={catalogPage.pageCount}
              pageSize={catalogPage.pageSize}
              total={catalogPage.total}
              from={catalogPage.from}
              to={catalogPage.to}
              onPageChange={catalogPage.setPage}
              onPageSizeChange={catalogPage.setPageSize}
              label={t('seller.products')}
            />
          </>
        )}
      </section>
    </>
  );
}

function CatalogStat({ icon, value, label, tone = '' }) {
  return (
    <div className={`catalog-admin-stat ${tone}`}>
      <span className="catalog-admin-stat-icon">{icon}</span>
      <div><strong>{Number(value || 0).toLocaleString('en-IN')}</strong><span>{label}</span></div>
    </div>
  );
}
