'use client';

import { useMemo, useState } from 'react';
import Dropdown from './Dropdown';
import { PlusIcon, XIcon, RefreshIcon, AlertIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon } from './Icons';
import { formatQty } from '../../lib/format';
import { recipeUnitChoices, recipeUnitFactor, defaultRecipeUnit, recipePreview } from '../../lib/recipeUnits';

/**
 * "Isme kya-kya lagta hai?" — the recipe on a dish (or the materials of a service).
 *
 * Built for a hotel owner, not for software people, so it shows only three things by default:
 *
 *   1. the rows: [Paneer] [200] [gram]  — the unit sits right beside the number, because a bare
 *      "200" once took 200 KG of paneer per plate;
 *   2. under each row, one short line: "16 plate ke liye kaafi" (or red "Khatam");
 *   3. one box at the bottom: "Abhi 13 ban sakti hain — Butter sabse pehle khatam hoga".
 *
 * Everything else (cooking in a batch, copying another dish, gas/labour cost, recalculating
 * cost) waits behind "Aur options" and opens on its own only when one of them is already in
 * use. Nothing here moves stock — the server does that on billing, from the same numbers.
 *
 * `lines` are `{ product, amount, unit }`. A line from an older recipe has no unit, which
 * means "in the ingredient's stock unit" — exactly what it always meant.
 *
 * On a service (`isService`) the same rows are the materials it uses. A service is never
 * stopped for a short material, so its bottom box talks about cost, not "can make".
 */
export default function RecipeEditor({
  lines,
  onChange,
  products,
  editingId,
  dishUnit,
  onRecalcCost,
  isService = false,
  extraCost = '',
  onExtraCostChange,
  recipeYield = '',
  onYieldChange,
  onCreateIngredient,
  t,
  lang,
}) {
  const byId = useMemo(() => new Map(products.map((p) => [String(p._id), p])), [products]);
  const unitLabel = (u) => (u ? t(`units.${u}`) : '');
  const dish = unitLabel(dishUnit || 'piece');
  const perBatch = Number(recipeYield) > 0 ? Number(recipeYield) : 1;

  // "Aur options" opens by itself only when something inside it is already set — otherwise
  // a first-time owner sees just the rows.
  const [moreOpen, setMoreOpen] = useState(perBatch > 1 || Number(extraCost) > 0);
  const [copyScale, setCopyScale] = useState('1');
  const [newOpen, setNewOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_INGREDIENT);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // What can go in: a stocked item that is not this dish and is not itself a dish. The
  // server refuses the other two; not offering them is kinder than refusing on save.
  const options = useMemo(() => {
    const usable = products.filter((p) => p._id !== editingId && p.kind !== 'service' && !(p.recipe?.length));
    return [
      { value: '', label: t('recipe.pickIngredient') },
      ...usable.map((p) => ({ value: p._id, label: `${p.name} (${formatQty(p.stock, lang)} ${unitLabel(p.unit)})` })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, editingId, lang]);

  // Other items with a recipe — "Half plate" copies "Full plate" at ×½.
  const copySources = useMemo(
    () => products.filter((p) => p._id !== editingId && p.recipe?.length && (p.kind === 'service') === isService),
    [products, editingId, isService]
  );

  const preview = useMemo(() => recipePreview(lines, byId, perBatch), [lines, byId, perBatch]);
  const extra = Number(extraCost) > 0 ? Number(extraCost) : 0;
  const totalCost = (preview.cost || 0) + extra;
  const hasLines = lines.some((l) => l.product);

  function setLine(index, patch) {
    onChange(lines.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function pickIngredient(index, productId) {
    setLine(index, { product: productId, unit: defaultRecipeUnit(byId.get(String(productId))) });
  }
  function addRow() {
    onChange([...lines, { product: '', amount: '', unit: '' }]);
  }

  function copyFrom(sourceId) {
    const source = byId.get(String(sourceId));
    if (!source) return;
    const scale = Number(copyScale) || 1;
    const sourceBatch = Number(source.recipeYield) > 0 ? Number(source.recipeYield) : 1;
    const copied = source.recipe.map((line) => {
      const id = String(line.product?._id || line.product);
      const ingredient = byId.get(id);
      // Per one unit of the source, in what its cook typed; then scaled, laid out for THIS
      // recipe's batch size.
      const typed = line.amount != null ? Number(line.amount) / sourceBatch : Number(line.quantity);
      const amount = Math.round(typed * scale * perBatch * 1000) / 1000;
      return { product: id, amount: String(amount), unit: line.amount != null ? line.unit || ingredient?.unit || '' : ingredient?.unit || '' };
    });
    const filled = lines.filter((l) => l.product || l.amount);
    onChange(filled.length ? [...filled, ...copied] : copied);
  }

  async function createIngredient() {
    setCreateError('');
    const name = draft.name.trim();
    if (!name) return setCreateError(t('recipe.newNeedName'));
    const stock = draft.stock === '' ? 0 : Number(draft.stock);
    const alert = draft.alert === '' ? 0 : Number(draft.alert);
    if (!(stock >= 0) || !(alert >= 0)) return setCreateError(t('recipe.newBadNumber'));
    setCreating(true);
    try {
      const created = await onCreateIngredient({ name, unit: draft.unit, stock, lowStockThreshold: alert });
      if (created?._id) {
        const filled = lines.filter((l) => l.product || l.amount);
        onChange([...filled, { product: created._id, amount: '', unit: defaultRecipeUnit(created) }]);
      }
      setDraft(EMPTY_INGREDIENT);
      setNewOpen(false);
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="field recipe-editor">
      <label>{t(isService ? 'recipe.serviceTitle' : 'recipe.title', { n: formatQty(perBatch, lang), unit: dish })}</label>
      <p className="field-hint">{t(isService ? 'recipe.serviceHint' : 'recipe.hint', { unit: dish })}</p>

      {options.length <= 1 && !newOpen && <p className="recipe-empty">{t('recipe.noIngredients')}</p>}

      {lines.map((row, index) => {
        const ingredient = byId.get(String(row.product));
        const info = preview.rows[index] || {};
        const unitChoices = ingredient ? recipeUnitChoices(ingredient) : [];
        const unit = row.unit || ingredient?.unit || '';
        const out = ingredient && info.ready && info.canMake === 0;
        return (
          <div className="recipe-line" key={index}>
            <div className="recipe-line-inputs">
              <Dropdown
                className="recipe-line-product"
                value={row.product}
                onChange={(v) => pickIngredient(index, v)}
                options={
                  row.product && !options.some((o) => o.value === row.product)
                    ? [...options, { value: row.product, label: ingredient?.name || t('recipe.missingIngredient') }]
                    : options
                }
                searchable
                searchPlaceholder={t('recipe.searchIngredient')}
              />
              <input
                type="number"
                className="recipe-line-amount"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder={t('recipe.amount')}
                aria-label={t('recipe.amount')}
                value={row.amount}
                onChange={(e) => setLine(index, { amount: e.target.value })}
              />
              <Dropdown
                className="recipe-line-unit"
                value={unit}
                onChange={(v) => setLine(index, { unit: v })}
                disabled={!ingredient}
                options={(unitChoices.length ? unitChoices : [unit || 'piece']).map((u) => ({ value: u, label: unitLabel(u) }))}
              />
              <button
                type="button"
                className="icon-btn danger"
                aria-label={t('recipe.removeLine')}
                onClick={() => onChange(lines.filter((_, i) => i !== index))}
              >
                <XIcon size={17} />
              </button>
            </div>

            {/* One short line per row, nothing more. */}
            {ingredient && info.ready && (
              <p className={`recipe-line-note${out ? ' is-out' : ' is-ok'}`}>
                {out ? <AlertIcon size={13} /> : <CheckIcon size={13} />}
                <span>
                  {out
                    ? t(isService ? 'recipe.serviceLineOut' : 'recipe.lineOut', { name: ingredient.name })
                    : t('recipe.lineEnough', { n: formatQty(info.canMake, lang), unit: dish })}
                  {/* A batch line is the whole pot — say what one plate takes. */}
                  {perBatch > 1 &&
                    ` · ${t('recipe.linePerOne', { qty: smallQty(Number(row.amount) / perBatch, lang), unit: unitLabel(unit), dish })}`}
                </span>
              </p>
            )}
            {info.badUnit && (
              <p className="recipe-line-note is-out">
                <AlertIcon size={13} /> <span>{t('recipe.badUnit', { name: ingredient?.name || '' })}</span>
              </p>
            )}
            {row.product && !ingredient && (
              <p className="recipe-line-note is-out">
                <AlertIcon size={13} /> <span>{t('recipe.missingIngredientHint')}</span>
              </p>
            )}
          </div>
        );
      })}

      {/* Paneer is not in the app yet? Make it here, without leaving the dish half-typed. */}
      {newOpen && onCreateIngredient && (
        <div className="recipe-new">
          <p className="recipe-new-title">{t('recipe.newTitle')}</p>
          <div className="recipe-new-grid">
            <input
              aria-label={t('recipe.newName')}
              placeholder={t('recipe.newName')}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
            <Dropdown
              className="recipe-new-unit"
              value={draft.unit}
              onChange={(v) => setDraft((d) => ({ ...d, unit: v }))}
              options={KITCHEN_UNITS.map((u) => ({ value: u, label: unitLabel(u) }))}
            />
            <div className="field-affix">
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                aria-label={t('recipe.newStock')}
                placeholder={t('recipe.newStock')}
                value={draft.stock}
                onChange={(e) => setDraft((d) => ({ ...d, stock: e.target.value }))}
              />
              <span className="affix trail">{unitLabel(draft.unit)}</span>
            </div>
            <div className="field-affix">
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                aria-label={t('recipe.newAlert')}
                placeholder={t('recipe.newAlert')}
                value={draft.alert}
                onChange={(e) => setDraft((d) => ({ ...d, alert: e.target.value }))}
              />
              <span className="affix trail">{unitLabel(draft.unit)}</span>
            </div>
          </div>
          <p className="field-hint">{t('recipe.newHint')}</p>
          {createError && <p className="recipe-line-note is-out">{createError}</p>}
          <div className="row-actions">
            <button type="button" className="btn btn-primary btn-small btn-inline" disabled={creating} onClick={createIngredient}>
              {creating ? t('common.loading') : t('recipe.newSave')}
            </button>
            <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => setNewOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="row-actions">
        <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={addRow}>
          <PlusIcon size={15} /> {t('recipe.addRow')}
        </button>
        {onCreateIngredient && !newOpen && (
          <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => setNewOpen(true)}>
            <PlusIcon size={15} /> {t('recipe.newOpen')}
          </button>
        )}
      </div>

      {/* The one answer the owner is here for. */}
      {preview.servings != null && (
        <div className={`recipe-summary${preview.servings === 0 && !isService ? ' is-out' : ''}`}>
          {isService ? (
            <strong>{t('recipe.serviceSummary', { n: formatQty(preview.servings, lang), unit: dish })}</strong>
          ) : (
            <strong>
              {preview.servings === 0
                ? t('recipe.summaryNone', { name: preview.limiting?.name || '' })
                : t('recipe.summaryCanMake', { n: formatQty(preview.servings, lang), unit: dish })}
            </strong>
          )}
          {preview.servings > 0 && preview.limiting && <span>{t('recipe.summaryLimit', { name: preview.limiting.name })}</span>}
        </div>
      )}

      {hasLines && (
        <button type="button" className="recipe-more-toggle" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
          {moreOpen ? <ChevronDownIcon size={15} /> : <ChevronRightIcon size={15} />}
          {t('recipe.moreOptions')}
        </button>
      )}

      {hasLines && moreOpen && (
        <div className="recipe-more">
          {onYieldChange && (
            <div className="recipe-more-item">
              <label htmlFor="recipeYield">{t('recipe.yieldLabel')}</label>
              <div className="field-affix recipe-more-input">
                <input
                  id="recipeYield"
                  type="number"
                  min="1"
                  step="any"
                  inputMode="decimal"
                  placeholder="1"
                  value={recipeYield}
                  onChange={(e) => onYieldChange(e.target.value)}
                />
                <span className="affix trail">{dish}</span>
              </div>
              <p className="field-hint">{t('recipe.yieldHint')}</p>
            </div>
          )}

          {copySources.length > 0 && (
            <div className="recipe-more-item">
              <label>{t('recipe.copyFrom')}</label>
              <div className="recipe-copy-row">
                <Dropdown
                  className="recipe-copy-source"
                  value=""
                  onChange={copyFrom}
                  options={[{ value: '', label: t('recipe.copyPick') }, ...copySources.map((p) => ({ value: p._id, label: p.name }))]}
                  searchable={copySources.length > 8}
                />
                <Dropdown
                  className="recipe-copy-scale"
                  value={copyScale}
                  onChange={setCopyScale}
                  options={[
                    { value: '0.5', label: t('recipe.scaleHalf') },
                    { value: '1', label: t('recipe.scaleSame') },
                    { value: '2', label: t('recipe.scaleDouble') },
                  ]}
                />
              </div>
              <p className="field-hint">{t('recipe.copyHint')}</p>
            </div>
          )}

          {onExtraCostChange && (
            <div className="recipe-more-item">
              <label htmlFor="recipeExtraCost">{t('recipe.extraCost', { unit: dish })}</label>
              <div className="field-affix recipe-more-input">
                <span className="affix lead">₹</span>
                <input
                  id="recipeExtraCost"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={extraCost}
                  onChange={(e) => onExtraCostChange(e.target.value)}
                />
              </div>
            </div>
          )}

          {totalCost > 0 && (
            <p className="recipe-cost">
              {t('recipe.summaryCost', { cost: formatQty(Math.round(totalCost * 100) / 100, lang), unit: dish })}
              {!preview.costKnown && ` ${t('recipe.summaryCostPartial')}`}
            </p>
          )}
          {onRecalcCost && (
            <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={onRecalcCost}>
              <RefreshIcon size={15} /> {t('recipe.saveCost')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// A per-plate amount is often tiny (1.2 g of butter is 0.0012 kg); the shared formatter
// rounds to three places and would print 0.001. Two significant figures below 0.01.
function smallQty(n, lang) {
  const v = Number(n);
  if (Number.isFinite(v) && v !== 0 && Math.abs(v) < 0.01) return String(Number(v.toPrecision(2)));
  return formatQty(v, lang);
}

// Units a kitchen actually stocks its raw material in.
const KITCHEN_UNITS = ['kg', 'gram', 'litre', 'ml', 'piece', 'packet', 'dozen', 'tray', 'bottle', 'box'];
const EMPTY_INGREDIENT = { name: '', unit: 'kg', stock: '', alert: '' };

/** The lines as the API takes them. Blank and zero lines are dropped. */
export function recipePayload(lines, products) {
  const byId = new Map(products.map((p) => [String(p._id), p]));
  return lines
    .filter((row) => row.product && row.amount !== '' && Number(row.amount) > 0)
    .map((row) => ({
      product: row.product,
      amount: Number(row.amount),
      unit: row.unit || byId.get(String(row.product))?.unit || undefined,
    }));
}

/**
 * What is wrong with the lines, in words, or '' when they can be saved.
 *
 * recipePayload drops incomplete lines on purpose (a blank row left at the bottom is not an
 * error), so without this a line with paneer picked and no quantity simply vanished on save
 * and the dish billed without its paneer — with nothing said.
 */
export function recipeProblem(lines, products, t) {
  const byId = new Map(products.map((p) => [String(p._id), p]));
  for (let i = 0; i < lines.length; i += 1) {
    const row = lines[i];
    const hasAmount = row.amount !== '' && row.amount !== undefined && row.amount !== null;
    if (!row.product && !hasAmount) continue;
    if (!row.product) return t('recipe.errNoIngredient', { n: i + 1 });
    const ingredient = byId.get(String(row.product));
    if (!ingredient) return t('recipe.missingIngredientHint');
    const amount = Number(row.amount);
    if (!hasAmount || !Number.isFinite(amount) || amount <= 0) return t('recipe.errNoAmount', { name: ingredient.name });
    if (row.unit && recipeUnitFactor(row.unit, ingredient) == null) return t('recipe.badUnit', { name: ingredient.name });
  }
  return '';
}
