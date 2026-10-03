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
}

export interface ChatUsage { promptTokens: number; completionTokens: number }
export interface ChatResponse { message: ChatMessage; usage: ChatUsage | null; finishReason: string | null; latencyMs: number }

export type AiErrorCode = 'unavailable' | 'rate_limited' | 'timeout' | 'auth' | 'bad_request' | 'network' | 'invalid_response';

export class AiProviderError extends Error {
  constructor(public code: AiErrorCode, message: string, public status?: number) {
    super(message);
    this.name = 'AiProviderError';
  }
  /** Transient failures may be retried once and then fall through to the next model. */
  get retryable(): boolean { return this.code === 'unavailable' || this.code === 'rate_limited' || this.code === 'timeout' || this.code === 'network'; }
  /** Permanent for this model (e.g. unknown model id) → skip straight to the next model. */
  get skipModel(): boolean { return this.code === 'bad_request' || this.code === 'auth'; }
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

export class OpenAICompatibleProvider implements AiProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { name: string; baseUrl: string; apiKey: string; fetchImpl?: typeof fetch }) {
    this.name = opts.name;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Never let the secret leak through an upstream error body or URL. */
  private scrub(text: string): string {
    if (!this.apiKey) return text;
    return text.split(this.apiKey).join('[REDACTED]');
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      max_tokens: req.maxTokens ?? 1500,
      temperature: req.temperature ?? 0.2,
    };
    if (req.tools?.length) { body.tools = req.tools; body.tool_choice = 'auto'; }
    if (req.json) body.response_format = { type: 'json_object' };

    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(req.timeoutMs),
      });
    } catch (e) {
      const err = e as Error & { name?: string };
      if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new AiProviderError('timeout', `model call exceeded ${req.timeoutMs} ms`);
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

    let data: { choices?: { message?: ChatMessage; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    try { data = await res.json() as typeof data; } catch { throw new AiProviderError('invalid_response', 'provider returned non-JSON body'); }
    const choice = data.choices?.[0];
    if (!choice?.message) throw new AiProviderError('invalid_response', 'provider returned no choices');

    const message: ChatMessage = { ...choice.message, content: stripThinking(choice.message.content ?? null) };
    const usage = data.usage ? { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 } : null;
    return { message, usage, finishReason: choice.finish_reason ?? null, latencyMs };
  }
}
