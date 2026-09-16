export function tableStockShortage(product, orderedQuantity) {
  if (!product || product.kind === 'service' || product.recipe?.length) return null;
  const available = product.trackBatches ? product.sellableStock : product.stock;
  if (typeof available !== 'number' || !Number.isFinite(available)) return null;
  if (orderedQuantity <= available + 0.000001) return null;
  return { available, ordered: orderedQuantity, unit: product.unit || '' };
}

// Older servers return only this message. Match the whole product name, including
// pack descriptions, so the same card works before and after a server restart.
export function stockErrorProductId(error, products = [], items = []) {
  if (error.code === 'INSUFFICIENT_STOCK' && error.data?.productId) return String(error.data.productId);
  const match = /^Insufficient (?:unexpired )?stock for (.+)$/.exec(error.message || '');
  if (!match) return null;
  const product = products.find((entry) => entry.name === match[1]);
  if (product) return String(product._id);
  const item = items.find((entry) => entry.name === match[1]);
  return item ? String(item.product) : null;
}
