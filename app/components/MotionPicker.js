'use client';

import { useMotion } from './MotionProvider';
import { useLanguage } from './LanguageProvider';

/**
 * Full / Less / Off, as a segmented control.
 *
 * Applies instantly and only to this device — there is nothing to save to the server, so
 * there is no failure state to report. Each option carries a one-line description because
 * "Less" on its own tells a shopkeeper nothing about what they are giving up.
 */
export default function MotionPicker() {
  const { motion, setMotion } = useMotion();
  const { t } = useLanguage();

  const options = [
    { id: 'full', label: t('seller.motionFull'), hint: t('seller.motionFullHint') },
    { id: 'reduced', label: t('seller.motionReduced'), hint: t('seller.motionReducedHint') },
    { id: 'off', label: t('seller.motionOff'), hint: t('seller.motionOffHint') },
  ];

  return (
    <div className="motion-picker">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`motion-option${motion === o.id ? ' active' : ''}`}
          onClick={() => setMotion(o.id)}
          aria-pressed={motion === o.id}
        >
          <strong>{o.label}</strong>
          <small>{o.hint}</small>
        </button>
      ))}
    </div>
  );
}
