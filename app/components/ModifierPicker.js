'use client';

import { useState } from 'react';
import { useLanguage } from './LanguageProvider';
import { formatRupees } from '../../lib/format';
import { CheckIcon, PlusIcon } from './Icons';
import Modal from './Modal';

// The one modal both the billing POS and the Tables cart open when a tapped product
// carries `modifierGroups` — size, spice level, add-ons. Confirming hands back exactly
// the shape the server expects: `[{ groupId, optionIds: [] }]`, naming the product's own
// subdocument ids so neither caller has to know how a group or option is priced. See
// backend/utils/modifiers.js, the only place that price is ever trusted from.
export default function ModifierPicker({ product, onConfirm, onCancel }) {
  const { t } = useLanguage();
  const [selections, setSelections] = useState({}); // groupId -> optionId[]

  const groups = product.modifierGroups || [];

  function toggleOption(group, option) {
    setSelections((prev) => {
      const current = prev[group._id] || [];
      if (group.multiple) {
        const has = current.includes(option._id);
        return { ...prev, [group._id]: has ? current.filter((id) => id !== option._id) : [...current, option._id] };
      }
      // Single-select: picking a second option in the same group replaces the first,
      // rather than the group silently becoming multi-select.
      return { ...prev, [group._id]: [option._id] };
    });
  }

  const missingRequired = groups.filter((g) => g.required && !(selections[g._id]?.length > 0));

  function confirm() {
    if (missingRequired.length > 0) return;
    const modifiers = groups
      .filter((g) => (selections[g._id] || []).length > 0)
      .map((g) => ({ groupId: g._id, optionIds: selections[g._id] }));
    onConfirm(modifiers);
  }

  return (
    <Modal
      className="modifier-picker-card"
      onClose={onCancel}
      title={product.name}
      footer={
        <button
          type="button"
          className="btn btn-primary btn-inline modifier-picker-confirm"
          disabled={missingRequired.length > 0}
          onClick={confirm}
        >
          <PlusIcon size={17} />
          {t('common.add')}
        </button>
      }
    >

        {groups.map((group) => (
          <div className="modifier-picker-group" key={group._id}>
            <div className="modifier-picker-group-head">
              <strong>{group.name}</strong>
              {group.required && <span className="badge badge-pending">{t('seller.modifierRequired')}</span>}
            </div>
            <div className="modifier-picker-options">
              {group.options.map((option) => {
                const active = (selections[group._id] || []).includes(option._id);
                return (
                  <button
                    key={option._id}
                    type="button"
                    className={`modifier-picker-option ${active ? 'active' : ''}`}
                    onClick={() => toggleOption(group, option)}
                  >
                    {active && <CheckIcon size={13} />}
                    <span>{option.name}</span>
                    {option.priceDelta > 0 && <span className="modifier-picker-option-price">+{formatRupees(option.priceDelta)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

    </Modal>
  );
}
