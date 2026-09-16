// Keep add-time and checkout checks consistent. Tracked products use their
// sellable lots, not the catalog's legacy expiry date.
export function isExpiredProduct(product, now = new Date()) {
  if (!product || product.kind === 'service') return false;
  if (product.trackBatches) {
    return Number(product.expiredStock) > 0 && Number(product.sellableStock) === 0;
  }
  if (!product.expiryDate) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return new Date(product.expiryDate) < today;
}
