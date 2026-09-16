export function printPreferencesKey(isEstimate) {
  return isEstimate ? 'dukaan_quotation_prefs' : 'dukaan_invoice_prefs';
}
export function printDocumentKind({ isEstimate, isDebitNote, requested }) {
  return isDebitNote ? 'debitnote' : isEstimate ? 'estimate' : requested || 'auto';
}
export function quotationDefaultLook(shopLook) {
  return { ...shopLook, paper: 'a4', template: 'classic', density: 'normal' };
}
export function quotationExtras(invoice, extras) {
  return { ...extras, validUntil: invoice?.estimate?.validUntil ? String(invoice.estimate.validUntil).slice(0, 10) : '', notes: invoice?.estimate?.notes || '' };
}
