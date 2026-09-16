import { apiFetch } from './api';

/**
 * The one way a khata entry gets recorded, from any screen.
 *
 * Two of the server's refusals are not refusals at all — they are questions. Booking credit
 * past a customer's limit and taking more money than he owes are both things a shopkeeper
 * does on purpose several times a month, and both are also exactly what a mis-typed figure
 * looks like. So the API answers 409 with the numbers instead of guessing, and this turns
 * that into the dialog that asks, then sends the same entry back with the shopkeeper's
 * answer attached.
 *
 * Lives here rather than in either page because the counter form on the ledger and the
 * one-tap payment on the customer list must ask the same question the same way — a guard
 * that only one of two entry points honours is not a guard.
 */
export async function recordKhataEntry({ customerId, type, amount, note, paymentMode, confirm, t }) {
  const body = { type, amount, note, paymentMode };

  try {
    return await apiFetch(`/api/seller/khata/customers/${customerId}/transactions`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (err) {
    const data = err.data || {};
    let extra = null;

    if (err.code === 'KHATA_CREDIT_LIMIT') {
      const ok = await confirm({
        tone: 'warning',
        title: t('seller.overLimitTitle'),
        body: t('seller.overLimitBody'),
        details: [
          { label: t('seller.balance'), value: `₹${data.balance}` },
          { label: t('seller.creditLimit'), value: `₹${data.creditLimit}` },
          { label: t('seller.afterThisEntry'), value: `₹${data.after}`, tone: 'danger' },
        ],
        confirmLabel: t('seller.giveAnyway'),
      });
      if (!ok) return null;
      extra = { allowOverLimit: true };
    } else if (err.code === 'KHATA_PAYMENT_EXCEEDS') {
      const ok = await confirm({
        tone: 'warning',
        title: t('seller.advanceTitle'),
        body: t('seller.advanceBody'),
        details: [
          { label: t('seller.balance'), value: `₹${data.balance}` },
          { label: t('seller.amountTaken'), value: `₹${data.amount}` },
          { label: t('seller.advanceKept'), value: `₹${data.excess}`, tone: 'success' },
        ],
        confirmLabel: t('seller.takeAnyway'),
      });
      if (!ok) return null;
      extra = { allowAdvance: true };
    }

    if (!extra) throw err;

    return apiFetch(`/api/seller/khata/customers/${customerId}/transactions`, {
      method: 'POST',
      body: JSON.stringify({ ...body, ...extra }),
    });
  }
}

/**
 * Hands the shopkeeper the WhatsApp draft the server just built for a payment.
 *
 * Opened rather than sent: `wa.me` links cannot be delivered on the shop's behalf (there is
 * no callback and no send API behind them), so the honest thing is to put the message in
 * front of him with one tap left to make.
 */
export function openReceipt(receipt) {
  if (!receipt?.whatsappLink) return false;
  window.open(receipt.whatsappLink, '_blank');
  return true;
}

// The four buckets every Indian accountant already reads an aging schedule in.
export const AGING_KEYS = ['d0_30', 'd31_60', 'd61_90', 'd90plus'];

export const AGING_LABEL = {
  d0_30: 'seller.aging0',
  d31_60: 'seller.aging31',
  d61_90: 'seller.aging61',
  d90plus: 'seller.aging90',
};

/**
 * "2 saal 4 mahine se" — a span of days as the phrase a shopkeeper would actually say.
 *
 * Shared by the customer's own page and the khata list because the same number has to read
 * the same in both places: a customer who is "3 saal purana" on one screen and "1,142 din"
 * on the other is two different facts to the person reading them.
 *
 * Deliberately coarse. Past a year nobody cares about the days, and past a month nobody
 * cares about the weeks — the question this answers is "purana customer hai ya naya", and
 * an exact figure buys nothing while making the line harder to read at a glance.
 */
export function spanLabel(days, t) {
  const total = Math.max(0, Math.floor(Number(days) || 0));
  if (total < 1) return t('seller.spanToday');
  if (total < 30) return t('seller.spanDays', { count: total });
  const months = Math.floor(total / 30);
  if (months < 12) return t('seller.spanMonths', { count: months });
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? t('seller.spanYearsMonths', { years, months: rest }) : t('seller.spanYears', { count: years });
}

/**
 * How this customer pays, in one word.
 *
 * `payback` is null until they have cleared at least one udhaar, and that is a genuinely
 * different state from paying slowly — a customer with nothing cleared yet has no record to
 * judge, and labelling them "slow" on their first week would be the screen inventing a
 * reputation. See settlementSpeed() in backend/utils/khataAging.js.
 */
export function paybackTone(payback) {
  if (!payback) return null;
  if (payback.avgDays <= 15) return 'good';
  if (payback.avgDays <= 45) return 'ok';
  return 'slow';
}
