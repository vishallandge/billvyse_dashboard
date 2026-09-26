// Reuse a parsed sheet for option changes. A cache miss may re-check the original
// file once, but this helper never retries a rate limit or submits an import write.
export async function fetchProductImportPreview(apiFetch, { fileBase64, sheetToken, resolutions = {}, stockMode = 'keep', priceMode = 'keep' }) {
  const send = (token) => apiFetch('/api/seller/products/import/preview', {
    method: 'POST',
    body: JSON.stringify({ ...(token ? { sheetToken: token } : { fileBase64 }), resolutions, stockMode, priceMode }),
    timeoutMs: 2 * 60 * 1000,
    retries: 0,
  });
  try { return await send(sheetToken); }
  catch (error) {
    if (!sheetToken || error.status !== 410 || error.code !== 'IMPORT_PREVIEW_EXPIRED') throw error;
    return send(null);
  }
}
