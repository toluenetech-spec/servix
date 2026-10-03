/**
 * Servix AI — provider abstraction.
 *
 * One interface (`AiProvider.chat`) so the host can be swapped by configuration.
 * The only implementation today speaks the OpenAI-compatible chat-completions
 * dialect used by Dahl (and NVIDIA Build, OpenAI, OpenRouter, vLLM, …).
 *
 * Security: the API key is read once from config, sent only as the
 * Authorization header, and scrubbed from any error text before it can reach
 * a log line. Nothing here is reachable from the browser.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface ChatMessage { role: ChatRole; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string }
export interface ToolSchema { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  timeoutMs: number;
  /** Cancels the call (hedged request lost, client went away). */
  signal?: AbortSignal;
  /** When set, the call streams and visible content deltas (reasoning scratchpads filtered) are forwarded. */
  onDelta?: (text: string) => void;
}

export interface ChatUsage { promptTokens: number; completionTokens: number }
export interface ChatResponse { message: ChatMessage; usage: ChatUsage | null; finishReason: string | null; latencyMs: number }

export type AiErrorCode = 'unavailable' | 'rate_limited' | 'timeout' | 'auth' | 'bad_request' | 'network' | 'invalid_response' | 'cancelled';

export class AiProviderError extends Error {
  constructor(public code: AiErrorCode, message: string, public status?: number) {
    super(message);
    this.name = 'AiProviderError';
  }
  /** Transient failures may be retried once and then fall through to the next model. */
  get retryable(): boolean { return this.code === 'unavailable' || this.code === 'rate_limited' || this.code === 'timeout' || this.code === 'network'; }
  /** Permanent for this model (e.g. unknown model id) → skip straight to the next model. */
  get skipModel(): boolean { return this.code === 'bad_request' || this.code === 'auth' || this.code === 'cancelled'; }
}

export interface AiProvider {
  readonly name: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

/** Remove reasoning scratchpads some models embed in the visible answer. */
export function stripThinking(text: string | null): string | null {
  if (typeof text !== 'string') return text;
  let out = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (out.startsWith('<think>')) out = ''; // unterminated reasoning (cut off by max_tokens) carries no answer
  return out;
}

/**
 * Streaming counterpart of stripThinking: holds back text while inside a <think>…</think> block so a
 * reasoning scratchpad is never forwarded to the user, and only releases text once it is sure the
 * answer did not start with a think tag.
 */
export class ThinkFilter {
  private pending = '';
  private inThink = false;
  private decided = false;
  feed(delta: string): string {
    this.pending += delta;
    let out = '';
    for (;;) {
      if (this.inThink) {
        const end = this.pending.indexOf('</think>');
        if (end === -1) { this.pending = this.pending.slice(-8); return out; } // keep a tail in case the close tag is split
        this.pending = this.pending.slice(end + 8); this.inThink = false; this.decided = true;
        continue;
      }
      if (!this.decided) {
        const lead = this.pending.replace(/^\s+/, '');
        if (lead.startsWith('<think>')) { this.inThink = true; this.pending = lead.slice(7); continue; }
        if ('<think>'.startsWith(lead) && lead.length < 7) return out; // could still become a think tag — wait
        this.decided = true;
      }
      const open = this.pending.indexOf('<think>');
      if (open !== -1) { out += this.pending.slice(0, open); this.pending = this.pending.slice(open + 7); this.inThink = true; continue; }
      // emit everything except a possible partial "<think" at the very end
      const tail = this.pending.lastIndexOf('<');
      if (tail !== -1 && tail > this.pending.length - 7 && '<think>'.startsWith(this.pending.slice(tail))) { out += this.pending.slice(0, tail); this.pending = this.pending.slice(tail); }
      else { out += this.pending; this.pending = ''; }
      return out;
    }
  }
  flush(): string { const rest = this.inThink || !this.decided ? '' : this.pending; this.pending = ''; return rest; }
}

export class OpenAICompatibleProvider implements AiProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly extraBody: Record<string, unknown>;

  constructor(opts: { name: string; baseUrl: string; apiKey: string; fetchImpl?: typeof fetch; extraBody?: Record<string, unknown> }) {
    this.name = opts.name;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.extraBody = opts.extraBody ?? {};
  }

  /** Never let the secret leak through an upstream error body or URL. */
  private scrub(text: string): string {
    if (!this.apiKey) return text;
    return text.split(this.apiKey).join('[REDACTED]');
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      ...this.extraBody,
      model: req.model,
      messages: req.messages,
      max_tokens: req.maxTokens ?? 1500,
      temperature: req.temperature ?? 0.2,
    };
    if (req.tools?.length) { body.tools = req.tools; body.tool_choice = 'auto'; }
    if (req.json) body.response_format = { type: 'json_object' };
    const streaming = typeof req.onDelta === 'function';
    if (streaming) { body.stream = true; body.stream_options = { include_usage: true }; }

    const started = Date.now();
    const timeout = AbortSignal.timeout(req.timeoutMs);
    const signal = req.signal ? AbortSignal.any([timeout, req.signal]) : timeout;
    const abortError = () => (req.signal?.aborted ? new AiProviderError('cancelled', 'call cancelled') : new AiProviderError('timeout', `model call exceeded ${req.timeoutMs} ms`));
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      const err = e as Error & { name?: string };
      if (err.name === 'TimeoutError' || err.name === 'AbortError') throw abortError();
      throw new AiProviderError('network', this.scrub(err.message ?? 'network error'));
    }
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      const detail = this.scrub((await res.text().catch(() => '')).slice(0, 300));
      if (res.status === 429) throw new AiProviderError('rate_limited', `rate limited / at capacity: ${detail}`, 429);
      if (res.status === 401 || res.status === 403) throw new AiProviderError('auth', 'provider rejected the API key', res.status);
      if (res.status === 400 || res.status === 404 || res.status === 422) throw new AiProviderError('bad_request', `provider rejected the request: ${detail}`, res.status);
      if (res.status >= 500 || res.status === 408) throw new AiProviderError('unavailable', `provider error ${res.status}: ${detail}`, res.status);
      throw new AiProviderError('unavailable', `unexpected provider status ${res.status}: ${detail}`, res.status);
    }

    if (streaming && (res.headers.get('content-type') ?? '').includes('text/event-stream') && res.body) {
      try { return await this.readStream(res, req.onDelta!, latencyMs); }
      catch (e) { if ((e as Error).name === 'AbortError' || signal.aborted) throw abortError(); throw e; }
    }

    let data: { choices?: { message?: ChatMessage; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    try { data = await res.json() as typeof data; } catch { throw new AiProviderError('invalid_response', 'provider returned non-JSON body'); }
    const choice = data.choices?.[0];
    if (!choice?.message) throw new AiProviderError('invalid_response', 'provider returned no choices');

    const message: ChatMessage = { ...choice.message, content: stripThinking(choice.message.content ?? null) };
    const usage = data.usage ? { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 } : null;
    return { message, usage, finishReason: choice.finish_reason ?? null, latencyMs };
  }

  /** Assemble an OpenAI-style SSE stream into one ChatResponse while forwarding visible content deltas. */
  private async readStream(res: Response, onDelta: (t: string) => void, latencyMs: number): Promise<ChatResponse> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const filter = new ThinkFilter();
    let content = ''; let finishReason: string | null = null; let usage: ChatUsage | null = null; let buffered = '';
    const toolCalls = new Map<number, ToolCall>();
    const handle = (line: string) => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let evt: { choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      try { evt = JSON.parse(payload) as typeof evt; } catch { return; }
      if (evt.usage) usage = { promptTokens: evt.usage.prompt_tokens ?? 0, completionTokens: evt.usage.completion_tokens ?? 0 };
      const choice = evt.choices?.[0];
      if (!choice) return;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta ?? {};
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        const visible = filter.feed(delta.content);
        if (visible) onDelta(visible);
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const cur = toolCalls.get(idx) ?? { id: tc.id ?? `call_${idx}`, type: 'function' as const, function: { name: '', arguments: '' } };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.function.name += tc.function.name;
        if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
        toolCalls.set(idx, cur);
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffered.indexOf('\n')) !== -1) { handle(buffered.slice(0, nl).replace(/\r$/, '')); buffered = buffered.slice(nl + 1); }
    }
    if (buffered) handle(buffered);
    const rest = filter.flush(); if (rest) onDelta(rest);
    const calls = [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
    const message: ChatMessage = { role: 'assistant', content: stripThinking(content) || (calls.length ? null : ''), ...(calls.length ? { tool_calls: calls } : {}) };
    return { message, usage, finishReason, latencyMs };
  }
}
