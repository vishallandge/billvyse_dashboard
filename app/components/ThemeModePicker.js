'use client';

import { useTheme } from './ThemeProvider';
import { useLanguage } from './LanguageProvider';

/**
 * Auto / Light / Dark, in the same segmented shape as the motion, density and text
 * size controls so all four read as one set of device preferences.
 *
 * The topbar's sun/moon button stays exactly as it was — it is the fast way to flip
 * mid-shift, and it is where a shopkeeper's hand already goes. This is the setting
 * behind it, and the only place "follow my phone" can be chosen: a two-state button
 * has nowhere to put a third answer.
 */
export default function ThemeModePicker() {
  const { mode, setMode } = useTheme();
  const { t } = useLanguage();

  const options = [
    { id: 'auto', label: t('seller.themeModeAuto'), hint: t('seller.themeModeAutoHint') },
    { id: 'light', label: t('seller.themeModeLight'), hint: t('seller.themeModeLightHint') },
    { id: 'dark', label: t('seller.themeModeDark'), hint: t('seller.themeModeDarkHint') },
  ];

  return (
    <div className="density-picker">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`density-option${mode === o.id ? ' active' : ''}`}
          onClick={() => setMode(o.id)}
          aria-pressed={mode === o.id}
        >
          <strong>{o.label}</strong>
          <small>{o.hint}</small>
        </button>
      ))}
    </div>
  );
}
