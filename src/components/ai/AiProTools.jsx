/**
 * Professional-only AI panels: opportunity matching, weekly radar, profile analysis and improvement suggestions.
 * All read-only — the professional decides what to do with each suggestion.
 */
import { Link } from 'react-router-dom';
import { Icon } from '../ui/Icon.jsx';
import { matchOpportunities, opportunityRadar, profileAnalysis, profileImprove } from '../../lib/aiApi.js';
import { formatPrice } from '../../lib/format.js';
import { AiError, AiMeta, AiNote, AiTag, AiThinking, useAiTask } from './AiBits.jsx';

function RequestLine({ item, right }) {
  const r = item.request;
  return <div className="ai-match">
    <div className="ai-match__head">{r ? <Link to={`/dashboard/proposals/requests/${r.id}`}>{r.title}</Link> : <span className="ws-muted">Request no longer available</span>}{right}</div>
    {r && <small className="ws-muted" style={{ fontSize: 11 }}>{r.categoryName}{r.budgetMax != null ? ` · up to ${formatPrice(r.budgetMax)}` : ''}{r.deadlineAt ? ` · by ${new Date(r.deadlineAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''} · {r.proposalCount} proposal{r.proposalCount === 1 ? '' : 's'}</small>}
    <p>{item.why ?? item.reason}</p>
    {item.concerns?.length > 0 && <ul className="ai-list ai-flags" style={{ fontSize: 12 }}>{item.concerns.map((c) => <li key={c}>{c}</li>)}</ul>}
  </div>;
}

export function OpportunityMatches() {
  const task = useAiTask();
  const run = () => task.run((signal) => matchOpportunities({ signal }));
  const d = task.data;
  return <section className="ws-panel" data-testid="ai-matches">
    <div className="ai-panel__head"><h2 style={{ margin: 0 }}>Requests that fit you</h2><AiTag small /></div>
    <p className="ws-muted">Servix AI ranks open customer requests against your category, skills and gigs. It only lists requests that exist right now.</p>
    {!d && !task.busy && <div className="ws-actions" style={{ marginTop: 12 }}><button type="button" className="btn btn--primary" style={{ fontSize: 12 }} onClick={run}><Icon name="sparkle" size={14} /> Find my best matches</button></div>}
    {task.busy && <AiThinking label="Comparing open requests with your profile…" onCancel={task.cancel} />}
    <AiError error={task.error} onRetry={run} />
    {d && !task.busy && <div style={{ marginTop: 12 }}>
      <p style={{ fontSize: 13, color: '#233e2b', marginBottom: 12 }}>{d.summary}</p>
      {d.matches?.length ? d.matches.map((m) => <RequestLine key={m.requestId} item={m} right={<span className="ai-match__fit">{m.fit}% fit</span>} />) : <p className="ws-muted">No strong matches right now. <Link to="/dashboard/proposals">Browse all open requests</Link>.</p>}
      <div className="ws-actions" style={{ marginTop: 12 }}><button type="button" className="ai-link" onClick={run}>Refresh</button></div>
      <AiMeta ai={d.ai} />
    </div>}
  </section>;
}

export function OpportunityRadar() {
  const task = useAiTask();
  const run = () => task.run((signal) => opportunityRadar({ signal }));
  const d = task.data;
  return <section className="ws-panel" data-testid="ai-radar">
    <div className="ai-panel__head"><h2 style={{ margin: 0 }}>This week on Servix</h2><AiTag small /></div>
    <p className="ws-muted">What customers posted in the last 7 days and where you could act.</p>
    {!d && !task.busy && <div className="ws-actions" style={{ marginTop: 12 }}><button type="button" className="btn btn--secondary" style={{ fontSize: 12 }} onClick={run}><Icon name="sparkle" size={14} /> Scan the week</button></div>}
    {task.busy && <AiThinking label="Scanning the last 7 days…" onCancel={task.cancel} />}
    <AiError error={task.error} onRetry={run} />
    {d && !task.busy && <div style={{ marginTop: 12 }}>
      <p style={{ fontSize: 14, fontWeight: 600, color: '#12372a', marginBottom: 10 }}>{d.headline}</p>
      {d.highlights?.map((h) => <RequestLine key={h.requestId} item={h} />)}
      {d.suggestedActions?.length > 0 && <><p style={{ marginTop: 12 }}><strong>Suggested actions</strong></p><ul className="ai-list">{d.suggestedActions.map((a) => <li key={a}>{a}</li>)}</ul></>}
      <div className="ws-actions" style={{ marginTop: 12 }}><button type="button" className="ai-link" onClick={run}>Refresh</button></div>
      <AiMeta ai={d.ai} />
    </div>}
  </section>;
}

const FOCUS = [['all', 'Everything'], ['about', 'About section'], ['title', 'Headline'], ['gigs', 'My gigs'], ['skills', 'Skills'], ['pricing', 'Pricing']];

export function ProfileCoach() {
  const analysis = useAiTask(); const improve = useAiTask();
  const runAnalysis = () => analysis.run((signal) => profileAnalysis({ signal }));
  const runImprove = (focus) => improve.run((signal) => profileImprove(focus, { signal }));
  const a = analysis.data; const s = improve.data;
  return <div className="ai-two">
    <section className="ws-panel" data-testid="ai-profile-analysis">
      <div className="ai-panel__head"><h2 style={{ margin: 0 }}>Profile check-up</h2><AiTag small /></div>
      <p className="ws-muted">How complete and convincing your public profile is, from a marketplace coach’s point of view.</p>
      {!a && !analysis.busy && <div className="ws-actions" style={{ marginTop: 12 }}><button type="button" className="btn btn--primary" style={{ fontSize: 12 }} onClick={runAnalysis}><Icon name="sparkle" size={14} /> Analyse my profile</button></div>}
      {analysis.busy && <AiThinking label="Reading your profile…" onCancel={analysis.cancel} />}
      <AiError error={analysis.error} onRetry={runAnalysis} />
      {a && !analysis.busy && <div style={{ marginTop: 12 }}>
        <div className="ai-score"><strong>{a.completenessScore}<span style={{ fontSize: 16, color: '#7b8778' }}>/100</span></strong><div><small>Completeness</small><span style={{ fontSize: 13, color: '#233e2b' }}>{a.summary}</span></div></div>
        {a.strengths?.length > 0 && <><p style={{ marginTop: 12 }}><strong>Strengths</strong></p><ul className="ai-list">{a.strengths.map((x) => <li key={x}>{x}</li>)}</ul></>}
        {a.gaps?.length > 0 && <><p style={{ marginTop: 12 }}><strong>Gaps</strong></p><ul className="ai-list ai-flags">{a.gaps.map((x) => <li key={x}>{x}</li>)}</ul></>}
        <div className="ws-actions" style={{ marginTop: 12 }}><Link className="btn btn--secondary" style={{ fontSize: 12 }} to="/dashboard/profile">Edit my profile</Link><button type="button" className="ai-link" onClick={runAnalysis}>Refresh</button></div>
        <AiMeta ai={a.ai} />
      </div>}
    </section>
    <section className="ws-panel" data-testid="ai-profile-improve">
      <div className="ai-panel__head"><h2 style={{ margin: 0 }}>Concrete improvements</h2><AiTag small /></div>
      <p className="ws-muted">Specific, copy-ready suggestions. Pick a focus or let it look at everything.</p>
      <div className="ai-chips" style={{ marginBottom: 6 }}>{FOCUS.map(([v, l]) => <button type="button" key={v} className="ai-chip" style={{ cursor: 'pointer', border: 0 }} disabled={improve.busy} onClick={() => runImprove(v)}>{l}</button>)}</div>
      {improve.busy && <AiThinking label="Writing suggestions…" onCancel={improve.cancel} />}
      <AiError error={improve.error} onRetry={() => runImprove('all')} />
      {s && !improve.busy && <div style={{ marginTop: 12 }}>
        {s.suggestions?.map((x, i) => <div className="ai-match" key={i}><div className="ai-match__head"><span className="ai-chip gray" style={{ textTransform: 'capitalize' }}>{x.area}</span></div><p style={{ color: '#233e2b' }}>{x.suggestion}</p>{x.example && <blockquote style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: '#3a4a3a', borderLeft: '3px solid #cfe0c6', paddingLeft: 10 }}>{x.example}</blockquote>}</div>)}
        {s.rewrittenAbout && <div className="ai-result"><p><strong>Suggested About section</strong></p><blockquote>{s.rewrittenAbout}</blockquote><div className="ws-actions"><button type="button" className="btn btn--ghost" style={{ fontSize: 12 }} onClick={() => navigator.clipboard?.writeText(s.rewrittenAbout)}>Copy</button><Link className="btn btn--secondary" style={{ fontSize: 12 }} to="/dashboard/profile">Open profile editor</Link></div></div>}
        <AiMeta ai={s.ai} />
        <AiNote>Suggestions are based on your current profile and Servix data; nothing changes until you edit and save your profile.</AiNote>
      </div>}
    </section>
  </div>;
}
