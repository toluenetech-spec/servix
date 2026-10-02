import { useEffect, useId, useState } from 'react';

/**
 * Pick-from-options controls used across professional onboarding, the pro
 * Profile tab and the gig editor. Both keep the stored value a plain string
 * (or string array) so nothing about the API changes.
 *
 *  - <SelectWithOther>: a <select> of suggested options plus an "Other" entry
 *    that reveals a text box. Any stored value not in the list is shown as
 *    "Other" with the text box pre-filled, so existing data never disappears.
 *  - <ChipPicker>: tap-to-toggle chips for multi-select lists (skills). An
 *    "Other…" chip lets people add something not listed.
 */

export const OTHER = '__other__';

function inList(options, value) {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return options.some((o) => o.toLowerCase() === v);
}

export function SelectWithOther({
  id,
  options,
  value,
  onChange,
  placeholder = 'Choose…',
  otherLabel = 'Other (type it in)',
  otherPlaceholder = 'Type it here',
  maxLength = 120,
  className = 'select',
  inputClassName = 'input',
  disabled,
  required,
  ...rest
}) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const custom = value && !inList(options, value);
  const [otherMode, setOtherMode] = useState(!!custom);
  useEffect(() => { if (custom) setOtherMode(true); }, [custom]);

  function pick(e) {
    const next = e.target.value;
    if (next === OTHER) {
      setOtherMode(true);
      if (inList(options, value)) onChange('');
      return;
    }
    setOtherMode(false);
    onChange(next);
  }

  return (
    <div className="ob-select-other">
      <select
        id={selectId}
        className={className}
        value={otherMode ? OTHER : value ?? ''}
        onChange={pick}
        disabled={disabled}
        required={required && !otherMode}
        {...rest}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value={OTHER}>{otherLabel}</option>
      </select>
      {otherMode && (
        <input
          type="text"
          className={inputClassName}
          aria-label={`Other — ${otherPlaceholder}`}
          placeholder={otherPlaceholder}
          maxLength={maxLength}
          value={value ?? ''}
          autoFocus={!value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      )}
    </div>
  );
}

export function ChipPicker({
  id,
  options,
  value = [],
  onChange,
  max = 15,
  otherLabel = 'Other…',
  otherPlaceholder = 'Add a skill not listed',
  maxLength = 60,
  'aria-describedby': describedBy,
  label = 'Options',
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const lower = value.map((v) => v.toLowerCase());
  const selected = (o) => lower.includes(o.toLowerCase());
  const customValues = value.filter((v) => !inList(options, v));
  const full = value.length >= max;

  function toggle(option) {
    if (selected(option)) onChange(value.filter((v) => v.toLowerCase() !== option.toLowerCase()));
    else if (!full) onChange([...value, option]);
  }

  function addCustom() {
    const parts = draft.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    const next = [...value];
    for (const p of parts) {
      if (next.length >= max) break;
      if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p.slice(0, maxLength));
    }
    onChange(next);
    setDraft('');
    setAdding(false);
  }

  return (
    <div className="ob-chips" id={id} role="group" aria-label={label} aria-describedby={describedBy}>
      <div className="ob-chips__list">
        {options.map((o) => {
          const on = selected(o);
          return (
            <button
              key={o}
              type="button"
              className={`ob-chip${on ? ' ob-chip--on' : ''}`}
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => toggle(o)}
            >
              {o}
            </button>
          );
        })}
        {customValues.map((v) => (
          <button key={`custom-${v}`} type="button" className="ob-chip ob-chip--on ob-chip--custom" aria-pressed="true" onClick={() => toggle(v)} title="Remove">
            {v} <span aria-hidden="true">×</span>
          </button>
        ))}
        {!adding && !full && (
          <button type="button" className="ob-chip ob-chip--other" onClick={() => setAdding(true)}>
            + {otherLabel}
          </button>
        )}
      </div>
      {adding && (
        <div className="ob-chips__other">
          <input
            type="text"
            className="input"
            aria-label={otherPlaceholder}
            placeholder={otherPlaceholder}
            maxLength={maxLength}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addCustom(); }
              if (e.key === 'Escape') { setDraft(''); setAdding(false); }
            }}
          />
          <button type="button" className="btn btn--secondary" onClick={addCustom} disabled={!draft.trim()}>Add</button>
          <button type="button" className="btn btn--ghost" onClick={() => { setDraft(''); setAdding(false); }}>Cancel</button>
        </div>
      )}
      <p className="ob-chips__count" aria-live="polite">{value.length}/{max} selected{full ? ' — maximum reached' : ''}</p>
    </div>
  );
}
