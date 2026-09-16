'use client';

/**
 * Two-state switch used across the admin control screens. A checkbox rather than a button
 * so keyboard and screen-reader behaviour comes for free; the visual is pure CSS.
 */
export default function Switch({ checked, onChange, disabled, label, id }) {
  return (
    <label className={`switch${disabled ? ' disabled' : ''}`} htmlFor={id} data-tip={label}>
      <input
        id={id}
        type="checkbox"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        aria-label={label}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
    </label>
  );
}

/**
 * Three-state control for a per-shop module override: force on, follow the plan, force
 * off. A plain switch cannot express "no opinion", which is the state that matters most —
 * it is what hands the module back to the plan.
 */
export function TriToggle({ value, onChange, labels, disabled }) {
  const options = [
    { key: 'on', value: true, label: labels?.on || 'On' },
    { key: 'default', value: null, label: labels?.default || 'Default' },
    { key: 'off', value: false, label: labels?.off || 'Off' },
  ];
  return (
    <div className={`tri-toggle${disabled ? ' disabled' : ''}`} role="group">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          disabled={disabled}
          className={value === option.value ? `active ${option.key}` : ''}
          onClick={() => onChange?.(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
