'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { UsersIcon, AlertIcon } from './Icons';
import Modal from './Modal';

// Two khata records, one phone number, one actual person — so their udhaar sits split and
// the shopkeeper chases whichever half they happen to open. The banner leads with the
// money that is split rather than a count of duplicates, because "3 duplicates" is a
// tidiness problem and "₹8,400 you are only asking half of" is the real one.
//
// Joining is never automatic: only the shopkeeper can look at two names and know it is
// the same Ramesh, and the merge deletes a record, so it stays their decision.

export default function DuplicateCustomers({ groups, totalSplitBalance, onMerged }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  if (!groups?.length) return null;

  return (
    <>
      <div className="dup-banner">
        <div className="dup-banner-icon">
          <UsersIcon size={18} />
        </div>
        <div className="dup-banner-text">
          <strong>{t('seller.dupTitle')}</strong>
          <p>
            {t('seller.dupImpact', {
              amount: Number(totalSplitBalance || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }),
              groups: groups.length,
            })}
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-small btn-inline" onClick={() => setOpen(true)}>
          {t('seller.dupReview')}
        </button>
      </div>

      {open && <MergeModal groups={groups} onClose={() => setOpen(false)} onMerged={onMerged} />}
    </>
  );
}

function MergeModal({ groups, onClose, onMerged }) {
  const { t } = useLanguage();
  const [error, setError] = useState('');
  const [merging, setMerging] = useState('');
  // Which record each group is folding into. Defaults to the oldest — it is the one the
  // shop has been using longest, so it usually carries the real history.
  const [keepBy, setKeepBy] = useState(() =>
    Object.fromEntries(groups.map((group) => [group.phoneKey, group.customers[0]?.id]))
  );

  async function handleMerge(group) {
    const keepId = keepBy[group.phoneKey];
    if (!keepId) return;

    setError('');
    setMerging(group.phoneKey);
    try {
      await apiFetch('/api/seller/khata/customers/merge', {
        method: 'POST',
        body: JSON.stringify({
          keepId,
          mergeIds: group.customers.map((c) => c.id).filter((id) => id !== keepId),
        }),
      });
      await onMerged();
    } catch (err) {
      setError(err.message);
    } finally {
      setMerging('');
    }
  }

  return (
    <Modal onClose={onClose} title={t('seller.dupModalTitle')} maxWidth={640}>

        <p className="dup-modal-sub">{t('seller.dupModalSubtitle')}</p>
        {error && <div className="error-banner">{error}</div>}

        {groups.length === 0 ? (
          <div className="empty-state-rich">
            <p>{t('seller.dupNoneLeft')}</p>
          </div>
        ) : (
          groups.map((group) => (
            <div className="dup-group" key={group.phoneKey}>
              <div className="dup-group-head">
                <strong>{group.phoneDisplay}</strong>
                <span className="dup-group-split">
                  {t('seller.dupSplitAcross', {
                    amount: Number(group.splitBalance || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }),
                    count: group.count,
                  })}
                </span>
              </div>

              {group.customers.map((customer) => (
                <label
                  className={`dup-option${keepBy[group.phoneKey] === customer.id ? ' selected' : ''}`}
                  key={customer.id}
                >
                  <input
                    type="radio"
                    name={`keep-${group.phoneKey}`}
                    checked={keepBy[group.phoneKey] === customer.id}
                    onChange={() => setKeepBy((prev) => ({ ...prev, [group.phoneKey]: customer.id }))}
                  />
                  <span className="dup-option-main">
                    <span className="dup-option-name">{customer.name}</span>
                    <span className="dup-option-meta">
                      {t('seller.dupCreatedOn', { date: new Date(customer.createdAt).toLocaleDateString('en-IN') })}
                      {' · '}
                      {customer.phone}
                    </span>
                  </span>
                  <span className={`balance-pill ${customer.balance > 0 ? 'owed' : 'clear'}`}>₹{customer.balance}</span>
                </label>
              ))}

              <div className="dup-group-actions">
                <span className="dup-warn">
                  <AlertIcon size={13} />
                  {t('seller.dupCannotUndo')}
                </span>
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  style={{ width: 'auto' }}
                  disabled={merging === group.phoneKey}
                  onClick={() => handleMerge(group)}
                >
                  {merging === group.phoneKey ? t('seller.dupMerging') : t('seller.dupMergeAction')}
                </button>
              </div>
            </div>
          ))
        )}
    </Modal>
  );
}
