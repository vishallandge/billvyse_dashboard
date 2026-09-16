'use client';

import { useState } from 'react';
import { useTheme } from './ThemeProvider';

/**
 * The 10-theme accent picker.
 *
 * Deliberately saves on click rather than on the settings form's Save button. A colour
 * that only appears after Save reads as broken — the whole point is that the dashboard
 * repaints under the shopkeeper's finger. The write is fire-and-forget; if it fails the
 * colour stays applied locally and an inline error explains it hasn't been saved to the
 * shop, which is more honest than snapping the colour back.
 *
 * Each swatch previews its OWN palette in the CURRENT mode, not the active theme's —
 * that is why it reads from the theme data rather than var(--brand). In light mode you
 * see the light ramp, in dark mode the dark one, so nothing looks different after you
 * pick it.
 */
export default function ThemePicker() {
  const { theme, accent, setAccent, themes } = useTheme();
  const [error, setError] = useState('');
  const [failedAccent, setFailedAccent] = useState('');
  const isLight = theme === 'light';

  async function choose(id) {
    if (id === accent && id !== failedAccent) return;
    setError('');
    setFailedAccent('');
    try {
      await setAccent(id);
    } catch {
      setFailedAccent(id);
      setError('Rang device par lag gaya, lekin shop par save nahi hua. Dobara try karein.');
    }
  }

  return (
    <div className="theme-picker">
      {themes.map((t) => {
        const ramp = isLight ? t.dashLight : t.dark;
        const active = t.id === accent;
        return (
          <button
            key={t.id}
            type="button"
            className={`theme-swatch${active ? ' active' : ''}`}
            onClick={() => choose(t.id)}
            aria-pressed={active}
            aria-label={`${t.label} — ${t.hint}`}
            style={{ '--sw-brand': ramp.brand, '--sw-rgb': ramp.rgb }}
          >
            <span className="theme-swatch-tones" aria-hidden="true">
              <span style={{ background: ramp.brand }} />
              <span style={{ background: ramp.brandDark }} />
              <span style={{ background: ramp.brandLight }} />
            </span>
            <span className="theme-swatch-meta">
              <strong>{t.label}</strong>
              <small>{t.hint}</small>
            </span>
            {active && (
              <svg className="theme-swatch-tick" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M20 6 9 17l-5-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        );
      })}
      {error && (
        <p className="theme-picker-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
