'use client';

import Dropdown from '../../components/Dropdown';
import { AlertIcon, CheckIcon, UsersIcon } from '../../components/Icons';
import { formatRupees } from '../../../lib/format';

/**
 * "Kitna diya, kitna baaki" for a khata bill settled at a table.
 *
 * The billing counter has always asked this; a table did not, so a family that paid ₹500 of
 * a ₹1,200 dinner had the whole ₹1,200 written to their khata and the ₹500 in the drawer
 * belonged to nobody. Same card, same words and same arithmetic as the counter's (see the
 * `paid-now` block in app/seller/billing/page.js) — the server books it through the same
 * `paidNow` / `paidNowMode` pair, capped at the bill, and refuses a bill that would take the
 * customer past their credit limit.
 *
 * One box (see the shared-component rule): the caller decides when it shows.
 */

function round2(value) {
  return Number((Number(value) || 0).toFixed(2));
}

// The amounts an udhaar customer actually names, beside "kuch nahi" and "aadha": the round
// notes just under the bill. Same rule as the counter's partPaySuggestions.
function partPaySuggestions(amount) {
  if (!(amount > 1)) return [];
  const values = new Set();
  for (const note of [50, 100, 200, 500, 1000, 2000]) {
    if (note < amount) values.add(note);
  }
  for (const step of [100, 500, 1000]) {
    const down = Math.floor(amount / step) * step;
    if (down > 0 && down < amount) values.add(down);
  }
  return [...values]
    .sort((a, b) => b - a)
    .slice(0, 3)
    .sort((a, b) => a - b);
}

/** What the card means in rupees — shared with the settle checks so both read one rule. */
export function khataSplit({ payable, paidNow, customer }) {
  const typed = String(paidNow ?? '').trim();
  const amount = Number(typed);
  const valid = typed === '' || (Number.isFinite(amount) && amount >= 0);
  const paid = valid && typed !== '' ? round2(amount) : 0;
  const got = Math.min(paid, payable);
  const onKhata = Math.max(0, round2(payable - paid));
  const change = Math.max(0, round2(paid - payable));
  const owes = round2(Number(customer?.balance) || 0);
  const limit = Number(customer?.creditLimit) || 0;
  const overLimitBy = limit > 0 && onKhata > 0 ? round2(owes + onKhata - limit) : 0;
  return { valid, paid, got: round2(got), onKhata, change, owes, limit, overLimitBy: overLimitBy > 0 ? overLimitBy : 0 };
}

export default function KhataPaidNow({ id, payable, value, mode, onChange, onModeChange, customer, t, lang }) {
  const money = khataSplit({ payable, paidNow: value, customer });
  const half = payable > 1 ? round2(Math.round(payable / 2)) : 0;
  const notes = partPaySuggestions(payable).filter((amount) => amount !== half);
  const typed = Number(value);
  const isExact = String(value).trim() !== '' && round2(typed) === round2(payable);

  return (
    <div className="paid-now">
      <div className="paid-now__head">
        <div className="paid-now__ask">
          <label htmlFor={id}>{t('seller.paidNowLabel')}</label>
          {customer && (
            <span
              className="paid-now__who"
              data-tip={
                money.owes > 0
                  ? t('seller.customerOwes', { name: customer.name, amount: money.owes.toFixed(2) })
                  : t('seller.customerClear', { name: customer.name })
              }
            >
              <UsersIcon size={12} />
              <b>{customer.name}</b>
              {money.owes > 0 && <em>₹{money.owes.toFixed(0)}</em>}
            </span>
          )}
        </div>
        {payable > 0 && (
          <button
            type="button"
            className={`filter-pill${isExact ? ' active' : ''}`}
            aria-pressed={isExact}
            onClick={() => onChange(isExact ? '' : String(payable))}
          >
            {isExact && <CheckIcon size={12} />} {t('seller.cashExact')}
          </button>
        )}
      </div>

      <div className="paid-now__row">
        <div className="paid-now__amount">
          <span className="paid-now__cur" aria-hidden="true">₹</span>
          <input
            id={id}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={value}
            aria-invalid={!money.valid || undefined}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0"
          />
        </div>
        <Dropdown
          className="paid-now-mode"
          value={mode}
          onChange={onModeChange}
          options={['upi', 'cash', 'card', 'bank'].map((m) => ({ value: m, label: t(`expenses.mode.${m}`) }))}
        />
      </div>

      {payable > 0 && (
        <div className="paid-now__notes">
          <button type="button" className={`filter-pill${!(typed > 0) ? ' active' : ''}`} onClick={() => onChange('')}>
            {t('seller.paidNowNothing')}
          </button>
          {half > 0 && (
            <button type="button" className={`filter-pill${typed === half ? ' active' : ''}`} onClick={() => onChange(String(half))}>
              {t('seller.paidNowHalf')} · ₹{half}
            </button>
          )}
          {notes.map((amount) => (
            <button
              type="button"
              key={amount}
              className={`filter-pill${typed === amount ? ' active' : ''}`}
              onClick={() => onChange(String(amount))}
            >
              ₹{amount}
            </button>
          ))}
        </div>
      )}

      <div className={`paid-now__sum${money.onKhata <= 0 ? ' clear' : ''}`}>
        <div className="paid-now__sum-row">
          <span>{t('seller.paidNowGot')}</span>
          <strong>{formatRupees(money.got, lang)}</strong>
        </div>
        <div className="paid-now__sum-row on-khata">
          <span>{t('seller.paidNowOnKhata')}</span>
          <strong>{formatRupees(money.onKhata, lang)}</strong>
        </div>
      </div>

      {money.change > 0 && (
        <div className="cash-change">
          <span>{t('seller.changeDue')}</span>
          <strong>{formatRupees(money.change, lang)}</strong>
        </div>
      )}

      {money.overLimitBy > 0 && (
        <div className="customer-credit__row warn">
          <AlertIcon size={14} />
          <span>{t('seller.overLimitWarn', { amount: money.overLimitBy.toFixed(2), limit: money.limit.toFixed(2) })}</span>
        </div>
      )}
    </div>
  );
}
