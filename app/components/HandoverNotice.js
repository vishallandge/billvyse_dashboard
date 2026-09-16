'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { formatRupees, formatDate } from '../../lib/format';
import { useLanguage } from './LanguageProvider';
import { AlertIcon, XIcon } from './Icons';

/**
 * "Ye udhaar purane malik ke samay ka hai."
 *
 * The sharpest edge in the whole app, said out loud once. `Customer.balance` is what a customer
 * OWES. When an account changes hands — the owner said so himself, by answering "the shop was
 * sold" or "this account is now a different shop" when he changed the business type — the new
 * owner logs in to a khata screen full of names and amounts, and every one of those debts was
 * owed to somebody else. Ramesh may well have settled his with the previous owner months ago.
 * Left unsaid, this screen quietly organises a wrongful collection, and the shopkeeper doing it
 * would have no way of knowing.
 *
 * What this deliberately does NOT do is fix it for him. A shop's debtors book is very often part
 * of what is sold, so writing those balances off would destroy money the new owner genuinely paid
 * for. The app cannot know which happened and has no business guessing, so it says exactly what
 * it knows — this much predates the handover, here are the biggest — and leaves the decision with
 * the person who was actually in the room.
 *
 * Dismissible, and that is the point rather than a concession: for a shop that did buy the book,
 * the question is answered the first time it is read, and a warning that cannot be answered is a
 * warning that teaches people to ignore warnings.
 *
 * Renders nothing at all for the other 99% of shops — a shop that fixed a mis-picked type at
 * signup has no handover date and never sees this. Fails silent: if the call errors, a khata
 * screen missing one notice is a far smaller problem than a khata screen that will not load.
 */
export default function HandoverNotice() {
  const { t, lang } = useLanguage();
  const [handover, setHandover] = useState(null);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    apiFetch('/api/seller/khata/handover')
      .then((data) => setHandover(data?.handover || null))
      .catch(() => {});
  }, []);

  const dismiss = useCallback(() => {
    setDismissing(true);
    // Hidden immediately. The server is only being told to stop sending it, and a notice that
    // lingers for a round trip after "samajh gaya" reads as not having worked.
    setHandover(null);
    apiFetch('/api/seller/khata/handover/dismiss', { method: 'POST' }).catch(() => {});
  }, []);

  if (!handover) return null;

  return (
    <div className="handover-notice">
      <span className="handover-notice__mark" aria-hidden="true">
        <AlertIcon size={18} />
      </span>

      <div className="handover-notice__body">
        <strong>
          {t(handover.kind === 'different_shop' ? 'seller.handoverTitleOther' : 'seller.handoverTitleSold', {
            date: formatDate(handover.at, lang),
          })}
        </strong>
        <p>
          {t('seller.handoverBody', {
            amount: formatRupees(handover.amount, lang),
            count: handover.count,
          })}
        </p>

        {/* The biggest few by name. A total is something to worry about; the names are what
            make it checkable against what was actually agreed at the handover. */}
        {handover.top.length > 0 && (
          <ul className="handover-notice__rows">
            {handover.top.slice(0, 4).map((row) => (
              <li key={row.id}>
                <span>{row.name}</span>
                <strong>{formatRupees(row.balance, lang)}</strong>
              </li>
            ))}
            {handover.count > 4 && <li className="more">{t('seller.handoverMore', { count: handover.count - 4 })}</li>}
          </ul>
        )}

        <small>{t('seller.handoverHint')}</small>
      </div>

      <button
        type="button"
        className="handover-notice__close"
        onClick={dismiss}
        disabled={dismissing}
        aria-label={t('seller.handoverDismiss')}
        data-tip={t('seller.handoverDismiss')}
      >
        <XIcon size={15} />
      </button>
    </div>
  );
}
