'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import { apiFetch } from '../../lib/api';
import { formatQty } from '../../lib/format';
import { useLanguage } from './LanguageProvider';
import { useToast } from './Toast';
import { AlertIcon, CheckIcon } from './Icons';
import { recipeUnitFactor } from '../../lib/recipeUnits';

// Stock units per one unit of the alert ("gram" on a kg item is 0.001). The level is stored
// in the stock unit; it is shown and typed in the unit the owner set it in.
function alertFactor(row) {
  return (row.lowStockUnit && recipeUnitFactor(row.lowStockUnit, row)) || 1;
}
function alertUnit(row) {
  return row.lowStockUnit && recipeUnitFactor(row.lowStockUnit, row) ? row.lowStockUnit : row.unit;
}

/**
 * "Rasoi ka maal" — one screen a hotel owner can read in ten seconds.
 *
 * Each raw item is one card with one coloured word and one sentence:
 *
 *   Paneer                                   [Kam hai]
 *   0.4 kg bacha hai · lagbhag 1 din chalega
 *   Alert: 0.4 kg  (badlo)
 *   Lagta hai: Paneer Butter Masala, Paneer Tikka
 *
 * Usage per day, days left and the suggested alert level are all still worked out (from the
 * bills' own recipe consumption) — they are just said as words, not as four columns. The one
 * button at the top sets every alert to about three days of real use, for owners who do not
 * want to think about levels at all.
 *
 * The second tab is the same data the other way round: how many of each dish can be made now.
 */
export default function KitchenStock({ onClose, onChanged, onOpenProduct }) {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('items');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setError('');
      setData(await apiFetch('/api/seller/products/kitchen-stock?days=30'));
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const unit = (u) => (u ? t(`units.${u}`) : '');
  const qty = (n) => formatQty(n, lang);

  // Items whose alert would ring too late (or never) for how fast they really go. The button
  // only ever RAISES a level — a higher one set on purpose is not second-guessed.
  const needsAlert = useMemo(() => (data?.ingredients || []).filter(wantsHigherAlert), [data]);

  async function saveLevels(levels) {
    if (!levels.length) return;
    setSaving(true);
    try {
      await apiFetch('/api/seller/products/alert-levels', { method: 'PATCH', body: JSON.stringify({ levels }) });
      toast.success(t('kitchenStock.saved', { n: levels.length }));
      setEditing(null);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  function saveOne(row) {
    const typed = Number(draft);
    if (draft === '' || !Number.isFinite(typed) || typed < 0) {
      toast.error(t('recipe.newBadNumber'));
      return;
    }
    // Typed in the alert unit (gram), stored in the stock unit (kg).
    const level = Number((typed * alertFactor(row)).toFixed(6));
    if (level === row.lowStockThreshold) {
      setEditing(null);
      return;
    }
    saveLevels([{ id: row.id, level }]);
  }

  // The one sentence under each item's name.
  function lifeLine(row) {
    const left = t('kitchenStock.left', { qty: qty(Math.max(0, row.stock)), unit: unit(row.unit) });
    if (row.stock <= 0) return left;
    if (row.daysLeft == null) return `${left} · ${t('kitchenStock.notUsedYet')}`;
    if (row.daysLeft < 1) return `${left} · ${t('kitchenStock.lessThanDay')}`;
    return `${left} · ${t('kitchenStock.lastsDays', { n: qty(Math.floor(row.daysLeft)) })}`;
  }

  const summary = data?.summary;
  const trouble = summary ? summary.out + summary.low : 0;

  return (
    <Modal onClose={onClose} title={t('kitchenStock.title')} hint={t('kitchenStock.hint')} maxWidth={760}>
      <div className="kitchen-stock">
        {error && <p className="form-error">{error}</p>}
        {!data && !error && <p className="cell-muted">{t('common.loading')}</p>}

        {/* Empty: the whole setup in three steps. */}
        {data && data.ingredients.length === 0 && (
          <div className="kitchen-empty">
            <p>{t('kitchenStock.empty')}</p>
            <ol className="kitchen-guide">
              <li>{t('kitchenStock.guide1')}</li>
              <li>{t('kitchenStock.guide2')}</li>
              <li>{t('kitchenStock.guide3')}</li>
            </ol>
          </div>
        )}

        {data && data.ingredients.length > 0 && (
          <>
            {/* One sentence instead of four number tiles. */}
            <p className={`kitchen-headline${trouble ? ' is-bad' : ' is-good'}`}>
              {trouble ? <AlertIcon size={16} /> : <CheckIcon size={16} />}
              {trouble
                ? t('kitchenStock.headlineBad', { out: qty(summary.out), low: qty(summary.low) })
                : t('kitchenStock.headlineGood')}
            </p>

            {needsAlert.length > 0 && (
              <div className="kitchen-autoalert">
                <span>{t('kitchenStock.autoAlertHint', { n: qty(needsAlert.length) })}</span>
                <button
                  type="button"
                  className="btn btn-primary btn-small btn-inline"
                  disabled={saving}
                  onClick={() => saveLevels(needsAlert.map((r) => ({ id: r.id, level: r.suggestedThreshold })))}
                >
                  {t('kitchenStock.autoAlert')}
                </button>
              </div>
            )}

            <div className="kitchen-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'items'}
                className={`kitchen-tab${tab === 'items' ? ' active' : ''}`}
                onClick={() => setTab('items')}
              >
                {t('kitchenStock.tabIngredients', { n: qty(summary.ingredients) })}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'dishes'}
                className={`kitchen-tab${tab === 'dishes' ? ' active' : ''}`}
                onClick={() => setTab('dishes')}
              >
                {t('kitchenStock.tabDishes', { n: qty(summary.dishes) })}
              </button>
            </div>

            {tab === 'items' && (
              <div className="kitchen-list">
                {data.ingredients.map((row) => (
                  <div className={`kitchen-row is-${row.status}`} key={row.id}>
                    <div className="kitchen-row-head">
                      <button type="button" className="kitchen-name" onClick={() => onOpenProduct?.(row.id)}>
                        {row.name}
                      </button>
                      <span className={`badge ${STATUS_BADGE[row.status]}`}>{t(`kitchenStock.status.${row.status}`)}</span>
                    </div>

                    <p className="kitchen-line">{lifeLine(row)}</p>

                    {/* Below zero is never "very out of stock": it is stock that came in and
                        was not entered. Said in those words, with what to do. */}
                    {row.stock < 0 && (
                      <p className="recipe-line-note is-out">
                        <AlertIcon size={13} /> <span>{t('kitchenStock.negativeHint', { name: row.name })}</span>
                      </p>
                    )}

                    <div className="kitchen-alert-line">
                      {editing === row.id ? (
                        <>
                          <span>{t('kitchenStock.alertAt')}</span>
                          <div className="field-affix kitchen-alert-input">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              inputMode="decimal"
                              aria-label={t('kitchenStock.alertAt')}
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  saveOne(row);
                                }
                              }}
                              autoFocus
                            />
                            <span className="affix trail">{unit(alertUnit(row))}</span>
                          </div>
                          <button type="button" className="btn btn-primary btn-small btn-inline" disabled={saving} onClick={() => saveOne(row)}>
                            {t('common.save')}
                          </button>
                          <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => setEditing(null)}>
                            {t('common.cancel')}
                          </button>
                        </>
                      ) : (
                        <>
                          <span>
                            {row.lowStockThreshold > 0
                              ? t('kitchenStock.alertWhen', { qty: qty(row.lowStockThreshold / alertFactor(row)), unit: unit(alertUnit(row)) })
                              : t('kitchenStock.noAlert')}
                          </span>
                          <button
                            type="button"
                            className="link-quiet kitchen-change"
                            onClick={() => {
                              setEditing(row.id);
                              setDraft(row.lowStockThreshold ? String(Number((row.lowStockThreshold / alertFactor(row)).toFixed(3))) : '');
                            }}
                          >
                            {t('kitchenStock.change')}
                          </button>
                        </>
                      )}
                    </div>

                    {row.dishes.length > 0 && (
                      <p className="kitchen-used-in">
                        {t('kitchenStock.usedIn', { names: row.dishes.map((d) => d.name).join(', ') })}
                      </p>
                    )}
                  </div>
                ))}
                <p className="cell-muted kitchen-foot">{t('kitchenStock.periodNote', { days: data.days })}</p>
              </div>
            )}

            {tab === 'dishes' && (
              <div className="kitchen-list">
                {data.dishes.map((dish) => {
                  const none = dish.servingsPossible === 0;
                  return (
                    <div className={`kitchen-row${none || dish.missingIngredients ? ' is-out' : ' is-ok'}`} key={dish.id}>
                      <div className="kitchen-row-head">
                        <button type="button" className="kitchen-name" onClick={() => onOpenProduct?.(dish.id)}>
                          {dish.name}
                        </button>
                        <strong className="kitchen-dish-count">
                          {dish.servingsPossible == null
                            ? '—'
                            : none
                              ? t('recipe.dishCantMake')
                              : t('kitchenStock.dishCanMake', {
                                  n: qty(dish.servingsPossible),
                                  unit: unit(dish.unit),
                                })}
                        </strong>
                      </div>
                      {dish.limitingIngredient && (
                        <p className="kitchen-line">
                          {none
                            ? t('recipe.dishOutBecause', { name: dish.limitingIngredient.name })
                            : t('recipe.summaryLimit', { name: dish.limitingIngredient.name })}
                        </p>
                      )}
                      {dish.missingIngredients > 0 && (
                        <p className="recipe-line-note is-out">
                          <AlertIcon size={13} /> <span>{t('kitchenStock.dishMissing', { n: qty(dish.missingIngredients) })}</span>
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function wantsHigherAlert(row) {
  return row.suggestedThreshold != null && row.suggestedThreshold > (Number(row.lowStockThreshold) || 0);
}

const STATUS_BADGE = {
  out: 'badge-expired',
  low: 'badge-pending',
  noAlert: 'badge-inactive',
  ok: 'badge-active',
};
