/**
 * Servix AI routing layer — unit tests (no database, no network).
 * Run: npx vitest run tests/ai-router.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { DEPARTMENTS, defaultChain, describeRouting, loadAiConfig, type AiConfig } from '../src/ai/config.js';
import { AiProviderError, OpenAICompatibleProvider, ThinkFilter, stripThinking, type AiProvider, type ChatRequest, type ChatResponse } from '../src/ai/provider.js';
import { AiRouter, UNTRUSTED_OPEN } from '../src/ai/router.js';
import { AiTelemetry } from '../src/ai/telemetry.js';
import { extractJsonObject, normalizeDateTime, normalizeEnum, normalizeNaira, onlyKnown, resolveCategorySlug } from '../src/ai/normalize.js';
import { ApiError } from '../src/lib/errors.js';

const ENV = { AI_ENABLED: 'true', AI_API_KEY: 'test-key-123', AI_BASE_URL: 'https://inference.dahl.global/v1' };
const baseConfig = (): AiConfig => ({ ...loadAiConfig(ENV), callTimeoutMs: 2000, taskTimeoutMs: 8000 });

/** Scriptable provider: per-model behaviour, counts every call. */
class FakeProvider implements AiProvider {
  readonly name = 'fake';
  calls: { model: string; messages: ChatRequest['messages']; tools?: ChatRequest['tools'] }[] = [];
  constructor(private script: Record<string, (req: ChatRequest, n: number) => ChatResponse | Error>) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.calls.push({ model: req.model, messages: req.messages, tools: req.tools });
    const n = this.calls.filter((c) => c.model === req.model).length;
    const fn = this.script[req.model];
    if (!fn) throw new AiProviderError('bad_request', `unknown model ${req.model}`, 400);
    const out = fn(req, n);
    if (out instanceof Error) throw out;
    return out;
  }
}
const reply = (content: string): ChatResponse => ({ message: { role: 'assistant', content }, usage: { promptTokens: 10, completionTokens: 5 }, finishReason: 'stop', latencyMs: 1 });
const MODELS = { deepseek: 'deepseek-ai/DeepSeek-V4-Flash-0731', minimax: 'MiniMaxAI/MiniMax-M2.7', glm: 'zai-org/GLM-5.3-Flash' };

describe('AI config / routing table', () => {
  it('maps every department to the owner’s assignment with the agreed fallback chains', () => {
    const cfg = loadAiConfig(ENV);
    expect(cfg.enabled).toBe(true);
    for (const d of ['assistant', 'job_matching', 'opportunity_radar', 'profile_analysis', 'profile_improvement', 'pricing_guidance', 'project_health', 'explanations', 'search_intent'] as const) {
      expect(cfg.routes[d]).toEqual(['deepseek', 'glm']);
    }
    expect(cfg.routes.proposal_generation).toEqual(['minimax', 'deepseek', 'glm']);
    expect(cfg.routes.background_drafting).toEqual(['minimax', 'deepseek', 'glm']);
    expect(cfg.models).toEqual(MODELS);
    expect(defaultChain('glm')).toEqual(['glm', 'deepseek']);
  });
  it('is OFF without a key, and reports why', () => {
    const cfg = loadAiConfig({ AI_ENABLED: 'true' });
    expect(cfg.enabled).toBe(false);
    expect(cfg.warnings[0]).toMatch(/AI_API_KEY is missing/);
    expect(loadAiConfig({}).enabled).toBe(false);
  });
  it('honours per-department overrides and model id overrides; ignores invalid ones', () => {
    const cfg = loadAiConfig({ ...ENV, AI_ROUTE_ASSISTANT: 'minimax,glm', AI_ROUTE_EXPLANATIONS: 'gpt-9', AI_MODEL_GLM: 'zai-org/GLM-6' });
    expect(cfg.routes.assistant).toEqual(['minimax', 'glm']);
    expect(cfg.routes.explanations).toEqual(['deepseek', 'glm']);
    expect(cfg.models.glm).toBe('zai-org/GLM-6');
    expect(cfg.warnings.some((w) => w.includes('AI_ROUTE_EXPLANATIONS'))).toBe(true);
  });
  it('never exposes the key in the describable view', () => {
    const view = JSON.stringify(describeRouting(loadAiConfig(ENV)));
    expect(view).not.toContain('test-key-123');
    expect(view).toContain('"keyConfigured":true');
    expect(DEPARTMENTS).toHaveLength(11);
  });
});

describe('AiRouter fallback behaviour', () => {
  let telemetry: AiTelemetry;
  beforeEach(() => { telemetry = new AiTelemetry(); });
  const textTask = (department: AiConfig['routes'] extends Record<infer K, unknown> ? K : never) => ({ department, messages: [{ role: 'user' as const, content: 'hi' }], output: { kind: 'text' as const } });

  it('uses the primary model when it works (no fallback)', async () => {
    const p = new FakeProvider({ [MODELS.deepseek]: () => reply('hello') });
    const r = await new AiRouter(baseConfig(), p, telemetry).run(textTask('assistant'));
    expect(r.value).toBe('hello'); expect(r.alias).toBe('deepseek'); expect(r.fallbackUsed).toBe(false); expect(r.attempts).toBe(1);
    expect(telemetry.summary().departments[0]).toMatchObject({ department: 'assistant', ok: 1, fallbackUsed: 0 });
  });

  it('DeepSeek unavailable → falls back to GLM, with bounded retries', async () => {
    const p = new FakeProvider({ [MODELS.deepseek]: () => new AiProviderError('rate_limited', 'at capacity', 429), [MODELS.glm]: () => reply('from glm') });
    const cfg = baseConfig(); cfg.maxAttemptsPerModel = 2;
    const r = await new AiRouter(cfg, p, telemetry).run(textTask('pricing_guidance'));
    expect(r.value).toBe('from glm'); expect(r.alias).toBe('glm'); expect(r.fallbackUsed).toBe(true);
    expect(p.calls.filter((c) => c.model === MODELS.deepseek)).toHaveLength(2); // 1 try + 1 retry, never endless
    expect(p.calls.filter((c) => c.model === MODELS.glm)).toHaveLength(1);
    const errors = telemetry.summary().models.find((m) => m.model === MODELS.deepseek)!.errors;
    expect(errors.rate_limited).toBe(2);
  });

  it('MiniMax unavailable → DeepSeek handles the proposal; GLM untouched', async () => {
    const p = new FakeProvider({ [MODELS.minimax]: () => new AiProviderError('unavailable', '503', 503), [MODELS.deepseek]: () => reply('{"ok":true}'), [MODELS.glm]: () => reply('{"ok":true}') });
    const r = await new AiRouter(baseConfig(), p, telemetry).run({ department: 'proposal_generation', messages: [{ role: 'user', content: 'x' }], output: { kind: 'json', parse: (raw) => ({ ok: true, value: raw }) } });
    expect(r.alias).toBe('deepseek'); expect(r.fallbackUsed).toBe(true);
    expect(p.calls.some((c) => c.model === MODELS.glm)).toBe(false);
  });

  it('a permanently rejected model (400) is skipped immediately, not retried', async () => {
    const p = new FakeProvider({ [MODELS.deepseek]: () => new AiProviderError('bad_request', 'unknown model', 400), [MODELS.glm]: () => reply('ok') });
    await new AiRouter(baseConfig(), p, telemetry).run(textTask('explanations'));
    expect(p.calls.filter((c) => c.model === MODELS.deepseek)).toHaveLength(1);
  });

  it('whole chain down → controlled 503 AI_UNAVAILABLE after a bounded number of calls', async () => {
    const p = new FakeProvider({ [MODELS.deepseek]: () => new AiProviderError('timeout', 'slow'), [MODELS.glm]: () => new AiProviderError('network', 'ECONNRESET') });
    const cfg = baseConfig(); cfg.maxAttemptsPerModel = 2;
    await expect(new AiRouter(cfg, p, telemetry).run(textTask('assistant'))).rejects.toMatchObject({ status: 503, code: 'AI_UNAVAILABLE' } satisfies Partial<ApiError>);
    expect(p.calls.length).toBeLessThanOrEqual(4);
    expect(telemetry.summary().departments[0]).toMatchObject({ ok: 0, failed: 1 });
  });

  it('invalid structured output → one repair round with validator feedback → next model → 502 if still invalid', async () => {
    const schema = z.object({ price: z.number().int().min(1000) });
    const p = new FakeProvider({ [MODELS.deepseek]: () => reply('{"price":"cheap"}'), [MODELS.glm]: () => reply('not json at all') });
    const router = new AiRouter(baseConfig(), p, telemetry);
    await expect(router.run({ department: 'pricing_guidance', messages: [{ role: 'user', content: 'x' }], output: { kind: 'json', parse: (raw) => { const r = schema.safeParse(raw); return r.success ? { ok: true, value: r.data } : { ok: false, issues: r.error.issues.map((i) => i.message).join(';') }; } } }))
      .rejects.toMatchObject({ status: 502, code: 'AI_INVALID_OUTPUT' });
    const deepseekCalls = p.calls.filter((c) => c.model === MODELS.deepseek);
    expect(deepseekCalls).toHaveLength(2);
    const repairMsg = deepseekCalls[1].messages.at(-1)!;
    expect(repairMsg.role).toBe('user'); expect(repairMsg.content).toMatch(/failed validation/);
    expect(p.calls.filter((c) => c.model === MODELS.glm)).toHaveLength(2);
  });

  it('repair succeeds on the same model when the second answer validates', async () => {
    const p = new FakeProvider({ [MODELS.deepseek]: (_req, n) => reply(n === 1 ? '{"price":"cheap"}' : '```json\n{"price": 5000}\n```') });
    const r = await new AiRouter(baseConfig(), p, telemetry).run({ department: 'pricing_guidance', messages: [{ role: 'user', content: 'x' }], output: { kind: 'json', parse: (raw) => { const r = z.object({ price: z.number().int().min(1000) }).safeParse(raw); return r.success ? { ok: true, value: r.data } : { ok: false, issues: 'price must be an integer' }; } } });
    expect(r.value).toEqual({ price: 5000 }); expect(r.fallbackUsed).toBe(false);
  });

  it('runs tools in a bounded loop and wraps results as UNTRUSTED data', async () => {
    const p = new FakeProvider({ [MODELS.deepseek]: (req, n) => {
      const toolMsgs = req.messages.filter((m) => m.role === 'tool');
      if (n <= 3 && toolMsgs.length < 3) return { message: { role: 'assistant', content: null, tool_calls: [{ id: `c${n}`, type: 'function', function: { name: 'echo', arguments: '{"x":1}' } }] }, usage: null, finishReason: 'tool_calls', latencyMs: 1 };
      return reply('done');
    } });
    const cfg = baseConfig(); cfg.maxToolCalls = 2;
    const ran: string[] = [];
    const r = await new AiRouter(cfg, p, telemetry).run({ department: 'assistant', messages: [{ role: 'user', content: 'go' }], tools: { schemas: [{ type: 'function', function: { name: 'echo', description: 'x', parameters: {} } }], run: async (name) => { ran.push(name); return { echoed: true }; } }, output: { kind: 'text' } });
    expect(r.value).toBe('done');
    expect(ran.length).toBeLessThanOrEqual(cfg.maxToolCalls + 1);
    const toolMsg = p.calls.flatMap((c) => c.messages).find((m) => m.role === 'tool')!;
    expect(toolMsg.content).toContain(UNTRUSTED_OPEN);
  });

  it('task deadline stops the chain → 504 AI_TIMEOUT', async () => {
    const p = new FakeProvider({ [MODELS.deepseek]: () => new AiProviderError('timeout', 'slow'), [MODELS.glm]: () => reply('late') });
    const cfg = baseConfig(); cfg.taskTimeoutMs = 5000; cfg.maxAttemptsPerModel = 3;
    const router = new AiRouter(cfg, p, telemetry);
    const started = Date.now();
    await expect(router.run(textTask('assistant'))).rejects.toMatchObject({ code: expect.stringMatching(/AI_TIMEOUT|AI_UNAVAILABLE/) });
    expect(Date.now() - started).toBeLessThan(cfg.taskTimeoutMs + 500);
  });
});

describe('Provider: secrets and output hygiene', () => {
  it('scrubs the API key from upstream error text and never includes it in thrown messages', async () => {
    const key = 'sk-very-secret-key';
    const fetchImpl = (async () => new Response(`bad request for key ${key}`, { status: 400 })) as unknown as typeof fetch;
    const provider = new OpenAICompatibleProvider({ name: 'dahl', baseUrl: 'https://example.invalid/v1', apiKey: key, fetchImpl });
    const err = await provider.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }], timeoutMs: 1000 }).catch((e) => e as AiProviderError);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.message).not.toContain(key); expect(err.message).toContain('[REDACTED]');
  });
  it('sends the key only as a Bearer header and never in the body', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => { captured = { url, init }; return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '<think>hmm</think>hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }), { status: 200 }); }) as unknown as typeof fetch;
    const provider = new OpenAICompatibleProvider({ name: 'dahl', baseUrl: 'https://example.invalid/v1/', apiKey: 'k-1', fetchImpl });
    const res = await provider.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }], json: true, timeoutMs: 1000 });
    expect(captured!.url).toBe('https://example.invalid/v1/chat/completions');
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe('Bearer k-1');
    expect(String(captured!.init.body)).not.toContain('k-1');
    expect(res.message.content).toBe('hi'); expect(res.usage).toEqual({ promptTokens: 3, completionTokens: 1 });
  });
  it('classifies statuses: 429 → rate_limited, 401 → auth, 503 → unavailable, timeouts → timeout', async () => {
    const mk = (status: number) => new OpenAICompatibleProvider({ name: 'x', baseUrl: 'https://e.invalid/v1', apiKey: 'k', fetchImpl: (async () => new Response('{}', { status })) as unknown as typeof fetch });
    for (const [status, code] of [[429, 'rate_limited'], [401, 'auth'], [503, 'unavailable'], [404, 'bad_request']] as const) {
      const err = await mk(status).chat({ model: 'm', messages: [], timeoutMs: 1000 }).catch((e) => e as AiProviderError);
      expect(err.code).toBe(code);
    }
    const slow = new OpenAICompatibleProvider({ name: 'x', baseUrl: 'https://e.invalid/v1', apiKey: 'k', fetchImpl: ((_u: string, init: RequestInit) => new Promise((_res, rej) => { init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('t'), { name: 'TimeoutError' }))); })) as unknown as typeof fetch });
    const err = await slow.chat({ model: 'm', messages: [], timeoutMs: 50 }).catch((e) => e as AiProviderError);
    expect(err.code).toBe('timeout');
  });
  it('strips thinking blocks and blanks unterminated reasoning', () => {
    expect(stripThinking('<think>a</think> answer')).toBe('answer');
    expect(stripThinking('<think>never closed… answer inside')).toBe('');
    expect(stripThinking(null)).toBeNull();
  });
  it('telemetry log lines carry no prompt text or secrets', () => {
    const lines: Record<string, unknown>[] = [];
    const t = new AiTelemetry({ info: (o) => lines.push(o), warn: (o) => lines.push(o) });
    t.recordAttempt({ department: 'assistant', alias: 'deepseek', model: MODELS.deepseek, durationMs: 5, ok: false, fallbackIndex: 0, attempt: 1, promptTokens: 1, completionTokens: 0, errorCode: 'rate_limited' });
    expect(JSON.stringify(lines)).not.toMatch(/content|messages|apiKey|Bearer/);
    expect(lines[0]).toMatchObject({ ai: { kind: 'attempt', model: MODELS.deepseek, errorCode: 'rate_limited' } });
  });
});

describe('Normalisers (backend-controlled values)', () => {
  const cats = [{ slug: 'graphic-design', name: 'Graphic Design' }, { slug: 'web-development', name: 'Web Development' }, { slug: 'ui-ux-design', name: 'UI/UX Design' }, { slug: 'video-editing', name: 'Video Editing' }, { slug: 'photography', name: 'Photography' }];
  it('snaps model drift to real category slugs and refuses unknowns', () => {
    expect(resolveCategorySlug('graphics-design', cats)).toBe('graphic-design');
    expect(resolveCategorySlug('web-design', cats)).toBe('web-development');
    expect(resolveCategorySlug('video-production', cats)).toBe('video-editing');
    expect(resolveCategorySlug('UI Design', cats)).toBe('ui-ux-design');
    expect(resolveCategorySlug('Photography', cats)).toBe('photography');
    expect(resolveCategorySlug('plumbing', cats)).toBeNull();
    expect(resolveCategorySlug('', cats)).toBeNull();
    expect(resolveCategorySlug(42, cats)).toBeNull();
  });
  it('normalises dates (bare date → ISO datetime), rejects garbage and past deadlines', () => {
    const now = new Date('2026-10-03T00:00:00Z');
    expect(normalizeDateTime('2026-11-20', { now, future: true })).toBe('2026-11-20T12:00:00.000Z');
    expect(normalizeDateTime('2026-11-20T09:30:00Z')).toBe('2026-11-20T09:30:00.000Z');
    expect(normalizeDateTime('next week')).toBeNull();
    expect(normalizeDateTime('2020-01-01', { now, future: true })).toBeNull();
    expect(normalizeDateTime(null)).toBeNull();
  });
  it('normalises naira and enums; only known ids pass', () => {
    expect(normalizeNaira('₦150,000')).toBe(150000); expect(normalizeNaira('50k')).toBe(50000); expect(normalizeNaira(1.2e6)).toBe(1200000); expect(normalizeNaira('free')).toBeNull(); expect(normalizeNaira(-5)).toBeNull();
    expect(normalizeEnum('Price Asc', ['price-asc', 'rating'] as const)).toBe('price-asc'); expect(normalizeEnum('cheapest', ['price-asc'] as const)).toBeNull();
    expect(onlyKnown('b', new Set(['a']))).toBeNull(); expect(onlyKnown('a', new Set(['a']))).toBe('a');
    expect(extractJsonObject('Sure! ```json\n{"a":1}\n``` done')).toEqual({ a: 1 }); expect(extractJsonObject('nothing')).toBeNull();
  });
});

describe('Payment isolation (static guarantees)', () => {
  const AI_DIR = join(import.meta.dirname, '../src/ai');
  it('the AI layer never imports payment/payout/ledger/webhook/refund modules or touches money tables, and performs no writes', async () => {
    const files = (await readdir(AI_DIR)).filter((f) => f.endsWith('.ts')).map((f) => join(AI_DIR, f));
    files.push(join(import.meta.dirname, '../src/routes/ai.ts'));
    for (const f of files) {
      const src = await readFile(f, 'utf8');
      const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const i of imports) expect(i, `${f} imports ${i}`).not.toMatch(/payout|webhook|refund|paystack|ledger|payment/i);
      expect(src, f).not.toMatch(/prisma\.(payment|payout|ledgerEntry|webhookEvent|refreshToken|oneTimeToken|accountSecurity|kycVerification)\b/);
      expect(src, f).not.toMatch(/prisma\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
      expect(src, f).not.toMatch(/\$executeRaw|\$queryRaw|\$transaction/);
      expect(src, f).not.toMatch(/AI_API_KEY\s*=\s*['"`][^'"`]+['"`]/); // no hard-coded key
    }
  });
  it('no tool name refers to money movement', async () => {
    const { TOOL_NAMES } = await import('../src/ai/tools.js');
    for (const n of TOOL_NAMES) expect(n).not.toMatch(/pay|wallet|payout|refund|bank|escrow|transfer|charge|card|withdraw/i);
    expect(TOOL_NAMES).toContain('search_professionals');
  });
});

describe('Hedged fallback and streaming (speed)', () => {
  /** Provider whose per-model latency is scripted and which honours abort + streaming deltas. */
  class SlowProvider implements AiProvider {
    readonly name = 'slow';
    calls: string[] = []; aborted: string[] = [];
    constructor(private latency: Record<string, number>, private answer: Record<string, string | Error> = {}) {}
    chat(req: ChatRequest): Promise<ChatResponse> {
      this.calls.push(req.model);
      return new Promise((resolve, reject) => {
        const ms = this.latency[req.model] ?? 10;
        const t = setTimeout(() => {
          const a = this.answer[req.model] ?? `answer from ${req.model}`;
          if (a instanceof Error) return reject(a);
          if (req.onDelta) for (const part of a.split(' ')) req.onDelta(`${part} `);
          resolve(reply(a));
        }, ms);
        req.signal?.addEventListener('abort', () => { clearTimeout(t); this.aborted.push(req.model); reject(new AiProviderError('cancelled', 'cancelled')); }, { once: true });
      });
    }
  }
  const text = { department: 'explanations' as const, messages: [{ role: 'user' as const, content: 'hi' }], output: { kind: 'text' as const } };

  it('starts the next model after the hedge window and takes the first answer; the slow one is cancelled', async () => {
    const provider = new SlowProvider({ [MODELS.deepseek]: 5000, [MODELS.glm]: 50 });
    const router = new AiRouter({ ...baseConfig(), hedgeAfterMs: 200, maxAttemptsPerModel: 1 }, provider, new AiTelemetry());
    const t0 = Date.now();
    const r = await router.run(text);
    expect(r.alias).toBe('glm'); expect(r.fallbackUsed).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(provider.calls).toEqual([MODELS.deepseek, MODELS.glm]);
    expect(provider.aborted).toEqual([MODELS.deepseek]);
  });

  it('does not hedge when the primary answers inside the window', async () => {
    const provider = new SlowProvider({ [MODELS.deepseek]: 30, [MODELS.glm]: 5 });
    const router = new AiRouter({ ...baseConfig(), hedgeAfterMs: 500 }, provider, new AiTelemetry());
    const r = await router.run(text);
    expect(r.alias).toBe('deepseek'); expect(provider.calls).toEqual([MODELS.deepseek]);
  });

  it('hedging can be switched off (AI_HEDGE_AFTER_MS=0) → strictly sequential', async () => {
    const provider = new SlowProvider({ [MODELS.deepseek]: 300, [MODELS.glm]: 5 });
    const cfg = { ...loadAiConfig({ ...ENV, AI_HEDGE_AFTER_MS: '0' }), callTimeoutMs: 2000, taskTimeoutMs: 8000 };
    expect(cfg.hedgeAfterMs).toBe(0);
    const r = await new AiRouter(cfg, provider, new AiTelemetry()).run(text);
    expect(r.alias).toBe('deepseek'); expect(provider.calls).toEqual([MODELS.deepseek]);
  });

  it('streams the winning model’s words only and still returns the full answer', async () => {
    const provider = new SlowProvider({ [MODELS.deepseek]: 5000, [MODELS.glm]: 50 }, { [MODELS.glm]: 'Escrow protects both sides.' });
    const router = new AiRouter({ ...baseConfig(), hedgeAfterMs: 100, maxAttemptsPerModel: 1 }, provider, new AiTelemetry());
    const chunks: string[] = [];
    const r = await router.run(text, { onDelta: (t) => chunks.push(t) });
    expect(chunks.join('').trim()).toBe('Escrow protects both sides.');
    expect(r.value).toBe('Escrow protects both sides.');
    expect(r.alias).toBe('glm');
  });

  it('client abort cancels every in-flight model call', async () => {
    const provider = new SlowProvider({ [MODELS.deepseek]: 5000, [MODELS.glm]: 5000 });
    const router = new AiRouter({ ...baseConfig(), hedgeAfterMs: 50, maxAttemptsPerModel: 1 }, provider, new AiTelemetry());
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    await expect(router.run(text, { signal: ac.signal })).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    expect(provider.aborted.sort()).toEqual([MODELS.deepseek, MODELS.glm].sort());
  });

  it('extra provider body fields come from configuration and are reported by name only', () => {
    const cfg = loadAiConfig({ ...ENV, AI_EXTRA_BODY_JSON: '{"chat_template_kwargs":{"enable_thinking":false}}' });
    expect(cfg.extraBody).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(describeRouting(cfg).extraBodyKeys).toEqual(['chat_template_kwargs']);
    expect(loadAiConfig({ ...ENV, AI_EXTRA_BODY_JSON: 'nope' }).warnings.some((w) => w.includes('AI_EXTRA_BODY_JSON'))).toBe(true);
  });

  it('ThinkFilter never forwards a reasoning scratchpad, even when tags are split across chunks', () => {
    const run = (parts: string[]) => { const f = new ThinkFilter(); return parts.map((p) => f.feed(p)).join('') + f.flush(); };
    expect(run(['<thi', 'nk>secret plan</th', 'ink>Hello', ' there'])).toBe('Hello there');
    expect(run(['Plain ', 'answer.'])).toBe('Plain answer.');
    expect(run(['  <think>only thinking, cut off'])).toBe('');
    expect(run(['Start <think>mid</think> end'])).toBe('Start  end');
  });

  it('streams an SSE body through the OpenAI-compatible provider (deltas, tool calls and usage assembled)', async () => {
    const events = [
      { choices: [{ delta: { content: '<think>' } }] }, { choices: [{ delta: { content: 'hmm</think>Hello' } }] }, { choices: [{ delta: { content: ' world' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'search_', arguments: '{"q":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'professionals', arguments: '"x"}' } }] }, finish_reason: 'tool_calls' }] },
      { usage: { prompt_tokens: 7, completion_tokens: 3 }, choices: [] },
    ];
    const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
    const fetchImpl = (async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;
    const provider = new OpenAICompatibleProvider({ name: 't', baseUrl: 'https://x.test/v1', apiKey: 'k', fetchImpl });
    const chunks: string[] = [];
    const r = await provider.chat({ model: 'm', messages: [], timeoutMs: 1000, onDelta: (t) => chunks.push(t) });
    expect(chunks.join('')).toBe('Hello world');
    expect(r.message.content).toBe('Hello world');
    expect(r.message.tool_calls).toEqual([{ id: 'c1', type: 'function', function: { name: 'search_professionals', arguments: '{"q":"x"}' } }]);
    expect(r.usage).toEqual({ promptTokens: 7, completionTokens: 3 });
  });
});
