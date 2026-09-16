'use client';

import { useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { useToast } from './Toast';
import Dropdown from './Dropdown';
import { PlusIcon, TrashIcon } from './Icons';
import Modal from './Modal';
import { gstRateOptions, unitOptions } from '../../lib/catalog';
import { businessType as businessTypeConfig } from '../../lib/businessTypes';

// A garments shop adding one shirt is really adding twelve rows. Typing the ordinary
// product form twelve times is how a shop decides the app isn't worth it — so the seller
// describes the shirt once, lists what varies ("Size: S, M, L, XL"), and gets an editable
// grid of every combination to correct price and opening stock on before saving.
//
// Each row becomes a full product of its own (see the comment on Product.variantGroup):
// nothing here invents a new kind of stock, it only saves the typing.

const MAX_ATTRIBUTES = 3;
const MAX_ROWS = 60;

// "S, M, L" and "S/M/L" and a stray trailing comma all mean the same thing to a
// shopkeeper, so accept all of them rather than making them learn a separator.
function parseValues(raw) {
  return [...new Set(
    String(raw || '')
      .split(/[,/|\n]/)
      .map((v) => v.trim())
      .filter(Boolean)
  )];
}

// Every combination of every attribute, in a stable order the seller can scan: the last
// attribute varies fastest, the way a size-by-colour grid reads on paper.
function buildCombinations(attributes) {
  const usable = attributes.filter((a) => a.name.trim() && parseValues(a.values).length > 0);
  if (usable.length === 0) return [];

  let rows = [[]];
  for (const attribute of usable) {
    const next = [];
    for (const row of rows) {
      for (const value of parseValues(attribute.values)) {
        next.push([...row, { name: attribute.name.trim(), value }]);
      }
    }
    rows = next;
    if (rows.length > MAX_ROWS) return rows.slice(0, MAX_ROWS + 1);
  }
  return rows;
}

function comboKey(combo) {
  return combo.map((a) => `${a.name}=${a.value}`).join('|');
}

export default function VariantBuilder({ open, onClose, onCreated, businessType, categories = [] }) {
  const { t } = useLanguage();
  const toast = useToast();

  const [group, setGroup] = useState('');
  const [base, setBase] = useState({
    unit: 'piece',
    price: '',
    costPrice: '',
    gstRate: '0',
    category: '',
    hsnCode: '',
    lowStockThreshold: '5',
  });
  const [attributes, setAttributes] = useState([
    { name: 'Size', values: '' },
    { name: 'Colour', values: '' },
  ]);
  // Per-row corrections, keyed by combination rather than index — editing an attribute
  // above reorders the grid, and a shopkeeper's typed price should follow its own row
  // instead of jumping to whichever variant now sits in that position.
  const [overrides, setOverrides] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const combinations = useMemo(() => buildCombinations(attributes), [attributes]);
  const tooMany = combinations.length > MAX_ROWS;

  // Same trade-first unit ordering the ordinary product form uses, so "metre" sits at the
  // top for a hardware shop here too.
  const unitGroups = useMemo(
    () => unitOptions(t, businessTypeConfig(businessType).preferredUnits).map((g) => ({ label: g.label, options: g.units })),
    [t, businessType]
  );

  function updateBase(field) {
    return (e) => setBase((b) => ({ ...b, [field]: e.target.value }));
  }

  function updateAttribute(index, field, value) {
    setAttributes((list) => list.map((a, i) => (i === index ? { ...a, [field]: value } : a)));
  }

  function updateOverride(key, field, value) {
    setOverrides((o) => ({ ...o, [key]: { ...o[key], [field]: value } }));
  }

  function reset() {
    setGroup('');
    setAttributes([{ name: 'Size', values: '' }, { name: 'Colour', values: '' }]);
    setOverrides({});
    setError('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!group.trim()) {
      setError(t('seller.variantGroupRequired'));
      return;
    }
    if (combinations.length === 0) {
      setError(t('seller.variantNeedValues'));
      return;
    }
    if (tooMany) {
      setError(t('seller.variantTooMany', { max: MAX_ROWS }));
      return;
    }
    if (!base.price && combinations.some((c) => !overrides[comboKey(c)]?.price)) {
      setError(t('seller.variantPriceRequired'));
      return;
    }

    setSaving(true);
    try {
      const data = await apiFetch('/api/seller/products/variants', {
        method: 'POST',
        body: JSON.stringify({
          group: group.trim(),
          base: {
            unit: base.unit,
            price: base.price === '' ? undefined : Number(base.price),
            costPrice: base.costPrice === '' ? undefined : Number(base.costPrice),
            gstRate: Number(base.gstRate) || 0,
            category: base.category || undefined,
            hsnCode: base.hsnCode || undefined,
            lowStockThreshold: base.lowStockThreshold === '' ? undefined : Number(base.lowStockThreshold),
          },
          variants: combinations.map((combo) => {
            const row = overrides[comboKey(combo)] || {};
            return {
              attributes: combo,
              price: row.price === '' || row.price === undefined ? undefined : Number(row.price),
              costPrice: row.costPrice === '' || row.costPrice === undefined ? undefined : Number(row.costPrice),
              stock: Number(row.stock) || 0,
              barcode: row.barcode || undefined,
            };
          }),
        }),
      });
      toast.success(t('seller.variantsCreated', { count: data.products.length, group: data.group }));
      reset();
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <Modal
      as="form"
      onSubmit={handleSubmit}
      onClose={onClose}
      title={t('seller.addVariants')}
      hint={t('seller.addVariantsHint')}
      maxWidth={860}
      footer={
        <>
          <button type="submit" className="btn btn-primary btn-inline" disabled={saving || combinations.length === 0 || tooMany}>
            {saving ? t('common.saving') : t('seller.createVariants', { count: combinations.length })}
          </button>
          <button type="button" className="btn btn-secondary btn-inline" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </>
      }
    >

        {error && <div className="error-banner">{error}</div>}

          <div className="field">
            <label htmlFor="variantGroup">{t('seller.variantGroupName')}</label>
            <input
              id="variantGroup"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder={t('seller.variantGroupPlaceholder')}
              autoFocus
            />
            <p className="field-hint">{t('seller.variantGroupHint')}</p>
          </div>

          <div className="form-grid">
            <div className="field">
              <label>{t('seller.unit')}</label>
              <Dropdown
                value={base.unit}
                onChange={(v) => setBase((b) => ({ ...b, unit: v }))}
                groups={unitGroups}
              />
            </div>
            <div className="field">
              <label>{t('seller.price')}</label>
              <input type="number" min="0" step="0.01" value={base.price} onChange={updateBase('price')} placeholder="0" />
              <p className="field-hint">{t('seller.variantDefaultPriceHint')}</p>
            </div>
            <div className="field">
              <label>{t('seller.costPrice')}</label>
              <input type="number" min="0" step="0.01" value={base.costPrice} onChange={updateBase('costPrice')} placeholder="0" />
            </div>
            <div className="field">
              <label>{t('seller.gstRate')}</label>
              <Dropdown
                value={base.gstRate}
                onChange={(v) => setBase((b) => ({ ...b, gstRate: v }))}
                options={gstRateOptions(base.gstRate)}
              />
            </div>
            <div className="field">
              <label>{t('seller.category')}</label>
              <input value={base.category} onChange={updateBase('category')} list="variant-categories" />
              <datalist id="variant-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label>{t('seller.lowStockThreshold')}</label>
              <input type="number" min="0" value={base.lowStockThreshold} onChange={updateBase('lowStockThreshold')} />
            </div>
          </div>

          <div className="field" style={{ marginTop: '0.8rem' }}>
            <label>{t('seller.whatVaries')}</label>
            <p className="field-hint">{t('seller.whatVariesHint')}</p>
            {attributes.map((attribute, index) => (
              <div key={index} className="row-actions" style={{ marginBottom: '0.4rem', alignItems: 'center' }}>
                <input
                  value={attribute.name}
                  onChange={(e) => updateAttribute(index, 'name', e.target.value)}
                  placeholder={t('seller.attributeNamePlaceholder')}
                  style={{ flex: '0 0 30%' }}
                />
                <input
                  value={attribute.values}
                  onChange={(e) => updateAttribute(index, 'values', e.target.value)}
                  placeholder={t('seller.attributeValuesPlaceholder')}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="icon-btn danger"
                  data-tip={t('common.delete')}
                  onClick={() => setAttributes((list) => list.filter((_, i) => i !== index))}
                >
                  <TrashIcon size={17} />
                </button>
              </div>
            ))}
            {attributes.length < MAX_ATTRIBUTES && (
              <button
                type="button"
                className="btn btn-secondary btn-small btn-inline"
                onClick={() => setAttributes((list) => [...list, { name: '', values: '' }])}
              >
                <PlusIcon size={15} />
                {t('seller.addAttribute')}
              </button>
            )}
          </div>

          {combinations.length > 0 && (
            <div className="field" style={{ marginTop: '0.8rem' }}>
              <label>
                {t('seller.variantPreview')} ({combinations.length})
              </label>
              {tooMany ? (
                <p className="field-hint">{t('seller.variantTooMany', { max: MAX_ROWS })}</p>
              ) : (
                <>
                  <p className="field-hint">{t('seller.variantPreviewHint')}</p>
                  <div className="table-wrap auto-height" style={{ maxHeight: '320px' }}>
                    <table className="data-table" style={{ minWidth: '560px' }}>
                      <thead>
                        <tr>
                          <th>{t('seller.variant')}</th>
                          <th style={{ textAlign: 'right' }}>{t('seller.price')}</th>
                          <th style={{ textAlign: 'right' }}>{t('seller.openingStock')}</th>
                          <th>{t('seller.barcode')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {combinations.map((combo) => {
                          const key = comboKey(combo);
                          const row = overrides[key] || {};
                          return (
                            <tr key={key}>
                              <td className="cell-strong">{combo.map((a) => a.value).join(' / ')}</td>
                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={row.price ?? ''}
                                  onChange={(e) => updateOverride(key, 'price', e.target.value)}
                                  placeholder={base.price || '0'}
                                  style={{ textAlign: 'right' }}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.001"
                                  value={row.stock ?? ''}
                                  onChange={(e) => updateOverride(key, 'stock', e.target.value)}
                                  placeholder="0"
                                  style={{ textAlign: 'right' }}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.barcode ?? ''}
                                  onChange={(e) => updateOverride(key, 'barcode', e.target.value)}
                                  placeholder={t('seller.optional')}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

    </Modal>
  );
}
