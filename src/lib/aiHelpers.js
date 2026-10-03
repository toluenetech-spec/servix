/**
 * Pure helpers for the Servix AI UI (no network, no React) so they can be unit-tested with node:test.
 * - map validated AI search filters → /professionals URL params
 * - map AI request-brief drafts → the request editor form shape
 * - map AI proposal drafts → the proposal form shape
 * - friendly, honest error copy for the controlled AI error codes
 */

/** Starting-price radio options on the professionals page. Any other positive integer is treated as a custom cap. */
export const PRICE_PRESETS = [150000, 250000];

/** `filters` is the backend-validated object from POST /ai/search/intent. Returns a URLSearchParams-ready object. */
export function searchFiltersToParams(filters = {}) {
  const out = {};
  if (filters.q) out.q = String(filters.q);
  if (filters.category) out.category = String(filters.category);
  if (filters.location) out.location = String(filters.location);
  if (Number.isFinite(filters.maxPrice) && filters.maxPrice > 0) {
    const preset = PRICE_PRESETS.find((p) => filters.maxPrice <= p);
    out.price = preset ? String(preset / 1000) : String(Math.round(filters.maxPrice));
  }
  if (filters.minRating) out.rating = String(filters.minRating);
  if (filters.available) out.availability = String(filters.available);
  else if (filters.availability) out.availability = String(filters.availability);
  if (filters.sort && filters.sort !== 'recommended') out.sort = String(filters.sort);
  return out;
}

const prettySlug = (slug) => String(slug).split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/** Human chips describing what the AI understood ("Graphic design", "Lagos", "Up to ₦30,000", ...). */
export function describeSearchFilters(filters = {}, categories = []) {
  const chips = [];
  if (filters.category) chips.push(categories.find((c) => (c.slug ?? c.id) === filters.category)?.name ?? prettySlug(filters.category));
  if (filters.q) chips.push(`“${filters.q}”`);
  if (filters.location) chips.push(filters.location);
  if (Number.isFinite(filters.maxPrice) && filters.maxPrice > 0) chips.push(`Up to ₦${Math.round(filters.maxPrice).toLocaleString('en-NG')}`);
  if (filters.available) chips.push({ today: 'Free today', tomorrow: 'Free tomorrow', week: 'Free this week' }[filters.available] ?? filters.available);
  if (filters.sort && filters.sort !== 'recommended') chips.push({ rating: 'Highest rated', reviews: 'Most reviewed', 'price-asc': 'Cheapest first', 'price-desc': 'Premium first' }[filters.sort] ?? filters.sort);
  return chips;
}

/** AI request draft (already validated by the backend against the real request schema) → editor form state. */
export function requestDraftToForm(draft, current = {}) {
  const date = draft.deadlineAt ? new Date(draft.deadlineAt) : null;
  return {
    ...current,
    title: draft.title ?? current.title ?? '',
    categorySlug: draft.categorySlug ?? current.categorySlug ?? '',
    description: draft.description ?? current.description ?? '',
    budgetType: draft.budgetType === 'range' ? 'range' : 'fixed',
    budgetMin: draft.budgetMin == null ? '' : String(draft.budgetMin),
    budgetMax: draft.budgetMax == null ? '' : String(draft.budgetMax),
    deadlineAt: date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : '',
    isRemote: draft.isRemote !== false,
    location: draft.location ?? '',
    requiredSkills: Array.isArray(draft.requiredSkills) ? draft.requiredSkills.join(', ') : (current.requiredSkills ?? ''),
    extraRequirements: current.extraRequirements ?? '',
  };
}

/** AI proposal draft → proposal form state (milestones use the editor's "title | amount | days" lines). */
export function proposalDraftToForm(draft, current = {}) {
  return {
    ...current,
    cover: draft.cover ?? current.cover ?? '',
    price: draft.price == null ? (current.price ?? '') : String(draft.price),
    deliveryDays: draft.deliveryDays == null ? (current.deliveryDays ?? '') : String(draft.deliveryDays),
    serviceSlug: draft.serviceSlug ?? '',
    milestones: Array.isArray(draft.milestones) ? draft.milestones.map((m) => [m.title, m.amount, m.days].filter((x) => x != null && x !== '').join(' | ')).join('\n') : (current.milestones ?? ''),
  };
}

/** Controlled error codes from the API → plain-language copy. Never exposes provider details. */
export function aiErrorMessage(err) {
  const code = err?.code; const status = err?.status;
  if (code === 'FEATURE_DISABLED') return 'Servix AI is switched off right now.';
  if (code === 'AI_QUOTA_EXCEEDED') return err?.meta?.scope === 'member' ? 'Your personal AI allowance for this month is used up. Your team admin can raise it, or it resets next month.' : 'Your Servix AI allowance for this month is used up. It resets on the 1st; plans with more AI tokens are on the Plan page.';
  if (code === 'PLAN_FEATURE' || code === 'FEATURE_LOCKED') return err?.meta?.upgradeToLabel ? `This AI tool is available on ${err.meta.upgradeToLabel} and above.` : 'This AI tool is not included in your plan.';
  if (code === 'PLAN_LIMIT') return err?.message || 'You have reached a limit on your plan.';
  if (code === 'AI_UNAVAILABLE' || status === 503) return 'Servix AI is busy at the moment. Please try again in a minute — nothing was changed.';
  if (code === 'AI_TIMEOUT' || status === 504) return 'That took too long and was stopped. Please try again — nothing was changed.';
  if (code === 'AI_INVALID_OUTPUT' || status === 502) return 'Servix AI could not produce a usable answer this time. Please try again or continue manually.';
  if (status === 429) return 'You have made a lot of AI requests in a short time. Please wait a minute and try again.';
  if (status === 401) return 'Please sign in to use Servix AI.';
  if (status === 403) return 'This AI feature is only available to approved professionals.';
  if (code === 'VALIDATION_ERROR' && err?.errors) { const first = Object.values(err.errors)[0]; if (typeof first === 'string') return first; }
  return err?.message || 'Servix AI could not complete that. Please try again.';
}

/** Deterministic status labels for project health (status is decided by the backend, never the model). */
export const HEALTH_LABELS = {
  awaiting_payment: { label: 'Awaiting payment', tone: 'warn' }, awaiting_acceptance: { label: 'Awaiting acceptance', tone: 'warn' },
  on_track: { label: 'On track', tone: 'ok' }, at_risk: { label: 'At risk', tone: 'warn' }, late: { label: 'Late', tone: 'bad' },
  delivered: { label: 'Delivered', tone: 'ok' }, completed: { label: 'Completed', tone: 'ok' }, disputed: { label: 'In dispute', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'gray' }, refunded: { label: 'Refunded', tone: 'gray' }, declined: { label: 'Declined', tone: 'gray' },
};

/* ------------------------------------------------------------------ light markdown (AI answers) */

/**
 * Parse the small Markdown subset Servix AI is allowed to use (bold, italics, inline code, bullet and numbered
 * lists, paragraphs) into a tiny tree. No HTML is ever interpreted — the renderer turns this tree into React
 * elements, so model output can never inject markup. Headings (`## x`) are demoted to bold paragraphs and
 * tables/code fences are shown as plain text.
 */
export function parseAiMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').replace(/```[a-z]*\n?/gi, '').split('\n');
  const blocks = [];
  let para = [];
  const flush = () => { if (para.length) { blocks.push({ type: 'p', lines: para.map(parseInline) }); para = []; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      const ordered = /^\s*\d+[.)]/.test(line);
      const last = blocks[blocks.length - 1];
      const list = last && last.type === (ordered ? 'ol' : 'ul') && last.open ? last : { type: ordered ? 'ol' : 'ul', items: [], open: true };
      if (list !== last) blocks.push(list);
      list.items.push(parseInline(bullet[1]));
      continue;
    }
    for (const b of blocks) b.open = false;
    if (!line.trim()) { flush(); continue; }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    para.push(heading ? `**${heading[1].replace(/\*\*/g, '')}**` : line.trim());
  }
  flush();
  return blocks.map(({ open: _o, ...b }) => b);
}

/** Inline nodes: { t:'text', v } | { t:'b'|'i', c:[…] } | { t:'code', v }. */
export function parseInline(text) {
  const out = [];
  const re = /(\*\*|__)(.+?)\1|(`)([^`]+)\3|(?<![\w*])(\*|_)([^*_\s](?:[^*_]*?[^*_\s])?)\5(?![\w*])/g;
  let i = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > i) out.push({ t: 'text', v: text.slice(i, m.index) });
    if (m[2] != null) out.push({ t: 'b', c: parseInline(m[2]) });
    else if (m[4] != null) out.push({ t: 'code', v: m[4] });
    else out.push({ t: 'i', c: parseInline(m[6]) });
    i = m.index + m[0].length;
  }
  if (i < text.length) out.push({ t: 'text', v: text.slice(i) });
  return out;
}

/** Strip Markdown markers → plain text (used when a draft is inserted into a form field or copied). */
export function aiMarkdownToPlain(text) {
  const inline = (nodes) => nodes.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : inline(n.c))).join('');
  return parseAiMarkdown(text).map((b) => (b.type === 'p' ? b.lines.map(inline).join('\n') : b.items.map((it, i) => `${b.type === 'ol' ? `${i + 1}.` : '•'} ${inline(it)}`).join('\n'))).join('\n\n').trim();
}
