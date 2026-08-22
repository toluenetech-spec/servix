import { useId } from 'react';
import { Icon } from './Icon.jsx';

/**
 * Form field wrapper providing label, hint and inline error with
 * correct aria wiring. Children render-prop receives the input props.
 */
export function Field({ label, hint, error, children, required }) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const inputProps = {
    id,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby':
      [error && errorId, hint && hintId].filter(Boolean).join(' ') || undefined,
    required,
  };

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: 'var(--danger)' }}>
            {' '}
            *
          </span>
        )}
      </label>
      {children(inputProps)}
      {hint && !error && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={errorId} role="alert">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
    </div>
  );
}
