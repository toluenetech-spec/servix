/**
 * Shared plan UI: usage meters (with 75% / 90% / 100% states), upgrade notices and a gate wrapper.
 * These only *explain* plan boundaries — the API enforces them. Copy is calm and always offers a way forward.
 */
import { Link } from 'react-router-dom';
import { Icon } from '../ui/Icon.jsx';
import { PLAN_LABELS, planErrorCopy } from '../../lib/useEntitlements.js';
import './plans.css';

const n = (v) => (v === null || v === undefined ? '∞' : Number(v).toLocaleString('en-NG'));

/** `meter` = `{ used, allowed, remaining, percent, level, resetAt }` from the API (AI tokens, exports, …). */
export function UsageMeter({ meter, label = 'AI tokens', unit = 'tokens', compact = false, 'data-testid': testId }) {
  if (!meter) return null;
  const allowed = meter.allowed; const used = meter.used ?? 0;
  const percent = allowed === null || allowed === undefined ? 0 : Math.min(100, meter.percent ?? Math.round((used / Math.max(1, allowed)) * 100));
  const level = meter.level ?? (allowed === null ? 'ok' : percent >= 100 ? 'exhausted' : percent >= 90 ? 'critical' : percent >= 75 ? 'warning' : 'ok');
  const reset = meter.resetAt ? new Date(meter.resetAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null;
  return <div className={`plan-meter plan-meter--${level}${compact ? ' plan-meter--compact' : ''}`} data-testid={testId} role="group" aria-label={`${label} usage`}>
    <div className="plan-meter__row">
      <span className="plan-meter__label">{label}</span>
      <strong className="plan-meter__value">{allowed === null || allowed === undefined ? `${n(used)} ${unit} used · unlimited` : `${n(used)} / ${n(allowed)} ${unit} used`}</strong>
    </div>
    {allowed !== null && allowed !== undefined && <div className="plan-meter__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></div>}
    {!compact && <small className="plan-meter__hint">
      {allowed === null || allowed === undefined ? 'No monthly cap on this plan.'
        : level === 'exhausted' ? `Used up for this month${reset ? ` — resets on ${reset}` : ''}.`
        : level === 'critical' ? `${n(meter.remaining ?? Math.max(0, allowed - used))} ${unit} left (${percent}% used)${reset ? ` · resets ${reset}` : ''}.`
        : level === 'warning' ? `${n(meter.remaining ?? Math.max(0, allowed - used))} ${unit} left${reset ? ` · resets ${reset}` : ''}.`
        : `${n(meter.remaining ?? Math.max(0, allowed - used))} ${unit} remaining${reset ? ` · resets ${reset}` : ''}.`}
    </small>}
  </div>;
}

/** Soft warning line for AI meters at 75% / 90% / 100%. Nothing is shown below 75%. */
export function AiQuotaWarning({ meter, upgradeTo }) {
  if (!meter || meter.allowed === null || meter.allowed === undefined) return null;
  const level = meter.level; if (!level || level === 'ok') return null;
  const reset = meter.resetAt ? new Date(meter.resetAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : 'the 1st of next month';
  const text = level === 'exhausted' ? `You have used all ${n(meter.allowed)} AI tokens for this month. Servix AI pauses until ${reset}; everything else keeps working.`
    : level === 'critical' ? `You have used ${meter.percent}% of this month's AI tokens — ${n(meter.remaining)} left before Servix AI pauses until ${reset}.`
    : `You have used ${meter.percent}% of this month's AI tokens (${n(meter.remaining)} left).`;
  return <div className={`plan-notice plan-notice--${level}`} role={level === 'exhausted' ? 'alert' : 'status'} data-testid="ai-quota-warning"><Icon name={level === 'exhausted' ? 'alert' : 'info'} size={15} /><span>{text}</span>{upgradeTo && <Link to="/dashboard/plan" className="plan-notice__cta">See plans with more AI</Link>}</div>;
}

/** Explains a plan boundary (from an API error or explicitly) and offers the upgrade. Returns null when `error` is not plan-related. */
export function UpgradeNotice({ error, title, body, upgradeTo, compact = false, onDismiss }) {
  const copy = error ? planErrorCopy(error) : null;
  if (error && !copy) return null;
  const t = title ?? copy?.title; const b = body ?? copy?.body; const to = upgradeTo ?? copy?.upgradeTo ?? null;
  return <div className={`plan-notice plan-notice--upgrade${compact ? ' plan-notice--compact' : ''}`} role="status" data-testid="upgrade-notice">
    <Icon name="crown" size={16} />
    <div><strong>{t}</strong>{b && <span>{b}</span>}</div>
    <div className="plan-notice__actions">{to ? <Link to={`/dashboard/plan?highlight=${to}`} className="btn btn--primary">{`See the ${PLAN_LABELS[to] ?? to} plan`}</Link> : <Link to="/dashboard/plan" className="btn btn--secondary">See plans</Link>}{onDismiss && <button type="button" className="btn btn--ghost" onClick={onDismiss}>Not now</button>}</div>
  </div>;
}

/** Small inline badge "Go and above" used next to locked controls. */
export function PlanTag({ plan, children }) {
  if (!plan) return null;
  return <span className="plan-tag" title={`Available on ${PLAN_LABELS[plan] ?? plan} and above`}><Icon name="crown" size={11} />{children ?? `${PLAN_LABELS[plan] ?? plan}+`}</span>;
}

/**
 * Wraps content that needs a feature. When the account lacks it, the children are rendered inert (dimmed, not
 * interactive) behind a short explanation — the user still sees what the feature looks like, but nothing is
 * sent to the API (which would refuse it anyway).
 */
export function PlanGate({ allowed, upgradeTo, title = 'Available on a higher plan', body, children, preview = true }) {
  if (allowed) return children;
  return <div className="plan-gate" data-testid="plan-gate">
    {preview && <div className="plan-gate__preview" aria-hidden="true" inert="">{children}</div>}
    <UpgradeNotice title={title} body={body ?? (upgradeTo ? `Available on ${PLAN_LABELS[upgradeTo] ?? upgradeTo} and above.` : undefined)} upgradeTo={upgradeTo} />
  </div>;
}

/** "3 / 5 used" chip for concurrent/monthly limits. */
export function LimitChip({ used, allowed, unit }) {
  if (allowed === null || allowed === undefined) return <span className="ws-chip gray">{n(used)} {unit} · unlimited</span>;
  const tone = used >= allowed ? 'warn' : '';
  return <span className={`ws-chip ${tone}`}>{n(used)} / {n(allowed)} {unit}</span>;
}
