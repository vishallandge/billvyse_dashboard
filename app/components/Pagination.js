'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from './LanguageProvider';
import { ChevronLeftIcon, ChevronRightIcon } from './Icons';
import Dropdown from './Dropdown';

// Shared paging for every long list in the dashboard. A shop with 400 products was
// rendering 400 <tr>s in one scroll — the page was ~19,000px tall, the browser stuttered
// and nothing could be found. Every list page should slice through this hook instead of
// mapping the full array.

export const PAGE_SIZES = [10, 25, 50, 100];

export function usePagination(items, { pageSize: initialPageSize = 25, resetKey = '' } = {}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // A filter or search change makes the old page number meaningless — someone on page 7
  // who types a search would otherwise land on a blank page and think the app broke.
  useEffect(() => {
    setPage(1);
  }, [resetKey, pageSize]);

  // Deleting the last row of the last page should pull the seller back, not strand them.
  const safePage = Math.min(page, pageCount);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const start = (safePage - 1) * pageSize;
  const pageItems = useMemo(
    () => items.slice(start, start + pageSize),
    [items, start, pageSize]
  );

  return {
    page: safePage,
    pageSize,
    pageCount,
    total,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, total),
    pageItems,
    setPage,
    setPageSize,
  };
}

// t() only substitutes strings; the count line wants the numbers bolded, so this splits a
// translated template on its {placeholders} and swaps in React nodes. Keeping word order
// inside the translation matters — Hindi and Marathi put the total before the range.
function interpolateNodes(template, vars) {
  return String(template)
    .split(/(\{\w+\})/g)
    .filter((part) => part !== '')
    .map((part, index) => {
      const match = /^\{(\w+)\}$/.exec(part);
      if (!match) return part;
      const value = vars[match[1]];
      return value && value.node ? <b key={index}>{value.node}</b> : String(value ?? part);
    });
}

// Builds the visible page buttons: always the first and last page, a window around the
// current one, and '…' for the gaps. Keeps the control a fixed width whether the list has
// 3 pages or 300.
function pageWindow(page, pageCount) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const pages = new Set([1, pageCount, page, page - 1, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((p) => pages.add(p));

  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) out.push(`gap-${p}`);
    out.push(p);
    previous = p;
  }
  return out;
}

export function Pagination({
  page,
  pageCount,
  pageSize,
  total,
  from,
  to,
  onPageChange,
  onPageSizeChange,
  label,
  compact = false,
}) {
  const { t } = useLanguage();
  // A single page of results doesn't need controls, but the count line is still useful.
  const windowed = pageWindow(page, pageCount);

  return (
    <div className={`pagination${compact ? ' compact' : ''}`}>
      <div className="pagination-info">
        {total === 0
          ? t('pagination.none', { label: label || t('pagination.rows') })
          : interpolateNodes(t('pagination.showing'), {
              from: { node: from },
              to: { node: to },
              total: { node: total.toLocaleString('en-IN') },
              label: label || t('pagination.rows'),
            })}
      </div>

      <div className="pagination-controls">
        {onPageSizeChange && (
          <div className="page-size">
            <span>{t('pagination.perPage')}</span>
            <Dropdown
              className="page-size-select"
              value={pageSize}
              onChange={(v) => onPageSizeChange(Number(v))}
              options={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
            />
          </div>
        )}

        {pageCount > 1 && (
          <div className="page-btns">
            <button
              type="button"
              className="page-btn"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              aria-label={t('pagination.previous')}
            >
              <ChevronLeftIcon size={17} />
            </button>

            {windowed.map((entry) =>
              typeof entry === 'number' ? (
                <button
                  key={entry}
                  type="button"
                  className={`page-btn${entry === page ? ' active' : ''}`}
                  onClick={() => onPageChange(entry)}
                  aria-current={entry === page ? 'page' : undefined}
                >
                  {entry}
                </button>
              ) : (
                <span key={entry} className="page-gap">…</span>
              )
            )}

            <button
              type="button"
              className="page-btn"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= pageCount}
              aria-label={t('pagination.next')}
            >
              <ChevronRightIcon size={17} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
