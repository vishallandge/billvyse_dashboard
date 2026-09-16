'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../lib/api';
import { useLanguage } from '../../../components/LanguageProvider';
import Illustration from '../../../components/Illustration';
import { SkeletonTable } from '../../../components/Skeleton';
import { Pagination, PAGE_SIZES } from '../../../components/Pagination';
import { SearchIcon } from '../../../components/Icons';

export default function CentralInventoryPage() {
  const { t } = useLanguage();
  const [stores, setStores] = useState([]);
  const [items, setItems] = useState([]);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[1]);
  const [total, setTotal] = useState(0);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  // Server-paginated and server-searched: a shop with hundreds of SKUs across several
  // stores used to get every product x every store's quantity in one payload just to show
  // 25 rows — this is the one list page in the app that fetches its own slice instead of
  // paginating a full array already in memory (see utils/storeStock.js / listMyProducts
  // for why most others don't bother: this one is uniquely wide, a column per store).
  useEffect(() => {
    setLoading(!hasLoadedOnce);
    const query = new URLSearchParams({ limit: String(pageSize), page: String(pageNum) });
    if (search.trim()) query.set('search', search.trim());
    apiFetch(`/api/seller/stores/inventory/central?${query.toString()}`)
      .then(({ stores: s, items: i, total: t2 }) => {
        setStores(s);
        setItems(i);
        setTotal(t2 || 0);
      })
      .catch((err) => setError(err.message))
      .finally(() => {
        setLoading(false);
        setHasLoadedOnce(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNum, pageSize, search]);

  // A search change makes the old page number meaningless — someone on page 4 who types a
  // search would otherwise land on a blank page and think it broke.
  useEffect(() => {
    setPageNum(1);
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft), 350);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (pageNum - 1) * pageSize + 1;
  const to = Math.min(pageNum * pageSize, total);

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <h1>{t('seller.centralInventoryTitle')}</h1>
          <p className="page-head-sub">{t('seller.centralInventorySubtitle')}</p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="data-panel">
        <div className="data-filters">
          <div className="search-box">
            <SearchIcon size={16} />
            <input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder={t('seller.searchProducts')} />
          </div>
        </div>

        {loading ? (
          <div className="data-panel-body"><SkeletonTable rows={6} cols={4} /></div>
        ) : total === 0 && !search.trim() ? (
          <p className="empty-state" style={{ padding: '1rem 1.15rem' }}>{t('seller.noProducts')}</p>
        ) : items.length === 0 ? (
          <div className="empty-state-rich">
            <Illustration scene="search" />
            <p>{t('table.noResults')}</p>
            <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => setSearchDraft('')}>
              {t('table.clearFilters')}
            </button>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              {/* One column per store, so the min-width has to grow with the shop count —
                  a fixed value would either squash a 6-store chain or over-scroll a 2-store one. */}
              <table className="data-table" style={{ minWidth: `${320 + stores.length * 120}px` }}>
                <thead>
                  <tr>
                    <th>{t('seller.productName')}</th>
                    {stores.map((store) => (
                      <th key={store._id} className="num">{store.name}</th>
                    ))}
                    <th className="num">{t('seller.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.product.id}>
                      <td className="cell-strong">{item.product.name}</td>
                      {stores.map((store) => {
                        const cell = item.byStore.find((s) => s.storeId === store._id);
                        return (
                          <td key={store._id} className="num">
                            {cell ? (
                              <span className={cell.isLow ? 'badge badge-pending' : undefined}>
                                {cell.quantity} {item.product.unit}
                              </span>
                            ) : (
                              <span className="cell-sub">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="num cell-strong">
                        {item.totalStock} {item.product.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={pageNum}
              pageCount={pageCount}
              pageSize={pageSize}
              total={total}
              from={from}
              to={to}
              onPageChange={setPageNum}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPageNum(1);
              }}
              label={t('seller.products')}
            />
          </>
        )}
      </div>
    </>
  );
}
