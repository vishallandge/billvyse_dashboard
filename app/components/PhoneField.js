'use client';

import { useId } from 'react';
import { useLanguage } from './LanguageProvider';
import Dropdown from './Dropdown';
import IndiaFlag from './IndiaFlag';
import { COUNTRIES, DEFAULT_COUNTRY, dialCode, nationalLength } from '../../lib/countryCodes';

/**
 * Every phone number typed anywhere in this app.
 *
 * ONE BOX, ONE SHAPE. Before this there were two dozen bare `<input>`s, each with its own
 * copy of `.replace(/\D/g, '').slice(0, 10)`, none of which said anywhere on screen that a
 * ten-digit Indian number was what it wanted. A shopkeeper typing `+91 98765 43210` — which
 * is how the number is written on their own visiting card — had the `91` silently eaten and
 * was left with `919876543210` truncated to `9198765432`: a wrong number, saved without a
 * word. The prefix now says out loud what the box is assuming.
 *
 * WHY THE COUNTRY IS LOCKED. `countryLocked` defaults to true and every caller today leaves
 * it that way. This is an Indian product: the GST work, the DLT-registered SMS templates,
 * the UPI intent and the khata's own de-duplication key (backend/utils/phone.js) all assume
 * a 10-digit Indian mobile. A shopkeeper who can nudge that picker to +1 gets an OTP that
 * never arrives and a bill printed with a number nobody can dial, and would have no idea
 * why. The whole world is still in lib/countryCodes.js so that opening it up later is one
 * prop, not a data-gathering exercise.
 *
 * WHY THE ERROR SITS UNDER THE BOX. A refusal shown only in a banner at the top of a form
 * makes the reader hunt for which of six fields it meant. `error` renders directly beneath
 * this input, in the same red the rest of the app uses, and marks the input `aria-invalid`
 * so a screen reader says it too.
 *
 * Renders exactly one element, per the shared-component rule — never a fragment.
 */
export default function PhoneField({
  id,
  label,
  value,
  onChange,
  error = '',
  hint,
  required = false,
  disabled = false,
  autoFocus = false,
  placeholder,
  countryValue = DEFAULT_COUNTRY,
  onCountryChange,
  countryLocked = true,
  /**
   * Which form idiom this box is standing in.
   *
   * 'field' — the seller forms: label above the box. 'auth' — the login/signup cards and
   * the shop-identity wall, where the label starts inside the box and floats up once there
   * is a value (AuthField.js). The two look completely different, and a phone box that
   * picks the wrong one is the one ragged field on an otherwise even card.
   */
  variant = 'field',
  className = '',
  /* Lands on the root, not on the input: a caller sizing this inside a flex row is sizing
     the whole field. Everything else in ...rest still goes to the input. */
  style,
  inputRef,
  ...rest
}) {
  const { t } = useLanguage();
  const fallbackId = useId();
  const fieldId = id || fallbackId;
  const max = nationalLength(countryValue);

  /**
   * What survives typing.
   *
   * Digits only — a shopkeeper pasting "+91 98765 43210" or "098765 43210" from a contact
   * card should end up with the same ten digits either way, so the country code and the old
   * STD zero are stripped off the FRONT rather than the number being cut off at the end.
   * That truncation was the actual bug: slice(0, 10) on "919876543210" keeps "9198765432".
   */
  function handle(event) {
    let digits = String(event.target.value || '').replace(/\D/g, '');
    if (countryValue === DEFAULT_COUNTRY) {
      digits = digits.replace(/^(0091|91|0)(?=\d{6,})/, '');
    }
    onChange(digits.slice(0, max));
  }

  const auth = variant === 'auth';

  return (
    <div
      className={`${auth ? 'auth-field' : 'field'} phone-field${auth ? ' is-auth' : ''}${
        error ? ' has-error' : ''
      }${className ? ` ${className}` : ''}`}
      style={style}
    >
      {label && !auth && (
        <label htmlFor={fieldId}>
          {label}
          {required ? ' *' : ''}
        </label>
      )}

      <div className={`phone-row${disabled ? ' is-disabled' : ''}`}>
        {countryLocked ? (
          /* Not a disabled <select> and not a button: a control that looks operable and
             refuses every tap is worse than a label. This is a label — it states the
             assumption the box is making and nothing about it invites a click. */
          <span className="phone-prefix">
            <IndiaFlag size={18} />
            <b>{dialCode(countryValue)}</b>
          </span>
        ) : (
          <Dropdown
            className="phone-country"
            value={countryValue}
            onChange={onCountryChange}
            searchable
            searchPlaceholder={t('phone.searchCountry')}
            disabled={disabled}
            options={COUNTRIES.map((c) => ({ value: c.iso2, label: `${c.name} +${c.dial}` }))}
          />
        )}

        {/* The input and its floating label share a box so the label can be positioned
            against the input alone — the prefix to its left must not shift it. */}
        <div className="phone-input-box">
          <input
            {...rest}
            ref={inputRef}
            id={fieldId}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            className="phone-input"
            value={value || ''}
            onChange={handle}
            disabled={disabled}
            required={required}
            autoFocus={autoFocus}
            maxLength={max}
            /* A single space in the auth variant, not the hint: `:placeholder-shown` is
               what tells the floating label whether to sit in the box or above it, and a
               real placeholder would keep it floated forever. */
            placeholder={auth ? ' ' : placeholder || t('phone.placeholder')}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? `${fieldId}-err` : undefined}
          />
          {auth && label && (
            <label htmlFor={fieldId} className="phone-float-label">
              {label}
              {required ? ' *' : ''}
            </label>
          )}
        </div>
      </div>

      {error ? (
        <span id={`${fieldId}-err`} className="field-error-text" role="alert">{error}</span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </div>
  );
}
