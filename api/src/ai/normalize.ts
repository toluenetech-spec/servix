/**
 * Servix AI — normalisers for backend-controlled values.
 *
 * Models are asked for slugs, dates and numbers, but they drift ("graphics-design",
 * "2026-11-20", "₦150,000"). Everything authoritative is snapped to real values
 * here BEFORE zod validation, and anything that cannot be matched becomes null
 * rather than an invented id. The database remains the only source of truth.
 */

/** Pull the first JSON object out of free text (handles ``` fences and prose). */
export function extractJsonObject(text: string | null | undefined): unknown {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

/** Accepts ISO datetimes, bare dates (→ midday UTC), or null. Rejects the past when `future` is set. */
export function normalizeDateTime(input: unknown, opts: { future?: boolean; now?: Date } = {}): string | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const s = String(input).trim();
  let d: Date | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = new Date(`${s}T12:00:00.000Z`);
  else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) d = new Date(`${s.replace(' ', 'T')}Z`);
  else { const t = new Date(s); d = Number.isNaN(t.getTime()) ? null : t; }
  if (!d || Number.isNaN(d.getTime())) return null;
  if (opts.future && d.getTime() < (opts.now ?? new Date()).getTime()) return null;
  return d.toISOString();
}

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Known near-misses seen in evaluation; extend as new drift appears. */
const CATEGORY_ALIASES: Record<string, string> = {
  'graphics-design': 'graphic-design', graphics: 'graphic-design', 'logo-design': 'graphic-design', branding: 'graphic-design',
  'web-design': 'web-development', website: 'web-development', 'web-dev': 'web-development', 'software-development': 'web-development',
  'ui-design': 'ui-ux-design', 'ux-design': 'ui-ux-design', 'ui-ux': 'ui-ux-design', 'product-design': 'ui-ux-design', 'app-design': 'ui-ux-design',
  'video-production': 'video-editing', video: 'video-editing', videography: 'video-editing',
  photo: 'photography', photographer: 'photography',
  'digital-marketing': 'marketing', 'social-media': 'marketing', 'social-media-marketing': 'marketing',
  copywriting: 'writing', 'content-writing': 'writing', writer: 'writing',
  consultant: 'consulting', 'business-consulting': 'consulting',
};

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[a.length][b.length];
}

export interface CategoryRef { slug: string; name: string }

/**
 * Snap a model-produced category to a REAL category slug, or null.
 * Order: exact slug → exact name → alias table → token overlap → small edit distance.
 */
export function resolveCategorySlug(input: unknown, categories: CategoryRef[]): string | null {
  if (typeof input !== 'string' || !input.trim() || !categories.length) return null;
  const want = slugify(input);
  if (!want) return null;
  const bySlug = new Map(categories.map((c) => [c.slug, c.slug]));
  if (bySlug.has(want)) return want;
  const byName = categories.find((c) => slugify(c.name) === want);
  if (byName) return byName.slug;
  const alias = CATEGORY_ALIASES[want];
  if (alias && bySlug.has(alias)) return alias;
  const wantTokens = new Set(want.split('-').filter((t) => t.length > 2));
  let best: { slug: string; score: number } | null = null;
  for (const c of categories) {
    const tokens = new Set([...c.slug.split('-'), ...slugify(c.name).split('-')].filter((t) => t.length > 2));
    const overlap = [...wantTokens].filter((t) => tokens.has(t)).length;
    if (overlap > 0 && (!best || overlap > best.score)) best = { slug: c.slug, score: overlap };
  }
  if (best) return best.slug;
  for (const c of categories) if (editDistance(want, c.slug) <= 2) return c.slug;
  return null;
}

/** Integers in naira: accepts 150000, "150000", "₦150,000", "150k". Null when unparseable. */
export function normalizeNaira(input: unknown): number | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? Math.round(input) : null;
  if (typeof input !== 'string') return null;
  const s = input.toLowerCase().replace(/[₦,\s]/g, '').replace(/^ngn/, '').replace(/naira$/, '');
  const m = s.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return null;
  let n = Number(m[1]); if (m[2] === 'k') n *= 1_000; if (m[2] === 'm') n *= 1_000_000;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function normalizeInt(input: unknown, min: number, max: number): number | null {
  const n = typeof input === 'string' ? Number(input.replace(/[^\d.-]/g, '')) : typeof input === 'number' ? input : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeEnum<T extends string>(input: unknown, allowed: readonly T[], fallback: T | null = null): T | null {
  if (typeof input !== 'string') return fallback;
  const want = slugify(input).replace(/-/g, '_');
  const norm = (a: string) => slugify(a).replace(/-/g, '_');
  const hit = allowed.find((a) => a === input || norm(a) === want)
    ?? allowed.find((a) => want.split('_').at(-1) === norm(a)); // "this week" → week, "sort by rating" → rating
  return hit ?? fallback;
}

/** Keep only slugs/ids that exist in a backend-provided allow-list (never invent). */
export function onlyKnown<T extends string>(input: unknown, known: ReadonlySet<T>): T | null {
  return typeof input === 'string' && known.has(input as T) ? (input as T) : null;
}

export function normalizeStringList(input: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) { if (typeof v === 'string' && v.trim()) out.push(v.trim().slice(0, maxLen)); if (out.length >= max) break; }
  return out;
}

export function clampText(input: unknown, max: number): string {
  return typeof input === 'string' ? input.trim().slice(0, max) : '';
}
