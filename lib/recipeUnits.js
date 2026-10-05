/**
 * Units on a recipe line — the browser half of backend/utils/recipe.js. Keep UNIT_BASE and
 * the two functions below identical to the server's; the server re-derives everything on
 * save, so a drift here shows a wrong preview but can never bill a wrong amount.
 *
 * A kitchen stocks paneer by the kilo and puts 200 grams on a plate. The line stores what
 * the cook typed (200 gram) and, beside it, the same amount in the stock unit (0.2 kg),
 * which is the only number billing reads.
 */

const UNIT_BASE = {
  gram: ['weight', 1],
  kg: ['weight', 1000],
  quintal: ['weight', 100000],
  ml: ['volume', 1],
  litre: ['volume', 1000],
  piece: ['count', 1],
  pair: ['count', 2],
  dozen: ['count', 12],
  cm: ['length', 1],
  metre: ['length', 100],
  inch: ['imperial', 1],
  feet: ['imperial', 12],
};

/** Stock units per one `entryUnit`, or null when the two cannot be converted. */
export function recipeUnitFactor(entryUnit, ingredient) {
  const stockUnit = ingredient?.unit;
  if (!entryUnit || !stockUnit || entryUnit === stockUnit) return 1;
  const a = UNIT_BASE[entryUnit];
  const b = UNIT_BASE[stockUnit];
  if (a && b && a[0] === b[0]) return a[1] / b[1];
  const per = Number(ingredient.subUnitsPerUnit);
  if (ingredient.subUnit && per > 1) {
    if (entryUnit === ingredient.subUnit) return 1 / per;
    const s = UNIT_BASE[ingredient.subUnit];
    if (a && s && a[0] === s[0]) return a[1] / s[1] / per;
  }
  return null;
}

/** Every unit a line for this ingredient can be typed in. Stock unit first. */
export function recipeUnitChoices(ingredient) {
  if (!ingredient?.unit) return [];
  const out = [ingredient.unit];
  const add = (u) => {
    if (u && !out.includes(u)) out.push(u);
  };
  const dimensionOf = (u) => UNIT_BASE[u]?.[0];
  for (const unit of Object.keys(UNIT_BASE)) {
    if (dimensionOf(unit) && dimensionOf(unit) === dimensionOf(ingredient.unit)) add(unit);
  }
  if (ingredient.subUnit && Number(ingredient.subUnitsPerUnit) > 1) {
    add(ingredient.subUnit);
    for (const unit of Object.keys(UNIT_BASE)) {
      if (dimensionOf(unit) && dimensionOf(unit) === dimensionOf(ingredient.subUnit)) add(unit);
    }
  }
  return out.filter((u) => recipeUnitFactor(u, ingredient) != null);
}

/**
 * The unit a cook most likely measures this ingredient in — grams of something stocked by
 * the kilo, ml of something stocked by the litre, one egg out of a tray. Only a default for
 * a freshly picked ingredient; the dropdown still offers the rest.
 */
export function defaultRecipeUnit(ingredient) {
  if (!ingredient?.unit) return '';
  if (ingredient.subUnit && Number(ingredient.subUnitsPerUnit) > 1) return ingredient.subUnit;
  if (ingredient.unit === 'kg' || ingredient.unit === 'quintal') return 'gram';
  if (ingredient.unit === 'litre') return 'ml';
  if (ingredient.unit === 'dozen') return 'piece';
  return ingredient.unit;
}

/**
 * What a recipe means against the shelf right now, for the live summary under the editor.
 *
 * Per line: the amount in the stock unit, how many of the dish that ingredient alone can
 * make, what it costs, and whether its unit converts at all. Overall: plates possible (the
 * scarcest ingredient decides), which ingredient that is, and the ingredient cost per unit.
 */
export function recipePreview(lines, productsById, recipeYield = 1) {
  // The lines may describe a batch ("2 kg tomato makes 25 plates"); everything below is per ONE.
  const perBatch = Number(recipeYield) > 0 ? Number(recipeYield) : 1;
  let servings = Infinity;
  let limiting = null;
  let cost = 0;
  let costKnown = true;
  const rows = lines.map((line) => {
    const ingredient = productsById.get(String(line.product));
    const amount = Number(line.amount);
    if (!ingredient || !(amount > 0)) return { ingredient, ready: false };
    const factor = recipeUnitFactor(line.unit || ingredient.unit, ingredient);
    if (factor == null) return { ingredient, ready: false, badUnit: true };
    const perServing = (amount * factor) / perBatch;
    const stock = Number(ingredient.stock) || 0;
    const canMake = perServing > 0 ? Math.floor(Math.max(0, stock) / perServing + 1e-9) : null;
    if (canMake != null && canMake < servings) {
      servings = canMake;
      limiting = ingredient;
    }
    const unitCost = Number(ingredient.costPrice);
    const lineCost = Number.isFinite(unitCost) && unitCost > 0 ? unitCost * perServing : null;
    if (lineCost == null) costKnown = false;
    else cost += lineCost;
    return { ingredient, ready: true, perServing, stock, canMake, lineCost };
  });
  const anyReady = rows.some((r) => r.ready);
  return {
    rows,
    servings: anyReady && servings !== Infinity ? servings : null,
    limiting,
    cost: anyReady ? cost : null,
    costKnown,
  };
}
