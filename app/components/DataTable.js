'use client';

import { useMemo, useState } from 'react';
import { sortRows } from '../../lib/sortRows';
import { SortIcon, SortAscIcon, SortDescIcon } from './Icons';

// Column sorting shared by every list page. Pages describe *how* to read a value out of a
// row (an accessor) and this handles the click-to-toggle, the direction state and the
// header affordance — so sorting looks and behaves identically on inventory, khata,
// orders and anywhere else it gets added later.

export function useSort(items, accessors, initial = { key: null, dir: 'asc' }) {
  const [sort, setSort] = useState(initial);

  const sorted = useMemo(() => {
    const accessor = sort.key && accessors[sort.key];
    return sortRows(items, accessor, sort.dir);
  }, [items, sort, accessors]);

  function toggle(key) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    );
  }

  return { sorted, sort, toggle };
}

export function SortHeader({ sortKey, label, sort, onSort, align = 'left', width }) {
  const active = sort.key === sortKey;
  const Caret = !active ? SortIcon : sort.dir === 'asc' ? SortAscIcon : SortDescIcon;
  return (
    <th
      className={align === 'right' ? 'num' : undefined}
      style={width ? { width } : undefined}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className={`th-sort${active ? ' active' : ''}`}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <Caret size={13} />
      </button>
    </th>
  );
}
