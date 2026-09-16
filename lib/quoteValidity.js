// Same Indian mobile normalization as shopProfileRules and backend/utils/phone.
const isIndianMobile = (value) => /^[6-9]\d{9}$/.test(String(value || '').replace(/\D/g, '').replace(/^(0091|91|0)(?=\d{10}$)/, ''));
export const MAX_QUOTE_VALID_DAYS = 3650;

export function quoteDateForDays(days, now = Date.now()) {
  if (!/^\d+$/.test(String(days)) || Number(days) < 1 || Number(days) > MAX_QUOTE_VALID_DAYS) return '';
  return new Date(Number(now) + (Number(days) * 86400000) + 330 * 60000).toISOString().slice(0, 10);
}

export function validateQuoteForm(form, hasCustomer = false, now = Date.now()) {
  const errors = {};
  if (!hasCustomer) {
    const name = String(form.contactName || '').trim();
    if (name && (name.length < 2 || name.length > 120 || /[\x00-\x1f\x7f]/.test(name))) errors.contactName = 'seller.quoteNameError';
    if (String(form.contactPhone || '').trim() && !isIndianMobile(form.contactPhone)) errors.contactPhone = 'seller.quotePhoneError';
  }
  if (form.validityMode === 'days') {
    if (!quoteDateForDays(form.validDays, now)) errors.validDays = 'seller.quoteValidDaysError';
  } else if (form.validityMode === 'date') {
    const value = form.validUntil || '';
    const date = new Date(value + 'T00:00:00Z');
    const today = new Date(Number(now) + 330 * 60000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < today) errors.validUntil = 'seller.quoteDateError';
  } else errors.validUntil = 'seller.quoteDateError';
  if (String(form.notes || '').length > 500) errors.notes = 'seller.quoteNotesError';
  return errors;
}
