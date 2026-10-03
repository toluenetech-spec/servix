/**
 * "72,400 / 100,000 AI tokens used" — the signed-in account's Servix AI meter for this month, with the
 * 75% / 90% / 100% warnings. Loads `/ai/usage` once and then updates instantly from every AI response
 * (each one carries `ai.quota`), so the bar moves as you use it without extra requests.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { aiUsage } from '../../lib/aiApi.js';
import { UsageMeter, AiQuotaWarning } from '../plans/PlanBits.jsx';
import { AI_QUOTA_EVENT } from './AiBits.jsx';

export function useAiMeter() {
  const [meter, setMeter] = useState(null);
  useEffect(() => {
    let alive = true;
    aiUsage().then((m) => { if (alive && m && typeof m.used === 'number') setMeter(m); }).catch(() => {});
    const onQuota = (e) => { if (alive && e.detail) setMeter((m) => ({ ...(m ?? {}), ...e.detail })); };
    window.addEventListener(AI_QUOTA_EVENT, onQuota);
    return () => { alive = false; window.removeEventListener(AI_QUOTA_EVENT, onQuota); };
  }, []);
  return meter;
}

export function AiUsageCard({ meter }) {
  if (!meter) return null;
  const pooled = meter.subject === 'org';
  return <section className="ai-card" data-testid="ai-usage-card">
    <h3>Your Servix AI this month</h3>
    <UsageMeter meter={meter} label={pooled ? 'Team AI token pool' : `${meter.planLabel ?? ''} plan AI tokens`.trim()} />
    {meter.member && meter.member.allowed !== null && <div style={{ marginTop: 8 }}><UsageMeter meter={meter.member} label="Your personal cap" compact /></div>}
    <p className="ws-muted" style={{ marginTop: 8, fontSize: 11 }}>Tokens are counted on the server for every AI request (prompt + answer). Failed requests are never charged. <Link to="/dashboard/plan">Plans with more AI →</Link></p>
  </section>;
}

export function AiQuotaBanner({ meter }) {
  if (!meter) return null;
  const m = meter.member && meter.member.allowed !== null && meter.member.level !== 'ok' ? meter.member : meter;
  return <AiQuotaWarning meter={m} upgradeTo={meter.subject === 'org' ? null : 'go'} />;
}
