'use client';

import { useTextSize } from './TextSizeProvider';
import { useLanguage } from './LanguageProvider';

/**
 * Normal / Big / Biggest, in the same segmented shape as MotionPicker and
 * DensityPicker so the three read as one set of device preferences.
 *
 * Each option is rendered AT the size it applies. A label that says "Big" in the same
 * type as everything else is asking the shopkeeper to imagine the result; showing it
 * means the choice is made by looking, which is the only way someone picks the right
 * one for their own eyes on the first try.
 */
export default function TextSizePicker() {
  const { textSize, setTextSize } = useTextSize();
  const { t } = useLanguage();

  const options = [
    { id: 'normal', label: t('seller.textSizeNormal'), hint: t('seller.textSizeNormalHint'), preview: '1em' },
    { id: 'large', label: t('seller.textSizeLarge'), hint: t('seller.textSizeLargeHint'), preview: '1.08em' },
    { id: 'xlarge', label: t('seller.textSizeXLarge'), hint: t('seller.textSizeXLargeHint'), preview: '1.18em' },
  ];

  return (
    <div className="density-picker">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`density-option${textSize === o.id ? ' active' : ''}`}
          onClick={() => setTextSize(o.id)}
          aria-pressed={textSize === o.id}
        >
          <strong style={{ fontSize: o.preview }}>{o.label}</strong>
          <small>{o.hint}</small>
        </button>
      ))}
    </div>
  );
}
