'use client';

import { useId, useState } from 'react';
import { useLanguage } from './LanguageProvider';
import { EyeIcon, EyeOffIcon, AlertIcon } from './Icons';

/**
 * How strong a password is, in the only three buckets worth showing somebody.
 *
 * Deliberately crude — length first, then variety. A five-bar entropy estimate on a
 * signup form is a thing developers enjoy and nobody else reads; three states answer the
 * only question being asked, which is "is this good enough to not lose my shop over".
 */
function strengthOf(value) {
  if (!value) return 0;
  let score = 0;
  if (value.length >= 6) score += 1;
  if (value.length >= 10) score += 1;
  if (/[^a-zA-Z]/.test(value) && /[a-zA-Z]/.test(value)) score += 1;
  return Math.min(score, 3);
}

/**
 * One field on an auth screen.
 *
 * The label sits inside the box and floats up on focus. That is not decoration: it halves
 * the vertical space a four-field form needs, and it keeps the label visible after typing
 * — which a placeholder-only field (the pattern this replaces on half the web) does not.
 *
 * Three things here exist because of how this app is actually used:
 *
 *  - the password eye, because a shopkeeper types this on a phone under a shop tubelight
 *    with one thumb and gets it wrong;
 *  - the Caps Lock warning, because "password rejected" with no reason is the single most
 *    common way somebody decides the app is broken;
 *  - font-size at --fs-md (16px), which is the floor iOS needs or Safari zooms the page
 *    on focus and the layout jumps.
 */
export default function AuthField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  icon,
  hint,
  /**
   * A refusal about THIS box, shown under it.
   *
   * Auth screens used to put every message in one banner above the form. With four fields
   * that turns "check your email address" into a hunt, and on the shop-identity wall — four
   * boxes, all required — it was the difference between fixing one field and re-reading all
   * of them. The banner stays for what the server says about the request as a whole.
   */
  error = '',
  strength = false,
  ...rest
}) {
  const { t } = useLanguage();
  const fallbackId = useId();
  const fieldId = id || fallbackId;
  const [revealed, setRevealed] = useState(false);
  const [caps, setCaps] = useState(false);

  const isPassword = type === 'password';
  const inputType = isPassword && revealed ? 'text' : type;
  const level = strength ? strengthOf(value) : 0;
  const levelLabel = [t('auth.weak'), t('auth.weak'), t('auth.okay'), t('auth.strong')][level];

  function trackCaps(event) {
    if (!isPassword || typeof event.getModifierState !== 'function') return;
    setCaps(event.getModifierState('CapsLock'));
  }

  return (
    <div className={`auth-field${isPassword ? ' has-toggle' : ''}${error ? ' has-error' : ''}`}>
      <div className={`auth-input-wrap${icon ? ' has-icon' : ''}`}>
        {icon && <span className="auth-input-icon" aria-hidden="true">{icon}</span>}
        <input
          {...rest}
          id={fieldId}
          type={inputType}
          className="auth-input"
          value={value}
          onChange={onChange}
          onKeyUp={trackCaps}
          onKeyDown={trackCaps}
          onBlur={() => setCaps(false)}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${fieldId}-err` : undefined}
          /* A single space, not empty: :placeholder-shown is what tells the label
             whether to sit in the box or float above it. */
          placeholder=" "
        />
        <label htmlFor={fieldId} className="auth-input-label">{label}</label>
        {isPassword && (
          <button
            type="button"
            className="auth-eye"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? t('auth.hidePassword') : t('auth.showPassword')}
            aria-pressed={revealed}
            tabIndex={-1}
          >
            {revealed ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
          </button>
        )}
      </div>

      {caps && (
        <p className="auth-caps"><AlertIcon size={13} />{t('auth.capsLock')}</p>
      )}

      {strength && value ? (
        <p className={`auth-strength lvl-${level}`}>
          <span className="auth-strength-bars" aria-hidden="true"><i /><i /><i /></span>
          {t('auth.passwordStrength', { level: levelLabel })}
        </p>
      ) : null}

      {error ? (
        <span id={`${fieldId}-err`} className="field-error-text" role="alert">{error}</span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </div>
  );
}
