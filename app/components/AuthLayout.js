'use client';

import { useLanguage } from './LanguageProvider';
import { LANGUAGES } from '../../lib/i18n/meta';
import AuthShowcase from './AuthShowcase';
import Dropdown from './Dropdown';

/**
 * The frame every signed-out screen sits in — login, signup, forgot and reset.
 *
 * Two halves. The left one (AuthShowcase) says what the product is; the right one is the
 * form and nothing else. The form half deliberately has no card chrome of its own: the
 * pane IS the surface, so there is one border on the screen instead of a card floating
 * inside a page inside a shell.
 *
 * The language picker lives here rather than on the signup page alone, which is where it
 * used to be. A shopkeeper who reads Marathi hits the LOGIN screen far more often than
 * the signup one — that was the single screen in the app they could not read in their
 * own language, and it was the first one they ever saw.
 */
export default function AuthLayout({ variant = 'signin', title, subtitle, children }) {
  const { lang, setLang } = useLanguage();

  return (
    <main className="auth-stage">
      <AuthShowcase variant={variant} />

      <section className="auth-main">
        <div className="auth-panel">
          <div className="auth-panel-head">
            <Dropdown
              className="lang-picker auth-lang"
              value={lang}
              onChange={setLang}
              options={LANGUAGES.map((l) => ({ value: l.code, label: l.native }))}
            />
          </div>

          {title && <h1 className="auth-title">{title}</h1>}
          {subtitle && <p className="auth-sub">{subtitle}</p>}

          {children}
        </div>
      </section>
    </main>
  );
}
