'use client';

import { useState } from 'react';
import { useTheme } from './ThemeProvider';
import { useLanguage } from './LanguageProvider';

/**
 * The scene picker — "what is this app made of", as opposed to ThemePicker's
 * "what colour is it".
 *
 * Saves on click, exactly like ThemePicker and for the same reason: a look that
 * only appears after pressing Save reads as broken, and the whole point is that
 * the dashboard repaints under the shopkeeper's finger. The write is
 * fire-and-forget; a failure leaves the scene applied locally and says so, which
 * is more honest than snapping the app back to the old look.
 *
 * Each option previews itself as a tiny SCREEN rather than as colour chips — a
 * page ground with a rail down the left and a card floating on it. Five swatches
 * of three chips each would be indistinguishable, because what separates these
 * five is not hue: it is whether a card is glass or paper, how hard the edge is,
 * and how much light is in the room. A 96x60 picture of a screen shows that; a
 * row of dots cannot.
 *
 * The preview always renders in the CURRENT mode, so nothing looks different
 * after you pick it.
 */
export default function ScenePicker() {
  const { theme, scene, setScene, scenes } = useTheme();
  const { t } = useLanguage();
  const [error, setError] = useState('');
  const [failedScene, setFailedScene] = useState('');
  const isLight = theme === 'light';

  async function choose(id) {
    if (id === scene && id !== failedScene) return;
    setError('');
    setFailedScene('');
    try {
      await setScene(id);
    } catch {
      setFailedScene(id);
      setError('Look device par lag gaya, lekin shop par save nahi hua. Dobara try karein.');
    }
  }

  return (
    <div className="scene-picker">
      {scenes.map((s) => {
        const p = isLight ? s.preview.light : s.preview.dark;
        const active = s.id === scene;
        return (
          <button
            key={s.id}
            type="button"
            className={`scene-swatch${active ? ' active' : ''}`}
            onClick={() => choose(s.id)}
            aria-pressed={active}
            aria-label={`${t(`seller.scene.${s.id}.label`)} — ${t(`seller.scene.${s.id}.hint`)}`}
          >
            {/* aria-hidden: the whole thing is decorative, and the button already
                carries the scene's name and description in its own label. */}
            <span
              className="scene-shot"
              aria-hidden="true"
              style={{ '--sh-page': p.page, '--sh-wash': p.wash, '--sh-wash2': p.wash2, '--sh-card': p.card, '--sh-rail': p.rail, '--sh-edge': p.edge }}
            >
              <span className="scene-shot-rail" />
              <span className="scene-shot-card" />
              <span className="scene-shot-card is-short" />
            </span>
            <span className="scene-swatch-meta">
              <strong>{t(`seller.scene.${s.id}.label`)}</strong>
              <small>{t(`seller.scene.${s.id}.hint`)}</small>
            </span>
            {active && (
              <svg className="scene-swatch-tick" viewBox="0 0 24 24" aria-hidden="true">
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
        <p className="scene-picker-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
