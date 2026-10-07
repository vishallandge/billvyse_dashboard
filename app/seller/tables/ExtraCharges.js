'use client';

import { useState } from 'react';
import { PlusIcon, XIcon } from '../../components/Icons';
import { formatRupees } from '../../../lib/format';
import { extraChargeAmounts } from '../../../lib/tableSplit';

// Mirrors backend utils/tableCharges.js — checked here first so the waiter hears what is
// wrong next to the field, and checked again on the server, which is the one that decides.
const MAX_EXTRA_CHARGES = 6;
const MAX_FLAT_CHARGE = 100000;

// The charges a restaurant actually adds at the table, one tap each. Every one can still be
// renamed, and "Other" is a blank one for anything else.
const PRESETS = [
  { key: 'service', mode: 'percent' },
  { key: 'corkage', mode: 'flat' },
  { key: 'cake', mode: 'flat' },
  { key: 'decoration', mode: 'flat' },
  { key: 'packing', mode: 'flat' },
];

const EMPTY_FORM = { name: '', reason: '', mode: 'flat', value: '' };

/**
 * The table's bill-time extra charges — "Corkage ₹300 · 2 bottles wine", "Service charge
 * 5%" — on the running ticket, each with what it comes to and why, and the form that adds
 * one. Saved on the table (TableOrder.extraCharges), so every device shows the same bill.
 *
 * `lines` is the table's food as [{ item, quantity }], which a % charge is worked on.
 * `onSave(list)` writes the whole list and throws with the server's message on failure.
 */
export default function ExtraCharges({ charges, lines, onSave, disabled, t, lang }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const list = charges || [];
  const atLimit = list.length >= MAX_EXTRA_CHARGES;

  async function save(next) {
    setSaving(true);
    setError('');
    try {
      await onSave(next.map(({ name, mode, value, reason }) => ({ name, mode, value, ...(reason ? { reason } : {}) })));
      return true;
    } catch (err) {
      setError(err?.message || t('tables.extraCharge.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function check(f) {
    const name = f.name.trim();
    const value = Number(f.value);
    if (!name) return t('tables.extraCharge.needName');
    if (String(f.value).trim() === '' || !Number.isFinite(value) || value <= 0) return t('tables.extraCharge.needAmount');
    if (f.mode === 'percent' && value > 100) return t('tables.extraCharge.percentTooHigh');
    if (f.mode === 'flat' && value > MAX_FLAT_CHARGE) return t('tables.extraCharge.amountTooHigh');
    return '';
  }

  async function submit(event) {
    event.preventDefault();
    const problem = check(form);
    if (problem) {
      setError(problem);
      return;
    }
    const added = {
      name: form.name.trim(),
      mode: form.mode,
      value: Math.round(Number(form.value) * 100) / 100,
      reason: form.reason.trim(),
    };
    if (await save([...list, added])) setForm(null);
  }

  function pick(preset) {
    setError('');
    setForm((f) => ({ ...(f || EMPTY_FORM), name: t(`tables.extraCharge.preset.${preset.key}`), mode: preset.mode }));
  }

  return (
    <div className="extra-charges">
      {list.map((charge, index) => {
        // What this one charge comes to on the table's bill, worked exactly as the bill will.
        const amount = extraChargeAmounts([charge], lines)[0]?.amount || 0;
        return (
          <div className="section-charge-row extra-charge-row" key={charge._id || `${charge.name}-${index}`}>
            <span className="extra-charge-row__text">
              <strong>
                {charge.name}
                {charge.mode === 'percent' ? ` (${charge.value}%)` : ''}
              </strong>
              {charge.reason && <small>{t('tables.extraCharge.reasonShown', { reason: charge.reason })}</small>}
            </span>
            <span className="section-charge-row__amount">{formatRupees(amount, lang)}</span>
            <button
              type="button"
              className="icon-btn"
              disabled={disabled || saving}
              onClick={() => save(list.filter((_, i) => i !== index))}
              data-tip={t('tables.extraCharge.remove')}
              aria-label={t('tables.extraCharge.removeNamed', { name: charge.name })}
            >
              <XIcon size={17} />
            </button>
          </div>
        );
      })}

      {form ? (
        <form className="extra-charge-form" onSubmit={submit}>
          <div className="extra-charge-presets" role="group" aria-label={t('tables.extraCharge.quickPick')}>
            {PRESETS.map((preset) => (
              <button key={preset.key} type="button" className="chip-btn" onClick={() => pick(preset)}>
                {t(`tables.extraCharge.preset.${preset.key}`)}
              </button>
            ))}
          </div>
          <div className="extra-charge-fields">
            <input
              type="text"
              value={form.name}
              maxLength={40}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t('tables.extraCharge.namePh')}
              aria-label={t('tables.extraCharge.name')}
            />
            <div className="segmented-mini" role="group" aria-label={t('tables.extraCharge.type')}>
              <button type="button" className={form.mode === 'flat' ? 'active' : ''} onClick={() => setForm((f) => ({ ...f, mode: 'flat' }))}>
                ₹
              </button>
              <button type="button" className={form.mode === 'percent' ? 'active' : ''} onClick={() => setForm((f) => ({ ...f, mode: 'percent' }))}>
                %
              </button>
            </div>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              placeholder={form.mode === 'percent' ? t('tables.extraCharge.percentPh') : t('tables.extraCharge.amountPh')}
              aria-label={t('tables.extraCharge.amount')}
            />
          </div>
          <input
            type="text"
            value={form.reason}
            maxLength={60}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            placeholder={t('tables.extraCharge.reasonPh')}
            aria-label={t('tables.extraCharge.reason')}
          />
          {form.mode === 'percent' && <small className="field-hint">{t('tables.extraCharge.percentHint')}</small>}
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="extra-charge-actions">
            <button type="button" className="btn btn-secondary btn-small btn-inline" onClick={() => { setForm(null); setError(''); }}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary btn-small btn-inline" disabled={disabled || saving}>
              {saving ? t('common.saving') : t('tables.extraCharge.addAction')}
            </button>
          </div>
        </form>
      ) : (
        <>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button
            type="button"
            className="btn btn-secondary btn-small btn-inline extra-charge-add"
            disabled={disabled || saving || atLimit}
            onClick={() => { setForm({ ...EMPTY_FORM }); setError(''); }}
          >
            <PlusIcon size={15} /> {atLimit ? t('tables.extraCharge.limit', { count: MAX_EXTRA_CHARGES }) : t('tables.extraCharge.add')}
          </button>
        </>
      )}
    </div>
  );
}
