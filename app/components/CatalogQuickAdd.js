'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from './LanguageProvider';
import { formatRupees } from '../../lib/format';
import Modal from './Modal';

/**
 * Puts the items a bill brought in onto the shop's own shelf list, without leaving the
 * purchase form.
 *
 * A scanned bill routinely arrives with lines the shop has never stocked — a new medicine,
 * a brand the wholesaler pushed, the first load of anything. The review screen has always
 * said so ("5 items aren't linked to your catalogue — their stock won't update when the
 * goods arrive") and then offered nothing to do about it. The shopkeeper's only route was
 * to abandon the order, open the products page, type five products by hand off the same
 * bill the app had just read for him, and start again.
 *
 * So this takes what the bill already gave up — name, pack, company, MRP, cost, GST slab,
 * HSN — and makes the products from it. Two things it deliberately does NOT do:
 *
 *   No stock.   Every product is created at zero. The goods on this bill land on the shelf
 *               when the purchase order is received, and seeding the quantity here would
 *               count the same load twice.
 *   No invented selling price. Price is prefilled from the MRP printed on the bill, which
 *               is what a chemist or a kirana actually sells at — but where the bill
 *               printed no MRP the box stays empty and has to be filled in. A product
 *               quietly created at its cost price sells all month at zero margin and
 *               nothing on any screen says why.
 */
export default function CatalogQuickAdd({ lines = [], onClose, onCreated }) {
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState(() =>
    lines.map((line) => ({
      index: line.index,
      include: true,
      name: line.name || '',
      // What the shop will sell it at. The MRP off the bill is the right default for a
      // chemist and a kirana and blank is the right default for everyone else — never the
      // cost price, which would create a product that sells at no margin and says nothing.
      price: line.mrp ? String(line.mrp) : '',
      mrp: line.mrp ? String(line.mrp) : '',
      unit: line.unit || 'piece',
      costPrice: line.costPrice || '',
      gstRate: line.gstRate || 0,
      hsnCode: line.hsnCode || '',
      packLabel: line.packLabel || '',
      company: line.company || '',
      error: '',
    }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [capacity, setCapacity] = useState(null);

  /* Check the shelf before writing. This prevents a five-row bill from creating only the
     first two products and then discovering the plan limit on the third. */
  useEffect(() => {
    let cancelled = false;
    Promise.all([apiFetch('/api/seller/products?limit=1'), apiFetch('/api/seller/plan')])
      .then(([products, planData]) => {
        if (cancelled) return;
        const limit = planData?.catalog?.[planData?.plan]?.maxProducts;
        if (limit == null || !Number.isFinite(Number(limit))) return;
        const upgrade = Object.values(planData?.catalog || {})
          .filter((plan) => plan.maxProducts == null || Number(plan.maxProducts) > Number(limit))
          .sort((a, b) => Number(a.priceMonthly || Infinity) - Number(b.priceMonthly || Infinity))[0];
        setCapacity({
          used: Number(products?.total || 0),
          limit: Number(limit),
          upgrade: upgrade ? { name: upgrade.name, limit: upgrade.maxProducts, price: upgrade.priceMonthly } : null,
        });
      })
      // The server remains authoritative; a failed preflight must not stop a valid save.
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  function updateRow(index, patch) {
    setRows((current) => current.map((row) => (row.index === index ? { ...row, ...patch, error: '' } : row)));
  }

  const chosen = rows.filter((row) => row.include);
  const missingPrice = chosen.filter((row) => !(Number(row.price) > 0));
  const remaining = capacity ? Math.max(0, capacity.limit - capacity.used) : null;
  const overLimit = remaining != null && chosen.length > remaining;
  const canSave = chosen.length > 0 && !overLimit && missingPrice.length === 0 && chosen.every((row) => row.name.trim());

  async function createAll() {
    setSaving(true);
    setError('');
    const created = [];
    const failed = [];
    let hitProductLimit = false;

    // One at a time rather than in parallel: a shop on a counter connection gets a clearer
    // failure this way, and a half-finished batch has to be able to say exactly which rows
    // it got through.
    for (const row of chosen) {
      try {
        const { product } = await apiFetch('/api/seller/products', {
          method: 'POST',
          body: JSON.stringify({
            name: row.name.trim(),
            unit: row.unit,
            price: Number(row.price),
            mrp: row.mrp ? Number(row.mrp) : undefined,
            // Cost prices are stored GST-inclusive throughout this app; the scan has
            // already grossed the bill's rate up where the bill quoted it before tax.
            costPrice: row.costPrice ? Number(row.costPrice) : undefined,
            gstRate: row.gstRate || 0,
            hsnCode: row.hsnCode || undefined,
            // The goods are still on the wholesaler's van. Stock moves when the order is
            // received, not when the product is created.
            stock: 0,
            // Bill items become shelf products first; publishing online is a separate decision.
            showInCatalog: false,
          }),
        });
        created.push({ index: row.index, product });
      } catch (err) {
        if (err?.code === 'PLAN_COUNT_LIMIT_REACHED' || err?.data?.code === 'PLAN_COUNT_LIMIT_REACHED') {
          const limit = Number(err?.limit ?? err?.data?.limit);
          const used = Number(err?.used ?? err?.data?.used);
          if (Number.isFinite(limit) && Number.isFinite(used)) setCapacity((current) => ({ ...current, limit, used }));
          hitProductLimit = true;
          failed.push({ index: row.index, message: t('catalogAdd.limitChanged') });
          break;
        }
        failed.push({ index: row.index, message: err.message });
      }
    }

    setSaving(false);
    if (created.length > 0) onCreated?.(created);
    if (failed.length === 0) {
      onClose?.();
      return;
    }
    // Whatever did not go through stays on screen with its own reason, and the rows that
    // did are dropped so nothing can be created twice.
    setRows((current) =>
      current
        .filter((row) => !created.some((entry) => entry.index === row.index))
        .map((row) => ({ ...row, error: failed.find((entry) => entry.index === row.index)?.message || row.error }))
    );
    setError(hitProductLimit ? t('catalogAdd.limitChanged') : t('catalogAdd.someFailed', { count: failed.length }));
  }

  return (
    <Modal
      onClose={onClose}
      title={t('catalogAdd.title')}
      hint={t('catalogAdd.hint')}
      maxWidth={720}
      footer={
        <>
          <button type="button" className="btn btn-primary btn-inline" disabled={!canSave || saving} onClick={createAll}>
            {saving ? t('common.saving') : t('catalogAdd.create', { count: chosen.length })}
          </button>
          <button type="button" className="btn btn-secondary btn-inline" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
      {error && <div className="error-banner">{error}</div>}

      {capacity && (
        <div className={`catalog-add-capacity${overLimit ? ' is-full' : ''}`} role={overLimit ? 'alert' : undefined}>
          <div>
            <strong>{t(overLimit ? 'catalogAdd.limitTitle' : 'catalogAdd.capacityTitle')}</strong>
            <p>{t('catalogAdd.capacityUsed', { used: capacity.used, limit: capacity.limit })}</p>
            {overLimit ? (
              <p className="catalog-add-capacity-warning">
                {remaining > 0
                  ? t('catalogAdd.selectionTooLarge', { selected: chosen.length, remaining })
                  : t('catalogAdd.noSpace')}
              </p>
            ) : (
              <p>{t('catalogAdd.capacityAvailable', { remaining })}</p>
            )}
          </div>
          {capacity.upgrade && (
            <Link className="btn btn-secondary btn-small btn-inline" href="/seller/plan?feature=maxProducts">
              {t('catalogAdd.upgrade', { plan: capacity.upgrade.name, limit: capacity.upgrade.limit, price: capacity.upgrade.price })}
            </Link>
          )}
        </div>
      )}

      <div className="catalog-add-rows">
        {rows.map((row) => (
          <div className={`catalog-add-row${row.include ? '' : ' off'}`} key={row.index}>
            <label className="catalog-add-pick">
              <input type="checkbox" checked={row.include} onChange={(e) => updateRow(row.index, { include: e.target.checked })} />
            </label>
            <div className="field">
              <label>{t('seller.productName')}</label>
              <input value={row.name} onChange={(e) => updateRow(row.index, { name: e.target.value })} />
              <span className="cell-sub">
                {[row.company, row.packLabel, `${row.gstRate}% GST`, row.hsnCode ? `HSN ${row.hsnCode}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <div className={`field catalog-add-price${row.include && !(Number(row.price) > 0) ? ' has-error' : ''}`}>
              <label>{t('catalogAdd.sellPrice')}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={row.price}
                onChange={(e) => updateRow(row.index, { price: e.target.value })}
                placeholder="0"
              />
              {row.include && !(Number(row.price) > 0) && <span className="field-error-text">{t('catalogAdd.priceNeeded')}</span>}
              {Number(row.price) > 0 && Number(row.costPrice) > 0 && (
                <span className="cell-sub">
                  {t('catalogAdd.marginNote', {
                    cost: formatRupees(Number(row.costPrice), lang),
                    margin: formatRupees(Number(row.price) - Number(row.costPrice), lang),
                  })}
                </span>
              )}
            </div>
            {row.error && <span className="field-error-text catalog-add-error">{row.error}</span>}
          </div>
        ))}
      </div>

      <p className="field-hint">{t('catalogAdd.stockNote')}</p>
    </Modal>
  );
}
