/**
 * "Describe what you need" on the public professionals page. Sends the sentence to the backend, which returns
 * ONLY validated search filters (real category slugs, integer naira, known sort keys); we apply them to the URL
 * so the normal directory query runs. No account needed.
 */
import { useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { searchIntent } from '../../lib/aiApi.js';
import { describeSearchFilters, searchFiltersToParams } from '../../lib/aiHelpers.js';
import { AiError, AiTag, AiThinking, useAiTask } from './AiBits.jsx';

export function SmartSearch({ categories = [], onApply }) {
  const [text, setText] = useState('');
  const task = useAiTask();
  async function go(e) {
    e.preventDefault();
    const q = text.trim(); if (q.length < 2 || task.busy) return;
    const r = await task.run((signal) => searchIntent(q, { signal }));
    if (r?.filters) onApply(searchFiltersToParams(r.filters));
  }
  const chips = task.data?.filters ? describeSearchFilters(task.data.filters, categories) : [];
  return <section className="ai-search" aria-label="Smart search" data-testid="ai-smart-search">
    <div className="ai-search__label"><span>Not sure what to filter? Describe it in your own words.</span><AiTag small /></div>
    <form onSubmit={go}>
      <input type="text" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="e.g. logo designer in Lagos under ₦30,000 who is free this week" aria-label="Describe what you need" />
      <button type="submit" className="btn btn--primary" disabled={task.busy || text.trim().length < 2}><Icon name="sparkle" size={14} /> Find</button>
    </form>
    {task.busy && <div className="ai-search__status"><AiThinking label="Working out the best filters…" onCancel={task.cancel} /></div>}
    {task.error && <div className="ai-search__status"><AiError error={task.error} onRetry={go} /></div>}
    {!task.busy && chips.length > 0 && <div className="ai-search__status">Showing: <span className="ai-chips" style={{ display: 'inline-flex', marginTop: 0 }}>{chips.map((c) => <span key={c} className="ai-chip">{c}</span>)}</span></div>}
    {!task.busy && task.data && chips.length === 0 && <div className="ai-search__status">Couldn’t pin that down to filters — showing everything. Try adding a category or city.</div>}
  </section>;
}
