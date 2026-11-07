import { authorizedFetch } from './authApi.js';

const BASE = `${import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? ''}/api/v1`;

/**
 * Live Messages feed: GET /community/events (server-sent events over an authenticated fetch,
 * so the access token travels in the Authorization header like every other call).
 *
 * subscribeChatEvents(onEvent, onStatus) → stop()
 *   onEvent(event)  — { type: 'hello' | 'message' | 'typing' | 'read' | 'delivered' | 'presence' | 'connection' | 'thread', ... }
 *   onStatus(state) — 'connecting' | 'live' | 'reconnecting' | 'unavailable'
 *
 * Reconnects with backoff (1 s → 30 s). After repeated failures it reports 'unavailable' so the
 * page can fall back to polling; it keeps trying in the background and flips back to 'live'.
 */
export function subscribeChatEvents(onEvent, onStatus) {
  let stopped = false;
  let controller = null;
  let attempt = 0;
  let timer = null;

  const setStatus = (s) => { try { onStatus?.(s); } catch { /* ignore */ } };

  async function run() {
    if (stopped) return;
    controller = new AbortController();
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
    try {
      const res = await authorizedFetch(`${BASE}/community/events`, { headers: { Accept: 'text/event-stream' }, signal: controller.signal });
      if (!res.ok || !res.body || !(res.headers.get('content-type') || '').includes('text/event-stream')) {
        throw Object.assign(new Error('stream unavailable'), { status: res.status });
      }
      attempt = 0;
      setStatus('live');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx); buffer = buffer.slice(idx + 2);
          for (const line of frame.split('\n')) {
            if (line.startsWith('data: ')) { try { onEvent(JSON.parse(line.slice(6))); } catch { /* malformed frame */ } }
          }
        }
      }
      throw new Error('stream ended');
    } catch (e) {
      if (stopped) return;
      attempt += 1;
      // 429 TOO_MANY_STREAMS or 503 COMMUNITY_DISABLED: back off harder, the page will poll.
      const hard = e?.status === 429 || e?.status === 503 || e?.status === 403;
      const delay = Math.min(30_000, (hard ? 10_000 : 1000) * Math.pow(2, Math.min(attempt - 1, 5)));
      setStatus(attempt >= 3 ? 'unavailable' : 'reconnecting');
      timer = setTimeout(run, delay);
    }
  }

  const onVisible = () => { if (!stopped && document.visibilityState === 'visible' && attempt > 0) { clearTimeout(timer); run(); } };
  document.addEventListener('visibilitychange', onVisible);
  run();

  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    try { controller?.abort(); } catch { /* ignore */ }
  };
}
