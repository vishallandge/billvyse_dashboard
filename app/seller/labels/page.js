'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch, fetchBlobUrl } from '../../../lib/api';
import { formatRupees } from '../../../lib/format';
import { resolveLayout } from '../../../lib/labelSpec';
import { useLanguage } from '../../components/LanguageProvider';
import Illustration from '../../components/Illustration';
import { useToast } from '../../components/Toast';
import { SkeletonTable } from '../../components/Skeleton';
import { Pagination, usePagination } from '../../components/Pagination';
import { BarcodeIcon, SearchIcon, XIcon, PlusIcon } from '../../components/Icons';
import Dropdown from '../../components/Dropdown';
import LabelPreview, { LabelSheetMap } from '../../components/LabelPreview';

// The switches, in the order the panel shows them, paired with the string that names each
// one. The server decides which are ON for a template (it sends `fields` with every
// template); this list only decides what is offered and what it is called.
const FIELD_ROWS = [
  { key: 'shopName', label: 'labels.fieldShopName' },
  { key: 'pack', label: 'labels.fieldPack' },
  { key: 'mrp', label: 'labels.fieldMrp' },
  { key: 'savings', label: 'labels.fieldSavings' },
  { key: 'barcode', label: 'labels.fieldBarcode' },
  { key: 'barcodeText', label: 'labels.fieldBarcodeText' },
  { key: 'qr', label: 'labels.fieldQr' },
  { key: 'batch', label: 'labels.fieldBatch' },
  { key: 'expiry', label: 'labels.fieldExpiry' },
  { key: 'hsn', label: 'labels.fieldHsn' },
  { key: 'category', label: 'labels.fieldCategory' },
  { key: 'printedOn', label: 'labels.fieldPrintedOn' },
  { key: 'border', label: 'labels.fieldBorder' },
];

const TEXT_SIZES = [
  { value: '0.85', label: 'labels.textSmall' },
  { value: '1', label: 'labels.textNormal' },
  { value: '1.2', label: 'labels.textLarge' },
];

// The escape hatch for the hundred odd sticker sheets sold in local stationery shops that
// no fixed list will ever cover. Same numbers the server clamps to in resolveLayout().
const CUSTOM_DEFAULT = { kind: 'sheet', cellWmm: 50, cellHmm: 25, cols: 4, rows: 11, gapXmm: 0, gapYmm: 0 };

const CUSTOM_FIELDS = [
  { key: 'cellWmm', label: 'labels.customWidth', min: 12, max: 210, step: 0.5 },
  { key: 'cellHmm', label: 'labels.customHeight', min: 8, max: 297, step: 0.5 },
  { key: 'cols', label: 'labels.customCols', min: 1, max: 20, step: 1 },
  { key: 'rows', label: 'labels.customRows', min: 1, max: 40, step: 1 },
  { key: 'gapXmm', label: 'labels.customGapX', min: 0, max: 30, step: 0.5 },
  { key: 'gapYmm', label: 'labels.customGapY', min: 0, max: 30, step: 0.5 },
];

export default function LabelsPage() {
  const { t, lang } = useLanguage();
  const toast = useToast();

  const [products, setProducts] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [shop, setShop] = useState({ name: '', catalogUrl: '' });
  const [qrAvailable, setQrAvailable] = useState(false);
  const [qrContents, setQrContents] = useState(['code']);

  const [selected, setSelected] = useState(() => new Set());
  const [copies, setCopies] = useState(1);
  // Per-product overrides. "3 of the atta, 40 of the shampoo sachets" is the normal shape of
  // a print job, and one global number can't say it.
  const [rowCopies, setRowCopies] = useState({});
  const [layout, setLayout] = useState('a4-24');
  const [custom, setCustom] = useState(CUSTOM_DEFAULT);
  const [template, setTemplate] = useState('classic');
  const [fields, setFields] = useState({});
  const [qrContent, setQrContent] = useState('catalog');
  const [fontScale, setFontScale] = useState('1');
  const [skip, setSkip] = useState(0);
  const [search, setSearch] = useState('');
  // Which sticker the preview is showing. The last row the seller touched, because that is
  // the one they are thinking about — falls back to the first selected product.
  const [previewId, setPreviewId] = useState('');
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([apiFetch('/api/seller/products'), apiFetch('/api/seller/products/label-layouts')])
      .then(([productData, layoutData]) => {
        setProducts(productData.products || []);
        setLayouts(layoutData.layouts || []);
        setTemplates(layoutData.templates || []);
        setShop(layoutData.shop || { name: '', catalogUrl: '' });
        setQrAvailable(Boolean(layoutData.qrAvailable));
        const allowed = layoutData.qrContents?.length ? layoutData.qrContents : ['code'];
        setQrContents(allowed);
        setQrContent(allowed[0]);
        const first = (layoutData.templates || []).find((entry) => entry.id === 'classic') || (layoutData.templates || [])[0];
        if (first) {
          setTemplate(first.id);
          setFields(first.fields || {});
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(term) ||
        (product.barcode || '').toLowerCase().includes(term) ||
        (product.category || '').toLowerCase().includes(term)
    );
  }, [products, search]);

  const labelPage = usePagination(filtered, { pageSize: 25, resetKey: search });

  /**
   * The sticker's real geometry, worked out on this side by the SAME function the PDF uses
   * (lib/labelSpec.js is mirrored from the server's copy). That is what lets the preview be
   * honest and what lets a custom sheet exist at all — a size the seller typed in has no
   * entry in the server's list to look up.
   */
  const geometry = useMemo(() => resolveLayout(layout, custom), [layout, custom]);
  const isRoll = geometry.kind === 'roll';
  const perPage = geometry.perPage;
  const copiesFor = (id) => rowCopies[id] ?? copies;
  const totalStickers = [...selected].reduce((sum, id) => sum + copiesFor(id), 0);
  // Clamped rather than corrected in state: changing from a 65-up sheet to a 4-up one must
  // not silently print onto a slot that does not exist.
  const effectiveSkip = isRoll ? 0 : Math.min(skip, Math.max(0, perPage - 1));
  const pages = perPage ? Math.ceil((totalStickers + effectiveSkip) / perPage) : 0;

  /**
   * A typed-in sheet that does not fit on A4.
   *
   * resolveLayout centres the grid on the page and clamps a negative margin to zero, so an
   * over-wide grid does not error — it quietly prints the right-hand column off the edge of
   * the paper. Said out loud here, while the number is still being typed, rather than
   * discovered on a wasted sheet.
   */
  const customOverflows =
    layout === 'custom' &&
    geometry.kind === 'sheet' &&
    (geometry.cols * geometry.cellWmm + geometry.gapXmm * (geometry.cols - 1) > 210 ||
      geometry.rows * geometry.cellHmm + geometry.gapYmm * (geometry.rows - 1) > 297);

  function toggle(id) {
    setPreviewId(id);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Selecting-all applies to what's currently filtered, not the whole catalogue — that's
  // what a shopkeeper means after searching "Parle".
  function toggleAllFiltered() {
    const filteredIds = filtered.map((product) => product._id);
    const allSelected = filteredIds.every((id) => selected.has(id));
    setSelected((current) => {
      const next = new Set(current);
      filteredIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  // A template is a starting point, not a cage: picking one loads the switches it was
  // designed with, and anything changed afterwards stays changed.
  function pickTemplate(id) {
    setTemplate(id);
    const chosen = templates.find((entry) => entry.id === id);
    if (chosen?.fields) setFields({ ...chosen.fields, customLine: fields.customLine });
  }

  const setField = (key) => (event) => setFields((current) => ({ ...current, [key]: event.target.checked }));

  const setCustomField = (key) => (event) =>
    setCustom((current) => ({ ...current, [key]: event.target.value === '' ? '' : Number(event.target.value) }));

  async function print() {
    if (selected.size === 0) {
      toast.error(t('labels.pickSome'));
      return;
    }
    /**
     * Opened BEFORE the await, and WITHOUT `noopener`.
     *
     * Before the await because a tab opened after an async hop is a pop-up as far as the
     * browser is concerned and gets blocked. Without `noopener` because that flag makes
     * `window.open` return **null by specification** — so the handle was thrown away on
     * every desktop browser, `tab` was never truthy, and pressing Print silently dropped a
     * PDF into the Downloads folder instead of opening it. The tab is ours and same-origin;
     * clearing `opener` by hand gives the same protection and keeps the handle.
     */
    const tab = window.open('', '_blank');
    if (tab) {
      try {
        tab.opener = null;
      } catch {
        // Some browsers make `opener` read-only on a same-origin window. Nothing is lost.
      }
    }
    setPrinting(true);
    try {
      const { url } = await fetchBlobUrl('/api/seller/products/labels.pdf', {
        method: 'POST',
        body: {
          items: [...selected].map((id) => ({ id, copies: copiesFor(id) })),
          template,
          layout,
          custom: layout === 'custom' ? custom : undefined,
          fields,
          qrContent,
          fontScale: Number(fontScale),
          skip: effectiveSkip,
        },
      });
      if (tab) {
        tab.location.href = url;
      } else {
        // Pop-ups genuinely blocked — save it instead of silently doing nothing, and say so,
        // or the sheet appears in Downloads with no explanation. Same blob, no second request.
        const link = document.createElement('a');
        link.href = url;
        link.download = `labels-${layout}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast.info(t('labels.popupBlocked'));
      }
      // Long enough for the tab to have loaded the document off it.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      if (tab) tab.close();
      toast.error(err.message);
    } finally {
      setPrinting(false);
    }
  }

  /**
   * Gives the selected products that have no code one of the shop's own.
   *
   * Half a kirana's shelf is loose or locally packed and carries no printed barcode, and
   * until it has one it can be neither scanned at the counter nor printed on a sticker that
   * scans. The codes come from the GS1 in-store range, so they can never collide with a
   * manufacturer's.
   */
  async function generateBarcodes() {
    const missing = [...selected].filter((id) => !products.find((p) => p._id === id)?.barcode);
    if (missing.length === 0) {
      toast.error(t('labels.noBarcodeMissing'));
      return;
    }
    setGenerating(true);
    try {
      const data = await apiFetch('/api/seller/products/generate-barcodes', {
        method: 'POST',
        body: JSON.stringify({ ids: missing }),
      });
      const byId = new Map((data.products || []).map((row) => [String(row._id), row.barcode]));
      setProducts((current) => current.map((p) => (byId.has(p._id) ? { ...p, barcode: byId.get(p._id) } : p)));
      toast.success(t('labels.generatedBarcodes', { count: data.updated || 0 }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  }

  const missingBarcodes = [...selected].filter((id) => !products.find((p) => p._id === id)?.barcode).length;
  // A QR of the product's own code needs a code to encode. Worth saying out loud, because the
  // sticker would otherwise print without the square and nobody would know why.
  const qrNeedsBarcode = fields.qr && qrContent === 'code' && missingBarcodes > 0;

  // Sheets, rolls and "your own size" as three named groups. Fourteen unlabelled entries in
  // one list is a wall of millimetres; a seller knows first whether they are feeding an A4
  // sheet or a thermal roll.
  const layoutGroups = useMemo(() => {
    const toOption = (entry) => ({ value: entry.id, label: entry.label });
    const groups = [];
    const sheets = layouts.filter((entry) => entry.kind !== 'roll').map(toOption);
    const rolls = layouts.filter((entry) => entry.kind === 'roll').map(toOption);
    if (sheets.length) groups.push({ label: t('labels.groupSheets'), options: sheets });
    if (rolls.length) groups.push({ label: t('labels.groupRolls'), options: rolls });
    groups.push({ label: t('labels.groupCustom'), options: [{ value: 'custom', label: t('labels.customSize') }] });
    return groups;
  }, [layouts, t]);

  // The product the preview draws: the row last touched, else the first one selected, else
  // the first on screen — so the sticker is never an empty box while a catalogue is loaded.
  const previewProduct = useMemo(() => {
    const byId = (id) => products.find((product) => product._id === id);
    return byId(previewId) || byId([...selected][0]) || filtered[0] || null;
  }, [products, previewId, selected, filtered]);

  const previewQrValue = useMemo(() => {
    if (!fields.qr || !qrAvailable || !previewProduct) return null;
    if (qrContent === 'code') return String(previewProduct.barcode || '').trim() || null;
    return shop.catalogUrl ? `${shop.catalogUrl}?p=${previewProduct._id}` : null;
  }, [fields.qr, qrAvailable, previewProduct, qrContent, shop.catalogUrl]);

  const previewShop = useMemo(() => ({ shopName: shop.name }), [shop.name]);

  return (
    <>
      <div className="content-header page-head">
        <div>
          <h1>{t('labels.title')}</h1>
          <p>{t('labels.subtitle')}</p>
        </div>
        <button type="button" className="btn btn-primary btn-inline" onClick={print} disabled={selected.size === 0 || printing}>
          <BarcodeIcon size={17} />
          {printing ? t('labels.printing') : t('labels.print')}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Settings on the left, the sticker itself on the right. On a wide screen the preview
          stays put while the switches are worked through — which is the whole point of
          doing this job at a desk rather than on a phone. */}
      <div className="labels-studio">
        <div className="panel labels-settings">
          <h2>{t('labels.settings')}</h2>
          <div className="form-grid">
            <div className="field">
              <label>{t('labels.template')}</label>
              <Dropdown
                value={template}
                onChange={pickTemplate}
                options={templates.map((entry) => ({ value: entry.id, label: entry.label }))}
              />
              <small style={{ color: 'var(--text-muted)' }}>{templates.find((entry) => entry.id === template)?.hint}</small>
            </div>
            <div className="field">
              <label>{t('labels.sheetSize')}</label>
              <Dropdown value={layout} onChange={setLayout} groups={layoutGroups} />
              <small style={{ color: 'var(--text-muted)' }}>
                {t('labels.perPage', { count: perPage })} · {round1(geometry.cellWmm)}×{round1(geometry.cellHmm)}mm
              </small>
            </div>
            <div className="field">
              <label>{t('labels.copies')}</label>
              <input
                type="number"
                min="1"
                max="100"
                value={copies}
                onChange={(e) => setCopies(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
              />
            </div>
            <div className="field">
              <label>{t('labels.textSize')}</label>
              <Dropdown
                value={fontScale}
                onChange={setFontScale}
                options={TEXT_SIZES.map((size) => ({ value: size.value, label: t(size.label) }))}
              />
            </div>
            {!isRoll && (
              <div className="field">
                <label>{t('labels.skipSlots')}</label>
                <input
                  type="number"
                  min="0"
                  max={Math.max(0, perPage - 1)}
                  value={skip}
                  onChange={(e) => setSkip(Math.max(0, Math.min(perPage - 1, Number(e.target.value) || 0)))}
                />
                <small style={{ color: 'var(--text-muted)' }}>{t('labels.skipHint')}</small>
              </div>
            )}
            <div className="field">
              <label htmlFor="label-custom-line">{t('labels.customLine')}</label>
              <input
                id="label-custom-line"
                maxLength={40}
                value={fields.customLine || ''}
                onChange={(e) => setFields((current) => ({ ...current, customLine: e.target.value }))}
                placeholder={t('labels.customLinePlaceholder')}
              />
            </div>
          </div>

          {layout === 'custom' && (
            <>
              <h3 style={{ marginTop: '1.1rem' }}>{t('labels.customSize')}</h3>
              <div className="form-grid">
                <div className="field">
                  <label>{t('labels.customKind')}</label>
                  <Dropdown
                    value={custom.kind}
                    onChange={(value) => setCustom((current) => ({ ...current, kind: value }))}
                    options={[
                      { value: 'sheet', label: t('labels.customSheet') },
                      { value: 'roll', label: t('labels.customRoll') },
                    ]}
                  />
                </div>
                {CUSTOM_FIELDS.map((row) => (
                  <div className="field" key={row.key}>
                    <label htmlFor={`label-custom-${row.key}`}>{t(row.label)}</label>
                    <input
                      id={`label-custom-${row.key}`}
                      type="number"
                      min={row.min}
                      max={row.max}
                      step={row.step}
                      value={custom[row.key]}
                      onChange={setCustomField(row.key)}
                    />
                  </div>
                ))}
              </div>
              <small style={{ color: 'var(--text-muted)' }}>{t('labels.customHint')}</small>
              {customOverflows && (
                <div className="info-banner" style={{ marginTop: '0.9rem', marginBottom: 0 }}>{t('labels.customTooBig')}</div>
              )}
            </>
          )}

          <h3 style={{ marginTop: '1.1rem' }}>{t('labels.whatToPrint')}</h3>
          <div className="label-toggles">
            {FIELD_ROWS.map((row) => (
              <label className="checkbox-row" key={row.key}>
                <input
                  type="checkbox"
                  checked={Boolean(fields[row.key])}
                  onChange={setField(row.key)}
                  disabled={row.key === 'qr' && !qrAvailable}
                />
                <span>{t(row.label)}</span>
              </label>
            ))}
          </div>

          {!qrAvailable && <div className="info-banner" style={{ marginTop: '0.9rem', marginBottom: 0 }}>{t('labels.qrUnavailable')}</div>}

          {fields.qr && qrAvailable && (
            <div className="form-grid" style={{ marginTop: '0.9rem' }}>
              <div className="field">
                <label>{t('labels.qrContent')}</label>
                <Dropdown
                  value={qrContent}
                  onChange={setQrContent}
                  options={qrContents.map((value) => ({
                    value,
                    label: value === 'catalog' ? t('labels.qrCatalog') : t('labels.qrCode'),
                  }))}
                />
                <small style={{ color: 'var(--text-muted)' }}>
                  {qrContent === 'catalog' ? t('labels.qrCatalogHint') : t('labels.qrCodeHint')}
                </small>
              </div>
            </div>
          )}

          <div className="label-summary">
            <span>
              <strong>{selected.size}</strong> {t('labels.productsSelected')}
            </span>
            <span>
              <strong>{totalStickers}</strong> {t('labels.stickers')}
            </span>
            <span>
              <strong>{pages}</strong> {t('labels.pages')}
            </span>
          </div>

          {fields.barcode && missingBarcodes > 0 && (
            <div className="info-banner" style={{ marginTop: '0.9rem', marginBottom: 0 }}>
              {t('labels.missingBarcodes', { count: missingBarcodes })}
              <button
                type="button"
                className="link-btn"
                style={{ marginInlineStart: '0.5rem' }}
                onClick={generateBarcodes}
                disabled={generating}
              >
                {t('labels.generateBarcodes')}
              </button>
            </div>
          )}
          {qrNeedsBarcode && (
            <div className="info-banner" style={{ marginTop: '0.9rem', marginBottom: 0 }}>{t('labels.qrNeedsBarcode', { count: missingBarcodes })}</div>
          )}
        </div>

        <div className="panel labels-products">
          <div className="panel-head">
            <h2>{t('labels.chooseProducts')}</h2>
            <div className="panel-tools">
              <div className="search-box-inline">
                <SearchIcon size={15} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('labels.searchPlaceholder')} />
              </div>
              <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={toggleAllFiltered}>
                {t('labels.selectAll')}
              </button>
              {selected.size > 0 && (
                <button type="button" className="link-btn" onClick={() => setSelected(new Set())}>
                  <XIcon size={12} /> {t('labels.clearSelection')}
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <SkeletonTable rows={6} cols={5} />
          ) : filtered.length === 0 ? (
            <div className="empty-state-rich">
              <Illustration scene={products.length === 0 ? 'shelf' : 'search'} />
              <p>{products.length === 0 ? t('labels.noProducts') : t('table.noResults')}</p>
              {products.length === 0 ? (
                <Link href="/seller/products" className="btn btn-primary btn-small btn-inline">
                  <PlusIcon size={15} />
                  {t('seller.addYourFirstProduct')}
                </Link>
              ) : (
                <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => setSearch('')}>
                  {t('table.clearFilters')}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="table-wrap auto-height">
                <table className="data-table" style={{ minWidth: '620px' }}>
                  <thead>
                    <tr>
                      <th className="tight" />
                      <th>{t('seller.productName')}</th>
                      <th>{t('labels.barcodeCol')}</th>
                      <th className="num">{t('labels.priceCol')}</th>
                      <th className="num">{t('labels.copiesCol')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {labelPage.pageItems.map((product) => (
                      <tr
                        key={product._id}
                        className={`row-enter selectable-row${selected.has(product._id) ? ' selected' : ''}${
                          previewProduct?._id === product._id ? ' is-previewing' : ''
                        }`}
                        onClick={() => toggle(product._id)}
                      >
                        <td className="tight">
                          <input
                            type="checkbox"
                            className="row-check"
                            checked={selected.has(product._id)}
                            onChange={() => toggle(product._id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={product.name}
                          />
                        </td>
                        <td>
                          <div className="cell-stack">
                            <span className="cell-strong">{product.name}</span>
                            {product.category && <span className="cell-sub">{product.category}</span>}
                          </div>
                        </td>
                        <td className="cell-muted">{product.barcode || <span className="cell-sub">{t('labels.noBarcode')}</span>}</td>
                        <td className="num cell-strong">{formatRupees(product.price, lang)}</td>
                        <td className="num">
                          <input
                            type="number"
                            min="1"
                            max="500"
                            style={{ width: '5rem', textAlign: 'right' }}
                            value={copiesFor(product._id)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              e.stopPropagation();
                              const value = Math.min(500, Math.max(1, Number(e.target.value) || 1));
                              setRowCopies((current) => ({ ...current, [product._id]: value }));
                            }}
                            aria-label={t('labels.copiesCol')}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                compact
                page={labelPage.page}
                pageCount={labelPage.pageCount}
                pageSize={labelPage.pageSize}
                total={labelPage.total}
                from={labelPage.from}
                to={labelPage.to}
                onPageChange={labelPage.setPage}
                onPageSizeChange={labelPage.setPageSize}
                label={t('seller.products')}
              />
            </>
          )}
        </div>

        <aside className="labels-studio-side">
          <div className="panel label-preview-panel">
            <h2>{t('labels.preview')}</h2>
            {previewProduct ? (
              <>
                <div className="label-stage">
                  <LabelPreview
                    product={previewProduct}
                    shop={previewShop}
                    template={template}
                    fields={fields}
                    fontScale={Number(fontScale)}
                    widthMm={geometry.cellWmm}
                    heightMm={geometry.cellHmm}
                    qrValue={previewQrValue}
                  />
                </div>
                <p className="label-stage-caption">
                  {previewProduct.name}
                  <span>{t('labels.previewSize', { w: round1(geometry.cellWmm), h: round1(geometry.cellHmm) })}</span>
                </p>
                <p className="label-stage-note">{t('labels.previewHint')}</p>
                {!isRoll && (
                  <div className="label-sheet-block">
                    <h3>{t('labels.sheetMapTitle')}</h3>
                    <LabelSheetMap
                      cols={geometry.cols}
                      rows={geometry.rows}
                      cellWmm={geometry.cellWmm}
                      cellHmm={geometry.cellHmm}
                      skip={effectiveSkip}
                      filled={Math.min(totalStickers, perPage - effectiveSkip)}
                    />
                    <small style={{ color: 'var(--text-muted)' }}>{t('labels.sheetMapHint')}</small>
                  </div>
                )}
              </>
            ) : (
              <p className="label-stage-note">{t('labels.previewEmpty')}</p>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

// Sticker sizes are sold as "63.5×33.9mm" — one decimal, and no trailing ".0" on the round
// ones, so the caption reads like the packet rather than like a float.
function round1(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}
