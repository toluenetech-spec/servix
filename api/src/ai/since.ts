/** Pure time-window parsing for admin tools (no database import). */
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // Africa/Lagos is UTC+1 all year.

/** "today" | "yesterday" | "7d" | "30d" | ISO date → lower bound (Lagos calendar days). */
export function sinceFrom(input: unknown, now = new Date()): Date | null {
  if (typeof input !== 'string' || !input.trim()) return null;
  const v = input.trim().toLowerCase();
  const startOfLagosDay = (d: Date) => { const shifted = new Date(d.getTime() + LAGOS_OFFSET_MS); shifted.setUTCHours(0, 0, 0, 0); return new Date(shifted.getTime() - LAGOS_OFFSET_MS); };
  if (v === 'today') return startOfLagosDay(now);
  if (v === 'yesterday') return new Date(startOfLagosDay(now).getTime() - 24 * 3600 * 1000);
  const m = /^(\d{1,3})\s*(d|day|days|h|hour|hours)$/.exec(v);
  if (m) { const n = Number(m[1]); const unit = m[2].startsWith('d') ? 24 : 1; return new Date(now.getTime() - n * unit * 3600 * 1000); }
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
