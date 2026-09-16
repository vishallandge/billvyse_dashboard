'use client';

/**
 * "Pick any number of these."
 *
 * Plans, trades, features, languages, weekdays, billing cycles — six different questions
 * with one shape, so an operator learns the control once. It lived inside the campaign
 * editor until the discount-code form needed the same thing for plans and cycles; a second
 * copy would have been a second place for the note below to go missing.
 *
 * Renders exactly one element. `empty` is the whole reason this is shared: an empty
 * selection means EVERYONE, not nobody, and that is the single most misread rule in the
 * growth screens. Saying it out loud, in every place the rule applies, is cheaper than
 * explaining a campaign that saved cleanly and reached zero shops.
 */
export default function ChipSelect({ options, value, onChange, empty, disabled = false }) {
  const selected = new Set(value || []);

  function toggle(key) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange([...next]);
  }

  return (
    <div className="chip-select">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          className={`chip-toggle${selected.has(option.value) ? ' on' : ''}`}
          onClick={() => toggle(option.value)}
        >
          {option.label}
        </button>
      ))}
      {selected.size === 0 && empty && <span className="chip-select-note">{empty}</span>}
    </div>
  );
}
