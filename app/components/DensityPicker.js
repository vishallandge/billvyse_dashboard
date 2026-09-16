'use client';

import { useDensity } from './DensityProvider';
import { useLanguage } from './LanguageProvider';

/**
 * Auto / Roomy / Compact, as a segmented control — the same shape as MotionPicker so the
 * two sit together in Settings as one pair of device preferences.
 *
 * Applies instantly and only to this device, so there is nothing to save to the server
 * and no failure state to report. Each option carries a one-line description because
 * "Compact" on its own does not tell a shopkeeper what changes.
 */
export default function DensityPicker() {
  const { density, setDensity } = useDensity();
  const { t } = useLanguage();

  const options = [
    { id: 'auto', label: t('seller.densityAuto'), hint: t('seller.densityAutoHint') },
    { id: 'comfortable', label: t('seller.densityRoomy'), hint: t('seller.densityRoomyHint') },
    { id: 'compact', label: t('seller.densityCompact'), hint: t('seller.densityCompactHint') },
    { id: 'small', label: t('seller.densitySmall'), hint: t('seller.densitySmallHint') },
  ];

  return (
    <div className="density-picker">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`density-option${density === o.id ? ' active' : ''}`}
          onClick={() => setDensity(o.id)}
          aria-pressed={density === o.id}
        >
          <strong>{o.label}</strong>
          <small>{o.hint}</small>
        </button>
      ))}
    </div>
  );
}
