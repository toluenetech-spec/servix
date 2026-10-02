import { SelectWithOther } from './OptionPicker.jsx';
/**
 * Repeating-row editor (experience, education, certifications, languages,
 * portfolio). `fields` describe the inputs; rows are plain objects.
 */
export function ListEditor({ label, items, onChange, fields, addLabel = 'Add another', max = 8, empty, renderExtra }) {
  const blank = () => Object.fromEntries(fields.map((f) => [f.key, f.default ?? '']));
  function update(i, key, value) {
    onChange(items.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)));
  }
  return (
    <div className="ob-list" role="group" aria-label={`${label} entries`}>
      {items.length === 0 && empty && <p className="ws-muted" style={{ margin: 0 }}>{empty}</p>}
      {items.map((row, i) => (
        <div className="ob-list__item" key={i}>
          <div className="ob-list__row">
            <strong>{label} {i + 1}</strong>
            <button type="button" className="ob-list__remove" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>Remove</button>
          </div>
          <div className="ob-list__grid">
            {fields.map((f) => (
              <label key={f.key} className={f.wide ? 'ob-list__item--wide' : ''}>
                {f.label}{f.required && <span aria-hidden="true" style={{ color: 'var(--danger)' }}> *</span>}
                {f.type === 'select-other' ? (
                  <SelectWithOther
                    options={typeof f.options === 'function' ? f.options(row) : f.options}
                    value={row[f.key] ?? ''}
                    onChange={(v) => update(i, f.key, v)}
                    placeholder={f.placeholder ?? 'Choose…'}
                    otherPlaceholder={f.otherPlaceholder ?? 'Type it here'}
                    maxLength={f.maxLength ?? 160}
                    className=""
                    inputClassName=""
                  />
                ) : f.type === 'select' ? (
                  <select value={row[f.key] ?? ''} onChange={(e) => update(i, f.key, e.target.value)}>
                    {f.options.map((o) => <option key={o} value={o}>{o || 'Choose…'}</option>)}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea rows={3} maxLength={f.maxLength ?? 600} placeholder={f.placeholder} value={row[f.key] ?? ''} onChange={(e) => update(i, f.key, e.target.value)} />
                ) : (
                  <input type="text" maxLength={f.maxLength ?? 160} placeholder={f.placeholder} value={row[f.key] ?? ''} onChange={(e) => update(i, f.key, e.target.value)} />
                )}
              </label>
            ))}
          </div>
          {renderExtra && renderExtra(row, (patch) => onChange(items.map((r, idx) => (idx === i ? { ...r, ...patch } : r))))}
        </div>
      ))}
      {items.length < max && (
        <button type="button" className="ob-add" onClick={() => onChange([...items, blank()])}>+ {addLabel}</button>
      )}
    </div>
  );
}

/** Comma/Enter-separated chips input (skills, search tags). */
export function TagInput({ value, onChange, max = 15, placeholder = 'Type and press Enter', id, maxLength = 60, ...rest }) {
  function add(raw) {
    const parts = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) {
      if (next.length >= max) break;
      if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p.slice(0, maxLength));
    }
    onChange(next);
  }
  return (
    <div className="ob-tags">
      {value.map((tag) => (
        <span className="ob-tag" key={tag}>
          {tag}
          <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>×</button>
        </span>
      ))}
      <input
        id={id}
        {...rest}
        placeholder={value.length >= max ? `Maximum ${max}` : placeholder}
        disabled={value.length >= max}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(e.currentTarget.value); e.currentTarget.value = ''; }
          if (e.key === 'Backspace' && !e.currentTarget.value && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={(e) => { if (e.currentTarget.value.trim()) { add(e.currentTarget.value); e.currentTarget.value = ''; } }}
      />
    </div>
  );
}
