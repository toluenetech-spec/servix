import { PASSWORD_RULES } from '../../lib/registrationValidation.js';
export function PasswordRequirements({ password, rules = PASSWORD_RULES }) {
  return <ul aria-label="Password requirements" style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 'var(--text-sm)' }}>
    {rules.map(rule => {
      const met = Boolean(password) && rule.test(password);
      return <li key={rule.id} style={{ color: met ? 'var(--color-deep-forest)' : 'var(--text-secondary)', marginBottom: 'var(--space-1)' }}>
        <span aria-hidden="true">{met ? '✓' : '○'} </span>
        <span className="sr-only">{met ? 'Met: ' : 'Not met: '}</span>{rule.label}
      </li>;
    })}
  </ul>;
}
