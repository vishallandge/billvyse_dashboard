'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { useConfirm } from './ConfirmDialog';
import { ChevronDownIcon, CheckIcon, SettingsIcon, CreditCardIcon, SearchIcon, LogOutIcon, HeadsetIcon } from './Icons';

/**
 * Who you are, which shop, and — the part that actually matters — WHICH STORE you
 * are billing into.
 *
 * Until now the answer to all three lived at the bottom of a scrolling sidebar: the
 * name as a bare <p>, the store as a raw <select>, logout as a button under both. On
 * a multi-store shop that meant the active store was off screen for most of the day,
 * while every bill, every stock movement and every khata entry was being written
 * against it. That is not a cosmetic problem — it is the shopkeeper having no way to
 * check, at the counter, that today's sales are landing in the right godown.
 *
 * So identity moves to the one place it is always visible, and the store comes with
 * it. The sidebar footer keeps only language, which is the one preference that is not
 * about identity.
 *
 * Store switching goes through the shell's own handler, which does a full reload —
 * every seller page fetches in a mount effect, so a soft swap would leave a cashier
 * billing against the previous store's stock numbers still sitting in memory.
 *
 * WHERE THIS RENDERS. The shell mounts it twice: once in the desktop topbar and once
 * in the phone's app bar, each hidden at the other's width. It is not shared state
 * between them — one is always display:none, so only one has a menu to open. See the
 * note at its call site in DashboardShell for why a single instance cannot work.
 */

// Above this many stores the list stops being something you can point at and starts
// being something you have to read, so it gets a filter box. Six is the number that
// still fits the menu without scrolling on the shortest phone we support.
const FILTER_THRESHOLD = 6;

function initials(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export default function AccountMenu({ user, stores, activeStore, onStoreChange, onLogout, onSupport, className = '' }) {
  const { t } = useLanguage();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const wrapRef = useRef(null);
  const filterRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // A half-typed filter left behind from last time is a list that looks like it lost
  // stores. Clear it on every close rather than on open, so reopening is never a
  // frame of stale results.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setError('');
    }
  }, [open]);

  /**
   * Picking a store off this list.
   *
   * A closed store still appears here — it is the only place the shopkeeper can get
   * back into one, and hiding it would mean a store he switched off is simply gone
   * with no way back except the Stores screen. But switching INTO a closed store
   * cannot be silent: the moment he does, every bill, stock movement and khata entry
   * starts being written against it. So it asks first, and reopening is what the
   * confirm actually buys — not just the switch.
   */
  async function pickStore(store) {
    // Re-picking the store you are already in would reload the page for nothing, in
    // the middle of whatever the shopkeeper was doing.
    if (store._id === activeStore?._id) {
      setOpen(false);
      return;
    }

    if (store.isActive === false) {
      const ok = await confirm({
        tone: 'warning',
        title: t('seller.reopenStoreTitle'),
        body: t('seller.reopenStoreBody', { store: store.name }),
        confirmLabel: t('seller.reopenStoreConfirm'),
      });
      if (!ok) return;
      setBusyId(store._id);
      setError('');
      try {
        await apiFetch(`/api/seller/stores/${store._id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: true }),
        });
      } catch (err) {
        // Stay open and say so. Reloading into a store the server refused to reopen
        // would land him in it with the switch looking like it worked.
        setBusyId(null);
        setError(err.message);
        return;
      }
    }

    onStoreChange(store._id);
  }

  const isSuperadmin = user?.role === 'superadmin';
  const isStaff = user?.role === 'staff';
  const multiStore = !isSuperadmin && (stores?.length || 0) > 1;
  const showFilter = multiStore && stores.length > FILTER_THRESHOLD;

  const shown = useMemo(() => {
    if (!multiStore) return [];
    const q = query.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter((s) => (s.name || '').toLowerCase().includes(q));
  }, [multiStore, stores, query]);

  // Autofocus only where a keyboard is the likely input. On a handset this would
  // throw up the on-screen keyboard over the very list it is meant to filter.
  useEffect(() => {
    if (!open || !showFilter) return;
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) return;
    filterRef.current?.focus();
  }, [open, showFilter]);

  if (!user) return null;

  // The shop's name is the thing a shopkeeper identifies with; the admin console has
  // no shop, so it falls back to the person.
  const title = isSuperadmin ? user.name : user.shopName || user.name;
  const roleLabel = isSuperadmin ? 'Platform Admin' : isStaff ? user.jobTitle || t('seller.staffRole') : t('seller.ownerRole');

  return (
    <div className={`account-wrap${className ? ` ${className}` : ''}`} ref={wrapRef}>
      <button
        type="button"
        className={`account-chip${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={title}
      >
        <span className="avatar-initials account-avatar">{initials(title)}</span>
        {/* Hidden below 640px in CSS — on a handset the avatar alone is the chip, and
            the names are all repeated inside the menu anyway. */}
        <span className="account-chip-text">
          <span className="account-chip-name">{title}</span>
          {/* The second line is the store, and ONLY when there is more than one to be
              in. A single-store shop reading "Main Store" under its own name every
              day learns to stop reading the line, which is exactly the line that has
              to be readable on the day a second store exists. */}
          {multiStore && activeStore?.name && (
            <span className="account-chip-store">
              {activeStore.name}
              {activeStore.isActive === false && <em> · {t('seller.storeInactive')}</em>}
            </span>
          )}
        </span>
        <ChevronDownIcon size={14} className={`account-caret${open ? ' open' : ''}`} />
      </button>

      {open && (
        <div className="account-menu" role="menu">
          <div className="account-menu-head">
            <span className="avatar-initials account-avatar-lg">{initials(title)}</span>
            <div className="account-menu-id">
              <strong>{title}</strong>
              <span>{user.name}</span>
            </div>
            <span className="account-role-pill">{roleLabel}</span>
          </div>

          {multiStore && (
            <div className="account-menu-section">
              <div className="account-menu-label">
                <span>{t('seller.switchStore')}</span>
                {/* The count is the whole warning that this list scrolls. Without it a
                    shop with eleven stores sees six and no reason to look further. */}
                <span className="account-menu-count">{stores.length}</span>
              </div>

              {showFilter && (
                <div className="account-store-filter">
                  <SearchIcon size={14} />
                  <input
                    ref={filterRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('seller.searchStores')}
                    aria-label={t('seller.searchStores')}
                  />
                </div>
              )}

              {/* Capped and scrolled rather than allowed to grow. A shop that opens its
                  seventh outlet must not be the day the menu runs off the bottom of the
                  screen and takes Log out with it. */}
              <div className="account-store-list">
                {shown.map((store) => {
                  const selected = store._id === activeStore?._id;
                  const closed = store.isActive === false;
                  return (
                    <button
                      key={store._id}
                      type="button"
                      role="menuitem"
                      className={`account-menu-item store${selected ? ' selected' : ''}${closed ? ' closed' : ''}`}
                      disabled={busyId === store._id}
                      onClick={() => pickStore(store)}
                    >
                      <span className="account-store-mark" aria-hidden="true">{initials(store.name)}</span>
                      <span>{store.name}</span>
                      {/* Said on the row, not just implied by a dimmed monogram. A shop
                          with four closed outlets reads as four normal rows otherwise,
                          and the first he learns of it is a bill going somewhere he did
                          not expect. */}
                      {closed && <em className="account-store-off">{t('seller.storeInactive')}</em>}
                      {selected && <CheckIcon size={15} className="account-menu-tick" />}
                    </button>
                  );
                })}
                {shown.length === 0 && <p className="account-store-empty">{t('seller.noStoreMatch')}</p>}
              </div>
              {error && <p className="account-store-error">{error}</p>}
            </div>
          )}

          {/* Staff reach neither screen — Settings is the shop's profile and Plan is
              its billing — so they are not offered a link that would 403. */}
          {!isSuperadmin && !isStaff && (
            <div className="account-menu-section">
              <Link href="/seller/settings" role="menuitem" className="account-menu-item" onClick={() => setOpen(false)}>
                <SettingsIcon size={17} />
                <span>{t('nav.settings')}</span>
              </Link>
              <Link href="/seller/plan" role="menuitem" className="account-menu-item" onClick={() => setOpen(false)}>
                <CreditCardIcon size={17} />
                <span>{t('nav.plan')}</span>
              </Link>
            </div>
          )}

          {/* The second way in, for the shopkeeper who goes looking for help under his own
              name rather than at the lifebuoy in the topbar. Same sheet, and above Log out
              because "I cannot make this work" must never sit below the button that ends
              the session. Staff see it too — they are at the counter when it breaks. */}
          {onSupport && !isSuperadmin && (
            <div className="account-menu-section">
              <button
                type="button"
                role="menuitem"
                className="account-menu-item"
                onClick={() => { setOpen(false); onSupport(''); }}
              >
                <HeadsetIcon size={17} />
                <span>{t('support.navLabel')}</span>
              </button>
            </div>
          )}

          <div className="account-menu-section">
            <button type="button" role="menuitem" className="account-menu-item danger" onClick={onLogout}>
              <LogOutIcon size={17} />
              <span>{t('common.logout')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
